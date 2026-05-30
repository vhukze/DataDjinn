import { ElectronAPI } from '@electron-toolkit/preload'

type SqlFileResult = { name: string; content: string } | null
type BackendStatus = {
  state: 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
}

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

interface DataDjinnAPI {
  selectSqlFile: () => Promise<SqlFileResult>
  selectImportFile: () => Promise<string | null>
  selectExportPath: (format: 'sql' | 'csv', defaultName?: string) => Promise<string | null>
  selectDriverFile: () => Promise<string | null>
  requestJson: <T>(path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<T>
  streamRequest: (streamId: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string }, onChunk: (chunk: string) => void | Promise<void>) => Promise<void>
  cancelStreamRequest: (streamId: string) => Promise<void>
  getAIConfig: () => Promise<AIConfig | null>
  setAIConfig: (config: AIConfig) => Promise<AIConfig>
  getAIConfigs: () => Promise<AIConfigItem[]>
  setAIConfigs: (configs: AIConfigItem[]) => Promise<AIConfigItem[]>
  getAISessions: () => Promise<AISession[]>
  setAISessions: (sessions: AISession[]) => Promise<AISession[]>
  getBackendStatus: () => Promise<BackendStatus>
  restartBackend: () => Promise<BackendStatus>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<void>
  onBackendStatusChanged: (callback: (status: BackendStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DataDjinnAPI
  }
}
