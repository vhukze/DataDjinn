import { app, dialog, shell, BrowserWindow, ipcMain, screen, webContents } from 'electron'
import { join } from 'path'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import StoreModule from 'electron-store'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.ico?asset'
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

type UpdateAsset = {
  name: string
  browser_download_url: string
  size?: number
}

type GitHubRelease = {
  tag_name: string
  name?: string
  body?: string
  html_url?: string
  assets?: UpdateAsset[]
}

type UpdateInfo = {
  currentVersion: string
  latestVersion?: string
  available: boolean
  mode: 'installer' | 'portable'
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  installerUrl?: string
  zipUrl?: string
  downloadedPath?: string
  installerDownloaded?: boolean
}

type UpdateProgress = {
  percent: number
  transferred: number
  total?: number
}

type AppStore = {
  aiConfig?: AIConfig
  aiConfigs?: AIConfigItem[]
  aiSessions?: AISession[]
  autoCheckUpdates?: boolean
  skippedUpdateVersion?: string
}

const Store = ('default' in StoreModule ? StoreModule.default : StoreModule) as typeof StoreModule
const store = new Store<AppStore>()
const streamControllers = new Map<string, AbortController>()
const GITHUB_PROJECT_URL = 'https://github.com/vhukze/DataDjinn'
const GITHUB_RELEASES_API = `${GITHUB_PROJECT_URL}/releases/latest`.replace('github.com', 'api.github.com/repos')
const appUpdateMode = process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installer'
let latestPortableUpdate: UpdateInfo | null = null
let installerUpdateDownloaded = false
let isQuittingForUpdate = false
let isRelaunching = false
let lastInstallerUpdateInfo: UpdateInfo | null = null
let mainWindowRef: BrowserWindow | null = null
let splashWindowRef: BrowserWindow | null = null
let splashDismissed = false
let backendStartupCompleted = false
let rendererStartupReady = false

const closeSplashWindow = (): void => {
  if (splashWindowRef && !splashWindowRef.isDestroyed()) {
    splashDismissed = true
    splashWindowRef.destroy()
  }
}

const showMainWindowIfReady = (): void => {
  if (!backendStartupCompleted || !rendererStartupReady || !mainWindowRef || mainWindowRef.isDestroyed()) {
    return
  }

  if (!mainWindowRef.isVisible()) {
    mainWindowRef.show()
  }
  mainWindowRef.focus()
  closeSplashWindow()
}

const showMainWindowForStartupFailure = (): void => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return
  }

  if (!mainWindowRef.isVisible()) {
    mainWindowRef.show()
  }
  mainWindowRef.focus()
  closeSplashWindow()
}

const normalizeVersion = (version: string): string => version.trim().replace(/^v/i, '')

const compareVersion = (left: string, right: string): number => {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) {
      return diff > 0 ? 1 : -1
    }
  }

  return 0
}

const githubHeaders = { 'User-Agent': `DataDjinn/${app.getVersion()}` }

const fetchLatestRelease = async (): Promise<GitHubRelease> => {
  const response = await fetch(GITHUB_RELEASES_API, { headers: githubHeaders })

  if (!response.ok) {
    throw new Error(`检查更新失败：HTTP ${response.status}`)
  }

  return await response.json() as GitHubRelease
}

const releaseToUpdateInfo = (release: GitHubRelease): UpdateInfo => {
  const latestVersion = normalizeVersion(release.tag_name)
  const assets = release.assets ?? []
  const zipAsset = assets.find((asset) => /DataDjinn-.*-win\.zip$/i.test(asset.name))
  const installerAsset = assets.find((asset) => /DataDjinn-.*-setup\.exe$/i.test(asset.name))

  return {
    currentVersion: app.getVersion(),
    latestVersion,
    available: compareVersion(latestVersion, app.getVersion()) > 0,
    mode: appUpdateMode,
    releaseName: release.name,
    releaseNotes: release.body,
    releaseUrl: release.html_url,
    installerUrl: installerAsset?.browser_download_url,
    zipUrl: zipAsset?.browser_download_url,
    installerDownloaded: false
  }
}

const checkPortableUpdate = async (): Promise<UpdateInfo> => {
  const release = await fetchLatestRelease()
  const updateInfo = releaseToUpdateInfo(release)
  latestPortableUpdate = updateInfo
  return updateInfo
}

const sendUpdateEvent = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

