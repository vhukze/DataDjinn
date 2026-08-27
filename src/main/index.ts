import { app, dialog, shell, BrowserWindow, ipcMain, safeStorage, screen, webContents } from 'electron'
import { join, resolve } from 'path'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { createHash, randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import StoreModule from 'electron-store'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.ico?asset'
import { backendManager } from './backend'
import { AiModuleManager } from './ai-module'
import { buildConnectionTransferImportDialogOptions } from './connection-transfer-dialog'

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

type StoredSyncState = {
  encryptedPassphrase?: string
  encryptedBasePayload?: string
  remoteSha?: string
  lastSyncedAt?: number
  autoSyncEnabled?: boolean
}

type SyncLocalState = {
  passphrase?: string
  basePayload?: unknown
  remoteSha?: string
  lastSyncedAt?: number
  autoSyncEnabled?: boolean
}

type OptionalModuleId = 'mcp' | 'ai' | 'jdbc' | 'data-versioning'
type OptionalModuleArtifactId =
  | 'mcp'
  | 'ai'
  | 'jdbc-runtime'
  | 'jre-17'
  | 'data-versioning'

type OptionalModuleState = {
  id: OptionalModuleArtifactId
  version: string
  installedAt: number
  installPath?: string
  entryPoint?: string
}

type PendingOptionalModuleState = {
  id: OptionalModuleArtifactId
  version: string
  temporaryPath: string
  entryPoint: string
}

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

type OptionalModuleArtifact = {
  id: OptionalModuleArtifactId
  version: string
  name?: string
  description?: string
  artifact: {
    url: string
    sha256: string
  }
}

type RemoteOptionalModuleCatalog = {
  version?: number
  modules?: Array<{
    id?: unknown
    version?: unknown
    url?: unknown
    sha256?: unknown
  }>
}

const OPTIONAL_MODULE_CATALOG = [
  {
    id: 'mcp',
    version: '1.0.2',
    name: '本机 MCP 服务',
    description: '供本机 Agent 通过 STDIO 安全访问已授权的 DataDjinn 连接。',
  },
  {
    id: 'ai',
    version: '1.0.0',
    name: 'AI 助手',
    description: '提供 AI 对话、SQL 生成和受控数据库操作，安装后保留已有 AI 配置与会话。',
  },
  {
    id: 'jdbc',
    version: '1.0.0',
    name: 'JDBC 数据库支持',
    description: '为达梦、高斯等 JDBC 连接安装桥接依赖。安装时自动检测本机可用 Java；未检测到时自动安装 Java 17。'
  },
  {
    id: 'data-versioning',
    version: '1.0.0',
    name: 'Git 表数据版本管理',
    description: '为已开启 Git 版本管理的连接提供表数据快照、提交历史和行级差异。结构版本与配置同步无需安装。'
  }
] as const

const OPTIONAL_MODULE_ARTIFACT_CATALOG: readonly OptionalModuleArtifact[] = [
  {
    id: 'mcp',
    version: '1.0.2',
    artifact: {
      url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.0.2/datadjinn-mcp-1.0.2-win-x64.zip',
      sha256: '3f49be5946b85da15a5c6d1fc11a3ebe683b9ce577a0499fae6b4b410f68035b'
    }
  },
  {
    id: 'ai',
    version: '1.0.0',
    artifact: {
      url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.0.0/datadjinn-ai-1.0.0-win-x64.zip',
      sha256: 'c63b06242ecfabb48dd56c71018097d2e786f9243dfd178652475702702489a3'
    }
  },
  {
    id: 'jdbc-runtime',
    version: '1.0.0',
    artifact: {
      url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.1.0/datadjinn-jdbc-runtime-1.0.0-win-x64.zip',
      sha256: '0291c7dffb75ac3be5149d6dcc5db114a962c9d0cdbd5a3ddb3a54d8ead789ed'
    }
  },
  {
    id: 'jre-17',
    version: '17.0.20+8',
    name: 'Java 17 运行时',
    description: '可选的 Eclipse Temurin Java 17 运行时。安装后可在驱动管理中选择，不会覆盖已有 Java 配置。',
    artifact: {
      url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.1.0/datadjinn-jre-17.0.20%2B8-win-x64.zip',
      sha256: 'fb7ce5543383a1ecb2974b04186c40a687c752bd438f815e3d81fee59fa48f59'
    }
  },
  {
    id: 'data-versioning',
    version: '1.0.0',
    artifact: {
      url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.2.0/datadjinn-data-versioning-1.0.0-win-x64.zip',
      sha256: '9b656af0bffba9deed4cf6dcd5edd906193cba83d96eeb5d77e272a652124feb'
    }
  }
] as const

type UpdateAsset = {
  name: string
  browser_download_url: string
  size?: number
  digest?: string
}

type GitHubRelease = {
  tag_name: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
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
  queryTimeoutMinutes?: number
  mcpSettings?: McpSettings
  optionalModules?: OptionalModuleState[]
  pendingOptionalModules?: PendingOptionalModuleState[]
  syncState?: StoredSyncState
  connectionTreePreferences?: Record<string, unknown>
  connectionTreePreferencesUpdatedAt?: number
}

const testUserDataDir = process.env.DATADJINN_TEST_USER_DATA_DIR
if (testUserDataDir) {
  app.setPath('userData', testUserDataDir)
}

const Store = ('default' in StoreModule ? StoreModule.default : StoreModule) as typeof StoreModule
const store = new Store<AppStore>()
const streamControllers = new Map<string, AbortController>()
const aiModuleManager = new AiModuleManager()
const MAX_OPTIONAL_MODULE_DOWNLOAD_ATTEMPTS = 3
const MAX_OPTIONAL_MODULE_REPLACE_ATTEMPTS = 8
const OPTIONAL_MODULE_CATALOG_CACHE_MS = 5 * 60 * 1000
const approvedTextFilePaths = new Set<string>()
const DEFAULT_QUERY_TIMEOUT_MINUTES = 15
const MIN_QUERY_TIMEOUT_MINUTES = 1
const MAX_QUERY_TIMEOUT_MINUTES = 120
const GITHUB_PROJECT_URL = 'https://github.com/vhukze/DataDjinn'
const OPTIONAL_MODULE_CATALOG_URL =
  'https://raw.githubusercontent.com/vhukze/DataDjinn/main/module-catalog.json'
const GITHUB_RELEASES_ATOM_URL = `${GITHUB_PROJECT_URL}/releases.atom`
const GITHUB_RELEASE_DOWNLOAD_URL = 'https://github.com/vhukze/DataDjinn/releases/download'
const appUpdateMode = process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installer'
let latestPortableUpdate: UpdateInfo | null = null
let installerUpdateDownloaded = false
let isQuittingForUpdate = false
let lastInstallerUpdateInfo: UpdateInfo | null = null
let backgroundUpdateCheckRunning = false
let optionalModuleCatalogCache: { expiresAt: number; artifacts: OptionalModuleArtifact[] } | undefined
let mainWindowRef: BrowserWindow | null = null
let splashWindowRef: BrowserWindow | null = null
let splashDismissed = false
let backendStartupCompleted = false
let rendererStartupReady = false
const testRoutineNames = (process.env.DATADJINN_TEST_ROUTINE_NAMES ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const skipSplashWindow = process.env.DATADJINN_SKIP_SPLASH === '1'
const useCiRegressionScale = Boolean(testUserDataDir && process.env.CI)
const requestedTestWindowHeight = Number.parseInt(
  process.env.DATADJINN_TEST_WINDOW_HEIGHT ?? '',
  10
)
const testWindowHeight =
  Number.isFinite(requestedTestWindowHeight) && requestedTestWindowHeight >= 520
    ? requestedTestWindowHeight
    : 980

// GitHub Windows runners provide a 1024x768 virtual desktop. Apply this only in CI
// so local regression windows always retain the user's native display scale.
if (useCiRegressionScale) {
  app.commandLine.appendSwitch('force-device-scale-factor', '0.7')
}

const closeSplashWindow = (): void => {
  if (splashWindowRef && !splashWindowRef.isDestroyed()) {
    splashDismissed = true
    splashWindowRef.destroy()
  }
}

const showMainWindowIfReady = (): void => {
  if (
    !backendStartupCompleted ||
    !rendererStartupReady ||
    !mainWindowRef ||
    mainWindowRef.isDestroyed()
  ) {
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

const normalizeQueryTimeoutMinutes = (value: unknown): number => {
  const minutes = Number(value)
  return Number.isInteger(minutes) &&
    minutes >= MIN_QUERY_TIMEOUT_MINUTES &&
    minutes <= MAX_QUERY_TIMEOUT_MINUTES
    ? minutes
    : DEFAULT_QUERY_TIMEOUT_MINUTES
}

const getQueryTimeoutMinutes = (): number =>
  normalizeQueryTimeoutMinutes(store.get('queryTimeoutMinutes'))

const normalizeMcpSettings = (value: Partial<McpSettings> | undefined): McpSettings => ({
  enabled: Boolean(value?.enabled),
  allowWrite: Boolean(value?.allowWrite),
  restrictConnections: Boolean(value?.restrictConnections),
  allowedConnectionIds: Array.isArray(value?.allowedConnectionIds)
    ? [
        ...new Set(
          value.allowedConnectionIds.filter(
            (id): id is string => typeof id === 'string' && Boolean(id.trim())
          )
        )
      ]
    : []
})

const getMcpSettings = (): McpSettings => normalizeMcpSettings(store.get('mcpSettings'))

const encryptLocalSyncValue = (value: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全保存同步口令，请检查系统密钥服务')
  }
  return safeStorage.encryptString(value).toString('base64')
}

const decryptLocalSyncValue = (value?: string): string | undefined => {
  if (!value) {
    return undefined
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法读取已保存的同步口令，请重新配置同步')
  }
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

const getSyncLocalState = (): SyncLocalState => {
  const state = store.get('syncState') ?? {}
  const serializedBasePayload = decryptLocalSyncValue(state.encryptedBasePayload)
  return {
    passphrase: decryptLocalSyncValue(state.encryptedPassphrase),
    basePayload: serializedBasePayload ? JSON.parse(serializedBasePayload) : undefined,
    remoteSha: state.remoteSha,
    lastSyncedAt: state.lastSyncedAt,
    autoSyncEnabled: Boolean(state.autoSyncEnabled)
  }
}

const setSyncLocalState = (next: SyncLocalState): SyncLocalState => {
  const current = store.get('syncState') ?? {}
  const stored: StoredSyncState = {
    ...current,
    ...(typeof next.passphrase === 'string'
      ? { encryptedPassphrase: encryptLocalSyncValue(next.passphrase) }
      : {}),
    ...(next.basePayload !== undefined
      ? { encryptedBasePayload: encryptLocalSyncValue(JSON.stringify(next.basePayload)) }
      : {}),
    ...(typeof next.remoteSha === 'string' ? { remoteSha: next.remoteSha } : {}),
    ...(typeof next.lastSyncedAt === 'number' ? { lastSyncedAt: next.lastSyncedAt } : {}),
    ...(typeof next.autoSyncEnabled === 'boolean' ? { autoSyncEnabled: next.autoSyncEnabled } : {})
  }
  store.set('syncState', stored)
  return getSyncLocalState()
}

const getAppSyncSettings = (): AppSyncSettings => ({
  autoCheckUpdates: store.get('autoCheckUpdates') ?? true,
  queryTimeoutMinutes: getQueryTimeoutMinutes(),
  mcpSettings: getMcpSettings(),
  aiConfigs: store.get('aiConfigs') ?? []
})

const applyAppSyncSettings = (settings: Partial<AppSyncSettings>): AppSyncSettings => {
  if (typeof settings.autoCheckUpdates === 'boolean') {
    store.set('autoCheckUpdates', settings.autoCheckUpdates)
  }
  if (typeof settings.queryTimeoutMinutes === 'number') {
    store.set('queryTimeoutMinutes', normalizeQueryTimeoutMinutes(settings.queryTimeoutMinutes))
  }
  if (settings.mcpSettings) {
    const mcpSettings = normalizeMcpSettings(settings.mcpSettings)
    store.set('mcpSettings', {
      ...mcpSettings,
      enabled: mcpSettings.enabled && isOptionalModuleInstalled('mcp')
    })
  }
  if (Array.isArray(settings.aiConfigs)) {
    const enabledId = settings.aiConfigs.find((config) => config.enabled)?.id
    const aiConfigs = settings.aiConfigs.map((config) => ({
      ...config,
      enabled: Boolean(enabledId && config.id === enabledId)
    }))
    store.set('aiConfigs', aiConfigs)
    const activeConfig = aiConfigs.find((config) => config.enabled)
    if (activeConfig) {
      store.set('aiConfig', {
        provider: activeConfig.provider,
        base_url: activeConfig.base_url,
        api_key: activeConfig.api_key,
        model: activeConfig.model,
        max_context_tokens: activeConfig.max_context_tokens
      })
    } else {
      store.delete('aiConfig')
    }
  }
  return getAppSyncSettings()
}

const getInstalledOptionalModules = (): OptionalModuleState[] => {
  const value = store.get('optionalModules')
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (module): module is OptionalModuleState =>
      module &&
      (module.id === 'mcp' ||
        module.id === 'ai' ||
        module.id === 'jdbc-runtime' ||
        module.id === 'jre-17' ||
        module.id === 'data-versioning') &&
      typeof module.version === 'string' &&
      Number.isFinite(module.installedAt) &&
      typeof module.installPath === 'string' &&
      typeof module.entryPoint === 'string'
  )
}

const moduleEntryExists = (module: OptionalModuleState): boolean =>
  Boolean(module.installPath && module.entryPoint && existsSync(join(module.installPath, module.entryPoint)))

const isOptionalModuleInstalled = (moduleId: OptionalModuleId): boolean =>
  getInstalledOptionalModules().some(
    (module) =>
      module.id === (moduleId === 'jdbc' ? 'jdbc-runtime' : moduleId) && moduleEntryExists(module)
  )

const getOptionalModuleInstallPath = (moduleId: OptionalModuleArtifactId): string | undefined =>
  getInstalledOptionalModules().find((module) => module.id === moduleId && moduleEntryExists(module))
    ?.installPath

const getStableOptionalModuleInstallPath = (moduleId: OptionalModuleArtifactId): string =>
  join(app.getPath('userData'), 'modules', moduleId, 'current')

const migrateInstalledOptionalModulePaths = async (): Promise<void> => {
  const installedModules = getInstalledOptionalModules()
  const currentModules = installedModules.filter((module) => moduleEntryExists(module))
  if (currentModules.length !== installedModules.length) {
    store.set('optionalModules', currentModules)
  }
}

const configureBackendOptionalRuntimeModules = (): void => {
  const jdbcRuntimePath = getOptionalModuleInstallPath('jdbc-runtime')
  const jreRuntimePath = getOptionalModuleInstallPath('jre-17')
  const dataVersioningModulePath = getOptionalModuleInstallPath('data-versioning')
  backendManager.setRuntimeEnvironment({
    DATADJINN_JDBC_RUNTIME_PATH: jdbcRuntimePath,
    DATADJINN_JRE_MODULE_HOME: jreRuntimePath ? join(jreRuntimePath, 'jre') : undefined,
    DATADJINN_DATA_VERSIONING_MODULE_PATH: dataVersioningModulePath
  })
}

const restartBackendForRuntimeModule = async (moduleId: OptionalModuleArtifactId): Promise<void> => {
  if (moduleId !== 'jdbc-runtime' && moduleId !== 'jre-17' && moduleId !== 'data-versioning') {
    return
  }
  configureBackendOptionalRuntimeModules()
  if (backendManager.getStatus().state === 'online') {
    const status = await backendManager.restart('JDBC 运行时模块已更新，正在重启后端服务')
    if (status.state !== 'online') {
      throw new Error(status.message ?? '后端服务重启失败')
    }
  }
}

const getOptionalModules = async (): Promise<OptionalModuleInfo[]> => {
  const pendingById = new Map(getPendingOptionalModules().map((item) => [item.id, item] as const))
  const installedById = new Map(
    getInstalledOptionalModules().map((module) => [module.id, module] as const)
  )
  const artifactById = new Map((await getOptionalModuleArtifacts()).map((module) => [module.id, module] as const))
  return OPTIONAL_MODULE_CATALOG.map((module) => {
    const artifactId = module.id === 'jdbc' ? 'jdbc-runtime' : module.id
    const stored = installedById.get(artifactId)
    const artifact = artifactById.get(artifactId)
    const pending = pendingById.get(artifactId)
    const isTestAiModule =
      module.id === 'ai' &&
      Boolean(testUserDataDir) &&
      process.env.DATADJINN_TEST_ENABLE_AI_MODULE === '1'
    const installed = stored && moduleEntryExists(stored) ? stored : undefined
    return {
      ...module,
      installed: Boolean(installed) || isTestAiModule,
      installedAt: installed?.installedAt,
      installedVersion: installed?.version,
      pendingVersion: pending?.version,
      pendingRestartRequired: Boolean(pending),
      version: artifact?.version ?? module.version,
      updateAvailable: Boolean(
        installed && artifact && !pending && compareVersion(artifact.version, installed.version) > 0
      )
    }
  })
}

const getOptionalModuleLaunchConfig = (
  moduleId: OptionalModuleId
): { command: string; args: string[] } | null => {
  if (moduleId === 'jdbc') {
    return null
  }
  const module = getInstalledOptionalModules().find(
    (item) => item.id === moduleId && moduleEntryExists(item)
  )
  if (!module?.installPath || !module.entryPoint) {
    return null
  }
  return { command: join(module.installPath, module.entryPoint), args: [] }
}

const expandModuleArchive = async (archivePath: string, targetPath: string): Promise<void> => {
  const command = process.platform === 'win32' ? 'tar.exe' : 'tar'
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, ['-xf', archivePath, '-C', targetPath], {
      windowsHide: true
    })
    let error = ''
    child.stderr.on('data', (chunk) => {
      error += String(chunk)
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(error.trim() || '解压扩展模块失败'))
    )
  })
}

