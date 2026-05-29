import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  selectSqlFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('select-sql-file'),
  selectImportFile: (): Promise<string | null> => ipcRenderer.invoke('select-import-file'),
  selectExportPath: (format: 'sql' | 'csv', defaultName?: string): Promise<string | null> => ipcRenderer.invoke('select-export-path', format, defaultName),
  selectDmDriverFile: (): Promise<string | null> => ipcRenderer.invoke('select-dm-driver-file'),
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
  getAIConfig: () => ipcRenderer.invoke('ai-config:get'),
  setAIConfig: (config: unknown) => ipcRenderer.invoke('ai-config:set', config),
  getAIConfigs: () => ipcRenderer.invoke('ai-configs:get'),
  setAIConfigs: (configs: unknown) => ipcRenderer.invoke('ai-configs:set', configs),
  getAISessions: () => ipcRenderer.invoke('ai-sessions:get'),
  setAISessions: (sessions: unknown) => ipcRenderer.invoke('ai-sessions:set', sessions),
  getDmDriverPath: () => ipcRenderer.invoke('settings:get-dm-driver-path'),
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