const isBackendNetworkError = (error: unknown): boolean => {
  if (error instanceof Error && error.name === 'AbortError') {
    return false
  }

  const message = error instanceof Error ? error.message : String(error ?? '')
  return /fetch failed|ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|socket hang up|terminated/i.test(message)
}

const ensureBackendForRequest = async (): Promise<string> => {
  const backendStatus = await backendManager.ensureOnline()

  if (!backendStatus.apiBaseUrl) {
    throw new Error(backendStatus.message ?? '后端服务未就绪')
  }

  return backendStatus.apiBaseUrl
}

const recoverBackendAfterRequestError = (error: unknown): void => {
  if (isBackendNetworkError(error)) {
    backendManager.recover('检测到后端连接中断，正在自动重启')
  }
}

const downloadPortableUpdate = async (): Promise<{ filePath: string }> => {
  const updateInfo = latestPortableUpdate ?? await checkPortableUpdate()

  if (!updateInfo.available || !updateInfo.zipUrl || !updateInfo.latestVersion) {
    throw new Error('暂无可下载的绿色版更新')
  }

  const updatesDir = join(app.getPath('downloads'), 'DataDjinn Updates')
  await mkdir(updatesDir, { recursive: true })
  const filePath = join(updatesDir, `DataDjinn-${updateInfo.latestVersion}-win.zip`)

  const response = await fetch(updateInfo.zipUrl, { headers: githubHeaders })
  if (!response.ok || !response.body) {
    throw new Error(`下载更新失败：HTTP ${response.status}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0) || undefined
  let transferred = 0
  const source = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      transferred += chunk.byteLength
      sendUpdateEvent('update:download-progress', {
        percent: total ? Math.round((transferred / total) * 100) : 0,
        transferred,
        total
      } satisfies UpdateProgress)
      controller.enqueue(chunk)
    }
  })

  await pipeline(response.body.pipeThrough(source), createWriteStream(filePath))
  latestPortableUpdate = { ...updateInfo, downloadedPath: filePath }
  sendUpdateEvent('update:downloaded', latestPortableUpdate)
  return { filePath }
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

autoUpdater.on('update-available', (info) => {
  installerUpdateDownloaded = false
  lastInstallerUpdateInfo = {
    currentVersion: app.getVersion(),
    latestVersion: info.version,
    available: true,
    mode: 'installer',
    releaseName: info.releaseName ?? undefined,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    releaseUrl: `https://github.com/vhukze/DataDjinn/releases/tag/v${info.version}`,
    installerDownloaded: false
  } satisfies UpdateInfo
  sendUpdateEvent('update:available', lastInstallerUpdateInfo)
})

autoUpdater.on('update-not-available', (info) => {
  lastInstallerUpdateInfo = null
  sendUpdateEvent('update:not-available', {
    currentVersion: app.getVersion(),
    latestVersion: info.version,
    available: false,
    mode: 'installer',
    installerDownloaded: false
  } satisfies UpdateInfo)
})

autoUpdater.on('download-progress', (progress) => {
  sendUpdateEvent('update:download-progress', {
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total
  } satisfies UpdateProgress)
})

autoUpdater.on('update-downloaded', (info) => {
  installerUpdateDownloaded = true
  lastInstallerUpdateInfo = {
    currentVersion: app.getVersion(),
    latestVersion: info.version,
    available: true,
    mode: 'installer',
    releaseName: info.releaseName ?? undefined,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    releaseUrl: `https://github.com/vhukze/DataDjinn/releases/tag/v${info.version}`,
    installerDownloaded: true
  } satisfies UpdateInfo
  sendUpdateEvent('update:downloaded', lastInstallerUpdateInfo)
})