const downloadOptionalModuleArchive = async (
  module: OptionalModuleArtifact
): Promise<Buffer> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_OPTIONAL_MODULE_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(module.artifact.url, { headers: githubHeaders })
      if (!response.ok) {
        throw new Error(`下载扩展模块失败：HTTP ${response.status}`)
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < MAX_OPTIONAL_MODULE_DOWNLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载扩展模块失败')
}

const replaceOptionalModuleInstall = async (
  temporaryPath: string,
  installPath: string
): Promise<void> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_OPTIONAL_MODULE_REPLACE_ATTEMPTS; attempt += 1) {
    try {
      const backupPath = `${installPath}.old-${randomBytes(6).toString('hex')}`
      if (existsSync(installPath)) {
        // Rename the complete directory first. This keeps the stable current
        // path and never deletes a locked executable before replacement.
        await rename(installPath, backupPath)
      }
      await rename(temporaryPath, installPath)
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
      return
    } catch (error) {
      lastError = error
      if (attempt < MAX_OPTIONAL_MODULE_REPLACE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250))
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(`替换扩展模块文件失败，请关闭占用该模块的程序后重试：${detail}`)
}

const getPendingOptionalModules = (): PendingOptionalModuleState[] => {
  const value = store.get('pendingOptionalModules')
  return Array.isArray(value)
    ? value.filter(
        (item): item is PendingOptionalModuleState =>
          item &&
          (item.id === 'mcp' ||
            item.id === 'ai' ||
            item.id === 'jdbc-runtime' ||
            item.id === 'jre-17' ||
            item.id === 'data-versioning') &&
          typeof item.version === 'string' &&
          typeof item.temporaryPath === 'string' &&
          typeof item.entryPoint === 'string'
      )
    : []
}

