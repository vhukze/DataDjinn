import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  GithubOutlined,
  MessageOutlined,
  EditOutlined,
  DeleteOutlined,
  AimOutlined,
  AppstoreOutlined,
  FolderAddOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  LinkOutlined,
  ImportOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PushpinOutlined,
  SaveOutlined,
  CloudDownloadOutlined,
  CloudSyncOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  HistoryOutlined,
  SunOutlined,
  SettingOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import {
  Alert,
  AutoComplete,
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  theme as antdTheme,
  Typography,
  message
} from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import type { InputRef, MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { flushSync } from 'react-dom'
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense
} from 'react'
import { useTheme } from './context/ThemeContext'
import type {
  SqlCompletionColumn,
  SqlCompletionContext,
  SqlCompletionRoutine,
  SqlCompletionTable,
  SqlDialect,
  SqlEditorHandle
} from './components/SqlEditor'
import { splitSqlStatements } from './components/SqlEditor'
import AIDockPanelHost from './app/ai-dock-panel-host'
import AISettingsPanel from './app/ai-settings-panel'
import { DEFAULT_MCP_SETTINGS } from './app/app-model'
import type {
  AppInfo,
  BackendStatus,
  GitHubAuthStatus,
  GitHubDeviceAuthorization,
  GitHubDeviceAuthorizationPoll,
  McpSettings,
  OptionalModuleInfo,
  OptionalModuleLaunchConfig,
  QuerySettings,
  SettingsSection,
  ShortcutAction,
  ShortcutSettings,
  UpdateInfo,
  UpdateProgress,
  UpdateSettings
} from './app/app-model'
import type {
  ColumnsResponse,
  ColumnInfo,
  ConnectionInfo,
  ConnectionTestResponse,
  DatabaseInfo,
  DbObjectInfo,
  HealthStatus,
  ObjectDdlResponse,
  QueryCountResponse,
  QueryResponse,
  RoutineParameterInfo,
  RoutineParametersResponse,
  SqlFileRunResponse,
  TableInfo
} from './app/connection-model'
import { parseDBeaverImportText, type DatabaseType } from './app/data-sources'
import MainWorkspacePanel from './app/main-workspace-panel'
import {
  ConnectionFormValues,
  DATABASE_TYPE_LABELS,
  DEFAULT_SHORTCUT_SETTINGS,
  DriverDatabaseType,
  DRIVER_DATABASE_META,
  DRIVER_DATABASE_ORDER,
  DriverFormValues,
  DriverInfo,
  DriverType,
  editableValue,
  ImportConnectionCandidate,
  ImportConnectionCandidateStatus,
  ImportConnectionFolderPlan,
  ImportConnectionResult,
  ImportConnectionSource,
  isCellValueEqual,
  isDatabaseScopedType,
  isDefaultValueMarker,
  isSchemaScopedType,
  JavaDetectResponse,
  JavaRuntimeConfigResponse,
  JavaRuntimeInfo,
  normalizeDriverInfo,
  parseDataGripImportText,
  PREVIEW_DEFAULT_LIMIT,
  QUERY_DEFAULT_LIMIT,
  REDIS_DEFAULT_LIMIT,
  renderMarkdown,
  SHORTCUT_SETTING_LABELS,
  ShortcutRecorder,
  tableDesignerSupportsEdit,
  TableDesignerMode,
  trimToUndefined,
  toColumnDef,
  buildEditableRows,
  buildRedisEdits,
  buildStatementStructureKey,
  cellDisplayText,
  ColumnDef
} from './app/app-shared'
import {
  DdlPreviewModal,
  type DdlPreviewModalHandle,
  ImperativeModalHost,
  type ImperativeModalHandle
} from './app/modal-region'
import { ConnectionEditorModal } from './app/connection-editor-modal'
import {
  buildAIContextSourceId,
  mergeAIContextSources,
  pruneManualAIContextsForPrimary,
  resolveAIContextDatabaseSelection,
  resolveAIExecutionContextSource,
  shouldSwitchAIPrimaryContext
} from './app/ai-context'
import {
  buildConnectionDetailsText,
  buildJdbcUrl,
  supportsJdbcUrl
} from './app/connection-clipboard'
import type { HorizontalScrollTableRef } from './app/result-table-panel'
import { clampResultColumnWidth } from './app/query-utils'
import { buildActiveTreePath, locateTreePathInView } from './app/tree-navigation'
import { refreshConnectionTreeNode, refreshDatabaseTreeNode } from './app/tree-refresh'
import { handleTreeSelectionChange, selectConnectionTreeNodes } from './app/tree-selection'
import { createTreeRuntime, getVisibleConnectionIdsFromTree } from './app/tree-runtime'
import { useResourceTreeViewport } from './app/tree-viewport'
import { renderWorkspaceTabContent } from './app/workspace-content'
import ResourceTreePanel from './app/resource-tree-panel'
import { type CellInspectorPanelHandle } from './app/cell-inspector-panel'
import type {
  AIActiveContext,
  AIContextSource,
  AIWorkspaceAction,
  EditableRow,
  PersistedQueryWorkspace,
  RedisKeyEdit,
  SqlEditorExecutionContext,
  MultiStatementResult,
  TableSearchUiState,
  WorkspaceTab
} from './app/workspace-model'
import {
  type DataDjinnConnectionTransferBundle,
  buildDataDjinnImportCandidates,
  decryptConnectionTransferBundle,
  encryptConnectionTransferBundle
} from './app/connection-transfer'
import {
  buildConnectionNode as buildConnectionNodeFromModule,
  buildFolderNode as buildFolderNodeFromModule,
  buildResourceTree as buildResourceTreeFromModule
} from './app/tree-builders'
import {
  buildPersistedQueryWorkspace,
  upsertPersistedQueryWorkspace
} from './app/workspace-persistence'
import {
  buildGitSyncTreeOrder,
  buildGitSyncTreeDiff,
  createDefaultGitSyncConflictChoices,
  describeGitSyncConflict,
  formatGitSyncConflictValue,
  groupGitSyncConflicts
} from './app/git-sync-conflicts'
import { ConnectionVersionManagementModal } from './app/connection-version-management-modal'
import {
  ConnectionExportModal,
  ConnectionImportModal,
  ConnectionImportResultModal,
  ConnectionPasswordPromptModal
} from './app/connection-transfer-modals'
import { BackupModal, CreateTableModal, FolderEditorModal } from './app/resource-operation-modals'
import {
  AUTO_SYNC_INTERVAL_MS,
  BACKEND_COLORS,
  BACKEND_LABELS,
  collectTreeSearchMatches,
  createConnectionTypeIcons,
  DATABASE_CONNECTION_REQUEST_TIMEOUT_MS,
  FAST_MODAL_PROPS,
  FAST_PRELOADED_DROPDOWN_PROPS,
  FOLDER_DROP_PLACEHOLDER_KEY_PREFIX,
  formatQueryHistoryTime,
  getConnectionAddress,
  getQueryHistoryPreviewText,
  getSyncDeviceId,
  insertIdsAroundTarget,
  isApiErrorResponse,
  mergeOrderedIds,
  readPersisted,
  readPersistedJson,
  RESOURCE_PANEL_MIN_WIDTH,
  RESOURCE_TREE_ITEM_HEIGHT,
  rootConnectionOrderId,
  rootFolderOrderId,
  SSH_TEST_REQUEST_TIMEOUT_MS,
  STORAGE_CONNECTION_FOLDER_ASSIGNMENTS,
  STORAGE_CONNECTION_FOLDER_ORDER,
  STORAGE_CONNECTION_FOLDERS,
  STORAGE_DB,
  STORAGE_FOLDER_CONNECTION_ORDER,
  STORAGE_PINNED_ROOT_ITEM_IDS,
  STORAGE_QUERY_WORKSPACES,
  STORAGE_ROOT_CONNECTION_ORDER,
  STORAGE_ROOT_ITEM_ORDER_CUSTOMIZED,
  STORAGE_ROOT_ITEM_ORDER,
  STORAGE_SCHEMA,
  STORAGE_SHORTCUT_SETTINGS,
  stringArrayEquals,
  stringRecordArrayEquals,
  showErrorModal,
  TreeSelectorPopover,
  WorkspaceTabCountBadge,
  type ApiErrorResponse,
  type ApiRequestError,
  type ApiRequestOptions,
  type ConnectionTransferTestWindow,
  type ExportDataScope,
  type ExportFormat,
  type ExportOrigin,
  type GitHubDeviceFlowTestWindow,
  type GitSyncConflict,
  type GitSyncFileStatus,
  type GitSyncLocalState,
  type GitSyncMergeResult,
  type GitSyncPayload,
  type GitSnapshotTask,
  type RoutineArgumentDraft,
  type RoutineExecutionTarget,
  type SchemaSnapshot,
  type SchemaVersionInfo,
  type TreeSearchMatch,
  type VersioningScopeConfig
} from './app/app-runtime-support'
import { useWorkspaceStore } from './app/workspace-store'
import {
  collectTreeNodesByKey,
  getRelativeDropPosition,
  getTreeNodeCopyName,
  isLoadableTreeNode,
  isTreeNodeChildrenLoaded,
  replaceConnectionNode,
  treeIconBadge,
  updateTreeNode
} from './app/tree-model'
import type {
  ConnectionFolder,
  DatabaseTreeNode,
  DbObjectType,
  TreeNodeKind
} from './app/tree-model'
import mysqlIcon from './assets/icons/mysql.png'
import postgresIcon from './assets/icons/postgres.png'
import sqliteIcon from './assets/icons/sqllite.png'
import dmIcon from './assets/icons/dm.svg'
import mongoIcon from './assets/icons/mongo.png'
import redisIcon from './assets/icons/redis.png'
import clickhouseIcon from './assets/icons/clickhouse.png'
import oracleIcon from './assets/icons/oracle.png'
import appIcon from '../../../resources/icon.svg'
import appLogoHorizontal from '../../../resources/logo-horizontal.svg'

const TableDesignerPanel = lazy(() => import('./app/table-designer-panel'))
const ResultTablePanel = lazy(() => import('./app/result-table-panel'))

function App(): React.JSX.Element {
  const [form] = Form.useForm<ConnectionFormValues>()
  const [driverForm] = Form.useForm<DriverFormValues>()
  const [connectionModalDatabaseType, setConnectionModalDatabaseType] =
    useState<DatabaseType>('sqlite')
  const driverType = Form.useWatch('driver_type', driverForm) ?? 'jdbc'
  const [messageApi, contextHolder] = message.useMessage()
  const showError = showErrorModal
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    state: 'starting',
    message: '后端状态初始化中'
  })
  const [healthLoading, setHealthLoading] = useState(false)
  const [connections, setConnections] = useState<ConnectionInfo[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>()
  const [connectionsInitialized, setConnectionsInitialized] = useState(false)
  const [startupUiReady, setStartupUiReady] = useState(false)
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([])
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<React.Key[]>([])
  const [connectionSelectionAnchorId, setConnectionSelectionAnchorId] = useState<string>()
  const [treeData, setTreeData] = useState<DatabaseTreeNode[]>([])
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [connectionTreeLoading, setConnectionTreeLoading] = useState<Record<string, string>>({})
  const [treeLoadingVersion, setTreeLoadingVersion] = useState(0)
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionMode, setConnectionMode] = useState<'create' | 'edit'>('create')
  const [editingConnectionInfoId, setEditingConnectionInfoId] = useState<string>()
  const [connectionModalFolderId, setConnectionModalFolderId] = useState<string>()
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testingSshConnection, setTestingSshConnection] = useState(false)
  const connectionTestRunRef = useRef(0)
  const [connectionPasswordPromptOpen, setConnectionPasswordPromptOpen] = useState(false)
  const [connectionPasswordPromptConnectionId, setConnectionPasswordPromptConnectionId] =
    useState<string>('')
  const [connectionPasswordPromptConnectionName, setConnectionPasswordPromptConnectionName] =
    useState('')
  const [connectionPasswordPromptReason, setConnectionPasswordPromptReason] = useState('')
  const [connectionPasswordDraft, setConnectionPasswordDraft] = useState('')
  const setWorkspaceTabs = useWorkspaceStore((state) => state.setTabs)
  const setActiveTabKey = useWorkspaceStore((state) => state.setActiveTabKey)
  const setWorkspaceTabsAndActiveTabKey = useWorkspaceStore((state) => state.setTabsAndActiveTabKey)
  const workspaceTabSummaryCount = useWorkspaceStore((state) => state.tabSummaries.length)
  const queryPersistenceRevision = useWorkspaceStore((state) => state.queryPersistenceRevision)
  const getWorkspaceTabs = useCallback(() => useWorkspaceStore.getState().tabs, [])
  const [sqlExecutionContextByTab, setSqlExecutionContextByTab] = useState<
    Record<string, SqlEditorExecutionContext>
  >({})
  const sqlExecutionContextRef = useRef<Record<string, SqlEditorExecutionContext>>({})
  const sqlExecutionContextStructureKeyRef = useRef<Record<string, string>>({})
  const sqlEditorHandleRefs = useRef<Record<string, SqlEditorHandle | null | undefined>>({})
  const [resourcePanelSize, setResourcePanelSize] = useState(340)
  const [aiPanelSize, setAiPanelSize] = useState(360)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
  const [treeSearchOpen, setTreeSearchOpen] = useState(false)
  const [treeSearchText, setTreeSearchText] = useState('')
  const [treeSearchMatchIndex, setTreeSearchMatchIndex] = useState(0)
  const treeSearchInputRef = useRef<HTMLInputElement | null>(null)
  const folderEditorInputRef = useRef<InputRef | null>(null)
  const gitSyncPassphraseConfirmInputRef = useRef<InputRef | null>(null)
  const nextGitSyncPassphraseInputRef = useRef<InputRef | null>(null)
  const nextGitSyncPassphraseConfirmInputRef = useRef<InputRef | null>(null)
  const treeSearchMatchesRef = useRef<TreeSearchMatch[]>([])
  const queryHistoryModalRef = useRef<ImperativeModalHandle | null>(null)
  const settingsModalRef = useRef<ImperativeModalHandle | null>(null)
  const updateModalRef = useRef<ImperativeModalHandle | null>(null)
  const connectionModalHydrationFrameRef = useRef<number | undefined>(undefined)
  const resetConnectionTestingState = (): void => {
    connectionTestRunRef.current += 1
    setTestingConnection(false)
    setTestingSshConnection(false)
  }

  const closeConnectionModal = (): void => {
    resetConnectionTestingState()
    if (connectionModalHydrationFrameRef.current != null) {
      window.cancelAnimationFrame(connectionModalHydrationFrameRef.current)
      connectionModalHydrationFrameRef.current = undefined
    }
    setConnectionModalOpen(false)
    setConnectionModalFolderId(undefined)
  }
  const [resizingResourcePanel, setResizingResourcePanel] = useState(false)
  const [resizingAiPanel, setResizingAiPanel] = useState(false)
  const [aiContextSources, setAiContextSources] = useState<AIContextSource[]>([])
  const [aiActiveContext, setAiActiveContext] = useState<AIActiveContext | undefined>()
  const [focusedTreeNode, setFocusedTreeNode] = useState<DatabaseTreeNode | undefined>()
  const [treeContextMenu, setTreeContextMenu] = useState<{
    x: number
    y: number
    node: DatabaseTreeNode
  } | null>(null)
  const [queryCounter, setQueryCounter] = useState(1)
  const [tableEditorOpen, setTableEditorOpen] = useState(false)
  const [tableEditorLoading, setTableEditorLoading] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<string>()
  const [editingDatabaseName, setEditingDatabaseName] = useState<string>()
  const [editingPgDatabaseName, setEditingPgDatabaseName] = useState<string>()
  const [editingTableName, setEditingTableName] = useState<string>()
  const [editingOriginalTableName, setEditingOriginalTableName] = useState<string>()
  const [editingTableComment, setEditingTableComment] = useState('')
  const [editingColumns, setEditingColumns] = useState<ColumnDef[]>([])
  const [databaseCreateModalOpen, setDatabaseCreateModalOpen] = useState(false)
  const [creatingDatabaseConnectionId, setCreatingDatabaseConnectionId] = useState<string>('')
  const [creatingSchemaDatabaseName, setCreatingSchemaDatabaseName] = useState<string>('')
  const [databaseCreateLoading, setDatabaseCreateLoading] = useState(false)
  const [databaseCreateName, setDatabaseCreateName] = useState('')
  const [databaseCreatePassword, setDatabaseCreatePassword] = useState('')
  const [sqlFileModalOpen, setSqlFileModalOpen] = useState(false)
  const [sqlFileConnectionId, setSqlFileConnectionId] = useState<string>('')
  const [sqlFileContent, setSqlFileContent] = useState('')
  const [sqlFileName, setSqlFileName] = useState('')
  const [sqlFileDatabase, setSqlFileDatabase] = useState<string>('')
  const [sqlFileDatabases, setSqlFileDatabases] = useState<DatabaseInfo[]>([])
  const [sqlFilePgDatabase, setSqlFilePgDatabase] = useState<string>('')
  const [sqlFileLoading, setSqlFileLoading] = useState(false)
  const [sqlFileResult, setSqlFileResult] = useState<SqlFileRunResponse | null>(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportConnectionId, setExportConnectionId] = useState<string>('')
  const [exportDatabase, setExportDatabase] = useState<string>('')
  const [exportPgDatabase, setExportPgDatabase] = useState<string>('')
  const [exportTable, setExportTable] = useState<string>('')
  const [exportScope, setExportScope] = useState<'database' | 'schema' | 'table'>('database')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('sql')
  const [exportContent, setExportContent] = useState<'schema' | 'data' | 'schema_data'>(
    'schema_data'
  )
  const [exportOrigin, setExportOrigin] = useState<ExportOrigin>('tree')
  const [exportResultTabKey, setExportResultTabKey] = useState('')
  const [exportDataScope, setExportDataScope] = useState<ExportDataScope>('current_page')
  const [exportAvailableColumns, setExportAvailableColumns] = useState<string[]>([])
  const [exportColumns, setExportColumns] = useState<string[]>([])
  const [exportColumnsLoading, setExportColumnsLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importConnectionId, setImportConnectionId] = useState<string>('')
  const [importDatabase, setImportDatabase] = useState<string>('')
  const [importPgDatabase, setImportPgDatabase] = useState<string>('')
  const [importTable, setImportTable] = useState<string>('')
  const [importPath, setImportPath] = useState<string>('')
  const [importLoading, setImportLoading] = useState(false)
  const [importConnectionModalOpen, setImportConnectionModalOpen] = useState(false)
  const [importConnectionSource, setImportConnectionSource] =
    useState<ImportConnectionSource>('datagrip')
  const [importConnectionRawText, setImportConnectionRawText] = useState('')
  const [importConnectionFilePath, setImportConnectionFilePath] = useState('')
  const [importConnectionSecret, setImportConnectionSecret] = useState('')
  const [importConnectionCandidates, setImportConnectionCandidates] = useState<
    ImportConnectionCandidate[]
  >([])
  const [importConnectionFolderPlan, setImportConnectionFolderPlan] =
    useState<ImportConnectionFolderPlan | null>(null)
  const [importConnectionParsing, setImportConnectionParsing] = useState(false)
  const [importingConnections, setImportingConnections] = useState(false)
  const [importConnectionResult, setImportConnectionResult] =
    useState<ImportConnectionResult | null>(null)
  const [importConnectionResultOpen, setImportConnectionResultOpen] = useState(false)
  const [importConnectionBundle, setImportConnectionBundle] =
    useState<DataDjinnConnectionTransferBundle | null>(null)
  const [exportConnectionModalOpen, setExportConnectionModalOpen] = useState(false)
  const [exportConnectionSecret, setExportConnectionSecret] = useState('')
  const [exportConnectionSecretConfirm, setExportConnectionSecretConfirm] = useState('')
  const [exportingConnections, setExportingConnections] = useState(false)
  const [backupRestoreModalOpen, setBackupRestoreModalOpen] = useState(false)
  const [backupRestoreConnectionId, setBackupRestoreConnectionId] = useState<string>('')
  const [backupRestoreDatabase, setBackupRestoreDatabase] = useState<string>('')
  const [backupRestorePgDatabase, setBackupRestorePgDatabase] = useState<string>('')
  const [backupRestoreLoading, setBackupRestoreLoading] = useState(false)
  const [routineExecuteModalOpen, setRoutineExecuteModalOpen] = useState(false)
  const [routineExecuteLoading, setRoutineExecuteLoading] = useState(false)
  const [routineTarget, setRoutineTarget] = useState<RoutineExecutionTarget>()
  const [routineParameters, setRoutineParameters] = useState<RoutineParameterInfo[]>([])
  const [routineArguments, setRoutineArguments] = useState<Record<string, RoutineArgumentDraft>>({})
  const [createTableModalOpen, setCreateTableModalOpen] = useState(false)
  const [createTableConnectionId, setCreateTableConnectionId] = useState<string>('')
  const [createTableDatabaseName, setCreateTableDatabaseName] = useState<string>('')
  const [createTablePgDatabaseName, setCreateTablePgDatabaseName] = useState<string>('')
  const [createTableLoading, setCreateTableLoading] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableComment, setNewTableComment] = useState('')
  const [newTableColumns, setNewTableColumns] = useState<ColumnDef[]>([])
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('app')
  const [gitHubAuthStatus, setGitHubAuthStatus] = useState<GitHubAuthStatus>({
    authorized: false
  })
  const [gitHubAuthorizationPending, setGitHubAuthorizationPending] = useState(false)
  const [gitHubDeviceAuthorization, setGitHubDeviceAuthorization] =
    useState<GitHubDeviceAuthorization>()
  const [gitSyncPassphrase, setGitSyncPassphrase] = useState('')
  const [gitSyncPassphraseConfirm, setGitSyncPassphraseConfirm] = useState('')
  const [changingGitSyncPassphrase, setChangingGitSyncPassphrase] = useState(false)
  const [currentGitSyncPassphrase, setCurrentGitSyncPassphrase] = useState('')
  const [nextGitSyncPassphrase, setNextGitSyncPassphrase] = useState('')
  const [nextGitSyncPassphraseConfirm, setNextGitSyncPassphraseConfirm] = useState('')
  const [gitSyncBusy, setGitSyncBusy] = useState(false)
  const [gitSyncLastSyncedAt, setGitSyncLastSyncedAt] = useState<number>()
  const [gitSyncRemoteExists, setGitSyncRemoteExists] = useState(false)
  const [gitSyncBaseline, setGitSyncBaseline] = useState<GitSyncPayload>()
  const gitSyncRestoreTargetRef = useRef<{
    connectionIds: Set<string>
    folderIds: Set<string>
    assignments: Record<string, string>
  } | undefined>(undefined)
  const gitSyncAssignmentRecoveryRef = useRef<string | undefined>(undefined)
  const [gitSyncAutoEnabled, setGitSyncAutoEnabled] = useState(false)
  const [gitSyncConflicts, setGitSyncConflicts] = useState<GitSyncConflict[]>([])
  const [gitSyncConflictChoices, setGitSyncConflictChoices] = useState<
    Record<string, 'local' | 'remote'>
  >({})
  const [gitSyncPendingPayload, setGitSyncPendingPayload] = useState<GitSyncPayload>()
  const [gitSyncPendingRemoteSha, setGitSyncPendingRemoteSha] = useState<string>()
  const [gitSyncPendingPassphrase, setGitSyncPendingPassphrase] = useState('')
  const [schemaVersionConnectionId, setSchemaVersionConnectionId] = useState<string>()
  const [schemaVersionModalOpen, setSchemaVersionModalOpen] = useState(false)
  const [schemaVersions, setSchemaVersions] = useState<SchemaVersionInfo[]>([])
  const [databaseBaselineExists, setDatabaseBaselineExists] = useState(false)
  const [schemaVersionsLoading, setSchemaVersionsLoading] = useState(false)
  const [schemaSnapshotCreating, setSchemaSnapshotCreating] = useState(false)
  const [gitSnapshotTask, setGitSnapshotTask] = useState<GitSnapshotTask>()
  const [gitSnapshotTasks, setGitSnapshotTasks] = useState<GitSnapshotTask[]>([])
  const [tableGitHistoryTarget, setTableGitHistoryTarget] = useState<{
    connectionId: string
    tableName: string
    scope?: string
  }>()
  const [tableGitHistory, setTableGitHistory] = useState<SchemaVersionInfo[]>([])
  const [tableGitHistoryLoading, setTableGitHistoryLoading] = useState(false)
  const [tableGitDetails, setTableGitDetails] = useState<{
    title: string
    sql?: string
    diff?: { added_count: number; deleted_count: number; updated_count: number }
  }>()
  const [tableGitActionVersion, setTableGitActionVersion] = useState<string>()
  const [versioningScopeConfig, setVersioningScopeConfig] = useState<VersioningScopeConfig>()
  const [versioningScopeDraft, setVersioningScopeDraft] = useState<string[]>([])
  const [versioningScopesLoading, setVersioningScopesLoading] = useState(false)
  const [versioningScopesSaving, setVersioningScopesSaving] = useState(false)
  const versioningScopeLabel =
    versioningScopeConfig?.scope_kind === 'database' ? '数据库' : '模式'
  const hasConfiguredVersioningScope =
    versioningScopeConfig?.scope_kind === 'single' ||
    Boolean(versioningScopeConfig && versioningScopeConfig.selected_scopes.length > 0)
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(() => ({
    ...DEFAULT_SHORTCUT_SETTINGS,
    ...readPersistedJson<Partial<ShortcutSettings>>(STORAGE_SHORTCUT_SETTINGS, {})
  }))
  const [recordingShortcutAction, setRecordingShortcutAction] = useState<ShortcutAction | null>(
    null
  )
  const [selectedDriverDatabaseType, setSelectedDriverDatabaseType] =
    useState<DriverDatabaseType>('dm')
  const [connectionFolders, setConnectionFolders] = useState<ConnectionFolder[]>(() =>
    readPersistedJson<ConnectionFolder[]>(STORAGE_CONNECTION_FOLDERS, [])
  )
  const [connectionFolderAssignments, setConnectionFolderAssignments] = useState<
    Record<string, string>
  >(() => readPersistedJson<Record<string, string>>(STORAGE_CONNECTION_FOLDER_ASSIGNMENTS, {}))
  const [connectionFolderOrder, setConnectionFolderOrder] = useState<string[]>(() =>
    readPersistedJson<string[]>(STORAGE_CONNECTION_FOLDER_ORDER, [])
  )
  const [rootConnectionOrder, setRootConnectionOrder] = useState<string[]>(() =>
    readPersistedJson<string[]>(STORAGE_ROOT_CONNECTION_ORDER, [])
  )
  const [rootItemOrder, setRootItemOrder] = useState<string[]>(() =>
    readPersistedJson<string[]>(STORAGE_ROOT_ITEM_ORDER, [])
  )
  const [rootItemOrderCustomized, setRootItemOrderCustomized] = useState(
    () => localStorage.getItem(STORAGE_ROOT_ITEM_ORDER_CUSTOMIZED) === 'true'
  )
  const [pinnedRootItemIds, setPinnedRootItemIds] = useState<string[]>(() =>
    readPersistedJson<string[]>(STORAGE_PINNED_ROOT_ITEM_IDS, [])
  )
  const [folderConnectionOrder, setFolderConnectionOrder] = useState<Record<string, string[]>>(() =>
    readPersistedJson<Record<string, string[]>>(STORAGE_FOLDER_CONNECTION_ORDER, {})
  )
  const [folderEditorOpen, setFolderEditorOpen] = useState(false)
  const [folderEditorMode, setFolderEditorMode] = useState<'create' | 'rename'>('create')
  const [editingFolderId, setEditingFolderId] = useState<string>()
  const [creatingFolderParentId, setCreatingFolderParentId] = useState<string>()
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [javaRestartRequired, setJavaRestartRequired] = useState(false)
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings | null>(null)
  const [querySettings, setQuerySettings] = useState<QuerySettings>({ timeoutMinutes: 15 })
  const [mcpSettings, setMcpSettings] = useState<McpSettings>(DEFAULT_MCP_SETTINGS)
  const [optionalModules, setOptionalModules] = useState<OptionalModuleInfo[]>([])
  const [optionalModulesLoaded, setOptionalModulesLoaded] = useState(false)
  const [mcpLaunchConfig, setMcpLaunchConfig] = useState<OptionalModuleLaunchConfig | null>(null)
  const [installingOptionalModuleId, setInstallingOptionalModuleId] = useState<
    OptionalModuleInfo['id'] | null
  >(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [downloadingUpdate, setDownloadingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [drivers, setDrivers] = useState<DriverInfo[]>([])
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntimeInfo[]>([])
  const [jdbcJavaHome, setJdbcJavaHome] = useState<string>('')
  const [jdbcJavaEnabled, setJdbcJavaEnabled] = useState<boolean>(false)
  const [configuredJdbcJavaHome, setConfiguredJdbcJavaHome] = useState<string>('')
  const [configuredJdbcJavaEnabled, setConfiguredJdbcJavaEnabled] = useState<boolean>(false)
  const javaRuntimeOptions = javaRuntimes.map((runtime) => ({
    label: `Java ${runtime.major ?? '未知版本'} - ${runtime.home}`,
    value: runtime.home
  }))
  const selectedJavaRuntimeValues = new Set(
    javaRuntimeOptions.map((option) => option.value.toLowerCase())
  )
  const driverDatabaseTypeForConnection = (value?: DatabaseType): DriverDatabaseType | undefined =>
    value === 'dm' || value === 'gaussdb' ? value : undefined
  const currentDriverDatabaseType = driverDatabaseTypeForConnection(connectionModalDatabaseType)
  const currentAllDrivers = currentDriverDatabaseType
    ? drivers.filter((driver) => driver.database_type === currentDriverDatabaseType)
    : []
  const currentEnabledDrivers = currentAllDrivers.filter((driver) => driver.enabled)
  const watchedDriverId = Form.useWatch('driver_id', form)
  const watchedLegacyDmDriverId = Form.useWatch('dm_driver_id', form)
  const selectedManualDriverId = currentDriverDatabaseType
    ? (watchedDriverId ?? watchedLegacyDmDriverId)
    : undefined
  const selectedManualDriver = currentAllDrivers.find(
    (driver) => driver.id === selectedManualDriverId
  )
  const [driversLoading, setDriversLoading] = useState(false)
  const [driverSaving, setDriverSaving] = useState(false)
  const selectedDriverDatabaseMeta = DRIVER_DATABASE_META[selectedDriverDatabaseType]
  const selectedDatabaseDrivers = drivers.filter(
    (driver) => driver.database_type === selectedDriverDatabaseType
  )
  const selectedManualDriverCount = selectedDatabaseDrivers.filter(
    (driver) => driver.source === 'manual'
  ).length
  const selectedDriverTypeLabels = selectedDriverDatabaseMeta.supportedDriverTypes
    .map((type) =>
      type === 'python'
        ? 'dmPython pyd 驱动'
        : type === 'whl'
          ? 'dmPython whl 驱动'
          : 'JDBC jar 驱动'
    )
    .join('、')
  const [selectedDatabases, setSelectedDatabases] = useState<Record<string, string[]>>(() =>
    readPersisted(STORAGE_DB)
  )
  const [selectedSchemas, setSelectedSchemas] = useState<Record<string, string[]>>(() =>
    readPersisted(STORAGE_SCHEMA)
  )
  const [connectionTreePreferencesReady, setConnectionTreePreferencesReady] = useState(false)
  const [persistedQueryWorkspaces, setPersistedQueryWorkspaces] = useState<
    PersistedQueryWorkspace[]
  >(() => readPersistedJson<PersistedQueryWorkspace[]>(STORAGE_QUERY_WORKSPACES, []))
  const selectedDatabasesRef = useRef(selectedDatabases)
  const selectedSchemasRef = useRef(selectedSchemas)

  useEffect(() => {
    selectedDatabasesRef.current = selectedDatabases
  }, [selectedDatabases])

  useEffect(() => {
    selectedSchemasRef.current = selectedSchemas
  }, [selectedSchemas])

  useEffect(() => {
    localStorage.setItem(STORAGE_CONNECTION_FOLDERS, JSON.stringify(connectionFolders))
  }, [connectionFolders])

  useEffect(() => {
    localStorage.setItem(
      STORAGE_CONNECTION_FOLDER_ASSIGNMENTS,
      JSON.stringify(connectionFolderAssignments)
    )
  }, [connectionFolderAssignments])

  useEffect(() => {
    localStorage.setItem(STORAGE_CONNECTION_FOLDER_ORDER, JSON.stringify(connectionFolderOrder))
  }, [connectionFolderOrder])

  useEffect(() => {
    localStorage.setItem(STORAGE_ROOT_CONNECTION_ORDER, JSON.stringify(rootConnectionOrder))
  }, [rootConnectionOrder])

  useEffect(() => {
    localStorage.setItem(STORAGE_ROOT_ITEM_ORDER, JSON.stringify(rootItemOrder))
  }, [rootItemOrder])

  useEffect(() => {
    localStorage.setItem(STORAGE_ROOT_ITEM_ORDER_CUSTOMIZED, String(rootItemOrderCustomized))
  }, [rootItemOrderCustomized])

  useEffect(() => {
    localStorage.setItem(STORAGE_PINNED_ROOT_ITEM_IDS, JSON.stringify(pinnedRootItemIds))
  }, [pinnedRootItemIds])

  useEffect(() => {
    localStorage.setItem(STORAGE_FOLDER_CONNECTION_ORDER, JSON.stringify(folderConnectionOrder))
  }, [folderConnectionOrder])

  useEffect(() => {
    localStorage.setItem(STORAGE_QUERY_WORKSPACES, JSON.stringify(persistedQueryWorkspaces))
  }, [persistedQueryWorkspaces])

  useEffect(() => {
    localStorage.setItem(STORAGE_SHORTCUT_SETTINGS, JSON.stringify(shortcutSettings))
  }, [shortcutSettings])

  useEffect(() => {
    if (!connectionsInitialized || !connectionTreePreferencesReady) {
      return
    }

    const gitSyncRestoreTarget = gitSyncRestoreTargetRef.current
    if (gitSyncRestoreTarget) {
      const currentConnectionIds = new Set(connections.map((connection) => connection.connection_id))
      const currentFolderIds = new Set(connectionFolders.map((folder) => folder.id))
      const connectionsReady = [...gitSyncRestoreTarget.connectionIds].every((connectionId) =>
        currentConnectionIds.has(connectionId)
      )
      const foldersReady = [...gitSyncRestoreTarget.folderIds].every((folderId) =>
        currentFolderIds.has(folderId)
      )
      const expectedAssignments = Object.fromEntries(
        Object.entries(gitSyncRestoreTarget.assignments).filter(
          ([connectionId, folderId]) =>
            currentConnectionIds.has(connectionId) && currentFolderIds.has(folderId)
        )
      )
      const currentAssignments = Object.fromEntries(
        Object.entries(connectionFolderAssignments).filter(
          ([connectionId, folderId]) =>
            currentConnectionIds.has(connectionId) && currentFolderIds.has(folderId)
        )
      )
      const expectedAssignmentEntries = Object.entries(expectedAssignments).sort(([left], [right]) =>
        left.localeCompare(right)
      )
      const currentAssignmentEntries = Object.entries(currentAssignments).sort(([left], [right]) =>
        left.localeCompare(right)
      )
      const assignmentsReady =
        expectedAssignmentEntries.length === currentAssignmentEntries.length &&
        expectedAssignmentEntries.every(
          ([connectionId, folderId], index) =>
            currentAssignmentEntries[index]?.[0] === connectionId &&
            currentAssignmentEntries[index]?.[1] === folderId
        )
      if (!connectionsReady || !foldersReady || !assignmentsReady) {
        return
      }
      gitSyncRestoreTargetRef.current = undefined
      return
    }

    const validConnectionIds = new Set(connections.map((connection) => connection.connection_id))
    const validFolderIds = new Set(connectionFolders.map((folder) => folder.id))

    setConnectionFolderAssignments((current) => {
      let changed = false
      const next = Object.fromEntries(
        Object.entries(current).filter(([connectionId, folderId]) => {
          const keep = validConnectionIds.has(connectionId) && validFolderIds.has(folderId)
          if (!keep) {
            changed = true
          }
          return keep
        })
      )
      return changed ? next : current
    })

    setSelectedConnectionIds((current) => {
      const next = current.filter((connectionId) => validConnectionIds.has(connectionId))
      return stringArrayEquals(current, next) ? current : next
    })
    setSelectedTreeKeys((current) => {
      const next = current.filter((key) => {
        const value = String(key)
        if (value.startsWith('connection:')) {
          return validConnectionIds.has(value.slice('connection:'.length))
        }
        if (value.startsWith('folder:')) {
          return validFolderIds.has(value.slice('folder:'.length))
        }
        return true
      })
      return current.length === next.length && current.every((item, index) => item === next[index])
        ? current
        : next
    })
    setConnectionSelectionAnchorId((current) =>
      current && validConnectionIds.has(current) ? current : undefined
    )
    setConnectionFolderOrder((current) => {
      const next = mergeOrderedIds(
        connectionFolders.map((folder) => folder.id),
        current
      )
      return stringArrayEquals(current, next) ? current : next
    })
    setRootConnectionOrder((current) => {
      const next = mergeOrderedIds(
        connections
          .filter(
            (connection) =>
              !connectionFolderAssignments[connection.connection_id] ||
              !validFolderIds.has(connectionFolderAssignments[connection.connection_id])
          )
          .map((connection) => connection.connection_id),
        current
      )
      return stringArrayEquals(current, next) ? current : next
    })
    setRootItemOrder((current) => {
      const rootConnectionIds = connections
        .filter(
          (connection) =>
            !connectionFolderAssignments[connection.connection_id] ||
            !validFolderIds.has(connectionFolderAssignments[connection.connection_id])
        )
        .map((connection) => rootConnectionOrderId(connection.connection_id))
      const folderIds = connectionFolders.map((folder) => rootFolderOrderId(folder.id))
      const defaultOrder = [...folderIds, ...rootConnectionIds]
      const next = mergeOrderedIds(
        [...folderIds, ...rootConnectionIds],
        rootItemOrderCustomized && current.length > 0 ? current : defaultOrder
      )
      return stringArrayEquals(current, next) ? current : next
    })
    setPinnedRootItemIds((current) => {
      const available = new Set([
        ...connectionFolders.map((folder) => rootFolderOrderId(folder.id)),
        ...connections
          .filter(
            (connection) =>
              !connectionFolderAssignments[connection.connection_id] ||
              !validFolderIds.has(connectionFolderAssignments[connection.connection_id])
          )
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ])
      const next = current.filter((itemId) => available.has(itemId))
      return stringArrayEquals(current, next) ? current : next
    })
    setFolderConnectionOrder((current) => {
      const next: Record<string, string[]> = {}
      for (const folderId of connectionFolders.map((folder) => folder.id)) {
        const folderConnectionIds = connections
          .filter(
            (connection) => connectionFolderAssignments[connection.connection_id] === folderId
          )
          .map((connection) => connection.connection_id)
        next[folderId] = mergeOrderedIds(folderConnectionIds, current[folderId] ?? [])
      }
      return stringRecordArrayEquals(current, next) ? current : next
    })
  }, [
    connectionsInitialized,
    connections,
    connectionFolders,
    connectionFolderAssignments,
    connectionFolderOrder,
    rootConnectionOrder,
    rootItemOrderCustomized
  ])

  useEffect(() => {
    if (!connectionsInitialized || !gitSyncBaseline) {
      return
    }

    const recoveryKey = `${gitSyncBaseline.device_id}:${gitSyncBaseline.generated_at}`
    if (gitSyncAssignmentRecoveryRef.current === recoveryKey) {
      return
    }
    gitSyncAssignmentRecoveryRef.current = recoveryKey

    const preferences = gitSyncBaseline.preferences
    const rawAssignments = preferences.connection_folder_assignments
    if (!rawAssignments || typeof rawAssignments !== 'object' || Array.isArray(rawAssignments)) {
      return
    }

    const currentConnectionIds = new Set(connections.map((connection) => connection.connection_id))
    const currentFolderIds = new Set(connectionFolders.map((folder) => folder.id))
    const baselineFolders = Array.isArray(preferences.connection_folders)
      ? preferences.connection_folders
          .filter(
            (folder): folder is { id: string } =>
              Boolean(folder) &&
              typeof folder === 'object' &&
              !Array.isArray(folder) &&
              typeof (folder as { id?: unknown }).id === 'string'
          )
          .map((folder) => folder.id)
      : []
    if (baselineFolders.length === 0 || baselineFolders.some((folderId) => !currentFolderIds.has(folderId))) {
      return
    }

    const recoveredAssignments = Object.fromEntries(
      Object.entries(rawAssignments).flatMap(([connectionId, folderId]) =>
        currentConnectionIds.has(connectionId) &&
        typeof folderId === 'string' &&
        currentFolderIds.has(folderId)
          ? ([[connectionId, folderId]] as [string, string][])
          : []
      )
    )
    if (Object.keys(recoveredAssignments).length === 0) {
      return
    }

    const currentAssignments = Object.fromEntries(
      Object.entries(connectionFolderAssignments).filter(
        ([connectionId, folderId]) =>
          currentConnectionIds.has(connectionId) && currentFolderIds.has(folderId)
      )
    )
    if (Object.keys(currentAssignments).length > 0) {
      return
    }

    setConnectionFolderAssignments(recoveredAssignments)
    const rawFolderOrder = preferences.folder_connection_order
    if (rawFolderOrder && typeof rawFolderOrder === 'object' && !Array.isArray(rawFolderOrder)) {
      setFolderConnectionOrder(
        Object.fromEntries(
          Object.entries(rawFolderOrder).flatMap(([folderId, connectionIds]) => {
            if (!currentFolderIds.has(folderId) || !Array.isArray(connectionIds)) {
              return []
            }
            const orderedIds = connectionIds.filter(
              (connectionId): connectionId is string =>
                typeof connectionId === 'string' && recoveredAssignments[connectionId] === folderId
            )
            return [[folderId, orderedIds]]
          })
        )
      )
    }
  }, [
    connectionFolderAssignments,
    connectionFolders,
    connections,
    connectionsInitialized,
    gitSyncBaseline
  ])

  const [allDatabases, setAllDatabases] = useState<Record<string, string[]>>({})
  const [allSchemas, setAllSchemas] = useState<Record<string, string[]>>({})
  const [completionTables, setCompletionTables] = useState<Record<string, string[]>>({})
  const [completionRoutines, setCompletionRoutines] = useState<
    Record<string, SqlCompletionRoutine[]>
  >({})
  const completionRoutineCacheRef = useRef<Record<string, SqlCompletionRoutine[]>>({})
  const completionRoutineRequestRef = useRef<
    Record<string, Promise<SqlCompletionRoutine[]> | undefined>
  >({})
  const completionColumnCacheRef = useRef<Record<string, SqlCompletionColumn[]>>({})
  const completionColumnRequestRef = useRef<Record<string, Promise<SqlCompletionColumn[]>>>({})
  const [dragOverFolderTarget, setDragOverFolderTarget] = useState<{
    folderId: string
    zone: 'before' | 'after'
  }>()
  const [dragOverConnectionTarget, setDragOverConnectionTarget] = useState<{
    connectionId: string
    folderId?: string
    zone: 'before' | 'after'
  }>()
  const [tableSearchUiState, setTableSearchUiState] = useState<Record<string, TableSearchUiState>>(
    {}
  )
  const defaultTableSearchStateRefs = useRef<
    Record<string, { signature: string; state: TableSearchUiState }>
  >({})
  const queryWorkspacePersistTimersRef = useRef<Record<string, number | undefined>>({})
  const queryWorkspacePersistSnapshotRef = useRef<Record<string, string | undefined>>({})
  const persistQueryWorkspaceRef = useRef<(tab: WorkspaceTab) => void>(() => undefined)
  const querySqlDraftTimersRef = useRef<Record<string, number | undefined>>({})
  const treeDataRef = useRef<DatabaseTreeNode[]>([])
  const expandedKeysRef = useRef<React.Key[]>([])
  const resourceTreeRef = useRef<unknown>(null)
  const tableComponentRefs = useRef<Record<string, HorizontalScrollTableRef | null>>({})
  const tableBodyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const tableHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingPreviewRowScrollRefs = useRef<Record<string, string | undefined>>({})
  const tableScrollTopRefs = useRef<Record<string, number | undefined>>({})
  const tableScrollLeftRefs = useRef<Record<string, number | undefined>>({})
  const tableScrollRestoreLocks = useRef<Record<string, number | undefined>>({})
  const pendingRenderedCellSelectionTimeoutRefs = useRef<Record<string, number | undefined>>({})
  const resourceTreeContainerRef = useRef<HTMLDivElement | null>(null)
  const resourceTreeViewportRef = useRef<HTMLDivElement | null>(null)
  const allDatabasesRef = useRef(allDatabases)
  const workspaceShellRef = useRef<HTMLDivElement | null>(null)
  const resourcePanelRef = useRef<HTMLDivElement | null>(null)
  const mainPanelRef = useRef<HTMLDivElement | null>(null)
  const aiDockPanelRef = useRef<HTMLDivElement | null>(null)
  const selectedColumnRefs = useRef<Record<string, string | undefined>>({})
  const selectedCellRefs = useRef<Record<string, string[] | undefined>>({})
  const selectedRowRefs = useRef<Record<string, string[] | undefined>>({})
  const renderedSelectedCellRefs = useRef<Record<string, string[] | undefined>>({})
  const renderedSelectedRowRefs = useRef<Record<string, string[] | undefined>>({})
  const runtimeSelectedCellRefs = useRef<Record<string, string[] | undefined>>({})
  const cellDragAnchorRefs = useRef<Record<string, { rowKey: string; column: string } | undefined>>(
    {}
  )
  const scrollbarDragRefs = useRef<Record<string, boolean | undefined>>({})
  const pendingCellDragTargetRefs = useRef<
    Record<string, { rowKey: string; column: string } | undefined>
  >({})
  const pendingCellDragFrameRefs = useRef<Record<string, number | undefined>>({})
  const pendingRowDragTargetRefs = useRef<Record<string, string | undefined>>({})
  const pendingRowDragFrameRefs = useRef<Record<string, number | undefined>>({})
  const pendingRenderedCellSelectionFrameRefs = useRef<Record<string, number | undefined>>({})
  const suppressNextShellClickClearRefs = useRef<Record<string, boolean | undefined>>({})
  const suppressNextCellMouseDownRefs = useRef<Record<string, string | undefined>>({})
  const contextMenuSelectionLockRefs = useRef<Record<string, boolean | undefined>>({})
  const committingEditingCellRefs = useRef<Record<string, boolean | undefined>>({})
  const editingCellRefs = useRef<Record<string, { rowKey: string; column: string } | undefined>>({})
  const suppressInlineEditorCommitRefs = useRef<Record<string, boolean | undefined>>({})
  const cellClipboardRef = useRef<{ text: string; values: unknown[][] } | null>(null)
  const contextMenuCellSelectionRefs = useRef<Record<string, string[] | undefined>>({})
  const contextMenuCellSelectionSnapshotRefs = useRef<
    Record<string, { anchorCellKey: string; cellKeys: string[] } | undefined>
  >({})
  const cellInspectorPanelRefs = useRef<Record<string, CellInspectorPanelHandle | null>>({})
  const inlineCellEditorRefs = useRef<
    Record<
      string,
      | {
          rowKey: string
          column: string
          input: HTMLInputElement
          host: HTMLElement
          originalValue: unknown
          initialInputValue: string
          batchCells?: Array<{ rowKey: string; column: string }>
          batchHosts?: HTMLElement[]
          batchOriginalValues?: Array<{ rowKey: string; column: string; value: unknown }>
        }
      | undefined
    >
  >({})
  const committedSelectedCellRangeRefs = useRef<Record<string, string[] | undefined>>({})
  const cellSelectionAnchorRefs = useRef<
    Record<string, { rowKey: string; column: string } | undefined>
  >({})
  const rowDragAnchorRefs = useRef<Record<string, string | undefined>>({})
  const rowSelectionAnchorRefs = useRef<Record<string, string | undefined>>({})
  const rowSelectionDraftRefs = useRef<Record<string, React.Key[] | undefined>>({})
  const treeLoadingKeysRef = useRef<Set<React.Key>>(new Set())
  const connectionOpenAttemptRefs = useRef<Record<string, string | undefined>>({})
  const dragOverFolderTargetRef = useRef<
    { folderId: string; zone: 'before' | 'after' } | undefined
  >(undefined)
  const dragOverConnectionTargetRef = useRef<
    { connectionId: string; folderId?: string; zone: 'before' | 'after' } | undefined
  >(undefined)
  const draggingConnectionIdsRef = useRef<string[]>([])
  const queryResultToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const aiPanelResizeRef = useRef<{ startX: number; startSize: number; lastSize?: number } | null>(
    null
  )
  const resourcePanelResizeRef = useRef<{
    startX: number
    startSize: number
    lastSize?: number
  } | null>(null)
  const draggingConnectionFolderIdRef = useRef<string | undefined>(undefined)
  const ddlPreviewModalRef = useRef<DdlPreviewModalHandle | null>(null)
  const columnResizeRefs = useRef<
    Record<
      string,
      | {
          tabKey: string
          column: string
          columnIndex: number
          pointerId: number
          startX: number
          startWidth: number
          startTableWidth: number
          lastWidth: number
          tableWidthHost?: HTMLElement
          headerCells: HTMLElement[]
          headerColElements: HTMLTableColElement[]
          bodyColElements: HTMLTableColElement[]
          virtual: boolean
          virtualCells?: HTMLElement[]
          pendingWidth?: number
          frameId?: number
        }
      | undefined
    >
  >({})
  const resultTableRefs = useMemo(
    () => ({
      tableComponentRefs,
      tableBodyRefs,
      tableHeaderRefs,
      pendingPreviewRowScrollRefs,
      tableScrollTopRefs,
      tableScrollLeftRefs,
      tableScrollRestoreLocks,
      selectedColumnRefs,
      selectedCellRefs,
      selectedRowRefs,
      renderedSelectedRowRefs,
      runtimeSelectedCellRefs,
      cellDragAnchorRefs,
      scrollbarDragRefs,
      pendingCellDragTargetRefs,
      pendingCellDragFrameRefs,
      pendingRowDragTargetRefs,
      pendingRowDragFrameRefs,
      suppressNextShellClickClearRefs,
      suppressNextCellMouseDownRefs,
      contextMenuSelectionLockRefs,
      committingEditingCellRefs,
      editingCellRefs,
      suppressInlineEditorCommitRefs,
      cellClipboardRef,
      contextMenuCellSelectionRefs,
      contextMenuCellSelectionSnapshotRefs,
      cellInspectorPanelRefs,
      inlineCellEditorRefs,
      committedSelectedCellRangeRefs,
      cellSelectionAnchorRefs,
      rowDragAnchorRefs,
      rowSelectionAnchorRefs,
      rowSelectionDraftRefs,
      columnResizeRefs
    }),
    []
  )

  const { theme, setTheme, toggleTheme } = useTheme()

  const refreshUpdateSettings = async (): Promise<void> => {
    const settings = await window.api.getUpdateSettings()
    setUpdateSettings(settings)
  }

  const refreshQuerySettings = async (): Promise<void> => {
    const settings = await window.api.getQuerySettings()
    setQuerySettings(settings)
  }

  const updateQueryTimeoutMinutes = async (timeoutMinutes: number | null): Promise<void> => {
    if (timeoutMinutes === null) {
      return
    }
    const settings = await window.api.setQueryTimeoutMinutes(timeoutMinutes)
    setQuerySettings(settings)
  }

  const refreshMcpSettings = async (): Promise<void> => {
    const settings = await window.api.getMcpSettings()
    setMcpSettings(settings)
  }

  const refreshGitHubAuthStatus = async (): Promise<void> => {
    const auth = await requestJson<GitHubAuthStatus>('/git-sync/auth/status')
    setGitHubAuthStatus(auth)
    if (!auth.authorized) {
      setGitSyncRemoteExists(false)
      return
    }
    try {
      const remote = await requestJson<GitSyncFileStatus>('/git-sync/file/status')
      setGitSyncRemoteExists(remote.exists)
      if (remote.repository) {
        setGitHubAuthStatus((current) => ({
          ...current,
          repository_full_name: remote.repository?.full_name,
          repository_url: remote.repository?.html_url
        }))
      }
    } catch {
      setGitSyncRemoteExists(false)
    }
  }

  const refreshGitSyncLocalState = async (): Promise<void> => {
    const state = (await window.api.getSyncLocalState()) as GitSyncLocalState
    setGitSyncPassphrase(state.passphrase ?? '')
    setGitSyncPassphraseConfirm(state.passphrase ?? '')
    setGitSyncLastSyncedAt(state.lastSyncedAt)
    setGitSyncAutoEnabled(Boolean(state.autoSyncEnabled))
    setGitSyncBaseline(state.basePayload)
  }

  const startGitHubAuthorization = async (): Promise<void> => {
    if (gitHubAuthorizationPending) {
      return
    }
    setGitHubAuthorizationPending(true)
    try {
      const testWindow = window as GitHubDeviceFlowTestWindow
      const authorization =
        testWindow.__DATADJINN_TEST_GITHUB_DEVICE_AUTHORIZATION__ ??
        (await requestJson<GitHubDeviceAuthorization>('/git-sync/auth/device', {
          method: 'POST'
        }))
      setGitHubDeviceAuthorization(authorization)
      await window.api.openExternalUrl(
        authorization.verification_uri_complete ?? authorization.verification_uri
      )
      messageApi.info(`已打开浏览器，请确认 GitHub 授权。授权码：${authorization.user_code}`)

      let pollIntervalMs = authorization.interval_seconds * 1000
      while (Date.now() < authorization.expires_at * 1000) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, pollIntervalMs))
        const result =
          testWindow.__DATADJINN_TEST_GITHUB_DEVICE_POLL__ ??
          (await requestJson<GitHubDeviceAuthorizationPoll>('/git-sync/auth/device/poll', {
            method: 'POST',
            body: JSON.stringify({ session_id: authorization.session_id })
          }))
        if (result.status === 'pending') {
          pollIntervalMs = (result.interval_seconds ?? authorization.interval_seconds) * 1000
          continue
        }
        if (result.status === 'authorized' && result.auth) {
          setGitHubAuthStatus(result.auth)
          setGitHubDeviceAuthorization(undefined)
          try {
            await refreshGitHubAuthStatus()
            const localState = (await window.api.getSyncLocalState()) as GitSyncLocalState
            if (localState.passphrase) {
              await synchronizeGitPayload(localState.passphrase, localState.passphrase, {
                silent: true
              })
            }
          } catch (syncError) {
            showError(syncError instanceof Error ? syncError.message : '授权后的自动同步失败')
          }
          messageApi.success(`已授权 GitHub 账号 ${result.auth.login ?? ''}`.trim())
          return
        }
        throw new Error(result.message ?? 'GitHub 授权未完成')
      }
      throw new Error('GitHub 授权已超时，请重新登录')
    } catch (error) {
      setGitHubDeviceAuthorization(undefined)
      showError(error instanceof Error ? error.message : 'GitHub 授权失败')
    } finally {
      setGitHubAuthorizationPending(false)
    }
  }

  const signOutGitHub = async (): Promise<void> => {
    try {
      await requestJson<{ success: boolean }>('/git-sync/auth', { method: 'DELETE' })
      await window.api.clearSyncLocalState()
      setGitHubAuthStatus({ authorized: false })
      setGitSyncPassphrase('')
      setGitSyncPassphraseConfirm('')
      setGitSyncLastSyncedAt(undefined)
      setGitSyncRemoteExists(false)
      messageApi.success('已退出 GitHub 授权')
    } catch (error) {
      showError(error instanceof Error ? error.message : '退出 GitHub 授权失败')
    }
  }

  const loadVersioningScopes = async (connectionId: string): Promise<void> => {
    setVersioningScopesLoading(true)
    try {
      const config = await requestJson<VersioningScopeConfig>(
        `/git-versioning/connections/${connectionId}/scopes`
      )
      setVersioningScopeConfig(config)
      setVersioningScopeDraft(config.selected_scopes)
    } catch (error) {
      setVersioningScopeConfig(undefined)
      setVersioningScopeDraft([])
      showError(error instanceof Error ? error.message : '加载版本管理范围失败')
    } finally {
      setVersioningScopesLoading(false)
    }
  }

  const saveVersioningScopes = async (connectionId: string): Promise<void> => {
    if (versioningScopesSaving) {
      return
    }
    setVersioningScopesSaving(true)
    try {
      const config = await requestJson<VersioningScopeConfig>(
        `/git-versioning/connections/${connectionId}/scopes`,
        {
          method: 'PUT',
          body: JSON.stringify({ selected_scopes: versioningScopeDraft })
        }
      )
      setVersioningScopeConfig(config)
      setVersioningScopeDraft(config.selected_scopes)
      messageApi.success('已保存 Git 纳管范围')
    } catch (error) {
      showError(error instanceof Error ? error.message : '保存版本管理范围失败')
    } finally {
      setVersioningScopesSaving(false)
    }
  }

  const loadSchemaVersions = async (connectionId: string): Promise<void> => {
    if (!connectionId) {
      setSchemaVersions([])
      return
    }
    setSchemaVersionsLoading(true)
    try {
      const [versions, baseline] = await Promise.all([
        requestJson<SchemaVersionInfo[]>(
          `/git-versioning/connections/${connectionId}/database-versions?limit=20`
        ),
        requestJson<{ exists: boolean }>(
          `/git-versioning/connections/${connectionId}/database-baseline`
        )
      ])
      setSchemaVersions(versions)
      setDatabaseBaselineExists(baseline.exists)
    } catch (error) {
      setSchemaVersions([])
      showError(error instanceof Error ? error.message : '加载结构版本失败')
    } finally {
      setSchemaVersionsLoading(false)
    }
  }

  const createSchemaSnapshot = async (connectionId: string): Promise<void> => {
    if (schemaSnapshotCreating) {
      return
    }
    setSchemaSnapshotCreating(true)
    try {
      const task = await requestJson<GitSnapshotTask>(
        `/git-versioning/connections/${connectionId}/database-snapshots`,
        { method: 'POST', body: JSON.stringify({ reason: '手动创建数据库 Git 快照' }) }
      )
      setGitSnapshotTask(task)
      let current = task
      while (current.status === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
        current = await requestJson<GitSnapshotTask>(`/git-versioning/tasks/${task.id}`)
        setGitSnapshotTask(current)
      }
      if (current.status === 'success') {
        setDatabaseBaselineExists(true)
        messageApi.success('数据库 Git 快照已提交')
        await loadSchemaVersions(connectionId)
      } else {
        throw new Error(
          current.status === 'cancelled'
            ? '数据库 Git 快照已停止'
            : current.error || '数据库 Git 快照提交失败'
        )
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : '创建结构快照失败')
    } finally {
      setSchemaSnapshotCreating(false)
    }
  }

  const openSchemaVersionModal = async (connectionId: string): Promise<void> => {
    const connection = getConnection(connectionId)
    setSchemaVersionConnectionId(connectionId)
    setSchemaVersions([])
    setDatabaseBaselineExists(false)
    setGitSnapshotTask(undefined)
    setVersioningScopeConfig(undefined)
    setVersioningScopeDraft([])
    setVersioningScopesLoading(true)
    setSchemaVersionModalOpen(true)

    if (connection && !connection.is_open) {
      const openedConnection = await openConnectionById(connectionId)
      if (!openedConnection) {
        setVersioningScopesLoading(false)
        return
      }
    }
    void loadVersioningScopes(connectionId)
    if (gitHubAuthStatus.authorized) {
      void loadSchemaVersions(connectionId)
    }
  }

  const openTableGitHistory = async (tab: WorkspaceTab): Promise<void> => {
    if (!tab.connectionId || !tab.tableName) {
      return
    }
    const target = {
      connectionId: tab.connectionId,
      tableName: tab.tableName,
      scope: tab.databaseName
    }
    setTableGitHistoryTarget(target)
    setTableGitHistory([])
    setTableGitHistoryLoading(true)
    try {
      const query = new URLSearchParams({ limit: '30' })
      if (target.scope) {
        query.set('scope', target.scope)
      }
      setTableGitHistory(
        await requestJson<SchemaVersionInfo[]>(
          `/git-versioning/connections/${target.connectionId}/tables/${encodeURIComponent(target.tableName)}/versions?${query.toString()}`
        )
      )
    } catch (error) {
      setTableGitHistoryTarget(undefined)
      showError(error instanceof Error ? error.message : '加载表 Git 提交记录失败')
    } finally {
      setTableGitHistoryLoading(false)
    }
  }

  const openTableGitDetails = async (version: SchemaVersionInfo): Promise<void> => {
    const target = tableGitHistoryTarget
    if (!target) return
    setTableGitActionVersion(version.id)
    try {
      const query = target.scope ? `?scope=${encodeURIComponent(target.scope)}` : ''
      const details = await requestJson<{ changes_sql: string }>(
        `/git-versioning/connections/${target.connectionId}/tables/${encodeURIComponent(target.tableName)}/versions/${version.id}/details${query}`
      )
      setTableGitDetails({ title: `${version.message} · 变更 SQL`, sql: details.changes_sql || '-- 本次提交没有记录 SQL' })
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载提交详情失败')
    } finally {
      setTableGitActionVersion(undefined)
    }
  }

  const openTableGitDiff = async (version: SchemaVersionInfo): Promise<void> => {
    const target = tableGitHistoryTarget
    if (!target) return
    setTableGitActionVersion(version.id)
    try {
      const query = target.scope ? `?scope=${encodeURIComponent(target.scope)}` : ''
      const diff = await requestJson<{ added_count: number; deleted_count: number; updated_count: number }>(
        `/git-versioning/connections/${target.connectionId}/tables/${encodeURIComponent(target.tableName)}/versions/${version.id}/diff${query}`
      )
      setTableGitDetails({ title: `${version.message} · 数据差异`, diff })
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载数据差异失败')
    } finally {
      setTableGitActionVersion(undefined)
    }
  }

  const restoreTableGitVersion = async (version: SchemaVersionInfo): Promise<void> => {
    const target = tableGitHistoryTarget
    if (!target) return
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '恢复历史表数据？',
        content: '这会覆盖当前表中的数据，不会恢复表结构。确认继续吗？',
        okText: '确认恢复',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!confirmed) return
    setTableGitActionVersion(version.id)
    try {
      const query = target.scope ? `?scope=${encodeURIComponent(target.scope)}` : ''
      await requestJson(
        `/git-versioning/connections/${target.connectionId}/tables/${encodeURIComponent(target.tableName)}/versions/${version.id}/restore${query}`,
        { method: 'POST', body: JSON.stringify({ confirm: true }) }
      )
      messageApi.success('历史表数据已恢复，请刷新表预览')
    } catch (error) {
      showError(error instanceof Error ? error.message : '恢复历史表数据失败')
    } finally {
      setTableGitActionVersion(undefined)
    }
  }

  const restoreTableGitStructure = async (version: SchemaVersionInfo): Promise<void> => {
    const target = tableGitHistoryTarget
    if (!target) return
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '恢复历史表结构？',
        content: '这会删除并重建当前表结构，可能影响现有数据。建议先恢复结构，再按需恢复数据。确认继续吗？',
        okText: '确认恢复结构',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!confirmed) return
    setTableGitActionVersion(version.id)
    try {
      const query = target.scope ? `?scope=${encodeURIComponent(target.scope)}` : ''
      await requestJson(
        `/git-versioning/connections/${target.connectionId}/tables/${encodeURIComponent(target.tableName)}/versions/${version.id}/structure-restore${query}`,
        { method: 'POST', body: JSON.stringify({ confirm: true }) }
      )
      messageApi.success('历史表结构已恢复，请刷新表预览')
    } catch (error) {
      showError(error instanceof Error ? error.message : '恢复历史表结构失败')
    } finally {
      setTableGitActionVersion(undefined)
    }
  }

  useEffect(() => {
    if (!gitHubAuthStatus.authorized) {
      return
    }
    let disposed = false
  const pollGitTasks = async (): Promise<void> => {
      const running: GitSnapshotTask[] = []
      for (const connection of connections.filter((item) => item.git_versioning_enabled)) {
        try {
          const tasks = await requestJson<GitSnapshotTask[]>(
            `/git-versioning/connections/${connection.connection_id}/tasks`
          )
          const latest = tasks[tasks.length - 1]
          running.push(...tasks.filter((task) => task.status === 'running'))
          if (!disposed && latest?.status === 'running') {
            setGitSnapshotTask(latest)
          }
        } catch {
          // 后台状态轮询失败不影响主界面操作。
        }
      }
      if (!disposed) {
        setGitSnapshotTasks(running)
        if (running.length === 0) {
          setGitSnapshotTask(undefined)
        }
      }
    }
    void pollGitTasks()
    const timer = window.setInterval(() => void pollGitTasks(), 3000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [connections, gitHubAuthStatus.authorized])

  const cancelGitSnapshotTask = async (taskId: string): Promise<void> => {
    try {
      await requestJson<GitSnapshotTask>(`/git-versioning/tasks/${taskId}/cancel`, { method: 'POST' })
      messageApi.info('已请求停止 Git 后台任务')
    } catch (error) {
      showError(error instanceof Error ? error.message : '停止 Git 后台任务失败')
    }
  }

  const closeSchemaVersionModal = (): void => {
    setSchemaVersionModalOpen(false)
    setSchemaVersions([])
    setGitSnapshotTask(undefined)
    setVersioningScopeConfig(undefined)
    setVersioningScopeDraft([])
    setSchemaVersionConnectionId(undefined)
  }

  const viewSchemaVersion = (connectionId: string, version: SchemaVersionInfo): void => {
    const connection = getConnection(connectionId)
    ddlPreviewModalRef.current?.open({
      title: `${connection?.name ?? '连接'} · 结构版本 ${version.id.slice(0, 7)}`,
      dialect: (connection?.database_type ?? 'sqlite') as SqlDialect,
      load: async () => {
        const snapshot = await requestJson<SchemaSnapshot>(
          `/git-versioning/connections/${connectionId}/versions/${version.id}`
        )
        const header = [
          `-- DataDjinn 结构版本：${version.id}`,
          `-- 创建时间：${new Date(snapshot.captured_at).toLocaleString()}`,
          `-- 对象数量：${snapshot.objects.length}`
        ]
        const definitions = snapshot.objects.map((item) => {
          const scope = item.scope ? `${item.scope}.` : ''
          return `-- ${item.type}: ${scope}${item.name}\n${item.ddl}`
        })
        const skipped = snapshot.skipped_objects.length
          ? [`-- 未纳入快照的对象：${snapshot.skipped_objects.length} 个（这些对象不支持生成 DDL）`]
          : []
        return [...header, ...definitions, ...skipped].join('\n\n')
      }
    })
  }

  const initializeGitHubSyncRepository = async (): Promise<void> => {
    try {
      const repository = await requestJson<{ full_name: string; html_url: string }>('/git-sync/repository', {
        method: 'POST'
      })
      setGitHubAuthStatus((current) => ({
        ...current,
        repository_full_name: repository.full_name,
        repository_url: repository.html_url
      }))
      messageApi.success('已创建并绑定 GitHub 私有同步仓库')
    } catch (error) {
      showError(error instanceof Error ? error.message : '创建私有同步仓库失败')
    }
  }

  const refreshOptionalModules = async (): Promise<void> => {
    setOptionalModules(await window.api.getOptionalModules())
    setOptionalModulesLoaded(true)
  }

  const refreshMcpLaunchConfig = async (): Promise<void> => {
    setMcpLaunchConfig(await window.api.getOptionalModuleLaunchConfig('mcp'))
  }

  const mcpModuleInstalled = optionalModules.some(
    (module) => module.id === 'mcp' && module.installed
  )
  const aiModuleInstalled = optionalModules.some(
    (module) => module.id === 'ai' && module.installed
  )
  const jdbcModuleInstalled = optionalModules.some(
    (module) => module.id === 'jdbc' && module.installed
  )
  const aiPanelVisible = optionalModulesLoaded && aiModuleInstalled && aiPanelOpen

  useEffect(() => {
    void refreshOptionalModules().catch(() => setOptionalModulesLoaded(true))
  }, [])

  useEffect(() => {
    if (optionalModulesLoaded && !aiModuleInstalled && aiPanelOpen) {
      setAiPanelOpen(false)
    }
  }, [aiModuleInstalled, aiPanelOpen, optionalModulesLoaded])

  const installOptionalModule = async (moduleId: OptionalModuleInfo['id']): Promise<void> => {
    if (installingOptionalModuleId) {
      return
    }
    const isUpdate = optionalModules.some((module) => module.id === moduleId && module.updateAvailable)
    setInstallingOptionalModuleId(moduleId)
    try {
      const updatedModules = await window.api.installOptionalModule(moduleId)
      setOptionalModules(updatedModules)
      setOptionalModulesLoaded(true)
      if (moduleId === 'mcp') {
        await refreshMcpLaunchConfig()
      }
      if (moduleId === 'ai') {
        setAiPanelOpen(true)
      }
      const updatedModule = updatedModules.find((module) => module.id === moduleId)
      messageApi.success(
        updatedModule?.pendingRestartRequired
          ? 'MCP 更新已下载，重启 MCP 调用方后生效'
          : isUpdate
            ? '扩展模块已更新'
            : '扩展模块已安装'
      )
    } catch (error) {
      showError(error instanceof Error ? error.message : '安装扩展模块失败')
    } finally {
      setInstallingOptionalModuleId(null)
    }
  }

  const uninstallOptionalModule = async (moduleId: OptionalModuleInfo['id']): Promise<void> => {
    try {
      setOptionalModules(await window.api.uninstallOptionalModule(moduleId))
      setOptionalModulesLoaded(true)
      if (moduleId === 'mcp') {
        await refreshMcpSettings()
        setMcpLaunchConfig(null)
      }
      if (moduleId === 'ai') {
        setAiPanelOpen(false)
      }
      messageApi.success('扩展模块已卸载')
    } catch (error) {
      showError(error instanceof Error ? error.message : '卸载扩展模块失败')
    }
  }

  const updateMcpSettings = async (patch: Partial<McpSettings>): Promise<void> => {
    const settings = await window.api.setMcpSettings({ ...mcpSettings, ...patch })
    setMcpSettings(settings)
  }

  const handleUpdateAvailable = (info: UpdateInfo): void => {
    setUpdateInfo(info)
    if (!downloadingUpdate) {
      setUpdateProgress(null)
    }
  }

  const checkForUpdates = async (manual = true): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const info = await window.api.checkForUpdates()
      setUpdateInfo(info)
      if (info.available) {
        handleUpdateAvailable(info)
      } else if (manual) {
        messageApi.success('当前已经是最新版本')
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '检查更新失败')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    setDownloadingUpdate(true)
    setUpdateProgress(null)
    try {
      await window.api.downloadUpdate()
      if (updateInfo?.mode === 'portable') {
        setDownloadingUpdate(false)
        messageApi.success('绿色版更新包已下载，请关闭应用后手动解压替换')
      }
    } catch (err) {
      setDownloadingUpdate(false)
      showError(err instanceof Error ? err.message : '下载更新失败')
    }
  }

  const installUpdate = async (): Promise<void> => {
    try {
      await window.api.installUpdate()
    } catch (err) {
      showError(err instanceof Error ? err.message : '安装更新失败')
    }
  }

  const skipUpdate = async (): Promise<void> => {
    if (!updateInfo?.latestVersion) {
      return
    }
    await window.api.skipUpdateVersion(updateInfo.latestVersion)
    await refreshUpdateSettings()
    updateModalRef.current?.close()
  }

  const normalizeRequestError = (error: unknown): ApiRequestError => {
    let message = error instanceof Error ? error.message : String(error || '操作失败')
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined
    message = message
      .replace(/^Error invoking remote method 'api:request':\s*Error:\s*/i, '')
      .replace(/\s*\(Background on this error at:[\s\S]*$/i, '')
      .trim()

    const friendlyPrefixMatch = message.match(
      /((?:SQL\s*语法错误|SQL\s*语句错误|数据库操作失败|Oracle\s*数据库操作失败|Redis\s*操作失败|PostgreSQL\s*\/\s*高斯数据库[^：:]*|Oracle\s*SQL\s*中引用了不存在的字段|Oracle\s*表或视图不存在|目标数据库不存在|数据表不存在|当前对象类型不支持查看\s*DDL)[：:][\s\S]*)/
    )
    if (friendlyPrefixMatch?.[1]) {
      message = friendlyPrefixMatch[1].trim()
    }

    if (message.includes('Timeout reading from socket')) {
      return new Error('请求后端超时，请检查数据库主机和端口是否正确、服务是否已启动，或稍后重试')
    }
    return Object.assign(new Error(message || '操作失败'), code ? { code } : {})
  }

  const requestJsonRaw = useCallback(
    async <T,>(path: string, options?: ApiRequestOptions): Promise<T> => {
      if (backendStatus.state !== 'online' || !backendStatus.apiBaseUrl) {
        throw new Error(backendStatus.message ?? '后端服务正在恢复，请稍后再试')
      }

      try {
        const response = await window.api.requestJson<T | ApiErrorResponse>(path, {
          method: options?.method,
          headers: options?.headers as Record<string, string> | undefined,
          body: typeof options?.body === 'string' ? options.body : undefined,
          timeoutMs: options?.timeoutMs
        })
        if (isApiErrorResponse(response)) {
          throw Object.assign(
            new Error(response.__datadjinnApiError),
            response.__datadjinnApiErrorCode ? { code: response.__datadjinnApiErrorCode } : {}
          )
        }
        return response
      } catch (err) {
        throw normalizeRequestError(err)
      }
    },
    [backendStatus.apiBaseUrl, backendStatus.message, backendStatus.state]
  )

  const getRequestConnectionId = (
    path: string,
    options?: ApiRequestOptions
  ): string | undefined => {
    const pathConnectionId = path.match(/^\/connections\/([^/?]+)/)?.[1]
    if (pathConnectionId) {
      return decodeURIComponent(pathConnectionId)
    }

    try {
      const requestUrl = new URL(path, 'http://localhost')
      const queryConnectionId =
        requestUrl.searchParams.get('connection_id') ?? requestUrl.searchParams.get('connectionId')
      if (queryConnectionId?.trim()) {
        return queryConnectionId
      }
    } catch {
      // Keep body-based connection extraction available for malformed relative paths.
    }

    if (typeof options?.body !== 'string') {
      return undefined
    }

    try {
      const body = JSON.parse(options.body) as { connection_id?: unknown; connectionId?: unknown }
      const bodyConnectionId = body.connection_id ?? body.connectionId
      return typeof bodyConnectionId === 'string' && bodyConnectionId.trim()
        ? bodyConnectionId
        : undefined
    } catch {
      return undefined
    }
  }

  const isReconnectableConnectionError = (error: ApiRequestError): boolean =>
    error.code === 'CONNECTION_UNAVAILABLE'

  const reconnectingConnectionsRef = useRef<Record<string, Promise<void> | undefined>>({})

  const reopenConnectionSilently = useCallback(
    async (connectionId: string): Promise<void> => {
      const pending = reconnectingConnectionsRef.current[connectionId]
      if (pending) {
        return pending
      }

      const reconnect = requestJsonRaw<ConnectionInfo>(`/connections/${connectionId}/open`, {
        method: 'POST'
      }).then((connection) => {
        setConnections((current) =>
          current.map((item) => (item.connection_id === connectionId ? connection : item))
        )
        setTreeData((current) =>
          replaceConnectionNode(current, connection, buildConnectionNode, true)
        )
      })
      reconnectingConnectionsRef.current[connectionId] = reconnect
      void reconnect
        .finally(() => {
          if (reconnectingConnectionsRef.current[connectionId] === reconnect) {
            delete reconnectingConnectionsRef.current[connectionId]
          }
        })
        .catch(() => undefined)
      return reconnect
    },
    [requestJsonRaw]
  )

  const requestJson = useCallback(
    async <T,>(path: string, options?: ApiRequestOptions): Promise<T> => {
      const connectionId = getRequestConnectionId(path, options)
      let lastConnectionError: ApiRequestError | undefined

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await requestJsonRaw<T>(path, options)
        } catch (err) {
          const error = normalizeRequestError(err)
          if (!connectionId || !isReconnectableConnectionError(error)) {
            throw error
          }
          lastConnectionError = error
          if (attempt === 1) {
            break
          }
          try {
            await reopenConnectionSilently(connectionId)
          } catch {
            // The next attempt keeps the UI silent while the connection recovers.
          }
        }
      }

      throw new Error(lastConnectionError ? '数据库连接暂时不可用，请稍后重试' : '操作失败')
    },
    [normalizeRequestError, reopenConnectionSilently, requestJsonRaw]
  )

  const loadSqlCompletionColumns = async (
    tab: WorkspaceTab,
    tableNames: string[]
  ): Promise<SqlCompletionColumn[]> => {
    if (!tab.connectionId || tableNames.length === 0) {
      return []
    }

    const connection = getConnection(tab.connectionId)
    const databaseName = isSchemaScopedType(connection?.database_type)
      ? tab.pgDatabaseName
      : tab.databaseName
    const schemaName = isSchemaScopedType(connection?.database_type) ? tab.databaseName : undefined
    const uniqueTableNames = [...new Set(tableNames.map((name) => name.trim()).filter(Boolean))]
    const result = await Promise.all(
      uniqueTableNames.map(async (tableName) => {
        const cacheKey = `${tab.connectionId}:${tab.pgDatabaseName ?? ''}:${tab.databaseName ?? ''}:${tableName}`
        const cached = completionColumnCacheRef.current[cacheKey]
        if (cached) {
          return cached
        }

        const pending = completionColumnRequestRef.current[cacheKey]
        if (pending) {
          return pending
        }

        const request = requestJson<ColumnsResponse>(
          withPgDatabase(
            `/connections/${tab.connectionId}/tables/${encodeURIComponent(tableName)}/columns`,
            tab.databaseName,
            tab.pgDatabaseName
          )
        )
          .then((data) =>
            data.columns.map<SqlCompletionColumn>((column: ColumnInfo) => ({
              name: column.name,
              type: column.type,
              tableName,
              databaseName,
              schemaName,
              nullable: column.nullable,
              primaryKey: column.primary_key
            }))
          )
          .catch(() => [])
          .then((columns) => {
            completionColumnCacheRef.current[cacheKey] = columns
            return columns
          })
          .finally(() => {
            delete completionColumnRequestRef.current[cacheKey]
          })
        completionColumnRequestRef.current[cacheKey] = request
        return request
      })
    )

    return result.flat()
  }

  const loadSqlCompletionRoutines = async (tab: WorkspaceTab): Promise<SqlCompletionRoutine[]> => {
    if (!tab.connectionId) {
      return []
    }

    const cacheKey = `${tab.connectionId}:${tab.databaseName ?? ''}`
    const cached = completionRoutineCacheRef.current[cacheKey]
    if (cached) {
      return cached
    }

    const pending = completionRoutineRequestRef.current[cacheKey]
    if (pending) {
      return pending
    }

    const databaseQuery = tab.databaseName ? `?database=${encodeURIComponent(tab.databaseName)}` : ''
    const request = requestJson<{ objects: DbObjectInfo[] }>(
      `/connections/${tab.connectionId}/objects${databaseQuery}${databaseQuery ? '&' : '?'}type=procedure`
    )
      .then((data) =>
        data.objects.flatMap<SqlCompletionRoutine>((object) =>
          object.type === 'procedure' || object.type === 'function'
            ? [{ name: object.name, type: object.type, databaseName: tab.databaseName }]
            : []
        )
      )
      .catch(() => [])
      .then((routines) => {
        completionRoutineCacheRef.current[cacheKey] = routines
        setCompletionRoutines((current) => ({ ...current, [cacheKey]: routines }))
        return routines
      })
      .finally(() => {
        delete completionRoutineRequestRef.current[cacheKey]
      })
    completionRoutineRequestRef.current[cacheKey] = request
    return request
  }

  const buildSqlCompletionContext = (tab: WorkspaceTab): SqlCompletionContext => {
    const connection = getConnection(tab.connectionId)
    const scopeKey = tab.connectionId
      ? `${tab.connectionId}:${tab.pgDatabaseName ?? ''}:${tab.databaseName ?? ''}`
      : ''
    const loadedScope = scopeKey ? loadedCompletionIndex.get(scopeKey) : undefined
    const tables = loadedScope ? [...loadedScope.tables] : []
    const columns = loadedScope ? [...loadedScope.columns] : []

    const cacheKey = tab.connectionId ? `${tab.connectionId}:${tab.databaseName ?? ''}` : ''

    if (cacheKey && completionTables[cacheKey]) {
      const existingTableNames = new Set(tables.map((table) => table.name))
      for (const tableName of completionTables[cacheKey]) {
        if (!existingTableNames.has(tableName)) {
          tables.push({ name: tableName, databaseName: tab.databaseName })
          existingTableNames.add(tableName)
        }
      }
    }

    const databaseNames =
      connection?.database_type === 'sqlite' ? [] : (allDatabases[tab.connectionId ?? ''] ?? [])
    const schemaKey =
      tab.connectionId && (tab.pgDatabaseName ?? tab.databaseName)
        ? `${tab.connectionId}:${tab.pgDatabaseName ?? tab.databaseName}`
        : ''

    return {
      dialect: connection?.database_type,
      connectionId: tab.connectionId,
      databaseName: tab.databaseName,
      pgDatabaseName: tab.pgDatabaseName,
      schemaName: isSchemaScopedType(connection?.database_type) ? tab.databaseName : undefined,
      databases: databaseNames,
      schemas: schemaKey ? (allSchemas[schemaKey] ?? []) : [],
      tables,
      columns,
      routines: cacheKey ? (completionRoutines[cacheKey] ?? []) : [],
      loadRoutines: () => loadSqlCompletionRoutines(tab),
      loadTableColumns: (tableNames) => loadSqlCompletionColumns(tab, tableNames)
    }
  }

  const buildSqlCompletionContextRef = useRef(buildSqlCompletionContext)
  buildSqlCompletionContextRef.current = buildSqlCompletionContext

  const renderConnectionTitle = (
    node: DatabaseTreeNode,
    connection: ConnectionInfo
  ): React.ReactNode => {
    const loadingText = connectionTreeLoading[connection.connection_id]
    const loading = Boolean(loadingText)
    const isFocused =
      focusedTreeNode?.connectionId === connection.connection_id &&
      focusedTreeNode?.kind === 'connection'
    const isSelected = selectedConnectionIds.includes(connection.connection_id)
    const connectionAddress = getConnectionAddress(connection)
    const connectionMeta = connectionAddress
      ? `${connection.name} · ${connectionAddress}`
      : connection.name
    const currentFolderId = connectionFolderAssignments[connection.connection_id]
    const isPinnedRootConnection =
      !currentFolderId && pinnedRootItemIds.includes(rootConnectionOrderId(connection.connection_id))
    const connectionDropZone =
      dragOverConnectionTarget?.connectionId === connection.connection_id
        ? dragOverConnectionTarget.zone
        : undefined

    return (
      <>
        {/*
        menu={{
          items: [
            ...(connection.is_open
              ? [
                  { key: 'close', label: '关闭连接', icon: <CloseCircleOutlined />, disabled: loading },
                ]
              : [
                  { key: 'open', label: '打开连接', icon: <PlayCircleOutlined />, disabled: loading },
                ]),
          ...(connection.database_type === 'redis' || connection.database_type === 'oracle' ? [] : [{
            key: 'new-database',
            label: connection.database_type === 'sqlite' ? '新增 SQLite 数据库文件' : '新建库',
            icon: <PlusOutlined />
          }]),
          ...(connection.database_type !== 'mongodb' && connection.database_type !== 'redis' ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }] : [])
        ],
        onClick: ({ key }) => {
          if (key === 'open') {
            void openConnectionById(connection.connection_id)
          }
          if (key === 'close') {
            void closeConnectionById(connection.connection_id)
          }
          if (key === 'new-database') {
            if (connection.database_type === 'sqlite') {
              void openConnectionModal('sqlite')
            } else {
              setCreatingDatabaseConnectionId(connection.connection_id)
              setCreatingSchemaDatabaseName('')
              setDatabaseCreateName('')
              setDatabaseCreateModalOpen(true)
            }
          }
          if (key === 'run-sql') {
            void openSqlFileDialog(connection.connection_id)
          }
        }
      }}
        */}
        <Flex
          className={`connection-tree-title resource-tree-node-title ${connection.is_open ? 'is-open' : 'is-closed'}${isSelected ? ' is-selected' : ''}${connectionDropZone ? ` connection-drop-${connectionDropZone}` : ''}`}
          align="center"
          title={connectionMeta}
          data-connection-id={connection.connection_id}
          data-tree-node-key={String(node.key)}
          onDragStart={() => {
            const folderId = connectionFolderAssignments[connection.connection_id]
            draggingConnectionIdsRef.current = (selectedConnectionIds.includes(
              connection.connection_id
            )
              ? selectedConnectionIds
              : [connection.connection_id]
            ).filter((connectionId) => connectionFolderAssignments[connectionId] === folderId)
            draggingConnectionFolderIdRef.current = folderId
          }}
          onDragOver={(event) => {
            const movingConnectionIds = draggingConnectionIdsRef.current
            if (
              movingConnectionIds.length === 0 ||
              movingConnectionIds.includes(connection.connection_id) ||
              !currentFolderId ||
              draggingConnectionFolderIdRef.current !== currentFolderId
            ) {
              return
            }
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            updateDragOverConnectionTarget({
              connectionId: connection.connection_id,
              folderId: currentFolderId,
              zone: event.clientY - rect.top >= rect.height / 2 ? 'after' : 'before'
            })
          }}
          onDrop={(event) => {
            const movingConnectionIds = draggingConnectionIdsRef.current
            if (
              movingConnectionIds.length === 0 ||
              movingConnectionIds.includes(connection.connection_id) ||
              !currentFolderId ||
              draggingConnectionFolderIdRef.current !== currentFolderId
            ) {
              clearConnectionDragState()
              return
            }
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            reorderFolderConnections(
              currentFolderId,
              movingConnectionIds,
              connection.connection_id,
              event.clientY - rect.top >= rect.height / 2
            )
            clearConnectionDragState()
          }}
        >
          <div className="connection-tree-main">
            <Typography.Text className="connection-tree-name" ellipsis title={connection.name}>
              {highlightTreeSearchText(connection.name)}
            </Typography.Text>
            {isPinnedRootConnection && (
              <PushpinOutlined className="tree-root-pin-icon" title="已置顶" />
            )}
            {connection.git_versioning_enabled && (
              <button
                type="button"
                className="connection-git-status-icon"
                title="打开该连接的 Git 版本管理"
                aria-label={`打开 ${connection.name} 的 Git 版本管理`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void openSchemaVersionModal(connection.connection_id)
                }}
              >
                <GithubOutlined />
              </button>
            )}
            {connectionAddress && (
              <Typography.Text
                type="secondary"
                className="connection-tree-address"
                ellipsis
                title={connectionAddress}
              >
                {highlightTreeSearchText(connectionAddress)}
              </Typography.Text>
            )}
          </div>
          {(isFocused || isSelected) && (
            <Space className="connection-tree-actions" size={2}>
              {renderAIContextButton(node)}
              {renderDatabaseSelector(connection.connection_id)}
              <Button
                className="connection-tree-icon-btn"
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                loading={loading}
                disabled={loading}
                title={loadingText ?? '刷新连接'}
                onClick={(event) => {
                  event.stopPropagation()
                  refreshConnectionNode(connection.connection_id)
                }}
              />
              <Button
                className="connection-tree-icon-btn"
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(event) => {
                  event.stopPropagation()
                  void openEditConnectionModal(connection)
                }}
              />
              <Button
                className="connection-tree-icon-btn"
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={(event) => {
                  event.stopPropagation()
                  void deleteConnection(connection.connection_id)
                }}
              />
            </Space>
          )}
        </Flex>
      </>
    )
  }

  const connectionTypeIcons = createConnectionTypeIcons()

  const buildConnectionNode = (connection: ConnectionInfo): DatabaseTreeNode =>
    buildConnectionNodeFromModule(connection, connectionTypeIcons)

  const buildFolderNode = (
    folder: ConnectionFolder,
    children: DatabaseTreeNode[],
    isNested?: boolean
  ): DatabaseTreeNode =>
    buildFolderNodeFromModule(folder, children, FOLDER_DROP_PLACEHOLDER_KEY_PREFIX, isNested)

  const highlightTreeSearchText = (text: string): React.ReactNode => {
    const keyword = treeSearchText.trim()
    if (!keyword) {
      return text
    }
    const lowerText = text.toLowerCase()
    const lowerKeyword = keyword.toLowerCase()
    const matchIndex = lowerText.indexOf(lowerKeyword)
    if (matchIndex < 0) {
      return text
    }
    const matchEnd = matchIndex + keyword.length
    return (
      <>
        {text.slice(0, matchIndex)}
        <mark className="tree-search-highlight">{text.slice(matchIndex, matchEnd)}</mark>
        {text.slice(matchEnd)}
      </>
    )
  }

  const locateTreePath = async (
    targetPath?: string[],
    expandTarget = true
  ): Promise<void> => {
    await locateTreePathInView({
      targetPath,
      expandTarget,
      treeDataRef,
      expandedKeysRef,
      setExpandedKeys,
      reloadNodeChildren,
      handleTreeSelection: (node) => handleTreeSelection(node),
      resourceTreeContainerRef,
      resourceTreeRef,
      resourceTreeViewportRef,
      enableVirtualTree,
      resourceTreeHeight,
      resourceTreeItemHeight: RESOURCE_TREE_ITEM_HEIGHT
    })
  }

  const locateActiveTreeNode = async (): Promise<void> => {
    const currentTab = useWorkspaceStore.getState().activeTabKey
      ? useWorkspaceStore.getState().getTabByKey(useWorkspaceStore.getState().activeTabKey)
      : undefined
    await locateTreePath(buildActiveTreePath(currentTab))
  }

  const treeSearchMatches = useMemo(
    () => collectTreeSearchMatches(treeData, connections, treeSearchText.trim().toLowerCase()),
    [connections, treeData, treeSearchText]
  )

  const navigateTreeSearchMatch = useCallback(
    (offset: number): void => {
      if (treeSearchMatches.length === 0) {
        return
      }
      setTreeSearchMatchIndex(
        (current) =>
          (current + offset + treeSearchMatches.length) % treeSearchMatches.length
      )
    },
    [treeSearchMatches.length]
  )

  useEffect(() => {
    treeSearchMatchesRef.current = treeSearchMatches
  }, [treeSearchMatches])

  useEffect(() => {
    setTreeSearchMatchIndex(0)
  }, [treeSearchText])

  useEffect(() => {
    setTreeSearchMatchIndex((current) =>
      treeSearchMatches.length === 0 ? 0 : Math.min(current, treeSearchMatches.length - 1)
    )
  }, [treeSearchMatches.length])

  useEffect(() => {
    const match = treeSearchMatchesRef.current[treeSearchMatchIndex]
    if (!match) {
      return
    }
    void locateTreePath(match.path, false).catch(() => undefined)
  }, [treeSearchMatchIndex, treeSearchText])

  useEffect(() => {
    if (!treeSearchOpen) {
      return
    }
    requestAnimationFrame(() => {
      treeSearchInputRef.current?.focus()
    })
  }, [treeSearchOpen])

  const buildResourceTree = (
    nextConnections: ConnectionInfo[],
    currentNodes: DatabaseTreeNode[] = []
  ): DatabaseTreeNode[] => {
    const validFolderIds = new Set(connectionFolders.map((folder) => folder.id))
    const rootFolders = connectionFolders.filter(
      (folder) => !folder.parentId || !validFolderIds.has(folder.parentId)
    )
    const orderedRootFolderIds = mergeOrderedIds(
      rootFolders.map((folder) => folder.id),
      connectionFolderOrder
    )
    const defaultRootItemOrder = [
      ...orderedRootFolderIds.map(rootFolderOrderId),
      ...nextConnections
        .filter(
          (connection) =>
            !connectionFolderAssignments[connection.connection_id] ||
            !validFolderIds.has(connectionFolderAssignments[connection.connection_id])
        )
        .map((connection) => rootConnectionOrderId(connection.connection_id))
    ]
    return buildResourceTreeFromModule(nextConnections, currentNodes, {
      connectionFolderAssignments,
      connectionFolders,
      folderOrder: connectionFolderOrder,
      folderConnectionOrder,
      rootItemOrder:
        rootItemOrderCustomized && rootItemOrder.length > 0
          ? rootItemOrder
          : defaultRootItemOrder,
      pinnedRootItemIds,
      rootFolderOrderId,
      rootConnectionOrderId,
      mergeOrderedIds,
      buildConnectionNode,
      buildFolderNode: (folder, children, isNested) => buildFolderNode(folder, children, isNested)
    })
  }

  const refreshTree = (nextConnections: ConnectionInfo[]): void => {
    setTreeData((current) => buildResourceTree(nextConnections, current))
  }

  useEffect(() => {
    refreshTree(connections)
  }, [
    connections,
    connectionFolders,
    connectionFolderAssignments,
    rootItemOrder,
    rootItemOrderCustomized,
    pinnedRootItemIds,
    folderConnectionOrder
  ])

  useEffect(() => {
    const treeNodesByKey = collectTreeNodesByKey(treeData)
    if (treeNodesByKey.size === 0) {
      return
    }

    setExpandedKeys((current) => {
      const next = current.filter((key) => {
        const node = treeNodesByKey.get(String(key))
        if (!node || node.closed || node.isLeaf) {
          return false
        }
        if (node.kind === 'folder') {
          return true
        }
        return Boolean(node.childrenLoaded || node.children?.length)
      })

      return current.length === next.length && current.every((item, index) => item === next[index])
        ? current
        : next
    })
  }, [treeData])

  useEffect(() => {
    const closedConnectionIds = new Set(
      connections
        .filter((connection) => !connection.is_open)
        .map((connection) => connection.connection_id)
    )
    if (closedConnectionIds.size === 0) {
      return
    }

    setExpandedKeys((current) => {
      const next = current.filter((key) => {
        const value = String(key)
        for (const connectionId of closedConnectionIds) {
          if (value === `connection:${connectionId}` || value.includes(`:${connectionId}:`)) {
            return false
          }
        }
        return true
      })
      return current.length === next.length && current.every((item, index) => item === next[index])
        ? current
        : next
    })
  }, [connections])

  const refreshConnectionNode = (
    connectionId: string,
    selectedDatabaseOverride?: string[]
  ): void => {
    const restoreTreeScrollPosition = captureResourceTreeScrollPosition()
    refreshConnectionTreeNode({
      connectionId,
      selectedDatabaseOverride,
      getConnection,
      expandedKeysRef,
      preloadConnectionTree,
      buildConnectionNode,
      setTreeData,
      setExpandedKeys,
      setConnectionTreeLoadingText,
      showError,
      onUpdated: restoreTreeScrollPosition
    })
  }

  const refreshDatabaseNode = (
    connectionId: string,
    databaseName: string,
    selectedSchemaOverride?: string[]
  ): void => {
    const restoreTreeScrollPosition = captureResourceTreeScrollPosition()
    refreshDatabaseTreeNode({
      connectionId,
      databaseName,
      selectedSchemaOverride,
      getConnection,
      preloadDatabaseChildren,
      setTreeData,
      setConnectionTreeLoadingText,
      showError,
      onUpdated: restoreTreeScrollPosition
    })
  }

  const setConnectionTreeLoadingText = (connectionId: string, text?: string): void => {
    setConnectionTreeLoading((current) => {
      if (!text) {
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== connectionId))
      }
      return { ...current, [connectionId]: text }
    })
  }

  const folderNameExists = (name: string, excludeFolderId?: string): boolean =>
    connectionFolders.some(
      (folder) =>
        folder.id !== excludeFolderId &&
        folder.name.trim().toLowerCase() === name.trim().toLowerCase()
    )

  const createConnectionFolder = (name: string): string | undefined => {
    const nextName = name.trim()
    if (!nextName) {
      messageApi.warning('请输入分组名称')
      return undefined
    }
    if (folderNameExists(nextName)) {
      messageApi.warning('分组名称已存在')
      return undefined
    }

    const folderId = globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}`
    setConnectionFolders((current) => [...current, { id: folderId, name: nextName }])
    setConnectionFolderOrder((current) => [...current.filter((id) => id !== folderId), folderId])
    setExpandedKeys((current) =>
      current.includes(`folder:${folderId}`) ? current : [...current, `folder:${folderId}`]
    )
    return folderId
  }

  const openCreateFolderModal = (parentFolderId?: string): void => {
    setFolderEditorMode('create')
    setEditingFolderId(undefined)
    setCreatingFolderParentId(parentFolderId)
    setFolderNameDraft('')
    setFolderEditorOpen(true)
  }

  const openRenameFolderModal = (folderId: string): void => {
    const folder = connectionFolders.find((item) => item.id === folderId)
    if (!folder) {
      return
    }
    setFolderEditorMode('rename')
    setEditingFolderId(folderId)
    setCreatingFolderParentId(undefined)
    setFolderNameDraft(folder.name)
    setFolderEditorOpen(true)
  }

  const saveFolder = (): void => {
    const nextName = folderNameDraft.trim()
    if (!nextName) {
      messageApi.warning('请输入分组名称')
      return
    }
    if (folderNameExists(nextName, editingFolderId)) {
      messageApi.warning('分组名称已存在')
      return
    }

    if (folderEditorMode === 'rename' && editingFolderId) {
      setConnectionFolders((current) =>
        current.map((folder) =>
          folder.id === editingFolderId ? { ...folder, name: nextName } : folder
        )
      )
    } else {
      const folderId = globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}`
      setConnectionFolders((current) => [
        ...current,
        { id: folderId, name: nextName, parentId: creatingFolderParentId }
      ])
      if (!creatingFolderParentId) {
        setConnectionFolderOrder((current) => [...current.filter((id) => id !== folderId), folderId])
      }
      setExpandedKeys((current) =>
        Array.from(
          new Set([
            ...current,
            `folder:${folderId}`,
            ...(creatingFolderParentId ? [`folder:${creatingFolderParentId}`] : [])
          ])
        )
      )
      setSelectedTreeKeys([`folder:${folderId}`])
    }

    setFolderEditorOpen(false)
    setEditingFolderId(undefined)
    setCreatingFolderParentId(undefined)
    setFolderNameDraft('')
  }

  const deleteFolder = (folderId: string): void => {
    const folder = connectionFolders.find((item) => item.id === folderId)
    if (!folder) {
      return
    }

    Modal.confirm({
      title: `删除分组“${folder.name}”`,
      content: '删除后，里面的连接会自动移回根目录，子分组会提升到当前层级，不会删除连接本身。是否继续？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      onOk: () => {
        setConnectionFolders((current) =>
          current
            .filter((item) => item.id !== folderId)
            .map((item) =>
              item.parentId === folderId ? { ...item, parentId: folder.parentId } : item
            )
        )
        setConnectionFolderOrder((current) => current.filter((id) => id !== folderId))
        setPinnedRootItemIds((current) =>
          current.filter((itemId) => itemId !== rootFolderOrderId(folderId))
        )
        setFolderConnectionOrder((current) => {
          return Object.fromEntries(Object.entries(current).filter(([id]) => id !== folderId))
        })
        setConnectionFolderAssignments((current) =>
          Object.fromEntries(Object.entries(current).filter(([, value]) => value !== folderId))
        )
        setExpandedKeys((current) => current.filter((key) => key !== `folder:${folderId}`))
        setSelectedTreeKeys((current) => current.filter((key) => key !== `folder:${folderId}`))
        setFocusedTreeNode((current) =>
          current?.kind === 'folder' && current.folderId === folderId ? undefined : current
        )
      }
    })
  }

  const captureResourceTreeScrollPosition = useCallback((): (() => void) => {
    const treeViewport = resourceTreeViewportRef.current
    const treeScrollHost =
      treeViewport?.querySelector<HTMLElement>('.ant-tree-list-holder') ?? treeViewport
    const scrollTop = treeScrollHost?.scrollTop
    return () => {
      if (scrollTop === undefined) {
        return
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const nextViewport = resourceTreeViewportRef.current
          const nextScrollHost =
            nextViewport?.querySelector<HTMLElement>('.ant-tree-list-holder') ?? nextViewport
          if (nextScrollHost) {
            nextScrollHost.scrollTop = scrollTop
          }
        })
      })
    }
  }, [])

  const moveConnectionsToFolder = (connectionIds: string[], folderId?: string): void => {
    if (connectionIds.length === 0) {
      return
    }

    const restoreTreeScrollPosition = captureResourceTreeScrollPosition()
    const nextConnectionFolderAssignments = { ...connectionFolderAssignments }
    for (const connectionId of connectionIds) {
      if (folderId) {
        nextConnectionFolderAssignments[connectionId] = folderId
      } else {
        delete nextConnectionFolderAssignments[connectionId]
      }
    }
    const nextRootConnectionOrder = folderId
      ? rootConnectionOrder.filter((id) => !connectionIds.includes(id))
      : [...rootConnectionOrder.filter((id) => !connectionIds.includes(id)), ...connectionIds]
    const connectionItemIds = connectionIds.map(rootConnectionOrderId)
    const nextRootItemOrder = folderId
      ? rootItemOrder.filter((id) => !connectionItemIds.includes(id))
      : [...rootItemOrder.filter((id) => !connectionItemIds.includes(id)), ...connectionItemIds]
    const nextFolderConnectionOrder: Record<string, string[]> = Object.fromEntries(
      Object.entries(folderConnectionOrder).map(([currentFolderId, ids]) => [
        currentFolderId,
        ids.filter((id) => !connectionIds.includes(id))
      ])
    )
    if (folderId) {
      nextFolderConnectionOrder[folderId] = [
        ...(nextFolderConnectionOrder[folderId] ?? []),
        ...connectionIds.filter((id) => !(nextFolderConnectionOrder[folderId] ?? []).includes(id))
      ]
    }

    const nextTreePreferences = {
      connection_folders: connectionFolders,
      connection_folder_assignments: nextConnectionFolderAssignments,
      connection_folder_order: connectionFolderOrder,
      root_connection_order: nextRootConnectionOrder,
      root_item_order: nextRootItemOrder,
      root_item_order_customized: rootItemOrderCustomized,
      pinned_root_item_ids: pinnedRootItemIds,
      folder_connection_order: nextFolderConnectionOrder,
      selected_databases: selectedDatabasesRef.current,
      selected_schemas: selectedSchemasRef.current
    }
    // 分组调整必须在当前事件内写入全部三处。不能只依赖 React effect，
    // 否则关闭应用或覆盖安装时可能在 effect 执行前丢失映射。
    localStorage.setItem(STORAGE_CONNECTION_FOLDERS, JSON.stringify(nextTreePreferences.connection_folders))
    localStorage.setItem(
      STORAGE_CONNECTION_FOLDER_ASSIGNMENTS,
      JSON.stringify(nextTreePreferences.connection_folder_assignments)
    )
    localStorage.setItem(
      STORAGE_CONNECTION_FOLDER_ORDER,
      JSON.stringify(nextTreePreferences.connection_folder_order)
    )
    localStorage.setItem(
      STORAGE_ROOT_CONNECTION_ORDER,
      JSON.stringify(nextTreePreferences.root_connection_order)
    )
    localStorage.setItem(STORAGE_ROOT_ITEM_ORDER, JSON.stringify(nextTreePreferences.root_item_order))
    localStorage.setItem(
      STORAGE_ROOT_ITEM_ORDER_CUSTOMIZED,
      String(nextTreePreferences.root_item_order_customized)
    )
    localStorage.setItem(
      STORAGE_PINNED_ROOT_ITEM_IDS,
      JSON.stringify(nextTreePreferences.pinned_root_item_ids)
    )
    localStorage.setItem(
      STORAGE_FOLDER_CONNECTION_ORDER,
      JSON.stringify(nextTreePreferences.folder_connection_order)
    )
    void Promise.all([
      window.api.setConnectionTreePreferences(nextTreePreferences),
      requestJson('/preferences/connection-tree', {
        method: 'PUT',
        body: JSON.stringify({ preferences: nextTreePreferences })
      })
    ]).catch(() => undefined)
    setConnectionFolderAssignments(nextConnectionFolderAssignments)
    restoreTreeScrollPosition()

    setRootConnectionOrder(nextRootConnectionOrder)
    setRootItemOrder(nextRootItemOrder)
    setFolderConnectionOrder(nextFolderConnectionOrder)
  }

  const reorderFolderNodes = (
    movingFolderId: string,
    targetFolderId: string,
    placeAfter: boolean
  ): void => {
    setRootItemOrderCustomized(true)
    setConnectionFolderOrder((current) => {
      const ordered = mergeOrderedIds(
        connectionFolders.map((folder) => folder.id),
        current
      )
      return insertIdsAroundTarget(ordered, [movingFolderId], targetFolderId, placeAfter)
    })
    setRootItemOrder((current) => {
      const available = [
        ...connectionFolders.map((folder) => rootFolderOrderId(folder.id)),
        ...connections
          .filter((connection) => !connectionFolderAssignments[connection.connection_id])
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ]
      return insertIdsAroundTarget(
        mergeOrderedIds(available, current),
        [rootFolderOrderId(movingFolderId)],
        rootFolderOrderId(targetFolderId),
        placeAfter
      )
    })
  }

  const reorderRootConnections = (
    movingConnectionIds: string[],
    targetConnectionId: string,
    placeAfter: boolean
  ): void => {
    setRootItemOrderCustomized(true)
    setRootConnectionOrder((current) => {
      const rootIds = connections
        .filter((connection) => !connectionFolderAssignments[connection.connection_id])
        .map((connection) => connection.connection_id)
      const ordered = mergeOrderedIds(rootIds, current)
      return insertIdsAroundTarget(ordered, movingConnectionIds, targetConnectionId, placeAfter)
    })
    setRootItemOrder((current) => {
      const available = [
        ...connectionFolders.map((folder) => rootFolderOrderId(folder.id)),
        ...connections
          .filter(
            (connection) =>
              !connectionFolderAssignments[connection.connection_id] ||
              movingConnectionIds.includes(connection.connection_id)
          )
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ]
      return insertIdsAroundTarget(
        mergeOrderedIds(available, current),
        movingConnectionIds.map(rootConnectionOrderId),
        rootConnectionOrderId(targetConnectionId),
        placeAfter
      )
    })
  }

  const reorderFolderConnections = (
    folderId: string,
    movingConnectionIds: string[],
    targetConnectionId: string,
    placeAfter: boolean
  ): void => {
    const movableConnectionIds = movingConnectionIds.filter(
      (connectionId) => connectionFolderAssignments[connectionId] === folderId
    )
    if (movableConnectionIds.length === 0) {
      return
    }
    setFolderConnectionOrder((current) => {
      const folderIds = Array.from(
        new Set([
          ...(current[folderId] ?? []),
          ...connections
            .filter(
              (connection) => connectionFolderAssignments[connection.connection_id] === folderId
            )
            .map((connection) => connection.connection_id)
        ])
      ).filter((connectionId) =>
        connections.some((connection) => connection.connection_id === connectionId)
      )
      const ordered = mergeOrderedIds(folderIds, current[folderId] ?? [])
      return {
        ...current,
        [folderId]: insertIdsAroundTarget(
          ordered,
          movableConnectionIds,
          targetConnectionId,
          placeAfter
        )
      }
    })
  }

  const getVisibleFolderConnectionOrder = (
    folderId: string,
    movingConnectionIds: string[]
  ): string[] => {
    const movingSet = new Set(movingConnectionIds)
    const treeElement = resourceTreeViewportRef.current
    if (!treeElement) {
      return []
    }

    return Array.from(
      treeElement.querySelectorAll<HTMLElement>('.connection-tree-title[data-connection-id]')
    )
      .map((titleElement) => {
        const connectionId = titleElement.dataset.connectionId
        const rect = titleElement.getBoundingClientRect()
        return connectionId &&
          connectionFolderAssignments[connectionId] === folderId &&
          !movingSet.has(connectionId) &&
          rect.height > 0 &&
          rect.width > 0
          ? { connectionId, titleElement, rect }
          : undefined
      })
      .filter((item): item is { connectionId: string; titleElement: HTMLElement; rect: DOMRect } =>
        Boolean(item)
      )
      .sort((left, right) => left.rect.top - right.rect.top)
      .map((item) => item.connectionId)
  }

  const reorderFolderConnectionsByPointer = (
    folderId: string,
    movingConnectionIds: string[],
    clientY: number
  ): boolean => {
    const visibleOrderedIds = getVisibleFolderConnectionOrder(folderId, movingConnectionIds)
    if (visibleOrderedIds.length === 0) {
      return false
    }

    const movingSet = new Set(movingConnectionIds)
    const currentOrder = folderConnectionOrder[folderId] ?? []
    const allFolderIds = mergeOrderedIds(
      connections
        .filter((connection) => connectionFolderAssignments[connection.connection_id] === folderId)
        .map((connection) => connection.connection_id),
      currentOrder
    )
    const stationaryIds = allFolderIds.filter((connectionId) => !movingSet.has(connectionId))
    const visibleIndexById = new Map(
      visibleOrderedIds.map((connectionId, index) => [connectionId, index])
    )
    const stationaryVisibleIds = stationaryIds.filter((connectionId) =>
      visibleIndexById.has(connectionId)
    )
    if (stationaryVisibleIds.length === 0) {
      return false
    }

    const treeElement = resourceTreeViewportRef.current
    if (!treeElement) {
      return false
    }

    const rowElements = Array.from(
      treeElement.querySelectorAll<HTMLElement>('.connection-tree-title[data-connection-id]')
    )
      .filter((element) => {
        const connectionId = element.dataset.connectionId
        return connectionId ? stationaryVisibleIds.includes(connectionId) : false
      })
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)

    const insertVisibleIndex = rowElements.findIndex(
      (element) =>
        clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
    )
    const targetVisibleIndex =
      insertVisibleIndex >= 0 ? insertVisibleIndex : stationaryVisibleIds.length
    const beforeIds = stationaryVisibleIds.slice(0, targetVisibleIndex)
    const afterIds = stationaryVisibleIds.slice(targetVisibleIndex)
    const hiddenIds = stationaryIds.filter((connectionId) => !visibleIndexById.has(connectionId))
    const nextOrder = [...beforeIds, ...movingConnectionIds, ...afterIds, ...hiddenIds]

    if (stringArrayEquals(currentOrder, nextOrder)) {
      return false
    }

    setFolderConnectionOrder((current) =>
      stringArrayEquals(current[folderId] ?? [], nextOrder)
        ? current
        : {
            ...current,
            [folderId]: nextOrder
          }
    )
    return true
  }

  const getVisibleConnectionIds = (): string[] => {
    return getVisibleConnectionIdsFromTree(treeData, expandedKeys)
  }

  const selectConnectionNodes = (connectionIds: string[], anchorId?: string): void => {
    selectConnectionTreeNodes(
      connectionIds,
      anchorId,
      setSelectedConnectionIds,
      setSelectedTreeKeys,
      setConnectionSelectionAnchorId
    )
  }

  const handleTreeSelection = (node: DatabaseTreeNode, nativeEvent?: MouseEvent): void => {
    handleTreeSelectionChange({
      node,
      nativeEvent,
      resourceTreeContainer: resourceTreeContainerRef.current,
      connectionSelectionAnchorId,
      selectedConnectionIds,
      getVisibleConnectionIds,
      setFocusedTreeNode,
      setSelectedConnectionId,
      setSelectedConnectionIds,
      setSelectedTreeKeys,
      setConnectionSelectionAnchorId
    })
  }

  const getTreeNodeKindFromKey = (node: Partial<DatabaseTreeNode>): TreeNodeKind | undefined => {
    const key = String(node.key ?? '')
    if (node.kind) {
      return node.kind
    }
    if (key.startsWith('folder:')) {
      return 'folder'
    }
    if (key.startsWith(FOLDER_DROP_PLACEHOLDER_KEY_PREFIX)) {
      return 'folder-drop-placeholder'
    }
    if (key.startsWith('connection:')) {
      return 'connection'
    }
    return undefined
  }

  const allowTreeDrop = ({ dragNode, dropNode, dropPosition }: {
    dragNode: unknown
    dropNode: unknown
    dropPosition: number
  }): boolean => {
    const draggedNode = dragNode as Partial<DatabaseTreeNode>
    const targetNode = dropNode as Partial<DatabaseTreeNode>
    const draggedKind = getTreeNodeKindFromKey(draggedNode)
    const targetKind = getTreeNodeKindFromKey(targetNode)

    if (draggedKind === 'folder') {
      return targetKind === 'folder' && dropPosition !== 0
    }
    if (draggedKind !== 'connection' || targetKind !== 'connection') {
      return false
    }

    const draggedConnectionId = draggedNode.connectionId
    const targetConnectionId = targetNode.connectionId
    return Boolean(
      draggedConnectionId &&
        targetConnectionId &&
        connectionFolderAssignments[draggedConnectionId] ===
          connectionFolderAssignments[targetConnectionId]
    )
  }

  const updateDragOverFolderTarget = (target?: {
    folderId: string
    zone: 'before' | 'after'
  }): void => {
    dragOverFolderTargetRef.current = target
    setDragOverFolderTarget((current) =>
      current?.folderId === target?.folderId && current?.zone === target?.zone ? current : target
    )
  }

  const updateDragOverConnectionTarget = (target?: {
    connectionId: string
    folderId?: string
    zone: 'before' | 'after'
  }): void => {
    dragOverConnectionTargetRef.current = target
    setDragOverConnectionTarget((current) =>
      current?.connectionId === target?.connectionId &&
      current?.folderId === target?.folderId &&
      current?.zone === target?.zone
        ? current
        : target
    )
  }

  const clearConnectionDragState = (): void => {
    draggingConnectionIdsRef.current = []
    draggingConnectionFolderIdRef.current = undefined
    updateDragOverConnectionTarget(undefined)
  }

  const handleTreeDrop = (info: {
    node: unknown
    dragNode: unknown
    dropToGap?: boolean
    dropPosition?: number
    event?: { clientY: number; target: EventTarget | null }
  }): void => {
    const targetNode = info.node as DatabaseTreeNode
    const draggedNode = info.dragNode as DatabaseTreeNode
    const dropPosition = info.dropPosition ?? 0
    const relativeDropPosition = getRelativeDropPosition(targetNode, dropPosition)
    const placeAfter = relativeDropPosition > 0

    const targetFolderId =
      targetNode.folderId ??
      (String(targetNode.key).startsWith('folder:')
        ? String(targetNode.key).slice('folder:'.length)
        : undefined)
    const targetConnectionId =
      targetNode.connectionId ??
      (String(targetNode.key).startsWith('connection:')
        ? String(targetNode.key).slice('connection:'.length)
        : undefined)
    const draggedFolderId =
      draggedNode.folderId ??
      (String(draggedNode.key).startsWith('folder:')
        ? String(draggedNode.key).slice('folder:'.length)
        : undefined)
    const draggedConnectionId =
      draggedNode.connectionId ??
      (String(draggedNode.key).startsWith('connection:')
        ? String(draggedNode.key).slice('connection:'.length)
        : undefined)
    const targetNodeKind = getTreeNodeKindFromKey(targetNode)
    const folderDragTarget = dragOverFolderTargetRef.current
    const connectionDragTarget = dragOverConnectionTargetRef.current
    const eventTarget = info.event?.target
    const connectionTitleElement =
      eventTarget instanceof Element
        ? eventTarget.closest<HTMLElement>('.connection-tree-title[data-connection-id]')
        : undefined
    const pointerConnectionId = connectionTitleElement?.dataset.connectionId
    const pointerConnectionTarget =
      connectionTitleElement && pointerConnectionId && info.event
        ? {
            connectionId: pointerConnectionId,
            folderId: connectionFolderAssignments[pointerConnectionId],
            zone:
              info.event.clientY - connectionTitleElement.getBoundingClientRect().top >=
              connectionTitleElement.getBoundingClientRect().height / 2
                ? ('after' as const)
                : ('before' as const)
          }
        : undefined
    const effectiveConnectionDragTarget = connectionDragTarget ?? pointerConnectionTarget
    updateDragOverFolderTarget(undefined)
    updateDragOverConnectionTarget(undefined)

    if ((draggedNode.kind === 'folder' || draggedFolderId) && draggedFolderId) {
      if (folderDragTarget && draggedFolderId !== folderDragTarget.folderId) {
        reorderFolderNodes(
          draggedFolderId,
          folderDragTarget.folderId,
          folderDragTarget.zone === 'after'
        )
        return
      }
      if (
        (targetNodeKind === 'folder' || targetFolderId) &&
        targetFolderId &&
        draggedFolderId !== targetFolderId &&
        relativeDropPosition !== 0
      ) {
        reorderFolderNodes(draggedFolderId, targetFolderId, placeAfter)
      }
      return
    }

    if ((draggedNode.kind !== 'connection' && !draggedConnectionId) || !draggedConnectionId) {
      return
    }

    const draggedConnectionFolderId = connectionFolderAssignments[draggedConnectionId]
    const movingConnectionIds = (selectedConnectionIds.includes(draggedConnectionId)
      ? selectedConnectionIds
      : [draggedConnectionId]
    ).filter(
      (connectionId) => connectionFolderAssignments[connectionId] === draggedConnectionFolderId
    )
    if (
      effectiveConnectionDragTarget &&
      !movingConnectionIds.includes(effectiveConnectionDragTarget.connectionId)
    ) {
      const targetConnectionFolderId =
        effectiveConnectionDragTarget.folderId ??
        connectionFolderAssignments[effectiveConnectionDragTarget.connectionId]
      if (targetConnectionFolderId) {
        if (draggedConnectionFolderId === targetConnectionFolderId) {
          reorderFolderConnections(
            targetConnectionFolderId,
            movingConnectionIds,
            effectiveConnectionDragTarget.connectionId,
            effectiveConnectionDragTarget.zone === 'after'
          )
        }
      } else if (!draggedConnectionFolderId) {
        reorderRootConnections(
          movingConnectionIds,
          effectiveConnectionDragTarget.connectionId,
          effectiveConnectionDragTarget.zone === 'after'
        )
      }
      return
    }

    if (targetNodeKind === 'connection' || targetConnectionId) {
      if (!targetConnectionId || movingConnectionIds.includes(targetConnectionId)) {
        return
      }
      const targetConnectionFolderId =
        targetNode.folderId ?? connectionFolderAssignments[targetConnectionId]
      if (targetConnectionFolderId) {
        if (draggedConnectionFolderId === targetConnectionFolderId) {
          reorderFolderConnections(
            targetConnectionFolderId,
            movingConnectionIds,
            targetConnectionId,
            placeAfter
          )
        }
      } else {
        if (!draggedConnectionFolderId) {
          reorderRootConnections(movingConnectionIds, targetConnectionId, placeAfter)
        }
      }
      return
    }

    if (draggedConnectionFolderId && info.event) {
      if (
        reorderFolderConnectionsByPointer(
          draggedConnectionFolderId,
          movingConnectionIds,
          info.event.clientY
        )
      ) {
        return
      }
    }

  }

  const updateWorkspaceTab = useCallback((key: string, patch: Partial<WorkspaceTab>): void => {
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== key) {
          return tab
        }

        const patchEntries = Object.entries(patch) as Array<
          [keyof WorkspaceTab, WorkspaceTab[keyof WorkspaceTab]]
        >
        if (patchEntries.every(([patchKey, patchValue]) => Object.is(tab[patchKey], patchValue))) {
          return tab
        }

        return { ...tab, ...patch }
      })
    )
  }, [])

  const scheduleQuerySqlDraftCommit = useCallback((key: string, sql: string): void => {
    const currentTimer = querySqlDraftTimersRef.current[key]
    if (currentTimer) {
      window.clearTimeout(currentTimer)
    }
    querySqlDraftTimersRef.current[key] = window.setTimeout(() => {
      querySqlDraftTimersRef.current[key] = undefined
      setWorkspaceTabs((current) =>
        current.map((tab) => (tab.key === key && tab.sql !== sql ? { ...tab, sql } : tab))
      )
    }, 180)
  }, [])

  const updateWorkspaceTabColumnWidth = (tabKey: string, column: string, width: number): void => {
    const nextWidth = clampResultColumnWidth(width)
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== tabKey) {
          return tab
        }
        const currentWidth = tab.columnWidths?.[column]
        if (currentWidth === nextWidth) {
          return tab
        }
        return {
          ...tab,
          columnWidths: {
            ...(tab.columnWidths ?? {}),
            [column]: nextWidth
          }
        }
      })
    )
  }

  const applyLiveColumnWidth = (
    width: number,
    columnIndex: number,
    headerCells: HTMLElement[],
    headerColElements: HTMLTableColElement[],
    bodyColElements: HTMLTableColElement[]
  ): void => {
    const nextWidth = `${clampResultColumnWidth(width)}px`
    const applyColWidth = (col: HTMLTableColElement | undefined): void => {
      if (!col) {
        return
      }
      col.style.width = nextWidth
      col.style.minWidth = nextWidth
      col.style.maxWidth = nextWidth
    }
    applyColWidth(headerColElements[columnIndex])
    applyColWidth(bodyColElements[columnIndex])
    headerCells.forEach((th) => {
      th.style.setProperty('--result-column-width', nextWidth)
      th.style.width = nextWidth
      th.style.minWidth = nextWidth
      th.style.maxWidth = nextWidth
    })
  }

  const applyLiveVirtualColumnWidth = (
    width: number,
    columnIndex: number,
    headerCells: HTMLElement[],
    headerColElements: HTMLTableColElement[],
    virtualCells: HTMLElement[]
  ): void => {
    applyLiveColumnWidth(width, columnIndex, headerCells, headerColElements, [])
    const nextWidth = `${clampResultColumnWidth(width)}px`
    virtualCells.forEach((element) => {
      element.style.setProperty('--result-column-width', nextWidth)
      element.style.flex = `0 0 ${nextWidth}`
      element.style.width = nextWidth
      element.style.minWidth = nextWidth
      element.style.maxWidth = nextWidth
    })
  }

  const applyLiveResultTableWidth = (
    width: number,
    startWidth: number,
    startTableWidth: number,
    tableWidthHost?: HTMLElement
  ): void => {
    const nextTableWidth = `${Math.max(1, startTableWidth + (width - startWidth))}px`
    tableWidthHost?.style.setProperty('--result-table-width', nextTableWidth)
    const headerTable = tableWidthHost?.querySelector<HTMLTableElement>('.ant-table-header > table')
    headerTable?.style.setProperty('width', nextTableWidth, 'important')
    headerTable?.style.setProperty('min-width', nextTableWidth, 'important')
  }

  const renameWorkspaceTab = useCallback(
    (key: string, title: string): void => {
      updateWorkspaceTab(key, { title })
    },
    [updateWorkspaceTab]
  )

  const persistQueryWorkspace = (tab: WorkspaceTab): void => {
    const nextItem = buildPersistedQueryWorkspace(tab, getConnection)
    if (!nextItem) {
      return
    }

    const storedItems = readPersistedJson<PersistedQueryWorkspace[]>(STORAGE_QUERY_WORKSPACES, [])
    const nextStoredItems = upsertPersistedQueryWorkspace(storedItems, nextItem)
    localStorage.setItem(STORAGE_QUERY_WORKSPACES, JSON.stringify(nextStoredItems))
    setPersistedQueryWorkspaces((current) => {
      return upsertPersistedQueryWorkspace(current, nextItem)
    })
  }

  persistQueryWorkspaceRef.current = persistQueryWorkspace

  const removePersistedQueryWorkspace = (key: string): void => {
    setPersistedQueryWorkspaces((current) => current.filter((item) => item.key !== key))
  }

  useEffect(() => {
    const activeQueryKeys = new Set<string>()

    for (const tab of getWorkspaceTabs()) {
      if (tab.kind !== 'query') {
        continue
      }

      activeQueryKeys.add(tab.key)
      const persistSource = JSON.stringify([
        tab.title,
        tab.connectionId,
        tab.databaseName,
        tab.pgDatabaseName,
        tab.sql,
        tab.limit,
        tab.queryEditorHeight,
        tab.persistedAt
      ])

      if (queryWorkspacePersistSnapshotRef.current[tab.key] === persistSource) {
        continue
      }

      queryWorkspacePersistSnapshotRef.current[tab.key] = persistSource
      const currentTimer = queryWorkspacePersistTimersRef.current[tab.key]
      if (currentTimer) {
        window.clearTimeout(currentTimer)
      }
      queryWorkspacePersistTimersRef.current[tab.key] = window.setTimeout(
        () => {
          queryWorkspacePersistTimersRef.current[tab.key] = undefined
          persistQueryWorkspaceRef.current(tab)
        },
        tab.sql ? 220 : 0
      )
    }

    Object.keys(queryWorkspacePersistTimersRef.current).forEach((tabKey) => {
      if (activeQueryKeys.has(tabKey)) {
        return
      }
      const timer = queryWorkspacePersistTimersRef.current[tabKey]
      if (timer) {
        window.clearTimeout(timer)
      }
      delete queryWorkspacePersistTimersRef.current[tabKey]
      delete queryWorkspacePersistSnapshotRef.current[tabKey]
    })
  }, [getWorkspaceTabs, queryPersistenceRevision, workspaceTabSummaryCount])

  useEffect(
    () => () => {
      Object.values(queryWorkspacePersistTimersRef.current).forEach((timer) => {
        if (timer) {
          window.clearTimeout(timer)
        }
      })
      Object.values(querySqlDraftTimersRef.current).forEach((timer) => {
        if (timer) {
          window.clearTimeout(timer)
        }
      })
    },
    []
  )

  const confirmRemovePersistedQueryWorkspace = (item: PersistedQueryWorkspace): void => {
    const schemaPath = [item.pgDatabaseName, item.databaseName].filter(Boolean).join('.')
    Modal.confirm({
      title: '删除历史查询窗口',
      centered: true,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <div className="query-history-delete-confirm">
          <div className="query-history-delete-confirm-title">{item.title || '未命名查询'}</div>
          <div className="query-history-delete-confirm-meta">
            {[
              item.connectionName ?? getConnection(item.connectionId)?.name ?? '未绑定连接',
              schemaPath || '未选择库'
            ].join(' · ')}
          </div>
          <div className="query-history-delete-confirm-hint">
            删除后将从历史查询列表中移除，且无法恢复。
          </div>
        </div>
      ),
      onOk: () => removePersistedQueryWorkspace(item.key)
    })
  }

  const getDefaultTableSearchUiState = (tab: WorkspaceTab): TableSearchUiState => ({
    visible: tab.pageSearchVisible ?? false,
    query: tab.pageSearchQuery ?? '',
    caseSensitive: tab.pageSearchCaseSensitive ?? false,
    regex: tab.pageSearchRegex ?? false,
    wholeWord: tab.pageSearchWholeWord ?? false,
    filterRows: tab.pageSearchFilterRows ?? false,
    activeMatchIndex: tab.pageSearchActiveMatchIndex ?? 0
  })

  const getImmediateTableSearchState = (tab: WorkspaceTab): TableSearchUiState => {
    const storedState = tableSearchUiState[tab.key]
    if (storedState) {
      return storedState
    }
    const signature = [
      tab.pageSearchVisible ?? false,
      tab.pageSearchQuery ?? '',
      tab.pageSearchCaseSensitive ?? false,
      tab.pageSearchRegex ?? false,
      tab.pageSearchWholeWord ?? false,
      tab.pageSearchFilterRows ?? false,
      tab.pageSearchActiveMatchIndex ?? 0
    ].join('\u0000')
    const cached = defaultTableSearchStateRefs.current[tab.key]
    if (cached?.signature === signature) {
      return cached.state
    }
    const state = getDefaultTableSearchUiState(tab)
    defaultTableSearchStateRefs.current[tab.key] = { signature, state }
    return state
  }

  const updateTableSearchState = (tab: WorkspaceTab, patch: Partial<TableSearchUiState>): void => {
    if (inlineCellEditorRefs.current[tab.key]) {
      commitInlineCellEditor(tab.key)
    }
    const previousState = getImmediateTableSearchState(tab)
    const nextState = {
      ...previousState,
      ...patch
    }
    if (
      previousState.visible === nextState.visible &&
      previousState.query === nextState.query &&
      previousState.caseSensitive === nextState.caseSensitive &&
      previousState.regex === nextState.regex &&
      previousState.wholeWord === nextState.wholeWord &&
      previousState.filterRows === nextState.filterRows &&
      previousState.activeMatchIndex === nextState.activeMatchIndex
    ) {
      return
    }

    setTableSearchUiState((current) => ({
      ...current,
      [tab.key]: nextState
    }))
  }

  const updateSelectedCells = (tabKey: string, cellKeys: string[]): void => {
    const currentCellKeys = selectedCellRefs.current[tabKey] ?? []
    if (
      currentCellKeys.length === cellKeys.length &&
      currentCellKeys.every((key, index) => key === cellKeys[index])
    ) {
      return
    }
    selectedCellRefs.current[tabKey] = cellKeys.length > 0 ? cellKeys : undefined
    updateWorkspaceTab(tabKey, { selectedCellKeys: cellKeys })
  }

  const syncInspectorSelection = (tabKey: string, cellKeys: string[]): void => {
    cellInspectorPanelRefs.current[tabKey]?.setSelection(cellKeys)
  }

  const syncRenderedCellSelection = (tabKey: string): void => {
    if (inlineCellEditorRefs.current[tabKey]) {
      clearRenderedCellSelection(tabKey)
      return
    }

    const runtimeCellKeys = runtimeSelectedCellRefs.current[tabKey] ?? []
    if (runtimeCellKeys.length > 0) {
      updateRenderedCellSelection(tabKey, runtimeCellKeys)
      return
    }

    const committedCellKeys = selectedCellRefs.current[tabKey] ?? []
    if (committedCellKeys.length > 0) {
      updateRenderedCellSelection(tabKey, committedCellKeys)
      return
    }

    clearRenderedCellSelection(tabKey)
  }

  const closeInlineCellEditor = (tabKey: string, displayValue?: string): void => {
    const current = inlineCellEditorRefs.current[tabKey]
    if (!current) {
      return
    }
    current.input.remove()
    if (current.host.isConnected) {
      const display = document.createElement('span')
      display.className = 'table-cell-text'
      display.textContent = displayValue ?? cellDisplayText(current.originalValue)
      current.host.replaceChildren(display)
      current.host.classList.remove('editable-cell-inline-editing')
    }
    current.batchHosts?.forEach((batchHost) => {
      batchHost.classList.remove('editable-cell-batch-editing')
    })
    inlineCellEditorRefs.current[tabKey] = undefined
  }

  const closeEditingCell = (
    tabKey: string,
    displayValue?: string,
    restoreFocus = false
  ): void => {
    closeInlineCellEditor(tabKey, displayValue)
    if (restoreFocus) {
      tableBodyRefs.current[tabKey]?.focus()
    }
    requestAnimationFrame(() => {
      committingEditingCellRefs.current[tabKey] = undefined
      syncRenderedCellSelection(tabKey)
      if (restoreFocus) {
        tableBodyRefs.current[tabKey]?.focus()
      }
    })
  }

  const clearInlineCellEditor = (tabKey: string): void => {
    closeInlineCellEditor(tabKey)
    committingEditingCellRefs.current[tabKey] = undefined
    editingCellRefs.current[tabKey] = undefined
    suppressInlineEditorCommitRefs.current[tabKey] = undefined
    syncRenderedCellSelection(tabKey)
  }

  const discardInlineCellEditor = (tabKey: string): void => {
    const current = inlineCellEditorRefs.current[tabKey]
    if (!current) {
      clearInlineCellEditor(tabKey)
      return
    }
    current.batchHosts?.forEach((batchHost) => {
      if (batchHost === current.host) {
        return
      }
      const originalEntry = current.batchOriginalValues?.find(
        ({ rowKey, column }) =>
          `${rowKey}:${column}` === batchHost.dataset.cellKey
      )
      if (originalEntry) {
        batchHost.textContent = cellDisplayText(originalEntry.value)
      }
    })
    closeEditingCell(tabKey, cellDisplayText(current.originalValue))
    editingCellRefs.current[tabKey] = undefined
    suppressInlineEditorCommitRefs.current[tabKey] = undefined
  }

  const commitInlineCellEditor = (
    tabKey: string,
    options?: { restoreFocus?: boolean }
  ): void => {
    const current = inlineCellEditorRefs.current[tabKey]
    if (!current || committingEditingCellRefs.current[tabKey]) {
      return
    }
    if (suppressInlineEditorCommitRefs.current[tabKey]) {
      suppressInlineEditorCommitRefs.current[tabKey] = undefined
      closeEditingCell(tabKey, cellDisplayText(current.originalValue), options?.restoreFocus)
      editingCellRefs.current[tabKey] = undefined
      return
    }
    committingEditingCellRefs.current[tabKey] = true
    const nextValue = current.input.value
    const { rowKey, column } = current
    if (current.batchCells) {
      editingCellRefs.current[tabKey] = undefined
      flushSync(() => {
        updatePreviewCells(
          tabKey,
          current.batchCells!.map(({ rowKey: targetRowKey, column: targetColumn }) => ({
            rowKey: targetRowKey,
            column: targetColumn,
            value: editableValue(nextValue)
          }))
        )
      })
      closeEditingCell(tabKey, nextValue, options?.restoreFocus)
      return
    }
    if (nextValue === current.initialInputValue) {
      closeEditingCell(tabKey, cellDisplayText(current.originalValue), options?.restoreFocus)
      editingCellRefs.current[tabKey] = undefined
      return
    }
    const nextEditableValue = editableValue(nextValue)
    editingCellRefs.current[tabKey] = undefined
    flushSync(() => {
      updatePreviewCell(tabKey, rowKey, column, nextEditableValue)
    })
    clearAllCellSelection(tabKey)
    closeEditingCell(tabKey, cellDisplayText(nextEditableValue), options?.restoreFocus)
  }

  const openInlineCellEditor = (
    tabKey: string,
    rowKey: string,
    column: string,
    host: HTMLElement,
    rawValue: unknown,
    options?: {
      initialValue?: string
      batchCells?: Array<{ rowKey: string; column: string }>
      batchOriginalValues?: Array<{ rowKey: string; column: string; value: unknown }>
    }
  ): void => {
    closeInlineCellEditor(tabKey)
    if (!options?.batchCells) {
      clearRenderedCellSelection(tabKey)
    }
    rowDragAnchorRefs.current[tabKey] = undefined
    cellDragAnchorRefs.current[tabKey] = undefined
    pendingCellDragTargetRefs.current[tabKey] = undefined
    runtimeSelectedCellRefs.current[tabKey] = undefined
    const input = document.createElement('input')
    input.className = 'editable-cell-dom-input'
    const initialInputValue =
      options?.initialValue ??
      (rawValue === null || rawValue === undefined || isDefaultValueMarker(rawValue)
        ? ''
        : String(rawValue))
    input.value = initialInputValue
    input.dataset.columnKey = column
    input.dataset.rowKey = rowKey
    input.dataset.cellKey = `${rowKey}:${column}`
    const batchHosts = options?.batchCells
      ?.map(({ rowKey: targetRowKey, column: targetColumn }) =>
        tableBodyRefs.current[tabKey]?.querySelector<HTMLElement>(
          `.editable-cell[data-cell-key="${CSS.escape(`${targetRowKey}:${targetColumn}`)}"]`
        )
      )
      .filter((batchHost): batchHost is HTMLElement => Boolean(batchHost))
    const updateBatchDisplay = (value: string): void => {
      batchHosts?.forEach((batchHost) => {
        if (batchHost !== host && batchHost.isConnected) {
          batchHost.textContent = value
        }
      })
    }
    const restoreBatchDisplay = (): void => {
      batchHosts?.forEach((batchHost) => {
        if (batchHost === host || !batchHost.isConnected) {
          return
        }
        const originalEntry = options?.batchOriginalValues?.find(
          ({ rowKey: targetRowKey, column: targetColumn }) =>
            `${targetRowKey}:${targetColumn}` === batchHost.dataset.cellKey
        )
        if (originalEntry) {
          batchHost.textContent = cellDisplayText(originalEntry.value)
        }
      })
    }
    let composing = false
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('mousedown', (event) => event.stopPropagation())
    input.addEventListener('mouseup', (event) => event.stopPropagation())
    input.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('dblclick', (event) => event.stopPropagation())
    input.addEventListener('keydown', (event) => {
      if (composing || event.isComposing) {
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        commitInlineCellEditor(tabKey, { restoreFocus: true })
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        discardInlineCellEditor(tabKey)
      }
    })
    input.addEventListener('compositionstart', () => {
      composing = true
      if (options?.initialValue && input.value === options.initialValue) {
        input.value = ''
        restoreBatchDisplay()
      }
    })
    input.addEventListener('compositionend', () => {
      composing = false
      updateBatchDisplay(input.value)
    })
    input.addEventListener('input', () => {
      if (!composing) {
        updateBatchDisplay(input.value)
      }
    })
    input.addEventListener('blur', () => {
      if (!composing) {
        commitInlineCellEditor(tabKey)
      }
    })
    host.textContent = ''
    host.classList.add('editable-cell-inline-editing')
    host.appendChild(input)
    batchHosts?.forEach((batchHost) => {
      if (batchHost !== host) {
        batchHost.classList.add('editable-cell-batch-editing')
      }
    })
    inlineCellEditorRefs.current[tabKey] = {
      rowKey,
      column,
      input,
      host,
      originalValue: rawValue,
      initialInputValue,
      batchCells: options?.batchCells,
      batchHosts,
      batchOriginalValues: options?.batchOriginalValues
    }
    updateBatchDisplay(initialInputValue)
    editingCellRefs.current[tabKey] = { rowKey, column }
    const focusInput = (): void => {
      input.focus()
      if (options?.batchCells) {
        input.setSelectionRange(input.value.length, input.value.length)
      } else {
        input.select()
      }
    }
    if (options?.batchCells) {
      focusInput()
    } else {
      requestAnimationFrame(focusInput)
    }
  }

  useEffect(() => {
    const finishColumnResize = (pointerId?: number): void => {
      const resizeEntries = Object.entries(columnResizeRefs.current).filter(
        (entry): entry is [string, NonNullable<(typeof columnResizeRefs.current)[string]>] =>
          Boolean(entry[1])
      )
      if (resizeEntries.length === 0) {
        document.body.classList.remove('column-resizing')
        return
      }

      const matchedEntries = resizeEntries.filter(
        ([, resizeState]) => typeof pointerId !== 'number' || resizeState.pointerId === pointerId
      )

      if (matchedEntries.length === 0) {
        return
      }

      matchedEntries.forEach(([, resizeState]) => {
        if (typeof resizeState.frameId === 'number') {
          window.cancelAnimationFrame(resizeState.frameId)
          resizeState.frameId = undefined
        }
        const finalWidth = resizeState.pendingWidth ?? resizeState.lastWidth
        resizeState.lastWidth = finalWidth
        if (!resizeState.virtual) {
          applyLiveColumnWidth(
            finalWidth,
            resizeState.columnIndex,
            resizeState.headerCells,
            resizeState.headerColElements,
            resizeState.bodyColElements
          )
        }
        applyLiveResultTableWidth(
          finalWidth,
          resizeState.startWidth,
          resizeState.startTableWidth,
          resizeState.tableWidthHost
        )
      })

      flushSync(() => {
        matchedEntries.forEach(([, resizeState]) => {
          updateWorkspaceTabColumnWidth(
            resizeState.tabKey,
            resizeState.column,
            resizeState.lastWidth
          )
        })
      })

      matchedEntries.forEach(([key]) => {
        delete columnResizeRefs.current[key]
      })

      if (Object.keys(columnResizeRefs.current).length === 0) {
        document.body.classList.remove('column-resizing')
      }
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const resizeState = Object.values(columnResizeRefs.current).find(
        (item) => item?.pointerId === event.pointerId
      )
      if (!resizeState) {
        return
      }
      event.preventDefault()
      const nextWidth = clampResultColumnWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX)
      )
      if (nextWidth === resizeState.pendingWidth || nextWidth === resizeState.lastWidth) {
        return
      }
      resizeState.pendingWidth = nextWidth
      if (typeof resizeState.frameId === 'number') {
        return
      }
      resizeState.frameId = window.requestAnimationFrame(() => {
        resizeState.frameId = undefined
        const pendingWidth = resizeState.pendingWidth
        if (typeof pendingWidth !== 'number') {
          return
        }
        resizeState.lastWidth = pendingWidth
        if (resizeState.virtual) {
          applyLiveVirtualColumnWidth(
            pendingWidth,
            resizeState.columnIndex,
            resizeState.headerCells,
            resizeState.headerColElements,
            resizeState.virtualCells ?? []
          )
          applyLiveResultTableWidth(
            pendingWidth,
            resizeState.startWidth,
            resizeState.startTableWidth,
            resizeState.tableWidthHost
          )
          return
        }
        applyLiveColumnWidth(
          pendingWidth,
          resizeState.columnIndex,
          resizeState.headerCells,
          resizeState.headerColElements,
          resizeState.bodyColElements
        )
        applyLiveResultTableWidth(
          pendingWidth,
          resizeState.startWidth,
          resizeState.startTableWidth,
          resizeState.tableWidthHost
        )
      })
    }

    const handlePointerUp = (event: PointerEvent): void => {
      finishColumnResize(event.pointerId)
    }

    const handleWindowBlur = (): void => {
      finishColumnResize()
    }

    const handlePointerCancel = (event: PointerEvent): void => {
      finishColumnResize(event.pointerId)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleWindowBlur)
      finishColumnResize()
    }
  }, [])

  useEffect(() => {
    if (!treeContextMenu) {
      return
    }

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('.tree-context-menu-panel') ||
        target?.closest('.ant-menu-submenu-popup')
      ) {
        return
      }
      setTreeContextMenu(null)
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setTreeContextMenu(null)
      }
    }

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [treeContextMenu])

  useEffect(() => {
    if (!resizingResourcePanel) {
      return
    }
    const handleMouseMove = (event: MouseEvent): void => {
      const resizeState = resourcePanelResizeRef.current
      const shell = workspaceShellRef.current
      if (!resizeState || !shell) {
        return
      }
      const shellWidth = shell.getBoundingClientRect().width
      const nextSize = Math.min(
        500,
        Math.max(
          RESOURCE_PANEL_MIN_WIDTH,
          resizeState.startSize + (event.clientX - resizeState.startX)
        )
      )
      const boundedSize = Math.min(
        nextSize,
        Math.max(RESOURCE_PANEL_MIN_WIDTH, shellWidth - (aiPanelVisible ? aiPanelSize : 0) - 260)
      )
      if (resourcePanelRef.current) {
        resourcePanelRef.current.style.width = `${boundedSize}px`
        resourcePanelRef.current.style.flex = `0 0 ${boundedSize}px`
      }
      if (mainPanelRef.current) {
        mainPanelRef.current.style.width = ''
      }
      resourcePanelResizeRef.current = { ...resizeState, lastSize: boundedSize }
    }
    const handleMouseUp = (): void => {
      const lastSize = resourcePanelResizeRef.current?.lastSize
      resourcePanelResizeRef.current = null
      setResizingResourcePanel(false)
      if (typeof lastSize === 'number') {
        setResourcePanelSize(lastSize)
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingResourcePanel])

  useEffect(() => {
    if (!resizingAiPanel) {
      return
    }
    const handleMouseMove = (event: MouseEvent): void => {
      const resizeState = aiPanelResizeRef.current
      const shell = workspaceShellRef.current
      if (!resizeState || !shell) {
        return
      }
      const shellWidth = shell.getBoundingClientRect().width
      const nextSize = Math.min(
        720,
        Math.max(260, resizeState.startSize - (event.clientX - resizeState.startX))
      )
      const boundedSize = Math.min(nextSize, Math.max(260, shellWidth - resourcePanelSize - 260))
      if (aiDockPanelRef.current) {
        aiDockPanelRef.current.style.width = `${boundedSize}px`
        aiDockPanelRef.current.style.flex = `0 0 ${boundedSize}px`
      }
      resizeState.lastSize = boundedSize
    }
    const handleMouseUp = (): void => {
      const lastSize = aiPanelResizeRef.current?.lastSize
      aiPanelResizeRef.current = null
      setResizingAiPanel(false)
      if (typeof lastSize === 'number') {
        setAiPanelSize(lastSize)
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingAiPanel])

  useEffect(() => {
    const handleMouseUp = (): void => {
      Object.keys(scrollbarDragRefs.current).forEach((key) => {
        scrollbarDragRefs.current[key] = undefined
      })
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const closeWorkspaceTab = useCallback(
    (key: string): void => {
      setWorkspaceTabs((current) => {
        const index = current.findIndex((tab) => tab.key === key)
        const nextTabs = current.filter((tab) => tab.key !== key)
        const currentActiveTabKey = useWorkspaceStore.getState().activeTabKey

        if (currentActiveTabKey === key) {
          setActiveTabKey(nextTabs[index - 1]?.key ?? nextTabs[index]?.key)
        }

        return nextTabs
      })
      setTableSearchUiState((current) => {
        if (!(key in current)) {
          return current
        }
        const next = { ...current }
        delete next[key]
        return next
      })
      delete selectedCellRefs.current[key]
      delete selectedRowRefs.current[key]
      delete renderedSelectedCellRefs.current[key]
      delete renderedSelectedRowRefs.current[key]
      delete runtimeSelectedCellRefs.current[key]
      delete scrollbarDragRefs.current[key]
      delete contextMenuCellSelectionRefs.current[key]
      delete contextMenuCellSelectionSnapshotRefs.current[key]
      delete committedSelectedCellRangeRefs.current[key]
      delete cellSelectionAnchorRefs.current[key]
      delete rowSelectionDraftRefs.current[key]
      delete rowSelectionAnchorRefs.current[key]
      delete pendingRowDragTargetRefs.current[key]
      delete pendingRowDragFrameRefs.current[key]
      delete pendingCellDragTargetRefs.current[key]
      delete pendingCellDragFrameRefs.current[key]
      if (pendingRenderedCellSelectionTimeoutRefs.current[key]) {
        window.clearTimeout(pendingRenderedCellSelectionTimeoutRefs.current[key])
        delete pendingRenderedCellSelectionTimeoutRefs.current[key]
      }
      delete tableComponentRefs.current[key]
      cellInspectorPanelRefs.current[key]?.close()
      delete cellInspectorPanelRefs.current[key]
      delete selectedColumnRefs.current[key]
      delete tableBodyRefs.current[key]
      delete tableHeaderRefs.current[key]
      delete tableScrollTopRefs.current[key]
      delete tableScrollLeftRefs.current[key]
      delete tableScrollRestoreLocks.current[key]
      delete sqlExecutionContextRef.current[key]
      delete sqlExecutionContextStructureKeyRef.current[key]
      delete sqlEditorHandleRefs.current[key]
      if (querySqlDraftTimersRef.current[key]) {
        window.clearTimeout(querySqlDraftTimersRef.current[key])
        delete querySqlDraftTimersRef.current[key]
      }
      setSqlExecutionContextByTab((current) => {
        if (!(key in current)) {
          return current
        }
        const next = { ...current }
        delete next[key]
        return next
      })
    },
    [setActiveTabKey, setWorkspaceTabs]
  )

  const handleSqlExecutionContextChange = useCallback(
    (tabKey: string, payload: SqlEditorExecutionContext): void => {
      const nextStructureKey = buildStatementStructureKey(payload.statements)
      const previousStructureKey = sqlExecutionContextStructureKeyRef.current[tabKey] ?? ''
      sqlExecutionContextRef.current[tabKey] = payload
      sqlExecutionContextStructureKeyRef.current[tabKey] = nextStructureKey
      setSqlExecutionContextByTab((current) => {
        const previous = current[tabKey]
        if (
          previous &&
          previous.currentStatementIndex === payload.currentStatementIndex &&
          previousStructureKey === nextStructureKey
        ) {
          return current
        }
        return {
          ...current,
          [tabKey]: payload
        }
      })
    },
    []
  )

  const connectionMap = useMemo(
    () => new Map(connections.map((connection) => [connection.connection_id, connection])),
    [connections]
  )
  const getConnection = useCallback(
    (connectionId?: string): ConnectionInfo | undefined =>
      connectionId ? connectionMap.get(connectionId) : undefined,
    [connectionMap]
  )
  useEffect(() => {
    const flushQueryWorkspacePersistence = (): void => {
      let nextItems = readPersistedJson<PersistedQueryWorkspace[]>(STORAGE_QUERY_WORKSPACES, [])
      for (const tab of getWorkspaceTabs()) {
        const nextItem = buildPersistedQueryWorkspace(tab, getConnection)
        if (nextItem) {
          nextItems = upsertPersistedQueryWorkspace(nextItems, nextItem)
        }
      }
      localStorage.setItem(STORAGE_QUERY_WORKSPACES, JSON.stringify(nextItems))
    }

    window.addEventListener('beforeunload', flushQueryWorkspacePersistence)
    return () => window.removeEventListener('beforeunload', flushQueryWorkspacePersistence)
  }, [getConnection, getWorkspaceTabs])
  const { enableVirtualTree, resourceTreeHeight } = useResourceTreeViewport({
    treeData,
    resourceTreeViewportRef
  })
  const resourceTreeToolbarItems = useMemo(
    () => [
      {
        key: 'search',
        icon: <SearchOutlined />,
        label: '搜索当前树',
        active: treeSearchOpen,
        onClick: () => {
          const nextOpen = !treeSearchOpen
          setTreeSearchOpen(nextOpen)
          if (!nextOpen) {
            setTreeSearchText('')
            setTreeSearchMatchIndex(0)
          }
        }
      },
      {
        key: 'locate',
        icon: <AimOutlined />,
        label: '定位当前对象',
        onClick: () => {
          void locateActiveTreeNode()
        }
      }
    ],
    [locateActiveTreeNode, treeSearchOpen]
  )
  const deferredTreeData = useDeferredValue(treeData)
  const queryHistoryGroups = useMemo(() => {
    const groups = persistedQueryWorkspaces.reduce<Record<string, PersistedQueryWorkspace[]>>(
      (current, item) => {
        const connectionName =
          getConnection(item.connectionId)?.name ?? item.connectionName ?? '未绑定连接'
        if (!current[connectionName]) {
          current[connectionName] = []
        }
        current[connectionName].push(item)
        return current
      },
      {}
    )

    return Object.entries(groups)
      .map(([groupName, items]) => {
        const sortedItems = [...items].sort((left, right) => right.persistedAt - left.persistedAt)
        return {
          groupName,
          items: sortedItems,
          latestPersistedAt: sortedItems[0]?.persistedAt ?? 0
        }
      })
      .sort((left, right) => right.latestPersistedAt - left.latestPersistedAt)
  }, [getConnection, persistedQueryWorkspaces])
  useEffect(() => {
    treeDataRef.current = treeData
  }, [treeData])

  useEffect(() => {
    allDatabasesRef.current = allDatabases
  }, [allDatabases])
  useEffect(() => {
    expandedKeysRef.current = expandedKeys
  }, [expandedKeys])
  const loadedCompletionIndex = useMemo(() => {
    const index = new Map<
      string,
      { tables: SqlCompletionTable[]; columns: SqlCompletionColumn[] }
    >()

    const getScopeKey = (
      connectionId: string,
      databaseName?: string,
      pgDatabaseName?: string
    ): string => `${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}`

    const ensureScope = (
      scopeKey: string
    ): { tables: SqlCompletionTable[]; columns: SqlCompletionColumn[] } => {
      const existing = index.get(scopeKey)
      if (existing) {
        return existing
      }

      const created = { tables: [], columns: [] }
      index.set(scopeKey, created)
      return created
    }

    const walk = (nodes: DatabaseTreeNode[]): void => {
      for (const node of nodes) {
        if (node.closed) {
          continue
        }

        if (node.kind === 'table' && node.tableName && node.connectionId) {
          const connection = connectionMap.get(node.connectionId)
          const databaseName = isSchemaScopedType(connection?.database_type)
            ? node.pgDatabaseName
            : node.databaseName
          const schemaName = isSchemaScopedType(connection?.database_type)
            ? node.databaseName
            : undefined
          const scope = ensureScope(
            getScopeKey(node.connectionId, node.databaseName, node.pgDatabaseName)
          )
          const tableColumns = ((node.children as DatabaseTreeNode[] | undefined) ?? [])
            .filter((child) => child.kind === 'column' && child.columnName)
            .map<SqlCompletionColumn>((child) => ({
              name: child.columnName!,
              type: child.columnType,
              tableName: node.tableName!,
              databaseName,
              schemaName,
              nullable: child.nullable,
              primaryKey: child.primaryKey
            }))

          scope.tables.push({
            name: node.tableName,
            databaseName,
            schemaName,
            columns: tableColumns
          })
          scope.columns.push(...tableColumns)
        }

        if (node.children?.length) {
          walk(node.children)
        }
      }
    }

    walk(deferredTreeData)
    return index
  }, [connectionMap, deferredTreeData])
  const ensureConnectionOpen = (connectionId?: string): boolean => {
    const connection = getConnection(connectionId)

    if (connectionId && connection && !connection.is_open) {
      void reopenConnectionSilently(connectionId).catch(() => undefined)
    }

    return true
  }

  const withDatabaseQuery = (path: string, databaseName?: string): string => {
    if (!databaseName) {
      return path
    }

    return `${path}?database=${encodeURIComponent(databaseName)}`
  }

  const withPgDatabase = useCallback(
    (path: string, databaseName?: string, pgDatabaseName?: string): string => {
      const params: string[] = []

      if (databaseName) {
        params.push(`database=${encodeURIComponent(databaseName)}`)
      }

      if (pgDatabaseName) {
        params.push(`pg_database=${encodeURIComponent(pgDatabaseName)}`)
      }

      return params.length > 0 ? `${path}?${params.join('&')}` : path
    },
    []
  )

  const withPageQuery = (path: string, limit: number, page = 1): string => {
    const offset = Math.max(0, page - 1) * limit
    return `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`
  }

  const withWhereQuery = (path: string, where?: string): string => {
    const condition = where?.trim()
    return condition
      ? `${path}${path.includes('?') ? '&' : '?'}where=${encodeURIComponent(condition)}`
      : path
  }

  const withSortQuery = (
    path: string,
    sortState?: { column: string; direction: 'ascend' | 'descend' }
  ): string => {
    if (!sortState?.column) {
      return path
    }
    const params = [
      `sort_column=${encodeURIComponent(sortState.column)}`,
      `sort_direction=${encodeURIComponent(sortState.direction)}`
    ]
    return `${path}${path.includes('?') ? '&' : '?'}${params.join('&')}`
  }

  const quoteTableName = (
    connectionId: string,
    tableName: string,
    databaseName?: string
  ): string => {
    const connection = getConnection(connectionId)

    if (connection?.database_type === 'mysql' || connection?.database_type === 'clickhouse') {
      const quotedTable = `\`${tableName.replaceAll('`', '``')}\``
      return databaseName ? `\`${databaseName.replaceAll('`', '``')}\`.${quotedTable}` : quotedTable
    }

    if (connection?.database_type === 'mongodb') {
      return `db.${tableName}.find({})`
    }

    if (connection?.database_type === 'redis') {
      return `GET ${tableName}`
    }

    if (isSchemaScopedType(connection?.database_type)) {
      const quotedTable = `"${tableName.replaceAll('"', '""')}"`
      return databaseName ? `"${databaseName.replaceAll('"', '""')}".${quotedTable}` : quotedTable
    }

    const quotedTable = `"${tableName.replaceAll('"', '""')}"`
    return databaseName ? `"${databaseName.replaceAll('"', '""')}".${quotedTable}` : quotedTable
  }

  const copyTableName = async (tableName: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(tableName)
    } catch {
      showError('复制失败')
    }
  }

  const copyTreeNodeNames = async (): Promise<void> => {
    const nodeMap = collectTreeNodesByKey(treeData)
    const nodeKeys =
      selectedTreeKeys.length > 0
        ? selectedTreeKeys.map(String)
        : focusedTreeNode?.key
          ? [String(focusedTreeNode.key)]
          : []
    const names = nodeKeys
      .map((key) => nodeMap.get(key))
      .filter((node): node is DatabaseTreeNode => Boolean(node))
      .map((node) => getTreeNodeCopyName(node).trim())
      .filter(Boolean)
    if (names.length === 0) {
      return
    }
    try {
      await navigator.clipboard.writeText(names.join('\n'))
    } catch {
      showError('复制失败')
    }
  }

  const copyConnectionDetails = async (connectionId: string): Promise<void> => {
    try {
      const connection = await requestJson<ConnectionFormValues>(`/connections/${connectionId}`)
      await navigator.clipboard.writeText(buildConnectionDetailsText(connection))
      messageApi.success('连接信息已复制')
    } catch (err) {
      showError(err instanceof Error ? err.message : '复制连接信息失败')
    }
  }

  const copyConnectionJdbcUrl = async (connectionId: string): Promise<void> => {
    try {
      const connection = await requestJson<ConnectionFormValues>(`/connections/${connectionId}`)
      const jdbcUrl = buildJdbcUrl(connection)
      if (!jdbcUrl) {
        messageApi.warning('当前连接无法生成 JDBC URL')
        return
      }
      await navigator.clipboard.writeText(jdbcUrl)
      messageApi.success('JDBC URL 已复制')
    } catch (err) {
      showError(err instanceof Error ? err.message : '复制 JDBC URL 失败')
    }
  }

  const buildAIContextSourceFromNode = (node: DatabaseTreeNode): AIContextSource | undefined => {
    if (!node.connectionId) {
      return undefined
    }

    const connection = getConnection(node.connectionId)
    const isSQLiteDatabaseNode =
      node.kind === 'connection' && connection?.database_type === 'sqlite'
    if (
      !connection ||
      (!isSQLiteDatabaseNode && node.kind !== 'database' && node.kind !== 'pg-schema')
    ) {
      return undefined
    }

    const source: AIContextSource = {
      id: '',
      type: node.kind === 'pg-schema' ? 'schema' : 'database',
      connectionId: node.connectionId,
      connectionName: connection.name,
      dbType: connection.database_type,
      database: isSQLiteDatabaseNode
        ? getDefaultDatabaseName(connection)
        : node.kind === 'pg-schema'
          ? node.pgDatabaseName
          : node.databaseName,
      schema: node.kind === 'pg-schema' ? node.databaseName : undefined,
      pgDatabase:
        node.kind === 'pg-schema'
          ? node.pgDatabaseName
          : isSchemaScopedType(connection.database_type)
            ? node.databaseName
            : undefined,
      sizeDisplay: node.sizeDisplay,
      sizeBytes: node.sizeBytes,
      storageSizeDisplay: node.storageSizeDisplay,
      storageSizeBytes: node.storageSizeBytes
    }
    source.id = buildAIContextSourceId(source)
    return source
  }

  const addAIContextSource = (node: DatabaseTreeNode): void => {
    const source = buildAIContextSourceFromNode(node)
    if (!source) {
      return
    }

    const activeConnection = getConnection(aiActiveContext?.connectionId)
    const activeSource: AIContextSource | undefined =
      aiActiveContext && activeConnection?.is_open
        ? {
            id: buildAIContextSourceId({
              type:
                isSchemaScopedType(activeConnection.database_type) && aiActiveContext.databaseName
                  ? 'schema'
                  : 'database',
              connectionId: aiActiveContext.connectionId,
              database: isSchemaScopedType(activeConnection.database_type)
                ? aiActiveContext.pgDatabaseName
                : aiActiveContext.databaseName,
              schema: isSchemaScopedType(activeConnection.database_type)
                ? aiActiveContext.databaseName
                : undefined,
              pgDatabase: isSchemaScopedType(activeConnection.database_type)
                ? aiActiveContext.pgDatabaseName
                : undefined
            }),
            type:
              isSchemaScopedType(activeConnection.database_type) && aiActiveContext.databaseName
                ? 'schema'
                : 'database',
            connectionId: aiActiveContext.connectionId,
            connectionName: activeConnection.name,
            dbType: activeConnection.database_type,
            database: isSchemaScopedType(activeConnection.database_type)
              ? aiActiveContext.pgDatabaseName
              : aiActiveContext.databaseName,
            schema: isSchemaScopedType(activeConnection.database_type)
              ? aiActiveContext.databaseName
              : undefined,
            pgDatabase: isSchemaScopedType(activeConnection.database_type)
              ? aiActiveContext.pgDatabaseName
              : undefined
          }
        : undefined
    if (activeSource?.id === source.id) {
      messageApi.info('该数据源已是当前 AI 主上下文')
      setAiPanelOpen(true)
      return
    }

    if (shouldSwitchAIPrimaryContext(activeSource, source)) {
      setAiActiveContext({
        connectionId: source.connectionId,
        databaseName: source.type === 'schema' ? source.schema : undefined,
        pgDatabaseName: source.pgDatabase ?? source.database
      })
      setAiContextSources((current) => pruneManualAIContextsForPrimary(current, source))
      messageApi.success('已切换 AI 主上下文')
      setAiPanelOpen(true)
      return
    }

    const exists = aiContextSources.some((item) => item.id === source.id)
    if (exists) {
      messageApi.info('该数据源已在当前 AI 上下文中')
      setAiPanelOpen(true)
      return
    }

    setAiContextSources((current) => [...current, source])
    messageApi.success('已添加到当前 AI 上下文')
    setAiPanelOpen(true)
  }

  const removeAIContextSource = useCallback((sourceId: string): void => {
    setAiContextSources((current) => current.filter((source) => source.id !== sourceId))
  }, [])

  const activateAIContextFromNode = (node: DatabaseTreeNode): void => {
    if (!node.connectionId) {
      return
    }
    const connectionId = node.connectionId

    const connection = getConnection(connectionId)
    if (!connection?.is_open) {
      return
    }

    if (node.kind === 'connection') {
      startTransition(() => {
        setAiActiveContext({
          connectionId,
          databaseName:
            isDatabaseScopedType(connection.database_type) ||
            connection.database_type === 'dm' ||
            connection.database_type === 'oracle'
              ? getDefaultDatabaseName(connection)
              : undefined,
          pgDatabaseName: isSchemaScopedType(connection.database_type)
            ? getDefaultPgDatabase(connection)
            : undefined
        })
      })
      return
    }

    if (node.kind === 'database') {
      const schemaKey = `${node.connectionId}:${node.databaseName}`
      const schemas = selectedSchemas[schemaKey] ?? allSchemas[schemaKey] ?? []
      startTransition(() => {
        setAiActiveContext({
          connectionId,
          databaseName: isSchemaScopedType(connection.database_type)
            ? getDefaultPgSchema(schemas)
            : node.databaseName,
          pgDatabaseName: isSchemaScopedType(connection.database_type)
            ? node.databaseName
            : undefined
        })
      })
      return
    }

    if (node.kind === 'pg-schema') {
      startTransition(() => {
        setAiActiveContext({
          connectionId,
          databaseName: node.databaseName,
          pgDatabaseName: node.pgDatabaseName
        })
      })
      return
    }

    if (
      (node.kind === 'table' || node.kind === 'db-object' || node.kind === 'object-group') &&
      (node.databaseName || node.pgDatabaseName)
    ) {
      startTransition(() => {
        setAiActiveContext({
          connectionId,
          databaseName: node.databaseName,
          pgDatabaseName: node.pgDatabaseName
        })
      })
    }
  }

  const openTableQuery = (
    connectionId: string,
    tableName: string,
    databaseName?: string,
    pgDatabaseName?: string
  ): void => {
    setSelectedConnectionId(connectionId)
    const connection = getConnection(connectionId)
    const sql =
      connection?.database_type === 'mongodb' || connection?.database_type === 'redis'
        ? quoteTableName(connectionId, tableName, databaseName)
        : `select * from ${quoteTableName(connectionId, tableName, databaseName)} limit 1000;`
    openQueryWorkspace(sql, `${tableName} 查询`, connectionId, databaseName, pgDatabaseName)
  }

  const openTableEditor = async (
    connectionId: string,
    tableName: string,
    databaseName?: string,
    pgDatabaseName?: string
  ): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    setEditingConnectionId(connectionId)
    setEditingDatabaseName(databaseName)
    setEditingPgDatabaseName(pgDatabaseName)
    setEditingTableName(tableName)
    setEditingOriginalTableName(tableName)
    setEditingTableComment('')
    setEditingColumns([])
    setTableEditorOpen(true)
    setTableEditorLoading(true)

    try {
      const data = await requestJson<ColumnsResponse>(
        withPgDatabase(
          `/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns`,
          databaseName,
          pgDatabaseName
        )
      )
      setEditingTableComment(data.table_comment ?? '')
      setEditingColumns(data.columns.map(toColumnDef))
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载字段失败')
    } finally {
      setTableEditorLoading(false)
    }
  }

  const saveTableEditor = async (): Promise<void> => {
    if (!editingConnectionId || !editingTableName || !editingOriginalTableName) {
      return
    }

    if (!ensureConnectionOpen(editingConnectionId)) {
      return
  }

  setTableEditorLoading(true)
  const updatedTableName = editingTableName.trim()

  try {
      const data = await requestJson<ColumnsResponse>(
        withPgDatabase(
          `/connections/${editingConnectionId}/tables/${encodeURIComponent(editingOriginalTableName)}/columns`,
          editingDatabaseName,
          editingPgDatabaseName
        ),
        {
          method: 'PUT',
          body: JSON.stringify({
            table_name: updatedTableName,
            table_comment: editingTableComment.trim(),
            columns: editingColumns.map((column) => ({
              name: column.name,
              source_name: column.key,
              type: column.type,
              nullable: column.nullable,
              primary_key: column.primaryKey,
              comment: column.comment.trim(),
              unique: column.unique,
              auto_increment: column.autoIncrement,
              auto_increment_step: column.autoIncrementStep ?? null,
              minimum: column.minimum.trim() || null,
              maximum: column.maximum.trim() || null
            }))
          })
        }
      )
      setEditingTableComment(data.table_comment ?? '')
      setEditingColumns(data.columns.map(toColumnDef))
      if (editingOriginalTableName !== updatedTableName) {
        setWorkspaceTabs((current) =>
          current.filter(
            (tab) =>
              tab.connectionId !== editingConnectionId ||
              tab.tableName !== editingOriginalTableName ||
              tab.databaseName !== editingDatabaseName ||
              tab.pgDatabaseName !== editingPgDatabaseName
          )
        )
      }
      if (editingOriginalTableName !== updatedTableName) {
        if (editingPgDatabaseName) {
          refreshDatabaseNode(editingConnectionId, editingPgDatabaseName)
        } else if (editingDatabaseName) {
          refreshDatabaseNode(editingConnectionId, editingDatabaseName)
        } else {
          refreshConnectionNode(editingConnectionId)
        }
      }
      setTableEditorOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存表结构失败')
    } finally {
      setTableEditorLoading(false)
    }
  }

  const renderDatabaseSelector = (connectionId: string): React.ReactNode => {
    const connection = getConnection(connectionId)
    if (!connection?.is_open) {
      return null
    }

    const dbList = allDatabases[connectionId] ?? []
    const selected =
      selectedDatabasesRef.current[connectionId] ?? selectedDatabases[connectionId] ?? dbList

    if (dbList.length === 0) {
      return null
    }

    const handleCommit = (nextSelected: string[]): void => {
      const currentSelected = selectedDatabasesRef.current[connectionId] ?? selected
      const changed = !stringArrayEquals(
        [...currentSelected].sort((left, right) =>
          left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
        ),
        [...nextSelected].sort((left, right) =>
          left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
        )
      )
      setSelectedDatabases((current) => {
        const next = { ...current, [connectionId]: nextSelected }
        selectedDatabasesRef.current = next
        return next
      })
      if (changed) {
        const restoreTreeScrollPosition = captureResourceTreeScrollPosition()
        refreshConnectionNode(connectionId, nextSelected)
        restoreTreeScrollPosition()
      }
    }

    return (
      <TreeSelectorPopover options={dbList} selectedValues={selected} onCommit={handleCommit} />
    )
  }

  const renderAIContextButton = (node: DatabaseTreeNode): React.ReactNode => {
    if (!aiModuleInstalled) {
      return null
    }
    const connection = getConnection(node.connectionId)
    const isSQLiteDatabaseNode =
      node.kind === 'connection' && connection?.database_type === 'sqlite'
    if (!isSQLiteDatabaseNode && node.kind !== 'database' && node.kind !== 'pg-schema') {
      return null
    }

    return (
      <button
        type="button"
        className="tree-ai-context-btn"
        title="点击添加到当前 AI 上下文"
        aria-label="点击添加到当前 AI 上下文"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          addAIContextSource(node)
        }}
      >
        <RobotOutlined />
      </button>
    )
  }

  const handleConnectionContextMenuClick = (key: string, connection: ConnectionInfo): void => {
    const targetConnectionIds = selectedConnectionIds.includes(connection.connection_id)
      ? selectedConnectionIds
      : [connection.connection_id]

    if (key === 'open') {
      void openConnectionById(connection.connection_id)
    }
    if (key === 'close') {
      void closeConnectionById(connection.connection_id)
    }
    if (key === 'new-database') {
      if (connection.database_type !== 'sqlite') {
        setCreatingDatabaseConnectionId(connection.connection_id)
        setCreatingSchemaDatabaseName('')
        setDatabaseCreateName('')
        setDatabaseCreatePassword('')
        setDatabaseCreateModalOpen(true)
      }
    }
    if (key === 'run-sql') {
      void openSqlFileDialog(connection.connection_id)
    }
    if (key === 'schema-versions') {
      void openSchemaVersionModal(connection.connection_id)
    }
    if (key === 'copy-connection-details') {
      void copyConnectionDetails(connection.connection_id)
    }
    if (key === 'copy-jdbc-url') {
      void copyConnectionJdbcUrl(connection.connection_id)
    }
    if (key === 'move-root') {
      moveConnectionsToFolder(targetConnectionIds, undefined)
    }
    if (key.startsWith('move-folder:')) {
      const folderId = key.slice('move-folder:'.length)
      if (connectionFolders.some((folder) => folder.id === folderId)) {
        moveConnectionsToFolder(targetConnectionIds, folderId)
        setExpandedKeys((current) =>
          current.includes(`folder:${folderId}`) ? current : [...current, `folder:${folderId}`]
        )
      }
    }
  }

  const getDatabaseContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (
      !node.connectionId ||
      !node.databaseName ||
      (node.kind !== 'database' && node.kind !== 'pg-schema')
    ) {
      return []
    }

    const connection = getConnection(node.connectionId)
    const isPgDb = node.kind === 'database' && isSchemaScopedType(connection?.database_type)

    return [
      { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
      ...(isPgDb ? [{ key: 'new-schema', label: '新建模式', icon: <PlusOutlined /> }] : []),
      ...(!isPgDb && connection?.database_type !== 'redis'
        ? [
            {
              key: 'new-table',
              label: connection?.database_type === 'mongodb' ? '新建集合' : '新建表',
              icon: <PlusOutlined />
            }
          ]
        : []),
      ...(connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
        ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }]
        : []),
      { type: 'divider' },
      ...(connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
        ? [{ key: 'backup', label: '备份', icon: <SaveOutlined /> }]
        : []),
      { key: 'export', label: '导出', icon: <FileAddOutlined /> },
      ...(connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
        ? [{ key: 'import', label: '导入', icon: <ImportOutlined /> }]
        : []),
      ...(!isPgDb &&
      (connection?.database_type === 'mysql' ||
        connection?.database_type === 'postgresql' ||
        connection?.database_type === 'gaussdb')
        ? [
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }
          ]
        : [])
    ]
  }

  const handleDatabaseContextMenuClick = (key: string, node: DatabaseTreeNode): void => {
    if (
      !node.connectionId ||
      !node.databaseName ||
      (node.kind !== 'database' && node.kind !== 'pg-schema')
    ) {
      return
    }

    const connectionId = node.connectionId
    const databaseName = node.databaseName
    const pgDbName = node.pgDatabaseName
    const connection = getConnection(connectionId)
    const isPgDb = node.kind === 'database' && isSchemaScopedType(connection?.database_type)

    if (key === 'refresh') {
      refreshDatabaseNode(connectionId, databaseName)
    }
    if (key === 'new-schema') {
      setCreatingDatabaseConnectionId(connectionId)
      setCreatingSchemaDatabaseName(databaseName)
      setDatabaseCreateName('')
      setDatabaseCreateModalOpen(true)
    }
    if (key === 'new-table') {
      setCreateTableConnectionId(connectionId)
      setCreateTableDatabaseName(databaseName)
      setCreateTablePgDatabaseName(pgDbName ?? '')
      setNewTableName('')
      setNewTableComment('')
      setNewTableColumns(
        connection?.database_type === 'mongodb'
          ? [
              {
                key: 'col-0',
                name: '_id',
                type: 'ObjectId',
                nullable: false,
                primaryKey: true,
                comment: '',
                unique: false,
                autoIncrement: false,
                autoIncrementStep: undefined,
                minimum: '',
                maximum: ''
              }
            ]
          : [
              {
                key: 'col-0',
                name: 'id',
                type:
                  isSchemaScopedType(connection?.database_type) ||
                  connection?.database_type === 'oracle'
                    ? 'INTEGER'
                    : connection?.database_type === 'clickhouse'
                      ? 'UInt64'
                      : 'INT',
                nullable: false,
                primaryKey: connection?.database_type !== 'clickhouse',
                comment: '',
                unique: false,
                autoIncrement:
                  connection?.database_type === 'mysql' ||
                  connection?.database_type === 'postgresql' ||
                  connection?.database_type === 'gaussdb' ||
                  connection?.database_type === 'oracle' ||
                  connection?.database_type === 'sqlite',
                autoIncrementStep:
                  connection?.database_type === 'postgresql' ||
                  connection?.database_type === 'gaussdb' ||
                  connection?.database_type === 'oracle'
                    ? 1
                    : undefined,
                minimum: '',
                maximum: ''
              },
              {
                key: 'col-1',
                name: 'name',
                type: connection?.database_type === 'clickhouse' ? 'String' : 'VARCHAR(100)',
                nullable: false,
                primaryKey: false,
                comment: '',
                unique: false,
                autoIncrement: false,
                autoIncrementStep: undefined,
                minimum: '',
                maximum: ''
              }
            ]
      )
      setCreateTableModalOpen(true)
    }
    if (key === 'run-sql') {
      void openSqlFileDialog(connectionId, databaseName, pgDbName)
    }
    if (key === 'backup') {
      openBackupRestoreModal(connectionId, isPgDb ? undefined : databaseName, pgDbName)
    }
    if (key === 'export') {
      openExportModal(
        connectionId,
        isPgDb ? undefined : databaseName,
        isPgDb ? databaseName : pgDbName
      )
    }
    if (key === 'import') {
      openImportModal(connectionId, isPgDb ? undefined : databaseName, pgDbName)
    }
    if (key === 'delete') {
      deleteDatabase(connectionId, databaseName)
    }
  }

  const getObjectContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (
      (node.kind !== 'table' && node.kind !== 'db-object') ||
      !node.connectionId ||
      !node.tableName
    ) {
      return []
    }

    const objectType = node.objectType ?? 'table'
    const connection = getConnection(node.connectionId)
    const canPreview = objectType === 'table' || objectType === 'view'

    return [
      ...(canPreview ? [{ key: 'select', label: '生成 SELECT 查询' }] : []),
      { key: 'ddl', label: '查看 DDL' },
      ...(objectType === 'table' &&
      connection?.database_type !== 'mongodb' &&
      connection?.database_type !== 'redis'
        ? [{ key: 'edit', label: '修改表' }]
        : []),
      { key: 'copy', label: '复制对象名' },
      { type: 'divider' },
      ...(canPreview ? [{ key: 'export', label: '导出', icon: <FileAddOutlined /> }] : []),
      ...(connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
        ? [{ key: 'import', label: '导入', icon: <ImportOutlined /> }]
        : []),
      ...(objectType === 'procedure'
        ? [{ key: 'execute-routine', label: '执行存储过程', icon: <PlayCircleOutlined /> }]
        : []),
      ...(canPreview
        ? [
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }
          ]
        : [])
    ]
  }

  const handleObjectContextMenuClick = (key: string, node: DatabaseTreeNode): void => {
    if (
      (node.kind !== 'table' && node.kind !== 'db-object') ||
      !node.connectionId ||
      !node.tableName
    ) {
      return
    }

    const connectionId = node.connectionId
    const tableName = node.tableName
    const databaseName = node.databaseName
    const pgDbName = node.pgDatabaseName
    const objectType = node.objectType ?? 'table'

    if (key === 'select') {
      openTableQuery(connectionId, tableName, databaseName, pgDbName)
    }
    if (key === 'ddl') {
      void showObjectDdl(connectionId, tableName, objectType, databaseName, pgDbName)
    }
    if (key === 'execute-routine') {
      void openRoutineExecution(connectionId, tableName, databaseName, pgDbName)
    }
    if (key === 'edit') {
      void openTableEditor(connectionId, tableName, databaseName, pgDbName)
    }
    if (key === 'copy') {
      void copyTableName(tableName)
    }
    if (key === 'export') {
      openExportModal(connectionId, databaseName, pgDbName, tableName)
    }
    if (key === 'import') {
      openImportModal(connectionId, databaseName, pgDbName, tableName)
    }
    if (key === 'delete') {
      deleteDbObject(connectionId, tableName, objectType, databaseName, pgDbName)
    }
  }

  const getConnectionContextMenu = (connection: ConnectionInfo): MenuProps['items'] => {
    const loading = Boolean(connectionTreeLoading[connection.connection_id])
    const currentFolderId = connectionFolderAssignments[connection.connection_id]
    const rootItemId = rootConnectionOrderId(connection.connection_id)
    const isPinned = pinnedRootItemIds.includes(rootItemId)
    const folderById = new Map(connectionFolders.map((folder) => [folder.id, folder]))
    const childFolderIdsByParentId = new Map<string | undefined, string[]>()
    connectionFolders.forEach((folder) => {
      const parentId =
        folder.parentId && folder.parentId !== folder.id && folderById.has(folder.parentId)
          ? folder.parentId
          : undefined
      const childIds = childFolderIdsByParentId.get(parentId) ?? []
      childIds.push(folder.id)
      childFolderIdsByParentId.set(parentId, childIds)
    })
    const buildFolderMenuItems = (
      parentId: string | undefined,
      ancestorIds: Set<string>
    ): NonNullable<MenuProps['items']> =>
      (childFolderIdsByParentId.get(parentId) ?? []).flatMap((folderId) => {
        const folder = folderById.get(folderId)
        if (!folder || ancestorIds.has(folderId)) {
          return []
        }
        const nextAncestorIds = new Set(ancestorIds)
        nextAncestorIds.add(folderId)
        const children = buildFolderMenuItems(folderId, nextAncestorIds)
        return [
          {
            key: `move-folder:${folder.id}`,
            label: folder.name,
            disabled: currentFolderId === folder.id,
            ...(children.length > 0 ? { children } : {})
          }
        ]
      })
    const folderMenuItems = buildFolderMenuItems(undefined, new Set())

    return [
      ...(connection.is_open || loading
        ? [
            {
              key: 'close',
              label: loading ? '停止连接' : '关闭连接',
              icon: <CloseCircleOutlined />
            }
          ]
        : [{ key: 'open', label: '打开连接', icon: <PlayCircleOutlined />, disabled: loading }]),
      ...(connection.database_type === 'redis' || connection.database_type === 'sqlite'
        ? []
        : [
            {
              key: 'new-database',
              label: connection.database_type === 'oracle' ? '新建用户' : '新建库',
              icon: <PlusOutlined />
            }
          ]),
      ...(connection.database_type !== 'mongodb' && connection.database_type !== 'redis'
        ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }]
        : []),
      ...(connection.git_versioning_enabled &&
      connection.database_type !== 'mongodb' &&
      connection.database_type !== 'redis'
        ? [{ key: 'schema-versions', label: '版本管理', icon: <HistoryOutlined /> }]
        : []),
      { type: 'divider' as const },
      ...(!currentFolderId
        ? [
            {
              key: isPinned ? 'unpin-root-item' : 'pin-root-item',
              label: isPinned ? '取消置顶' : '置顶',
              icon: <PushpinOutlined />
            },
            { type: 'divider' as const }
          ]
        : []),
      ...(connection.database_type !== 'sqlite'
        ? [
            {
              key: 'copy-connection-details',
              label: '复制连接信息',
              icon: <CopyOutlined />
            }
          ]
        : []),
      ...(supportsJdbcUrl(connection.database_type)
        ? [
            {
              key: 'copy-jdbc-url',
              label: '复制为 JDBC URL',
              icon: <LinkOutlined />
            }
          ]
        : []),
      ...(connectionFolders.length > 0
        ? [
            {
              type: 'divider' as const
            },
            {
              key: 'move-folder',
              label: '添加到分组',
              icon: <FolderAddOutlined />,
              children: folderMenuItems
            }
          ]
        : []),
      ...(currentFolderId
        ? [
            { type: 'divider' as const },
            { key: 'move-root', label: '移出分组', icon: <FolderOpenOutlined /> }
          ]
        : [])
    ]
  }

  const getObjectGroupContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (
      node.kind !== 'object-group' ||
      !node.objectType ||
      (node.objectType !== 'table' && node.objectType !== 'view')
    ) {
      return []
    }

    return [{ key: 'catalog', label: '查看列表' }]
  }

  const getFolderContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (node.kind !== 'folder' || !node.folderId) {
      return []
    }

    const folder = connectionFolders.find((item) => item.id === node.folderId)
    const rootItemId = rootFolderOrderId(node.folderId)
    const isPinned = pinnedRootItemIds.includes(rootItemId)
    return [
      ...(!folder?.parentId
        ? [
            {
              key: isPinned ? 'unpin-root-item' : 'pin-root-item',
              label: isPinned ? '取消置顶' : '置顶',
              icon: <PushpinOutlined />
            },
            { type: 'divider' as const }
          ]
        : []),
      { key: 'create-child-folder', label: '添加子分组', icon: <FolderAddOutlined /> },
      { key: 'rename-folder', label: '重命名分组', icon: <EditOutlined /> },
      { key: 'delete-folder', label: '删除分组', icon: <DeleteOutlined />, danger: true }
    ]
  }

  const getTreeContextMenuItems = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (node.kind === 'folder') {
      return getFolderContextMenu(node)
    }
    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection ? getConnectionContextMenu(connection) : []
    }
    if (node.kind === 'database' || node.kind === 'pg-schema') {
      return getDatabaseContextMenu(node)
    }
    if (node.kind === 'object-group') {
      return getObjectGroupContextMenu(node)
    }
    if (node.kind === 'table' || node.kind === 'db-object') {
      return getObjectContextMenu(node)
    }
    return []
  }

  const handleTreeContextMenuClick = ({ key }: { key: string }): void => {
    if (!treeContextMenu) {
      return
    }

    const node = treeContextMenu.node
    if (node.kind === 'folder' && node.folderId) {
      const rootItemId = rootFolderOrderId(node.folderId)
      const isRootFolder = !connectionFolders.find((item) => item.id === node.folderId)?.parentId
      if (isRootFolder && key === 'pin-root-item') {
        setPinnedRootItemIds((current) => [
          rootItemId,
          ...current.filter((itemId) => itemId !== rootItemId)
        ])
      }
      if (isRootFolder && key === 'unpin-root-item') {
        setPinnedRootItemIds((current) => current.filter((itemId) => itemId !== rootItemId))
      }
      if (key === 'create-child-folder') {
        openCreateFolderModal(node.folderId)
      }
      if (key === 'rename-folder') {
        openRenameFolderModal(node.folderId)
      }
      if (key === 'delete-folder') {
        deleteFolder(node.folderId)
      }
    } else if (node.kind === 'connection' && node.connectionId) {
      const rootItemId = rootConnectionOrderId(node.connectionId)
      if (!connectionFolderAssignments[node.connectionId] && key === 'pin-root-item') {
        setPinnedRootItemIds((current) => [
          rootItemId,
          ...current.filter((itemId) => itemId !== rootItemId)
        ])
      }
      if (!connectionFolderAssignments[node.connectionId] && key === 'unpin-root-item') {
        setPinnedRootItemIds((current) => current.filter((itemId) => itemId !== rootItemId))
      }
      const connection = getConnection(node.connectionId)
      if (connection) {
        handleConnectionContextMenuClick(key, connection)
      }
    } else if (node.kind === 'database' || node.kind === 'pg-schema') {
      handleDatabaseContextMenuClick(key, node)
    } else if (
      node.kind === 'object-group' &&
      key === 'catalog' &&
      node.connectionId &&
      (node.objectType === 'table' || node.objectType === 'view')
    ) {
      void openTableCatalog(
        node.connectionId,
        node.databaseName,
        node.pgDatabaseName,
        node.objectType
      )
    } else if (node.kind === 'table' || node.kind === 'db-object') {
      handleObjectContextMenuClick(key, node)
    }

    setTreeContextMenu(null)
  }

  const renderTreeTitle = (node: DatabaseTreeNode): React.ReactNode => {
    const loading = Boolean(node.key && treeLoadingKeysRef.current.has(node.key as React.Key))
    if (node.kind === 'folder' && node.folderId) {
      const folderChildren = (node.children as DatabaseTreeNode[] | undefined) ?? []
      const connectionCount = folderChildren.filter((child) => child.kind === 'connection').length
      const folderDropZone =
        dragOverFolderTarget?.folderId === node.folderId ? dragOverFolderTarget.zone : undefined
      const isPinnedRootFolder =
        !connectionFolders.find((folder) => folder.id === node.folderId)?.parentId &&
        pinnedRootItemIds.includes(rootFolderOrderId(node.folderId))
      const isExpanded = expandedKeys.includes(node.key as React.Key)
      return (
        <Flex
          align="center"
          justify="space-between"
          className={`tree-title-row folder-title-row resource-tree-node-title${folderDropZone ? ` folder-drop-${folderDropZone}` : ''}`}
          data-folder-id={node.folderId}
          data-tree-node-key={String(node.key)}
          onDragOver={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const offsetY = event.clientY - rect.top
            updateDragOverFolderTarget({
              folderId: node.folderId!,
              zone: offsetY >= rect.height / 2 ? 'after' : 'before'
            })
          }}
          onDragLeave={(event) => {
            const relatedTarget = event.relatedTarget
            if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
              updateDragOverFolderTarget(undefined)
            }
          }}
        >
          <span className={`folder-title-icon${isExpanded ? ' is-expanded' : ''}`} aria-hidden="true">
            {isExpanded ? <FolderOpenOutlined /> : <FolderOutlined />}
          </span>
          <span className={`table-tree-title${loading ? ' is-loading' : ''}`}>
            {highlightTreeSearchText(String(node.title ?? ''))}
          </span>
          {isPinnedRootFolder && <PushpinOutlined className="tree-root-pin-icon" title="已置顶" />}
          <Tag className="folder-count-tag">{connectionCount}</Tag>
        </Flex>
      )
    }

    if (node.kind === 'folder-drop-placeholder') {
      return (
        <span
          className="folder-drop-placeholder-title resource-tree-node-title"
          data-tree-node-key={String(node.key)}
        />
      )
    }

    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection ? (
        renderConnectionTitle(node, connection)
      ) : (
        <span className="resource-tree-node-title" data-tree-node-key={String(node.key)}>
          {node.title as React.ReactNode}
        </span>
      )
    }

    if (node.kind === 'column') {
      const title = String(node.title ?? '')
      return (
        <span
          className={`table-tree-title resource-tree-node-title${loading ? ' is-loading' : ''}`}
          title={title}
          data-tree-node-key={String(node.key)}
        >
          {highlightTreeSearchText(title)}
        </span>
      )
    }

    if (
      (node.kind === 'database' || node.kind === 'pg-schema') &&
      node.connectionId &&
      node.databaseName
    ) {
      const connectionId = node.connectionId
      const databaseName = node.databaseName
      const isPgDb =
        node.kind === 'database' && isSchemaScopedType(getConnection(connectionId)?.database_type)
      const selKey = `${connectionId}:${databaseName}`
      const schemas = allSchemas[selKey] ?? []
      const selectedSchemaList = selectedSchemas[selKey] ?? schemas
      const schemaCount = schemas.length
      const handleSchemaCommit = (nextSelected: string[]): void => {
        const currentSelected = selectedSchemasRef.current[selKey] ?? selectedSchemaList
        const changed = !stringArrayEquals(
          [...currentSelected].sort((left, right) =>
            left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
          ),
          [...nextSelected].sort((left, right) =>
            left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
          )
        )
        setSelectedSchemas((current) => {
          const next = { ...current, [selKey]: nextSelected }
          selectedSchemasRef.current = next
          return next
        })
        if (changed) {
          const restoreTreeScrollPosition = captureResourceTreeScrollPosition()
          refreshDatabaseNode(connectionId, databaseName, nextSelected)
          restoreTreeScrollPosition()
        }
      }

      return (
        <Flex
          align="center"
          justify="space-between"
          className="tree-title-row resource-tree-node-title"
          data-tree-node-key={String(node.key)}
        >
          <div className="tree-title-with-size">
            <span className={`table-tree-title${loading ? ' is-loading' : ''}`}>
              {highlightTreeSearchText(String(node.title ?? ''))}
            </span>
            <span className="tree-node-actions">
              {renderAIContextButton(node)}
              {node.sizeDisplay && (
                <span
                  className="tree-size-badge"
                  title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}
                >
                  {node.sizeDisplay}
                </span>
              )}
            </span>
          </div>
          {isPgDb && schemaCount > 0 && (
            <TreeSelectorPopover
              options={schemas}
              selectedValues={selectedSchemaList}
              onCommit={handleSchemaCommit}
            />
          )}
        </Flex>
      )
    }

    if (
      (node.kind !== 'table' && node.kind !== 'db-object') ||
      !node.connectionId ||
      !node.tableName
    ) {
      return (
        <span className="resource-tree-node-title" data-tree-node-key={String(node.key)}>
          {highlightTreeSearchText(String(node.title ?? ''))}
        </span>
      )
    }

    return (
      <Flex
        align="center"
        justify="space-between"
        className="tree-title-with-size resource-tree-node-title"
        data-tree-node-key={String(node.key)}
      >
        <span
          className="table-tree-title"
          title={
            node.kind === 'table'
              ? node.comment?.trim() || String(node.title ?? '')
              : String(node.title ?? '')
          }
        >
          {highlightTreeSearchText(String(node.title ?? ''))}
        </span>
        <span className="tree-node-actions">
          {node.sizeLoading ? (
            <LoadingOutlined
              spin
              className="tree-size-loading-icon"
              title="正在计算占用大小"
            />
          ) : node.sizeDisplay ? (
            <span
              className="tree-size-badge"
              title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}
            >
              {node.sizeDisplay}
            </span>
          ) : null}
        </span>
      </Flex>
    )
  }

  const toggleRedisValue = (tabKey: string, rowKey: string): void => {
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== tabKey) {
          return tab
        }
        const expanded = { ...(tab.redisExpandedValues ?? {}) }
        if (expanded[rowKey]) {
          delete expanded[rowKey]
        } else {
          expanded[rowKey] = true
        }
        return { ...tab, redisExpandedValues: expanded }
      })
    )
  }

  const updateRedisEdit = (tabKey: string, rowKey: string, patch: Partial<RedisKeyEdit>): void => {
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== tabKey) {
          return tab
        }
        const currentEdit = tab.redisEdits?.[rowKey]
        if (!currentEdit) {
          return tab
        }
        const nextEdit: RedisKeyEdit = {
          ...currentEdit,
          ...patch,
          state: currentEdit.state === 'inserted' ? 'inserted' : 'updated'
        }
        return { ...tab, redisEdits: { ...(tab.redisEdits ?? {}), [rowKey]: nextEdit } }
      })
    )
  }

  const addRedisRow = (tab: WorkspaceTab): void => {
    const rowKey = `new:${Date.now()}`
    updateWorkspaceTab(tab.key, {
      redisEdits: {
        ...(tab.redisEdits ?? {}),
        [rowKey]: {
          rowKey,
          key: '',
          type: 'string',
          value: '',
          ttl: null,
          state: 'inserted'
        }
      },
      redisExpandedValues: { ...(tab.redisExpandedValues ?? {}), [rowKey]: true }
    })
  }

  const deleteRedisRow = (tabKey: string, rowKey: string): void => {
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== tabKey) {
          return tab
        }
        const edits = { ...(tab.redisEdits ?? {}) }
        const currentEdit = edits[rowKey]
        if (!currentEdit) {
          return tab
        }
        if (currentEdit.state === 'inserted') {
          delete edits[rowKey]
        } else {
          edits[rowKey] = { ...currentEdit, deleted: true }
        }
        return { ...tab, redisEdits: edits }
      })
    )
  }

  const clearRuntimeColumnSelection = (tabKey: string): void => {
    const selectedColumn = selectedColumnRefs.current[tabKey]
    selectedColumnRefs.current[tabKey] = undefined
    if (selectedColumn) {
      updateWorkspaceTab(tabKey, { selectedColumns: [], selectedColumnMap: {} })
    }
    const containers = [tableBodyRefs.current[tabKey], tableHeaderRefs.current[tabKey]].filter(
      (container): container is HTMLDivElement => container instanceof HTMLDivElement
    )
    containers.forEach((container) => {
      container.querySelectorAll<HTMLElement>('.column-selected-runtime').forEach((element) => {
        element.classList.remove('column-selected-runtime')
      })
      container
        .querySelectorAll<HTMLElement>('.column-selected-runtime-inner')
        .forEach((element) => element.classList.remove('column-selected-runtime-inner'))
      container
        .querySelectorAll<HTMLElement>('.column-select-button-runtime-selected')
        .forEach((element) => element.classList.remove('column-select-button-runtime-selected'))
      if (selectedColumn) {
        container
          .querySelectorAll<HTMLElement>(
            `[data-column-key="${CSS.escape(selectedColumn)}"]`
          )
          .forEach((element) => element.classList.remove('column-selected-runtime'))
      }
    })
  }

  const syncRenderedColumnSelection = (tabKey: string): void => {
    const selectedColumn = selectedColumnRefs.current[tabKey]
    if (!selectedColumn) {
      return
    }
    const containers = [tableBodyRefs.current[tabKey], tableHeaderRefs.current[tabKey]].filter(
      (container): container is HTMLDivElement => container instanceof HTMLDivElement
    )
    containers.forEach((container) => {
      container
        .querySelectorAll<HTMLElement>('.column-selected-runtime')
        .forEach((element) => element.classList.remove('column-selected-runtime'))
      container
        .querySelectorAll<HTMLElement>('.column-selected-runtime-inner')
        .forEach((element) => element.classList.remove('column-selected-runtime-inner'))
      container
        .querySelectorAll<HTMLElement>('.column-select-button-runtime-selected')
        .forEach((element) => element.classList.remove('column-select-button-runtime-selected'))
      container
        .querySelectorAll<HTMLElement>(
          `[data-column-key="${CSS.escape(selectedColumn)}"]`
        )
        .forEach((element) => {
          element.classList.add('column-selected-runtime')
          element
            .querySelectorAll<HTMLElement>(
              `.editable-cell[data-cell-column-key="${CSS.escape(selectedColumn)}"]`
            )
            .forEach((cell) => cell.classList.add('column-selected-runtime-inner'))
        })
      container
        .querySelectorAll<HTMLElement>(
          `[data-column-button="${CSS.escape(selectedColumn)}"]`
        )
        .forEach((element) => element.classList.add('column-select-button-runtime-selected'))
    })
  }

  const clearRenderedCellSelection = (tabKey: string): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]').forEach((cell) => {
      cell.classList.remove('cell-selected-runtime')
      const host = cell.closest<HTMLElement>('td, .ant-table-cell')
      if (!host) {
        return
      }
      host.classList.remove('cell-selected-runtime-host')
      if (host.classList.contains('editable-cell-draft-host')) {
        return
      }
      host.style.removeProperty('background')
      host.style.removeProperty('background-color')
      host.style.removeProperty('background-image')
      host.style.removeProperty('border-bottom-color')
      host.style.removeProperty('box-shadow')
    })
    renderedSelectedCellRefs.current[tabKey] = undefined
  }

  const clearActiveSearchCellHighlight = (tabKey: string): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container
      .querySelectorAll('.cell-search-active')
      .forEach((element) => element.classList.remove('cell-search-active'))
  }

  const updateRenderedCellSelection = (tabKey: string, cellKeys: string[]): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    const nextCellKeySet = new Set(cellKeys)
    const previousRenderedKeys = renderedSelectedCellRefs.current[tabKey] ?? []
    const previousRenderedKeySet = new Set(previousRenderedKeys)
    const nextRenderedKeys: string[] = []

    previousRenderedKeys.forEach((cellKey) => {
      if (nextCellKeySet.has(cellKey)) {
        return
      }
      container
        .querySelectorAll<HTMLElement>(`.editable-cell[data-cell-key="${CSS.escape(cellKey)}"]`)
        .forEach((element) => {
          element.classList.remove('cell-selected-runtime')
          const host = element.closest<HTMLElement>('td, .ant-table-cell')
          host?.classList.remove('cell-selected-runtime-host')
          host?.style.removeProperty('background')
          host?.style.removeProperty('background-color')
          host?.style.removeProperty('background-image')
          host?.style.removeProperty('border-bottom-color')
          host?.style.removeProperty('box-shadow')
          if (host?.classList.contains('editable-cell-draft-host')) {
            host.style.setProperty('background', 'rgba(216, 59, 1, 0.14)', 'important')
            host.style.setProperty('background-color', 'rgba(216, 59, 1, 0.14)', 'important')
            host.style.setProperty('background-image', 'none', 'important')
            host.style.setProperty('border-bottom-color', 'var(--dj-grid-border)', 'important')
            host.style.setProperty(
              'box-shadow',
              'inset 0 -1px 0 var(--dj-grid-border)',
              'important'
            )
          }
        })
    })

    cellKeys.forEach((cellKey) => {
      container
        .querySelectorAll<HTMLElement>(`.editable-cell[data-cell-key="${CSS.escape(cellKey)}"]`)
        .forEach((element) => {
          if (
            !previousRenderedKeySet.has(cellKey) ||
            !element.classList.contains('cell-selected-runtime')
          ) {
            element.classList.add('cell-selected-runtime')
          }
          const host = element.closest<HTMLElement>('td, .ant-table-cell')
          if (
            host &&
            (!previousRenderedKeySet.has(cellKey) ||
              !host.classList.contains('cell-selected-runtime-host'))
          ) {
            host.classList.add('cell-selected-runtime-host')
          }
          if (host) {
            host.style.setProperty('background', 'var(--dj-grid-selection-bg)', 'important')
            host.style.setProperty('background-color', 'var(--dj-grid-selection-bg)', 'important')
            host.style.setProperty('background-image', 'none', 'important')
            host.style.setProperty('border-bottom-color', 'var(--dj-grid-border)', 'important')
            host.style.setProperty(
              'box-shadow',
              'inset 0 -1px 0 var(--dj-grid-border)',
              'important'
            )
          }
        })
      nextRenderedKeys.push(cellKey)
    })

    renderedSelectedCellRefs.current[tabKey] =
      nextRenderedKeys.length > 0 ? nextRenderedKeys : undefined
  }

  const applyRuntimeColumnSelection = (tabKey: string, column: string): void => {
    clearRuntimeColumnSelection(tabKey)
    selectedColumnRefs.current[tabKey] = column
    updateWorkspaceTab(tabKey, { selectedColumns: [column], selectedColumnMap: { [column]: true } })
    syncRenderedColumnSelection(tabKey)
  }

  const syncRuntimeSortButtons = (
    tabKey: string,
    sortState?: { column: string; direction: 'ascend' | 'descend' }
  ): void => {
    const container = tableHeaderRefs.current[tabKey]
    if (!container) {
      return
    }

    container.querySelectorAll<HTMLElement>('.column-sort-button').forEach((button) => {
      const column = button.dataset.columnKey ?? ''
      const icon = button.querySelector<HTMLElement>('.column-sort-icon')
      const isActive = Boolean(sortState?.column && sortState.column === column)
      button.classList.toggle('active', isActive)
      if (!icon) {
        return
      }
      if (!isActive) {
        icon.textContent = '⇅'
        icon.dataset.direction = 'none'
        return
      }
      icon.textContent = sortState?.direction === 'descend' ? '↓' : '↑'
      icon.dataset.direction = sortState?.direction ?? 'none'
    })
  }

  const clearRuntimeCellSelection = (tabKey: string): void => {
    runtimeSelectedCellRefs.current[tabKey] = undefined
    syncRenderedCellSelection(tabKey)
  }

  const cancelPendingCellSelectionInteractions = (tabKey: string): void => {
    rowDragAnchorRefs.current[tabKey] = undefined
    cellDragAnchorRefs.current[tabKey] = undefined
    pendingRowDragTargetRefs.current[tabKey] = undefined
    pendingCellDragTargetRefs.current[tabKey] = undefined
    if (pendingCellDragFrameRefs.current[tabKey]) {
      window.cancelAnimationFrame(pendingCellDragFrameRefs.current[tabKey]!)
      pendingCellDragFrameRefs.current[tabKey] = undefined
    }
    if (pendingRowDragFrameRefs.current[tabKey]) {
      window.cancelAnimationFrame(pendingRowDragFrameRefs.current[tabKey]!)
      pendingRowDragFrameRefs.current[tabKey] = undefined
    }
  }

  const setRuntimeCellSelection = (tabKey: string, cellKeys: string[]): void => {
    runtimeSelectedCellRefs.current[tabKey] = cellKeys.length > 0 ? cellKeys : undefined
    updateRenderedCellSelection(tabKey, cellKeys)
  }

  const setCommittedCellSelection = (tabKey: string, cellKeys: string[]): void => {
    committedSelectedCellRangeRefs.current[tabKey] = cellKeys.length > 0 ? cellKeys : undefined
    updateSelectedCells(tabKey, cellKeys)
    updateRenderedCellSelection(tabKey, cellKeys)
    syncInspectorSelection(tabKey, cellKeys)
  }

  const clearAllCellSelection = (tabKey: string): void => {
    cancelPendingCellSelectionInteractions(tabKey)
    if (pendingRenderedCellSelectionTimeoutRefs.current[tabKey]) {
      window.clearTimeout(pendingRenderedCellSelectionTimeoutRefs.current[tabKey])
      pendingRenderedCellSelectionTimeoutRefs.current[tabKey] = undefined
    }
    if (pendingRenderedCellSelectionFrameRefs.current[tabKey]) {
      window.cancelAnimationFrame(pendingRenderedCellSelectionFrameRefs.current[tabKey]!)
      pendingRenderedCellSelectionFrameRefs.current[tabKey] = undefined
    }
    runtimeSelectedCellRefs.current[tabKey] = undefined
    contextMenuCellSelectionRefs.current[tabKey] = undefined
    contextMenuCellSelectionSnapshotRefs.current[tabKey] = undefined
    committedSelectedCellRangeRefs.current[tabKey] = undefined
    cellSelectionAnchorRefs.current[tabKey] = undefined
    updateSelectedCells(tabKey, [])
    clearRenderedCellSelection(tabKey)
    syncInspectorSelection(tabKey, [])
  }

  const clearSelectedRowsForTab = (tabKey: string): void => {
    const hadSelectedRows = Boolean(
      rowSelectionDraftRefs.current[tabKey]?.length || selectedRowRefs.current[tabKey]?.length
    )
    rowSelectionDraftRefs.current[tabKey] = undefined
    selectedRowRefs.current[tabKey] = undefined
    if (hadSelectedRows) {
      updateWorkspaceTab(tabKey, { selectedRowKeys: [], selectedRowKeyMap: {} })
    }
    const container = tableBodyRefs.current[tabKey]
    if (container) {
      container.querySelectorAll<HTMLElement>('.row-selected').forEach((element) => {
        element.classList.remove('row-selected')
      })
      container.querySelectorAll<HTMLElement>('.row-number-button.selected').forEach((element) => {
        element.classList.remove('selected')
      })
    }
    renderedSelectedRowRefs.current[tabKey] = undefined
  }

  const scheduleRenderedCellSelectionSync = (tabKey: string): void => {
    const syncNonCellSelection = (): void => {
      syncRenderedColumnSelection(tabKey)
      if (rowDragAnchorRefs.current[tabKey]) {
        return
      }
      const selectedRows = selectedRowRefs.current[tabKey] ?? []
      const container = tableBodyRefs.current[tabKey]
      if (!container) {
        return
      }
      container.querySelectorAll<HTMLElement>('.row-selected').forEach((element) => {
        element.classList.remove('row-selected')
      })
      container.querySelectorAll<HTMLElement>('.row-number-button.selected').forEach((element) => {
        element.classList.remove('selected')
      })
      selectedRows.forEach((rowKey) => {
        container
          .querySelectorAll<HTMLElement>(
            `tr[data-row-key="${CSS.escape(rowKey)}"], .ant-table-row[data-row-key="${CSS.escape(rowKey)}"]`
          )
          .forEach((rowElement) => {
            rowElement.classList.add('row-selected')
            rowElement.querySelector<HTMLElement>('.row-number-button')?.classList.add('selected')
          })
      })
    }
    if (pendingRenderedCellSelectionTimeoutRefs.current[tabKey]) {
      window.clearTimeout(pendingRenderedCellSelectionTimeoutRefs.current[tabKey])
      pendingRenderedCellSelectionTimeoutRefs.current[tabKey] = undefined
    }
    if (pendingRenderedCellSelectionFrameRefs.current[tabKey]) {
      return
    }
    pendingRenderedCellSelectionFrameRefs.current[tabKey] = window.requestAnimationFrame(() => {
      pendingRenderedCellSelectionFrameRefs.current[tabKey] = undefined
      syncNonCellSelection()
      syncRenderedCellSelection(tabKey)
    })
  }

  const applyRuntimeCellSelection = (tabKey: string, rowKey: string, column: string): void => {
    const nextCellKeys = [`${rowKey}:${column}`]
    setRuntimeCellSelection(tabKey, nextCellKeys)
  }

  const applyRuntimeCellRangeSelection = (tabKey: string, cellKeys: string[]): void => {
    setRuntimeCellSelection(tabKey, cellKeys)
  }

  const commitRuntimeCellSelection = (tabKey: string, cellKeys: string[]): void => {
    if (cellKeys.length === 0) {
      clearRuntimeCellSelection(tabKey)
      return
    }
    runtimeSelectedCellRefs.current[tabKey] = undefined
    committedSelectedCellRangeRefs.current[tabKey] = [...cellKeys]
    updateSelectedCells(tabKey, cellKeys)
    updateRenderedCellSelection(tabKey, cellKeys)
    startTransition(() => {
      syncInspectorSelection(tabKey, cellKeys)
    })
  }

  const renderResultTable = (tab: WorkspaceTab): React.ReactNode => (
    <Suspense fallback={<div className="deferred-modal-loading">正在加载数据表格...</div>}>
      <ResultTablePanel
        tab={tab}
        searchState={getImmediateTableSearchState(tab)}
        refs={resultTableRefs}
        getConnection={getConnection}
        updateWorkspaceTab={updateWorkspaceTab}
        updateTableSearchState={updateTableSearchState}
        changeTabPage={changeTabPage}
        changeTabLastPage={changeTabLastPage}
        changeTabLimit={changeTabLimit}
        previewTable={previewTable}
        previewRedisDatabase={previewRedisDatabase}
        showObjectDdl={showObjectDdl}
        openResultExportModal={openResultExportModal}
        addPreviewRow={addPreviewRow}
        markSelectedRowsDeleted={markSelectedRowsDeleted}
        submitPreviewChanges={submitPreviewChanges}
        submitQueryChanges={submitQueryChanges}
        addRedisRow={addRedisRow}
        submitRedisChanges={submitRedisChanges}
        toggleRedisValue={toggleRedisValue}
        updateRedisEdit={updateRedisEdit}
        deleteRedisRow={deleteRedisRow}
        updatePreviewCell={updatePreviewCell}
        updatePreviewCells={updatePreviewCells}
        syncRenderedCellSelection={syncRenderedCellSelection}
        clearInlineCellEditor={clearInlineCellEditor}
        discardInlineCellEditor={discardInlineCellEditor}
        commitInlineCellEditor={commitInlineCellEditor}
        openInlineCellEditor={openInlineCellEditor}
        scheduleRenderedCellSelectionSync={scheduleRenderedCellSelectionSync}
        clearRuntimeColumnSelection={clearRuntimeColumnSelection}
        clearActiveSearchCellHighlight={clearActiveSearchCellHighlight}
        clearAllCellSelection={clearAllCellSelection}
        clearSelectedRowsForTab={clearSelectedRowsForTab}
        applyRuntimeColumnSelection={applyRuntimeColumnSelection}
        applyRuntimeCellSelection={applyRuntimeCellSelection}
        applyRuntimeCellRangeSelection={applyRuntimeCellRangeSelection}
        commitRuntimeCellSelection={commitRuntimeCellSelection}
        setCommittedCellSelection={setCommittedCellSelection}
        syncRuntimeSortButtons={syncRuntimeSortButtons}
        showError={showError}
        messageApi={messageApi}
        isSchemaScopedType={isSchemaScopedType}
        onOpenTableGitHistory={(currentTab) => void openTableGitHistory(currentTab)}
        tableSearchShortcut={shortcutSettings.table_search}
      />
    </Suspense>
  )

  const renderResultTableRef = useRef(renderResultTable)
  renderResultTableRef.current = renderResultTable

  const getDefaultDatabaseName = useCallback(
    (connection?: ConnectionInfo): string | undefined => {
      if (!connection) {
        return undefined
      }
      if (
        connection.database_type !== 'mysql' &&
        connection.database_type !== 'dm' &&
        connection.database_type !== 'oracle' &&
        connection.database_type !== 'mongodb' &&
        connection.database_type !== 'redis' &&
        connection.database_type !== 'clickhouse'
      ) {
        return undefined
      }

      if (connection.database_type === 'oracle') {
        const dbNames = allDatabases[connection.connection_id] ?? []
        return dbNames[0]
      }

      if (connection.database && !connection.database.includes(':')) {
        return connection.database
      }

      const dbNames = allDatabases[connection.connection_id] ?? []
      if (dbNames.length > 0) {
        return dbNames[0]
      }

      return undefined
    },
    [allDatabases]
  )

  const getDefaultPgDatabase = useCallback(
    (connection: ConnectionInfo): string | undefined => {
      if (connection.database_type !== 'postgresql' && connection.database_type !== 'gaussdb') {
        return undefined
      }

      const connectionDb = connection.database?.split('@')[0]
      const dbNames = allDatabases[connection.connection_id] ?? []

      if (connectionDb && dbNames.includes(connectionDb)) {
        return connectionDb
      }

      return connectionDb || dbNames[0]
    },
    [allDatabases]
  )

  const getDefaultPgSchema = useCallback((schemas: string[]): string | undefined => {
    return schemas.includes('public') ? 'public' : schemas[0]
  }, [])

  const preloadCompletionForDatabase = useCallback(
    async (connectionId: string, databaseName?: string): Promise<void> => {
      const cacheKey = `${connectionId}:${databaseName ?? ''}`
      const connection = getConnection(connectionId)

      if (!connection?.is_open || (completionTables[cacheKey] && completionRoutines[cacheKey])) {
        return
      }

      try {
        const databaseQuery = databaseName ? `?database=${encodeURIComponent(databaseName)}` : ''
        const routinePath = `/connections/${connectionId}/objects${databaseQuery}${
          databaseQuery ? '&' : '?'
        }type=procedure`
        const [tableResult, routineResult] = await Promise.allSettled([
          requestJson<{ tables: TableInfo[] }>(`/connections/${connectionId}/tables${databaseQuery}`),
          requestJson<{ objects: DbObjectInfo[] }>(routinePath)
        ])
        if (tableResult.status === 'fulfilled') {
          setCompletionTables((current) => ({
            ...current,
            [cacheKey]: tableResult.value.tables.map((table) => table.name)
          }))
        }
        if (routineResult.status === 'fulfilled') {
          const routines = routineResult.value.objects.flatMap<SqlCompletionRoutine>((object) =>
            object.type === 'procedure' || object.type === 'function'
              ? [{ name: object.name, type: object.type, databaseName }]
              : []
          )
          completionRoutineCacheRef.current[cacheKey] = routines
          setCompletionRoutines((current) => ({
            ...current,
            [cacheKey]: routines
          }))
        }
      } catch {
        // ignore
      }
    },
    [completionRoutines, completionTables, getConnection, requestJson]
  )

  const preloadCompletionForDatabaseRef = useRef(preloadCompletionForDatabase)
  preloadCompletionForDatabaseRef.current = preloadCompletionForDatabase

  const waitForUiCommit = useCallback(async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve())
      })
    })
  }, [])

  const requestJsonRef = useRef(requestJson)
  requestJsonRef.current = requestJson

  const getConnectionRef = useRef(getConnection)
  getConnectionRef.current = getConnection

  const showErrorRef = useRef(showError)
  showErrorRef.current = showError

  const treeRuntime = useMemo(
    () =>
      createTreeRuntime({
        requestJson: (path, options) => requestJsonRef.current(path, options),
        withPgDatabase,
        getConnection: (connectionId) => getConnectionRef.current(connectionId),
        isSchemaScopedType,
        preloadCompletionForDatabase: (connectionId, databaseName) =>
          preloadCompletionForDatabaseRef.current(connectionId, databaseName),
        setAllDatabases,
        setSelectedDatabases,
        selectedDatabasesRef,
        setAllSchemas,
        setSelectedSchemas,
        selectedSchemasRef,
        setTreeData,
        treeDataRef,
        treeLoadingKeysRef,
        expandedKeysRef,
        setExpandedKeys,
        captureTreeScrollPosition: captureResourceTreeScrollPosition,
        notifyTreeLoadingStateChanged: () => {
          setTreeLoadingVersion((current) => current + 1)
        },
        showError: (error, fallback) => showErrorRef.current(error, fallback),
        connectionTypeIcons
      }),
    [withPgDatabase, isSchemaScopedType, captureResourceTreeScrollPosition]
  )

  const ensureDatabasesLoaded = useCallback(
    async (connectionId: string, connectionOverride?: ConnectionInfo): Promise<void> => {
      const connection = connectionOverride ?? getConnection(connectionId)
      if (!connection?.is_open || allDatabases[connectionId]) {
        return
      }

      try {
        const data = await requestJson<{ databases: DatabaseInfo[] }>(
          `/connections/${connectionId}/databases`
        )
        const dbNames = data.databases.map((d) => d.name)
        setAllDatabases((current) => ({ ...current, [connectionId]: dbNames }))
      } catch {
        // ignore
      }
    },
    [allDatabases, getConnection, requestJson]
  )

  const ensureSchemasLoaded = useCallback(
    async (connectionId: string, pgDatabaseName: string): Promise<string[]> => {
      const key = `${connectionId}:${pgDatabaseName}`
      const connection = getConnection(connectionId)

      if (!connection?.is_open) {
        return []
      }

      if (allSchemas[key]) {
        return allSchemas[key]
      }

      try {
        const data = await requestJson<{ databases: DatabaseInfo[] }>(
          `/connections/${connectionId}/schemas?database=${encodeURIComponent(pgDatabaseName)}`
        )
        const schemaNames = data.databases.map((s) => s.name)
        setAllSchemas((current) => ({ ...current, [key]: schemaNames }))
        return schemaNames
      } catch {
        return []
      }
    },
    [allSchemas, getConnection, requestJson]
  )

  const openRedisDatabaseBrowser = async (
    connectionId: string,
    databaseName: string,
    limit = REDIS_DEFAULT_LIMIT,
    page = 1
  ): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const tabKey = `redis:${connectionId}:${databaseName}`
    startTransition(() => {
      setSelectedConnectionId(connectionId)
      setActiveTabKey(tabKey)
    })
    setWorkspaceTabs((current) => {
      const exists = current.some((tab) => tab.key === tabKey)
      if (exists) {
        return current.map((tab) =>
          tab.key === tabKey ? { ...tab, limit, page, loading: true, error: undefined } : tab
        )
      }
      return [
        ...current,
        {
          key: tabKey,
          title: `Redis ${databaseName}`,
          kind: 'redis-browser',
          connectionId,
          databaseName,
          tableName: '__DATADJINN_REDIS_DATABASE__',
          sql: '',
          limit,
          page,
          where: '',
          loading: true,
          redisMode: 'database',
          redisExpandedValues: {}
        }
      ]
    })

    await previewRedisDatabase(connectionId, databaseName, limit, page, tabKey, '')
  }

  const previewRedisDatabase = async (
    connectionId: string,
    databaseName: string,
    limit = REDIS_DEFAULT_LIMIT,
    page = 1,
    tabKey = `redis:${connectionId}:${databaseName}`,
    where = ''
  ): Promise<void> => {
    try {
      const previewPath = withWhereQuery(
        withPageQuery(
          withPgDatabase(
            `/connections/${connectionId}/tables/__DATADJINN_REDIS_DATABASE__/preview`,
            databaseName
          ),
          limit,
          page
        ),
        where
      )
      const result = await requestJson<QueryResponse>(previewPath)
      updateWorkspaceTab(tabKey, {
        result,
        redisEdits: buildRedisEdits(result.rows),
        redisExpandedValues: {},
        page,
        limit,
        where,
        loading: false,
        error: undefined
      })
    } catch (err) {
      updateWorkspaceTab(tabKey, {
        loading: false,
        error: err instanceof Error ? err.message : '加载 Redis Key 失败'
      })
      showError(err instanceof Error ? err.message : '加载 Redis Key 失败')
    }
  }

  const checkHealth = async (silent = false): Promise<void> => {
    setHealthLoading(true)

    try {
      await requestJson<HealthStatus>('/health')
    } catch (err) {
      if (!silent) {
        showError(err instanceof Error ? err.message : '无法连接后端服务')
      }
    } finally {
      setHealthLoading(false)
    }
  }

  const loadConnections = async (): Promise<void> => {
    const data = await requestJson<{ connections: ConnectionInfo[] }>('/connections')
    setConnections(data.connections)
    setConnectionsInitialized(true)
    setSelectedConnectionId((current) => current ?? data.connections[0]?.connection_id)
    setSelectedConnectionIds((current) =>
      current.length > 0
        ? current
        : data.connections[0]?.connection_id
          ? [data.connections[0].connection_id]
          : []
    )
    setSelectedTreeKeys((current) =>
      current.length > 0
        ? current
        : data.connections[0]?.connection_id
          ? [`connection:${data.connections[0].connection_id}`]
          : []
    )

    refreshTree(data.connections)
  }

  const loadConnectionTreePreferences = async (): Promise<void> => {
    const [response, storedPreferences] = await Promise.all([
      requestJson<{
        exists: boolean
        preferences: Record<string, unknown>
      }>('/preferences/connection-tree'),
      window.api.getConnectionTreePreferences()
    ])
    const storedTreePreferences =
      storedPreferences && typeof storedPreferences === 'object' && !Array.isArray(storedPreferences)
        ? storedPreferences
        : {}
    const hasMeaningfulTreePreferences = (candidate: Record<string, unknown>): boolean =>
      Object.values(candidate).some((value) => {
        if (Array.isArray(value)) {
          return value.length > 0
        }
        if (value && typeof value === 'object') {
          return Object.keys(value).length > 0
        }
        return value === true
      })
    const stringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    const stringRecord = (value: unknown): Record<string, string> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).flatMap(([key, item]) =>
              typeof item === 'string' ? ([[key, item]] as [string, string][]) : []
            )
          )
        : {}
    const stringArrayRecord = (value: unknown): Record<string, string[]> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, stringArray(item)])
          )
        : {}

    const storedHasTreePreferenceKeys =
      Object.hasOwn(storedTreePreferences, 'connection_folders') ||
      Object.hasOwn(storedTreePreferences, 'connection_folder_assignments') ||
      Object.hasOwn(storedTreePreferences, 'selected_databases')
    const serverHasTreePreferenceKeys =
      Object.hasOwn(response.preferences, 'connection_folders') ||
      Object.hasOwn(response.preferences, 'connection_folder_assignments') ||
      Object.hasOwn(response.preferences, 'selected_databases')
    const localTreePreferences = {
      connection_folders: connectionFolders,
      connection_folder_assignments: connectionFolderAssignments,
      connection_folder_order: connectionFolderOrder,
      root_connection_order: rootConnectionOrder,
      root_item_order: rootItemOrder,
      root_item_order_customized: rootItemOrderCustomized,
      pinned_root_item_ids: pinnedRootItemIds,
      folder_connection_order: folderConnectionOrder,
      selected_databases: selectedDatabasesRef.current,
      selected_schemas: selectedSchemasRef.current
    }
    const storedHasMeaningfulTreePreferences = hasMeaningfulTreePreferences(storedTreePreferences)
    const serverHasMeaningfulTreePreferences =
      response.exists && hasMeaningfulTreePreferences(response.preferences)
    const localHasMeaningfulTreePreferences = hasMeaningfulTreePreferences(localTreePreferences)
    const shouldMigrateLegacyPreferences =
      !storedHasMeaningfulTreePreferences &&
      !serverHasMeaningfulTreePreferences &&
      localHasMeaningfulTreePreferences
    const preferences = storedHasMeaningfulTreePreferences
      ? storedTreePreferences
      : serverHasMeaningfulTreePreferences
        ? response.preferences
        : localTreePreferences

    if (
      storedHasMeaningfulTreePreferences ||
      serverHasMeaningfulTreePreferences ||
      localHasMeaningfulTreePreferences
    ) {
      setConnectionFolders(
        Array.isArray(preferences.connection_folders)
          ? preferences.connection_folders.filter(
              (item): item is ConnectionFolder =>
                Boolean(item) &&
                typeof item === 'object' &&
                typeof (item as ConnectionFolder).id === 'string' &&
                typeof (item as ConnectionFolder).name === 'string'
            )
          : []
      )
      setConnectionFolderAssignments(stringRecord(preferences.connection_folder_assignments))
      setConnectionFolderOrder(stringArray(preferences.connection_folder_order))
      setRootConnectionOrder(stringArray(preferences.root_connection_order))
      setRootItemOrder(stringArray(preferences.root_item_order))
      setRootItemOrderCustomized(preferences.root_item_order_customized === true)
      setPinnedRootItemIds(stringArray(preferences.pinned_root_item_ids))
      setFolderConnectionOrder(stringArrayRecord(preferences.folder_connection_order))
      const restoredSelectedDatabases = stringArrayRecord(preferences.selected_databases)
      const restoredSelectedSchemas = stringArrayRecord(preferences.selected_schemas)
      selectedDatabasesRef.current = restoredSelectedDatabases
      selectedSchemasRef.current = restoredSelectedSchemas
      setSelectedDatabases(restoredSelectedDatabases)
      setSelectedSchemas(restoredSelectedSchemas)
    }

    if (
      shouldMigrateLegacyPreferences ||
      (!storedHasTreePreferenceKeys && !serverHasTreePreferenceKeys)
    ) {
      // 首次升级时把旧版本仅存于 Chromium localStorage 的树状态立即迁移到
      // 用户数据目录，不能等异步防抖写入，避免安装覆盖后的首次退出丢失分组。
      await Promise.all([
        requestJson('/preferences/connection-tree', {
          method: 'PUT',
          body: JSON.stringify({ preferences: localTreePreferences })
        }),
        window.api.setConnectionTreePreferences(localTreePreferences)
      ])
    }

    // Let the restoration state commit before enabling writes, so an empty
    // renderer cache cannot overwrite the durable preferences during startup.
    window.requestAnimationFrame(() => setConnectionTreePreferencesReady(true))
  }

  useEffect(() => {
    if (!connectionTreePreferencesReady) {
      return
    }

    const preferences = {
      connection_folders: connectionFolders,
      connection_folder_assignments: connectionFolderAssignments,
      connection_folder_order: connectionFolderOrder,
      root_connection_order: rootConnectionOrder,
      root_item_order: rootItemOrder,
      root_item_order_customized: rootItemOrderCustomized,
      pinned_root_item_ids: pinnedRootItemIds,
      folder_connection_order: folderConnectionOrder,
      selected_databases: selectedDatabases,
      selected_schemas: selectedSchemas
    }
    void Promise.all([
      requestJson('/preferences/connection-tree', {
        method: 'PUT',
        body: JSON.stringify({ preferences })
      }),
      window.api.setConnectionTreePreferences(preferences)
    ]).catch(() => undefined)
  }, [
    connectionFolderAssignments,
    connectionFolderOrder,
    connectionFolders,
    connectionTreePreferencesReady,
    folderConnectionOrder,
    pinnedRootItemIds,
    rootConnectionOrder,
    rootItemOrder,
    rootItemOrderCustomized,
    selectedDatabases,
    selectedSchemas
  ])

  const buildLocalGitSyncPayload = async (): Promise<GitSyncPayload> => {
    const [connectionSnapshot, appSettings] = await Promise.all([
      requestJson<{ connections: Record<string, Record<string, unknown>> }>('/git-sync/local/connections'),
      window.api.getAppSyncSettings()
    ])
    return {
      format: 'datadjinn-sync',
      version: 1,
      generated_at: new Date().toISOString(),
      device_id: getSyncDeviceId(),
      connections: connectionSnapshot.connections,
      settings: appSettings as unknown as Record<string, unknown>,
      preferences: {
        theme,
        shortcut_settings: shortcutSettings,
        connection_folders: connectionFolders,
        connection_folder_assignments: connectionFolderAssignments,
        tree_order: buildGitSyncTreeOrder({
          folders: connectionFolders,
          connectionIds: connections.map((connection) => connection.connection_id),
          assignments: connectionFolderAssignments,
          folderOrder: connectionFolderOrder,
          folderConnectionOrder,
          rootItemOrder,
          rootConnectionOrder,
          pinnedRootItemIds,
          rootItemOrderCustomized
        }),
        pinned_root_item_ids: pinnedRootItemIds,
        selected_databases: selectedDatabases,
        selected_schemas: selectedSchemas
      }
    }
  }

  const applyGitSyncPayload = async (payload: GitSyncPayload): Promise<void> => {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    const toStringRecord = (value: unknown): Record<string, string> =>
      isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).flatMap(([key, item]) =>
              key && typeof item === 'string' ? ([[key, item]] as [string, string][]) : []
            )
          )
        : {}
    const toStringArrayRecord = (value: unknown): Record<string, string[]> =>
      isRecord(value)
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toStringArray(item)]))
        : {}
    const preferences = payload.preferences

    gitSyncRestoreTargetRef.current = {
      connectionIds: new Set(Object.keys(payload.connections)),
      folderIds: new Set(
        Array.isArray(preferences.connection_folders)
          ? preferences.connection_folders.flatMap((folder) =>
              isRecord(folder) && typeof folder.id === 'string' ? [folder.id] : []
            )
          : []
      ),
      assignments: toStringRecord(preferences.connection_folder_assignments)
    }

    await requestJson<{ connection_count: number }>('/git-sync/local/connections', {
      method: 'PUT',
      body: JSON.stringify({ connections: payload.connections })
    })
    // 先让连接列表进入 React 状态，再恢复分组归属，避免连接归属清理逻辑误删远端映射。
    await loadConnections()
    await window.api.applyAppSyncSettings(payload.settings as never)
    if (preferences.theme === 'dark' || preferences.theme === 'light') {
      setTheme(preferences.theme)
    }
    if (isRecord(preferences.shortcut_settings)) {
      const syncedShortcuts = preferences.shortcut_settings
      setShortcutSettings(
        (current) =>
          ({
            ...DEFAULT_SHORTCUT_SETTINGS,
            ...current,
            ...syncedShortcuts
          }) as ShortcutSettings
      )
    }
    if (Array.isArray(preferences.connection_folders)) {
      setConnectionFolders(
        preferences.connection_folders.filter(
          (item): item is ConnectionFolder =>
            isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
        )
      )
    }
    setConnectionFolderAssignments(toStringRecord(preferences.connection_folder_assignments))
    const syncedTreeOrder = isRecord(preferences.tree_order) ? preferences.tree_order : undefined
    if (syncedTreeOrder) {
      const syncedRoots = toStringArray(syncedTreeOrder.roots)
      setRootItemOrder(syncedRoots)
      setRootConnectionOrder(
        syncedRoots
          .filter((itemId) => itemId.startsWith('connection:'))
          .map((itemId) => itemId.slice('connection:'.length))
      )
      setRootItemOrderCustomized(syncedTreeOrder.customized === true)
      const syncedChildren = toStringArrayRecord(syncedTreeOrder.children)
      if (Object.keys(syncedChildren).length > 0) {
        setConnectionFolderOrder(
          [syncedRoots, ...Object.values(syncedChildren)]
            .flatMap((itemIds) => itemIds.filter((itemId) => itemId.startsWith('folder:')))
            .map((itemId) => itemId.slice('folder:'.length))
        )
        setFolderConnectionOrder(
          Object.fromEntries(
            Object.entries(syncedChildren).map(([folderId, itemIds]) => [
              folderId,
              itemIds
                .filter((itemId) => itemId.startsWith('connection:'))
                .map((itemId) => itemId.slice('connection:'.length))
            ])
          )
        )
      } else {
        setConnectionFolderOrder(toStringArray(syncedTreeOrder.folder_order))
        setFolderConnectionOrder(toStringArrayRecord(syncedTreeOrder.folder_connections))
      }
    } else {
      setConnectionFolderOrder(toStringArray(preferences.connection_folder_order))
      setRootConnectionOrder(toStringArray(preferences.root_connection_order))
      setRootItemOrder(toStringArray(preferences.root_item_order))
      setRootItemOrderCustomized(preferences.root_item_order_customized === true)
      setFolderConnectionOrder(toStringArrayRecord(preferences.folder_connection_order))
    }
    setPinnedRootItemIds(toStringArray(preferences.pinned_root_item_ids))
    setSelectedDatabases(toStringArrayRecord(preferences.selected_databases))
    setSelectedSchemas(toStringArrayRecord(preferences.selected_schemas))
    await Promise.all([refreshUpdateSettings(), refreshQuerySettings(), refreshMcpSettings()])
    window.dispatchEvent(new CustomEvent('datadjinn-ai-configs-changed'))
  }

  const finishGitSync = async (
    payload: GitSyncPayload,
    passphrase: string,
    remoteSha?: string,
    silent = false
  ): Promise<void> => {
    const pushed = await requestJson<{ sha: string }>('/git-sync/file', {
      method: 'PUT',
      body: JSON.stringify({ passphrase, payload, remote_sha: remoteSha })
    })
    await applyGitSyncPayload(payload)
    const syncedAt = Date.now()
    await window.api.setSyncLocalState({
      passphrase,
      basePayload: payload,
      remoteSha: pushed.sha,
      lastSyncedAt: syncedAt
    })
    setGitSyncLastSyncedAt(syncedAt)
    setGitSyncRemoteExists(true)
    setGitSyncPassphrase(passphrase)
    setGitSyncPassphraseConfirm(passphrase)
    if (!silent) {
      messageApi.success('已同步应用设置和连接信息')
    }
  }

  const synchronizeGitPayload = async (
    readPassphrase: string,
    writePassphrase = readPassphrase,
    options?: { silent?: boolean }
  ): Promise<boolean> => {
    const [local, localState, pulled] = await Promise.all([
      buildLocalGitSyncPayload(),
      window.api.getSyncLocalState() as Promise<GitSyncLocalState>,
      requestJson<{ exists: boolean; sha?: string; payload?: GitSyncPayload }>('/git-sync/file/pull', {
        method: 'POST',
        body: JSON.stringify({ passphrase: readPassphrase })
      })
    ])
    if (!pulled.exists || !pulled.payload) {
      await finishGitSync(local, writePassphrase, undefined, options?.silent)
      return true
    }

    const base = localState.basePayload ?? {
      ...local,
      connections: {},
      settings: local.settings,
      preferences: local.preferences
    }
    const merged = await requestJson<GitSyncMergeResult>('/git-sync/merge', {
      method: 'POST',
      body: JSON.stringify({ base, local, remote: pulled.payload })
    })
    if (merged.conflicts.length > 0) {
      setGitSyncConflicts(merged.conflicts)
      setGitSyncConflictChoices(createDefaultGitSyncConflictChoices(merged.conflicts))
      setGitSyncPendingPayload(merged.payload)
      setGitSyncPendingRemoteSha(pulled.sha)
      setGitSyncPendingPassphrase(writePassphrase)
      return false
    }
    await finishGitSync(merged.payload, writePassphrase, pulled.sha, options?.silent)
    return true
  }

  const startGitSync = async (options?: {
    automatic?: boolean
    passphrase?: string
  }): Promise<void> => {
    const automatic = Boolean(options?.automatic)
    const passphrase = (options?.passphrase ?? gitSyncPassphrase).trim()
    if (passphrase.length < 8) {
      if (!automatic) {
        messageApi.warning('请设置至少 8 个字符的同步口令')
      }
      return
    }
    if (
      !gitSyncLastSyncedAt &&
      !gitSyncRemoteExists &&
      gitSyncPassphraseConfirm.trim() &&
      passphrase !== gitSyncPassphraseConfirm.trim()
    ) {
      if (!automatic) {
        messageApi.warning('两次同步口令不一致')
      }
      return
    }
    if (!gitHubAuthStatus.authorized) {
      if (!automatic) {
        openSettings('sync')
        messageApi.info('请先登录 GitHub 后再同步')
      }
      return
    }

    setGitSyncBusy(true)
    try {
      await synchronizeGitPayload(passphrase, passphrase, { silent: automatic })
    } catch (error) {
      if (!automatic) {
        showError(error instanceof Error ? error.message : '同步失败')
      }
    } finally {
      setGitSyncBusy(false)
    }
  }

  const setGitSyncAutoSyncEnabled = async (enabled: boolean): Promise<void> => {
    const state = await window.api.setSyncLocalState({ autoSyncEnabled: enabled })
    setGitSyncAutoEnabled(Boolean(state.autoSyncEnabled))
  }

  const changeGitSyncPassphrase = async (): Promise<void> => {
    const currentPassphrase = currentGitSyncPassphrase.trim()
    const nextPassphrase = nextGitSyncPassphrase.trim()
    if (!currentPassphrase) {
      messageApi.warning('请输入当前同步口令')
      return
    }
    if (nextPassphrase.length < 8) {
      messageApi.warning('新同步口令至少需要 8 个字符')
      return
    }
    if (nextPassphrase !== nextGitSyncPassphraseConfirm.trim()) {
      messageApi.warning('两次输入的新同步口令不一致')
      return
    }
    if (!gitHubAuthStatus.authorized) {
      openSettings('sync')
      messageApi.info('请先登录 GitHub 后再修改同步口令')
      return
    }

    setGitSyncBusy(true)
    try {
      await synchronizeGitPayload(currentPassphrase, nextPassphrase)
      setChangingGitSyncPassphrase(false)
      setCurrentGitSyncPassphrase('')
      setNextGitSyncPassphrase('')
      setNextGitSyncPassphraseConfirm('')
    } catch (error) {
      showError(error instanceof Error ? error.message : '修改同步口令失败')
    } finally {
      setGitSyncBusy(false)
    }
  }

  const resolveGitSyncConflicts = async (): Promise<void> => {
    if (!gitSyncPendingPayload || gitSyncConflicts.some((item) => !gitSyncConflictChoices[item.key])) {
      messageApi.warning('请为每项冲突选择保留本机或远程配置')
      return
    }
    setGitSyncBusy(true)
    try {
      const resolved = await requestJson<GitSyncPayload>('/git-sync/merge/resolve', {
        method: 'POST',
        body: JSON.stringify({
          payload: gitSyncPendingPayload,
          conflicts: gitSyncConflicts,
          choices: gitSyncConflictChoices
        })
      })
      await finishGitSync(resolved, gitSyncPendingPassphrase, gitSyncPendingRemoteSha)
      setGitSyncConflicts([])
      setGitSyncPendingPayload(undefined)
      setGitSyncPendingRemoteSha(undefined)
      setGitSyncPendingPassphrase('')
    } catch (error) {
      showError(error instanceof Error ? error.message : '处理同步冲突失败')
    } finally {
      setGitSyncBusy(false)
    }
  }

  const {
    ensureQueryContextTreeExpanded,
    preloadConnectionTree,
    preloadDatabaseChildren,
    reloadNodeChildren,
    collapseTreeNode,
    toggleOrLoadTreeNode
  } = treeRuntime

  const openConnectionModalRef = useRef<(nextDatabaseType: DatabaseType) => Promise<void>>(
    async () => undefined
  )
  const buildConnectionSshDefaults = (): Pick<
    ConnectionFormValues,
    | 'ssh_enabled'
    | 'ssh_port'
    | 'ssh_auth_type'
    | 'git_versioning_enabled'
    | 'git_versioning_scopes'
  > => ({
    ssh_enabled: false,
    ssh_port: 22,
    ssh_auth_type: 'password',
    git_versioning_enabled: false,
    git_versioning_scopes: []
  })

  const buildCreateConnectionDefaults = (nextDatabaseType: DatabaseType): ConnectionFormValues => {
    if (nextDatabaseType === 'sqlite') {
      return {
        database_type: 'sqlite',
        name: '本地 SQLite',
        sqlite_path: 'data/datadjinn.sqlite'
      }
    }
    if (nextDatabaseType === 'postgresql') {
      return {
        database_type: 'postgresql',
        name: 'PostgreSQL',
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        ...buildConnectionSshDefaults()
      }
    }
    if (nextDatabaseType === 'dm') {
      return {
        database_type: 'dm',
        name: '达梦',
        host: '127.0.0.1',
        port: 5236,
        username: 'SYSDBA',
        driver_id: undefined,
        dm_driver_id: undefined,
        ...buildConnectionSshDefaults()
      }
    }
    if (nextDatabaseType === 'gaussdb') {
      return {
        database_type: 'gaussdb',
        name: '高斯数据库',
        host: '127.0.0.1',
        port: 8000,
        username: 'gaussdb',
        database: 'postgres',
        driver_id: undefined,
        ...buildConnectionSshDefaults()
      }
    }
    if (nextDatabaseType === 'oracle') {
      return {
        database_type: 'oracle',
        name: 'Oracle',
        host: '127.0.0.1',
        port: 1521,
        username: 'system',
        database: 'orclpdb1',
        ...buildConnectionSshDefaults()
      }
    }
    if (nextDatabaseType === 'mongodb') {
      return {
        database_type: 'mongodb',
        name: 'MongoDB',
        host: '127.0.0.1',
        port: 27017,
        database: 'admin',
        ...buildConnectionSshDefaults()
      }
    }
    if (nextDatabaseType === 'redis') {
      return {
        database_type: 'redis',
        name: 'Redis',
        host: '127.0.0.1',
        port: 6379,
        database: '0',
        ...buildConnectionSshDefaults()
      }
    }
    if (nextDatabaseType === 'clickhouse') {
      return {
        database_type: 'clickhouse',
        name: 'ClickHouse',
        host: '127.0.0.1',
        port: 8123,
        username: 'default',
        database: 'default',
        ...buildConnectionSshDefaults()
      }
    }
    return {
      database_type: 'mysql',
      name: 'MySQL',
      host: '127.0.0.1',
      port: 3306,
      ...buildConnectionSshDefaults()
    }
  }

  const openConnectionModal = async (nextDatabaseType: DatabaseType): Promise<void> => {
    const defaults = buildCreateConnectionDefaults(nextDatabaseType)
    resetConnectionTestingState()
    setConnectionMode('create')
    setEditingConnectionInfoId(undefined)
    setConnectionModalFolderId(undefined)
    if (connectionModalHydrationFrameRef.current != null) {
      window.cancelAnimationFrame(connectionModalHydrationFrameRef.current)
      connectionModalHydrationFrameRef.current = undefined
    }
    flushSync(() => {
      setConnectionModalDatabaseType(nextDatabaseType)
    })
    setConnectionLoading(false)
    setConnectionModalOpen(true)
    connectionModalHydrationFrameRef.current = window.requestAnimationFrame(() => {
      connectionModalHydrationFrameRef.current = undefined
      form.resetFields()
      form.setFieldsValue(defaults)
    })

    if (nextDatabaseType === 'dm' || nextDatabaseType === 'gaussdb') {
      void loadDrivers()
    }
  }

  openConnectionModalRef.current = openConnectionModal

  const openEditConnectionModal = async (connection: ConnectionInfo): Promise<void> => {
    resetConnectionTestingState()
    if (connectionModalHydrationFrameRef.current != null) {
      window.cancelAnimationFrame(connectionModalHydrationFrameRef.current)
      connectionModalHydrationFrameRef.current = undefined
    }
    setConnectionMode('edit')
    setEditingConnectionInfoId(connection.connection_id)
    setConnectionModalFolderId(undefined)
    flushSync(() => {
      setConnectionModalDatabaseType(connection.database_type)
    })
    setConnectionLoading(true)
    form.resetFields()
    form.setFieldsValue({
      database_type: connection.database_type,
      name: connection.name
    })
    setConnectionModalOpen(true)

    try {
      const data = await requestJson<ConnectionFormValues>(
        `/connections/${connection.connection_id}`
      )
      const formValues: ConnectionFormValues = {
        ...data,
        ssh_enabled: Boolean(data.ssh_enabled),
        ssh_port: data.ssh_port ?? 22,
        ssh_auth_type: data.ssh_auth_type ?? 'password'
      }
      if (data.database_type === 'dm' || data.database_type === 'gaussdb') {
        const loadedDrivers = await loadDrivers()
        const currentDriverId = data.driver_id ?? data.dm_driver_id
        const hasSelectedDriver = loadedDrivers.some(
          (driver) => driver.database_type === data.database_type && driver.id === currentDriverId
        )
        formValues.driver_id = currentDriverId
        if (data.database_type === 'dm') {
          formValues.dm_driver_id = currentDriverId
        }
        if (!hasSelectedDriver) {
          formValues.driver_id = undefined
          if (data.database_type === 'dm') {
            formValues.dm_driver_id = undefined
          }
        }
      }
      setConnectionModalDatabaseType(formValues.database_type)
      form.setFieldsValue({
        database_type: formValues.database_type,
        name: formValues.name,
        host: formValues.host,
        port: formValues.port,
        username: formValues.username,
        password: formValues.password,
        database: formValues.database,
        sqlite_path: formValues.sqlite_path,
        driver_id: formValues.driver_id,
        dm_driver_id: formValues.dm_driver_id,
        ssh_enabled: formValues.ssh_enabled,
        ssh_auth_type: formValues.ssh_auth_type,
        git_versioning_enabled: Boolean(formValues.git_versioning_enabled),
        git_versioning_scopes: formValues.git_versioning_scopes
      })
      const applyDeferredSshFields = (): void => {
        form.setFieldsValue({
          ssh_host: formValues.ssh_host,
          ssh_port: formValues.ssh_port,
          ssh_username: formValues.ssh_username,
          ssh_password: formValues.ssh_password,
          ssh_private_key_path: formValues.ssh_private_key_path,
          ssh_passphrase: formValues.ssh_passphrase
        })
      }
      connectionModalHydrationFrameRef.current = window.requestAnimationFrame(() => {
        connectionModalHydrationFrameRef.current = window.requestAnimationFrame(() => {
          connectionModalHydrationFrameRef.current = undefined
          applyDeferredSshFields()
        })
      })
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载连接信息失败')
      closeConnectionModal()
    } finally {
      setConnectionLoading(false)
    }
  }

  const stableConnectionCreateMenuItems = useMemo<NonNullable<MenuProps['items']>>(
    () => [
      {
        key: 'sqlite',
        label: 'SQLite',
        icon: <img src={sqliteIcon} alt="" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'mysql',
        label: 'MySQL',
        icon: <img src={mysqlIcon} alt="" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'postgresql',
        label: 'PostgreSQL',
        icon: <img src={postgresIcon} alt="" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'oracle',
        label: 'Oracle',
        icon: <img src={oracleIcon} alt="Oracle" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'mongodb',
        label: 'MongoDB',
        icon: <img src={mongoIcon} alt="" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'redis',
        label: 'Redis',
        icon: <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'clickhouse',
        label: 'ClickHouse',
        icon: <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} />
      },
      {
        key: 'others',
        label: '其他',
        icon: <DatabaseOutlined />,
        popupClassName: 'resource-create-submenu-popup',
        children: [
          {
            key: 'dm',
            label: '达梦',
            icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} />
          },
          { key: 'gaussdb', label: '高斯数据库', icon: <DatabaseOutlined /> }
        ]
      }
    ],
    []
  )

  const importConnectionPreviewColumns: ColumnsType<ImportConnectionCandidate> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      ellipsis: true
    },
    {
      title: '类型',
      dataIndex: 'database_type',
      key: 'database_type',
      width: 100,
      render: (value?: DatabaseType) => (value ? DATABASE_TYPE_LABELS[value] : '-')
    },
    {
      title: '分组',
      dataIndex: 'sourceFolderName',
      key: 'sourceFolderName',
      width: 150,
      ellipsis: true,
      render: (value?: string) => value || '-'
    },
    {
      title: '主机',
      dataIndex: 'host',
      key: 'host',
      width: 160,
      ellipsis: true,
      render: (value?: string) => value || '-'
    },
    {
      title: '端口',
      dataIndex: 'port',
      key: 'port',
      width: 90,
      render: (value?: number) => value ?? '-'
    },
    {
      title: '数据库 / Schema',
      dataIndex: 'database',
      key: 'database',
      width: 180,
      ellipsis: true,
      render: (value?: string) => value || '-'
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 120,
      ellipsis: true,
      render: (value?: string) => value || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: ImportConnectionCandidateStatus) => (
        <Tag color={value === 'ready' ? 'success' : value === 'warning' ? 'warning' : 'error'}>
          {value === 'ready' ? '可导入' : value === 'warning' ? '需确认' : '解析失败'}
        </Tag>
      )
    },
    {
      title: '说明',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (value?: string) => value || '-'
    }
  ]

  const resourceCreateMenu = useMemo(
    () => ({
      items: [
        { key: 'folder', label: '新建分组', icon: <FolderAddOutlined /> },
        { type: 'divider' as const },
        ...stableConnectionCreateMenuItems
      ],
      onClick: ({ key }: { key: string }) => {
        if (key === 'folder') {
          openCreateFolderModal()
          return
        }
        void openConnectionModalRef.current(key as DatabaseType)
      }
    }),
    [openCreateFolderModal, stableConnectionCreateMenuItems]
  )

  const buildConnectionSshPayload = (
    values: ConnectionFormValues
  ): Partial<ConnectionFormValues> => {
    if (values.database_type === 'sqlite') {
      return {}
    }

    if (!values.ssh_enabled) {
      return { ssh_enabled: false }
    }

    const sshAuthType = values.ssh_auth_type ?? 'password'
    return {
      ssh_enabled: true,
      ssh_host: trimToUndefined(values.ssh_host),
      ssh_port: values.ssh_port ?? 22,
      ssh_username: trimToUndefined(values.ssh_username),
      ssh_auth_type: sshAuthType,
      ssh_password: sshAuthType === 'password' ? values.ssh_password : undefined,
      ssh_private_key_path:
        sshAuthType === 'private_key' ? trimToUndefined(values.ssh_private_key_path) : undefined,
      ssh_passphrase: sshAuthType === 'private_key' ? values.ssh_passphrase : undefined
    }
  }

  const cleanFormValues = (values: ConnectionFormValues): ConnectionFormValues => {
    const gitVersioning = {
      git_versioning_enabled: Boolean(values.git_versioning_enabled),
      git_versioning_scopes: Array.from(
        new Set(
          (values.git_versioning_scopes ?? [])
            .map((scope) => scope.trim())
            .filter(Boolean)
        )
      )
    }
    if (values.database_type === 'sqlite') {
      return {
        name: values.name,
        database_type: 'sqlite',
        sqlite_path: values.sqlite_path,
        ...gitVersioning
      }
    }

    if (values.database_type === 'postgresql') {
      return {
        name: values.name,
        database_type: 'postgresql',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    if (values.database_type === 'dm') {
      return {
        name: values.name,
        database_type: 'dm',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        driver_id: values.driver_id ?? values.dm_driver_id,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    if (values.database_type === 'gaussdb') {
      return {
        name: values.name,
        database_type: 'gaussdb',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        driver_id: values.driver_id,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    if (values.database_type === 'oracle') {
      return {
        name: values.name,
        database_type: 'oracle',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    if (values.database_type === 'mongodb') {
      return {
        name: values.name,
        database_type: 'mongodb',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    if (values.database_type === 'redis') {
      return {
        name: values.name,
        database_type: 'redis',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    if (values.database_type === 'clickhouse') {
      return {
        name: values.name,
        database_type: 'clickhouse',
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        ...gitVersioning,
        ...buildConnectionSshPayload(values)
      }
    }

    return {
      name: values.name,
      database_type: 'mysql',
      host: values.host,
      port: values.port,
      username: values.username,
      password: values.password,
      database: values.database,
      ...gitVersioning,
      ...buildConnectionSshPayload(values)
    }
  }

  const selectDriverFile = async (): Promise<void> => {
    const filePath = await window.api.selectDriverFile()

    if (filePath) {
      driverForm.setFieldValue('path', filePath)
      driverForm.setFieldValue('name', filePath.split(/[\\/]/).pop() ?? 'dmPython')
    }
  }

  const saveJdbcJavaConfig = async (): Promise<void> => {
    const nextJavaHome = jdbcJavaHome.trim()
    const previousJavaHome = configuredJdbcJavaHome
    const previousEnabled = configuredJdbcJavaEnabled

    if (jdbcJavaEnabled && !nextJavaHome) {
      messageApi.warning('开启 JDBC Java 环境前请选择 Java 目录')
      return
    }

    const result = await requestJson<JavaRuntimeConfigResponse>('/drivers/java/config', {
      method: 'PUT',
      body: JSON.stringify({ enabled: jdbcJavaEnabled, java_home: nextJavaHome || null })
    })
    const savedJavaHome = result.java_home ?? ''
    const savedEnabled = result.enabled
    setJdbcJavaHome(savedJavaHome)
    setJdbcJavaEnabled(savedEnabled)
    setConfiguredJdbcJavaHome(savedJavaHome)
    setConfiguredJdbcJavaEnabled(savedEnabled)

    if (savedJavaHome !== previousJavaHome || savedEnabled !== previousEnabled) {
      Modal.confirm({
        title: '需要重启后端服务',
        content:
          'JDBC Java 环境已修改。由于 JVM 启动后不能切换 Java 版本，重启后端服务后才能生效。是否现在重启？',
        okText: '确认并重启服务',
        cancelText: '取消',
        centered: true,
        maskClosable: false,
        onOk: async () => {
          const restartStatus = await window.api.restartBackend()
          if (restartStatus.state !== 'online') {
            throw new Error(restartStatus.message ?? '后端服务重启失败')
          }
          setJavaRestartRequired(false)
          messageApi.success('后端服务已重启，JDBC Java 设置已生效')
        },
        onCancel: () => {
          setJavaRestartRequired(true)
        }
      })
      return
    }

    messageApi.success(
      savedEnabled
        ? `JDBC Java 环境已设置为 Java ${result.major ?? '未知版本'}`
        : '已关闭 JDBC Java 环境'
    )
  }

  const selectJavaDirectory = async (): Promise<void> => {
    const directory = await window.api.selectJavaDirectory()

    if (directory) {
      setJdbcJavaHome(directory)
    }
  }

  const loadJavaRuntimes = async (): Promise<void> => {
    try {
      const result = await requestJson<JavaDetectResponse>('/drivers/java')
      const configured = result.configured ?? ''
      setJavaRuntimes(result.runtimes)
      setJdbcJavaHome(configured || result.preferred || '')
      setJdbcJavaEnabled(result.enabled)
      setConfiguredJdbcJavaHome(configured)
      setConfiguredJdbcJavaEnabled(result.enabled)
    } catch {
      setJavaRuntimes([])
    }
  }

  const loadDrivers = async (): Promise<DriverInfo[]> => {
    setDriversLoading(true)
    try {
      const result = await requestJson<{ drivers: DriverInfo[] }>('/drivers')
      const normalizedDrivers = Array.isArray(result.drivers)
        ? result.drivers
            .map((driver) => normalizeDriverInfo(driver))
            .filter((driver): driver is DriverInfo => driver !== null)
        : []
      setDrivers(normalizedDrivers)
      return normalizedDrivers
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载驱动失败')
      setDrivers([])
      return []
    } finally {
      setDriversLoading(false)
    }
  }

  const selectSqliteFile = async (): Promise<void> => {
    const filePath = await window.api.selectSqliteFile()

    if (filePath) {
      form.setFieldValue('sqlite_path', filePath)
      if (connectionMode !== 'edit') {
        const fileName = filePath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.(db|sqlite|sqlite3)$/i, '')
        if (fileName) {
          const currentName = form.getFieldValue('name')
          if (!currentName || currentName === '本地 SQLite') {
            form.setFieldValue('name', fileName)
          }
        }
      }
    }
  }

  const isConnectionNameDuplicate = (name: string, editingConnectionId?: string): boolean => {
    const normalized = name.trim().toLocaleLowerCase()
    if (!normalized) {
      return false
    }
    return connections.some(
      (connection) =>
        connection.connection_id !== editingConnectionId &&
        connection.name.trim().toLocaleLowerCase() === normalized
    )
  }

  const buildImportConnectionUniqueName = (baseName: string, usedNames: Set<string>): string => {
    const trimmed = baseName.trim() || '未命名连接'
    let nextName = trimmed
    let suffix = 1

    while (usedNames.has(nextName.trim().toLocaleLowerCase())) {
      nextName = `${trimmed}（${suffix}）`
      suffix += 1
    }

    usedNames.add(nextName.trim().toLocaleLowerCase())
    return nextName
  }

  const buildConnectionTransferDefaultFileName = (): string => {
    const current = new Date()
    const pad = (value: number): string => String(value).padStart(2, '0')
    const datePart = `${current.getFullYear()}${pad(current.getMonth() + 1)}${pad(current.getDate())}`
    const timePart = `${pad(current.getHours())}${pad(current.getMinutes())}${pad(current.getSeconds())}`
    return `datadjinn-connections-${datePart}-${timePart}.ddj`
  }

  const normalizeImportConnectionCandidates = useCallback(
    (rawCandidates: ImportConnectionCandidate[]): ImportConnectionCandidate[] => {
      const usedNames = new Set(
        connections.map((connection) => connection.name.trim().toLocaleLowerCase()).filter(Boolean)
      )
      return rawCandidates.map<ImportConnectionCandidate>((candidate) => {
        if (!candidate.payload) {
          return candidate
        }

        const originalName = candidate.payload.name
        const uniqueName = buildImportConnectionUniqueName(originalName, usedNames)
        if (uniqueName === originalName) {
          return candidate
        }

        const renamedMessage = `名称重复，已自动调整为 ${uniqueName}`
        return {
          ...candidate,
          name: uniqueName,
          payload: {
            ...candidate.payload,
            name: uniqueName
          },
          status: 'warning',
          message: candidate.message ? `${candidate.message}；${renamedMessage}` : renamedMessage
        }
      })
    },
    [connections]
  )

  const isConnectionPasswordRetryError = (message: string): boolean => {
    const normalized = message.toLowerCase()
    return (
      normalized.includes('密码错误') ||
      normalized.includes('用户名或密码错误') ||
      normalized.includes('用户名密码错误') ||
      normalized.includes('认证失败') ||
      normalized.includes('authentication failed') ||
      normalized.includes('wrongpass') ||
      normalized.includes('invalid username-password pair')
    )
  }

  const closeConnectionPasswordPrompt = (): void => {
    setConnectionPasswordPromptOpen(false)
    setConnectionPasswordPromptConnectionId('')
    setConnectionPasswordPromptConnectionName('')
    setConnectionPasswordPromptReason('')
    setConnectionPasswordDraft('')
  }

  const openConnectionPasswordPrompt = (connection: ConnectionInfo, reason: string): void => {
    setConnectionPasswordPromptConnectionId(connection.connection_id)
    setConnectionPasswordPromptConnectionName(connection.name)
    setConnectionPasswordPromptReason(reason)
    setConnectionPasswordDraft('')
    setConnectionPasswordPromptOpen(true)
  }

  const resetImportConnectionState = useCallback((): void => {
    setImportConnectionSource('datagrip')
    setImportConnectionRawText('')
    setImportConnectionFilePath('')
    setImportConnectionSecret('')
    setImportConnectionCandidates([])
    setImportConnectionFolderPlan(null)
    setImportConnectionBundle(null)
    setImportConnectionParsing(false)
    setImportingConnections(false)
  }, [])

  const openImportConnectionModal = useCallback((): void => {
    setImportConnectionModalOpen(true)
  }, [])

  const openExportConnectionModal = useCallback((): void => {
    if (connections.length === 0) {
      messageApi.warning('当前没有可导出的连接')
      return
    }

    setExportConnectionModalOpen(true)
    if (!appInfo) {
      void window.api
        .getAppInfo()
        .then(setAppInfo)
        .catch(() => undefined)
    }
  }, [appInfo, connections.length, messageApi])

  const openImportConnectionModalRef = useRef(openImportConnectionModal)
  openImportConnectionModalRef.current = openImportConnectionModal
  const handleConnectionCreateMenuClickRef = useRef<(info: { key: string }) => void>(
    () => undefined
  )

  const closeImportConnectionModal = useCallback((): void => {
    setImportConnectionModalOpen(false)
    resetImportConnectionState()
  }, [resetImportConnectionState])

  const closeExportConnectionModal = useCallback((): void => {
    setExportConnectionModalOpen(false)
    setExportConnectionSecret('')
    setExportConnectionSecretConfirm('')
    setExportingConnections(false)
  }, [])

  const closeImportConnectionResultModal = (): void => {
    setImportConnectionResultOpen(false)
    setImportConnectionResult(null)
  }

  const chooseImportConnectionTransferFile = async (): Promise<void> => {
    const testWindow = window as ConnectionTransferTestWindow
    const importFileSource = importConnectionSource === 'dbeaver' ? 'dbeaver' : 'datadjinn'
    ;(
      testWindow as ConnectionTransferTestWindow & {
        __DATADJINN_TEST_IMPORT_FILE_SOURCE__?: string
      }
    ).__DATADJINN_TEST_IMPORT_FILE_SOURCE__ = importFileSource
    if (
      typeof testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__ === 'string' &&
      testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__.trim()
    ) {
      setImportConnectionFilePath(
        testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__
      )
      return
    }

    const filePath = await window.api.selectConnectionTransferImportFile(importFileSource)
    if (!filePath) {
      return
    }

    setImportConnectionFilePath(filePath)
  }

  const applyImportedConnectionFolderState = useCallback(
    (
      bundle: Pick<
        ImportConnectionFolderPlan,
        | 'folders'
        | 'connection_folder_assignments'
        | 'connection_folder_order'
        | 'root_connection_order'
        | 'root_item_order'
        | 'folder_connection_order'
      >,
      createdByImportKey: Map<string, ConnectionInfo>
    ): void => {
      if (createdByImportKey.size === 0) {
        return
      }

      const normalizeFolderName = (name: string): string =>
        (name.trim() || '未命名分组').toLocaleLowerCase()
      const existingFoldersByName = new Map(
        connectionFolders.map((folder) => [normalizeFolderName(folder.name), folder] as const)
      )
      const folderById = new Map(bundle.folders.map((folder) => [folder.id, folder]))
      const orderedFolderIds = mergeOrderedIds(
        bundle.folders.map((folder) => folder.id),
        bundle.connection_folder_order
      )
      const folderIdMap = new Map<string, string>()
      const nextFolders: ConnectionFolder[] = []
      const appendedFolderIds: string[] = []
      const reusedFolderIds = new Set<string>()

      for (const folderId of orderedFolderIds) {
        const folder = folderById.get(folderId)
        if (!folder) {
          continue
        }

        const normalizedFolderName = normalizeFolderName(folder.name)
        const existingFolder = existingFoldersByName.get(normalizedFolderName)
        if (existingFolder) {
          folderIdMap.set(folderId, existingFolder.id)
          reusedFolderIds.add(folderId)
          continue
        }

        const nextFolderId =
          globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}-${nextFolders.length}`
        const nextFolder: ConnectionFolder = {
          id: nextFolderId,
          name: folder.name.trim() || '未命名分组'
        }
        folderIdMap.set(folderId, nextFolderId)
        nextFolders.push(nextFolder)
        appendedFolderIds.push(nextFolderId)
        existingFoldersByName.set(normalizedFolderName, nextFolder)
      }

      const importedConnectionIds = Array.from(createdByImportKey.values()).map(
        (connection) => connection.connection_id
      )
      const importedConnectionIdSet = new Set(importedConnectionIds)

      if (nextFolders.length > 0) {
        setConnectionFolders((current) => [...current, ...nextFolders])
        setConnectionFolderOrder((current) => [...current, ...appendedFolderIds])
        setExpandedKeys((current) => {
          const next = [...current]
          for (const folder of nextFolders) {
            const key = `folder:${folder.id}`
            if (!next.includes(key)) {
              next.push(key)
            }
          }
          return next
        })
      }

      setConnectionFolderAssignments((current) => {
        let changed = false
        const next = { ...current }
        for (const [importKey, folderId] of Object.entries(bundle.connection_folder_assignments)) {
          const created = createdByImportKey.get(importKey)
          const mappedFolderId = folderIdMap.get(folderId)
          if (!created || !mappedFolderId || next[created.connection_id] === mappedFolderId) {
            continue
          }

          next[created.connection_id] = mappedFolderId
          changed = true
        }
        return changed ? next : current
      })

      const orderedRootConnectionIds = mergeOrderedIds(
        importedConnectionIds.filter((connectionId) => {
          const importKey = Array.from(createdByImportKey.entries()).find(
            ([, created]) => created.connection_id === connectionId
          )?.[0]
          if (!importKey) {
            return false
          }
          return !bundle.connection_folder_assignments[importKey]
        }),
        bundle.root_connection_order
          .map((importKey) => createdByImportKey.get(importKey)?.connection_id)
          .filter((connectionId): connectionId is string => Boolean(connectionId))
      )

      setRootConnectionOrder((current) => [
        ...current.filter((connectionId) => !importedConnectionIdSet.has(connectionId)),
        ...orderedRootConnectionIds
      ])

      const orderedRootItemIds = mergeOrderedIds(
        [
          ...nextFolders.map((folder) => rootFolderOrderId(folder.id)),
          ...orderedRootConnectionIds.map(rootConnectionOrderId)
        ],
        bundle.root_item_order
          .map((itemId) => {
            if (itemId.startsWith('folder:')) {
              const sourceFolderId = itemId.slice('folder:'.length)
              if (reusedFolderIds.has(sourceFolderId)) {
                return undefined
              }
              const nextFolderId = folderIdMap.get(sourceFolderId)
              return nextFolderId ? rootFolderOrderId(nextFolderId) : undefined
            }
            if (itemId.startsWith('connection:')) {
              const created = createdByImportKey.get(itemId.slice('connection:'.length))
              return created ? rootConnectionOrderId(created.connection_id) : undefined
            }
            return undefined
          })
          .filter((itemId): itemId is string => Boolean(itemId))
      )

      const orderedRootItemIdSet = new Set(orderedRootItemIds)
      if (orderedRootItemIds.length > 0) {
        setRootItemOrderCustomized(true)
      }
      setRootItemOrder((current) => [
        ...current.filter((itemId) => !orderedRootItemIdSet.has(itemId)),
        ...orderedRootItemIds
      ])

      setFolderConnectionOrder((current) => {
        const next = { ...current }
        for (const [sourceFolderId, nextFolderId] of folderIdMap.entries()) {
          const assignedConnectionIds = Array.from(createdByImportKey.entries())
            .filter(
              ([importKey]) => bundle.connection_folder_assignments[importKey] === sourceFolderId
            )
            .map(([, created]) => created.connection_id)
          const orderedImportedConnectionIds = mergeOrderedIds(
            assignedConnectionIds,
            (bundle.folder_connection_order[sourceFolderId] ?? [])
              .map((importKey) => createdByImportKey.get(importKey)?.connection_id)
              .filter((connectionId): connectionId is string => Boolean(connectionId))
          )
          next[nextFolderId] = mergeOrderedIds(
            [...(current[nextFolderId] ?? []), ...orderedImportedConnectionIds],
            current[nextFolderId] ?? []
          )
        }
        return next
      })
    },
    [connectionFolders]
  )

  const parseImportConnections = async (): Promise<void> => {
    setImportConnectionParsing(true)
    try {
      let candidates: ImportConnectionCandidate[] = []

      if (importConnectionSource === 'datagrip') {
        const rawText = importConnectionRawText.trim()
        if (!rawText) {
          messageApi.warning('请先粘贴连接配置文本')
          return
        }

        setImportConnectionFolderPlan(null)
        setImportConnectionBundle(null)
        candidates = normalizeImportConnectionCandidates(parseDataGripImportText(rawText))
      } else if (importConnectionSource === 'dbeaver') {
        if (!importConnectionFilePath.trim()) {
          messageApi.warning('请先选择 DBeaver 的 data-sources.json 文件')
          return
        }

        const rawText = await window.api.readTextFile(importConnectionFilePath)
        const parsedImport = parseDBeaverImportText(rawText)
        setImportConnectionFolderPlan(parsedImport.folderPlan)
        setImportConnectionBundle(null)
        candidates = normalizeImportConnectionCandidates(parsedImport.candidates)
      } else {
        if (!importConnectionFilePath.trim()) {
          messageApi.warning('请先选择 DataDjinn 连接文件')
          return
        }
        if (!importConnectionSecret.trim()) {
          messageApi.warning('请输入导入口令')
          return
        }

        const testWindow = window as ConnectionTransferTestWindow
        const rawText =
          typeof testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_CONTENT__ === 'string'
            ? testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_CONTENT__
            : await window.api.readTextFile(importConnectionFilePath)
        const bundle = await decryptConnectionTransferBundle(rawText, importConnectionSecret)
        setImportConnectionFolderPlan(null)
        setImportConnectionBundle(bundle)
        candidates = normalizeImportConnectionCandidates(buildDataDjinnImportCandidates(bundle))
      }

      setImportConnectionCandidates(candidates)
      if (candidates.length === 0) {
        messageApi.warning('未识别到可导入的连接配置')
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : '解析连接配置失败')
    } finally {
      setImportConnectionParsing(false)
    }
  }

  const importParsedConnections = async (): Promise<void> => {
    const readyCandidates = importConnectionCandidates.filter(
      (candidate) => candidate.payload && candidate.status !== 'error'
    )
    if (readyCandidates.length === 0) {
      messageApi.warning('没有可导入的连接')
      return
    }

    setImportingConnections(true)
    const result: ImportConnectionResult = {
      success: [],
      failed: []
    }
    let nextConnections = connections
    const usedNames = new Set(
      nextConnections
        .map((connection) => connection.name.trim().toLocaleLowerCase())
        .filter(Boolean)
    )
    const createdByImportKey = new Map<string, ConnectionInfo>()

    try {
      for (const candidate of readyCandidates) {
        const payload = candidate.payload
        if (!payload) {
          continue
        }

        const importName = buildImportConnectionUniqueName(payload.name, usedNames)
        const normalizedName = importName.trim().toLocaleLowerCase()
        if (!normalizedName) {
          result.failed.push({
            name: candidate.name,
            database_type: candidate.database_type,
            message: '连接名称不能为空'
          })
          continue
        }

        try {
          const finalPayload: ConnectionFormValues =
            importName === payload.name
              ? payload
              : {
                  ...payload,
                  name: importName
                }
          const finalMessage =
            importName === candidate.name
              ? candidate.message
              : [candidate.message, `再次导入时名称已自动调整为 ${importName}`]
                  .filter(Boolean)
                  .join('；')
          const created = await requestJson<ConnectionInfo>('/connections', {
            method: 'POST',
            body: JSON.stringify(cleanFormValues(finalPayload))
          })
          nextConnections = [...nextConnections, created]
          createdByImportKey.set(candidate.key, created)
          result.success.push({
            name: created.name,
            database_type: created.database_type,
            message: finalMessage
          })
        } catch (error) {
          result.failed.push({
            name: importName,
            database_type: candidate.database_type,
            message: error instanceof Error ? error.message : '导入失败'
          })
        }
      }

      setConnections(nextConnections)
      if (importConnectionSource === 'datadjinn' && importConnectionBundle) {
        applyImportedConnectionFolderState(importConnectionBundle, createdByImportKey)
      } else if (importConnectionSource === 'dbeaver' && importConnectionFolderPlan) {
        applyImportedConnectionFolderState(importConnectionFolderPlan, createdByImportKey)
      }
      refreshTree(nextConnections)
      if (result.success.length > 0) {
        const lastImported = nextConnections[nextConnections.length - 1]
        if (lastImported) {
          setSelectedConnectionId(lastImported.connection_id)
          selectConnectionNodes([lastImported.connection_id], lastImported.connection_id)
        }
      }
      setImportConnectionResult(result)
      setImportConnectionModalOpen(false)
      setImportConnectionResultOpen(true)
      if (result.success.length > 0) {
        messageApi.success(`已导入 ${result.success.length} 个连接`)
      }
    } finally {
      setImportingConnections(false)
    }
  }

  const exportAllConnections = async (): Promise<void> => {
    const normalizedSecret = exportConnectionSecret.trim()
    if (!normalizedSecret) {
      messageApi.warning('请输入导出口令')
      return
    }
    if (normalizedSecret !== exportConnectionSecretConfirm.trim()) {
      messageApi.warning('两次输入的导出口令不一致')
      return
    }
    if (connections.length === 0) {
      messageApi.warning('当前没有可导出的连接')
      return
    }

    setExportingConnections(true)
    try {
      const detailedConnections = await Promise.all(
        connections.map(async (connection) => ({
          export_id: connection.connection_id,
          payload: cleanFormValues(
            await requestJson<ConnectionFormValues>(`/connections/${connection.connection_id}`)
          )
        }))
      )
      const connectionIdSet = new Set(detailedConnections.map((connection) => connection.export_id))
      const folderIdSet = new Set(connectionFolders.map((folder) => folder.id))
      const bundle: DataDjinnConnectionTransferBundle = {
        version: 1,
        exported_at: new Date().toISOString(),
        source_app_name: appInfo?.name ?? 'DataDjinn',
        source_app_version: appInfo?.version ?? updateSettings?.currentVersion,
        connections: detailedConnections,
        folders: connectionFolders.map((folder) => ({ id: folder.id, name: folder.name })),
        connection_folder_assignments: Object.fromEntries(
          Object.entries(connectionFolderAssignments).filter(
            ([connectionId, folderId]) =>
              connectionIdSet.has(connectionId) && folderIdSet.has(folderId)
          )
        ),
        connection_folder_order: connectionFolderOrder.filter((folderId) =>
          folderIdSet.has(folderId)
        ),
        root_connection_order: rootConnectionOrder.filter((connectionId) =>
          connectionIdSet.has(connectionId)
        ),
        root_item_order: rootItemOrder.filter((itemId) => {
          if (itemId.startsWith('folder:')) {
            return folderIdSet.has(itemId.slice('folder:'.length))
          }
          if (itemId.startsWith('connection:')) {
            return connectionIdSet.has(itemId.slice('connection:'.length))
          }
          return false
        }),
        folder_connection_order: Object.fromEntries(
          Object.entries(folderConnectionOrder)
            .filter(([folderId]) => folderIdSet.has(folderId))
            .map(([folderId, ids]) => [
              folderId,
              ids.filter((connectionId) => connectionIdSet.has(connectionId))
            ])
        )
      }

      const encryptedContent = await encryptConnectionTransferBundle(bundle, normalizedSecret)
      const testWindow = window as ConnectionTransferTestWindow
      const overrideExportPath =
        typeof testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_PATH__ === 'string'
          ? testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_PATH__.trim()
          : ''
      const filePath =
        overrideExportPath ||
        (await window.api.selectConnectionTransferExportPath(
          buildConnectionTransferDefaultFileName()
        ))
      if (!filePath) {
        return
      }

      if (typeof testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_HANDLER__ === 'function') {
        await Promise.resolve(
          testWindow.__DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_HANDLER__({
            filePath,
            content: encryptedContent
          })
        )
      } else {
        await window.api.writeTextFile(filePath, encryptedContent)
      }
      messageApi.success(`连接已导出到 ${filePath}`)
      setExportConnectionModalOpen(false)
    } catch (error) {
      showError(error instanceof Error ? error.message : '导出连接失败')
    } finally {
      setExportingConnections(false)
    }
  }

  const driverTypeOptionsForDatabase = (
    databaseType: DriverDatabaseType
  ): { label: string; value: DriverType }[] =>
    DRIVER_DATABASE_META[databaseType].supportedDriverTypes.map((type) => ({
      value: type,
      label:
        type === 'python'
          ? 'dmPython pyd 驱动'
          : type === 'whl'
            ? 'dmPython whl 驱动'
            : 'JDBC jar 驱动'
    }))

  const resetDriverForm = (databaseType: DriverDatabaseType): void => {
    const defaultDriverType = DRIVER_DATABASE_META[databaseType].supportedDriverTypes[0] ?? 'jdbc'
    driverForm.setFieldsValue({
      database_type: databaseType,
      driver_type: defaultDriverType,
      name: '',
      path: undefined,
      enabled: true
    })
  }

  const selectDriverDatabaseType = (databaseType: DriverDatabaseType): void => {
    setSelectedDriverDatabaseType(databaseType)
    resetDriverForm(databaseType)
  }

  const openSettings = (section: SettingsSection = 'app'): void => {
    setSettingsSection(section)
    settingsModalRef.current?.open()
    window.setTimeout(() => {
      void window.api
        .getAppInfo()
        .then(setAppInfo)
        .catch(() => undefined)

      if (section === 'sql') {
        void refreshQuerySettings().catch(() => undefined)
      }

      if (section === 'mcp') {
        void refreshMcpSettings().catch(() => undefined)
        void refreshOptionalModules().catch(() => undefined)
        void refreshMcpLaunchConfig().catch(() => undefined)
      }

      if (section === 'sync') {
        void refreshGitHubAuthStatus().catch(() => undefined)
        void refreshGitSyncLocalState().catch(() => undefined)
      }

      if (section === 'extensions') {
        void refreshOptionalModules().catch(() => undefined)
      }

      if (section === 'drivers') {
        resetDriverForm(selectedDriverDatabaseType)
        void loadDrivers()
        void loadJavaRuntimes()
      }
    }, 0)
  }

  const openDriverManager = (): void => {
    openSettings('drivers')
  }

  const openQueryHistoryModal = (): void => {
    queryHistoryModalRef.current?.open()
  }

  const openUpdateModal = (): void => {
    updateModalRef.current?.open()
  }

  const switchSettingsSection = (section: SettingsSection): void => {
    setSettingsSection(section)
    if (section === 'drivers') {
      resetDriverForm(selectedDriverDatabaseType)
      void loadDrivers()
      void loadJavaRuntimes()
    }
    if (section === 'sql') {
      void refreshQuerySettings().catch(() => undefined)
    }
    if (section === 'mcp') {
      void refreshMcpSettings().catch(() => undefined)
      void refreshOptionalModules().catch(() => undefined)
      void refreshMcpLaunchConfig().catch(() => undefined)
    }
    if (section === 'sync') {
      void refreshGitHubAuthStatus().catch(() => undefined)
      void refreshGitSyncLocalState().catch(() => undefined)
    }
    if (section === 'extensions') {
      void refreshOptionalModules().catch(() => undefined)
    }
  }

  const addDriver = async (): Promise<void> => {
    setDriverSaving(true)
    try {
      const values = await driverForm.validateFields()
      const body = {
        database_type: values.database_type,
        driver_type: values.driver_type,
        name: values.name,
        path: values.path,
        enabled: values.enabled
      }
      await requestJson('/drivers', { method: 'POST', body: JSON.stringify(body) })
      resetDriverForm(values.database_type)
      await loadDrivers()
      messageApi.success('驱动已添加')
    } catch (err) {
      showError(err instanceof Error ? err.message : '添加驱动失败')
    } finally {
      setDriverSaving(false)
    }
  }

  const testDriver = async (driver: DriverInfo): Promise<void> => {
    const result = await requestJson<ConnectionTestResponse>('/drivers/test', {
      method: 'POST',
      body: JSON.stringify({ id: driver.id })
    })
    if (result.success) {
      messageApi.success(result.message)
    } else {
      showError(result.message)
    }
  }

  const deleteDriver = async (driver: DriverInfo): Promise<void> => {
    await requestJson(`/drivers/${driver.id}`, { method: 'DELETE' })
    await loadDrivers()
    messageApi.success('驱动已删除')
  }

  const driverTypeLabel = (driverType: DriverInfo['driver_type']): string => {
    if (driverType === 'python') {
      return 'dmPython pyd'
    }
    if (driverType === 'whl') {
      return 'dmPython whl'
    }
    return 'JDBC jar'
  }

  const driverPathLabel = (
    databaseType: DriverDatabaseType,
    driverTypeValue: DriverType
  ): string => {
    if (driverTypeValue === 'python') {
      return 'dmPython pyd 文件'
    }
    if (driverTypeValue === 'whl') {
      return 'dmPython whl 文件'
    }
    return `${DRIVER_DATABASE_META[databaseType].shortLabel} JDBC jar 文件`
  }

  const driverPathPlaceholder = (
    databaseType: DriverDatabaseType,
    driverTypeValue: DriverType
  ): string => {
    if (driverTypeValue === 'python') {
      return '请选择 dmPython.pyd'
    }
    if (driverTypeValue === 'whl') {
      return '请选择 dmPython whl 文件'
    }
    return databaseType === 'gaussdb' ? '请选择高斯 JDBC jar' : '请选择 DmJdbcDriver.jar'
  }

  const manualDriverOptionDrivers =
    selectedManualDriver && !selectedManualDriver.enabled
      ? [selectedManualDriver, ...currentEnabledDrivers]
      : currentEnabledDrivers
  const manualDriverOptions = manualDriverOptionDrivers.map((driver) => ({
    label: `${driverTypeLabel(driver.driver_type)} - ${driver.name}${driver.enabled ? '' : '（已禁用）'}`,
    value: driver.id,
    disabled: !driver.enabled
  }))

  const testConnection = async (): Promise<void> => {
    const testRunId = connectionTestRunRef.current + 1
    connectionTestRunRef.current = testRunId
    setTestingConnection(true)

    try {
      const values = await form.validateFields([
        'name',
        'database_type',
        'sqlite_path',
        'host',
        'port',
        'username',
        'password',
        'database',
        'driver_id',
        'dm_driver_id',
        'ssh_enabled',
        'ssh_host',
        'ssh_port',
        'ssh_username',
        'ssh_auth_type',
        'ssh_password',
        'ssh_private_key_path',
        'ssh_passphrase'
      ])
      const result = await requestJson<ConnectionTestResponse>('/connections/test', {
        method: 'POST',
        body: JSON.stringify(cleanFormValues(values)),
        timeoutMs: DATABASE_CONNECTION_REQUEST_TIMEOUT_MS
      })

      if (connectionTestRunRef.current !== testRunId) {
        return
      }

      if (result.success) {
        messageApi.success(result.message || '数据库连接测试成功')
      } else {
        showError(result.message || '数据库连接测试失败')
      }
    } catch (err) {
      if (connectionTestRunRef.current === testRunId) {
        showError(err instanceof Error ? err.message : '测试连接失败')
      }
    } finally {
      if (connectionTestRunRef.current === testRunId) {
        setTestingConnection(false)
      }
    }
  }

  const testSshConnection = async (): Promise<void> => {
    const testRunId = connectionTestRunRef.current + 1
    connectionTestRunRef.current = testRunId
    setTestingSshConnection(true)

    try {
      const values = await form.validateFields([
        'name',
        'database_type',
        'host',
        'port',
        'ssh_enabled',
        'ssh_host',
        'ssh_port',
        'ssh_username',
        'ssh_auth_type',
        'ssh_password',
        'ssh_private_key_path',
        'ssh_passphrase'
      ])
      const sshPayload: ConnectionFormValues = {
        name: String(values.name ?? 'SSH 测试').trim() || 'SSH 测试',
        database_type: values.database_type,
        host: values.host,
        port: values.port,
        ...buildConnectionSshPayload({
          ...values,
          ssh_enabled: true
        })
      }
      const result = await requestJson<ConnectionTestResponse>('/connections/test-ssh', {
        method: 'POST',
        body: JSON.stringify(sshPayload),
        timeoutMs: SSH_TEST_REQUEST_TIMEOUT_MS
      })

      if (connectionTestRunRef.current !== testRunId) {
        return
      }

      if (result.success) {
        messageApi.success(result.message || 'SSH 隧道连接测试成功')
      } else {
        showError(result.message || 'SSH 隧道连接测试失败')
      }
    } catch (err) {
      if (connectionTestRunRef.current === testRunId) {
        showError(err instanceof Error ? err.message : '测试 SSH 失败')
      }
    } finally {
      if (connectionTestRunRef.current === testRunId) {
        setTestingSshConnection(false)
      }
    }
  }

  const saveConnection = async (): Promise<void> => {
    const values = await form.validateFields()
    const nextName = String(values.name ?? '').trim()
    if (isConnectionNameDuplicate(nextName, editingConnectionInfoId)) {
      form.setFields([{ name: 'name', errors: ['名称已存在'] }])
      return
    }
    const payload = cleanFormValues(values)
    setConnectionLoading(true)

    try {
      if (connectionMode === 'edit' && editingConnectionInfoId) {
        const restoreTreeScrollPosition = captureResourceTreeScrollPosition()
        const connection = await requestJson<ConnectionInfo>(
          `/connections/${editingConnectionInfoId}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload)
          }
        )
        const nextConnections = connections.map((item) =>
          item.connection_id === connection.connection_id ? connection : item
        )
        setConnections(nextConnections)
        setTreeData((current) => replaceConnectionNode(current, connection, buildConnectionNode))
        restoreTreeScrollPosition()
        closeConnectionModal()
        return
      }

      const connection = await requestJson<ConnectionInfo>('/connections', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      const nextConnections = [...connections, connection]
      setConnections(nextConnections)
      if (
        connectionModalFolderId &&
        connectionFolders.some((folder) => folder.id === connectionModalFolderId)
      ) {
        const targetFolderId = connectionModalFolderId
        const connectionId = connection.connection_id
        // Commit the new connection's folder placement together so the subsequent
        // tree rebuild cannot observe an intermediate root-level assignment.
        setConnectionFolderAssignments((current) => ({
          ...current,
          [connectionId]: targetFolderId
        }))
        setRootConnectionOrder((current) => current.filter((id) => id !== connectionId))
        setRootItemOrder((current) =>
          current.filter((id) => id !== rootConnectionOrderId(connectionId))
        )
        setFolderConnectionOrder((current) => ({
          ...current,
          [targetFolderId]: [
            ...(current[targetFolderId] ?? []).filter((id) => id !== connectionId),
            connectionId
          ]
        }))
        setExpandedKeys((current) =>
          current.includes(`folder:${targetFolderId}`)
            ? current
            : [...current, `folder:${targetFolderId}`]
        )
      }
      setSelectedConnectionId(connection.connection_id)
      selectConnectionNodes([connection.connection_id], connection.connection_id)
      refreshTree(nextConnections)
      closeConnectionModal()
    } catch (err) {
      showError(
        err instanceof Error
          ? err.message
          : connectionMode === 'edit'
            ? '更新连接失败'
            : '保存连接失败'
      )
    } finally {
      setConnectionLoading(false)
    }
  }

  const saveConnectionPassword = async (
    connectionId: string,
    password: string
  ): Promise<ConnectionInfo> => {
    const request = await requestJson<ConnectionFormValues>(`/connections/${connectionId}`)
    const updated = await requestJson<ConnectionInfo>(`/connections/${connectionId}`, {
      method: 'PUT',
      body: JSON.stringify(
        cleanFormValues({
          ...request,
          password
        })
      )
    })
    setConnections((current) =>
      current.map((item) => (item.connection_id === connectionId ? updated : item))
    )
    setTreeData((current) => replaceConnectionNode(current, updated, buildConnectionNode))
    return updated
  }

  const openConnectionById = async (
    connectionId: string,
    savedConnection?: ConnectionInfo
  ): Promise<ConnectionInfo | undefined> => {
    const openAttemptId = crypto.randomUUID()
    connectionOpenAttemptRefs.current[connectionId] = openAttemptId
    const isCurrentOpenAttempt = (): boolean =>
      connectionOpenAttemptRefs.current[connectionId] === openAttemptId
    setConnectionTreeLoadingText(connectionId, '正在打开连接...')
    try {
      const currentConnection = savedConnection ?? getConnection(connectionId)
      if (
        currentConnection &&
        !currentConnection.has_password &&
        currentConnection.database_type !== 'sqlite' &&
        currentConnection.database_type !== 'redis'
      ) {
        openConnectionPasswordPrompt(currentConnection, '当前连接未保存密码，请输入密码后重试')
        return undefined
      }

      const connection = await requestJson<ConnectionInfo>(
        `/connections/${connectionId}/open?open_attempt_id=${encodeURIComponent(openAttemptId)}`,
        { method: 'POST', timeoutMs: DATABASE_CONNECTION_REQUEST_TIMEOUT_MS }
      )
      if (!isCurrentOpenAttempt()) {
        return undefined
      }

      setConnections((current) =>
        current.map((c) => (c.connection_id === connectionId ? connection : c))
      )
      setTreeData((current) => {
        const next = replaceConnectionNode(
          current,
          connection,
          buildConnectionNode,
          connection.database_type !== 'sqlite'
        )
        treeDataRef.current = next
        return next
      })

      const connKey = `connection:${connectionId}`
      setExpandedKeys((current) => {
        const next = current.includes(connKey) ? current : [...current, connKey]
        expandedKeysRef.current = next
        return next
      })

      if (connection.database_type === 'sqlite') {
        await ensureDatabasesLoaded(connectionId, connection)
        if (!isCurrentOpenAttempt()) {
          return undefined
        }
        await waitForUiCommit()
      } else {
        setConnectionTreeLoadingText(connectionId, '正在加载库表...')
        await preloadConnectionTree(connection)
        if (!isCurrentOpenAttempt()) {
          return undefined
        }
      }
      return connection
    } catch (err) {
      if (!isCurrentOpenAttempt()) {
        return undefined
      }
      const errorMessage = err instanceof Error ? err.message : '打开连接失败'
      if (errorMessage.startsWith('请求超时')) {
        void closeConnectionById(connectionId)
      }
      const currentConnection = getConnection(connectionId)
      if (
        currentConnection &&
        currentConnection.database_type !== 'sqlite' &&
        currentConnection.database_type !== 'redis' &&
        isConnectionPasswordRetryError(errorMessage)
      ) {
        openConnectionPasswordPrompt(currentConnection, errorMessage)
        return undefined
      }
      showError(errorMessage)
      return undefined
    } finally {
      if (isCurrentOpenAttempt()) {
        connectionOpenAttemptRefs.current[connectionId] = undefined
        setConnectionTreeLoadingText(connectionId)
      }
    }
  }

  const submitConnectionPasswordPrompt = async (): Promise<void> => {
    const connectionId = connectionPasswordPromptConnectionId
    const password = connectionPasswordDraft
    if (!connectionId) {
      return
    }
    if (!password.trim()) {
      messageApi.warning('请输入密码')
      return
    }

    closeConnectionPasswordPrompt()
    setConnectionTreeLoadingText(connectionId, '正在保存密码...')
    try {
      const connection = await saveConnectionPassword(connectionId, password)
      await openConnectionById(connectionId, connection)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '密码验证失败'
      showError(errorMessage)
    } finally {
      setConnectionTreeLoadingText(connectionId)
    }
  }

  const closeConnectionById = async (connectionId: string): Promise<void> => {
    const openAttemptId = connectionOpenAttemptRefs.current[connectionId]
    connectionOpenAttemptRefs.current[connectionId] = undefined
    setConnectionTreeLoadingText(connectionId)
    try {
      const query = openAttemptId ? `?open_attempt_id=${encodeURIComponent(openAttemptId)}` : ''
      const connection = await requestJson<ConnectionInfo>(
        `/connections/${connectionId}/close${query}`,
        {
          method: 'POST'
        }
      )
      setConnections((current) =>
        current.map((c) => (c.connection_id === connectionId ? connection : c))
      )
      setSelectedConnectionIds((current) => current.filter((id) => id !== connectionId))
      setSelectedTreeKeys((current) =>
        current.filter((key) => {
          const value = String(key)
          return value !== `connection:${connectionId}` && !value.includes(`:${connectionId}:`)
        })
      )
      setFocusedTreeNode((current) =>
        current?.connectionId === connectionId ? undefined : current
      )
      setTreeContextMenu((current) =>
        current?.node.connectionId === connectionId ? null : current
      )
      setExpandedKeys((keys) => {
        const next = keys.filter(
          (k) =>
            !String(k).startsWith(`connection:${connectionId}`) &&
            !String(k).includes(`:${connectionId}:`)
        )
        expandedKeysRef.current = next
        return next
      })
      setTreeData((current) => replaceConnectionNode(current, connection, buildConnectionNode))
    } catch (err) {
      showError(err instanceof Error ? err.message : '关闭连接失败')
    }
  }

  const deleteConnection = async (connectionId: string): Promise<void> => {
    const connection = connections.find((item) => item.connection_id === connectionId)
    Modal.confirm({
      className: 'connection-delete-confirm-modal',
      title: `确认删除连接：${connection?.name ?? '未命名连接'}？`,
      content: '删除后将移除该连接配置，操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      maskClosable: false,
      onOk: async () => {
        await requestJson<{ success: boolean }>(`/connections/${connectionId}`, {
          method: 'DELETE'
        })
        const nextConnections = connections.filter((item) => item.connection_id !== connectionId)
        setConnections(nextConnections)
        setSelectedConnectionId((current) =>
          current === connectionId ? nextConnections[0]?.connection_id : current
        )
        setSelectedConnectionIds((current) => current.filter((id) => id !== connectionId))
        setSelectedTreeKeys((current) =>
          current.filter((key) => key !== `connection:${connectionId}`)
        )
        setWorkspaceTabs((current) => current.filter((tab) => tab.connectionId !== connectionId))
        refreshTree(nextConnections)
      }
    })
  }

  const openRoutineExecution = async (
    connectionId: string,
    name: string,
    databaseName?: string,
    pgDatabaseName?: string
  ): Promise<void> => {
    setRoutineExecuteLoading(true)
    setRoutineTarget({ connectionId, name, databaseName, pgDatabaseName })
    try {
      const params = new URLSearchParams()
      if (databaseName) params.set('database', databaseName)
      if (pgDatabaseName) params.set('pg_database', pgDatabaseName)
      const query = params.size > 0 ? `?${params.toString()}` : ''
      const response = await requestJson<RoutineParametersResponse>(
        `/connections/${connectionId}/objects/${encodeURIComponent(name)}/routine-parameters${query}`
      )
      setRoutineParameters(response.parameters)
      setRoutineArguments(
        Object.fromEntries(
          response.parameters.map((parameter) => [
            parameter.name,
            {
              value: '',
              isNull: !parameter.has_default && parameter.mode !== 'OUT',
              useDefault: parameter.has_default
            }
          ])
        )
      )
      setRoutineExecuteModalOpen(true)
    } catch (error) {
      setRoutineTarget(undefined)
      showError(error instanceof Error ? error.message : '读取存储过程参数失败')
    } finally {
      setRoutineExecuteLoading(false)
    }
  }

  const executeRoutine = async (): Promise<void> => {
    if (!routineTarget) return
    setRoutineExecuteLoading(true)
    try {
      const result = await requestJson<QueryResponse>(
        `/connections/${routineTarget.connectionId}/objects/${encodeURIComponent(routineTarget.name)}/execute`,
        {
          method: 'POST',
          body: JSON.stringify({
            database: routineTarget.databaseName,
            pg_database: routineTarget.pgDatabaseName,
            arguments: routineParameters.map((parameter) => {
              const draft = routineArguments[parameter.name]
              return {
                name: parameter.name,
                value: draft?.value ?? '',
                is_null: draft?.isNull ?? parameter.mode === 'OUT',
                use_default: draft?.useDefault ?? false
              }
            })
          })
        }
      )
      const isCommandResult =
        result.columns.includes('message') &&
        result.columns.includes('affected_rows') &&
        result.rows.length === 1
      const commandRow = isCommandResult ? result.rows[0] : undefined
      const tabKey = `routine:${routineTarget.connectionId}:${routineTarget.name}:${Date.now()}`
      const resultTab: WorkspaceTab = {
        key: tabKey,
        title: `执行 ${routineTarget.name}`,
        kind: 'query',
        connectionId: routineTarget.connectionId,
        databaseName: routineTarget.databaseName,
        pgDatabaseName: routineTarget.pgDatabaseName,
        sql: '',
        executedSql: `CALL ${routineTarget.name}`,
        loading: false,
        result,
        resultVisible: true,
        resultCollapsed: false,
        resultKind: isCommandResult ? 'command' : 'query',
        commandMessage:
          isCommandResult && typeof commandRow?.message === 'string'
            ? commandRow.message
            : undefined,
        commandAffectedRows:
          isCommandResult && typeof commandRow?.affected_rows === 'number'
            ? commandRow.affected_rows
            : null,
        page: 1,
        limit: QUERY_DEFAULT_LIMIT
      }
      setWorkspaceTabsAndActiveTabKey((tabs) => [...tabs, resultTab], tabKey)
      setRoutineExecuteModalOpen(false)
      messageApi.success('存储过程执行完成')
    } catch (error) {
      showError(error instanceof Error ? error.message : '执行存储过程失败')
    } finally {
      setRoutineExecuteLoading(false)
    }
  }

  const showObjectDdl = async (
    connectionId: string,
    name: string,
    type: DbObjectType,
    databaseName?: string,
    pgDatabaseName?: string
  ): Promise<void> => {
    const connection = getConnection(connectionId)
    ddlPreviewModalRef.current?.open({
      title: `${name} DDL`,
      dialect: (connection?.database_type ?? 'sqlite') as SqlDialect,
      load: async () => {
        const params = new URLSearchParams({ type })
        if (databaseName) {
          params.set('database', databaseName)
        }
        if (pgDatabaseName) {
          params.set('pg_database', pgDatabaseName)
        }
        const result = await requestJson<ObjectDdlResponse>(
          `/connections/${connectionId}/objects/${encodeURIComponent(name)}/ddl?${params.toString()}`
        )
        return result.ddl
      }
    })
  }

  const deleteDatabase = (connectionId: string, databaseName: string): void => {
    Modal.confirm({
      title: `确认删除数据库：${databaseName}？`,
      content: '删除数据库会永久删除其中所有对象和数据，操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      maskClosable: false,
      onOk: async () => {
        try {
          await requestJson(
            `/connections/${connectionId}/databases/${encodeURIComponent(databaseName)}`,
            { method: 'DELETE' }
          )
          setSelectedDatabases((current) => {
            const nextList = (current[connectionId] ?? []).filter((name) => name !== databaseName)
            return { ...current, [connectionId]: nextList }
          })
          setWorkspaceTabs((current) =>
            current.filter(
              (tab) => tab.connectionId !== connectionId || tab.databaseName !== databaseName
            )
          )
          refreshConnectionNode(connectionId)
          messageApi.success('数据库删除成功')
        } catch (err) {
          showError(err instanceof Error ? err.message : '删除数据库失败')
        }
      }
    })
  }

  const deleteDbObject = (
    connectionId: string,
    objectName: string,
    objectType: DbObjectType,
    databaseName?: string,
    pgDatabaseName?: string
  ): void => {
    Modal.confirm({
      title: `确认删除${objectType === 'view' ? '视图' : '表'}：${objectName}？`,
      content: '删除后数据无法恢复，操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      maskClosable: false,
      onOk: async () => {
        const params = new URLSearchParams({ type: objectType })
        if (databaseName) {
          params.set('database', databaseName)
        }
        if (pgDatabaseName) {
          params.set('pg_database', pgDatabaseName)
        }

        try {
          await requestJson(
            `/connections/${connectionId}/objects/${encodeURIComponent(objectName)}?${params.toString()}`,
            { method: 'DELETE' }
          )
          setWorkspaceTabs((current) =>
            current.filter(
              (tab) =>
                tab.connectionId !== connectionId ||
                tab.tableName !== objectName ||
                tab.databaseName !== databaseName ||
                tab.pgDatabaseName !== pgDatabaseName
            )
          )
          if (pgDatabaseName) {
            refreshDatabaseNode(connectionId, pgDatabaseName)
          } else if (databaseName) {
            refreshDatabaseNode(connectionId, databaseName)
          } else {
            refreshConnectionNode(connectionId)
          }
          messageApi.success('对象删除成功')
        } catch (err) {
          showError(err instanceof Error ? err.message : '删除对象失败')
        }
      }
    })
  }

  const createDatabase = async (): Promise<void> => {
    if (!ensureConnectionOpen(creatingDatabaseConnectionId)) {
      return
    }

    if (!databaseCreateName.trim()) {
      return
    }

    setDatabaseCreateLoading(true)
    const isSchema = !!creatingSchemaDatabaseName
    const creatingConnection = getConnection(creatingDatabaseConnectionId)
    const isOracleUser = creatingConnection?.database_type === 'oracle' && !isSchema
    let createdName = databaseCreateName.trim()

    try {
      if (isSchema) {
        const schemaUrl = `/connections/${creatingDatabaseConnectionId}/schemas?database=${encodeURIComponent(creatingSchemaDatabaseName)}`
        await requestJson(schemaUrl, {
          method: 'POST',
          body: JSON.stringify({ name: databaseCreateName.trim() })
        })
      } else {
        const created = await requestJson<{ name: string }>(
          `/connections/${creatingDatabaseConnectionId}/databases`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: createdName,
              password: isOracleUser ? databaseCreatePassword : undefined
            })
          }
        )
        createdName = created.name
      }
      setDatabaseCreateModalOpen(false)
      setCreatingSchemaDatabaseName('')
      setDatabaseCreatePassword('')

      if (isSchema) {
        const selKey = `${creatingDatabaseConnectionId}:${creatingSchemaDatabaseName}`
        const dbKey = `database:${creatingDatabaseConnectionId}:${creatingSchemaDatabaseName}`

        try {
          const schemaData = await requestJson<{ databases: DatabaseInfo[] }>(
            `/connections/${creatingDatabaseConnectionId}/schemas?database=${encodeURIComponent(creatingSchemaDatabaseName)}`
          )
          const schemaNames = schemaData.databases.map((s) => s.name)
          setAllSchemas((current) => ({ ...current, [selKey]: schemaNames }))
          setSelectedSchemas((current) => {
            const existing = current[selKey] ?? []
            const merged = existing.includes(databaseCreateName)
              ? existing
              : [...existing, databaseCreateName]
            return { ...current, [selKey]: merged }
          })
          setExpandedKeys((current) => (current.includes(dbKey) ? current : [...current, dbKey]))

          const schemaChildren: DatabaseTreeNode[] = schemaNames.map((name) => ({
            key: `pg-schema:${creatingDatabaseConnectionId}:${creatingSchemaDatabaseName}:${name}`,
            title: name,
            icon: treeIconBadge(<ApartmentOutlined />, 'schema'),
            kind: 'pg-schema' as const,
            connectionId: creatingDatabaseConnectionId,
            databaseName: name,
            pgDatabaseName: creatingSchemaDatabaseName,
            childrenLoaded: false,
            isLeaf: false
          }))
          setTreeData((current) => updateTreeNode(current, dbKey, schemaChildren))
        } catch {
          refreshDatabaseNode(creatingDatabaseConnectionId, creatingSchemaDatabaseName)
        }
      } else {
        const dbName = createdName
        const connId = creatingDatabaseConnectionId
        setSelectedDatabases((current) => {
          const list = current[connId] ?? []
          if (!list.includes(dbName)) {
            const nextList = [...list, dbName]
            const next = { ...current, [connId]: nextList }
            selectedDatabasesRef.current = next
            setTimeout(() => refreshConnectionNode(connId, nextList), 0)
            return next
          }
          return current
        })
        refreshConnectionNode(connId)
      }
    } catch (err) {
      showError(
        err instanceof Error
          ? err.message
          : isSchema
            ? '创建 Schema 失败'
            : isOracleUser
              ? '创建用户失败'
              : '创建数据库失败'
      )
    } finally {
      setDatabaseCreateLoading(false)
    }
  }

  const addNewColumn = (): void => {
    const key = `col-${Date.now()}`
    setNewTableColumns((current) => [
      ...current,
      {
        key,
        name: '',
        type: 'VARCHAR(100)',
        nullable: true,
        primaryKey: false,
        comment: '',
        unique: false,
        autoIncrement: false,
        autoIncrementStep: undefined,
        minimum: '',
        maximum: ''
      }
    ])
  }

  const removeNewColumn = (key: string): void => {
    setNewTableColumns((current) => current.filter((col) => col.key !== key))
  }

  const updateNewColumn = (key: string, patch: Partial<ColumnDef>): void => {
    setNewTableColumns((current) =>
      current.map((col) => (col.key === key ? { ...col, ...patch } : col))
    )
  }

  const updateEditingColumn = (key: string, patch: Partial<ColumnDef>): void => {
    setEditingColumns((current) =>
      current.map((col) => (col.key === key ? { ...col, ...patch } : col))
    )
  }

  const renderTableDesigner = (
    mode: TableDesignerMode,
    connectionId: string | undefined,
    databaseName: string | undefined,
    pgDatabaseName: string | undefined,
    tableName: string,
    setTableName: ((value: string) => void) | undefined,
    tableComment: string,
    setTableComment: ((value: string) => void) | undefined,
    columns: ColumnDef[],
    loading: boolean
  ): React.ReactNode => {
    const connection = connectionId ? getConnection(connectionId) : undefined
    return (
      <Suspense fallback={<div className="deferred-modal-loading">正在加载表设计器...</div>}>
        <TableDesignerPanel
          mode={mode}
          connection={connection}
          databaseName={databaseName}
          pgDatabaseName={pgDatabaseName}
          tableName={tableName}
          setTableName={setTableName}
          tableComment={tableComment}
          setTableComment={setTableComment}
          columns={columns}
          loading={loading}
          isSchemaScopedType={isSchemaScopedType}
          onUpdateColumn={(key, patch) => {
            const updateColumn = mode === 'create' ? updateNewColumn : updateEditingColumn
            updateColumn(key, patch)
          }}
          onAddColumn={addNewColumn}
          onRemoveColumn={removeNewColumn}
        />
      </Suspense>
    )
  }
  const createTable = async (): Promise<void> => {
    if (!ensureConnectionOpen(createTableConnectionId)) {
      return
    }

    if (!newTableName.trim()) {
      return
    }

    const validColumns = newTableColumns.filter((column) => column.name.trim())
    if (validColumns.length === 0) {
      return
    }

    setCreateTableLoading(true)
    const conn = getConnection(createTableConnectionId)
    const isPg = isSchemaScopedType(conn?.database_type)

    try {
      await requestJson<{ name: string; message: string }>(
        `/connections/${createTableConnectionId}/tables`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: newTableName.trim(),
            database: createTableDatabaseName || undefined,
            pg_database: createTablePgDatabaseName || undefined,
            table_comment: newTableComment.trim() || null,
            columns: validColumns.map((column) => ({
              name: column.name.trim(),
              type: column.type.trim(),
              nullable: column.nullable,
              primary_key: column.primaryKey,
              comment: column.comment.trim() || null,
              unique: column.unique,
              auto_increment: column.autoIncrement,
              auto_increment_step: column.autoIncrementStep ?? null,
              minimum: column.minimum.trim() || null,
              maximum: column.maximum.trim() || null
            }))
          })
        }
      )

      setCreateTableModalOpen(false)

      if (isPg && createTablePgDatabaseName) {
        void reloadNodeChildren({
          key: `pg-schema:${createTableConnectionId}:${createTablePgDatabaseName}:${createTableDatabaseName}`,
          kind: 'pg-schema',
          connectionId: createTableConnectionId,
          databaseName: createTableDatabaseName,
          pgDatabaseName: createTablePgDatabaseName,
          isLeaf: false
        })
      } else {
        void reloadNodeChildren({
          key: `database:${createTableConnectionId}:${createTableDatabaseName}`,
          kind: 'database',
          connectionId: createTableConnectionId,
          databaseName: createTableDatabaseName,
          isLeaf: false
        })
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '创建表失败')
    } finally {
      setCreateTableLoading(false)
    }
  }
  const openSqlFileDialog = async (
    connectionId: string,
    databaseName?: string,
    pgDatabaseName?: string
  ): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const result = await window.api.selectSqlFile()

    if (!result) {
      return
    }

    if (result.content.length > 5 * 1024 * 1024) {
      showError('SQL 文件大小超过 5MB 限制')
      return
    }

    const connection = getConnection(connectionId)
    let databases: DatabaseInfo[] = []
    let defaultDb = databaseName ?? ''
    const defaultPgDb = pgDatabaseName ?? ''

    if (
      connection?.database_type === 'mysql' ||
      connection?.database_type === 'postgresql' ||
      connection?.database_type === 'gaussdb' ||
      connection?.database_type === 'oracle' ||
      connection?.database_type === 'mongodb' ||
      connection?.database_type === 'redis' ||
      connection?.database_type === 'clickhouse'
    ) {
      try {
        const data = await requestJson<{ databases: DatabaseInfo[] }>(
          `/connections/${connectionId}/databases`
        )
        databases = data.databases
      } catch {
        databases = []
      }

      if (!defaultDb && isSchemaScopedType(connection.database_type)) {
        defaultDb = 'public'
      } else if (!defaultDb) {
        const hasDefault = !connection.database.includes(':')
        if (hasDefault) {
          defaultDb = connection.database
        }
      }
    }

    setSqlFileConnectionId(connectionId)
    setSqlFileName(result.name)
    setSqlFileContent(result.content)
    setSqlFileDatabase(defaultDb)
    setSqlFilePgDatabase(defaultPgDb)
    setSqlFileDatabases(databases)
    setSqlFileResult(null)
    setSqlFileModalOpen(true)
  }

  const runSqlFile = async (): Promise<void> => {
    setSqlFileLoading(true)
    setSqlFileResult(null)

    try {
      const result = await requestJson<SqlFileRunResponse>(
        `/connections/${sqlFileConnectionId}/sql-file`,
        {
          method: 'POST',
          body: JSON.stringify({
            sql: sqlFileContent,
            database: sqlFileDatabase || undefined,
            pg_database: sqlFilePgDatabase || undefined
          })
        }
      )
      setSqlFileResult(result)

      refreshConnectionNode(sqlFileConnectionId)

      if (sqlFileDatabase) {
        refreshDatabaseNode(sqlFileConnectionId, sqlFileDatabase)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '执行 SQL 文件失败')
    } finally {
      setSqlFileLoading(false)
    }
  }

  const openExportModal = (
    connectionId: string,
    database?: string,
    pgDatabase?: string,
    table?: string
  ): void => {
    const connection = getConnection(connectionId)
    setExportOrigin('tree')
    setExportResultTabKey('')
    setExportDataScope('all')
    setExportAvailableColumns([])
    setExportColumns([])
    setExportConnectionId(connectionId)
    setExportDatabase(database ?? '')
    setExportPgDatabase(pgDatabase ?? '')
    setExportTable(table ?? '')
    setExportScope(table ? 'table' : pgDatabase && database ? 'schema' : 'database')
    setExportFormat(
      connection?.database_type === 'mongodb' || connection?.database_type === 'redis'
        ? 'json'
        : 'sql'
    )
    setExportContent('schema_data')
    setExportModalOpen(true)
    if (table) {
      setExportColumnsLoading(true)
      void requestJson<ColumnsResponse>(
        withPgDatabase(
          `/connections/${connectionId}/tables/${encodeURIComponent(table)}/columns`,
          database,
          pgDatabase
        )
      )
        .then((result) => {
          const columns = result.columns.map((column) => column.name)
          setExportAvailableColumns(columns)
          setExportColumns(columns)
        })
        .catch((error) => showError(error instanceof Error ? error.message : '读取导出列失败'))
        .finally(() => setExportColumnsLoading(false))
    }
  }

  const openResultExportModal = (tab: WorkspaceTab): void => {
    if (!tab.connectionId || !tab.result || tab.result.columns.length === 0) {
      messageApi.warning('当前没有可导出的结果')
      return
    }
    const columns = tab.result.columns.filter((column) => column !== '__rowKey')
    setExportOrigin('result')
    setExportResultTabKey(tab.key)
    setExportDataScope('current_page')
    setExportAvailableColumns(columns)
    setExportColumns(columns)
    setExportColumnsLoading(false)
    setExportConnectionId(tab.connectionId)
    setExportDatabase(tab.databaseName ?? '')
    setExportPgDatabase(tab.pgDatabaseName ?? '')
    setExportTable(tab.tableName ?? '')
    setExportScope(tab.kind === 'preview' ? 'table' : 'database')
    setExportFormat('csv')
    setExportContent('data')
    setExportModalOpen(true)
  }

  const runExport = async (): Promise<void> => {
    setExportLoading(true)
    try {
      const resultTab = exportResultTabKey
        ? useWorkspaceStore.getState().getTabByKey(exportResultTabKey)
        : undefined
      if (exportAvailableColumns.length > 0 && exportColumns.length === 0) {
        messageApi.warning('请至少选择一个导出列')
        return
      }
      const defaultName =
        exportTable || resultTab?.title || exportPgDatabase || exportDatabase || 'export'
      const extension =
        exportFormat === 'markdown'
          ? 'md'
          : exportFormat === 'csv'
            ? 'csv'
            : exportFormat === 'json'
              ? 'json'
              : 'sql'
      const outputPath = await window.api.selectExportPath(
        exportFormat,
        `${defaultName}.${extension}`
      )
      if (!outputPath) {
        return
      }
      const isResultExport = exportOrigin === 'result' && resultTab
      const result = await requestJson<{ success: boolean; message: string; file_path?: string }>(
        isResultExport ? '/backup/export-data' : '/backup/export',
        {
          method: 'POST',
          body: JSON.stringify(
            isResultExport
              ? {
                  connection_id: resultTab.connectionId,
                  source: resultTab.kind === 'query' ? 'query' : 'table',
                  format: exportFormat,
                  output_path: outputPath,
                  columns: exportColumns,
                  data_scope: exportDataScope,
                  sql: resultTab.kind === 'query' ? resultTab.executedSql : undefined,
                  table: resultTab.kind === 'preview' ? resultTab.tableName : undefined,
                  database: resultTab.databaseName || undefined,
                  pg_database: resultTab.pgDatabaseName || undefined,
                  where: resultTab.kind === 'preview' ? resultTab.where || undefined : undefined,
                  sort_column: resultTab.sortState?.column,
                  sort_direction: resultTab.sortState?.direction,
                  limit:
                    resultTab.limit ??
                    (resultTab.kind === 'preview' ? PREVIEW_DEFAULT_LIMIT : QUERY_DEFAULT_LIMIT),
                  offset:
                    Math.max(0, (resultTab.page ?? 1) - 1) *
                    (resultTab.limit ??
                      (resultTab.kind === 'preview' ? PREVIEW_DEFAULT_LIMIT : QUERY_DEFAULT_LIMIT))
                }
              : {
                  connection_id: exportConnectionId,
                  database: exportDatabase || undefined,
                  pg_database: exportPgDatabase || undefined,
                  table: exportTable || undefined,
                  scope: exportScope,
                  format: exportFormat,
                  content: exportContent,
                  columns: exportScope === 'table' ? exportColumns : undefined,
                  output_path: outputPath
                }
          )
        }
      )
      messageApi.success(result.message)
      setExportModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportLoading(false)
    }
  }

  const openImportModal = (
    connectionId: string,
    database?: string,
    pgDatabase?: string,
    table?: string
  ): void => {
    setImportConnectionId(connectionId)
    setImportDatabase(database ?? '')
    setImportPgDatabase(pgDatabase ?? '')
    setImportTable(table ?? '')
    setImportPath('')
    setImportModalOpen(true)
  }

  const selectImportFilePath = async (): Promise<void> => {
    const filePath = await window.api.selectImportFile()
    if (filePath) {
      setImportPath(filePath)
    }
  }

  const runImport = async (): Promise<void> => {
    if (!importPath) {
      messageApi.warning('请先选择导入文件')
      return
    }
    setImportLoading(true)
    try {
      const result = await requestJson<{ success: boolean; message: string }>('/backup/import', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: importConnectionId,
          input_path: importPath,
          database: importDatabase || undefined,
          pg_database: importPgDatabase || undefined,
          table: importTable || undefined
        })
      })
      messageApi.success(result.message)
      refreshConnectionNode(importConnectionId)
      setImportModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  const openBackupRestoreModal = (
    connectionId: string,
    database?: string,
    pgDatabase?: string
  ): void => {
    setBackupRestoreConnectionId(connectionId)
    setBackupRestoreDatabase(database ?? '')
    setBackupRestorePgDatabase(pgDatabase ?? '')
    setBackupRestoreModalOpen(true)
  }

  const runBackup = async (): Promise<void> => {
    setBackupRestoreLoading(true)
    try {
      const defaultName = `${backupRestorePgDatabase || backupRestoreDatabase || 'backup'}.sql`
      const outputPath = await window.api.selectExportPath('sql', defaultName)
      if (!outputPath) {
        return
      }
      const result = await requestJson<{ success: boolean; message: string; file_path?: string }>(
        '/backup/create',
        {
          method: 'POST',
          body: JSON.stringify({
            connection_id: backupRestoreConnectionId,
            database: backupRestoreDatabase || undefined,
            pg_database: backupRestorePgDatabase || undefined,
            output_path: outputPath
          })
        }
      )
      messageApi.success(
        result.file_path ? `${result.message}：${result.file_path}` : result.message
      )
      setBackupRestoreModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : '备份失败')
    } finally {
      setBackupRestoreLoading(false)
    }
  }

  const updatePreviewCells = (
    tabKey: string,
    patches: Array<{ rowKey: string; column: string; value: unknown }>
  ): void => {
    if (patches.length === 0) {
      return
    }
    const rowPatches = new Map<string, Array<{ column: string; value: unknown }>>()
    for (const patch of patches) {
      const current = rowPatches.get(patch.rowKey) ?? []
      current.push({ column: patch.column, value: patch.value })
      rowPatches.set(patch.rowKey, current)
    }
    editingCellRefs.current[tabKey] = undefined
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== tabKey) {
          return tab
        }

        return {
          ...tab,
          columnFilterOptions: undefined,
          editRows: tab.editRows?.map((row) => {
            const nextPatches = rowPatches.get(row.__rowKey)
            if (!nextPatches?.length) {
              return row
            }
            let changed = false
            const nextRow = { ...row }
            for (const patch of nextPatches) {
              if (isCellValueEqual(nextRow[patch.column], patch.value)) {
                continue
              }
              nextRow[patch.column] = patch.value
              changed = true
            }
            if (!changed) {
              return row
            }
            return {
              ...nextRow,
              __state: row.__state === 'inserted' ? 'inserted' : 'updated'
            }
          })
        }
      })
    )
  }

  const updatePreviewCell = (
    tabKey: string,
    rowKey: string,
    column: string,
    value: unknown
  ): void => {
    updatePreviewCells(tabKey, [{ rowKey, column, value }])
    requestAnimationFrame(() => syncRenderedCellSelection(tabKey))
  }

  const addPreviewRow = (tab: WorkspaceTab): void => {
    const columns = tab.result?.columns ?? []
    const rowKey = `new:${Date.now()}`
    const row = columns.reduce<EditableRow>((nextRow, column) => ({ ...nextRow, [column]: null }), {
      __rowKey: rowKey,
      __state: 'inserted'
    })
    pendingPreviewRowScrollRefs.current[tab.key] = rowKey
    updateWorkspaceTab(tab.key, {
      editRows: [...(tab.editRows ?? []), row],
      columnFilterOptions: undefined
    })
  }

  const submitRedisChanges = async (tab: WorkspaceTab): Promise<void> => {
    if (!tab.connectionId || !tab.databaseName) {
      return
    }

    const edits = Object.values(tab.redisEdits ?? {})
    const toPayload = (edit: RedisKeyEdit): Record<string, unknown> => ({
      key: edit.key,
      original_key: edit.originalKey,
      type: edit.type,
      value: edit.value,
      ttl: edit.ttl ?? null
    })
    const inserted = edits
      .filter((edit) => edit.state === 'inserted' && !edit.deleted)
      .map(toPayload)
    const updated = edits.filter((edit) => edit.state === 'updated' && !edit.deleted).map(toPayload)
    const deleted = edits
      .filter((edit) => edit.deleted && edit.originalKey)
      .map((edit) => edit.originalKey!)

    updateWorkspaceTab(tab.key, { loading: true, error: undefined })

    try {
      const result = await requestJson<QueryResponse>(
        withPageQuery(
          withDatabaseQuery(`/connections/${tab.connectionId}/redis/data`, tab.databaseName),
          tab.limit ?? REDIS_DEFAULT_LIMIT,
          tab.page ?? 1
        ),
        {
          method: 'PUT',
          body: JSON.stringify({ inserted, updated, deleted })
        }
      )
      updateWorkspaceTab(tab.key, {
        result,
        redisEdits: buildRedisEdits(result.rows),
        redisExpandedValues: {},
        page: tab.page ?? 1,
        loading: false,
        error: undefined
      })
      refreshDatabaseNode(tab.connectionId, tab.databaseName)
    } catch (err) {
      updateWorkspaceTab(tab.key, {
        loading: false,
        error: err instanceof Error ? err.message : '提交 Redis 数据失败'
      })
    }
  }

  const markSelectedRowsDeleted = (tab: WorkspaceTab, selectedRowKeysOverride?: string[]): void => {
    const selectedRowKeys =
      selectedRowKeysOverride ??
      (tab.selectedRowKeyMap
        ? Object.keys(tab.selectedRowKeyMap)
        : (tab.selectedRowKeys ?? []).map(String))
    const currentRowKeys = new Set((tab.editRows ?? []).map((row) => row.__rowKey))
    const selected = new Set(selectedRowKeys.map(String).filter((rowKey) => currentRowKeys.has(rowKey)))
    if (selected.size === 0) {
      return
    }
    const editRows = (tab.editRows ?? [])
      .filter((row) => !(row.__state === 'inserted' && selected.has(row.__rowKey)))
      .map((row) => (selected.has(row.__rowKey) ? { ...row, __deleted: true } : row))
    delete rowSelectionDraftRefs.current[tab.key]
    delete selectedRowRefs.current[tab.key]
    delete renderedSelectedRowRefs.current[tab.key]
    updateWorkspaceTab(tab.key, {
      editRows,
      selectedRowKeys: [],
      selectedRowKeyMap: {},
      columnFilterOptions: undefined
    })
  }

  const submitPreviewChanges = async (tab: WorkspaceTab): Promise<void> => {
    if (!tab.connectionId || !tab.tableName) {
      return
    }

    clearInlineCellEditor(tab.key)

    const limit = tab.limit ?? PREVIEW_DEFAULT_LIMIT
    const page = tab.page ?? 1
    const rows = tab.editRows ?? []
    const cleanRow = (row: EditableRow): Record<string, unknown> => {
      return Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => !['__rowKey', '__state', '__deleted', '__original'].includes(key)
        )
      )
    }
    const inserted = rows
      .filter((row) => row.__state === 'inserted' && !row.__deleted)
      .map(cleanRow)
    const updated = rows
      .filter((row) => row.__state === 'updated' && !row.__deleted)
      .map((row) => ({ original: row.__original ?? cleanRow(row), values: cleanRow(row) }))
    const deleted = rows
      .filter((row) => row.__deleted && row.__state !== 'inserted')
      .map((row) => row.__original ?? cleanRow(row))

    updateWorkspaceTab(tab.key, { loading: true, error: undefined })

    try {
      const dataPath = withSortQuery(
        withWhereQuery(
          withPageQuery(
            withPgDatabase(
              `/connections/${tab.connectionId}/tables/${encodeURIComponent(tab.tableName)}/data`,
              tab.databaseName,
              tab.pgDatabaseName
            ),
            limit,
            page
          ),
          tab.where
        ),
        tab.sortState
      )
      const [result, columnsData] = await Promise.all([
        requestJson<QueryResponse>(dataPath, {
          method: 'PUT',
          body: JSON.stringify({ inserted, updated, deleted })
        }),
        requestJson<ColumnsResponse>(
          withPgDatabase(
            `/connections/${tab.connectionId}/tables/${encodeURIComponent(tab.tableName)}/columns`,
            tab.databaseName,
            tab.pgDatabaseName
          )
        )
      ])
      const columnInfoMap = Object.fromEntries(
        columnsData.columns.map((item) => [item.name, item] as const)
      )
      editingCellRefs.current[tab.key] = undefined
      updateWorkspaceTab(tab.key, {
        result,
        columnInfoMap,
        editRows: buildEditableRows(result.rows),
        selectedRowKeys: [],
        selectedRowKeyMap: {},
        columnFilterOptions: undefined,
        where: tab.where?.trim() ?? '',
        loading: false,
        error: undefined
      })
      requestAnimationFrame(() => syncRenderedCellSelection(tab.key))
    } catch (err) {
      updateWorkspaceTab(tab.key, {
        loading: false,
        error: err instanceof Error ? err.message : '提交表数据失败'
      })
    }
  }

  const submitQueryChanges = async (tab: WorkspaceTab): Promise<void> => {
    if (!tab.connectionId || !tab.executedSql || !tab.result) {
      return
    }

    clearInlineCellEditor(tab.key)
    const cleanRow = (row: EditableRow): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => !['__rowKey', '__state', '__deleted', '__original'].includes(key)
        )
      )
    const updated = (tab.editRows ?? [])
      .filter((row) => row.__state === 'updated')
      .map((row) => ({ original: row.__original ?? cleanRow(row), values: cleanRow(row) }))
    if (updated.length === 0) {
      return
    }

    const connection = getConnection(tab.connectionId)
    updateWorkspaceTab(tab.key, { loading: true, error: undefined })
    try {
      const response = await requestJson<{ updated_count: number }>('/query/data', {
        method: 'PUT',
        body: JSON.stringify({
          connection_id: tab.connectionId,
          sql: tab.executedSql,
          updated,
          database:
            connection?.database_type === 'mysql' ||
            connection?.database_type === 'dm' ||
            connection?.database_type === 'oracle' ||
            isSchemaScopedType(connection?.database_type) ||
            connection?.database_type === 'clickhouse'
              ? tab.databaseName || undefined
              : undefined,
          pg_database: isSchemaScopedType(connection?.database_type)
            ? tab.pgDatabaseName || undefined
            : undefined
        })
      })
      const rows = (tab.editRows ?? []).map(cleanRow)
      updateWorkspaceTab(tab.key, {
        result: { ...tab.result, rows },
        editRows: buildEditableRows(rows),
        columnFilterOptions: undefined,
        loading: false,
        error: undefined
      })
      messageApi.success(`已提交 ${response.updated_count} 项修改`)
      requestAnimationFrame(() => syncRenderedCellSelection(tab.key))
    } catch (err) {
      updateWorkspaceTab(tab.key, {
        loading: false,
        error: err instanceof Error ? err.message : '提交查询结果修改失败'
      })
    }
  }

  const previewTable = async (
    connectionId: string,
    tableName: string,
    databaseName?: string,
    pgDatabaseName?: string,
    limit = PREVIEW_DEFAULT_LIMIT,
    page = 1,
    where = '',
    objectType: 'table' | 'view' = 'table',
    sortState?: { column: string; direction: 'ascend' | 'descend' }
  ): Promise<void> => {
    const previewStartedAt = performance.now()
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const whereCondition = where.trim()
    const tabKey = `preview:${connectionId}:${pgDatabaseName ?? databaseName ?? 'main'}:${tableName}`
    const existingPreviewTab = getWorkspaceTabs().find((tab) => tab.key === tabKey)
    const tabExists = Boolean(existingPreviewTab)
    clearInlineCellEditor(tabKey)
    delete rowSelectionDraftRefs.current[tabKey]
    delete selectedRowRefs.current[tabKey]
    delete renderedSelectedRowRefs.current[tabKey]
    delete rowDragAnchorRefs.current[tabKey]
    delete rowSelectionAnchorRefs.current[tabKey]

    startTransition(() => {
      setSelectedConnectionId(connectionId)
    })
    if (tabExists) {
      setWorkspaceTabsAndActiveTabKey(
        (current) =>
          current.map((tab) =>
            tab.key === tabKey
              ? {
                  ...tab,
                  limit,
                  page,
                  where: whereCondition,
                  objectType,
                  loading: true,
                  error: undefined,
                  selectedRowKeys: [],
                  selectedRowKeyMap: {},
                  columnFilterOptions: undefined
                }
              : tab
          ),
        tabKey
      )
    }

    try {
      const effectiveSortState = sortState !== undefined ? sortState : existingPreviewTab?.sortState
      const previewPath = withSortQuery(
        withWhereQuery(
          withPageQuery(
            withPgDatabase(
              `/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/preview`,
              databaseName,
              pgDatabaseName
            ),
            limit,
            page
          ),
          whereCondition
        ),
        effectiveSortState
      )
      const [result, columnsData] = await Promise.all([
        requestJson<QueryResponse>(previewPath),
        requestJson<ColumnsResponse>(
          withPgDatabase(
            `/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns`,
            databaseName,
            pgDatabaseName
          )
        ).catch(() => undefined)
      ])
      const columnInfoMap = columnsData
        ? Object.fromEntries(columnsData.columns.map((item) => [item.name, item] as const))
        : existingPreviewTab?.columnInfoMap
      editingCellRefs.current[tabKey] = undefined
      startTransition(() => {
        setWorkspaceTabsAndActiveTabKey((current) => {
          const resolvedTitle = databaseName ? `${databaseName}.${tableName}` : tableName
          const nextPreviewTab = {
            key: tabKey,
            title: resolvedTitle,
            kind: 'preview' as const,
            connectionId,
            databaseName,
            pgDatabaseName,
            tableName,
            objectType,
            sql: '',
            limit,
            page,
            where: whereCondition,
            loading: false,
            error: undefined,
            result,
            columnInfoMap,
            editRows: buildEditableRows(result.rows),
            selectedRowKeys: [],
            selectedRowKeyMap: {},
            columnFilterOptions: undefined,
            tableRenderVersion: tabExists
              ? (current.find((tab) => tab.key === tabKey)?.tableRenderVersion ?? 0) + 1
              : 1,
            sortState: effectiveSortState
          }

          if (!current.some((tab) => tab.key === tabKey)) {
            return [...current, nextPreviewTab]
          }

          return current.map((tab) =>
            tab.key === tabKey
              ? {
                  ...tab,
                  ...nextPreviewTab
                }
              : tab
          )
        }, tabKey)
      })
      requestAnimationFrame(() => syncRenderedCellSelection(tabKey))
      console.info('[perf][preview-table] resolved', {
        tabKey,
        rows: result.rows.length,
        columns: result.columns.length,
        duration: Number((performance.now() - previewStartedAt).toFixed(2))
      })
    } catch (err) {
      console.info('[perf][preview-table] failed', {
        tabKey,
        duration: Number((performance.now() - previewStartedAt).toFixed(2))
      })
      if (tabExists) {
        updateWorkspaceTab(tabKey, {
          loading: false,
          error: err instanceof Error ? err.message : '加载表数据失败'
        })
      } else {
        startTransition(() => {
          setWorkspaceTabsAndActiveTabKey(
            (current) => [
              ...current,
              {
                key: tabKey,
                title: databaseName ? `${databaseName}.${tableName}` : tableName,
                kind: 'preview',
                connectionId,
                databaseName,
                pgDatabaseName,
                tableName,
                objectType,
                sql: '',
                limit,
                page,
                where: whereCondition,
                loading: false,
                error: err instanceof Error ? err.message : '加载表数据失败',
                tableRenderVersion: 1
              }
            ],
            tabKey
          )
        })
      }
    }
  }

  const openTableCatalog = async (
    connectionId: string,
    databaseName?: string,
    pgDatabaseName?: string,
    objectType: 'table' | 'view' = 'table'
  ): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const connection = getConnection(connectionId)
    const scopeTitle = isSchemaScopedType(connection?.database_type)
      ? [pgDatabaseName, databaseName].filter(Boolean).join('.')
      : databaseName || pgDatabaseName || connection?.database || connection?.name || '当前库'
    const tabKey = `table-list:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${objectType}`

    setSelectedConnectionId(connectionId)
    setActiveTabKey(tabKey)
    setWorkspaceTabs((current) => {
      const exists = current.some((tab) => tab.key === tabKey)
      if (exists) {
        return current.map((tab) =>
          tab.key === tabKey ? { ...tab, loading: true, error: undefined } : tab
        )
      }

      return [
        ...current,
        {
          key: tabKey,
          title: objectType === 'view' ? `${scopeTitle} 视图列表` : `${scopeTitle} 列表`,
          kind: 'table-list',
          connectionId,
          databaseName,
          pgDatabaseName,
          sql: '',
          loading: true
        }
      ]
    })

    try {
      const rows =
        objectType === 'view'
          ? (
              await requestJson<{ objects: DbObjectInfo[] }>(
                `${withPgDatabase(`/connections/${connectionId}/objects`, databaseName, pgDatabaseName)}${databaseName || pgDatabaseName ? '&' : '?'}type=view`
              )
            ).objects.map((object, index) => ({
              __rowKey: `view-list:${index}`,
              名称: object.name,
              注释: ''
            }))
          : (
              await requestJson<{ tables: TableInfo[] }>(
                `${withPgDatabase(`/connections/${connectionId}/tables`, databaseName, pgDatabaseName)}${databaseName || pgDatabaseName ? '&' : '?'}include_comment=true`
              )
            ).tables.map((table, index) => ({
              __rowKey: `table-list:${index}`,
              名称: table.name,
              注释: table.comment ?? ''
            }))
      updateWorkspaceTab(tabKey, {
        result: {
          columns: ['名称', '注释'],
          rows,
          row_count: rows.length,
          total_count: rows.length,
          limited: false
        },
        loading: false,
        error: undefined
      })
    } catch (err) {
      updateWorkspaceTab(tabKey, {
        loading: false,
        error: err instanceof Error ? err.message : '加载表列表失败'
      })
      showError(err instanceof Error ? err.message : '加载表列表失败')
    }
  }

  const resolvePreferredQueryContext = (
    connectionId?: string
  ): { databaseName?: string; pgDatabaseName?: string } => {
    const connId = connectionId ?? selectedConnectionId
    const currentActiveTabKey = useWorkspaceStore.getState().activeTabKey
    const currentActiveTab = currentActiveTabKey
      ? useWorkspaceStore.getState().getTabByKey(currentActiveTabKey)
      : undefined
    const contextCandidates: Array<
      | {
          connectionId?: string
          databaseName?: string
          pgDatabaseName?: string
        }
      | undefined
    > = [focusedTreeNode, currentActiveTab, aiActiveContext]

    for (const candidate of contextCandidates) {
      if (!candidate || candidate.connectionId !== connId) {
        continue
      }
      if (candidate.databaseName || candidate.pgDatabaseName) {
        return {
          databaseName: candidate.databaseName,
          pgDatabaseName: candidate.pgDatabaseName
        }
      }
    }

    return {}
  }

  const openQueryWorkspace = (
    initialSql = 'select * from users;',
    title?: string,
    connectionId?: string,
    databaseName?: string,
    pgDatabaseName?: string
  ): string => {
    const nextIndex = queryCounter
    const tabKey = `query:${Date.now()}:${nextIndex}`
    const connId = connectionId ?? selectedConnectionId
    const connection = getConnection(connId)
    const preferredContext = resolvePreferredQueryContext(connId)

    let finalDb = databaseName ?? preferredContext.databaseName
    let finalPgDb = pgDatabaseName ?? preferredContext.pgDatabaseName

    if (
      (isDatabaseScopedType(connection?.database_type) ||
        connection?.database_type === 'dm' ||
        connection?.database_type === 'oracle') &&
      !finalDb
    ) {
      finalDb = getDefaultDatabaseName(connection)
    }

    if (isSchemaScopedType(connection?.database_type) && !finalPgDb) {
      finalPgDb = getDefaultPgDatabase(connection)
    }

    if (isSchemaScopedType(connection?.database_type) && !finalDb && finalPgDb) {
      const cachedSchemas = allSchemas[`${connId}:${finalPgDb}`]
      if (cachedSchemas) {
        finalDb = getDefaultPgSchema(cachedSchemas)
      }
    }

    setQueryCounter((current) => current + 1)
    setWorkspaceTabs((current) => [
      ...current,
      {
        key: tabKey,
        title: title ?? `查询 ${nextIndex}`,
        kind: 'query',
        connectionId: connId,
        databaseName: finalDb,
        pgDatabaseName: finalPgDb,
        sql: initialSql,
        limit: 1000,
        page: 1,
        loading: false,
        resultVisible: false,
        resultCollapsed: false,
        resultKind: 'query',
        queryEditorHeight: 280,
        persistedAt: Date.now()
      }
    ])
    setActiveTabKey(tabKey)

    if (connId) {
      void ensureDatabasesLoaded(connId)

      if (isDatabaseScopedType(connection?.database_type) && finalDb) {
        void preloadCompletionForDatabase(connId, finalDb)
      } else if (connection?.database_type === 'sqlite') {
        void preloadCompletionForDatabase(connId)
      }

      if (isSchemaScopedType(connection?.database_type) && finalPgDb && !finalDb) {
        ensureSchemasLoaded(connId, finalPgDb).then((schemaNames) => {
          const defaultSchema = getDefaultPgSchema(schemaNames)
          if (defaultSchema) {
            updateWorkspaceTab(tabKey, { databaseName: defaultSchema })
          }
        })
      }
    }

    return tabKey
  }

  const openQueryWorkspaceRef = useRef(openQueryWorkspace)
  openQueryWorkspaceRef.current = openQueryWorkspace

  const previewTableRef = useRef(previewTable)
  previewTableRef.current = previewTable

  const openPersistedQueryWorkspace = (item: PersistedQueryWorkspace): void => {
    const existing = getWorkspaceTabs().find((tab) => tab.key === item.key)
    if (existing) {
      setActiveTabKey(existing.key)
      return
    }
    setWorkspaceTabs((current) => [
      ...current,
      {
        key: item.key,
        title: item.title,
        kind: 'query',
        connectionId: item.connectionId,
        databaseName: item.databaseName,
        pgDatabaseName: item.pgDatabaseName,
        sql: item.sql,
        limit: item.limit ?? 1000,
        page: 1,
        loading: false,
        resultVisible: false,
        resultCollapsed: false,
        resultKind: 'query',
        queryEditorHeight: item.queryEditorHeight ?? 280,
        persistedAt: item.persistedAt
      }
    ])
    setActiveTabKey(item.key)
    const connection = item.connectionId ? getConnection(item.connectionId) : undefined
    if (item.connectionId && connection?.is_open) {
      void ensureDatabasesLoaded(item.connectionId)
      if (item.pgDatabaseName) {
        void ensureSchemasLoaded(item.connectionId, item.pgDatabaseName)
      }
      if (item.databaseName && !item.pgDatabaseName) {
        void preloadCompletionForDatabase(item.connectionId, item.databaseName)
      } else if (connection?.database_type === 'sqlite') {
        void preloadCompletionForDatabase(item.connectionId)
      }
    }
  }

  const resolveQueryExecutionContext = async (
    tab: WorkspaceTab
  ): Promise<(WorkspaceTab & { treeOpenedForExecution?: boolean }) | undefined> => {
    if (!tab.connectionId) {
      return undefined
    }

    let connection = getConnectionRef.current(tab.connectionId)
    if (!connection) {
      return undefined
    }

    let treeOpenedForExecution = false
    if (!connection.is_open) {
      updateWorkspaceTab(tab.key, {
        loading: true,
        queryExecutionPhase: 'opening-connection'
      })
      const openedConnection = await openConnectionById(tab.connectionId)
      if (!openedConnection) {
        return undefined
      }
      connection = openedConnection
      treeOpenedForExecution = true
    }

    let nextDatabaseName = tab.databaseName
    let nextPgDatabaseName = tab.pgDatabaseName

    if (
      isDatabaseScopedType(connection.database_type) ||
      connection.database_type === 'dm' ||
      connection.database_type === 'oracle'
    ) {
      let loadedDatabases = allDatabases[tab.connectionId] ?? []
      if (loadedDatabases.length === 0) {
        await ensureDatabasesLoaded(tab.connectionId)
        loadedDatabases = allDatabasesRef.current[tab.connectionId] ?? []
      }
      const availableDatabases =
        loadedDatabases.length > 0
          ? loadedDatabases
          : (selectedDatabasesRef.current[tab.connectionId] ?? [])
      if (!nextDatabaseName || !availableDatabases.includes(nextDatabaseName)) {
        nextDatabaseName =
          selectedDatabasesRef.current[tab.connectionId]?.[0] ??
          availableDatabases[0] ??
          getDefaultDatabaseName(connection)
      }
    }

    if (isSchemaScopedType(connection.database_type)) {
      let loadedDatabases = allDatabases[tab.connectionId] ?? []
      if (loadedDatabases.length === 0) {
        await ensureDatabasesLoaded(tab.connectionId)
        loadedDatabases = allDatabasesRef.current[tab.connectionId] ?? []
      }
      const availablePgDatabases =
        loadedDatabases.length > 0
          ? loadedDatabases
          : (selectedDatabasesRef.current[tab.connectionId] ?? [])
      if (!nextPgDatabaseName || !availablePgDatabases.includes(nextPgDatabaseName)) {
        nextPgDatabaseName =
          selectedDatabasesRef.current[tab.connectionId]?.[0] ??
          availablePgDatabases[0] ??
          getDefaultPgDatabase(connection)
      }

      if (nextPgDatabaseName) {
        const schemaNames = await ensureSchemasLoaded(tab.connectionId, nextPgDatabaseName)
        const schemaKey = `${tab.connectionId}:${nextPgDatabaseName}`
        const selectedSchemaList = selectedSchemasRef.current[schemaKey] ?? schemaNames
        if (!nextDatabaseName || !schemaNames.includes(nextDatabaseName)) {
          nextDatabaseName = selectedSchemaList[0] ?? getDefaultPgSchema(schemaNames)
        }
      }
    }

    if (nextDatabaseName !== tab.databaseName || nextPgDatabaseName !== tab.pgDatabaseName) {
      updateWorkspaceTab(tab.key, {
        databaseName: nextDatabaseName,
        pgDatabaseName: nextPgDatabaseName
      })
    }

    if (treeOpenedForExecution) {
      setSelectedConnectionId(tab.connectionId)
      setSelectedConnectionIds([tab.connectionId])
      setSelectedTreeKeys([`connection:${tab.connectionId}`])
      await ensureQueryContextTreeExpanded(connection, nextDatabaseName, nextPgDatabaseName)
    }

    return {
      ...tab,
      databaseName: nextDatabaseName,
      pgDatabaseName: nextPgDatabaseName,
      treeOpenedForExecution
    }
  }

  const appendSqlToQueryWorkspace = useCallback(
    (sql: string, title?: string): void => {
      const nextSql = sql.trimEnd()
      if (!nextSql) {
        return
      }

      const currentActiveTabKey = useWorkspaceStore.getState().activeTabKey
      const activeTab = currentActiveTabKey
        ? useWorkspaceStore.getState().getTabByKey(currentActiveTabKey)
        : undefined
      const canReuseActiveQuery =
        activeTab?.kind === 'query' &&
        activeTab.connectionId === aiActiveContext?.connectionId &&
        (activeTab.databaseName ?? '') === (aiActiveContext?.databaseName ?? '') &&
        (activeTab.pgDatabaseName ?? '') === (aiActiveContext?.pgDatabaseName ?? '')
      if (canReuseActiveQuery && activeTab?.kind === 'query') {
        const separator = activeTab.sql.trim() ? '\n\n' : ''
        updateWorkspaceTab(activeTab.key, { sql: `${activeTab.sql}${separator}${nextSql}` })
        return
      }

      openQueryWorkspaceRef.current(
        nextSql,
        title ?? 'AI 生成 SQL',
        aiActiveContext?.connectionId,
        aiActiveContext?.databaseName,
        aiActiveContext?.pgDatabaseName
      )
    },
    [aiActiveContext, updateWorkspaceTab]
  )

  const refreshAfterAgentChange = useCallback((): void => {
    if (aiActiveContext?.connectionId) {
      if (aiActiveContext.pgDatabaseName) {
        refreshDatabaseNode(aiActiveContext.connectionId, aiActiveContext.pgDatabaseName)
      } else if (aiActiveContext.databaseName) {
        refreshDatabaseNode(aiActiveContext.connectionId, aiActiveContext.databaseName)
      } else {
        refreshConnectionNode(aiActiveContext.connectionId)
      }
    }

    const currentActiveTabKey = useWorkspaceStore.getState().activeTabKey
    const activePreviewCandidate = currentActiveTabKey
      ? useWorkspaceStore.getState().getTabByKey(currentActiveTabKey)
      : undefined
    const activePreview =
      activePreviewCandidate?.kind === 'preview' &&
      activePreviewCandidate.connectionId &&
      activePreviewCandidate.tableName
        ? activePreviewCandidate
        : undefined
    if (activePreview?.connectionId && activePreview.tableName) {
      void previewTableRef.current(
        activePreview.connectionId,
        activePreview.tableName,
        activePreview.databaseName,
        activePreview.pgDatabaseName,
        activePreview.limit,
        activePreview.page,
        activePreview.where
      )
    }
  }, [aiActiveContext, refreshConnectionNode, refreshDatabaseNode])

  const handleConnectionCreateMenuClick = ({ key }: { key: string }) => {
    if (key === 'others') {
      return
    }
    void openConnectionModalRef.current(key as DatabaseType)
  }

  handleConnectionCreateMenuClickRef.current = handleConnectionCreateMenuClick

  const handleAiPanelResizeMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      aiPanelResizeRef.current = { startX: event.clientX, startSize: aiPanelSize }
      setResizingAiPanel(true)
    },
    [aiPanelSize]
  )

  const handleAiPanelWorkspaceAction = useCallback(
    (action: AIWorkspaceAction) => {
      if (action.type === 'append_query_sql') {
        appendSqlToQueryWorkspace(action.sql, action.title)
      }
    },
    [appendSqlToQueryWorkspace]
  )

  const handleAiPanelAgentDataChanged = useCallback(() => {
    refreshAfterAgentChange()
  }, [refreshAfterAgentChange])

  const changeTabLimit = async (tab: WorkspaceTab, limit: number): Promise<void> => {
    updateWorkspaceTab(tab.key, { limit, page: 1, loading: true, error: undefined })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, limit, page: 1 }, tab.executedSql)
      return
    }

    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      await previewRedisDatabase(tab.connectionId, tab.databaseName, limit, 1, tab.key, tab.where)
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(
        tab.connectionId,
        tab.tableName,
        tab.databaseName,
        tab.pgDatabaseName,
        limit,
        1,
        tab.where
      )
    }
  }

  const changeTabPage = async (tab: WorkspaceTab, page: number): Promise<void> => {
    const nextPage = Math.max(1, page)
    updateWorkspaceTab(tab.key, { page: nextPage, loading: true, error: undefined })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, page: nextPage }, tab.executedSql)
      return
    }

    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      await previewRedisDatabase(
        tab.connectionId,
        tab.databaseName,
        tab.limit ?? REDIS_DEFAULT_LIMIT,
        nextPage,
        tab.key,
        tab.where
      )
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(
        tab.connectionId,
        tab.tableName,
        tab.databaseName,
        tab.pgDatabaseName,
        tab.limit ?? PREVIEW_DEFAULT_LIMIT,
        nextPage,
        tab.where
      )
    }
  }

  const runQuery = useCallback(
    async (tab: WorkspaceTab, selectedSql?: string): Promise<void> => {
      const sqlEditorHandle = sqlEditorHandleRefs.current[tab.key]
      const liveEditorSql = sqlEditorHandle?.getValue()
      const liveSelectionPayload = sqlEditorHandle?.getSelectionPayload()
      const executionContext =
        liveSelectionPayload ??
        sqlExecutionContextRef.current[tab.key] ??
        sqlExecutionContextByTab[tab.key]
      const sqlToExecute =
        selectedSql?.trim() ||
        executionContext?.selectedSql?.trim() ||
        executionContext?.currentStatementSql?.trim() ||
        tab.sql.trim()

      if (!tab.connectionId) {
        return
      }

      if (!sqlToExecute) {
        return
      }

      const currentConnection = getConnectionRef.current(tab.connectionId)
      updateWorkspaceTab(tab.key, {
        loading: true,
        queryExecutionPhase: currentConnection?.is_open === false ? 'opening-connection' : 'executing',
        error: undefined,
        resultVisible: true,
        resultCollapsed: false,
        resultKind: 'query',
        commandMessage: undefined,
        commandAffectedRows: undefined,
        multiStatementResults: undefined
      })

      const resolvedTab = await resolveQueryExecutionContext(tab)
      if (!resolvedTab) {
        updateWorkspaceTab(tab.key, { loading: false, queryExecutionPhase: undefined })
        return
      }
      updateWorkspaceTab(resolvedTab.key, { queryExecutionPhase: 'executing' })
      if (liveEditorSql !== undefined && liveEditorSql !== resolvedTab.sql) {
        const nextTab = { ...resolvedTab, sql: liveEditorSql }
        updateWorkspaceTab(resolvedTab.key, { sql: liveEditorSql })
        persistQueryWorkspaceRef.current(nextTab)
      }
      if (resolvedTab.treeOpenedForExecution) {
        await locateTreePath([
          `connection:${resolvedTab.connectionId}`,
          ...(resolvedTab.pgDatabaseName
            ? [`database:${resolvedTab.connectionId}:${resolvedTab.pgDatabaseName}`]
            : []),
          ...(resolvedTab.databaseName && resolvedTab.pgDatabaseName
            ? [
                `pg-schema:${resolvedTab.connectionId}:${resolvedTab.pgDatabaseName}:${resolvedTab.databaseName}`
              ]
            : resolvedTab.databaseName
              ? [`database:${resolvedTab.connectionId}:${resolvedTab.databaseName}`]
              : [])
        ])
      }

      const connection = getConnectionRef.current(resolvedTab.connectionId)

      if (
        (isDatabaseScopedType(connection?.database_type) ||
          connection?.database_type === 'dm' ||
          connection?.database_type === 'oracle') &&
        !resolvedTab.databaseName
      ) {
        updateWorkspaceTab(resolvedTab.key, { loading: false, queryExecutionPhase: undefined })
        return
      }

      if (isSchemaScopedType(connection?.database_type) && !resolvedTab.pgDatabaseName) {
        updateWorkspaceTab(resolvedTab.key, { loading: false, queryExecutionPhase: undefined })
        return
      }

      if (isSchemaScopedType(connection?.database_type) && !resolvedTab.databaseName) {
        updateWorkspaceTab(resolvedTab.key, { loading: false, queryExecutionPhase: undefined })
        return
      }

      updateWorkspaceTab(resolvedTab.key, {
        loading: true,
        queryExecutionPhase: 'executing',
        error: undefined,
        resultVisible: true,
        resultCollapsed: false,
        resultKind: 'query',
        commandMessage: undefined,
        commandAffectedRows: undefined,
        multiStatementResults: undefined
      })

      try {
        const connection = getConnection(resolvedTab.connectionId)
        const selectedStatements = splitSqlStatements(sqlToExecute)
        if (selectedStatements.length > 1) {
          const multiStatementResults: MultiStatementResult[] = []
          updateWorkspaceTab(resolvedTab.key, {
            result: undefined,
            resultKind: 'query',
            multiStatementResults: []
          })

          for (const [index, statement] of selectedStatements.entries()) {
            const runningResult: MultiStatementResult = {
              index,
              sql: statement.text,
              status: 'running'
            }
            multiStatementResults.push(runningResult)
            updateWorkspaceTab(resolvedTab.key, {
              multiStatementResults: [...multiStatementResults]
            })

            try {
              const result = await requestJson<QueryResponse>('/query', {
                method: 'POST',
                body: JSON.stringify({
                  connection_id: resolvedTab.connectionId,
                  sql: statement.text,
                  limit: resolvedTab.limit ?? QUERY_DEFAULT_LIMIT,
                  offset: 0,
                  database:
                    connection?.database_type === 'mysql' ||
                    connection?.database_type === 'dm' ||
                    connection?.database_type === 'oracle' ||
                    isSchemaScopedType(connection?.database_type) ||
                    connection?.database_type === 'mongodb' ||
                    connection?.database_type === 'redis' ||
                    connection?.database_type === 'clickhouse'
                      ? resolvedTab.databaseName || undefined
                      : undefined,
                  pg_database: isSchemaScopedType(connection?.database_type)
                    ? resolvedTab.pgDatabaseName || undefined
                    : undefined
                })
              })
              const commandRow =
                result.columns.length === 2 &&
                result.columns.includes('message') &&
                result.columns.includes('affected_rows') &&
                result.rows.length === 1
                  ? result.rows[0]
                  : undefined
              multiStatementResults[index] = {
                index,
                sql: statement.text,
                status: 'success',
                result,
                affectedRows:
                  typeof commandRow?.affected_rows === 'number' ? commandRow.affected_rows : null
              }
            } catch (err) {
              multiStatementResults[index] = {
                index,
                sql: statement.text,
                status: 'error',
                error: err instanceof Error ? err.message : '查询失败'
              }
            }
            updateWorkspaceTab(resolvedTab.key, {
              multiStatementResults: [...multiStatementResults]
            })
          }

          updateWorkspaceTab(resolvedTab.key, {
            loading: false,
            queryExecutionPhase: undefined,
            executedSql: sqlToExecute,
            multiStatementResults: [...multiStatementResults],
            resultVisible: true,
            resultCollapsed: false,
            resultKind: 'query'
          })
          return
        }
        const result = await requestJson<QueryResponse>('/query', {
          method: 'POST',
          body: JSON.stringify({
            connection_id: resolvedTab.connectionId,
            sql: sqlToExecute,
            limit: resolvedTab.limit ?? QUERY_DEFAULT_LIMIT,
            offset:
              Math.max(0, (resolvedTab.page ?? 1) - 1) * (resolvedTab.limit ?? QUERY_DEFAULT_LIMIT),
            database:
              connection?.database_type === 'mysql' ||
              connection?.database_type === 'dm' ||
              connection?.database_type === 'oracle' ||
              isSchemaScopedType(connection?.database_type) ||
              connection?.database_type === 'mongodb' ||
              connection?.database_type === 'redis' ||
              connection?.database_type === 'clickhouse'
                ? resolvedTab.databaseName || undefined
                : undefined,
            pg_database: isSchemaScopedType(connection?.database_type)
              ? resolvedTab.pgDatabaseName || undefined
              : undefined
          })
        })
        const isCommandResult =
          result.columns.length === 2 &&
          result.columns.includes('message') &&
          result.columns.includes('affected_rows') &&
          result.rows.length === 1
        const commandRow = isCommandResult ? result.rows[0] : undefined
        const preservedTotalCount =
          resolvedTab.executedSql === sqlToExecute ? resolvedTab.result?.total_count : undefined
        updateWorkspaceTab(resolvedTab.key, {
          result: {
            ...result,
            total_count: result.total_count ?? preservedTotalCount
          },
          executedSql: sqlToExecute,
          page: resolvedTab.page ?? 1,
          selectedRowKeys: [],
          selectedRowKeyMap: {},
          editRows: isCommandResult ? undefined : buildEditableRows(result.rows),
          columnFilterOptions: undefined,
          loading: false,
          queryExecutionPhase: undefined,
          error: undefined,
          resultVisible: true,
          resultCollapsed: false,
          resultKind: isCommandResult ? 'command' : 'query',
          commandMessage:
            isCommandResult && typeof commandRow?.message === 'string'
              ? commandRow.message
              : undefined,
          commandAffectedRows:
            isCommandResult && typeof commandRow?.affected_rows === 'number'
              ? commandRow.affected_rows
              : null
        })
      } catch (err) {
        updateWorkspaceTab(resolvedTab.key, {
          loading: false,
          queryExecutionPhase: undefined,
          error: err instanceof Error ? err.message : '查询失败',
          resultVisible: true,
          resultCollapsed: false,
          resultKind: 'error',
          commandMessage: undefined,
          commandAffectedRows: undefined
        })
      }
    },
    [
      sqlExecutionContextByTab,
      isDatabaseScopedType,
      isSchemaScopedType,
      getConnection,
      locateTreePath,
      requestJson,
      resolveQueryExecutionContext,
      updateWorkspaceTab
    ]
  )

  const renderWorkspaceTab = useCallback(
    (tab: WorkspaceTab): React.ReactNode => {
      return renderWorkspaceTabContent({
        tab,
        theme,
        getConnection,
        connections,
        allDatabases,
        allSchemas,
        shortcutSettings,
        executionContext:
          sqlExecutionContextByTab[tab.key] ?? sqlExecutionContextRef.current[tab.key],
        setQueryResultToggleRef: (tabKey, element) => {
          queryResultToggleRefs.current[tabKey] = element
        },
        getDefaultDatabaseName,
        getDefaultPgDatabase,
        getDefaultPgSchema,
        isSchemaScopedType,
        isDatabaseScopedType,
        ensureDatabasesLoaded,
        ensureSchemasLoaded,
        preloadCompletionForDatabase,
        updateWorkspaceTab,
        renderResultTable: renderResultTableRef.current,
        runQuery,
        buildSqlCompletionContext: buildSqlCompletionContextRef.current,
        scheduleQuerySqlDraftCommit,
        handleSqlExecutionContextChange,
        setSqlEditorHandle: (tabKey, handle) => {
          if (handle) {
            sqlEditorHandleRefs.current[tabKey] = handle
            return
          }
          delete sqlEditorHandleRefs.current[tabKey]
        }
      })
    },
    [
      theme,
      getConnection,
      connections,
      allDatabases,
      allSchemas,
      shortcutSettings,
      sqlExecutionContextByTab,
      getDefaultDatabaseName,
      getDefaultPgDatabase,
      getDefaultPgSchema,
      isSchemaScopedType,
      isDatabaseScopedType,
      ensureDatabasesLoaded,
      ensureSchemasLoaded,
      preloadCompletionForDatabase,
      updateWorkspaceTab,
      buildSqlCompletionContext,
      scheduleQuerySqlDraftCommit,
      handleSqlExecutionContextChange
    ]
  )

  const handleActiveWorkspaceTabChange = useCallback(
    (key: string) => {
      setActiveTabKey(key)
    },
    [setActiveTabKey]
  )

  const workspaceRenderVersionToken = useMemo(
    () => ({}),
    [workspaceTabSummaryCount, tableSearchUiState]
  )

  const stableRenderWorkspaceTabRef = useRef(renderWorkspaceTab)
  stableRenderWorkspaceTabRef.current = renderWorkspaceTab

  const stableRenderWorkspaceTab = useCallback(
    (tab: WorkspaceTab, _active: boolean): React.ReactNode => {
      return stableRenderWorkspaceTabRef.current(tab)
    },
    []
  )

  const stableConnectionCreateMenuHandler = useCallback((info: { key: string }) => {
    handleConnectionCreateMenuClickRef.current(info)
  }, [])

  const handleConnectionDriverChange = useCallback(
    (value: string): void => {
      form.setFieldsValue({
        driver_id: value,
        dm_driver_id: connectionModalDatabaseType === 'dm' ? value : undefined
      })
    },
    [connectionModalDatabaseType, form]
  )

  useEffect(() => {
    return () => {
      if (connectionModalHydrationFrameRef.current != null) {
        window.cancelAnimationFrame(connectionModalHydrationFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    void window.api.getBackendStatus().then(setBackendStatus)
    const timer = window.setInterval(() => {
      void window.api.getBackendStatus().then((status) => {
        setBackendStatus(status)
        if (status.state === 'online' || status.state === 'failed' || status.state === 'crashed') {
          window.clearInterval(timer)
        }
      })
    }, 1000)

    const unsubscribe = window.api.onBackendStatusChanged(setBackendStatus)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void refreshUpdateSettings().catch(() => undefined)
    const unsubscribers = [
      window.api.onUpdateAvailable((info) => handleUpdateAvailable(info)),
      window.api.onUpdateNotAvailable((info) => setUpdateInfo(info)),
      window.api.onUpdateDownloadProgress((progress) => {
        setDownloadingUpdate(true)
        setUpdateProgress(progress)
      }),
      window.api.onUpdateDownloaded((info) => {
        setDownloadingUpdate(false)
        setUpdateInfo(info)
        setUpdateProgress((current) => ({
          percent: 100,
          transferred: current?.transferred ?? 0,
          total: current?.total
        }))
        openUpdateModal()
      }),
      window.api.onUpdateError((error) => {
        setCheckingUpdate(false)
        setDownloadingUpdate(false)
        showError(error, '更新失败')
      })
    ]

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  useEffect(() => {
    if (backendStatus.state !== 'online' || !backendStatus.apiBaseUrl) {
      return
    }

    void checkHealth(true)
    void (async () => {
      try {
        await loadConnections()
        await loadConnectionTreePreferences()
      } catch {
        // Keep the legacy local cache intact if the backend is temporarily unavailable.
      }
    })()
  }, [backendStatus.state, backendStatus.apiBaseUrl])

  useEffect(() => {
    if (backendStatus.state !== 'online' || !backendStatus.apiBaseUrl) {
      return
    }
    void refreshGitHubAuthStatus().catch(() => undefined)
    void refreshGitSyncLocalState().catch(() => undefined)
  }, [backendStatus.state, backendStatus.apiBaseUrl])

  useEffect(() => {
    if (!gitSyncAutoEnabled || !gitHubAuthStatus.authorized || !gitSyncLastSyncedAt || gitSyncBusy) {
      return
    }

    let cancelled = false
    const synchronizeInBackground = async (): Promise<void> => {
      if (cancelled) {
        return
      }
      const state = (await window.api.getSyncLocalState()) as GitSyncLocalState
      if (state.passphrase) {
        await startGitSync({ automatic: true, passphrase: state.passphrase })
      }
    }
    const timer = window.setInterval(() => void synchronizeInBackground(), AUTO_SYNC_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [gitHubAuthStatus.authorized, gitSyncAutoEnabled, gitSyncBusy, gitSyncLastSyncedAt])

  useEffect(() => {
    if (startupUiReady) {
      return
    }

    if (backendStatus.state === 'online' && connectionsInitialized) {
      setStartupUiReady(true)
      window.api.notifyRendererReady()
    }
  }, [backendStatus.state, connectionsInitialized, startupUiReady])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DB, JSON.stringify(selectedDatabases))
    } catch {
      // ignore
    }
  }, [selectedDatabases])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SCHEMA, JSON.stringify(selectedSchemas))
    } catch {
      // ignore
    }
  }, [selectedSchemas])

  const updateMode = updateSettings?.mode ?? updateInfo?.mode ?? 'installer'
  const updateDownloaded =
    updateMode === 'portable'
      ? Boolean(updateInfo?.downloadedPath)
      : Boolean(updateInfo?.installerDownloaded)
  const updateActionText = updateMode === 'portable' ? '下载绿色版' : '下载并安装'
  const updateStatusMessage = updateInfo?.available
    ? `发现新版本 ${updateInfo.latestVersion ?? ''}`
    : `当前版本 ${updateSettings?.currentVersion ?? updateInfo?.currentVersion ?? ''}`
  const gitSyncMenu: MenuProps = {
    items: [
      {
        key: 'status',
        disabled: true,
        label: gitSyncLastSyncedAt
          ? `上次同步：${new Date(gitSyncLastSyncedAt).toLocaleString()}`
          : '尚未建立同步基线'
      },
      { type: 'divider' },
      { key: 'sync', icon: <CloudSyncOutlined />, label: '立即同步' },
      { key: 'settings', icon: <SettingOutlined />, label: '同步与版本设置' }
    ],
    onClick: ({ key }) => {
      if (key === 'sync') {
        void startGitSync()
      }
      if (key === 'settings') {
        openSettings('sync')
      }
    }
  }

  const backendReady = backendStatus.state === 'online'
  const showBackendStatusTag =
    startupUiReady || backendStatus.state === 'failed' || backendStatus.state === 'crashed'
  const backendStatusIcon = backendReady ? <CheckCircleOutlined /> : <CloseCircleOutlined />
  const activeAIConnection = getConnection(aiActiveContext?.connectionId)
  // 后端会在 AI 请求中按 connection_id 自动打开连接；不要因为前端状态尚未同步就丢失上下文。
  const activeAIContextConnection = activeAIConnection
  const activeAIDatabase = isSchemaScopedType(activeAIContextConnection?.database_type)
    ? aiActiveContext?.databaseName
    : aiActiveContext?.databaseName
  const activeAIPgDatabase =
    isSchemaScopedType(activeAIContextConnection?.database_type) && activeAIContextConnection
      ? aiActiveContext?.pgDatabaseName
      : undefined
  const activeAIDbName = isSchemaScopedType(activeAIContextConnection?.database_type)
    ? [activeAIPgDatabase, activeAIDatabase].filter(Boolean).join('.')
    : activeAIDatabase
  const primaryAIContextSource: AIContextSource | undefined = useMemo(
    () =>
      activeAIContextConnection && activeAIDbName
        ? {
            id: buildAIContextSourceId({
              type:
                isSchemaScopedType(activeAIContextConnection.database_type) && activeAIDatabase
                  ? 'schema'
                  : 'database',
              connectionId: activeAIContextConnection.connection_id,
              database: isSchemaScopedType(activeAIContextConnection.database_type)
                ? activeAIPgDatabase
                : activeAIDatabase,
              schema: isSchemaScopedType(activeAIContextConnection.database_type)
                ? activeAIDatabase
                : undefined,
              pgDatabase: isSchemaScopedType(activeAIContextConnection.database_type)
                ? activeAIPgDatabase
                : undefined
            }),
            type:
              isSchemaScopedType(activeAIContextConnection.database_type) && activeAIDatabase
                ? 'schema'
                : 'database',
            connectionId: activeAIContextConnection.connection_id,
            connectionName: activeAIContextConnection.name,
            dbType: activeAIContextConnection.database_type,
            database: isSchemaScopedType(activeAIContextConnection.database_type)
              ? activeAIPgDatabase
              : activeAIDatabase,
            schema: isSchemaScopedType(activeAIContextConnection.database_type)
              ? activeAIDatabase
              : undefined,
            pgDatabase: isSchemaScopedType(activeAIContextConnection.database_type)
              ? activeAIPgDatabase
              : undefined
          }
        : undefined,
    [
      activeAIContextConnection,
      activeAIDatabase,
      activeAIDbName,
      activeAIPgDatabase,
      isSchemaScopedType
    ]
  )

  const changeTabLastPage = async (tab: WorkspaceTab): Promise<void> => {
    const limit =
      tab.limit ?? (tab.kind === 'preview' ? PREVIEW_DEFAULT_LIMIT : QUERY_DEFAULT_LIMIT)
    const knownTotal = tab.result?.total_count
    if (knownTotal !== undefined && knownTotal !== null) {
      await changeTabPage(tab, Math.max(1, Math.ceil(knownTotal / limit)))
      return
    }
    if (tab.kind !== 'query' || !tab.connectionId || !tab.executedSql) {
      return
    }

    updateWorkspaceTab(tab.key, { loading: true, error: undefined })
    try {
      const connection = getConnection(tab.connectionId)
      const count = await requestJson<QueryCountResponse>('/query/count', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: tab.connectionId,
          sql: tab.executedSql,
          database:
            connection?.database_type === 'mysql' ||
            connection?.database_type === 'dm' ||
            connection?.database_type === 'oracle' ||
            isSchemaScopedType(connection?.database_type) ||
            connection?.database_type === 'mongodb' ||
            connection?.database_type === 'redis' ||
            connection?.database_type === 'clickhouse'
              ? tab.databaseName || undefined
              : undefined,
          pg_database: isSchemaScopedType(connection?.database_type)
            ? tab.pgDatabaseName || undefined
            : undefined
        })
      })
      const result = tab.result ? { ...tab.result, total_count: count.total_count } : tab.result
      const lastPage = Math.max(1, Math.ceil(count.total_count / limit))
      updateWorkspaceTab(tab.key, { result, loading: false })
      if (lastPage !== (tab.page ?? 1)) {
        await runQuery({ ...tab, result, page: lastPage }, tab.executedSql)
      }
    } catch (error) {
      updateWorkspaceTab(tab.key, {
        loading: false,
        error: error instanceof Error ? error.message : '获取总页数失败'
      })
    }
  }
  const effectiveAIContextSources = useMemo(
    () => mergeAIContextSources(primaryAIContextSource, aiContextSources),
    [aiContextSources, primaryAIContextSource]
  )
  const executionAIContextSource = resolveAIExecutionContextSource(
    primaryAIContextSource,
    effectiveAIContextSources
  )
  const executionAIConnection = getConnection(executionAIContextSource?.connectionId)
  const aiContextConnection = executionAIConnection
  const executionAIDatabaseSelection = resolveAIContextDatabaseSelection(
    executionAIContextSource,
    isSchemaScopedType(aiContextConnection?.database_type)
  )
  const aiDatabase = executionAIDatabaseSelection.database
  const aiPgDatabase = executionAIDatabaseSelection.pgDatabase
  const aiDbName = executionAIDatabaseSelection.dbName
  const focusedConnection = getConnection(focusedTreeNode?.connectionId)
  const focusedResource = useMemo(
    () =>
      focusedTreeNode
        ? {
            kind: focusedTreeNode.kind,
            connectionId: focusedTreeNode.connectionId,
            connectionName: focusedConnection?.name,
            dbType: focusedConnection?.database_type,
            database: isSchemaScopedType(focusedConnection?.database_type)
              ? focusedTreeNode.pgDatabaseName
              : focusedTreeNode.databaseName,
            schema: isSchemaScopedType(focusedConnection?.database_type)
              ? focusedTreeNode.databaseName
              : undefined,
            pgDatabase: focusedTreeNode.pgDatabaseName,
            table: focusedTreeNode.tableName,
            objectType: focusedTreeNode.objectType,
            name: String(
              focusedTreeNode.title ??
                focusedTreeNode.tableName ??
                focusedTreeNode.databaseName ??
                focusedConnection?.name ??
                ''
            ),
            sizeDisplay: focusedTreeNode.sizeDisplay,
            rowCount: focusedTreeNode.rowCount
          }
        : undefined,
    [focusedConnection?.database_type, focusedConnection?.name, focusedTreeNode]
  )
  const connectionSummaries = useMemo(
    () =>
      connections.map((connection) => ({
        connectionId: connection.connection_id,
        name: connection.name,
        dbType: connection.database_type,
        database: connection.database,
        isOpen: connection.is_open,
        serverVersion: connection.server_version
      })),
    [connections]
  )
  const aiPanelContent = useMemo(() => {
    if (!aiPanelOpen || !aiModuleInstalled) {
      return null
    }

    return (
      <AIDockPanelHost
        requestJson={requestJson}
        aiContextConnection={aiContextConnection}
        aiDbName={aiDbName}
        aiDatabase={aiDatabase}
        aiPgDatabase={aiPgDatabase}
        focusedResource={focusedResource}
        connectionSummaries={connectionSummaries}
        effectiveAIContextSources={effectiveAIContextSources}
        primaryAIContextSource={primaryAIContextSource}
        executionAIContextSource={executionAIContextSource}
        removeAIContextSource={removeAIContextSource}
        handleAiPanelWorkspaceAction={handleAiPanelWorkspaceAction}
        handleAiPanelAgentDataChanged={handleAiPanelAgentDataChanged}
        shortcutSend={shortcutSettings.ai_send}
        shortcutNewline={shortcutSettings.ai_newline}
        shortcutStop={shortcutSettings.ai_stop}
      />
    )
  }, [
    aiPanelOpen,
    aiModuleInstalled,
    requestJson,
    aiContextConnection,
    aiDbName,
    aiDatabase,
    aiPgDatabase,
    focusedResource,
    connectionSummaries,
    effectiveAIContextSources,
    primaryAIContextSource,
    executionAIContextSource,
    removeAIContextSource,
    handleAiPanelWorkspaceAction,
    handleAiPanelAgentDataChanged,
    shortcutSettings.ai_send,
    shortcutSettings.ai_newline,
    shortcutSettings.ai_stop
  ])

  const exportResultTab = exportResultTabKey
    ? getWorkspaceTabs().find((tab) => tab.key === exportResultTabKey)
    : undefined
  const exportConnection = getConnection(exportConnectionId)
  const exportSupportsSql =
    exportOrigin === 'tree'
      ? exportConnection?.database_type !== 'mongodb' && exportConnection?.database_type !== 'redis'
      : exportResultTab?.kind === 'preview' &&
        exportConnection?.database_type !== 'mongodb' &&
        exportConnection?.database_type !== 'redis'
  const exportFormatOptions = [
    ...(exportSupportsSql ? [{ label: 'SQL', value: 'sql' as const }] : []),
    { label: 'CSV', value: 'csv' as const },
    { label: 'JSON', value: 'json' as const },
    { label: 'Markdown', value: 'markdown' as const }
  ]
  const gitSyncConflictDisplayContext = useMemo(() => {
    const connectionNames: Record<string, string> = Object.fromEntries(
      connections.map((connection) => [connection.connection_id, connection.name])
    )
    for (const [connectionId, payload] of Object.entries(gitSyncPendingPayload?.connections ?? {})) {
      if (typeof payload.name === 'string' && !connectionNames[connectionId]) {
        connectionNames[connectionId] = payload.name
      }
    }

    const folderNames: Record<string, string> = Object.fromEntries(
      connectionFolders.map((folder) => [folder.id, folder.name])
    )
    const folderParents: Record<string, string | undefined> = Object.fromEntries(
      connectionFolders.map((folder) => [folder.id, folder.parentId])
    )
    const pendingFolders = gitSyncPendingPayload?.preferences.connection_folders
    if (Array.isArray(pendingFolders)) {
      for (const folder of pendingFolders) {
        if (
          folder &&
          typeof folder === 'object' &&
          !Array.isArray(folder) &&
          typeof (folder as { id?: unknown }).id === 'string' &&
          typeof (folder as { name?: unknown }).name === 'string'
        ) {
          const item = folder as { id: string; name: string }
          if (!folderNames[item.id]) {
            folderNames[item.id] = item.name
          }
          if (!folderParents[item.id] && typeof (folder as { parentId?: unknown }).parentId === 'string') {
            folderParents[item.id] = (folder as { parentId: string }).parentId
          }
        }
      }
    }
    return { connectionNames, folderNames, folderParents }
  }, [connections, connectionFolders, gitSyncPendingPayload])
  const gitSyncConflictGroups = useMemo(
    () => groupGitSyncConflicts(gitSyncConflicts),
    [gitSyncConflicts]
  )

  return (
    <ConfigProvider
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorBgBase: theme === 'dark' ? '#25272c' : '#ffffff',
          colorBgContainer: theme === 'dark' ? '#363a42' : '#ffffff',
          colorBgElevated: theme === 'dark' ? '#363a42' : '#ffffff',
          colorText: theme === 'dark' ? '#f1f3f5' : '#111827',
          colorTextSecondary: theme === 'dark' ? '#c4cad2' : '#516070',
          colorBorder: theme === 'dark' ? 'rgba(210, 218, 230, 0.16)' : 'rgba(136, 153, 177, 0.24)',
          borderRadius: 10
        },
        components: {
          Tree: {
            titleHeight: RESOURCE_TREE_ITEM_HEIGHT
          },
          Modal: {
            contentBg: theme === 'dark' ? '#363a42' : '#ffffff',
            headerBg: theme === 'dark' ? '#363a42' : '#ffffff',
            footerBg: theme === 'dark' ? '#363a42' : '#ffffff'
          }
        }
      }}
    >
      <Layout className="app-shell" data-startup-ready={startupUiReady ? 'true' : 'false'}>
        {contextHolder}
        <Layout.Header className="app-header">
          <Flex align="center" justify="space-between" className="app-toolbar">
            <Space size="middle">
              <div className="brand-mark">
                <img src={appIcon} alt="" />
              </div>
              <Typography.Title level={4} className="brand-title">
                DataDjinn
              </Typography.Title>
            </Space>
            <div className="titlebar-spacer" />
            <Space className="toolbar-actions titlebar-no-drag" size={4}>
              <Button
                className="toolbar-query-btn"
                type="primary"
                size="small"
                icon={<FileAddOutlined />}
                onClick={() => openQueryWorkspace('', '新建查询')}
                title="新建查询"
                aria-label="新建查询"
              >
                新建查询
              </Button>
              {gitSnapshotTasks.length > 0 && (
                <Dropdown
                  trigger={['click']}
                  dropdownRender={() => (
                    <div className="git-background-task-menu">
                      <Typography.Text strong>后台任务</Typography.Text>
                      {gitSnapshotTasks.map((task) => (
                        <div className="git-background-task-entry" key={task.id}>
                          <Flex justify="space-between" align="center" gap="small">
                            <Typography.Text ellipsis>{task.title}</Typography.Text>
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<CloseOutlined />}
                              title="停止任务"
                              aria-label={`停止任务 ${task.title}`}
                              onClick={() => void cancelGitSnapshotTask(task.id)}
                            />
                          </Flex>
                          <Progress percent={task.percent} size="small" showInfo />
                          <Typography.Text type="secondary" ellipsis>{task.detail}</Typography.Text>
                        </div>
                      ))}
                    </div>
                  )}
                >
                  <Button
                    className="toolbar-icon-btn"
                    type="text"
                    size="small"
                    icon={<LoadingOutlined spin />}
                    title="后台任务"
                    aria-label="后台任务"
                  />
                </Dropdown>
              )}
              <Button
                className="toolbar-icon-btn"
                type="text"
                size="small"
                icon={<HistoryOutlined />}
                onClick={openQueryHistoryModal}
                title="历史查询窗口"
                aria-label="历史查询窗口"
              />
              <Button
                className="toolbar-icon-btn"
                type="text"
                size="small"
                icon={<SettingOutlined />}
                onClick={() => openSettings('app')}
                title="设置"
                aria-label="设置"
              />
              <Button
                className="toolbar-icon-btn"
                type="text"
                size="small"
                loading={checkingUpdate}
                onClick={() => {
                  openUpdateModal()
                  if (!updateInfo?.available && !downloadingUpdate) {
                    void checkForUpdates(true)
                  }
                }}
                title="检查更新"
                aria-label="检查更新"
              >
                <Badge dot={Boolean(updateInfo?.available) && !downloadingUpdate}>
                  <CloudDownloadOutlined />
                </Badge>
              </Button>
              <Dropdown menu={gitSyncMenu} trigger={['click']}>
                <Button
                  className={`toolbar-icon-btn${gitSyncLastSyncedAt ? ' is-highlighted' : ''}`}
                  type={gitSyncLastSyncedAt ? 'primary' : 'text'}
                  size="small"
                  icon={<CloudSyncOutlined />}
                  loading={gitSyncBusy}
                  title="同步与版本"
                  aria-label="同步与版本"
                />
              </Dropdown>
              <Button
                className="toolbar-icon-btn"
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                loading={healthLoading}
                onClick={() => void checkHealth()}
                title="检查后端服务状态"
                aria-label="检查后端服务状态"
              />
              <Button
                className={`toolbar-icon-btn${aiModuleInstalled && aiPanelOpen ? ' is-highlighted' : ''}`}
                type={aiModuleInstalled && aiPanelOpen ? 'primary' : 'text'}
                size="small"
                icon={<MessageOutlined />}
                onClick={() => {
                  if (!aiModuleInstalled) {
                    openSettings('ai')
                    return
                  }
                  setAiPanelOpen((open) => !open)
                }}
                title={!aiModuleInstalled ? '安装 AI 助手模块' : aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'}
                aria-label={!aiModuleInstalled ? '安装 AI 助手模块' : aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'}
              />
              <Button
                className="theme-toggle-btn"
                type="text"
                size="small"
                icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggleTheme}
                title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
                aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
              />
              {showBackendStatusTag && (
                <Tag
                  className="service-pill"
                  icon={backendStatusIcon}
                  color={BACKEND_COLORS[backendStatus.state]}
                  title={backendStatus.message}
                >
                  {BACKEND_LABELS[backendStatus.state]}
                </Tag>
              )}
            </Space>
            <Space className="window-controls titlebar-no-drag" size={0}>
              <Button
                className="window-control-btn"
                type="text"
                onClick={() => void window.api.minimizeWindow()}
                title="最小化"
                aria-label="最小化"
              >
                <span className="window-glyph window-glyph-minimize" aria-hidden="true" />
              </Button>
              <Button
                className="window-control-btn"
                type="text"
                onClick={() => void window.api.toggleMaximizeWindow()}
                title="最大化"
                aria-label="最大化"
              >
                <span className="window-glyph window-glyph-maximize" aria-hidden="true" />
              </Button>
              <Button
                className="window-control-btn window-control-close"
                type="text"
                danger
                onClick={() => void window.api.closeWindow()}
                title="关闭"
                aria-label="关闭"
              >
                <span className="window-glyph window-glyph-close" aria-hidden="true" />
              </Button>
            </Space>
          </Flex>
        </Layout.Header>
        <Layout.Content className="app-content">
          <div ref={workspaceShellRef} className="workspace">
            <div
              ref={resourcePanelRef}
              className="resource-panel"
              style={{ width: resourcePanelSize, flex: `0 0 ${resourcePanelSize}px` }}
            >
              <div className="resource-header">
                <Space className="resource-header-copy" direction="vertical" size={2}>
                  <Typography.Text className="panel-kicker">DATABASE EXPLORER</Typography.Text>
                  <Typography.Title level={5} className="panel-title">
                    数据资产
                  </Typography.Title>
                </Space>
                <Space className="resource-header-actions" size={8}>
                  <div className="resource-transfer-group" role="group" aria-label="连接导入导出">
                    <Button
                      className="resource-transfer-segment resource-transfer-segment-import resource-import"
                      size="small"
                      onClick={openImportConnectionModal}
                    >
                      导入
                    </Button>
                    <span className="resource-transfer-divider" aria-hidden="true" />
                    <Button
                      className="resource-transfer-segment resource-transfer-segment-export resource-export"
                      size="small"
                      onClick={openExportConnectionModal}
                    >
                      导出
                    </Button>
                  </div>
                  <Dropdown
                    menu={resourceCreateMenu}
                    trigger={['click']}
                    overlayClassName="resource-create-dropdown"
                    {...FAST_PRELOADED_DROPDOWN_PROPS}
                  >
                    <Button
                      className="resource-add"
                      type="primary"
                      size="small"
                      icon={<PlusOutlined />}
                    >
                      新建
                    </Button>
                  </Dropdown>
                </Space>
              </div>
              <div className="connection-summary-strip">
                <span className="summary-pill summary-pill-connections">
                  <strong>{connections.length}</strong>
                  <span className="summary-label">连接</span>
                </span>
                <span className="summary-pill summary-pill-folders">
                  <strong>{connectionFolders.length}</strong>
                  <span className="summary-label">分组</span>
                </span>
                <WorkspaceTabCountBadge />
              </div>
              <ResourceTreePanel
                resourceTreeContainerRef={resourceTreeContainerRef}
                resourceTreeViewportRef={resourceTreeViewportRef}
                resourceTreeRef={resourceTreeRef}
                treeSearchInputRef={treeSearchInputRef}
                connectionsInitialized={connectionsInitialized}
                backendReady={backendReady}
                treeData={treeData}
                itemHeight={RESOURCE_TREE_ITEM_HEIGHT}
                enableVirtualTree={enableVirtualTree}
                resourceTreeHeight={resourceTreeHeight}
                expandedKeys={expandedKeys}
                selectedTreeKeys={selectedTreeKeys}
                selectedConnectionIds={selectedConnectionIds}
                treeSearchOpen={treeSearchOpen}
                treeSearchText={treeSearchText}
                treeSearchMatchCount={treeSearchMatches.length}
                treeSearchMatchIndex={treeSearchMatchIndex}
                setTreeSearchText={setTreeSearchText}
                onPreviousTreeSearchMatch={() => navigateTreeSearchMatch(-1)}
                onNextTreeSearchMatch={() => navigateTreeSearchMatch(1)}
                treeContextMenu={treeContextMenu}
                treeLoadingVersion={treeLoadingVersion}
                treeLoadingKeysRef={treeLoadingKeysRef}
                connectionFolderAssignments={connectionFolderAssignments}
                draggingConnectionIdsRef={draggingConnectionIdsRef}
                draggingConnectionFolderIdRef={draggingConnectionFolderIdRef}
                resourceCreateToolbarItems={resourceTreeToolbarItems}
                getConnection={getConnection}
                getTreeNodeKindFromKey={getTreeNodeKindFromKey}
                folderDropPlaceholderKeyPrefix={FOLDER_DROP_PLACEHOLDER_KEY_PREFIX}
                isTreeNodeChildrenLoaded={isTreeNodeChildrenLoaded}
                isLoadableTreeNode={isLoadableTreeNode}
                allowTreeDrop={allowTreeDrop}
                updateDragOverConnectionTarget={updateDragOverConnectionTarget}
                updateDragOverFolderTarget={updateDragOverFolderTarget}
                clearConnectionDragState={clearConnectionDragState}
                activateAIContextFromNode={activateAIContextFromNode}
                collapseTreeNode={collapseTreeNode}
                reloadNodeChildren={reloadNodeChildren}
                renderTreeTitle={renderTreeTitle}
                handleTreeSelection={handleTreeSelection}
                selectConnectionNodes={selectConnectionNodes}
                setFocusedTreeNode={setFocusedTreeNode}
                setSelectedConnectionId={setSelectedConnectionId}
                setExpandedKeys={setExpandedKeys}
                setSelectedTreeKeys={setSelectedTreeKeys}
                setTreeContextMenu={setTreeContextMenu}
                getTreeContextMenuItems={getTreeContextMenuItems}
                handleTreeContextMenuClick={handleTreeContextMenuClick}
                handleTreeDrop={handleTreeDrop}
                toggleOrLoadTreeNode={toggleOrLoadTreeNode}
                openConnectionById={openConnectionById}
                openRedisDatabaseBrowser={openRedisDatabaseBrowser}
                getDefaultDatabaseName={getDefaultDatabaseName}
                previewTable={previewTable}
                previewDefaultLimit={PREVIEW_DEFAULT_LIMIT}
                copyTreeNodeNames={copyTreeNodeNames}
              />
            </div>
            <div
              className={`workspace-side-resizer${resizingResourcePanel ? ' active' : ''}`}
              onMouseDown={(event) => {
                resourcePanelResizeRef.current = {
                  startX: event.clientX,
                  startSize: resourcePanelSize
                }
                setResizingResourcePanel(true)
              }}
            />
            <MainWorkspacePanel
              mainPanelRef={mainPanelRef}
              aiDockPanelRef={aiDockPanelRef}
              theme={theme}
              aiPanelOpen={aiPanelVisible}
              aiPanelSize={aiPanelSize}
              resizingAiPanel={resizingAiPanel}
              resizingResourcePanel={resizingResourcePanel}
              renderWorkspaceTab={stableRenderWorkspaceTab}
              workspaceRenderVersionToken={workspaceRenderVersionToken}
              onActiveTabChange={handleActiveWorkspaceTabChange}
              onCloseTab={closeWorkspaceTab}
              onRenameTab={renameWorkspaceTab}
              openImportConnectionModal={openImportConnectionModal}
              connectionCreateMenuItems={stableConnectionCreateMenuItems}
              onConnectionCreateMenuClick={stableConnectionCreateMenuHandler}
              onAiPanelResizeMouseDown={handleAiPanelResizeMouseDown}
              aiPanelContent={aiPanelContent}
            />
          </div>
        </Layout.Content>
        <ImperativeModalHost
          ref={updateModalRef}
          title="应用更新"
          footer={null}
          width={760}
          className="update-window-modal"
          maskClosable={false}
          deferContentMount
        >
          {(contentReady) =>
            contentReady ? (
              <Space direction="vertical" className="full-width update-modal-layout" size="middle">
                <Alert
                  className="update-status-alert"
                  type={updateInfo?.available ? 'info' : 'success'}
                  showIcon
                  message={updateStatusMessage}
                  description={
                    updateMode === 'installer'
                      ? '安装版支持自动下载，并在重启后安装更新。'
                      : '绿色版支持检测并下载新版 zip，下载后需要关闭应用并手动解压替换。'
                  }
                />
                <Flex justify="space-between" align="center" className="update-meta-strip">
                  <Typography.Text>
                    当前版本：{updateSettings?.currentVersion ?? updateInfo?.currentVersion ?? '-'}
                  </Typography.Text>
                  <Tag color={updateMode === 'installer' ? 'blue' : 'purple'}>
                    {updateMode === 'installer' ? '安装版' : '绿色版'}
                  </Tag>
                </Flex>
                {updateInfo?.latestVersion && (
                  <Typography.Text className="update-version-line">
                    最新版本：{updateInfo.latestVersion}
                  </Typography.Text>
                )}
                <Flex justify="space-between" align="center" className="update-toggle-card">
                  <Typography.Text>启动时自动检查更新</Typography.Text>
                  <Switch
                    className="update-auto-check-switch"
                    checked={updateSettings?.autoCheckUpdates ?? true}
                    onChange={(checked) =>
                      void window.api.setAutoCheckUpdates(checked).then(refreshUpdateSettings)
                    }
                  />
                </Flex>
                {updateInfo?.releaseNotes && (
                  <div
                    className="update-release-notes ai-markdown"
                    dangerouslySetInnerHTML={renderMarkdown(updateInfo.releaseNotes)}
                  />
                )}
                {updateProgress && (
                  <Progress
                    percent={updateProgress.percent}
                    status={updateProgress.percent >= 100 ? 'success' : 'active'}
                  />
                )}
                {updateInfo?.downloadedPath && (
                  <Alert
                    className="update-status-alert"
                    type="success"
                    showIcon
                    message="绿色版更新包已下载"
                    description={`文件位置：${updateInfo.downloadedPath}。请关闭应用后手动解压替换旧目录。`}
                  />
                )}
                <Flex justify="end" gap={8} wrap="wrap" className="update-modal-actions">
                  <Button onClick={() => void checkForUpdates(true)} loading={checkingUpdate}>
                    重新检查
                  </Button>
                  {updateInfo?.releaseUrl && (
                    <Button onClick={() => void window.api.openReleasePage(updateInfo.releaseUrl)}>
                      查看发布页
                    </Button>
                  )}
                  {updateInfo?.available && (
                    <Button onClick={() => void skipUpdate()}>跳过此版本</Button>
                  )}
                  {updateInfo?.available && !updateDownloaded && (
                    <Button
                      type="primary"
                      loading={downloadingUpdate}
                      onClick={() => void downloadUpdate()}
                    >
                      {updateActionText}
                    </Button>
                  )}
                  {updateDownloaded && (
                    <Button type="primary" onClick={() => void installUpdate()}>
                      {updateMode === 'installer' ? '重启并安装' : '打开下载位置'}
                    </Button>
                  )}
                </Flex>
              </Space>
            ) : (
              <div className="deferred-modal-loading">
                <LoadingOutlined spin />
              </div>
            )
          }
        </ImperativeModalHost>
        <ImperativeModalHost
          ref={queryHistoryModalRef}
          title="历史查询窗口"
          footer={null}
          width={940}
          className="query-history-window-modal"
          deferContentMount
        >
          {(contentReady) =>
            contentReady ? (
              <div className="query-history-modal">
                <div className="query-history-summary-card">
                  <div className="query-history-summary-icon">
                    <HistoryOutlined />
                  </div>
                  <div className="query-history-summary-copy">
                    <div className="query-history-summary-title">双击恢复查询窗口</div>
                    <div className="query-history-summary-meta">
                      共 {persistedQueryWorkspaces.length}{' '}
                      个历史查询，按连接分组展示，删除操作会先二次确认。
                    </div>
                  </div>
                </div>
                {queryHistoryGroups.length ? (
                  queryHistoryGroups.map(({ groupName, items, latestPersistedAt }) => (
                    <div key={groupName} className="query-history-group">
                      <div className="query-history-group-header">
                        <div className="query-history-group-title-wrap">
                          <div className="query-history-group-title">{groupName}</div>
                          <div className="query-history-group-meta">
                            最近保存于 {formatQueryHistoryTime(latestPersistedAt)}
                          </div>
                        </div>
                        <div className="query-history-group-count">{items.length}</div>
                      </div>
                      <div className="query-history-group-list">
                        {items.map((item) => (
                          <div
                            key={item.key}
                            className="query-history-item"
                            onDoubleClick={() => {
                              openPersistedQueryWorkspace(item)
                              queryHistoryModalRef.current?.close()
                            }}
                          >
                            <div className="query-history-item-main">
                              <div className="query-history-item-head">
                                <div className="query-history-item-title">{item.title}</div>
                                <div className="query-history-item-time">
                                  {formatQueryHistoryTime(item.persistedAt)}
                                </div>
                              </div>
                              <div className="query-history-item-meta">
                                {[item.pgDatabaseName, item.databaseName]
                                  .filter(Boolean)
                                  .join('.') || '未选择库'}
                              </div>
                              <div className="query-history-item-sql">
                                {getQueryHistoryPreviewText(item.sql)}
                              </div>
                            </div>
                            <Button
                              type="text"
                              size="small"
                              danger
                              className="query-history-item-delete"
                              icon={<DeleteOutlined />}
                              onClick={(event) => {
                                event.stopPropagation()
                                confirmRemovePersistedQueryWorkspace(item)
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="query-history-empty">
                    <div className="query-history-empty-title">还没有历史查询</div>
                    <div className="query-history-empty-meta">
                      新建查询窗口后会自动保存到这里，后续可以双击直接恢复。
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="deferred-modal-loading">
                <LoadingOutlined spin />
              </div>
            )
          }
        </ImperativeModalHost>
        <ConnectionExportModal
          open={exportConnectionModalOpen}
          secret={exportConnectionSecret}
          secretConfirm={exportConnectionSecretConfirm}
          exporting={exportingConnections}
          onClose={closeExportConnectionModal}
          onSecretChange={setExportConnectionSecret}
          onSecretConfirmChange={setExportConnectionSecretConfirm}
          onExport={() => void exportAllConnections()}
        />
        <ConnectionImportModal
          open={importConnectionModalOpen}
          source={importConnectionSource}
          rawText={importConnectionRawText}
          filePath={importConnectionFilePath}
          secret={importConnectionSecret}
          parsing={importConnectionParsing}
          importing={importingConnections}
          candidates={importConnectionCandidates}
          previewColumns={importConnectionPreviewColumns}
          onClose={closeImportConnectionModal}
          onSourceChange={(source) => {
            setImportConnectionSource(source)
            setImportConnectionRawText('')
            setImportConnectionFilePath('')
            setImportConnectionSecret('')
            setImportConnectionCandidates([])
            setImportConnectionFolderPlan(null)
            setImportConnectionBundle(null)
          }}
          onRawTextChange={setImportConnectionRawText}
          onSecretChange={setImportConnectionSecret}
          onChooseFile={() => void chooseImportConnectionTransferFile()}
          onParse={parseImportConnections}
          onImport={() => void importParsedConnections()}
        />
        <ConnectionImportResultModal
          open={importConnectionResultOpen}
          result={importConnectionResult}
          onClose={closeImportConnectionResultModal}
        />
        <ConnectionPasswordPromptModal
          open={connectionPasswordPromptOpen}
          connectionName={connectionPasswordPromptConnectionName}
          reason={connectionPasswordPromptReason}
          password={connectionPasswordDraft}
          onClose={closeConnectionPasswordPrompt}
          onPasswordChange={setConnectionPasswordDraft}
          onRetry={() => void submitConnectionPasswordPrompt()}
        />
        <ConnectionVersionManagementModal
          open={schemaVersionModalOpen}
          connectionName={getConnection(schemaVersionConnectionId)?.name ?? '连接'}
          connectionId={schemaVersionConnectionId}
          onClose={closeSchemaVersionModal}
          gitHubAuthStatus={gitHubAuthStatus}
          onOpenSyncSettings={() => {
            closeSchemaVersionModal()
            openSettings('sync')
          }}
          onOpenRepository={() => {
            if (gitHubAuthStatus.repository_url) {
              void window.api.openExternalUrl(gitHubAuthStatus.repository_url)
            } else {
              openSettings('sync')
            }
          }}
          schemaVersions={schemaVersions}
          databaseBaselineExists={databaseBaselineExists}
          schemaVersionsLoading={schemaVersionsLoading}
          schemaSnapshotCreating={schemaSnapshotCreating}
          snapshotTask={gitSnapshotTask}
          onLoadSchemaVersions={(connectionId) => void loadSchemaVersions(connectionId)}
          onCreateSchemaSnapshot={(connectionId) => void createSchemaSnapshot(connectionId)}
          onViewSchemaVersion={viewSchemaVersion}
          versioningScopeConfig={versioningScopeConfig}
          versioningScopesLoading={versioningScopesLoading}
          versioningScopesSaving={versioningScopesSaving}
          versioningScopeDraft={versioningScopeDraft}
          versioningScopeLabel={versioningScopeLabel}
          hasConfiguredVersioningScope={hasConfiguredVersioningScope}
          onVersioningScopeDraftChange={setVersioningScopeDraft}
          onSaveVersioningScopes={(connectionId) => void saveVersioningScopes(connectionId)}
        />
        <Modal
          open={Boolean(tableGitHistoryTarget)}
          title={tableGitHistoryTarget ? `${tableGitHistoryTarget.tableName} · Git 提交记录` : 'Git 提交记录'}
          footer={null}
          onCancel={() => setTableGitHistoryTarget(undefined)}
          width={760}
          {...FAST_MODAL_PROPS}
        >
          {tableGitHistoryLoading ? (
            <Flex justify="center" className="deferred-modal-loading"><Spin /></Flex>
          ) : tableGitHistory.length === 0 ? (
            <Space direction="vertical">
              <Typography.Text type="secondary">该表还没有数据库快照提交记录。请先在“版本管理”中创建一次初始快照，之后表数据和结构变更会自动提交。</Typography.Text>
              {tableGitHistoryTarget ? (
                <Button type="primary" onClick={() => {
                  const connectionId = tableGitHistoryTarget.connectionId
                  setTableGitHistoryTarget(undefined)
                  void openSchemaVersionModal(connectionId)
                }}>
                  前往创建初始快照
                </Button>
              ) : null}
            </Space>
          ) : (
            <Space direction="vertical" className="full-width">
              {tableGitHistory.map((version) => (
                <div key={version.id} className="schema-versioning-entry">
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{version.message}</Typography.Text>
                    <Typography.Text type="secondary">
                      {version.id.slice(0, 7)}{version.committed_at ? ` · ${new Date(version.committed_at).toLocaleString()}` : ''}
                    </Typography.Text>
                  </Space>
                  <Space size={4}>
                    <Button size="small" loading={tableGitActionVersion === version.id} onClick={() => void openTableGitDetails(version)}>SQL</Button>
                    <Button size="small" loading={tableGitActionVersion === version.id} onClick={() => void openTableGitDiff(version)}>差异</Button>
                    <Button size="small" danger loading={tableGitActionVersion === version.id} onClick={() => void restoreTableGitStructure(version)}>恢复结构</Button>
                    <Button size="small" danger loading={tableGitActionVersion === version.id} onClick={() => void restoreTableGitVersion(version)}>恢复数据</Button>
                  </Space>
                </div>
              ))}
            </Space>
          )}
        </Modal>
        <Modal
          open={Boolean(tableGitDetails)}
          title={tableGitDetails?.title}
          footer={null}
          width={900}
          onCancel={() => setTableGitDetails(undefined)}
          {...FAST_MODAL_PROPS}
        >
          {tableGitDetails?.diff ? (
            <Space direction="vertical" className="full-width">
              <Typography.Text>新增：{tableGitDetails.diff.added_count} 行</Typography.Text>
              <Typography.Text>修改：{tableGitDetails.diff.updated_count} 行</Typography.Text>
              <Typography.Text>删除：{tableGitDetails.diff.deleted_count} 行</Typography.Text>
            </Space>
          ) : (
            <pre className="git-change-sql-preview">{tableGitDetails?.sql}</pre>
          )}
        </Modal>
        <ImperativeModalHost
          ref={settingsModalRef}
          title="设置"
          footer={null}
          width={1180}
          className="settings-window-modal"
          maskClosable={false}
          deferContentMount
        >
          {(contentReady) =>
            contentReady ? (
              <Flex gap={18} align="stretch" className="settings-layout">
                <div className="settings-sidebar">
                  <Menu
                    mode="inline"
                    selectedKeys={[settingsSection]}
                    onClick={({ key }) => switchSettingsSection(key as SettingsSection)}
                    items={[
                      { key: 'app', icon: <SettingOutlined />, label: '应用' },
                      { key: 'sql', icon: <PlayCircleOutlined />, label: 'SQL' },
                      { key: 'shortcuts', icon: <ThunderboltOutlined />, label: '快捷键' },
                      { key: 'sync', icon: <GithubOutlined />, label: '同步与版本' },
                      { key: 'extensions', icon: <AppstoreOutlined />, label: '扩展' },
                      { key: 'ai', icon: <RobotOutlined />, label: 'AI' },
                      { key: 'mcp', icon: <RobotOutlined />, label: 'MCP' },
                      { key: 'drivers', icon: <DatabaseOutlined />, label: '驱动管理' }
                    ]}
                  />
                </div>
                <div className="settings-content">
                  {settingsSection === 'app' ? (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="large"
                    >
                      <div className="settings-about-card">
                        <img
                          className="settings-about-logo"
                          src={appLogoHorizontal}
                          alt="DataDjinn"
                        />
                        <Typography.Text type="secondary">
                          当前版本：{appInfo?.version ?? updateSettings?.currentVersion ?? '-'}
                        </Typography.Text>
                      </div>
                      <Button
                        className="settings-glass-action"
                        icon={<GithubOutlined />}
                        onClick={() => void window.api.openProjectHome()}
                      >
                        GitHub
                      </Button>
                    </Space>
                  ) : settingsSection === 'sql' ? (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="large"
                    >
                      <div className="settings-section-card">
                        <Typography.Title level={5} style={{ marginTop: 0 }}>
                          SQL 超时
                        </Typography.Title>
                        <Typography.Text type="secondary">
                          单条 SQL 最长执行时间。超时后会中断当前执行，默认 15 分钟。
                        </Typography.Text>
                        <InputNumber
                          min={1}
                          max={120}
                          precision={0}
                          value={querySettings.timeoutMinutes}
                          addonAfter="分钟"
                          onChange={(value) => void updateQueryTimeoutMinutes(value)}
                        />
                      </div>
                    </Space>
                  ) : settingsSection === 'ai' ? (
                    <AISettingsPanel
                      installed={aiModuleInstalled}
                      installing={installingOptionalModuleId === 'ai'}
                      onInstall={() => void installOptionalModule('ai')}
                    />
                  ) : settingsSection === 'sync' ? (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="large"
                    >
                      <div className="settings-section-card">
                        <Flex justify="space-between" align="flex-start" gap="middle">
                          <Space direction="vertical" size={4}>
                            <Typography.Title level={5} style={{ margin: 0 }}>
                              GitHub 授权
                            </Typography.Title>
                            <Typography.Text type="secondary">
                              授权后，DataDjinn 才能为应用设置、连接信息和已启用版本管理的连接建立私有同步存储。
                            </Typography.Text>
                          </Space>
                          <Tag color={gitHubAuthStatus.authorized ? 'success' : 'default'}>
                            {gitHubAuthStatus.authorized ? '已授权' : '未授权'}
                          </Tag>
                        </Flex>
                        {gitHubAuthStatus.authorized ? (
                          <Flex justify="space-between" align="center" gap="middle">
                            <Space size={10}>
                              <Avatar
                                className="git-sync-avatar"
                                src={gitHubAuthStatus.avatar_url ?? undefined}
                                icon={<GithubOutlined />}
                                alt="GitHub"
                              />
                              <Typography.Text strong>
                                {gitHubAuthStatus.name || gitHubAuthStatus.login}
                              </Typography.Text>
                              {gitHubAuthStatus.name && gitHubAuthStatus.login && (
                                <Typography.Text type="secondary">
                                  @{gitHubAuthStatus.login}
                                </Typography.Text>
                              )}
                            </Space>
                            <Button danger onClick={() => void signOutGitHub()}>
                              退出授权
                            </Button>
                          </Flex>
                        ) : (
                          <Button
                            type="primary"
                            icon={<GithubOutlined />}
                            loading={gitHubAuthorizationPending}
                            onClick={() => void startGitHubAuthorization()}
                          >
                            {gitHubAuthorizationPending ? '等待浏览器授权' : '登录 GitHub'}
                          </Button>
                        )}
                        {gitHubAuthorizationPending && gitHubDeviceAuthorization && (
                          <Alert
                            type="info"
                            showIcon
                            message="正在等待 GitHub 浏览器授权"
                            description={
                              <Space direction="vertical" size={4}>
                                <Typography.Text>
                                  请在浏览器中输入验证码：
                                  <Typography.Text
                                    code
                                    copyable={{ text: gitHubDeviceAuthorization.user_code }}
                                  >
                                    {gitHubDeviceAuthorization.user_code}
                                  </Typography.Text>
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  授权完成后此处会自动更新；验证码有效期内可重复提交。
                                </Typography.Text>
                              </Space>
                            }
                          />
                        )}
                        {gitHubAuthStatus.authorized && (
                          <Flex justify="space-between" align="center" gap="middle">
                            <Typography.Text type="secondary">
                              {gitHubAuthStatus.repository_full_name
                                ? `私有同步仓库：${gitHubAuthStatus.repository_full_name}`
                                : '尚未创建私有同步仓库'}
                            </Typography.Text>
                            {gitHubAuthStatus.repository_full_name ? (
                              <Button
                                onClick={() => {
                                  if (gitHubAuthStatus.repository_url) {
                                    void window.api.openExternalUrl(gitHubAuthStatus.repository_url)
                                  }
                                }}
                              >
                                查看仓库
                              </Button>
                            ) : (
                              <Button type="primary" onClick={() => void initializeGitHubSyncRepository()}>
                                初始化私有同步仓库
                              </Button>
                            )}
                          </Flex>
                        )}
                      </div>
                      <div className="settings-section-card">
                        <Flex justify="space-between" align="flex-start" gap="middle">
                          <Space direction="vertical" size={4}>
                            <Typography.Title level={5} style={{ margin: 0 }}>
                              加密同步
                            </Typography.Title>
                              <Typography.Text type="secondary">
                                同步内容使用独立口令加密后保存到私有仓库。口令仅使用本机系统加密保存，不会上传到 GitHub。
                              </Typography.Text>
                          </Space>
                          <Tag color={gitSyncLastSyncedAt ? 'success' : 'default'}>
                            {gitSyncLastSyncedAt ? '已建立同步基线' : '尚未同步'}
                          </Tag>
                        </Flex>
                        <Space direction="vertical" className="full-width" size="middle">
                          {!gitSyncLastSyncedAt ? (
                            <>
                              {gitSyncRemoteExists && (
                                <Typography.Text type="secondary">
                                  已发现其他设备的远端同步数据，请输入原设备使用的同步口令，验证后会自动拉取并合并。
                                </Typography.Text>
                              )}
                              <Input.Password
                                value={gitSyncPassphrase}
                                autoComplete="new-password"
                                placeholder={
                                  gitSyncRemoteExists
                                    ? '已有同步口令，至少 8 个字符'
                                    : '同步口令，至少 8 个字符'
                                }
                                onChange={(event) => setGitSyncPassphrase(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Tab' && !event.shiftKey) {
                                    event.preventDefault()
                                    gitSyncPassphraseConfirmInputRef.current?.input?.focus()
                                  }
                                }}
                              />
                              {!gitSyncRemoteExists && (
                                <Input.Password
                                  ref={gitSyncPassphraseConfirmInputRef}
                                  value={gitSyncPassphraseConfirm}
                                  autoComplete="new-password"
                                  placeholder="再次输入同步口令"
                                  onChange={(event) => setGitSyncPassphraseConfirm(event.target.value)}
                                />
                              )}
                            </>
                          ) : changingGitSyncPassphrase ? (
                            <>
                              <Input.Password
                                value={currentGitSyncPassphrase}
                                autoComplete="current-password"
                                placeholder="当前同步口令"
                                onChange={(event) => setCurrentGitSyncPassphrase(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Tab' && !event.shiftKey) {
                                    event.preventDefault()
                                    nextGitSyncPassphraseInputRef.current?.input?.focus()
                                  }
                                }}
                              />
                              <Input.Password
                                ref={nextGitSyncPassphraseInputRef}
                                value={nextGitSyncPassphrase}
                                autoComplete="new-password"
                                placeholder="新同步口令，至少 8 个字符"
                                onChange={(event) => setNextGitSyncPassphrase(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Tab' && !event.shiftKey) {
                                    event.preventDefault()
                                    nextGitSyncPassphraseConfirmInputRef.current?.input?.focus()
                                  }
                                }}
                              />
                              <Input.Password
                                ref={nextGitSyncPassphraseConfirmInputRef}
                                value={nextGitSyncPassphraseConfirm}
                                autoComplete="new-password"
                                placeholder="再次输入新同步口令"
                                onChange={(event) => setNextGitSyncPassphraseConfirm(event.target.value)}
                              />
                              <Flex justify="end" gap={8}>
                                <Button
                                  disabled={gitSyncBusy}
                                  onClick={() => {
                                    setChangingGitSyncPassphrase(false)
                                    setCurrentGitSyncPassphrase('')
                                    setNextGitSyncPassphrase('')
                                    setNextGitSyncPassphraseConfirm('')
                                  }}
                                >
                                  取消
                                </Button>
                                <Button
                                  type="primary"
                                  loading={gitSyncBusy}
                                  onClick={() => void changeGitSyncPassphrase()}
                                >
                                  确认修改
                                </Button>
                              </Flex>
                            </>
                          ) : (
                            <Flex justify="space-between" align="center" gap="middle" className="sync-passphrase-ready">
                              <Typography.Text type="secondary">
                                同步口令已使用本机系统加密保存。修改后会使用新口令重新加密远端同步内容。
                              </Typography.Text>
                              <Button onClick={() => setChangingGitSyncPassphrase(true)}>修改同步口令</Button>
                            </Flex>
                          )}
                          <Flex justify="space-between" align="center" gap="middle">
                            <Typography.Text type="secondary">
                                {gitSyncLastSyncedAt
                                  ? `上次同步：${new Date(gitSyncLastSyncedAt).toLocaleString()}`
                                  : gitSyncRemoteExists
                                    ? '请输入原设备的同步口令后开始同步。'
                                    : '首次同步将自动创建私有仓库和加密同步基线。'}
                            </Typography.Text>
                            <Button
                              type="primary"
                              icon={<CloudSyncOutlined />}
                              loading={gitSyncBusy}
                              disabled={!gitHubAuthStatus.authorized}
                              onClick={() => void startGitSync()}
                            >
                              {gitSyncRemoteExists && !gitSyncLastSyncedAt
                                ? '验证口令并同步'
                                : '立即同步'}
                            </Button>
                          </Flex>
                          <Flex justify="space-between" align="center" gap="middle" className="sync-auto-card">
                            <Space direction="vertical" size={0}>
                              <Typography.Text>自动同步</Typography.Text>
                              <Typography.Text type="secondary">
                                {gitHubAuthStatus.authorized && gitSyncLastSyncedAt
                                  ? '每 15 分钟在后台同步一次；发生冲突时仍需你手动选择保留内容。'
                                  : '完成 GitHub 授权和首次同步后可启用。'}
                              </Typography.Text>
                            </Space>
                            <Switch
                              checked={gitSyncAutoEnabled}
                              disabled={!gitHubAuthStatus.authorized || !gitSyncLastSyncedAt}
                              aria-label="自动同步"
                              onChange={(enabled) => void setGitSyncAutoSyncEnabled(enabled)}
                            />
                          </Flex>
                        </Space>
                      </div>
                    </Space>
                  ) : settingsSection === 'extensions' ? (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="large"
                    >
                      {optionalModules.map((module) => (
                        <div className="settings-section-card" key={module.id}>
                          <Flex justify="space-between" align="flex-start" gap="middle">
                            <Space direction="vertical" size={4}>
                              <Typography.Title level={5} style={{ margin: 0 }}>
                                {module.name}
                              </Typography.Title>
                              <Typography.Text type="secondary" className="optional-module-description">
                                {module.description}
                              </Typography.Text>
                              <Space className="optional-module-meta" size={10} wrap>
                                <Typography.Text className="optional-module-property">
                                  版本 <strong>{module.version}</strong>
                                </Typography.Text>
                                {module.installedVersion && module.installedVersion !== module.version && (
                                  <Typography.Text className="optional-module-property">
                                    已安装版本 <strong>{module.installedVersion}</strong>
                                  </Typography.Text>
                                )}
                                {module.installedAt && (
                                  <Typography.Text className="optional-module-property">
                                    安装时间 <strong>{new Date(module.installedAt).toLocaleString()}</strong>
                                  </Typography.Text>
                                )}
                                {module.pendingRestartRequired && (
                                  <Typography.Text type="warning" className="optional-module-property">
                                    已下载版本 <strong>{module.pendingVersion ?? module.version}</strong>，重启 MCP 调用方后生效
                                  </Typography.Text>
                                )}
                              </Space>
                            </Space>
                            <Space>
                              <Tag
                                className="optional-module-status"
                                color={
                                  module.pendingRestartRequired
                                    ? 'warning'
                                    : module.updateAvailable
                                    ? 'processing'
                                    : module.installed
                                    ? 'success'
                                    : installingOptionalModuleId === module.id
                                      ? 'processing'
                                      : 'default'
                                }
                              >
                                {module.installed
                                  ? module.pendingRestartRequired
                                    ? '待重启生效'
                                    : module.updateAvailable
                                    ? '有更新'
                                    : '已安装'
                                  : installingOptionalModuleId === module.id
                                    ? '安装中'
                                    : '未安装'}
                              </Tag>
                              {module.installed ? (
                                <Space>
                                  {module.updateAvailable && !module.pendingRestartRequired && (
                                    <Button
                                      type="primary"
                                      className="optional-module-update-btn"
                                      loading={installingOptionalModuleId === module.id}
                                      disabled={installingOptionalModuleId !== null}
                                      onClick={() => void installOptionalModule(module.id)}
                                    >
                                      {installingOptionalModuleId === module.id ? '更新中' : '更新'}
                                    </Button>
                                  )}
                                  <Button
                                    danger
                                    className="optional-module-uninstall-btn"
                                    onClick={() => void uninstallOptionalModule(module.id)}
                                  >
                                    卸载
                                  </Button>
                                </Space>
                              ) : (
                                <Button
                                  type="primary"
                                  className="optional-module-install-btn"
                                  loading={installingOptionalModuleId === module.id}
                                  disabled={installingOptionalModuleId !== null}
                                  onClick={() => void installOptionalModule(module.id)}
                                >
                                  {installingOptionalModuleId === module.id ? '安装中' : '安装'}
                                </Button>
                              )}
                            </Space>
                          </Flex>
                        </div>
                      ))}
                    </Space>
                  ) : settingsSection === 'mcp' ? (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="large"
                    >
                      <div className="settings-section-card mcp-settings-card">
                        <Typography.Title level={5} style={{ marginTop: 0 }}>
                          本机 MCP 服务
                        </Typography.Title>
                        <Typography.Text type="secondary">
                          启用后，已配置的本机 Agent 工具才能访问 DataDjinn 保存的连接。服务不监听网络端口，关闭后会立即拒绝所有 MCP 请求。
                        </Typography.Text>
                        {!mcpModuleInstalled && (
                          <Alert
                            type="warning"
                            showIcon
                            message="本机 MCP 服务模块尚未安装"
                            description="请先在“设置 -> 扩展”中安装模块，再授权 MCP 访问连接。"
                            action={
                              <Button
                                type="primary"
                                size="small"
                                loading={installingOptionalModuleId === 'mcp'}
                                disabled={installingOptionalModuleId !== null}
                                onClick={() => void installOptionalModule('mcp')}
                              >
                                {installingOptionalModuleId === 'mcp' ? '安装中' : '安装模块'}
                              </Button>
                            }
                          />
                        )}
                        {mcpModuleInstalled && mcpLaunchConfig && (
                          <Space direction="vertical" className="full-width" size={8}>
                            <Typography.Text strong>客户端配置</Typography.Text>
                            <Typography.Text type="secondary">
                              在 Agent 工具中新增 STDIO MCP 服务，命令无需参数，连接配置会由模块自动读取。
                            </Typography.Text>
                            <Flex gap={8} className="full-width">
                              <Input
                                className="mcp-launch-command"
                                value={mcpLaunchConfig.command}
                                readOnly
                                aria-label="MCP 启动命令"
                              />
                              <Button
                                icon={<CopyOutlined />}
                                aria-label="复制 MCP 启动命令"
                                onClick={() => {
                                  void navigator.clipboard
                                    .writeText(mcpLaunchConfig.command)
                                    .then(() => messageApi.success('MCP 启动命令已复制'))
                                    .catch((error) => showError(error instanceof Error ? error.message : '复制失败'))
                                }}
                              />
                            </Flex>
                            <Typography.Text type="secondary">命令参数：无</Typography.Text>
                          </Space>
                        )}
                        <Flex justify="space-between" align="center" gap="middle">
                          <Space direction="vertical" size={0}>
                            <Typography.Text>启用本机 MCP 服务</Typography.Text>
                            <Typography.Text type="secondary">
                              默认关闭，需要在此处明确授权。
                            </Typography.Text>
                          </Space>
                          <Switch
                            checked={mcpSettings.enabled}
                            disabled={!mcpModuleInstalled}
                            onChange={(enabled) => void updateMcpSettings({ enabled })}
                          />
                        </Flex>
                        <Flex justify="space-between" align="center" gap="middle">
                          <Space direction="vertical" size={0}>
                            <Typography.Text>允许 MCP 执行写操作</Typography.Text>
                            <Typography.Text type="secondary">
                              默认只读。开启后，Agent 仍须在单次调用中显式确认写入。
                            </Typography.Text>
                          </Space>
                          <Switch
                            checked={mcpSettings.allowWrite}
                            disabled={!mcpModuleInstalled || !mcpSettings.enabled}
                            onChange={(allowWrite) => void updateMcpSettings({ allowWrite })}
                          />
                        </Flex>
                        <Flex justify="space-between" align="center" gap="middle">
                          <Space direction="vertical" size={0}>
                            <Typography.Text>限制允许访问的连接</Typography.Text>
                            <Typography.Text type="secondary">
                              开启后，只有下方选中的连接会向 MCP 提供。
                            </Typography.Text>
                          </Space>
                          <Switch
                            checked={mcpSettings.restrictConnections}
                            disabled={!mcpModuleInstalled || !mcpSettings.enabled}
                            onChange={(restrictConnections) =>
                              void updateMcpSettings({ restrictConnections })
                            }
                          />
                        </Flex>
                        {mcpSettings.restrictConnections && (
                          <Select
                            mode="multiple"
                            className="full-width"
                            disabled={!mcpModuleInstalled || !mcpSettings.enabled}
                            value={mcpSettings.allowedConnectionIds}
                            placeholder="请选择允许 MCP 访问的连接"
                            options={connections.map((connection) => ({
                              value: connection.connection_id,
                              label: `${connection.name} (${DATABASE_TYPE_LABELS[connection.database_type] ?? connection.database_type})`
                            }))}
                            onChange={(allowedConnectionIds: string[]) =>
                              void updateMcpSettings({ allowedConnectionIds })
                            }
                          />
                        )}
                      </div>
                    </Space>
                  ) : settingsSection === 'shortcuts' ? (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="large"
                    >
                      <div className="settings-section-card settings-shortcut-card">
                        <Typography.Title level={5} style={{ marginTop: 0 }}>
                          SQL 编辑器
                        </Typography.Title>
                        <Space direction="vertical" className="full-width" size="middle">
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.sql_execute}
                            value={shortcutSettings.sql_execute}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.sql_execute}
                            recording={recordingShortcutAction === 'sql_execute'}
                            onStartRecord={() => setRecordingShortcutAction('sql_execute')}
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({ ...current, sql_execute: value }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                sql_execute: DEFAULT_SHORTCUT_SETTINGS.sql_execute
                              }))
                            }
                          />
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.sql_delete_line}
                            value={shortcutSettings.sql_delete_line}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.sql_delete_line}
                            recording={recordingShortcutAction === 'sql_delete_line'}
                            onStartRecord={() => setRecordingShortcutAction('sql_delete_line')}
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({
                                ...current,
                                sql_delete_line: value
                              }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                sql_delete_line: DEFAULT_SHORTCUT_SETTINGS.sql_delete_line
                              }))
                            }
                          />
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.sql_duplicate_line_down}
                            value={shortcutSettings.sql_duplicate_line_down}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.sql_duplicate_line_down}
                            recording={recordingShortcutAction === 'sql_duplicate_line_down'}
                            onStartRecord={() =>
                              setRecordingShortcutAction('sql_duplicate_line_down')
                            }
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({
                                ...current,
                                sql_duplicate_line_down: value
                              }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                sql_duplicate_line_down:
                                  DEFAULT_SHORTCUT_SETTINGS.sql_duplicate_line_down
                              }))
                            }
                          />
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.table_search}
                            value={shortcutSettings.table_search}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.table_search}
                            recording={recordingShortcutAction === 'table_search'}
                            onStartRecord={() => setRecordingShortcutAction('table_search')}
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({
                                ...current,
                                table_search: value
                              }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                table_search: DEFAULT_SHORTCUT_SETTINGS.table_search
                              }))
                            }
                          />
                        </Space>
                      </div>
                      <div className="settings-section-card settings-shortcut-card">
                        <Typography.Title level={5} style={{ marginTop: 0 }}>
                          AI 窗口
                        </Typography.Title>
                        <Space direction="vertical" className="full-width" size="middle">
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.ai_send}
                            value={shortcutSettings.ai_send}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.ai_send}
                            recording={recordingShortcutAction === 'ai_send'}
                            onStartRecord={() => setRecordingShortcutAction('ai_send')}
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({ ...current, ai_send: value }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                ai_send: DEFAULT_SHORTCUT_SETTINGS.ai_send
                              }))
                            }
                          />
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.ai_newline}
                            value={shortcutSettings.ai_newline}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.ai_newline}
                            recording={recordingShortcutAction === 'ai_newline'}
                            onStartRecord={() => setRecordingShortcutAction('ai_newline')}
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({ ...current, ai_newline: value }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                ai_newline: DEFAULT_SHORTCUT_SETTINGS.ai_newline
                              }))
                            }
                          />
                          <ShortcutRecorder
                            label={SHORTCUT_SETTING_LABELS.ai_stop}
                            value={shortcutSettings.ai_stop}
                            defaultValue={DEFAULT_SHORTCUT_SETTINGS.ai_stop}
                            recording={recordingShortcutAction === 'ai_stop'}
                            onStartRecord={() => setRecordingShortcutAction('ai_stop')}
                            onCancel={() => setRecordingShortcutAction(null)}
                            onChange={(value) => {
                              setShortcutSettings((current) => ({ ...current, ai_stop: value }))
                              setRecordingShortcutAction(null)
                            }}
                            onReset={() =>
                              setShortcutSettings((current) => ({
                                ...current,
                                ai_stop: DEFAULT_SHORTCUT_SETTINGS.ai_stop
                              }))
                            }
                          />
                        </Space>
                      </div>
                    </Space>
                  ) : (
                    <Space
                      direction="vertical"
                      className="full-width settings-section-stack"
                      size="middle"
                    >
                      <Space
                        direction="vertical"
                        className="full-width settings-section-card settings-jdbc-card"
                        size="small"
                      >
                        <Typography.Title level={5} style={{ margin: 0 }}>
                          全局 JDBC Java 环境
                        </Typography.Title>
                        {!jdbcModuleInstalled && (
                          <Alert
                            type="warning"
                            showIcon
                            message="JDBC 数据库支持尚未安装"
                            description="JDBC 驱动连接需要先在“设置 -> 扩展”安装 JDBC 数据库支持；安装时会自动检测本机 Java，缺失时自动安装 Java 17。Python 驱动不受影响。"
                          />
                        )}
                        {javaRestartRequired && (
                          <Alert
                            type="warning"
                            showIcon
                            message="需要重启应用"
                            description="JDBC Java 环境已修改，但当前应用尚未重启。重启后新的 Java 环境才会生效。"
                          />
                        )}
                        <Flex justify="space-between" align="center">
                          <Space direction="vertical" size={0}>
                            <Typography.Text>指定 JDBC Java 环境</Typography.Text>
                            <Typography.Text type="secondary">
                              默认自动使用安装 JDBC 数据库支持时检测到的可用 Java；开启后可固定使用下方选择的版本。
                            </Typography.Text>
                          </Space>
                          <Switch checked={jdbcJavaEnabled} onChange={setJdbcJavaEnabled} />
                        </Flex>
                        <Space.Compact className="full-width">
                          <AutoComplete
                            value={jdbcJavaHome}
                            options={javaRuntimeOptions}
                            popupClassName="settings-glass-select-dropdown"
                            placeholder="请选择项目启动后 JDBC 统一使用的 JDK/JRE 目录"
                            onChange={setJdbcJavaHome}
                            disabled={!jdbcJavaEnabled}
                            filterOption={(inputValue, option) => {
                              const normalizedInput = inputValue.trim().toLowerCase()
                              if (
                                !normalizedInput ||
                                selectedJavaRuntimeValues.has(normalizedInput)
                              ) {
                                return true
                              }
                              return (
                                String(option?.value ?? '')
                                  .toLowerCase()
                                  .includes(normalizedInput) ||
                                String(option?.label ?? '')
                                  .toLowerCase()
                                  .includes(normalizedInput)
                              )
                            }}
                            className="full-width"
                          />
                          <Button
                            disabled={!jdbcJavaEnabled}
                            onClick={() => void selectJavaDirectory()}
                          >
                            选择
                          </Button>
                          <Button type="primary" onClick={() => void saveJdbcJavaConfig()}>
                            保存
                          </Button>
                        </Space.Compact>
                      </Space>
                      <div className="driver-manager-shell">
                        <div className="driver-manager-nav">
                          <div className="driver-manager-nav-panel">
                            <Typography.Text strong>数据库类型</Typography.Text>
                          </div>
                          {DRIVER_DATABASE_ORDER.map((databaseType) => {
                            const meta = DRIVER_DATABASE_META[databaseType]
                            const databaseDrivers = drivers.filter(
                              (driver) => driver.database_type === databaseType
                            )
                            return (
                              <button
                                key={databaseType}
                                type="button"
                                className={`driver-manager-nav-item${selectedDriverDatabaseType === databaseType ? ' active' : ''}`}
                                onClick={() => selectDriverDatabaseType(databaseType)}
                              >
                                <span className="driver-manager-nav-icon">{meta.icon}</span>
                                <span className="driver-manager-nav-copy">
                                  <Typography.Text strong>{meta.shortLabel}</Typography.Text>
                                </span>
                                <span className="driver-manager-nav-meta">
                                  <Tag>{databaseDrivers.length}</Tag>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                        <div className="driver-manager-main">
                          <div className="driver-manager-summary-grid">
                            <div className="driver-manager-summary-card">
                              <span>{selectedDatabaseDrivers.length}</span>
                              <small>当前已配置</small>
                            </div>
                            <div className="driver-manager-summary-card accent">
                              <span>{selectedManualDriverCount}</span>
                              <small>手动添加</small>
                            </div>
                            <div className="driver-manager-summary-card">
                              <span>
                                {driverTypeOptionsForDatabase(selectedDriverDatabaseType).length}
                              </span>
                              <small>支持格式</small>
                            </div>
                          </div>
                          <div className="driver-manager-section-card">
                            <Flex justify="space-between" align="center" gap={12}>
                              <Space direction="vertical" size={2}>
                                <Typography.Title level={5} style={{ margin: 0 }}>
                                  {selectedDriverDatabaseMeta.label}驱动
                                </Typography.Title>
                              </Space>
                              <Space size={8} wrap>
                                <Tag>{selectedDriverDatabaseMeta.shortLabel}</Tag>
                                <Button loading={driversLoading} onClick={() => void loadDrivers()}>
                                  刷新
                                </Button>
                              </Space>
                            </Flex>
                            <Table<DriverInfo>
                              size="small"
                              rowKey="id"
                              loading={driversLoading}
                              pagination={false}
                              tableLayout="fixed"
                              locale={{
                                emptyText: `${selectedDriverDatabaseMeta.shortLabel} 暂无已配置驱动`
                              }}
                              dataSource={selectedDatabaseDrivers}
                              columns={[
                                {
                                  title: '名称',
                                  dataIndex: 'name',
                                  width: 180,
                                  ellipsis: true,
                                  render: (value: string) => (
                                    <Typography.Text ellipsis title={value}>
                                      {value}
                                    </Typography.Text>
                                  )
                                },
                                {
                                  title: '驱动类型',
                                  dataIndex: 'driver_type',
                                  width: 110,
                                  render: (value: DriverInfo['driver_type']) =>
                                    driverTypeLabel(value)
                                },
                                {
                                  title: '驱动文件',
                                  ellipsis: true,
                                  render: (_: unknown, driver) => (
                                    <Typography.Text ellipsis title={driver.path ?? undefined}>
                                      {driver.path}
                                    </Typography.Text>
                                  )
                                },
                                {
                                  title: '操作',
                                  width: 132,
                                  render: (_: unknown, driver) => (
                                    <Space size={4} wrap={false}>
                                      <Button size="small" onClick={() => void testDriver(driver)}>
                                        测试
                                      </Button>
                                      <Button
                                        danger
                                        size="small"
                                        onClick={() => void deleteDriver(driver)}
                                      >
                                        删除
                                      </Button>
                                    </Space>
                                  )
                                }
                              ]}
                            />
                          </div>
                          <div className="driver-manager-section-card">
                            <Space direction="vertical" size={2} className="full-width">
                              <Typography.Title level={5} style={{ margin: 0 }}>
                                添加 {selectedDriverDatabaseMeta.shortLabel} 驱动
                              </Typography.Title>
                              <Typography.Text type="secondary">
                                支持 {selectedDriverTypeLabels}
                              </Typography.Text>
                            </Space>
                            <Form
                              form={driverForm}
                              layout="vertical"
                              initialValues={{
                                database_type: 'dm',
                                driver_type: 'jdbc',
                                enabled: true
                              }}
                            >
                              <Form.Item name="database_type" style={{ display: 'none' }}>
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name="driver_type"
                                label="驱动类型"
                                rules={[{ required: true, message: '请选择驱动类型' }]}
                              >
                                <Select
                                  popupClassName="settings-glass-select-dropdown"
                                  options={driverTypeOptionsForDatabase(selectedDriverDatabaseType)}
                                />
                              </Form.Item>
                              <Form.Item
                                name="name"
                                label="显示名称"
                                rules={[{ required: true, message: '请输入显示名称' }]}
                              >
                                <Input
                                  placeholder={
                                    selectedDriverDatabaseType === 'gaussdb'
                                      ? '例如：高斯 JDBC 生产环境'
                                      : '例如：达梦 JDBC / 本机 dmPython'
                                  }
                                />
                              </Form.Item>
                              <Form.Item
                                name="path"
                                label={driverPathLabel(selectedDriverDatabaseType, driverType)}
                                rules={[
                                  {
                                    required: true,
                                    message: `请选择${driverPathLabel(selectedDriverDatabaseType, driverType)}`
                                  }
                                ]}
                              >
                                <Input
                                  readOnly
                                  placeholder={driverPathPlaceholder(
                                    selectedDriverDatabaseType,
                                    driverType
                                  )}
                                  addonAfter={
                                    <Button
                                      type="link"
                                      size="small"
                                      onClick={() => void selectDriverFile()}
                                    >
                                      选择
                                    </Button>
                                  }
                                />
                              </Form.Item>
                              <Button
                                type="primary"
                                loading={driverSaving}
                                onClick={() => void addDriver()}
                              >
                                添加驱动
                              </Button>
                            </Form>
                          </div>
                        </div>
                      </div>
                    </Space>
                  )}
                </div>
              </Flex>
            ) : (
              <div className="deferred-modal-loading">
                <LoadingOutlined spin />
              </div>
            )
          }
        </ImperativeModalHost>
        <Modal
          title={editingTableName ? `修改表：${editingTableName}` : '修改表'}
          open={tableEditorOpen}
          okText="保存"
          cancelText="取消"
          confirmLoading={tableEditorLoading}
          onOk={() => void saveTableEditor()}
          onCancel={() => setTableEditorOpen(false)}
          width={980}
          okButtonProps={{
            disabled: !tableDesignerSupportsEdit(getConnection(editingConnectionId)?.database_type)
          }}
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          {renderTableDesigner(
            'edit',
            editingConnectionId,
            editingDatabaseName,
            editingPgDatabaseName,
            editingTableName ?? '',
            setEditingTableName,
            editingTableComment,
            setEditingTableComment,
            editingColumns,
            tableEditorLoading
          )}
        </Modal>
        <Modal
          title={
            creatingSchemaDatabaseName
              ? '新建 Schema'
              : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle'
                ? '新建用户'
                : '新增数据库'
          }
          open={databaseCreateModalOpen}
          className="database-create-modal"
          okText="创建"
          cancelText="取消"
          confirmLoading={databaseCreateLoading}
          onOk={() => void createDatabase()}
          onCancel={() => {
            setDatabaseCreateModalOpen(false)
            setCreatingSchemaDatabaseName('')
            setDatabaseCreatePassword('')
          }}
          okButtonProps={{
            disabled:
              !databaseCreateName.trim() ||
              (getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' &&
                !creatingSchemaDatabaseName &&
                !databaseCreatePassword.trim())
          }}
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          <Form layout="vertical" className="database-create-form">
            <Form.Item
              label={
                creatingSchemaDatabaseName
                  ? 'Schema 名称'
                  : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle'
                    ? '用户名'
                    : '数据库名称'
              }
              required
            >
              <Input
                placeholder={
                  creatingSchemaDatabaseName
                    ? '请输入 Schema 名称'
                    : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle'
                      ? '请输入用户名'
                      : '请输入数据库名称'
                }
                value={databaseCreateName}
                onChange={(event) => setDatabaseCreateName(event.target.value)}
                onPressEnter={() => void createDatabase()}
              />
            </Form.Item>
            {getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' &&
              !creatingSchemaDatabaseName && (
                <Form.Item label="用户密码" required>
                  <Input.Password
                    placeholder="请输入用户密码"
                    value={databaseCreatePassword}
                    onChange={(event) => setDatabaseCreatePassword(event.target.value)}
                    onPressEnter={() => void createDatabase()}
                  />
                </Form.Item>
              )}
            <Typography.Text type="secondary">
              {getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' &&
              !creatingSchemaDatabaseName
                ? '用户名仅允许字母、数字、下划线，首字符不能是数字；创建后会自动授予基础开发权限。'
                : '仅允许字母、数字、下划线，首字符不能是数字，长度 1-64。'}
            </Typography.Text>
          </Form>
        </Modal>
        <Modal
          title="运行 SQL 文件"
          open={sqlFileModalOpen}
          okText="执行"
          cancelText="取消"
          confirmLoading={sqlFileLoading}
          onOk={() => void runSqlFile()}
          onCancel={() => setSqlFileModalOpen(false)}
          okButtonProps={{
            danger: true,
            disabled: sqlFileDatabases.length > 0 && !sqlFileDatabase
          }}
          footer={
            sqlFileResult
              ? undefined
              : (_, { OkBtn, CancelBtn }) => (
                  <Space>
                    <CancelBtn />
                    <OkBtn />
                  </Space>
                )
          }
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          {sqlFileResult ? (
            <Space direction="vertical" className="full-width">
              <Alert
                type={sqlFileResult.failed_count === 0 ? 'success' : 'warning'}
                message={`执行完成：${sqlFileResult.success_count} 条成功，${sqlFileResult.failed_count} 条失败`}
                showIcon
              />
              {sqlFileResult.errors.length > 0 && (
                <Space direction="vertical" className="full-width sql-file-errors">
                  <Typography.Text strong>错误信息：</Typography.Text>
                  <Input.TextArea
                    value={sqlFileResult.errors.join('\n\n')}
                    autoSize={{ minRows: 4, maxRows: 12 }}
                    readOnly
                  />
                </Space>
              )}
              <Button type="default" block onClick={() => setSqlFileModalOpen(false)}>
                关闭
              </Button>
            </Space>
          ) : (
            <Space direction="vertical" className="full-width">
              <Alert
                type="warning"
                message="SQL 文件可能包含 DDL/DML 写操作，执行后不可撤销，请确认无误后再执行。"
                showIcon
              />
              <Typography.Text>
                <Typography.Text strong>连接：</Typography.Text>
                {getConnection(sqlFileConnectionId)?.name ?? sqlFileConnectionId}
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>文件：</Typography.Text>
                {sqlFileName}
              </Typography.Text>
              <Typography.Text>
                <Typography.Text strong>SQL 行数：</Typography.Text>
                {sqlFileContent ? sqlFileContent.split('\n').length : 0}
              </Typography.Text>
              <Form layout="vertical">
                <Form.Item
                  label={
                    isSchemaScopedType(getConnection(sqlFileConnectionId)?.database_type)
                      ? '目标 Schema'
                      : '目标数据库'
                  }
                  required={sqlFileDatabases.length > 0}
                  rules={
                    sqlFileDatabases.length > 0
                      ? [
                          {
                            required: true,
                            message: isSchemaScopedType(
                              getConnection(sqlFileConnectionId)?.database_type
                            )
                              ? '请选择目标 Schema'
                              : '请选择目标数据库'
                          }
                        ]
                      : undefined
                  }
                >
                  {sqlFileDatabases.length > 0 ? (
                    <Select
                      placeholder={
                        isSchemaScopedType(getConnection(sqlFileConnectionId)?.database_type)
                          ? '请选择目标 Schema'
                          : '请选择目标数据库'
                      }
                      value={sqlFileDatabase || undefined}
                      onChange={(value) => setSqlFileDatabase(value)}
                      options={sqlFileDatabases.map((db) => ({ label: db.name, value: db.name }))}
                    />
                  ) : (
                    <Input
                      placeholder="留空则使用连接默认数据库"
                      value={sqlFileDatabase}
                      onChange={(event) => setSqlFileDatabase(event.target.value)}
                    />
                  )}
                </Form.Item>
              </Form>
            </Space>
          )}
        </Modal>
        <Modal
          title={routineTarget ? `执行存储过程：${routineTarget.name}` : '执行存储过程'}
          open={routineExecuteModalOpen}
          className="routine-execute-modal"
          okText="确认执行"
          cancelText="取消"
          confirmLoading={routineExecuteLoading}
          onOk={() => void executeRoutine()}
          onCancel={() => {
            setRoutineExecuteModalOpen(false)
            setRoutineTarget(undefined)
            setRoutineParameters([])
            setRoutineArguments({})
          }}
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          <Space direction="vertical" className="full-width" size={16}>
            <Alert type="warning" showIcon message="确认后将立即在当前数据库中执行该存储过程。" />
            {routineParameters.length === 0 ? (
              <Typography.Text type="secondary">该存储过程没有参数。</Typography.Text>
            ) : (
              <Form layout="vertical" className="routine-parameter-form">
                {routineParameters.map((parameter) => {
                  const draft = routineArguments[parameter.name] ?? {
                    value: '',
                    isNull: true,
                    useDefault: false
                  }
                  const outputOnly = parameter.mode === 'OUT'
                  return (
                    <div
                      className="routine-parameter-row"
                      key={`${parameter.position}:${parameter.name}`}
                    >
                      <div className="routine-parameter-heading">
                        <Typography.Text strong>{parameter.name}</Typography.Text>
                        <Space size={6}>
                          <Tag color={parameter.mode === 'IN' ? 'blue' : 'gold'}>
                            {parameter.mode}
                          </Tag>
                          <Typography.Text type="secondary">{parameter.data_type}</Typography.Text>
                        </Space>
                      </div>
                      {outputOnly ? (
                        <Typography.Text type="secondary">
                          输出参数，执行完成后在结果中显示
                        </Typography.Text>
                      ) : (
                        <Space direction="vertical" className="full-width" size={8}>
                          <Input
                            value={draft.value}
                            disabled={draft.isNull || draft.useDefault}
                            placeholder={draft.isNull ? '将传入 NULL' : '请输入参数值'}
                            onChange={(event) => {
                              const value = event.target.value
                              setRoutineArguments((current) => ({
                                ...current,
                                [parameter.name]: {
                                  ...draft,
                                  value,
                                  isNull: value.length === 0
                                }
                              }))
                            }}
                          />
                          <Space size={16} wrap>
                            <Checkbox
                              checked={draft.isNull}
                              disabled={draft.useDefault}
                              onChange={(event) =>
                                setRoutineArguments((current) => ({
                                  ...current,
                                  [parameter.name]: {
                                    ...draft,
                                    isNull: event.target.checked
                                  }
                                }))
                              }
                            >
                              传入 NULL
                            </Checkbox>
                            {parameter.has_default && (
                              <Checkbox
                                checked={draft.useDefault}
                                onChange={(event) => {
                                  const useDefault = event.target.checked
                                  setRoutineArguments((current) => ({
                                    ...current,
                                    [parameter.name]: {
                                      ...draft,
                                      useDefault,
                                      isNull: useDefault ? false : draft.value.length === 0
                                    }
                                  }))
                                }}
                              >
                                使用默认值
                              </Checkbox>
                            )}
                          </Space>
                        </Space>
                      )}
                    </div>
                  )
                })}
              </Form>
            )}
          </Space>
        </Modal>
        <DdlPreviewModal
          ref={ddlPreviewModalRef}
          theme={theme}
          onError={(errorMessage) => showError(errorMessage)}
        />
        <FolderEditorModal
          open={folderEditorOpen}
          mode={folderEditorMode}
          name={folderNameDraft}
          inputRef={folderEditorInputRef}
          onNameChange={setFolderNameDraft}
          onSave={saveFolder}
          onCancel={() => {
            setFolderEditorOpen(false)
            setEditingFolderId(undefined)
            setCreatingFolderParentId(undefined)
            setFolderNameDraft('')
          }}
        />
        <CreateTableModal
          open={createTableModalOpen}
          title={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '新建集合' : '新建表'}
          loading={createTableLoading}
          disabled={!newTableName.trim() || (getConnection(createTableConnectionId)?.database_type !== 'mongodb' && newTableColumns.filter((column) => column.name.trim()).length === 0)}
          onCreate={() => void createTable()}
          onClose={() => setCreateTableModalOpen(false)}
        >
          {renderTableDesigner(
            'create',
            createTableConnectionId,
            createTableDatabaseName,
            createTablePgDatabaseName || undefined,
            newTableName,
            setNewTableName,
            newTableComment,
            setNewTableComment,
            newTableColumns,
            createTableLoading
          )}
        </CreateTableModal>
        <ConnectionEditorModal
          form={form}
          open={connectionModalOpen}
          mode={connectionMode}
          databaseType={connectionModalDatabaseType}
          loading={connectionLoading}
          testingConnection={testingConnection}
          testingSshConnection={testingSshConnection}
          driversLoading={driversLoading}
          manualDriverOptions={manualDriverOptions}
          selectedManualDriver={selectedManualDriver}
          driverLabel={
            selectedManualDriver ? driverTypeLabel(selectedManualDriver.driver_type) : ''
          }
          folderOptions={connectionFolders.map((folder) => ({
            label: folder.name,
            value: folder.id
          }))}
          selectedFolderId={connectionModalFolderId}
          onOk={() => void saveConnection()}
          onCancel={closeConnectionModal}
          onTestConnection={() => void testConnection()}
          onTestSshConnection={() => void testSshConnection()}
          onSelectSqliteFile={() => void selectSqliteFile()}
          onOpenDriverManager={openDriverManager}
          onDriverChange={handleConnectionDriverChange}
          onFolderChange={setConnectionModalFolderId}
          onCreateFolder={createConnectionFolder}
        />
        <BackupModal
          open={backupRestoreModalOpen}
          loading={backupRestoreLoading}
          connectionName={getConnection(backupRestoreConnectionId)?.name}
          databaseName={backupRestorePgDatabase || backupRestoreDatabase || undefined}
          onRun={() => void runBackup()}
          onClose={() => setBackupRestoreModalOpen(false)}
        />
        <Modal
          title={exportOrigin === 'result' ? '导出查询结果' : '导出'}
          open={exportModalOpen}
          className="data-export-modal"
          rootClassName="data-export-modal-root"
          okText="选择路径并导出"
          cancelText="取消"
          confirmLoading={exportLoading}
          onOk={() => void runExport()}
          onCancel={() => setExportModalOpen(false)}
          okButtonProps={{
            disabled:
              exportColumnsLoading ||
              (exportAvailableColumns.length > 0 && exportColumns.length === 0)
          }}
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          <Space direction="vertical" className="full-width">
            <Typography.Text>
              <Typography.Text strong>连接：</Typography.Text>
              {exportConnection?.name}
            </Typography.Text>
            <Typography.Text>
              <Typography.Text strong>范围：</Typography.Text>
              {exportOrigin === 'result'
                ? exportResultTab?.title || '当前结果'
                : exportScope === 'table'
                  ? `表 ${exportTable}`
                  : exportScope === 'schema'
                    ? `Schema ${exportDatabase}`
                    : `数据库 ${exportPgDatabase || exportDatabase || '默认'}`}
            </Typography.Text>
            <Form layout="vertical">
              {exportOrigin === 'result' && (
                <Form.Item label="数据范围">
                  <Segmented
                    block
                    value={exportDataScope}
                    options={[
                      { label: '当前页', value: 'current_page' },
                      { label: '全部数据', value: 'all' }
                    ]}
                    onChange={(value) => setExportDataScope(value as ExportDataScope)}
                  />
                </Form.Item>
              )}
              {(exportAvailableColumns.length > 0 || exportColumnsLoading) && (
                <Form.Item label="导出列">
                  <Space direction="vertical" className="full-width" size={8}>
                    <Checkbox
                      checked={
                        exportAvailableColumns.length > 0 &&
                        exportColumns.length === exportAvailableColumns.length
                      }
                      indeterminate={
                        exportColumns.length > 0 &&
                        exportColumns.length < exportAvailableColumns.length
                      }
                      disabled={exportColumnsLoading}
                      onChange={(event) =>
                        setExportColumns(event.target.checked ? exportAvailableColumns : [])
                      }
                    >
                      全选
                    </Checkbox>
                    <Select
                      mode="multiple"
                      allowClear
                      loading={exportColumnsLoading}
                      value={exportColumns}
                      options={exportAvailableColumns.map((column) => ({
                        label: column,
                        value: column
                      }))}
                      placeholder="请选择要导出的列"
                      maxTagCount="responsive"
                      onChange={setExportColumns}
                    />
                  </Space>
                </Form.Item>
              )}
              <Form.Item label="导出格式">
                <Select
                  value={exportFormat}
                  onChange={(value) => setExportFormat(value as ExportFormat)}
                  options={exportFormatOptions}
                />
              </Form.Item>
              {exportOrigin === 'tree' && exportFormat === 'sql' && (
                <Form.Item label="导出内容">
                  <Select
                    value={exportContent}
                    onChange={(value) => setExportContent(value)}
                    options={[
                      { label: '结构 + 数据', value: 'schema_data' },
                      { label: '仅结构', value: 'schema' },
                      ...(exportScope === 'table' ? [] : [{ label: '仅数据', value: 'data' }])
                    ]}
                  />
                </Form.Item>
              )}
            </Form>
            {exportOrigin === 'tree' && exportFormat === 'csv' && exportScope !== 'table' && (
              <Alert type="info" message="CSV 多表导出会创建目录，每张表一个 CSV 文件。" showIcon />
            )}
            {exportFormat === 'json' && (
              <Alert type="info" message="JSON 会保留字段名称与结构化值，便于程序读取。" showIcon />
            )}
            {exportOrigin === 'tree' && exportFormat === 'sql' && (
              <Alert
                type="info"
                message="SQL 导出保留完整表结构；选择部分列时，仅 INSERT 数据按所选列生成。"
                showIcon
              />
            )}
          </Space>
        </Modal>
        <Modal
          title="导入"
          open={importModalOpen}
          okText="导入"
          cancelText="取消"
          confirmLoading={importLoading}
          onOk={() => void runImport()}
          onCancel={() => setImportModalOpen(false)}
          okButtonProps={{ disabled: !importPath }}
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          <Space direction="vertical" className="full-width">
            <Typography.Text>
              <Typography.Text strong>连接：</Typography.Text>
              {getConnection(importConnectionId)?.name}
            </Typography.Text>
            <Typography.Text>
              <Typography.Text strong>目标：</Typography.Text>
              {importTable
                ? `表 ${importTable}`
                : importPgDatabase
                  ? `Schema ${importPgDatabase}`
                  : `数据库 ${importDatabase || '默认'}`}
            </Typography.Text>
            <Form layout="vertical">
              <Form.Item label="导入文件（SQL/CSV，自动按扩展名识别）" required>
                <Input
                  readOnly
                  placeholder="请选择导入文件"
                  value={importPath}
                  addonAfter={
                    <Button type="link" size="small" onClick={() => void selectImportFilePath()}>
                      选择
                    </Button>
                  }
                />
              </Form.Item>
            </Form>
            <Alert
              type="warning"
              message="导入 SQL 会逐条执行文件中的语句；导入 CSV 会 INSERT 到目标表，请确保表结构与 CSV 表头一致。"
              showIcon
            />
          </Space>
        </Modal>
        <Modal
          title="处理同步冲突"
          open={gitSyncConflicts.length > 0}
          width={1180}
          className="sync-conflict-modal"
          style={{ maxWidth: 'calc(100vw - 48px)' }}
          okText="确认并同步"
          cancelText="稍后处理"
          confirmLoading={gitSyncBusy}
          okButtonProps={{
            disabled: gitSyncConflicts.some((item) => !gitSyncConflictChoices[item.key])
          }}
          onOk={() => void resolveGitSyncConflicts()}
          onCancel={() => {
            setGitSyncConflicts([])
            setGitSyncConflictChoices({})
            setGitSyncPendingPayload(undefined)
            setGitSyncPendingRemoteSha(undefined)
            setGitSyncPendingPassphrase('')
          }}
          maskClosable={false}
          {...FAST_MODAL_PROPS}
        >
          <div className="sync-conflict-list">
            <Alert
              type="warning"
              showIcon
              message={`发现 ${gitSyncConflictGroups.length} 项需要选择的配置冲突`}
              description="未冲突的内容已自动合并。排序相关内容已合并为一个整体，不会直接展示连接内部 ID。"
            />
            {gitSyncConflictGroups.map((group) => {
              const display =
                group.key === 'connection-tree-order'
                  ? { title: group.title, description: group.description }
                  : describeGitSyncConflict(
                      group.conflicts[0].path_segments,
                      gitSyncConflictDisplayContext
                    )
              const groupChoice = group.conflicts
                .map((conflict) => gitSyncConflictChoices[conflict.key])
                .find((choice) => choice)
              const treeOrderConflict = group.conflicts.find(
                (conflict) =>
                  conflict.path_segments[0] === 'preferences' &&
                  conflict.path_segments[1] === 'tree_order'
              )
              const treeDiff = treeOrderConflict
                ? buildGitSyncTreeDiff(
                    treeOrderConflict.local_exists ? treeOrderConflict.local : undefined,
                    treeOrderConflict.remote_exists ? treeOrderConflict.remote : undefined,
                    gitSyncConflictDisplayContext
                  )
                : undefined
              return (
                <div className="settings-section-card sync-conflict-card" key={group.key}>
                  <div className="sync-conflict-heading">
                    <Typography.Text strong>{display.title}</Typography.Text>
                    <Typography.Text type="secondary">{display.description}</Typography.Text>
                  </div>
                  <Segmented
                    block
                    value={groupChoice}
                    options={[
                      { label: '保留本机', value: 'local' },
                      { label: '保留远程', value: 'remote' }
                    ]}
                    onChange={(value) =>
                      setGitSyncConflictChoices((current) =>
                        Object.fromEntries(
                          Object.entries({
                            ...current,
                            ...Object.fromEntries(
                              group.conflicts.map((conflict) => [
                                conflict.key,
                                value as 'local' | 'remote'
                              ])
                            )
                          })
                        ) as Record<string, 'local' | 'remote'>
                      )
                    }
                  />
                  {treeDiff ? (
                    <div className="sync-tree-diff" aria-label="连接树差异对比">
                      <div className="sync-tree-diff-panel">
                        <Typography.Text strong>本机连接树</Typography.Text>
                        <div className="sync-tree-diff-body">
                          {treeDiff.local.length > 0 ? (
                            treeDiff.local.map((node) => (
                              <div
                                className={`sync-tree-diff-row sync-tree-diff-${node.status}`}
                                key={`local-${node.id}`}
                                style={{ paddingInlineStart: `${12 + node.depth * 22}px` }}
                              >
                                <span className={`sync-tree-diff-node-icon ${node.kind}`} />
                                <span className="sync-tree-diff-node-label">{node.label}</span>
                                {node.status !== 'same' && (
                                  <span className="sync-tree-diff-status">
                                    {node.status === 'removed' ? '仅本机' : '位置不同'}
                                  </span>
                                )}
                              </div>
                            ))
                          ) : (
                            <Typography.Text type="secondary">本机没有连接树数据</Typography.Text>
                          )}
                        </div>
                      </div>
                      <div className="sync-tree-diff-panel">
                        <Typography.Text strong>远程连接树</Typography.Text>
                        <div className="sync-tree-diff-body">
                          {treeDiff.remote.length > 0 ? (
                            treeDiff.remote.map((node) => (
                              <div
                                className={`sync-tree-diff-row sync-tree-diff-${node.status}`}
                                key={`remote-${node.id}`}
                                style={{ paddingInlineStart: `${12 + node.depth * 22}px` }}
                              >
                                <span className={`sync-tree-diff-node-icon ${node.kind}`} />
                                <span className="sync-tree-diff-node-label">{node.label}</span>
                                {node.status !== 'same' && (
                                  <span className="sync-tree-diff-status">
                                    {node.status === 'added' ? '仅远程' : '位置不同'}
                                  </span>
                                )}
                              </div>
                            ))
                          ) : (
                            <Typography.Text type="secondary">远程没有连接树数据</Typography.Text>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="sync-conflict-values">
                      <div className="sync-conflict-value-panel">
                        <Typography.Text strong>本机配置</Typography.Text>
                        <pre className="sync-conflict-value">
                          {group.conflicts
                            .map((conflict) =>
                              conflict.local_exists
                                ? formatGitSyncConflictValue(
                                    conflict.local,
                                    conflict.path_segments,
                                    gitSyncConflictDisplayContext
                                  )
                                : '此项在本机已删除'
                            )
                            .join('\n\n')}
                        </pre>
                      </div>
                      <div className="sync-conflict-value-panel">
                        <Typography.Text strong>远程配置</Typography.Text>
                        <pre className="sync-conflict-value">
                          {group.conflicts
                            .map((conflict) =>
                              conflict.remote_exists
                                ? formatGitSyncConflictValue(
                                    conflict.remote,
                                    conflict.path_segments,
                                    gitSyncConflictDisplayContext
                                  )
                                : '此项在远程已删除'
                            )
                            .join('\n\n')}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default App