autoUpdater.on('error', (error) => {
  sendUpdateEvent('update:error', error.message)
})

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const windowWidth = Math.max(1180, Math.floor(width * 0.7))
  const windowHeight = Math.max(760, Math.floor(height * 0.7))

  const mainWindow = new BrowserWindow({
    width: Math.min(windowWidth, width),
    height: Math.min(windowHeight, height),
    show: false,
    frame: false,
    title: 'DataDjinn',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindowRef = mainWindow

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
    }
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

function createSplashWindow(): void {
  if (splashWindowRef && !splashWindowRef.isDestroyed()) {
    return
  }
  splashDismissed = false

  const splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#00000000',
    icon,
    webPreferences: {
      sandbox: false
    }
  })

  splashWindowRef = splashWindow
  splashWindow.on('closed', () => {
    if (splashWindowRef === splashWindow) {
      splashWindowRef = null
    }
  })

  const splashLogoCandidate = is.dev
    ? join(process.cwd(), 'resources', 'logo-horizontal.svg')
    : join(process.resourcesPath, 'logo-horizontal.svg')
  const fallbackLogoCandidate = is.dev
    ? join(process.cwd(), 'resources', 'icon.svg')
    : join(process.resourcesPath, 'icon.svg')
  const splashLogoMarkup = (() => {
    const candidate = existsSync(splashLogoCandidate)
      ? splashLogoCandidate
      : fallbackLogoCandidate
    try {
      const svgContent = readFileSync(candidate, 'utf-8')
      const svgDataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`
      return `<img src="${svgDataUrl}" alt="DataDjinn" />`
    } catch {
      return '<div style="font-size:28px;font-weight:700;color:#111827;">DataDjinn</div>'
    }
  })()
  const splashHtml = `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>DataDjinn</title>
      <style>
        :root { color-scheme: light dark; }
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background: transparent;
          font-family: "Segoe UI", system-ui, sans-serif;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          width: 360px;
          padding: 26px 28px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          border-radius: 18px;
          background: rgba(255,255,255,0.95);
          box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
          border: 1px solid rgba(148, 163, 184, 0.18);
        }
        .logo {
          width: 220px;
          height: auto;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .logo img,
        .logo svg {
          width: 220px;
          height: auto;
          display: block;
        }
        .status {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: #516070;
          font-size: 13px;
        }
        .spinner {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid rgba(47, 124, 246, 0.18);
          border-top-color: #2f7cf6;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-color-scheme: dark) {
          .card {
            background: rgba(48,52,59,0.96);
            border-color: rgba(210,218,230,0.12);
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
          }
          .status {
            color: #c4cad2;
          }
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">${splashLogoMarkup}</div>
        <div class="status"><span class="spinner"></span><span>正在启动服务...</span></div>
      </div>
    </body>
  </html>`

  splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`)
  splashWindow.once('ready-to-show', () => {
    if (splashDismissed || (mainWindowRef && !mainWindowRef.isDestroyed() && mainWindowRef.isVisible())) {
      splashWindow.destroy()
      return
    }
    splashWindow.show()
  })
}

async function finishStartupAndShowMainWindow(): Promise<void> {
  try {
    await backendManager.start()
    backendStartupCompleted = true
    showMainWindowIfReady()
  } catch {
    rendererStartupReady = true
    showMainWindowForStartupFailure()
  }
}

async function showMainWindowAfterStartup(): Promise<void> {
  try {
    await backendManager.start()
  } catch {
    // 主窗口内继续展示启动/错误状态
  } finally {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.show()
      mainWindowRef.focus()
    }
    if (splashWindowRef && !splashWindowRef.isDestroyed()) {
      splashWindowRef.close()
    }
  }
}

void showMainWindowAfterStartup

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  app.setName('DataDjinn')
  electronApp.setAppUserModelId('com.datadjinn.app')

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

  ipcMain.handle('select-driver-file', async () => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择驱动文件',
      filters: [
        { name: '驱动文件', extensions: ['jar', 'pyd', 'whl'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('select-java-directory', async () => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择 Java JDK/JRE 目录',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('select-import-file', async () => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择导入文件',
      filters: [
        { name: 'SQL / CSV 文件', extensions: ['sql', 'csv'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('select-export-path', async (_event, format: string, defaultName?: string) => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const filters: Electron.FileFilter[] = format === 'csv'
      ? [{ name: 'CSV 文件', extensions: ['csv'] }]
      : format === 'json'
        ? [{ name: 'JSON 文件', extensions: ['json'] }]
        : [{ name: 'SQL 文件', extensions: ['sql'] }]

    const result = await dialog.showSaveDialog(window, {
      title: '选择导出路径',
      defaultPath: defaultName,
      filters: [...filters, { name: '所有文件', extensions: ['*'] }]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return result.filePath
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
  ipcMain.handle('app:get-info', () => ({ name: app.getName(), version: app.getVersion(), projectUrl: GITHUB_PROJECT_URL }))
  ipcMain.handle('app:open-project-home', async () => {
    await shell.openExternal(GITHUB_PROJECT_URL)
  })
  ipcMain.on('app:renderer-ready', () => {
    rendererStartupReady = true
    showMainWindowIfReady()
  })
  ipcMain.handle('app:relaunch', async () => {
    isRelaunching = true
    await backendManager.stop()
    app.relaunch()
    app.exit(0)
  })
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
    const sender = webContents.fromId(event.sender.id)
    const controller = new AbortController()
    streamControllers.set(streamId, controller)

    try {
      const apiBaseUrl = await ensureBackendForRequest()
      const response = await fetch(`${apiBaseUrl}${path}`, {
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

      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        sender?.send('api:stream-chunk', streamId, decoder.decode(value, { stream: true }))
      }
    } catch (error) {
      recoverBackendAfterRequestError(error)
      throw error
    } finally {
      streamControllers.delete(streamId)
      sender?.send('api:stream-end', streamId)
    }
  })

  ipcMain.handle('api:stream-cancel', (_, streamId: string) => {
    streamControllers.get(streamId)?.abort()
    streamControllers.delete(streamId)
  })

  ipcMain.handle('update:get-settings', () => ({
    autoCheckUpdates: store.get('autoCheckUpdates') ?? true,
    skippedUpdateVersion: store.get('skippedUpdateVersion') ?? null,
    mode: appUpdateMode,
    currentVersion: app.getVersion()
  }))

  ipcMain.handle('update:set-auto-check', (_, enabled: boolean) => {
    store.set('autoCheckUpdates', enabled)
    return enabled
  })

  ipcMain.handle('update:skip-version', (_, version: string) => {
    store.set('skippedUpdateVersion', normalizeVersion(version))
  })

  ipcMain.handle('update:check', async () => {
    if (appUpdateMode === 'portable') {
      const updateInfo = await checkPortableUpdate()
      sendUpdateEvent(updateInfo.available ? 'update:available' : 'update:not-available', updateInfo)
      return updateInfo
    }

    const result = await autoUpdater.checkForUpdates()
    const nextInfo = {
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo.version,
      available: result ? compareVersion(result.updateInfo.version, app.getVersion()) > 0 : false,
      mode: 'installer',
      releaseName: result?.updateInfo.releaseName ?? undefined,
      releaseNotes: typeof result?.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
      releaseUrl: result?.updateInfo.version ? `https://github.com/vhukze/DataDjinn/releases/tag/v${result.updateInfo.version}` : undefined,
      installerDownloaded: installerUpdateDownloaded
    } satisfies UpdateInfo
    lastInstallerUpdateInfo = nextInfo.available ? nextInfo : null
    return nextInfo
  })

  ipcMain.handle('update:download', async () => {
    if (appUpdateMode === 'portable') {
      return await downloadPortableUpdate()
    }

    await autoUpdater.downloadUpdate()
    return null
  })

  ipcMain.handle('update:install', async () => {
    if (appUpdateMode === 'portable') {
      if (latestPortableUpdate?.downloadedPath) {
        await shell.showItemInFolder(latestPortableUpdate.downloadedPath)
      }
      return
    }

    if (!installerUpdateDownloaded) {
      throw new Error('更新尚未下载完成')
    }

    isQuittingForUpdate = true
    await backendManager.stop()
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('update:open-release', async (_, url?: string) => {
    await shell.openExternal(url || 'https://github.com/vhukze/DataDjinn/releases')
  })

  ipcMain.handle('api:request', async (_, path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    try {
      const apiBaseUrl = await ensureBackendForRequest()
      const response = await fetch(`${apiBaseUrl}${path}`, {
        method: options?.method,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers
        },
        body: options?.body
      })

      const text = await response.text()
      let data: any = null

      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }

      if (!response.ok) {
        throw new Error(data?.detail ?? (text || `HTTP ${response.status}`))
      }

      return data
    } catch (error) {
      recoverBackendAfterRequestError(error)
      throw error
    }
  })

  createSplashWindow()
  backendStartupCompleted = false
  rendererStartupReady = false
  createWindow()
  void finishStartupAndShowMainWindow()

  if (!is.dev && (store.get('autoCheckUpdates') ?? true)) {
    setTimeout(() => {
      if (appUpdateMode === 'portable') {
        void checkPortableUpdate().then((updateInfo) => {
          if (updateInfo.available && normalizeVersion(updateInfo.latestVersion ?? '') !== store.get('skippedUpdateVersion')) {
            sendUpdateEvent('update:available', updateInfo)
          }
        }).catch((error) => sendUpdateEvent('update:error', error instanceof Error ? error.message : '检查更新失败'))
      } else {
        void autoUpdater.checkForUpdates().catch((error) => sendUpdateEvent('update:error', error instanceof Error ? error.message : '检查更新失败'))
      }
    }, 3000)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (isQuittingForUpdate || isRelaunching) {
    return
  }

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