const setPendingOptionalModules = (pending: PendingOptionalModuleState[]): void => {
  if (pending.length > 0) {
    store.set('pendingOptionalModules', pending)
  } else {
    store.delete('pendingOptionalModules')
  }
}

const retryPendingOptionalModuleInstall = async (pending: PendingOptionalModuleState): Promise<void> => {
  if (!existsSync(pending.temporaryPath)) {
    setPendingOptionalModules(getPendingOptionalModules().filter((item) => item.id !== pending.id))
    return
  }
  try {
    await replaceOptionalModuleInstall(pending.temporaryPath, getStableOptionalModuleInstallPath(pending.id))
    const installedModules = getInstalledOptionalModules().filter((item) => item.id !== pending.id)
    installedModules.push({
      id: pending.id,
      version: pending.version,
      installedAt: Date.now(),
      installPath: getStableOptionalModuleInstallPath(pending.id),
      entryPoint: pending.entryPoint
    })
    store.set('optionalModules', installedModules)
    setPendingOptionalModules(getPendingOptionalModules().filter((item) => item.id !== pending.id))
  } catch {
    setTimeout(() => void retryPendingOptionalModuleInstall(pending), 2_000)
  }
}

const retryPendingOptionalModuleInstalls = async (): Promise<void> => {
  for (const pending of getPendingOptionalModules()) {
    void retryPendingOptionalModuleInstall(pending)
  }
}

