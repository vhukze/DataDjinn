import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  selectSqlFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('select-sql-file'),
  selectImportFile: (): Promise<string | null> => ipcRenderer.invoke('select-import-file'),
  selectExportPath: (format: 'sql' | 'csv' | 'json', defaultName?: string): Promise<string | null> => ipcRenderer.invoke('select-export-path', format, defaultName),
  selectDriverFile: (): Promise<string | null> => ipcRenderer.invoke('select-driver-file'),
  selectJavaDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-java-directory'),
  requestJson: (path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => ipcRenderer.invoke('api:request', path, options),
  streamRequest: (
    streamId: string,
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string },
    onChunk: (chunk: string) => void | Promise<void>
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      let chunkError: unknown
      const chunkListener = (_: Electron.IpcRendererEvent, nextStreamId: string, chunk: string): void => {
        if (nextStreamId !== streamId || chunkError) {
          return
        }

        try {
          void Promise.resolve(onChunk(chunk)).catch((error) => {
            chunkError = error
          })
        } catch (error) {
          chunkError = error
        }
      }
      const endListener = (_: Electron.IpcRendererEvent, nextStreamId: string): void => {
        if (nextStreamId !== streamId) {
          return
        }
        cleanup()
        if (chunkError) {
          reject(chunkError)
          return
        }
        resolve()
      }
      const cleanup = (): void => {
        ipcRenderer.removeListener('api:stream-chunk', chunkListener)
        ipcRenderer.removeListener('api:stream-end', endListener)
      }

      ipcRenderer.on('api:stream-chunk', chunkListener)
      ipcRenderer.on('api:stream-end', endListener)
      ipcRenderer.invoke('api:stream', streamId, path, options).catch((error) => {
        cleanup()
        reject(error)
      })
    })
  },
  cancelStreamRequest: (streamId: string) => ipcRenderer.invoke('api:stream-cancel', streamId),
  getUpdateSettings: () => ipcRenderer.invoke('update:get-settings'),
  setAutoCheckUpdates: (enabled: boolean) => ipcRenderer.invoke('update:set-auto-check', enabled),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  skipUpdateVersion: (version: string) => ipcRenderer.invoke('update:skip-version', version),
  openReleasePage: (url?: string) => ipcRenderer.invoke('update:open-release', url),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  openProjectHome: () => ipcRenderer.invoke('app:open-project-home'),
  notifyRendererReady: () => ipcRenderer.send('app:renderer-ready'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown): void => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  onUpdateNotAvailable: (callback: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown): void => callback(info)
    ipcRenderer.on('update:not-available', listener)
    return () => ipcRenderer.removeListener('update:not-available', listener)
  },
  onUpdateDownloadProgress: (callback: (progress: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, progress: unknown): void => callback(progress)
    ipcRenderer.on('update:download-progress', listener)
    return () => ipcRenderer.removeListener('update:download-progress', listener)
  },
  onUpdateDownloaded: (callback: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown): void => callback(info)
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
  onUpdateError: (callback: (message: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('update:error', listener)
    return () => ipcRenderer.removeListener('update:error', listener)
  },
  getAIConfig: () => ipcRenderer.invoke('ai-config:get'),
  setAIConfig: (config: unknown) => ipcRenderer.invoke('ai-config:set', config),
  getAIConfigs: () => ipcRenderer.invoke('ai-configs:get'),
  setAIConfigs: (configs: unknown) => ipcRenderer.invoke('ai-configs:set', configs),
  getAISessions: () => ipcRenderer.invoke('ai-sessions:get'),
  setAISessions: (sessions: unknown) => ipcRenderer.invoke('ai-sessions:set', sessions),
  getBackendStatus: () => ipcRenderer.invoke('backend:get-status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onBackendStatusChanged: (callback: (status: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, status: unknown): void => callback(status)
    ipcRenderer.on('backend-status-changed', listener)
    return () => ipcRenderer.removeListener('backend-status-changed', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
