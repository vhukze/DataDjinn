import { app, dialog, shell, BrowserWindow, ipcMain, screen, webContents } from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import StoreModule from 'electron-store'
import icon from '../../resources/icon.png?asset'
import { backendManager } from './backend'

type AIConfig = {
  provider?: 'openai-compatible' | 'anthropic'
  base_url: string
  api_key: string
  model: string
}

type AIConfigItem = AIConfig & {
  id: string
  name: string
  enabled: boolean
}

type AISession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: unknown[]
}

const Store = ('default' in StoreModule ? StoreModule.default : StoreModule) as typeof StoreModule
const store = new Store<{ aiConfig?: AIConfig; aiConfigs?: AIConfigItem[]; aiSessions?: AISession[] }>()
const streamControllers = new Map<string, AbortController>()

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const windowWidth = Math.max(1180, Math.floor(width * 0.7))
  const windowHeight = Math.max(760, Math.floor(height * 0.7))

  const mainWindow = new BrowserWindow({
    width: Math.min(windowWidth, width),
    height: Math.min(windowHeight, height),
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('backend-status-changed', backendManager.getStatus())
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('select-sql-file', async () => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择 SQL 文件',
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    const content = await readFile(filePath, 'utf-8')

    return { name, content }
  })

  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle('window:maximize-toggle', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return false
    }
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('backend:get-status', () => backendManager.getStatus())
  ipcMain.handle('backend:restart', () => backendManager.restart())
  ipcMain.handle('ai-config:get', () => store.get('aiConfig') ?? null)
  ipcMain.handle('ai-config:set', (_, config: AIConfig) => {
    store.set('aiConfig', config)
    return config
  })
  ipcMain.handle('ai-configs:get', () => store.get('aiConfigs') ?? [])
  ipcMain.handle('ai-configs:set', (_, configs: AIConfigItem[]) => {
    const enabledId = configs.find((config) => config.enabled)?.id
    const nextConfigs = configs.map((config) => ({ ...config, enabled: Boolean(enabledId && config.id === enabledId) }))
    store.set('aiConfigs', nextConfigs)
    const activeConfig = nextConfigs.find((config) => config.enabled)
    if (activeConfig) {
      const { id: _id, name: _name, enabled: _enabled, ...legacyConfig } = activeConfig
      store.set('aiConfig', legacyConfig)
    } else {
      store.delete('aiConfig')
    }
    return nextConfigs
  })
  ipcMain.handle('ai-sessions:get', () => store.get('aiSessions') ?? [])
  ipcMain.handle('ai-sessions:set', (_, sessions: AISession[]) => {
    store.set('aiSessions', sessions)
    return sessions
  })
  ipcMain.handle('api:stream', async (event, streamId: string, path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const backendStatus = backendManager.getStatus()
    const sender = webContents.fromId(event.sender.id)
    const controller = new AbortController()
    streamControllers.set(streamId, controller)

    if (!backendStatus.apiBaseUrl) {
      streamControllers.delete(streamId)
      throw new Error('后端服务启动中，请稍候')
    }

    const response = await fetch(`${backendStatus.apiBaseUrl}${path}`, {
      method: options?.method,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: options?.body,
      signal: controller.signal
    })

    if (!response.ok || !response.body) {
      const text = await response.text()
      throw new Error(text || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        sender?.send('api:stream-chunk', streamId, decoder.decode(value, { stream: true }))
      }
    } finally {
      streamControllers.delete(streamId)
      sender?.send('api:stream-end', streamId)
    }
  })

  ipcMain.handle('api:stream-cancel', (_, streamId: string) => {
    streamControllers.get(streamId)?.abort()
    streamControllers.delete(streamId)
  })

  ipcMain.handle('api:request', async (_, path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const backendStatus = backendManager.getStatus()

    if (!backendStatus.apiBaseUrl) {
      throw new Error('后端服务启动中，请稍候')
    }

    const response = await fetch(`${backendStatus.apiBaseUrl}${path}`, {
      method: options?.method,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: options?.body
    })

    const text = await response.text()
    const data = text ? JSON.parse(text) : null

    if (!response.ok) {
      throw new Error(data?.detail ?? `HTTP ${response.status}`)
    }

    return data
  })

  void backendManager.start()
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  event.preventDefault()
  void backendManager.stop().finally(() => app.exit(0))
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