const installOptionalModuleArtifact = async (
  moduleId: OptionalModuleArtifactId,
  restartBackend = true
): Promise<void> => {
  const module = (await getOptionalModuleArtifacts()).find((item) => item.id === moduleId)
  if (!module) {
    throw new Error('未知扩展模块')
  }
  if (moduleId === 'ai') {
    await aiModuleManager.stop()
  }
  const installed = getInstalledOptionalModules().find(
    (item) => item.id === moduleId && item.version === module.version && moduleEntryExists(item)
  )
  if (installed) {
    return
  }
  const archive = await downloadOptionalModuleArchive(module)
  const hash = createHash('sha256').update(archive).digest('hex')
  if (hash !== module.artifact.sha256) {
    throw new Error('扩展模块校验失败，下载文件已拒绝安装')
  }

  const moduleRoot = join(app.getPath('userData'), 'modules', moduleId)
  const installPath = getStableOptionalModuleInstallPath(moduleId)
  const temporaryPath = join(moduleRoot, `.install-${randomBytes(8).toString('hex')}`)
  const archivePath = join(app.getPath('temp'), `datadjinn-${moduleId}-${randomBytes(8).toString('hex')}.zip`)
  let preserveTemporaryPath = false
  try {
    await mkdir(moduleRoot, { recursive: true })
    await writeFile(archivePath, archive)
    await mkdir(temporaryPath, { recursive: true })
    await expandModuleArchive(archivePath, temporaryPath)
    const manifest = JSON.parse(await readFile(join(temporaryPath, 'module.json'), 'utf-8')) as {
      id?: string
      version?: string
      minAppVersion?: string
      entryPoint?: string
    }
    if (
      manifest.id !== moduleId ||
      manifest.version !== module.version ||
      typeof manifest.entryPoint !== 'string' ||
      !manifest.entryPoint ||
      !existsSync(join(temporaryPath, manifest.entryPoint)) ||
      (typeof manifest.minAppVersion === 'string' && compareVersion(app.getVersion(), manifest.minAppVersion) < 0)
    ) {
      throw new Error('扩展模块内容或版本不兼容，已拒绝安装')
    }
    try {
      await replaceOptionalModuleInstall(temporaryPath, installPath)
    } catch (error) {
      if (moduleId !== 'mcp') {
        throw error
      }
      const pendingPath = join(moduleRoot, `.pending-${module.version}-${randomBytes(8).toString('hex')}`)
      await rename(temporaryPath, pendingPath)
      preserveTemporaryPath = true
      const pending = getPendingOptionalModules().filter((item) => item.id !== moduleId)
      pending.push({
        id: moduleId,
        version: module.version,
        temporaryPath: pendingPath,
        entryPoint: manifest.entryPoint
      })
      setPendingOptionalModules(pending)
      void retryPendingOptionalModuleInstall(pending[pending.length - 1])
      return
    }
    const installedModules = getInstalledOptionalModules().filter((item) => item.id !== moduleId)
    installedModules.push({
      id: moduleId,
      version: module.version,
      installedAt: Date.now(),
      installPath,
      entryPoint: manifest.entryPoint
    })
    store.set('optionalModules', installedModules)
    if (restartBackend) {
      await restartBackendForRuntimeModule(moduleId)
    }
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined)
    if (!preserveTemporaryPath) {
      await rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

type DetectedJavaRuntime = {
  home: string
  major: number
}

const parseJavaMajor = (version: string): number | undefined => {
  const matched = version.match(/(?:JAVA_VERSION|java\.version)\s*=\s*["']?([^"'\r\n]+)/i)
  if (!matched) {
    return undefined
  }
  const parts = matched[1].trim().split(/[._\-+]/)
  if (!parts[0] || !/^\d+$/.test(parts[0])) {
    return undefined
  }
  if (parts[0] === '1' && parts[1] && /^\d+$/.test(parts[1])) {
    return Number.parseInt(parts[1], 10)
  }
  return Number.parseInt(parts[0], 10)
}

const is64BitJvm = async (jvmPath: string): Promise<boolean> => {
  try {
    const header = await readFile(jvmPath)
    const peOffset = header.readUInt32LE(0x3c)
    return header.subarray(peOffset, peOffset + 4).toString('ascii') === 'PE\u0000\u0000' &&
      header.readUInt16LE(peOffset + 4) === 0x8664
  } catch {
    return false
  }
}

const findJavaExecutablesOnPath = async (): Promise<string[]> =>
  await new Promise((resolvePromise) => {
    const process = spawn('where.exe', ['java.exe'], { windowsHide: true })
    let output = ''
    process.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    process.once('error', () => resolvePromise([]))
    process.once('exit', (code) =>
      resolvePromise(
        code === 0
          ? output
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean)
          : []
      )
    )
  })

const getConfiguredJdbcJavaHome = async (): Promise<string | undefined> => {
  try {
    const content = await readFile(join(app.getPath('userData'), 'jdbc_runtime.json'), 'utf-8')
    const config = JSON.parse(content) as { enabled?: boolean; java_home?: string | null }
    return config.enabled && config.java_home ? config.java_home : undefined
  } catch {
    return undefined
  }
}

const getKnownJavaHomes = async (): Promise<string[]> => {
  const homes = [await getConfiguredJdbcJavaHome(), process.env.JAVA_HOME]
  const executables = await findJavaExecutablesOnPath()
  homes.push(...executables.map((executable) => resolve(executable, '..', '..')))
  for (const root of [
    'C:/Program Files/Java',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files/Microsoft',
    'C:/Program Files/Zulu',
    'C:/Program Files/BellSoft'
  ]) {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      homes.push(...entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name)))
    } catch {
      // An absent vendor directory simply means no Java installation was found there.
    }
  }
  return [...new Set(homes.filter((home): home is string => Boolean(home?.trim())))]
}

