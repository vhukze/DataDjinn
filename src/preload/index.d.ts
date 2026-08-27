import { ElectronAPI } from '@electron-toolkit/preload'

type SqlFileResult = { name: string; content: string } | null
type BackendStatus = {
  state: 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
  restartAttempt?: number
  maxRestartAttempts?: number
}

type AIConfig = {
  provider?: 'openai-compatible' | 'anthropic'
  base_url: string
  api_key: string
  model: string
  max_context_tokens?: number
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

type UpdateMode = 'installer' | 'portable'

type UpdateInfo = {
  currentVersion: string
  latestVersion?: string
  available: boolean
  mode: UpdateMode
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  installerUrl?: string
  zipUrl?: string
  downloadedPath?: string
  installerDownloaded?: boolean
}

type UpdateSettings = {
  autoCheckUpdates: boolean
  skippedUpdateVersion?: string | null
  mode: UpdateMode
  currentVersion: string
}

type UpdateProgress = {
  percent: number
  transferred: number
  total?: number
}

type QuerySettings = {
  timeoutMinutes: number
}

type McpSettings = {
  enabled: boolean
  allowWrite: boolean
  restrictConnections: boolean
  allowedConnectionIds: string[]
}

type AppSyncSettings = {
  autoCheckUpdates: boolean
  queryTimeoutMinutes: number
  mcpSettings: McpSettings
  aiConfigs: AIConfigItem[]
}

type SyncLocalState = {
  passphrase?: string
  basePayload?: unknown
  remoteSha?: string
  lastSyncedAt?: number
  autoSyncEnabled?: boolean
}

type OptionalModuleId = 'mcp' | 'ai' | 'jdbc' | 'data-versioning'

type OptionalModuleInfo = {
  id: OptionalModuleId
  name: string
  description: string
  version: string
  installed: boolean
  installedAt?: number
  installedVersion?: string
  pendingVersion?: string
  pendingRestartRequired?: boolean
  updateAvailable?: boolean
}

type OptionalModuleLaunchConfig = {
  command: string
  args: string[]
}

type AppInfo = {
  name: string
  version: string
  projectUrl: string
}

interface DataDjinnAPI {
  selectSqlFile: () => Promise<SqlFileResult>
  selectSqliteFile: () => Promise<string | null>
  selectImportFile: () => Promise<string | null>
  selectConnectionTransferImportFile: (source?: 'datadjinn' | 'dbeaver') => Promise<string | null>
  selectExportPath: (format: 'sql' | 'csv' | 'json' | 'markdown', defaultName?: string) => Promise<string | null>
  selectConnectionTransferExportPath: (defaultName?: string) => Promise<string | null>
  selectDriverFile: () => Promise<string | null>
  selectJavaDirectory: () => Promise<string | null>
  readTextFile: (filePath: string) => Promise<string>
  writeTextFile: (filePath: string, content: string) => Promise<boolean>
  requestJson: <T>(
    path: string,
    options?: {
      method?: string
      headers?: Record<string, string>
      body?: string
      timeoutMs?: number
    }
  ) => Promise<T>
  streamRequest: (
    streamId: string,
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string },
    onChunk: (chunk: string) => void | Promise<void>
  ) => Promise<void>
  cancelStreamRequest: (streamId: string) => Promise<void>
  getUpdateSettings: () => Promise<UpdateSettings>
  setAutoCheckUpdates: (enabled: boolean) => Promise<boolean>
  checkForUpdates: () => Promise<UpdateInfo>
  downloadUpdate: () => Promise<{ filePath: string } | null>
  installUpdate: () => Promise<void>
  skipUpdateVersion: (version: string) => Promise<void>
  openReleasePage: (url?: string) => Promise<void>
  getAppInfo: () => Promise<AppInfo>
  openProjectHome: () => Promise<void>
  openExternalUrl: (url: string) => Promise<void>
  notifyRendererReady: () => void
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void
  onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => () => void
  onUpdateDownloadProgress: (callback: (progress: UpdateProgress) => void) => () => void
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void
  onUpdateError: (callback: (message: string) => void) => () => void
  getAIConfig: () => Promise<AIConfig | null>
  setAIConfig: (config: AIConfig) => Promise<AIConfig>
  getAIConfigs: () => Promise<AIConfigItem[]>
  setAIConfigs: (configs: AIConfigItem[]) => Promise<AIConfigItem[]>
  getAISessions: () => Promise<AISession[]>
  setAISessions: (sessions: AISession[]) => Promise<AISession[]>
  getBackendStatus: () => Promise<BackendStatus>
  restartBackend: () => Promise<BackendStatus>
  getQuerySettings: () => Promise<QuerySettings>
  setQueryTimeoutMinutes: (timeoutMinutes: number) => Promise<QuerySettings>
  getMcpSettings: () => Promise<McpSettings>
  setMcpSettings: (settings: McpSettings) => Promise<McpSettings>
  getSyncLocalState: () => Promise<SyncLocalState>
  setSyncLocalState: (state: SyncLocalState) => Promise<SyncLocalState>
  clearSyncLocalState: () => Promise<void>
  getConnectionTreePreferences: () => Promise<Record<string, unknown>>
  setConnectionTreePreferences: (
    preferences: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
  getAppSyncSettings: () => Promise<AppSyncSettings>
  applyAppSyncSettings: (settings: Partial<AppSyncSettings>) => Promise<AppSyncSettings>
  getOptionalModules: () => Promise<OptionalModuleInfo[]>
  installOptionalModule: (moduleId: OptionalModuleId) => Promise<OptionalModuleInfo[]>
  uninstallOptionalModule: (moduleId: OptionalModuleId) => Promise<OptionalModuleInfo[]>
  getOptionalModuleLaunchConfig: (moduleId: OptionalModuleId) => Promise<OptionalModuleLaunchConfig | null>
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
