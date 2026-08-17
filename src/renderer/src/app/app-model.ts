export type BackendStatus = {
  state: 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
  restartAttempt?: number
  maxRestartAttempts?: number
}

export const BACKEND_LABELS: Record<BackendStatus['state'], string> = {
  starting: '服务启动中',
  online: '服务正常',
  failed: '服务异常',
  stopped: '服务已停止',
  crashed: '服务已崩溃'
}

export const BACKEND_COLORS: Record<
  BackendStatus['state'],
  'success' | 'processing' | 'error' | 'default'
> = {
  starting: 'processing',
  online: 'success',
  failed: 'error',
  stopped: 'default',
  crashed: 'error'
}

export type AppInfo = {
  name: string
  version: string
  projectUrl: string
}

export type SettingsSection =
  | 'app'
  | 'sql'
  | 'ai'
  | 'sync'
  | 'shortcuts'
  | 'drivers'
  | 'mcp'
  | 'extensions'

export type GitHubAuthStatus = {
  authorized: boolean
  login?: string | null
  name?: string | null
  avatar_url?: string | null
  repository_full_name?: string | null
  repository_url?: string | null
}

export type GitHubDeviceAuthorization = {
  session_id: string
  verification_uri: string
  verification_uri_complete?: string | null
  user_code: string
  expires_at: number
  interval_seconds: number
}

export type GitHubDeviceAuthorizationPoll = {
  status: 'pending' | 'authorized' | 'expired' | 'error'
  interval_seconds?: number | null
  message?: string | null
  auth?: GitHubAuthStatus | null
}

export type QuerySettings = {
  timeoutMinutes: number
}

export type McpSettings = {
  enabled: boolean
  allowWrite: boolean
  restrictConnections: boolean
  allowedConnectionIds: string[]
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: false,
  allowWrite: false,
  restrictConnections: false,
  allowedConnectionIds: []
}

export type OptionalModuleId = 'mcp' | 'ai' | 'jdbc' | 'data-versioning'

export type OptionalModuleInfo = {
  id: OptionalModuleId
  name: string
  description: string
  version: string
  installed: boolean
  installedAt?: number
}

export type OptionalModuleLaunchConfig = {
  command: string
  args: string[]
}

export type ShortcutAction =
  | 'sql_execute'
  | 'sql_delete_line'
  | 'sql_duplicate_line_down'
  | 'table_search'
  | 'ai_send'
  | 'ai_newline'
  | 'ai_stop'

export type ShortcutSettings = Record<ShortcutAction, string>

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  sql_execute: 'Ctrl+Enter',
  sql_delete_line: 'Ctrl+D',
  sql_duplicate_line_down: 'Ctrl+Alt+ArrowDown',
  table_search: 'Ctrl+F',
  ai_send: 'Enter',
  ai_newline: 'Shift+Enter',
  ai_stop: 'Ctrl+C'
}

export const SHORTCUT_SETTING_LABELS: Record<ShortcutAction, string> = {
  sql_execute: '执行 SQL',
  sql_delete_line: '删除行',
  sql_duplicate_line_down: '复制行到下一行',
  table_search: '表格内搜索',
  ai_send: '发送',
  ai_newline: '换行',
  ai_stop: '停止'
}

export type UpdateMode = 'installer' | 'portable'

export type UpdateInfo = {
  currentVersion: string
  latestVersion?: string
  available: boolean
  mode: UpdateMode
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  downloadedPath?: string
  installerDownloaded?: boolean
}

export type UpdateSettings = {
  autoCheckUpdates: boolean
  skippedUpdateVersion?: string | null
  mode: UpdateMode
  currentVersion: string
}

export type UpdateProgress = {
  percent: number
  transferred: number
  total?: number
}