const detectUsableLocalJavaRuntime = async (): Promise<DetectedJavaRuntime | undefined> => {
  for (const home of await getKnownJavaHomes()) {
    const normalizedHome = resolve(home)
    const jvmPath = [
      join(normalizedHome, 'bin', 'server', 'jvm.dll'),
      join(normalizedHome, 'jre', 'bin', 'server', 'jvm.dll')
    ].find(existsSync)
    if (!jvmPath || !(await is64BitJvm(jvmPath))) {
      continue
    }
    try {
      const release = await readFile(join(normalizedHome, 'release'), 'utf-8')
      const major = parseJavaMajor(release)
      if (major && major >= 8) {
        return { home: normalizedHome, major }
      }
    } catch {
      // A runtime without a release file cannot be version-validated for automatic use.
    }
  }
  return undefined
}

const installOptionalModule = async (moduleId: OptionalModuleId): Promise<OptionalModuleInfo[]> => {
  if (moduleId === 'jdbc') {
    const localJava = await detectUsableLocalJavaRuntime()
    await installOptionalModuleArtifact('jdbc-runtime', false)
    if (!localJava && !getOptionalModuleInstallPath('jre-17')) {
      await installOptionalModuleArtifact('jre-17', false)
    }
    await restartBackendForRuntimeModule('jdbc-runtime')
    return await getOptionalModules()
  }
  await installOptionalModuleArtifact(moduleId)
  return await getOptionalModules()
}

const uninstallOptionalModuleArtifact = async (moduleId: OptionalModuleArtifactId): Promise<void> => {
  const removed = getInstalledOptionalModules().find((module) => module.id === moduleId)
  store.set('optionalModules', getInstalledOptionalModules().filter((module) => module.id !== moduleId))
  if (removed?.installPath) {
    await rm(removed.installPath, { recursive: true, force: true })
  }
}

const uninstallOptionalModule = async (moduleId: OptionalModuleId): Promise<OptionalModuleInfo[]> => {
  if (moduleId === 'mcp') {
    store.set('mcpSettings', { ...getMcpSettings(), enabled: false })
  }
  if (moduleId === 'ai') {
    await aiModuleManager.stop()
  }
  if (moduleId === 'jdbc') {
    await uninstallOptionalModuleArtifact('jdbc-runtime')
    await uninstallOptionalModuleArtifact('jre-17')
    await restartBackendForRuntimeModule('jdbc-runtime')
    return await getOptionalModules()
  }
  await uninstallOptionalModuleArtifact(moduleId)
  await restartBackendForRuntimeModule(moduleId)
  return await getOptionalModules()
}

const backendRequestHeaders = (): Record<string, string> => ({
  ...backendManager.getRequestHeaders(),
  'X-DataDjinn-Query-Timeout-Seconds': String(getQueryTimeoutMinutes() * 60)
})

const isAiApiPath = (path: string): boolean => ensureApiPath(path).startsWith('/ai/')

const ensureAiModuleForRequest = async (): Promise<string> => {
  if (
    testUserDataDir &&
    process.env.DATADJINN_TEST_ENABLE_AI_MODULE === '1' &&
    process.env.DATADJINN_TEST_AI_STREAM_EVENTS
  ) {
    return 'http://127.0.0.1:0/api'
  }
  const launchConfig = getOptionalModuleLaunchConfig('ai')
  if (!launchConfig) {
    throw new Error('AI 助手模块未安装。请先在“设置 -> 扩展”中安装 AI 助手模块。')
  }
  return aiModuleManager.ensureOnline(launchConfig)
}

const aiModuleRequestHeaders = (): Record<string, string> => aiModuleManager.getRequestHeaders()

const authorizeTextFilePath = (filePath: string): string => {
  const normalizedPath = resolve(filePath)
  approvedTextFilePaths.add(normalizedPath)
  return normalizedPath
}

const requireAuthorizedTextFilePath = (filePath: string): string => {
  const normalizedPath = resolve(filePath)
  if (!approvedTextFilePaths.has(normalizedPath) && !process.env.DATADJINN_TEST_USER_DATA_DIR) {
    throw new Error('文件未通过当前操作的选择授权')
  }
  return normalizedPath
}

const ensureMainRenderer = (sender: Electron.WebContents): void => {
  if (!mainWindowRef || mainWindowRef.isDestroyed() || sender !== mainWindowRef.webContents) {
    throw new Error('拒绝来自未知窗口的请求')
  }
}

const ensureApiPath = (path: string): string => {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('无效的后端 API 路径')
  }
  return path
}

const sendTestAIStream = (
  sender: Electron.WebContents | undefined,
  streamId: string,
  path: string
): boolean => {
  const rawEvents = process.env.DATADJINN_TEST_AI_STREAM_EVENTS
  if (!testUserDataDir || !rawEvents || path !== '/ai/chat/stream') {
    return false
  }

  const events = JSON.parse(rawEvents) as unknown
  if (!Array.isArray(events)) {
    throw new Error('DATADJINN_TEST_AI_STREAM_EVENTS 必须是事件数组')
  }
  sender?.send(
    'api:stream-chunk',
    streamId,
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  )
  return true
}

const openSafeExternalUrl = async (rawUrl: string): Promise<void> => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('仅允许打开 HTTP 或 HTTPS 链接')
  }
  await shell.openExternal(url.toString())
}

const compareVersion = (left: string, right: string): number => {
  const leftParts = normalizeVersion(left)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = normalizeVersion(right)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
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

const getOptionalModuleArtifacts = async (): Promise<readonly OptionalModuleArtifact[]> => {
  if (optionalModuleCatalogCache && optionalModuleCatalogCache.expiresAt > Date.now()) {
    return optionalModuleCatalogCache.artifacts
  }

  const fallback = [...OPTIONAL_MODULE_ARTIFACT_CATALOG]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(OPTIONAL_MODULE_CATALOG_URL, {
      headers: githubHeaders,
      signal: controller.signal,
      cache: 'no-store'
    })
    if (!response.ok) {
      throw new Error(`扩展目录请求失败：HTTP ${response.status}`)
    }
    const payload = (await response.json()) as RemoteOptionalModuleCatalog
    const remoteById = new Map<OptionalModuleArtifactId, OptionalModuleArtifact>()
    for (const item of payload.modules ?? []) {
      if (
        (item.id === 'mcp' || item.id === 'ai' || item.id === 'jdbc-runtime' || item.id === 'jre-17' || item.id === 'data-versioning') &&
        typeof item.version === 'string' &&
        typeof item.url === 'string' &&
        /^https:\/\/github\.com\/vhukze\/DataDjinn\/releases\/download\//.test(item.url) &&
        typeof item.sha256 === 'string' &&
        /^[a-f0-9]{64}$/i.test(item.sha256)
      ) {
        remoteById.set(item.id, {
          id: item.id,
          version: item.version,
          artifact: { url: item.url, sha256: item.sha256.toLowerCase() }
        })
      }
    }
    const artifacts = fallback.map((local) => {
      const remote = remoteById.get(local.id)
      return remote && compareVersion(remote.version, local.version) >= 0 ? remote : local
    })
    optionalModuleCatalogCache = { artifacts, expiresAt: Date.now() + OPTIONAL_MODULE_CATALOG_CACHE_MS }
    return artifacts
  } catch {
    optionalModuleCatalogCache = { artifacts: fallback, expiresAt: Date.now() + 30_000 }
    return fallback
  } finally {
    clearTimeout(timeout)
  }
}

const fetchLatestRelease = async (): Promise<GitHubRelease> => {
  const response = await fetch(GITHUB_RELEASES_ATOM_URL, { headers: githubHeaders, cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`检查更新失败：HTTP ${response.status}`)
  }

  const feed = await response.text()
  const tags = Array.from(
    feed.matchAll(/\/releases\/tag\/(v\d+(?:\.\d+){2,3}(?:[-+][^"<\s]*)?)/gi),
    (match) => match[1]
  )
  const tagName = tags.find((tag) => /^v\d+(?:\.\d+){2,3}(?:[-+].*)?$/i.test(tag))
  if (!tagName) {
    throw new Error('检查更新失败：没有找到主程序正式版本发布')
  }
  const version = normalizeVersion(tagName)
  return {
    tag_name: tagName,
    name: `DataDjinn ${tagName}`,
    html_url: `${GITHUB_PROJECT_URL}/releases/tag/${tagName}`,
    assets: [
      {
        name: `DataDjinn-${version}-setup.exe`,
        browser_download_url: `${GITHUB_RELEASE_DOWNLOAD_URL}/${tagName}/DataDjinn-${version}-setup.exe`
      },
      {
        name: `DataDjinn-${version}-win.zip`,
        browser_download_url: `${GITHUB_RELEASE_DOWNLOAD_URL}/${tagName}/DataDjinn-${version}-win.zip`
      }
    ]
  }
}

const configureInstallerUpdateFeed = (release: GitHubRelease): void => {
  autoUpdater.setFeedURL(`${GITHUB_RELEASE_DOWNLOAD_URL}/${encodeURIComponent(release.tag_name)}`)
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

const checkForUpdatesInBackground = async (): Promise<void> => {
  if (backgroundUpdateCheckRunning || !(store.get('autoCheckUpdates') ?? true)) {
    return
  }

  backgroundUpdateCheckRunning = true
  try {
    if (appUpdateMode === 'portable') {
      const updateInfo = await checkPortableUpdate()
      if (
        updateInfo.available &&
        normalizeVersion(updateInfo.latestVersion ?? '') !== store.get('skippedUpdateVersion')
      ) {
        sendUpdateEvent('update:available', updateInfo)
      }
      return
    }

    const release = await fetchLatestRelease()
    configureInstallerUpdateFeed(release)
    await autoUpdater.checkForUpdates()
  } catch {
    // 后台轮询不打断用户操作；手动检查仍会把错误返回给界面。
  } finally {
    backgroundUpdateCheckRunning = false
  }
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
  return /fetch failed|ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|socket hang up|\bterminated\b/i.test(
    message
  )
}

const isRequestAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError'

const canRetryTransientApiRequest = (path: string, method?: string): boolean => {
  const normalizedMethod = (method ?? 'GET').toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) {
    return true
  }

  // The renderer uses one stable attempt id while opening a connection. Replaying
  // that request after a lost local response is safe, unlike generic POST calls.
  if (
    normalizedMethod !== 'POST' ||
    !/^\/connections\/[^/?]+\/open(?:\?.*)?$/.test(path)
  ) {
    return false
  }

  return new URLSearchParams(path.split('?')[1] ?? '').has('open_attempt_id')
}

const waitForTransientApiRetry = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 80))
}

const ensureBackendForRequest = async (): Promise<string> => {
  const backendStatus = await backendManager.ensureOnline()

  if (!backendStatus.apiBaseUrl) {
    throw new Error(backendStatus.message ?? '后端服务未就绪')
  }

  return backendStatus.apiBaseUrl
}

const recoverBackendAfterRequestError = async (error: unknown): Promise<void> => {
  if (isBackendNetworkError(error)) {
    await backendManager.recoverIfUnhealthy('检测到后端连接中断，正在自动重启')
  }
}

const downloadPortableUpdate = async (): Promise<{ filePath: string }> => {
  const updateInfo = latestPortableUpdate ?? (await checkPortableUpdate())

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
  const windowWidth = testUserDataDir ? 1440 : Math.max(1180, Math.floor(width * 0.7))
  const windowHeight = testUserDataDir ? testWindowHeight : Math.max(760, Math.floor(height * 0.7))

  const mainWindow = new BrowserWindow({
    width: testUserDataDir ? windowWidth : Math.min(windowWidth, width),
    height: testUserDataDir ? windowHeight : Math.min(windowHeight, height),
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
    void openSafeExternalUrl(details.url).catch(() => undefined)
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
    hasShadow: false,
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

  const appResourcesDir = is.dev ? process.cwd() : app.getAppPath()
  const splashLogoCandidates = [
    join(appResourcesDir, 'resources', 'logo-horizontal.svg'),
    join(process.resourcesPath, 'logo-horizontal.svg')
  ]
  const fallbackLogoCandidates = [
    join(appResourcesDir, 'resources', 'icon.svg'),
    join(process.resourcesPath, 'icon.svg')
  ]
  const splashLogoMarkup = (() => {
    const candidate = [...splashLogoCandidates, ...fallbackLogoCandidates].find((item) =>
      existsSync(item)
    )
    try {
      if (!candidate) {
        throw new Error('splash logo not found')
      }
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
          position: relative;
          box-sizing: border-box;
          width: calc(100% - 24px);
          padding: 34px 34px 28px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          overflow: hidden;
          border-radius: 28px;
          background:
            radial-gradient(circle at top right, rgba(80, 163, 255, 0.16), transparent 32%),
            linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94));
          border: 0;
          animation: splashCardFloat 6.8s ease-in-out infinite;
        }
        .card::before {
          content: "";
          position: absolute;
          inset: auto -90px -120px auto;
          width: 240px;
          height: 240px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.16), transparent 68%);
          pointer-events: none;
          animation: splashGlowPulse 7.4s ease-in-out infinite;
        }
        .eyebrow {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          color: #5b6b7c;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.62);
        }
        .logo {
          position: relative;
          z-index: 1;
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
        .headline {
          position: relative;
          z-index: 1;
          color: #111827;
          font-size: 24px;
          font-weight: 800;
          line-height: 1.18;
          letter-spacing: -0.03em;
          text-align: center;
        }
        .subline {
          position: relative;
          z-index: 1;
          max-width: 320px;
          color: #5f6f81;
          font-size: 13px;
          line-height: 1.7;
          text-align: center;
        }
        .status {
          position: relative;
          z-index: 1;
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
        @keyframes splashCardFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes splashGlowPulse {
          0%, 100% { opacity: 0.6; transform: scale(0.94); }
          50% { opacity: 1; transform: scale(1.06); }
        }
        @media (prefers-color-scheme: dark) {
          .card {
            background:
              radial-gradient(circle at top right, rgba(80, 163, 255, 0.18), transparent 34%),
              linear-gradient(180deg, rgba(42,46,54,0.96), rgba(31,35,41,0.96));
          }
          .eyebrow {
            color: #c8d0da;
            border-color: rgba(210, 218, 230, 0.14);
            background: rgba(255,255,255,0.03);
          }
          .headline {
            color: #f3f5f7;
          }
          .subline {
            color: #b5bec8;
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
    if (
      splashDismissed ||
      (mainWindowRef && !mainWindowRef.isDestroyed() && mainWindowRef.isVisible())
    ) {
      splashWindow.destroy()
      return
    }
    splashWindow.show()
  })
}

async function finishStartupAndShowMainWindow(): Promise<void> {
  try {
    const startupStatus = await backendManager.start()
    if (startupStatus.state !== 'online') {
      rendererStartupReady = true
      showMainWindowForStartupFailure()
      return
    }
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
app.whenReady().then(async () => {
  // Set app user model id for windows
  app.setName('DataDjinn')
  electronApp.setAppUserModelId('com.datadjinn.app')
  await migrateInstalledOptionalModulePaths()
  await retryPendingOptionalModuleInstalls()
  configureBackendOptionalRuntimeModules()

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

  ipcMain.handle('select-sqlite-file', async (event) => {
    const window =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      mainWindowRef

    if (!window) {
      return null
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择 SQLite 数据库文件',
      filters: [
        { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
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

  ipcMain.handle(
    'select-connection-transfer-import-file',
    async (_event, source?: 'datadjinn' | 'dbeaver') => {
      const window = BrowserWindow.getFocusedWindow()

      if (!window) {
        return null
      }

      const dialogOptions = buildConnectionTransferImportDialogOptions(source)

      const result = await dialog.showOpenDialog(window, {
        title: dialogOptions.title,
        filters: dialogOptions.filters,
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return authorizeTextFilePath(result.filePaths[0])
    }
  )

  ipcMain.handle('select-export-path', async (_event, format: string, defaultName?: string) => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const filters: Electron.FileFilter[] =
      format === 'csv'
        ? [{ name: 'CSV 文件', extensions: ['csv'] }]
        : format === 'json'
          ? [{ name: 'JSON 文件', extensions: ['json'] }]
          : format === 'markdown'
            ? [{ name: 'Markdown 文件', extensions: ['md'] }]
            : [{ name: 'SQL 文件', extensions: ['sql'] }]

    const result = await dialog.showSaveDialog(window, {
      title: '选择导出位置',
      defaultPath: defaultName,
      filters: [...filters, { name: '所有文件', extensions: ['*'] }]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return authorizeTextFilePath(result.filePath)
  })

  ipcMain.handle('select-connection-transfer-export-path', async (_event, defaultName?: string) => {
    const window = BrowserWindow.getFocusedWindow()

    if (!window) {
      return null
    }

    const result = await dialog.showSaveDialog(window, {
      title: '选择连接导出位置',
      defaultPath: defaultName,
      filters: [
        { name: 'DataDjinn 连接文件', extensions: ['ddj'] },
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return authorizeTextFilePath(result.filePath)
  })

  ipcMain.handle('read-text-file', async (event, filePath: string) => {
    ensureMainRenderer(event.sender)
    return readFile(requireAuthorizedTextFilePath(filePath), 'utf-8')
  })

  ipcMain.handle('write-text-file', async (event, filePath: string, content: string) => {
    ensureMainRenderer(event.sender)
    await writeFile(requireAuthorizedTextFilePath(filePath), content, 'utf-8')
    return true
  })

  ipcMain.handle('window:minimize', (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  )
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
  ipcMain.handle('app:get-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    projectUrl: GITHUB_PROJECT_URL
  }))
  ipcMain.handle('app:open-project-home', async () => {
    await openSafeExternalUrl(GITHUB_PROJECT_URL)
  })
  ipcMain.handle('app:open-external-url', async (_, rawUrl: string) => {
    await openSafeExternalUrl(rawUrl)
  })
  ipcMain.on('app:renderer-ready', () => {
    rendererStartupReady = true
    showMainWindowIfReady()
  })
  ipcMain.handle('backend:get-status', () => backendManager.getStatus())
  ipcMain.handle('backend:restart', () => backendManager.restart())
  ipcMain.handle('query-settings:get', () => ({ timeoutMinutes: getQueryTimeoutMinutes() }))
  ipcMain.handle('query-settings:set', (_, timeoutMinutes: number) => {
    const nextTimeoutMinutes = normalizeQueryTimeoutMinutes(timeoutMinutes)
    store.set('queryTimeoutMinutes', nextTimeoutMinutes)
    return { timeoutMinutes: nextTimeoutMinutes }
  })
  ipcMain.handle('mcp-settings:get', () => getMcpSettings())
  ipcMain.handle('mcp-settings:set', (_, settings: Partial<McpSettings>) => {
    const nextSettings = normalizeMcpSettings(settings)
    if (nextSettings.enabled && !isOptionalModuleInstalled('mcp')) {
      throw new Error('请先在“设置 -> 扩展”中安装本机 MCP 服务模块')
    }
    store.set('mcpSettings', nextSettings)
    return nextSettings
  })
  ipcMain.handle('sync-local-state:get', () => getSyncLocalState())
  ipcMain.handle('sync-local-state:set', (_, state: SyncLocalState) => setSyncLocalState(state))
  ipcMain.handle('sync-local-state:clear', () => {
    store.delete('syncState')
  })
  ipcMain.handle('connection-tree-preferences:get', () => store.get('connectionTreePreferences') ?? {})
  ipcMain.handle('connection-tree-preferences:set', (_, preferences: unknown, updatedAt: unknown) => {
    const nextPreferences =
      preferences && typeof preferences === 'object' && !Array.isArray(preferences)
        ? (preferences as Record<string, unknown>)
        : {}
    const nextUpdatedAt = Number(updatedAt)
    const currentUpdatedAt = Number(store.get('connectionTreePreferencesUpdatedAt') ?? 0)
    if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt < currentUpdatedAt) {
      return store.get('connectionTreePreferences') ?? {}
    }
    store.set('connectionTreePreferences', nextPreferences)
    store.set('connectionTreePreferencesUpdatedAt', Number.isFinite(nextUpdatedAt) ? nextUpdatedAt : Date.now())
    return nextPreferences
  })
  ipcMain.handle('sync-app-settings:get', () => getAppSyncSettings())
  ipcMain.handle('sync-app-settings:apply', (_, settings: Partial<AppSyncSettings>) =>
    applyAppSyncSettings(settings)
  )
  ipcMain.handle('optional-modules:list', () => getOptionalModules())
  ipcMain.handle('optional-modules:install', (_, moduleId: OptionalModuleId) => installOptionalModule(moduleId))
  ipcMain.handle('optional-modules:uninstall', (_, moduleId: OptionalModuleId) => uninstallOptionalModule(moduleId))
  ipcMain.handle('optional-modules:launch-config', (_, moduleId: OptionalModuleId) =>
    getOptionalModuleLaunchConfig(moduleId)
  )
  ipcMain.handle('ai-config:get', () => store.get('aiConfig') ?? null)
  ipcMain.handle('ai-config:set', (_, config: AIConfig) => {
    store.set('aiConfig', config)
    return config
  })
  ipcMain.handle('ai-configs:get', () => store.get('aiConfigs') ?? [])
  ipcMain.handle('ai-configs:set', (_, configs: AIConfigItem[]) => {
    const enabledId = configs.find((config) => config.enabled)?.id
    const nextConfigs = configs.map((config) => ({
      ...config,
      enabled: Boolean(enabledId && config.id === enabledId)
    }))
    store.set('aiConfigs', nextConfigs)
    const activeConfig = nextConfigs.find((config) => config.enabled)
    if (activeConfig) {
      store.set('aiConfig', {
        provider: activeConfig.provider,
        base_url: activeConfig.base_url,
        api_key: activeConfig.api_key,
        model: activeConfig.model,
        max_context_tokens: activeConfig.max_context_tokens
      })
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
  ipcMain.handle(
    'api:stream',
    async (
      event,
      streamId: string,
      path: string,
      options?: { method?: string; headers?: Record<string, string>; body?: string }
    ) => {
      const sender = webContents.fromId(event.sender.id)
      const controller = new AbortController()
      streamControllers.set(streamId, controller)

      try {
        if (sendTestAIStream(sender, streamId, path)) {
          return
        }
        const apiPath = ensureApiPath(path)
        const useAiModule = isAiApiPath(apiPath)
        const apiBaseUrl = useAiModule
          ? await ensureAiModuleForRequest()
          : await ensureBackendForRequest()
        const response = await fetch(`${apiBaseUrl}${ensureApiPath(path)}`, {
          method: options?.method,
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
            ...(useAiModule ? aiModuleRequestHeaders() : backendRequestHeaders())
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
        const tail = decoder.decode()
        if (tail) {
          sender?.send('api:stream-chunk', streamId, tail)
        }
      } catch (error) {
        if (controller.signal.aborted || isRequestAbortError(error)) {
          return
        }
        if (isAiApiPath(path)) {
          void aiModuleManager.recover()
        } else {
          void recoverBackendAfterRequestError(error)
        }
        throw error
      } finally {
        streamControllers.delete(streamId)
        sender?.send('api:stream-end', streamId)
      }
    }
  )

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
      sendUpdateEvent(
        updateInfo.available ? 'update:available' : 'update:not-available',
        updateInfo
      )
      return updateInfo
    }

    const release = await fetchLatestRelease()
    configureInstallerUpdateFeed(release)
    const result = await autoUpdater.checkForUpdates()
    const nextInfo = {
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo.version,
      available: result ? compareVersion(result.updateInfo.version, app.getVersion()) > 0 : false,
      mode: 'installer',
      releaseName: result?.updateInfo.releaseName ?? undefined,
      releaseNotes:
        typeof result?.updateInfo.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
      releaseUrl: result?.updateInfo.version
        ? `https://github.com/vhukze/DataDjinn/releases/tag/v${result.updateInfo.version}`
        : undefined,
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
    await openSafeExternalUrl(url || 'https://github.com/vhukze/DataDjinn/releases')
  })

  ipcMain.handle(
    'api:request',
    async (
      _,
      path: string,
      options?: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
      }
    ) => {
      try {
        const routineRequest = path.match(/^\/connections\/[^/]+\/objects(?:\?.*)?$/)
        if (
          testRoutineNames.length > 0 &&
          routineRequest &&
          new URLSearchParams(path.split('?')[1] ?? '').get('type') === 'procedure'
        ) {
          return {
            objects: testRoutineNames.map((name) => ({ name, type: 'procedure' }))
          }
        }
        const apiPath = ensureApiPath(path)
        const useAiModule = isAiApiPath(apiPath)
        const apiBaseUrl = useAiModule
          ? await ensureAiModuleForRequest()
          : await ensureBackendForRequest()
        const timeoutMs = Number(options?.timeoutMs)
        const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
        const controller = hasTimeout ? new AbortController() : undefined
        const timeoutId = hasTimeout
          ? setTimeout(() => controller?.abort(), timeoutMs)
          : undefined
        const request = async (): Promise<Response> =>
          await fetch(`${apiBaseUrl}${ensureApiPath(path)}`, {
            method: options?.method,
            headers: {
              'Content-Type': 'application/json',
              ...options?.headers,
            ...(useAiModule ? aiModuleRequestHeaders() : backendRequestHeaders())
            },
            body: options?.body,
            signal: controller?.signal
          })
        let response: Response

        try {
          response = await request()
        } catch (error) {
          if (controller?.signal.aborted) {
            throw new Error(`请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`)
          }
          if (!isBackendNetworkError(error) || !canRetryTransientApiRequest(path, options?.method)) {
            throw error
          }
          console.warn('[api] Local request failed after reaching the backend, retrying once', {
            method: options?.method ?? 'GET',
            path,
            error: error instanceof Error ? error.message : String(error)
          })
          await waitForTransientApiRetry()
          response = await request()
        } finally {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId)
          }
        }

        const text = await response.text()
        let data: { detail?: string; error_code?: string } | null = null

        try {
          data = text ? (JSON.parse(text) as { detail?: string }) : null
        } catch {
          data = null
        }

        if (!response.ok) {
          return {
            __datadjinnApiError: data?.detail ?? (text || `HTTP ${response.status}`),
            __datadjinnApiErrorCode: data?.error_code
          }
        }

        return data
      } catch (error) {
        if (isAiApiPath(path)) {
          await aiModuleManager.recover()
        } else {
          await recoverBackendAfterRequestError(error)
        }
        throw error
      }
    }
  )

  if (!skipSplashWindow) {
    createSplashWindow()
  }
  backendStartupCompleted = false
  rendererStartupReady = false
  createWindow()
  void finishStartupAndShowMainWindow()

  if (!is.dev) {
    setTimeout(() => void checkForUpdatesInBackground(), 3000)
    setInterval(() => void checkForUpdatesInBackground(), 60 * 60 * 1000)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (isQuittingForUpdate) {
    return
  }

  event.preventDefault()
  void Promise.all([backendManager.stop(), aiModuleManager.stop()]).finally(() => app.exit(0))
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
