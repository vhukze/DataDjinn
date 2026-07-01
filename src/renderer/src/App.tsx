import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  GithubOutlined,
  MessageOutlined,
  EditOutlined,
  DeleteOutlined,
  AimOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  LoginOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  CloudDownloadOutlined,
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
  Button,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Flex,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popover,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  theme as antdTheme,
  Typography,
  message
} from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { flushSync } from 'react-dom'
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from './context/ThemeContext'
import type { SqlCompletionColumn, SqlCompletionContext, SqlCompletionTable, SqlDialect, SqlEditorHandle } from './components/SqlEditor'
import AIDockPanelHost from './app/ai-dock-panel-host'
import type { AppInfo, BackendStatus, SettingsSection, ShortcutAction, ShortcutSettings, UpdateInfo, UpdateProgress, UpdateSettings } from './app/app-model'
import type { ColumnsResponse, ConnectionInfo, ConnectionTestResponse, DatabaseInfo, DbObjectInfo, HealthStatus, ObjectDdlResponse, QueryResponse, SqlFileRunResponse, TableInfo } from './app/connection-model'
import type { DatabaseType } from './app/data-sources'
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
  ImportConnectionResult,
  ImportConnectionSource,
  IMPORT_CONNECTION_SOURCE_OPTIONS,
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
import ResultTablePanel, { type HorizontalScrollTableRef } from './app/result-table-panel'
import {
  clampResultColumnWidth,
} from './app/query-utils'
import TableDesignerPanel from './app/table-designer-panel'
import {
  buildActiveTreePath,
  locateTreePathInView
} from './app/tree-navigation'
import {
  refreshConnectionTreeNode,
  refreshDatabaseTreeNode
} from './app/tree-refresh'
import { handleTreeSelectionChange, selectConnectionTreeNodes } from './app/tree-selection'
import {
  createTreeRuntime,
  getVisibleConnectionIdsFromTree
} from './app/tree-runtime'
import { useResourceTreeViewport } from './app/tree-viewport'
import { renderWorkspaceTabContent } from './app/workspace-content'
import ResourceTreePanel from './app/resource-tree-panel'
import { type CellInspectorPanelHandle } from './app/cell-inspector-panel'
import type { AIActiveContext, AIContextSource, AIWorkspaceAction, EditableRow, PersistedQueryWorkspace, RedisKeyEdit, SqlEditorExecutionContext, TableSearchUiState, WorkspaceTab } from './app/workspace-model'
import {
  buildConnectionNode as buildConnectionNodeFromModule,
  buildFolderNode as buildFolderNodeFromModule,
  buildResourceTree as buildResourceTreeFromModule,
  type ConnectionTypeIcons
} from './app/tree-builders'
import { useWorkspaceStore } from './app/workspace-store'
import {
  collectTreeNodesByKey,
  findTreeKeyPathByPredicate,
  getRelativeDropPosition,
  getTreeNodeCopyName,
  isLoadableTreeNode,
  isTreeNodeChildrenLoaded,
  replaceConnectionNode,
  treeIconBadge,
  updateTreeNode
} from './app/tree-model'
import type { ConnectionFolder, DatabaseTreeNode, DbObjectType, TreeNodeKind } from './app/tree-model'
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

const RESOURCE_TREE_ITEM_HEIGHT = 30
const FOLDER_DROP_PLACEHOLDER_KEY_PREFIX = 'folder-drop-placeholder:'
const FAST_MODAL_PROPS = {
  destroyOnHidden: true,
  transitionName: '',
  maskTransitionName: ''
} as const

const FAST_DROPDOWN_PROPS = {
  destroyOnHidden: true,
  transitionName: ''
} as const

const FAST_PRELOADED_DROPDOWN_PROPS = {
  ...FAST_DROPDOWN_PROPS,
  forceRender: true
} as const

type TreeSelectorPopoverProps = {
  options: string[]
  selectedValues: string[]
  onCommit: (nextSelected: string[]) => void
}

const TreeSelectorPopover = memo(function TreeSelectorPopover({
  options,
  selectedValues,
  onCommit
}: TreeSelectorPopoverProps): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [draftSelected, setDraftSelected] = useState<string[]>(selectedValues)
  const closeAndCommit = useCallback((): void => {
    setOpen(false)
    onCommit(draftSelected)
  }, [draftSelected, onCommit])

  useEffect(() => {
    if (!open) {
      setDraftSelected(selectedValues)
    }
  }, [open, selectedValues])

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }
      if (target.closest('.tree-selector-popover') || target.closest('.selector-badge')) {
        return
      }
      closeAndCommit()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      closeAndCommit()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [closeAndCommit, open])

  return (
    <Popover
      trigger={[]}
      open={open}
      overlayClassName="tree-selector-popover no-motion-overlay"
      destroyOnHidden={false}
      forceRender
      motion={{ motionName: '' }}
      content={
        <div className="tree-selector-popover-body">
          <Flex vertical gap={8}>
            <Button
              className="tree-selector-toggle-btn"
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation()
                setDraftSelected(draftSelected.length === options.length ? [options[0]] : options)
              }}
            >
              {draftSelected.length === options.length ? '取消全选' : '全选'}
            </Button>
            <Checkbox.Group
              className="tree-selector-checkbox-group"
              value={draftSelected}
              onChange={(values) => {
                if (values.length === 0) {
                  return
                }
                setDraftSelected(values as string[])
              }}
            >
              <Flex vertical gap={6}>
                {options.map((item) => (
                  <Checkbox className="tree-selector-checkbox" key={item} value={item}>
                    {item}
                  </Checkbox>
                ))}
              </Flex>
            </Checkbox.Group>
          </Flex>
        </div>
      }
    >
      <Tag
        className="selector-badge"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          flushSync(() => {
            if (open) {
              closeAndCommit()
              return
            }
            setDraftSelected(selectedValues)
            setOpen(true)
          })
        }}
      >
        {selectedValues.length}/{options.length}
      </Tag>
    </Popover>
  )
})

const formatQueryHistoryTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '未知时间'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

const getQueryHistoryPreviewText = (sql?: string): string => {
  const normalized = (sql ?? '').replace(/\s+/g, ' ').trim()
  return normalized || '空查询'
}

const WorkspaceTabCountBadge = (): React.JSX.Element => {
  const workspaceTabCount = useWorkspaceStore((state) => state.tabs.length)
  return (
    <span className="summary-pill summary-pill-tabs">
      <strong>{workspaceTabCount}</strong>
      <span className="summary-label">工作页</span>
    </span>
  )
}

const BACKEND_LABELS: Record<BackendStatus['state'], string> = {
  starting: '服务启动中',
  online: '服务正常',
  failed: '服务异常',
  stopped: '服务已停止',
  crashed: '服务已崩溃'
}

const BACKEND_COLORS: Record<BackendStatus['state'], 'success' | 'processing' | 'error' | 'default'> = {
  starting: 'processing',
  online: 'success',
  failed: 'error',
  stopped: 'default',
  crashed: 'error'
}

const STORAGE_DB = 'datadjinn-selected-databases'
const STORAGE_SCHEMA = 'datadjinn-selected-schemas'
const STORAGE_CONNECTION_FOLDERS = 'datadjinn-connection-folders'
const STORAGE_CONNECTION_FOLDER_ASSIGNMENTS = 'datadjinn-connection-folder-assignments'
const STORAGE_CONNECTION_FOLDER_ORDER = 'datadjinn-connection-folder-order'
const STORAGE_ROOT_CONNECTION_ORDER = 'datadjinn-root-connection-order'
const STORAGE_ROOT_ITEM_ORDER = 'datadjinn-root-item-order'
const STORAGE_FOLDER_CONNECTION_ORDER = 'datadjinn-folder-connection-order'
const STORAGE_QUERY_WORKSPACES = 'datadjinn-query-workspaces'
const STORAGE_SHORTCUT_SETTINGS = 'datadjinn-shortcut-settings'
const readPersisted = (key: string): Record<string, string[]> => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

const readPersistedJson = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) as T : fallback
  } catch {
    return fallback
  }
}

const mergeOrderedIds = (availableIds: string[], preferredIds: string[]): string[] => {
  const available = new Set(availableIds)
  const ordered = preferredIds.filter((id) => available.has(id))
  const orderedSet = new Set(ordered)
  return [...ordered, ...availableIds.filter((id) => !orderedSet.has(id))]
}

const stringArrayEquals = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index])

const stringRecordArrayEquals = (left: Record<string, string[]>, right: Record<string, string[]>): boolean => {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return stringArrayEquals(leftKeys, rightKeys) && leftKeys.every((key) => stringArrayEquals(left[key] ?? [], right[key] ?? []))
}

const rootFolderOrderId = (folderId: string): string => `folder:${folderId}`
const rootConnectionOrderId = (connectionId: string): string => `connection:${connectionId}`

const insertIdsAroundTarget = (ids: string[], movingIds: string[], targetId: string, placeAfter: boolean): string[] => {
  const movingSet = new Set(movingIds)
  const filtered = ids.filter((id) => !movingSet.has(id))
  const targetIndex = filtered.indexOf(targetId)
  if (targetIndex < 0) {
    return [...filtered, ...movingIds]
  }
  const insertIndex = placeAfter ? targetIndex + 1 : targetIndex
  return [...filtered.slice(0, insertIndex), ...movingIds, ...filtered.slice(insertIndex)]
}

function App(): React.JSX.Element {
  const [form] = Form.useForm<ConnectionFormValues>()
  const [driverForm] = Form.useForm<DriverFormValues>()
  const [connectionModalDatabaseType, setConnectionModalDatabaseType] = useState<DatabaseType>('sqlite')
  const driverType = Form.useWatch('driver_type', driverForm) ?? 'jdbc'
  const [messageApi, contextHolder] = message.useMessage()
  const showError = (error: unknown, fallback = '操作失败'): void => {
    const content = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
    Modal.error({
      title: '操作失败',
      centered: true,
      okText: '确认',
      width: 720,
      content: (
        <Space direction="vertical" className="full-width">
          <Input.TextArea value={content} autoSize={{ minRows: 4, maxRows: 12 }} readOnly />
        </Space>
      )
    })
  }
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'starting', message: '后端状态初始化中' })
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
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionPasswordPromptOpen, setConnectionPasswordPromptOpen] = useState(false)
  const [connectionPasswordPromptConnectionId, setConnectionPasswordPromptConnectionId] = useState<string>('')
  const [connectionPasswordPromptConnectionName, setConnectionPasswordPromptConnectionName] = useState('')
  const [connectionPasswordPromptReason, setConnectionPasswordPromptReason] = useState('')
  const [connectionPasswordDraft, setConnectionPasswordDraft] = useState('')
  const setWorkspaceTabs = useWorkspaceStore((state) => state.setTabs)
  const setActiveTabKey = useWorkspaceStore((state) => state.setActiveTabKey)
  const setWorkspaceTabsAndActiveTabKey = useWorkspaceStore((state) => state.setTabsAndActiveTabKey)
  const workspaceTabSummaryCount = useWorkspaceStore((state) => state.tabSummaries.length)
  const getWorkspaceTabs = useCallback(() => useWorkspaceStore.getState().tabs, [])
  const [sqlExecutionContextByTab, setSqlExecutionContextByTab] = useState<Record<string, SqlEditorExecutionContext>>({})
  const sqlExecutionContextRef = useRef<Record<string, SqlEditorExecutionContext>>({})
  const sqlExecutionContextStructureKeyRef = useRef<Record<string, string>>({})
  const sqlEditorHandleRefs = useRef<Record<string, SqlEditorHandle | null | undefined>>({})
  const [resourcePanelSize, setResourcePanelSize] = useState(340)
  const [aiPanelSize, setAiPanelSize] = useState(360)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
  const [treeSearchOpen, setTreeSearchOpen] = useState(false)
  const [treeSearchText, setTreeSearchText] = useState('')
  const treeSearchInputRef = useRef<HTMLInputElement | null>(null)
  const queryHistoryModalRef = useRef<ImperativeModalHandle | null>(null)
  const settingsModalRef = useRef<ImperativeModalHandle | null>(null)
  const updateModalRef = useRef<ImperativeModalHandle | null>(null)
  const connectionModalHydrationFrameRef = useRef<number | undefined>(undefined)
  const [resizingResourcePanel, setResizingResourcePanel] = useState(false)
  const [resizingAiPanel, setResizingAiPanel] = useState(false)
  const [aiContextSources, setAiContextSources] = useState<AIContextSource[]>([])
  const [aiActiveContext, setAiActiveContext] = useState<AIActiveContext | undefined>()
  const [focusedTreeNode, setFocusedTreeNode] = useState<DatabaseTreeNode | undefined>()
  const [treeContextMenu, setTreeContextMenu] = useState<{ x: number; y: number; node: DatabaseTreeNode } | null>(null)
  const [queryCounter, setQueryCounter] = useState(1)
  const [tableEditorOpen, setTableEditorOpen] = useState(false)
  const [tableEditorLoading, setTableEditorLoading] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<string>()
  const [editingDatabaseName, setEditingDatabaseName] = useState<string>()
  const [editingPgDatabaseName, setEditingPgDatabaseName] = useState<string>()
  const [editingTableName, setEditingTableName] = useState<string>()
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
  const [exportFormat, setExportFormat] = useState<'sql' | 'csv' | 'json'>('sql')
  const [exportContent, setExportContent] = useState<'schema' | 'data' | 'schema_data'>('schema_data')
  const [exportLoading, setExportLoading] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importConnectionId, setImportConnectionId] = useState<string>('')
  const [importDatabase, setImportDatabase] = useState<string>('')
  const [importPgDatabase, setImportPgDatabase] = useState<string>('')
  const [importTable, setImportTable] = useState<string>('')
  const [importPath, setImportPath] = useState<string>('')
  const [importLoading, setImportLoading] = useState(false)
  const [importConnectionModalOpen, setImportConnectionModalOpen] = useState(false)
  const [importConnectionSource, setImportConnectionSource] = useState<ImportConnectionSource>('datagrip')
  const [importConnectionRawText, setImportConnectionRawText] = useState('')
  const [importConnectionCandidates, setImportConnectionCandidates] = useState<ImportConnectionCandidate[]>([])
  const [importConnectionParsing, setImportConnectionParsing] = useState(false)
  const [importingConnections, setImportingConnections] = useState(false)
  const [importConnectionResult, setImportConnectionResult] = useState<ImportConnectionResult | null>(null)
  const [importConnectionResultOpen, setImportConnectionResultOpen] = useState(false)
  const [backupRestoreModalOpen, setBackupRestoreModalOpen] = useState(false)
  const [backupRestoreConnectionId, setBackupRestoreConnectionId] = useState<string>('')
  const [backupRestoreDatabase, setBackupRestoreDatabase] = useState<string>('')
  const [backupRestorePgDatabase, setBackupRestorePgDatabase] = useState<string>('')
  const [backupRestoreLoading, setBackupRestoreLoading] = useState(false)
  const [createTableModalOpen, setCreateTableModalOpen] = useState(false)
  const [createTableConnectionId, setCreateTableConnectionId] = useState<string>('')
  const [createTableDatabaseName, setCreateTableDatabaseName] = useState<string>('')
  const [createTablePgDatabaseName, setCreateTablePgDatabaseName] = useState<string>('')
  const [createTableLoading, setCreateTableLoading] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableComment, setNewTableComment] = useState('')
  const [newTableColumns, setNewTableColumns] = useState<ColumnDef[]>([])
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('app')
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(() => ({
    ...DEFAULT_SHORTCUT_SETTINGS,
    ...readPersistedJson<Partial<ShortcutSettings>>(STORAGE_SHORTCUT_SETTINGS, {})
  }))
  const [recordingShortcutAction, setRecordingShortcutAction] = useState<ShortcutAction | null>(null)
  const [selectedDriverDatabaseType, setSelectedDriverDatabaseType] = useState<DriverDatabaseType>('dm')
  const [connectionFolders, setConnectionFolders] = useState<ConnectionFolder[]>(() => readPersistedJson<ConnectionFolder[]>(STORAGE_CONNECTION_FOLDERS, []))
  const [connectionFolderAssignments, setConnectionFolderAssignments] = useState<Record<string, string>>(() => readPersistedJson<Record<string, string>>(STORAGE_CONNECTION_FOLDER_ASSIGNMENTS, {}))
  const [connectionFolderOrder, setConnectionFolderOrder] = useState<string[]>(() => readPersistedJson<string[]>(STORAGE_CONNECTION_FOLDER_ORDER, []))
  const [rootConnectionOrder, setRootConnectionOrder] = useState<string[]>(() => readPersistedJson<string[]>(STORAGE_ROOT_CONNECTION_ORDER, []))
  const [rootItemOrder, setRootItemOrder] = useState<string[]>(() => readPersistedJson<string[]>(STORAGE_ROOT_ITEM_ORDER, []))
  const [folderConnectionOrder, setFolderConnectionOrder] = useState<Record<string, string[]>>(() => readPersistedJson<Record<string, string[]>>(STORAGE_FOLDER_CONNECTION_ORDER, {}))
  const [folderEditorOpen, setFolderEditorOpen] = useState(false)
  const [folderEditorMode, setFolderEditorMode] = useState<'create' | 'rename'>('create')
  const [editingFolderId, setEditingFolderId] = useState<string>()
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [javaRestartRequired, setJavaRestartRequired] = useState(false)
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings | null>(null)
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
  const selectedJavaRuntimeValues = new Set(javaRuntimeOptions.map((option) => option.value.toLowerCase()))
  const driverDatabaseTypeForConnection = (value?: DatabaseType): DriverDatabaseType | undefined => (
    value === 'dm' || value === 'gaussdb' ? value : undefined
  )
  const currentDriverDatabaseType = driverDatabaseTypeForConnection(connectionModalDatabaseType)
  const currentAllDrivers = currentDriverDatabaseType ? drivers.filter((driver) => driver.database_type === currentDriverDatabaseType) : []
  const currentEnabledDrivers = currentAllDrivers.filter((driver) => driver.enabled)
  const watchedDriverId = Form.useWatch('driver_id', form)
  const watchedLegacyDmDriverId = Form.useWatch('dm_driver_id', form)
  const selectedManualDriverId = currentDriverDatabaseType ? (watchedDriverId ?? watchedLegacyDmDriverId) : undefined
  const selectedManualDriver = currentAllDrivers.find((driver) => driver.id === selectedManualDriverId)
  const [driversLoading, setDriversLoading] = useState(false)
  const [driverSaving, setDriverSaving] = useState(false)
  const selectedDriverDatabaseMeta = DRIVER_DATABASE_META[selectedDriverDatabaseType]
  const selectedDatabaseDrivers = drivers.filter((driver) => driver.database_type === selectedDriverDatabaseType)
  const selectedManualDriverCount = selectedDatabaseDrivers.filter((driver) => driver.source === 'manual').length
  const selectedDriverTypeLabels = selectedDriverDatabaseMeta.supportedDriverTypes
    .map((type) => type === 'python' ? 'dmPython pyd 驱动' : type === 'whl' ? 'dmPython whl 驱动' : 'JDBC jar 驱动')
    .join('、')
  const [selectedDatabases, setSelectedDatabases] = useState<Record<string, string[]>>(() => readPersisted(STORAGE_DB))
  const [selectedSchemas, setSelectedSchemas] = useState<Record<string, string[]>>(() => readPersisted(STORAGE_SCHEMA))
  const [persistedQueryWorkspaces, setPersistedQueryWorkspaces] = useState<PersistedQueryWorkspace[]>(
    () => readPersistedJson<PersistedQueryWorkspace[]>(STORAGE_QUERY_WORKSPACES, [])
  )
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
    localStorage.setItem(STORAGE_CONNECTION_FOLDER_ASSIGNMENTS, JSON.stringify(connectionFolderAssignments))
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
    localStorage.setItem(STORAGE_FOLDER_CONNECTION_ORDER, JSON.stringify(folderConnectionOrder))
  }, [folderConnectionOrder])

  useEffect(() => {
    localStorage.setItem(STORAGE_QUERY_WORKSPACES, JSON.stringify(persistedQueryWorkspaces))
  }, [persistedQueryWorkspaces])

  useEffect(() => {
    localStorage.setItem(STORAGE_SHORTCUT_SETTINGS, JSON.stringify(shortcutSettings))
  }, [shortcutSettings])

  useEffect(() => {
    if (!connectionsInitialized) {
      return
    }

    const validConnectionIds = new Set(connections.map((connection) => connection.connection_id))
    const validFolderIds = new Set(connectionFolders.map((folder) => folder.id))

    setConnectionFolderAssignments((current) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(current).filter(([connectionId, folderId]) => {
        const keep = validConnectionIds.has(connectionId) && validFolderIds.has(folderId)
        if (!keep) {
          changed = true
        }
        return keep
      }))
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
      return current.length === next.length && current.every((item, index) => item === next[index]) ? current : next
    })
    setConnectionSelectionAnchorId((current) => current && validConnectionIds.has(current) ? current : undefined)
    setConnectionFolderOrder((current) => {
      const next = mergeOrderedIds(connectionFolders.map((folder) => folder.id), current)
      return stringArrayEquals(current, next) ? current : next
    })
    setRootConnectionOrder((current) => {
      const next = mergeOrderedIds(
        connections
        .filter((connection) => !connectionFolderAssignments[connection.connection_id] || !validFolderIds.has(connectionFolderAssignments[connection.connection_id]))
        .map((connection) => connection.connection_id),
        current
      )
      return stringArrayEquals(current, next) ? current : next
    })
    setRootItemOrder((current) => {
      const rootConnectionIds = connections
        .filter((connection) => !connectionFolderAssignments[connection.connection_id] || !validFolderIds.has(connectionFolderAssignments[connection.connection_id]))
        .map((connection) => rootConnectionOrderId(connection.connection_id))
      const folderIds = connectionFolders.map((folder) => rootFolderOrderId(folder.id))
      const migratedOrder = current.length > 0
        ? current
        : [
            ...connectionFolderOrder.map(rootFolderOrderId),
            ...rootConnectionOrder.map(rootConnectionOrderId)
          ]
      const next = mergeOrderedIds([...folderIds, ...rootConnectionIds], migratedOrder)
      return stringArrayEquals(current, next) ? current : next
    })
    setFolderConnectionOrder((current) => {
      const next: Record<string, string[]> = {}
      for (const folderId of connectionFolders.map((folder) => folder.id)) {
        const folderConnectionIds = connections
          .filter((connection) => connectionFolderAssignments[connection.connection_id] === folderId)
          .map((connection) => connection.connection_id)
        next[folderId] = mergeOrderedIds(folderConnectionIds, current[folderId] ?? [])
      }
      return stringRecordArrayEquals(current, next) ? current : next
    })
  }, [connectionsInitialized, connections, connectionFolders, connectionFolderAssignments, connectionFolderOrder, rootConnectionOrder])

  const [allDatabases, setAllDatabases] = useState<Record<string, string[]>>({})
  const [allSchemas, setAllSchemas] = useState<Record<string, string[]>>({})
  const [completionTables, setCompletionTables] = useState<Record<string, string[]>>({})
  const [dragOverFolderTarget, setDragOverFolderTarget] = useState<{ folderId: string; zone: 'before' | 'after' }>()
  const [dragOverConnectionTarget, setDragOverConnectionTarget] = useState<{ connectionId: string; folderId?: string; zone: 'before' | 'after' }>()
  const [tableSearchUiState, setTableSearchUiState] = useState<Record<string, TableSearchUiState>>({})
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
  const tableNativeHorizontalScrollbarRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingPreviewRowScrollRefs = useRef<Record<string, string | undefined>>({})
  const tableScrollTopRefs = useRef<Record<string, number | undefined>>({})
  const tableNativeHorizontalScrollbarCleanupRefs = useRef<Record<string, (() => void) | undefined>>({})
  const tableNativeHorizontalScrollbarFrameRefs = useRef<Record<string, number | undefined>>({})
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
  const cellDragAnchorRefs = useRef<Record<string, { rowKey: string; column: string } | undefined>>({})
  const scrollbarDragRefs = useRef<Record<string, boolean | undefined>>({})
  const pendingCellDragTargetRefs = useRef<Record<string, { rowKey: string; column: string } | undefined>>({})
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
  const cellClipboardRef = useRef<{ text: string, values: unknown[][] } | null>(null)
  const contextMenuCellSelectionRefs = useRef<Record<string, string[] | undefined>>({})
  const contextMenuCellSelectionSnapshotRefs = useRef<Record<string, { anchorCellKey: string, cellKeys: string[] } | undefined>>({})
  const cellInspectorPanelRefs = useRef<Record<string, CellInspectorPanelHandle | null>>({})
  const inlineCellEditorRefs = useRef<Record<string, {
    rowKey: string
    column: string
    input: HTMLInputElement
    host: HTMLElement
    originalContent: string
    originalValue: unknown
    initialInputValue: string
  } | undefined>>({})
  const committedSelectedCellRangeRefs = useRef<Record<string, string[] | undefined>>({})
  const rowDragAnchorRefs = useRef<Record<string, string | undefined>>({})
  const rowSelectionDraftRefs = useRef<Record<string, React.Key[] | undefined>>({})
  const treeLoadingKeysRef = useRef<Set<React.Key>>(new Set())
  const dragOverFolderTargetRef = useRef<{ folderId: string; zone: 'before' | 'after' } | undefined>(undefined)
  const dragOverConnectionTargetRef = useRef<{ connectionId: string; folderId?: string; zone: 'before' | 'after' } | undefined>(undefined)
  const draggingConnectionIdsRef = useRef<string[]>([])
  const queryResultToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const aiPanelResizeRef = useRef<{ startX: number; startSize: number; lastSize?: number } | null>(null)
  const resourcePanelResizeRef = useRef<{ startX: number; startSize: number; lastSize?: number } | null>(null)
  const draggingConnectionFolderIdRef = useRef<string | undefined>(undefined)
  const ddlPreviewModalRef = useRef<DdlPreviewModalHandle | null>(null)
  const columnResizeRefs = useRef<Record<string, {
    tabKey: string
    column: string
    columnIndex: number
    pointerId: number
    startX: number
    startWidth: number
    lastWidth: number
    headerCells: HTMLElement[]
    headerColElements: HTMLTableColElement[]
    bodyColElements: HTMLTableColElement[]
    virtual: boolean
    virtualCells?: HTMLElement[]
    pendingWidth?: number
    frameId?: number
  } | undefined>>({})
  const resultTableRefs = useMemo(() => ({
    tableComponentRefs,
    tableBodyRefs,
    tableHeaderRefs,
    tableNativeHorizontalScrollbarRefs,
    pendingPreviewRowScrollRefs,
    tableScrollTopRefs,
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
    rowDragAnchorRefs,
    rowSelectionDraftRefs,
    columnResizeRefs
  }), [])

  const { theme, toggleTheme } = useTheme()

  const refreshUpdateSettings = async (): Promise<void> => {
    const settings = await window.api.getUpdateSettings()
    setUpdateSettings(settings)
  }

  const handleUpdateAvailable = (info: UpdateInfo, open = true): void => {
    setUpdateInfo(info)
    if (!downloadingUpdate) {
      setUpdateProgress(null)
    }
    if (open && info.latestVersion !== updateSettings?.skippedUpdateVersion) {
      openUpdateModal()
    }
  }

  const checkForUpdates = async (manual = true): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const info = await window.api.checkForUpdates()
      setUpdateInfo(info)
      if (info.available) {
        handleUpdateAvailable(info, true)
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

  const normalizeRequestError = (error: unknown): Error => {
    let message = error instanceof Error ? error.message : String(error || '操作失败')
    message = message
      .replace(/^Error invoking remote method 'api:request':\s*Error:\s*/i, '')
      .replace(/\s*\(Background on this error at:[\s\S]*$/i, '')
      .trim()

    const friendlyPrefixMatch = message.match(/((?:SQL\s*语法错误|SQL\s*语句错误|数据库操作失败|Oracle\s*数据库操作失败|Redis\s*操作失败|PostgreSQL\s*\/\s*高斯数据库[^：:]*|Oracle\s*SQL\s*中引用了不存在的字段|Oracle\s*表或视图不存在|目标数据库不存在|数据表不存在|当前对象类型不支持查看\s*DDL)[：:][\s\S]*)/)
    if (friendlyPrefixMatch?.[1]) {
      message = friendlyPrefixMatch[1].trim()
    }

    if (message.includes('Timeout reading from socket')) {
      return new Error('请求后端超时，请检查数据库主机和端口是否正确、服务是否已启动，或稍后重试')
    }
    return new Error(message || '操作失败')
  }

  const requestJsonRaw = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    if (backendStatus.state !== 'online' || !backendStatus.apiBaseUrl) {
      throw new Error(backendStatus.message ?? '后端服务正在恢复，请稍后再试')
    }

    try {
      return await window.api.requestJson<T>(path, {
        method: options?.method,
        headers: options?.headers as Record<string, string> | undefined,
        body: typeof options?.body === 'string' ? options.body : undefined
      })
    } catch (err) {
      throw normalizeRequestError(err)
    }
  }, [backendStatus.apiBaseUrl, backendStatus.message, backendStatus.state])

  const reopenConnectionSilently = useCallback(async (connectionId: string): Promise<void> => {
    const connection = await requestJsonRaw<ConnectionInfo>(`/connections/${connectionId}/open`, { method: 'POST' })
    setConnections((current) => current.map((item) => (item.connection_id === connectionId ? connection : item)))
    setTreeData((current) => replaceConnectionNode(current, connection, buildConnectionNode, true))
  }, [requestJsonRaw])

  const requestJson = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    try {
      return await requestJsonRaw<T>(path, options)
    } catch (err) {
      const error = normalizeRequestError(err)
      const match = path.match(/^\/connections\/([^/]+)/)

      if (match && (error.message.includes('连接已关闭') || error.message.includes('连接尚未打开'))) {
        await reopenConnectionSilently(match[1])
        return await requestJsonRaw<T>(path, options)
      }

      throw error
    }
  }, [normalizeRequestError, reopenConnectionSilently, requestJsonRaw])

  const buildSqlCompletionContext = (tab: WorkspaceTab): SqlCompletionContext => {
    const connection = getConnection(tab.connectionId)
    const scopeKey = tab.connectionId ? `${tab.connectionId}:${tab.pgDatabaseName ?? ''}:${tab.databaseName ?? ''}` : ''
    const loadedScope = scopeKey ? loadedCompletionIndex.get(scopeKey) : undefined
    const tables = loadedScope ? [...loadedScope.tables] : []
    const columns = loadedScope ? [...loadedScope.columns] : []

    const cacheKey = tab.connectionId && tab.databaseName ? `${tab.connectionId}:${tab.databaseName}` : ''

    if (cacheKey && completionTables[cacheKey]) {
      const existingTableNames = new Set(tables.map((table) => table.name))
      for (const tableName of completionTables[cacheKey]) {
        if (!existingTableNames.has(tableName)) {
          tables.push({ name: tableName, databaseName: tab.databaseName })
          existingTableNames.add(tableName)
        }
      }
    }

    const databaseNames = connection?.database_type === 'sqlite' ? [] : allDatabases[tab.connectionId ?? ''] ?? []
    const schemaKey = tab.connectionId && (tab.pgDatabaseName ?? tab.databaseName) ? `${tab.connectionId}:${tab.pgDatabaseName ?? tab.databaseName}` : ''

    return {
      dialect: connection?.database_type,
      connectionId: tab.connectionId,
      databaseName: tab.databaseName,
      pgDatabaseName: tab.pgDatabaseName,
      schemaName: isSchemaScopedType(connection?.database_type) ? tab.databaseName : undefined,
      databases: databaseNames,
      schemas: schemaKey ? allSchemas[schemaKey] ?? [] : [],
      tables,
      columns
    }
  }

  const buildSqlCompletionContextRef = useRef(buildSqlCompletionContext)
  buildSqlCompletionContextRef.current = buildSqlCompletionContext

  const renderConnectionTitle = (node: DatabaseTreeNode, connection: ConnectionInfo): React.ReactNode => {
    const loadingText = connectionTreeLoading[connection.connection_id]
    const loading = Boolean(loadingText)
    const isFocused = focusedTreeNode?.connectionId === connection.connection_id && focusedTreeNode?.kind === 'connection'
    const isSelected = selectedConnectionIds.includes(connection.connection_id)
    const connectionAddress = connection.host?.trim()
      ? `${connection.host}${connection.port ? `:${connection.port}` : ''}`
      : undefined
    const connectionMeta = connectionAddress
      ? `${connection.name} · ${connectionAddress}`
      : connection.name
    const currentFolderId = connectionFolderAssignments[connection.connection_id]
    const connectionDropZone = dragOverConnectionTarget?.connectionId === connection.connection_id
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
        onDragOver={(event) => {
          const movingConnectionIds = draggingConnectionIdsRef.current
          if (movingConnectionIds.length === 0 || movingConnectionIds.includes(connection.connection_id)) {
            return
          }
          if (!currentFolderId || draggingConnectionFolderIdRef.current !== currentFolderId) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          updateDragOverConnectionTarget({
            connectionId: connection.connection_id,
            folderId: currentFolderId,
            zone: event.clientY - rect.top >= rect.height / 2 ? 'after' : 'before'
          })
        }}
        onDrop={(event) => {
          const movingConnectionIds = draggingConnectionIdsRef.current
          if (movingConnectionIds.length === 0 || movingConnectionIds.includes(connection.connection_id)) {
            clearConnectionDragState()
            return
          }
          if (!currentFolderId || draggingConnectionFolderIdRef.current !== currentFolderId) {
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
          {connectionAddress && (
            <Typography.Text type="secondary" className="connection-tree-address" ellipsis title={connectionAddress}>
              {highlightTreeSearchText(connectionAddress)}
            </Typography.Text>
          )}
        </div>
        {(isFocused || isSelected) && (
          <Space className="connection-tree-actions" size={2}>
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

  const connectionTypeIcons: ConnectionTypeIcons = {
    postgresql: <img src={postgresIcon} alt="PG" style={{ width: 16, height: 16 }} />,
    gaussdb: <DatabaseOutlined />,
    mongodb: <img src={mongoIcon} alt="MongoDB" style={{ width: 16, height: 16 }} />,
    redis: <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} />,
    clickhouse: <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} />,
    oracle: <img src={oracleIcon} alt="Oracle" style={{ width: 16, height: 16 }} />,
    mysql: <img src={mysqlIcon} alt="MySQL" style={{ width: 16, height: 16 }} />,
    dm: <img src={dmIcon} alt="DM" style={{ width: 16, height: 16 }} />,
    sqlite: <img src={sqliteIcon} alt="SQLite" style={{ width: 16, height: 16 }} />
  }

  const buildConnectionNode = (connection: ConnectionInfo): DatabaseTreeNode =>
    buildConnectionNodeFromModule(connection, connectionTypeIcons)

  const buildFolderNode = (folder: ConnectionFolder, children: DatabaseTreeNode[]): DatabaseTreeNode =>
    buildFolderNodeFromModule(folder, children, FOLDER_DROP_PLACEHOLDER_KEY_PREFIX)

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

  const locateTreePath = async (targetPath?: string[]): Promise<void> => {
    await locateTreePathInView({
      targetPath,
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

  useEffect(() => {
    const keyword = treeSearchText.trim().toLowerCase()
    if (!keyword) {
      return
    }
    const path = findTreeKeyPathByPredicate(treeData, (node) => getTreeNodeCopyName(node).toLowerCase().includes(keyword))
    if (!path || path.length === 0) {
      return
    }
    setExpandedKeys((current) => Array.from(new Set([...current, ...path.slice(0, -1)])))
    setSelectedTreeKeys([path[path.length - 1]])
    const nodeMap = collectTreeNodesByKey(treeData)
    const targetNode = nodeMap.get(path[path.length - 1])
    if (targetNode) {
      setFocusedTreeNode(targetNode)
    }
    requestAnimationFrame(() => {
      const highlighted = resourceTreeViewportRef.current?.querySelector('.tree-search-highlight')
      highlighted?.scrollIntoView({ block: 'center' })
    })
  }, [treeData, treeSearchText])

  useEffect(() => {
    if (!treeSearchOpen) {
      return
    }
    requestAnimationFrame(() => {
      treeSearchInputRef.current?.focus()
    })
  }, [treeSearchOpen])

  const buildResourceTree = (nextConnections: ConnectionInfo[], currentNodes: DatabaseTreeNode[] = []): DatabaseTreeNode[] => {
    return buildResourceTreeFromModule(nextConnections, currentNodes, {
      connectionFolderAssignments,
      connectionFolders,
      folderConnectionOrder,
      rootItemOrder,
      rootFolderOrderId,
      rootConnectionOrderId,
      mergeOrderedIds,
      buildConnectionNode,
      buildFolderNode: (folder, children) => buildFolderNode(folder, children)
    })
  }

  const refreshTree = (nextConnections: ConnectionInfo[]): void => {
    setTreeData((current) => buildResourceTree(nextConnections, current))
  }

  useEffect(() => {
    refreshTree(connections)
  }, [connections, connectionFolders, connectionFolderAssignments, rootItemOrder, folderConnectionOrder])

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

      return current.length === next.length && current.every((item, index) => item === next[index]) ? current : next
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
      return current.length === next.length && current.every((item, index) => item === next[index]) ? current : next
    })
  }, [connections])

  const refreshConnectionNode = (connectionId: string, selectedDatabaseOverride?: string[]): void => {
    refreshConnectionTreeNode({
      connectionId,
      selectedDatabaseOverride,
      getConnection,
      expandedKeys,
      preloadConnectionTree,
      buildConnectionNode,
      setTreeData,
      setExpandedKeys,
      setConnectionTreeLoadingText,
      showError
    })
  }

  const refreshDatabaseNode = (connectionId: string, databaseName: string, selectedSchemaOverride?: string[]): void => {
    refreshDatabaseTreeNode({
      connectionId,
      databaseName,
      selectedSchemaOverride,
      getConnection,
      preloadDatabaseChildren,
      setTreeData,
      setConnectionTreeLoadingText,
      showError
    })
  }

  const setConnectionTreeLoadingText = (connectionId: string, text?: string): void => {
    setConnectionTreeLoading((current) => {
      if (!text) {
        const { [connectionId]: _removed, ...rest } = current
        return rest
      }
      return { ...current, [connectionId]: text }
    })
  }

  const folderNameExists = (name: string, excludeFolderId?: string): boolean =>
    connectionFolders.some((folder) => folder.id !== excludeFolderId && folder.name.trim().toLowerCase() === name.trim().toLowerCase())

  const openCreateFolderModal = (): void => {
    setFolderEditorMode('create')
    setEditingFolderId(undefined)
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
      setConnectionFolders((current) => current.map((folder) => (
        folder.id === editingFolderId ? { ...folder, name: nextName } : folder
      )))
    } else {
      const folderId = globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}`
      setConnectionFolders((current) => [{ id: folderId, name: nextName }, ...current])
      setConnectionFolderOrder((current) => [folderId, ...current.filter((id) => id !== folderId)])
      setExpandedKeys((current) => current.includes(`folder:${folderId}`) ? current : [...current, `folder:${folderId}`])
      setSelectedTreeKeys([`folder:${folderId}`])
    }

    setFolderEditorOpen(false)
    setEditingFolderId(undefined)
    setFolderNameDraft('')
  }

  const deleteFolder = (folderId: string): void => {
    const folder = connectionFolders.find((item) => item.id === folderId)
    if (!folder) {
      return
    }

    Modal.confirm({
      title: `删除分组“${folder.name}”`,
      content: '删除后，里面的连接会自动移回根目录，不会删除连接本身。是否继续？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      onOk: () => {
        setConnectionFolders((current) => current.filter((item) => item.id !== folderId))
        setConnectionFolderOrder((current) => current.filter((id) => id !== folderId))
        setFolderConnectionOrder((current) => {
          const { [folderId]: _removed, ...rest } = current
          return rest
        })
        setConnectionFolderAssignments((current) => Object.fromEntries(
          Object.entries(current).filter(([, value]) => value !== folderId)
        ))
        setExpandedKeys((current) => current.filter((key) => key !== `folder:${folderId}`))
        setSelectedTreeKeys((current) => current.filter((key) => key !== `folder:${folderId}`))
        setFocusedTreeNode((current) => current?.kind === 'folder' && current.folderId === folderId ? undefined : current)
      }
    })
  }

  const moveConnectionsToFolder = (connectionIds: string[], folderId?: string): void => {
    if (connectionIds.length === 0) {
      return
    }

    setConnectionFolderAssignments((current) => {
      const next = { ...current }
      for (const connectionId of connectionIds) {
        if (folderId) {
          next[connectionId] = folderId
        } else {
          delete next[connectionId]
        }
      }
      return next
    })

    setRootConnectionOrder((current) => {
      if (folderId) {
        return current.filter((id) => !connectionIds.includes(id))
      }
      const remaining = current.filter((id) => !connectionIds.includes(id))
      return [...remaining, ...connectionIds]
    })

    setRootItemOrder((current) => {
      const connectionItemIds = connectionIds.map(rootConnectionOrderId)
      if (folderId) {
        return current.filter((id) => !connectionItemIds.includes(id))
      }
      const remaining = current.filter((id) => !connectionItemIds.includes(id))
      return [...remaining, ...connectionItemIds]
    })

    setFolderConnectionOrder((current) => {
      const next: Record<string, string[]> = Object.fromEntries(
        Object.entries(current).map(([currentFolderId, ids]) => [currentFolderId, ids.filter((id) => !connectionIds.includes(id))])
      )

      if (folderId) {
        next[folderId] = [...(next[folderId] ?? []), ...connectionIds.filter((id) => !(next[folderId] ?? []).includes(id))]
      }

      return next
    })
  }

  const reorderFolderNodes = (movingFolderId: string, targetFolderId: string, placeAfter: boolean): void => {
    setConnectionFolderOrder((current) => {
      const ordered = mergeOrderedIds(connectionFolders.map((folder) => folder.id), current)
      return insertIdsAroundTarget(ordered, [movingFolderId], targetFolderId, placeAfter)
    })
    setRootItemOrder((current) => {
      const available = [
        ...connectionFolders.map((folder) => rootFolderOrderId(folder.id)),
        ...connections
          .filter((connection) => !connectionFolderAssignments[connection.connection_id])
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ]
      return insertIdsAroundTarget(mergeOrderedIds(available, current), [rootFolderOrderId(movingFolderId)], rootFolderOrderId(targetFolderId), placeAfter)
    })
  }

  const reorderRootFolderAroundConnection = (movingFolderId: string, targetConnectionId: string, placeAfter: boolean): void => {
    if (connectionFolderAssignments[targetConnectionId]) {
      return
    }

    setRootItemOrder((current) => {
      const available = [
        ...connectionFolders.map((folder) => rootFolderOrderId(folder.id)),
        ...connections
          .filter((connection) => !connectionFolderAssignments[connection.connection_id])
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ]
      return insertIdsAroundTarget(mergeOrderedIds(available, current), [rootFolderOrderId(movingFolderId)], rootConnectionOrderId(targetConnectionId), placeAfter)
    })
  }

  const reorderRootConnections = (movingConnectionIds: string[], targetConnectionId: string, placeAfter: boolean): void => {
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
          .filter((connection) => !connectionFolderAssignments[connection.connection_id] || movingConnectionIds.includes(connection.connection_id))
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ]
      return insertIdsAroundTarget(mergeOrderedIds(available, current), movingConnectionIds.map(rootConnectionOrderId), rootConnectionOrderId(targetConnectionId), placeAfter)
    })
  }

  const reorderRootConnectionsAroundFolder = (movingConnectionIds: string[], targetFolderId: string, placeAfter: boolean): void => {
    const movableConnectionIds = movingConnectionIds.filter((connectionId) => !connectionFolderAssignments[connectionId])
    if (movableConnectionIds.length === 0) {
      return
    }
    setRootItemOrder((current) => {
      const available = [
        ...connectionFolders.map((folder) => rootFolderOrderId(folder.id)),
        ...connections
          .filter((connection) => !connectionFolderAssignments[connection.connection_id])
          .map((connection) => rootConnectionOrderId(connection.connection_id))
      ]
      return insertIdsAroundTarget(mergeOrderedIds(available, current), movableConnectionIds.map(rootConnectionOrderId), rootFolderOrderId(targetFolderId), placeAfter)
    })
  }

  const reorderFolderConnections = (folderId: string, movingConnectionIds: string[], targetConnectionId: string, placeAfter: boolean): void => {
    const movableConnectionIds = movingConnectionIds.filter((connectionId) => connectionFolderAssignments[connectionId] === folderId)
    if (movableConnectionIds.length === 0) {
      return
    }
    setFolderConnectionOrder((current) => {
      const folderIds = Array.from(new Set([
        ...(current[folderId] ?? []),
        ...connections
          .filter((connection) => connectionFolderAssignments[connection.connection_id] === folderId)
          .map((connection) => connection.connection_id)
      ])).filter((connectionId) => connections.some((connection) => connection.connection_id === connectionId))
      const ordered = mergeOrderedIds(folderIds, current[folderId] ?? [])
      return {
        ...current,
        [folderId]: insertIdsAroundTarget(ordered, movableConnectionIds, targetConnectionId, placeAfter)
      }
    })
  }

  const getVisibleFolderConnectionOrder = (folderId: string, movingConnectionIds: string[]): string[] => {
    const movingSet = new Set(movingConnectionIds)
    const treeElement = resourceTreeViewportRef.current
    if (!treeElement) {
      return []
    }

    return Array.from(treeElement.querySelectorAll<HTMLElement>('.connection-tree-title[data-connection-id]'))
      .map((titleElement) => {
        const connectionId = titleElement.dataset.connectionId
        const rect = titleElement.getBoundingClientRect()
        return connectionId
          && connectionFolderAssignments[connectionId] === folderId
          && !movingSet.has(connectionId)
          && rect.height > 0
          && rect.width > 0
          ? { connectionId, titleElement, rect }
          : undefined
      })
      .filter((item): item is { connectionId: string; titleElement: HTMLElement; rect: DOMRect } => Boolean(item))
      .sort((left, right) => left.rect.top - right.rect.top)
      .map((item) => item.connectionId)
  }

  const reorderFolderConnectionsByPointer = (folderId: string, movingConnectionIds: string[], clientY: number): boolean => {
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
    const visibleIndexById = new Map(visibleOrderedIds.map((connectionId, index) => [connectionId, index]))
    const stationaryVisibleIds = stationaryIds.filter((connectionId) => visibleIndexById.has(connectionId))
    if (stationaryVisibleIds.length === 0) {
      return false
    }

    const treeElement = resourceTreeViewportRef.current
    if (!treeElement) {
      return false
    }

    const rowElements = Array.from(treeElement.querySelectorAll<HTMLElement>('.connection-tree-title[data-connection-id]'))
      .filter((element) => {
        const connectionId = element.dataset.connectionId
        return connectionId ? stationaryVisibleIds.includes(connectionId) : false
      })
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)

    const insertVisibleIndex = rowElements.findIndex((element) => clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2)
    const targetVisibleIndex = insertVisibleIndex >= 0 ? insertVisibleIndex : stationaryVisibleIds.length
    const beforeIds = stationaryVisibleIds.slice(0, targetVisibleIndex)
    const afterIds = stationaryVisibleIds.slice(targetVisibleIndex)
    const hiddenIds = stationaryIds.filter((connectionId) => !visibleIndexById.has(connectionId))
    const nextOrder = [...beforeIds, ...movingConnectionIds, ...afterIds, ...hiddenIds]

    if (stringArrayEquals(currentOrder, nextOrder)) {
      return false
    }

    setFolderConnectionOrder((current) => (
      stringArrayEquals(current[folderId] ?? [], nextOrder)
        ? current
        : {
            ...current,
            [folderId]: nextOrder
          }
    ))
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

  const allowTreeDrop = (): boolean => true

  const updateDragOverFolderTarget = (target?: { folderId: string; zone: 'before' | 'after' }): void => {
    dragOverFolderTargetRef.current = target
    setDragOverFolderTarget((current) => (
      current?.folderId === target?.folderId && current?.zone === target?.zone ? current : target
    ))
  }

  const updateDragOverConnectionTarget = (target?: { connectionId: string; folderId?: string; zone: 'before' | 'after' }): void => {
    dragOverConnectionTargetRef.current = target
    setDragOverConnectionTarget((current) => (
      current?.connectionId === target?.connectionId
      && current?.folderId === target?.folderId
      && current?.zone === target?.zone
        ? current
        : target
    ))
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
    event?: React.MouseEvent<HTMLElement>
  }): void => {
    const targetNode = info.node as DatabaseTreeNode
    const draggedNode = info.dragNode as DatabaseTreeNode
    const dropPosition = info.dropPosition ?? 0
    const relativeDropPosition = getRelativeDropPosition(targetNode, dropPosition)
    const placeAfter = relativeDropPosition > 0

    const targetFolderId = targetNode.folderId ?? (String(targetNode.key).startsWith('folder:') ? String(targetNode.key).slice('folder:'.length) : undefined)
    const targetConnectionId = targetNode.connectionId ?? (String(targetNode.key).startsWith('connection:') ? String(targetNode.key).slice('connection:'.length) : undefined)
    const draggedFolderId = draggedNode.folderId ?? (String(draggedNode.key).startsWith('folder:') ? String(draggedNode.key).slice('folder:'.length) : undefined)
    const draggedConnectionId = draggedNode.connectionId ?? (String(draggedNode.key).startsWith('connection:') ? String(draggedNode.key).slice('connection:'.length) : undefined)
    const targetNodeKind = getTreeNodeKindFromKey(targetNode)
    const folderDragTarget = dragOverFolderTargetRef.current
    const dropConnectionElement = info.event?.target instanceof HTMLElement
      ? info.event.target.closest<HTMLElement>('[data-connection-id]')
      : undefined
    const dropConnectionId = dropConnectionElement?.dataset.connectionId
    const dropConnectionTarget = dropConnectionId
      ? {
          connectionId: dropConnectionId,
          folderId: connectionFolderAssignments[dropConnectionId],
          zone: (() => {
            const rect = dropConnectionElement.getBoundingClientRect()
            return info.event && info.event.clientY - rect.top >= rect.height / 2 ? 'after' as const : 'before' as const
          })()
        }
      : undefined
    const connectionDragTarget = dropConnectionTarget ?? dragOverConnectionTargetRef.current
    updateDragOverFolderTarget(undefined)
    updateDragOverConnectionTarget(undefined)

    if ((draggedNode.kind === 'folder' || draggedFolderId) && draggedFolderId) {
      if (connectionDragTarget) {
        reorderRootFolderAroundConnection(draggedFolderId, connectionDragTarget.connectionId, connectionDragTarget.zone === 'after')
        return
      }
      if (targetConnectionId) {
        reorderRootFolderAroundConnection(draggedFolderId, targetConnectionId, placeAfter)
        return
      }
      if (folderDragTarget && draggedFolderId !== folderDragTarget.folderId) {
        reorderFolderNodes(draggedFolderId, folderDragTarget.folderId, folderDragTarget.zone === 'after')
        return
      }
      if ((targetNodeKind === 'folder' || targetFolderId) && targetFolderId && draggedFolderId !== targetFolderId && relativeDropPosition !== 0) {
        reorderFolderNodes(draggedFolderId, targetFolderId, placeAfter)
      }
      return
    }

    if ((draggedNode.kind !== 'connection' && !draggedConnectionId) || !draggedConnectionId) {
      return
    }

    const movingConnectionIds = selectedConnectionIds.includes(draggedConnectionId)
      ? selectedConnectionIds
      : [draggedConnectionId]

    const draggedConnectionFolderId = connectionFolderAssignments[draggedConnectionId]
    if (connectionDragTarget && !movingConnectionIds.includes(connectionDragTarget.connectionId)) {
      const targetConnectionFolderId = connectionDragTarget.folderId ?? connectionFolderAssignments[connectionDragTarget.connectionId]
      if (targetConnectionFolderId) {
        if (draggedConnectionFolderId === targetConnectionFolderId) {
          reorderFolderConnections(targetConnectionFolderId, movingConnectionIds, connectionDragTarget.connectionId, connectionDragTarget.zone === 'after')
        }
      } else if (!draggedConnectionFolderId) {
        reorderRootConnections(movingConnectionIds, connectionDragTarget.connectionId, connectionDragTarget.zone === 'after')
      }
      return
    }

    if (targetNodeKind === 'connection' || targetConnectionId) {
      if (!targetConnectionId || movingConnectionIds.includes(targetConnectionId)) {
        return
      }
      const targetConnectionFolderId = targetNode.folderId ?? connectionFolderAssignments[targetConnectionId]
      if (targetConnectionFolderId) {
        if (draggedConnectionFolderId === targetConnectionFolderId) {
          reorderFolderConnections(targetConnectionFolderId, movingConnectionIds, targetConnectionId, placeAfter)
        }
      } else {
        if (!draggedConnectionFolderId) {
          reorderRootConnections(movingConnectionIds, targetConnectionId, placeAfter)
        }
      }
      return
    }

    if (draggedConnectionFolderId && info.event) {
      if (reorderFolderConnectionsByPointer(draggedConnectionFolderId, movingConnectionIds, info.event.clientY)) {
        return
      }
    }

    if (folderDragTarget && !targetConnectionId) {
      reorderRootConnectionsAroundFolder(movingConnectionIds, folderDragTarget.folderId, folderDragTarget.zone === 'after')
      return
    }

    if (info.dropToGap) {
      if ((targetNodeKind === 'folder' || targetFolderId) && targetFolderId && relativeDropPosition !== 0) {
        reorderRootConnectionsAroundFolder(movingConnectionIds, targetFolderId, placeAfter)
        return
      }
    }
  }

  const updateWorkspaceTab = useCallback((key: string, patch: Partial<WorkspaceTab>): void => {
    setWorkspaceTabs((current) => current.map((tab) => {
      if (tab.key !== key) {
        return tab
      }

      const patchEntries = Object.entries(patch) as Array<[keyof WorkspaceTab, WorkspaceTab[keyof WorkspaceTab]]>
      if (patchEntries.every(([patchKey, patchValue]) => Object.is(tab[patchKey], patchValue))) {
        return tab
      }

      return { ...tab, ...patch }
    }))
  }, [])

  const scheduleQuerySqlDraftCommit = useCallback((key: string, sql: string): void => {
    const currentTimer = querySqlDraftTimersRef.current[key]
    if (currentTimer) {
      window.clearTimeout(currentTimer)
    }
    querySqlDraftTimersRef.current[key] = window.setTimeout(() => {
      querySqlDraftTimersRef.current[key] = undefined
      setWorkspaceTabs((current) => current.map((tab) => (
        tab.key === key && tab.sql !== sql
          ? { ...tab, sql }
          : tab
      )))
    }, 180)
  }, [])

  const updateWorkspaceTabColumnWidth = (tabKey: string, column: string, width: number): void => {
    const nextWidth = clampResultColumnWidth(width)
    setWorkspaceTabs((current) => current.map((tab) => {
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
    }))
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
      element.style.flex = `0 0 ${nextWidth}`
      element.style.width = nextWidth
      element.style.minWidth = nextWidth
      element.style.maxWidth = nextWidth
    })
  }

  const renameWorkspaceTab = useCallback((key: string, title: string): void => {
    updateWorkspaceTab(key, { title })
  }, [updateWorkspaceTab])

  const persistQueryWorkspace = (tab: WorkspaceTab): void => {
    if (tab.kind !== 'query') {
      return
    }
    const sql = tab.sql ?? ''
    const connection = getConnection(tab.connectionId)
    const nextItem: PersistedQueryWorkspace = {
      key: tab.key,
      title: tab.title,
      connectionId: tab.connectionId,
      connectionName: connection?.name,
      databaseName: tab.databaseName,
      pgDatabaseName: tab.pgDatabaseName,
      sql,
      limit: tab.limit,
      queryEditorHeight: tab.queryEditorHeight,
      persistedAt: tab.persistedAt ?? Date.now()
    }
    setPersistedQueryWorkspaces((current) => {
      const currentItem = current.find((item) => item.key === tab.key)
      if (
        currentItem
        && currentItem.title === nextItem.title
        && currentItem.connectionId === nextItem.connectionId
        && currentItem.connectionName === nextItem.connectionName
        && currentItem.databaseName === nextItem.databaseName
        && currentItem.pgDatabaseName === nextItem.pgDatabaseName
        && currentItem.sql === nextItem.sql
        && currentItem.limit === nextItem.limit
        && currentItem.queryEditorHeight === nextItem.queryEditorHeight
      ) {
        return current
      }
      const next = [nextItem, ...current.filter((item) => item.key !== tab.key)]
      return next.slice(0, 200)
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
      queryWorkspacePersistTimersRef.current[tab.key] = window.setTimeout(() => {
        queryWorkspacePersistTimersRef.current[tab.key] = undefined
        persistQueryWorkspaceRef.current(tab)
      }, tab.sql ? 220 : 0)
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
  }, [getWorkspaceTabs, workspaceTabSummaryCount])

  useEffect(() => () => {
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
  }, [])

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
            {[item.connectionName ?? getConnection(item.connectionId)?.name ?? '未绑定连接', schemaPath || '未选择库'].join(' · ')}
          </div>
          <div className="query-history-delete-confirm-hint">删除后将从历史查询列表中移除，且无法恢复。</div>
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

  const getImmediateTableSearchState = (tab: WorkspaceTab): TableSearchUiState =>
    tableSearchUiState[tab.key] ?? getDefaultTableSearchUiState(tab)

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
      previousState.visible === nextState.visible
      && previousState.query === nextState.query
      && previousState.caseSensitive === nextState.caseSensitive
      && previousState.regex === nextState.regex
      && previousState.wholeWord === nextState.wholeWord
      && previousState.filterRows === nextState.filterRows
      && previousState.activeMatchIndex === nextState.activeMatchIndex
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
    if (currentCellKeys.length === cellKeys.length && currentCellKeys.every((key, index) => key === cellKeys[index])) {
      return
    }
    selectedCellRefs.current[tabKey] = cellKeys.length > 0 ? cellKeys : undefined
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
      if (displayValue !== undefined) {
        current.host.textContent = displayValue
      } else {
        current.host.textContent = current.originalContent
      }
      current.host.classList.remove('editable-cell-inline-editing')
    }
    inlineCellEditorRefs.current[tabKey] = undefined
  }

  const closeEditingCell = (tabKey: string, displayValue?: string): void => {
    closeInlineCellEditor(tabKey, displayValue)
    requestAnimationFrame(() => {
      committingEditingCellRefs.current[tabKey] = undefined
      syncRenderedCellSelection(tabKey)
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
    closeEditingCell(tabKey, cellDisplayText(current.originalValue))
    editingCellRefs.current[tabKey] = undefined
    suppressInlineEditorCommitRefs.current[tabKey] = undefined
  }

  const commitInlineCellEditor = (tabKey: string): void => {
    const current = inlineCellEditorRefs.current[tabKey]
    if (!current || committingEditingCellRefs.current[tabKey]) {
      return
    }
    if (suppressInlineEditorCommitRefs.current[tabKey]) {
      suppressInlineEditorCommitRefs.current[tabKey] = undefined
      closeEditingCell(tabKey, cellDisplayText(current.originalValue))
      editingCellRefs.current[tabKey] = undefined
      return
    }
    committingEditingCellRefs.current[tabKey] = true
    const nextValue = current.input.value
    const { rowKey, column } = current
    if (nextValue === current.initialInputValue) {
      closeEditingCell(tabKey, cellDisplayText(current.originalValue))
      editingCellRefs.current[tabKey] = undefined
      return
    }
    const nextEditableValue = editableValue(nextValue)
    editingCellRefs.current[tabKey] = undefined
    flushSync(() => {
      updatePreviewCell(tabKey, rowKey, column, nextEditableValue)
    })
    closeEditingCell(tabKey, cellDisplayText(nextEditableValue))
  }

  const openInlineCellEditor = (tabKey: string, rowKey: string, column: string, host: HTMLElement, rawValue: unknown): void => {
    closeInlineCellEditor(tabKey)
    clearRenderedCellSelection(tabKey)
    rowDragAnchorRefs.current[tabKey] = undefined
    cellDragAnchorRefs.current[tabKey] = undefined
    pendingCellDragTargetRefs.current[tabKey] = undefined
    runtimeSelectedCellRefs.current[tabKey] = undefined
    const originalContent = host.textContent ?? ''
    const input = document.createElement('input')
    input.className = 'editable-cell-dom-input'
    const initialInputValue = rawValue === null || rawValue === undefined || isDefaultValueMarker(rawValue) ? '' : String(rawValue)
    input.value = initialInputValue
    input.dataset.columnKey = column
    input.dataset.rowKey = rowKey
    input.dataset.cellKey = `${rowKey}:${column}`
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('mousedown', (event) => event.stopPropagation())
    input.addEventListener('mouseup', (event) => event.stopPropagation())
    input.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('dblclick', (event) => event.stopPropagation())
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commitInlineCellEditor(tabKey)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeEditingCell(tabKey, cellDisplayText(rawValue))
      }
    })
    input.addEventListener('blur', () => commitInlineCellEditor(tabKey))
    host.textContent = ''
    host.classList.add('editable-cell-inline-editing')
    host.appendChild(input)
    inlineCellEditorRefs.current[tabKey] = { rowKey, column, input, host, originalContent, originalValue: rawValue, initialInputValue }
    editingCellRefs.current[tabKey] = { rowKey, column }
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }

  const getResultTableVirtualInner = (tabKey: string): HTMLDivElement | null => (
    tableBodyRefs.current[tabKey]?.querySelector<HTMLDivElement>('.ant-table-tbody-virtual-holder-inner') ?? null
  )

  const getResultTableVirtualHolder = (tabKey: string): HTMLDivElement | null => (
    tableBodyRefs.current[tabKey]?.querySelector<HTMLDivElement>('.ant-table-tbody-virtual-holder') ?? null
  )

  const getResultTableVirtualScrollLeft = (tabKey: string): number => {
    const header = tableHeaderRefs.current[tabKey]
    if (header && Number.isFinite(header.scrollLeft)) {
      return Math.max(0, header.scrollLeft)
    }
    const holder = getResultTableVirtualHolder(tabKey)
    if (holder && Number.isFinite(holder.scrollLeft)) {
      return Math.max(0, holder.scrollLeft)
    }
    const virtualInner = getResultTableVirtualInner(tabKey)
    if (!virtualInner) {
      return 0
    }
    const marginLeft = Number.parseFloat(virtualInner.style.marginLeft || '0')
    return Number.isFinite(marginLeft) ? Math.max(0, -marginLeft) : 0
  }

  const detachNativeHorizontalScrollbarSync = (tabKey: string): void => {
    tableNativeHorizontalScrollbarCleanupRefs.current[tabKey]?.()
    delete tableNativeHorizontalScrollbarCleanupRefs.current[tabKey]
    if (tableNativeHorizontalScrollbarFrameRefs.current[tabKey]) {
      window.cancelAnimationFrame(tableNativeHorizontalScrollbarFrameRefs.current[tabKey]!)
      delete tableNativeHorizontalScrollbarFrameRefs.current[tabKey]
    }
  }

  const attachNativeHorizontalScrollbarSync = (tabKey: string): void => {
    detachNativeHorizontalScrollbarSync(tabKey)
    const scrollbar = tableNativeHorizontalScrollbarRefs.current[tabKey]
    const virtualHolder = getResultTableVirtualHolder(tabKey)
    const header = tableHeaderRefs.current[tabKey]
    if (!scrollbar || !virtualHolder) {
      return
    }

    let syncingFromNative = false
    let syncingFromVirtual = false

    const syncNativeFromVirtual = (): void => {
      if (syncingFromNative) {
        return
      }
      const nextScrollLeft = getResultTableVirtualScrollLeft(tabKey)
      if (Math.abs(scrollbar.scrollLeft - nextScrollLeft) <= 1) {
        return
      }
      syncingFromVirtual = true
      scrollbar.scrollLeft = nextScrollLeft
      syncingFromVirtual = false
    }

    const syncVirtualFromNative = (): void => {
      if (syncingFromVirtual) {
        return
      }
      syncingFromNative = true
      tableComponentRefs.current[tabKey]?.scrollTo?.({ left: scrollbar.scrollLeft })
      requestAnimationFrame(() => {
        syncingFromNative = false
        syncNativeFromVirtual()
      })
    }

    scrollbar.addEventListener('scroll', syncVirtualFromNative, { passive: true })
    virtualHolder.addEventListener('scroll', syncNativeFromVirtual, { passive: true })
    header?.addEventListener('scroll', syncNativeFromVirtual, { passive: true })

    syncNativeFromVirtual()

    tableNativeHorizontalScrollbarCleanupRefs.current[tabKey] = () => {
      scrollbar.removeEventListener('scroll', syncVirtualFromNative)
      virtualHolder.removeEventListener('scroll', syncNativeFromVirtual)
      header?.removeEventListener('scroll', syncNativeFromVirtual)
    }
  }

  const scheduleNativeHorizontalScrollbarSync = (tabKey: string): void => {
    if (tableNativeHorizontalScrollbarFrameRefs.current[tabKey]) {
      window.cancelAnimationFrame(tableNativeHorizontalScrollbarFrameRefs.current[tabKey]!)
    }
    tableNativeHorizontalScrollbarFrameRefs.current[tabKey] = window.requestAnimationFrame(() => {
      tableNativeHorizontalScrollbarFrameRefs.current[tabKey] = undefined
      attachNativeHorizontalScrollbarSync(tabKey)
    })
  }

  useEffect(() => () => {
    Object.keys(tableNativeHorizontalScrollbarCleanupRefs.current).forEach((key) => {
      detachNativeHorizontalScrollbarSync(key)
    })
  }, [])

  useEffect(() => {
    const finishColumnResize = (pointerId?: number): void => {
      const resizeEntries = Object.entries(columnResizeRefs.current).filter((entry): entry is [string, NonNullable<(typeof columnResizeRefs.current)[string]>] => Boolean(entry[1]))
      if (resizeEntries.length === 0) {
        document.body.classList.remove('column-resizing')
        return
      }

      const matchedEntries = resizeEntries.filter(([, resizeState]) => (
        typeof pointerId !== 'number' || resizeState.pointerId === pointerId
      ))

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
          applyLiveColumnWidth(finalWidth, resizeState.columnIndex, resizeState.headerCells, resizeState.headerColElements, resizeState.bodyColElements)
        }
      })

      flushSync(() => {
        matchedEntries.forEach(([, resizeState]) => {
          updateWorkspaceTabColumnWidth(resizeState.tabKey, resizeState.column, resizeState.lastWidth)
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
      const resizeState = Object.values(columnResizeRefs.current).find((item) => item?.pointerId === event.pointerId)
      if (!resizeState) {
        return
      }
      event.preventDefault()
      const nextWidth = clampResultColumnWidth(resizeState.startWidth + (event.clientX - resizeState.startX))
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
          return
        }
        applyLiveColumnWidth(pendingWidth, resizeState.columnIndex, resizeState.headerCells, resizeState.headerColElements, resizeState.bodyColElements)
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
      if (target?.closest('.tree-context-menu-panel') || target?.closest('.ant-menu-submenu-popup')) {
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
      const nextSize = Math.min(500, Math.max(220, resizeState.startSize + (event.clientX - resizeState.startX)))
      const boundedSize = Math.min(nextSize, Math.max(220, shellWidth - (aiPanelOpen ? aiPanelSize : 0) - 260))
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
      const nextSize = Math.min(720, Math.max(260, resizeState.startSize - (event.clientX - resizeState.startX)))
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

  const closeWorkspaceTab = useCallback((key: string): void => {
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
    delete rowSelectionDraftRefs.current[key]
    delete pendingRowDragTargetRefs.current[key]
    delete pendingRowDragFrameRefs.current[key]
    delete pendingCellDragTargetRefs.current[key]
    delete pendingCellDragFrameRefs.current[key]
    if (pendingRenderedCellSelectionTimeoutRefs.current[key]) {
      window.clearTimeout(pendingRenderedCellSelectionTimeoutRefs.current[key])
      delete pendingRenderedCellSelectionTimeoutRefs.current[key]
    }
    detachNativeHorizontalScrollbarSync(key)
    delete tableComponentRefs.current[key]
    delete tableNativeHorizontalScrollbarRefs.current[key]
    cellInspectorPanelRefs.current[key]?.close()
    delete cellInspectorPanelRefs.current[key]
    delete selectedColumnRefs.current[key]
    delete tableBodyRefs.current[key]
    delete tableHeaderRefs.current[key]
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
  }, [setActiveTabKey, setWorkspaceTabs])

  const handleSqlExecutionContextChange = useCallback((tabKey: string, payload: SqlEditorExecutionContext): void => {
    const nextStructureKey = buildStatementStructureKey(payload.statements)
    const previousStructureKey = sqlExecutionContextStructureKeyRef.current[tabKey] ?? ''
    sqlExecutionContextRef.current[tabKey] = payload
    sqlExecutionContextStructureKeyRef.current[tabKey] = nextStructureKey
    setSqlExecutionContextByTab((current) => {
      const previous = current[tabKey]
      if (
        previous
        && previous.currentStatementIndex === payload.currentStatementIndex
        && previousStructureKey === nextStructureKey
      ) {
        return current
      }
      return {
        ...current,
        [tabKey]: payload
      }
    })
  }, [])

  const connectionMap = useMemo(() => new Map(connections.map((connection) => [connection.connection_id, connection])), [connections])
  const getConnection = useCallback((connectionId?: string): ConnectionInfo | undefined => (
    connectionId ? connectionMap.get(connectionId) : undefined
  ), [connectionMap])
  const {
    enableVirtualTree,
    resourceTreeHeight
  } = useResourceTreeViewport({
    treeData,
    resourceTreeViewportRef
  })
  const resourceTreeToolbarItems = useMemo(() => ([
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
  ]), [locateActiveTreeNode, treeSearchOpen])
  const deferredTreeData = useDeferredValue(treeData)
  const queryHistoryGroups = useMemo(() => {
    const groups = persistedQueryWorkspaces.reduce<Record<string, PersistedQueryWorkspace[]>>((current, item) => {
      const connectionName = getConnection(item.connectionId)?.name ?? item.connectionName ?? '未绑定连接'
      if (!current[connectionName]) {
        current[connectionName] = []
      }
      current[connectionName].push(item)
      return current
    }, {})

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
    const index = new Map<string, { tables: SqlCompletionTable[]; columns: SqlCompletionColumn[] }>()

    const getScopeKey = (connectionId: string, databaseName?: string, pgDatabaseName?: string): string =>
      `${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}`

    const ensureScope = (scopeKey: string): { tables: SqlCompletionTable[]; columns: SqlCompletionColumn[] } => {
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
          const databaseName = isSchemaScopedType(connection?.database_type) ? node.pgDatabaseName : node.databaseName
          const schemaName = isSchemaScopedType(connection?.database_type) ? node.databaseName : undefined
          const scope = ensureScope(getScopeKey(node.connectionId, node.databaseName, node.pgDatabaseName))
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

    if (connection && !connection.is_open) {
      return false
    }

    return true
  }

  const withDatabaseQuery = (path: string, databaseName?: string): string => {
    if (!databaseName) {
      return path
    }

    return `${path}?database=${encodeURIComponent(databaseName)}`
  }

  const withPgDatabase = useCallback((path: string, databaseName?: string, pgDatabaseName?: string): string => {
    const params: string[] = []

    if (databaseName) {
      params.push(`database=${encodeURIComponent(databaseName)}`)
    }

    if (pgDatabaseName) {
      params.push(`pg_database=${encodeURIComponent(pgDatabaseName)}`)
    }

    return params.length > 0 ? `${path}?${params.join('&')}` : path
  }, [])

  const withPageQuery = (path: string, limit: number, page = 1): string => {
    const offset = Math.max(0, page - 1) * limit
    return `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`
  }

  const withWhereQuery = (path: string, where?: string): string => {
    const condition = where?.trim()
    return condition ? `${path}${path.includes('?') ? '&' : '?'}where=${encodeURIComponent(condition)}` : path
  }

  const withSortQuery = (path: string, sortState?: { column: string; direction: 'ascend' | 'descend' }): string => {
    if (!sortState?.column) {
      return path
    }
    const params = [
      `sort_column=${encodeURIComponent(sortState.column)}`,
      `sort_direction=${encodeURIComponent(sortState.direction)}`
    ]
    return `${path}${path.includes('?') ? '&' : '?'}${params.join('&')}`
  }

  const quoteTableName = (connectionId: string, tableName: string, databaseName?: string): string => {
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
    const nodeKeys = selectedTreeKeys.length > 0
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

  const contextSourceId = (source: Pick<AIContextSource, 'type' | 'connectionId' | 'database' | 'schema' | 'pgDatabase'>): string =>
    [source.type, source.connectionId, source.pgDatabase ?? '', source.database ?? '', source.schema ?? ''].join(':')

  const buildAIContextSourceFromNode = (node: DatabaseTreeNode): AIContextSource | undefined => {
    if (!node.connectionId || (node.kind !== 'database' && node.kind !== 'pg-schema')) {
      return undefined
    }

    const connection = getConnection(node.connectionId)
    if (!connection) {
      return undefined
    }

    const source: AIContextSource = {
      id: '',
      type: node.kind === 'pg-schema' ? 'schema' : 'database',
      connectionId: node.connectionId,
      connectionName: connection.name,
      dbType: connection.database_type,
      database: node.kind === 'pg-schema' ? node.pgDatabaseName : node.databaseName,
      schema: node.kind === 'pg-schema' ? node.databaseName : undefined,
      pgDatabase: node.kind === 'pg-schema' ? node.pgDatabaseName : isSchemaScopedType(connection.database_type) ? node.databaseName : undefined,
      sizeDisplay: node.sizeDisplay,
      sizeBytes: node.sizeBytes,
      storageSizeDisplay: node.storageSizeDisplay,
      storageSizeBytes: node.storageSizeBytes
    }
    source.id = contextSourceId(source)
    return source
  }

  const addAIContextSource = (node: DatabaseTreeNode): void => {
    const source = buildAIContextSourceFromNode(node)
    if (!source) {
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
          databaseName: isDatabaseScopedType(connection.database_type) || connection.database_type === 'dm' || connection.database_type === 'oracle' ? getDefaultDatabaseName(connection) : undefined,
          pgDatabaseName: isSchemaScopedType(connection.database_type) ? getDefaultPgDatabase(connection) : undefined
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
          databaseName: isSchemaScopedType(connection.database_type) ? getDefaultPgSchema(schemas) : node.databaseName,
          pgDatabaseName: isSchemaScopedType(connection.database_type) ? node.databaseName : undefined
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

    if ((node.kind === 'table' || node.kind === 'db-object' || node.kind === 'object-group') && (node.databaseName || node.pgDatabaseName)) {
      startTransition(() => {
        setAiActiveContext({
          connectionId,
          databaseName: node.databaseName,
          pgDatabaseName: node.pgDatabaseName
        })
      })
    }
  }

  const openTableQuery = (connectionId: string, tableName: string, databaseName?: string, pgDatabaseName?: string): void => {
    setSelectedConnectionId(connectionId)
    const connection = getConnection(connectionId)
    const sql = connection?.database_type === 'mongodb' || connection?.database_type === 'redis'
      ? quoteTableName(connectionId, tableName, databaseName)
      : `select * from ${quoteTableName(connectionId, tableName, databaseName)} limit 1000;`
    openQueryWorkspace(sql, `${tableName} 查询`, connectionId, databaseName, pgDatabaseName)
  }

  const openTableEditor = async (connectionId: string, tableName: string, databaseName?: string, pgDatabaseName?: string): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    setEditingConnectionId(connectionId)
    setEditingDatabaseName(databaseName)
    setEditingPgDatabaseName(pgDatabaseName)
    setEditingTableName(tableName)
    setEditingTableComment('')
    setEditingColumns([])
    setTableEditorOpen(true)
    setTableEditorLoading(true)

    try {
      const data = await requestJson<ColumnsResponse>(withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns`, databaseName, pgDatabaseName))
      setEditingTableComment(data.table_comment ?? '')
      setEditingColumns(data.columns.map(toColumnDef))
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载字段失败')
    } finally {
      setTableEditorLoading(false)
    }
  }

  const saveTableEditor = async (): Promise<void> => {
    if (!editingConnectionId || !editingTableName) {
      return
    }

    if (!ensureConnectionOpen(editingConnectionId)) {
      return
    }

    setTableEditorLoading(true)

    try {
      const data = await requestJson<ColumnsResponse>(withPgDatabase(`/connections/${editingConnectionId}/tables/${encodeURIComponent(editingTableName)}/columns`, editingDatabaseName, editingPgDatabaseName), {
        method: 'PUT',
        body: JSON.stringify({
          table_comment: editingTableComment.trim() || null,
          columns: editingColumns.map((column) => ({
            name: column.name,
            type: column.type,
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
      })
      setEditingTableComment(data.table_comment ?? '')
      setEditingColumns(data.columns.map(toColumnDef))
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
    const selected = selectedDatabases[connectionId] ?? dbList

    if (dbList.length === 0) {
      return null
    }

    const handleCommit = (nextSelected: string[]): void => {
      const currentSelected = selectedDatabasesRef.current[connectionId] ?? selected
      const changed = !stringArrayEquals(
        [...currentSelected].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })),
        [...nextSelected].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
      )
      setSelectedDatabases((current) => {
        const next = { ...current, [connectionId]: nextSelected }
        selectedDatabasesRef.current = next
        return next
      })
      if (changed) {
        refreshConnectionNode(connectionId, nextSelected)
      }
    }

    return (
      <TreeSelectorPopover options={dbList} selectedValues={selected} onCommit={handleCommit} />
    )
  }

  const renderAIContextButton = (node: DatabaseTreeNode): React.ReactNode => {
    if (node.kind !== 'database' && node.kind !== 'pg-schema') {
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
    if (key === 'move-root') {
      moveConnectionsToFolder(targetConnectionIds, undefined)
    }
    if (key.startsWith('move-folder:')) {
      const folderId = key.slice('move-folder:'.length)
      if (connectionFolders.some((folder) => folder.id === folderId)) {
        moveConnectionsToFolder(targetConnectionIds, folderId)
        setExpandedKeys((current) => current.includes(`folder:${folderId}`) ? current : [...current, `folder:${folderId}`])
      }
    }
  }

  const getDatabaseContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if ((!node.connectionId || !node.databaseName) || (node.kind !== 'database' && node.kind !== 'pg-schema')) {
      return []
    }

    const connection = getConnection(node.connectionId)
    const isPgDb = node.kind === 'database' && isSchemaScopedType(connection?.database_type)

    return [
      { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
      ...(isPgDb ? [{ key: 'new-schema', label: '新建模式', icon: <PlusOutlined /> }] : []),
      ...(!isPgDb && connection?.database_type !== 'redis'
        ? [{ key: 'new-table', label: connection?.database_type === 'mongodb' ? '新建集合' : '新建表', icon: <PlusOutlined /> }]
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
        ? [{ key: 'import', label: '导入', icon: <PlayCircleOutlined /> }]
        : []),
      ...(!isPgDb && (connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'gaussdb')
        ? [{ type: 'divider' as const }, { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }]
        : [])
    ]
  }

  const handleDatabaseContextMenuClick = (key: string, node: DatabaseTreeNode): void => {
    if (!node.connectionId || !node.databaseName || (node.kind !== 'database' && node.kind !== 'pg-schema')) {
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
      setNewTableColumns(connection?.database_type === 'mongodb'
        ? [{ key: 'col-0', name: '_id', type: 'ObjectId', nullable: false, primaryKey: true, comment: '', unique: false, autoIncrement: false, autoIncrementStep: undefined, minimum: '', maximum: '' }]
        : [
            {
              key: 'col-0',
              name: 'id',
              type: isSchemaScopedType(connection?.database_type) || connection?.database_type === 'oracle' ? 'INTEGER' : connection?.database_type === 'clickhouse' ? 'UInt64' : 'INT',
              nullable: false,
              primaryKey: connection?.database_type !== 'clickhouse',
              comment: '',
              unique: false,
              autoIncrement: connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'gaussdb' || connection?.database_type === 'oracle' || connection?.database_type === 'sqlite',
              autoIncrementStep: connection?.database_type === 'postgresql' || connection?.database_type === 'gaussdb' || connection?.database_type === 'oracle' ? 1 : undefined,
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
          ])
      setCreateTableModalOpen(true)
    }
    if (key === 'run-sql') {
      void openSqlFileDialog(connectionId, databaseName, pgDbName)
    }
    if (key === 'backup') {
      openBackupRestoreModal(connectionId, isPgDb ? undefined : databaseName, pgDbName)
    }
    if (key === 'export') {
      openExportModal(connectionId, isPgDb ? undefined : databaseName, pgDbName)
    }
    if (key === 'import') {
      openImportModal(connectionId, isPgDb ? undefined : databaseName, pgDbName)
    }
    if (key === 'delete') {
      deleteDatabase(connectionId, databaseName)
    }
  }

  const getObjectContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if ((node.kind !== 'table' && node.kind !== 'db-object') || !node.connectionId || !node.tableName) {
      return []
    }

    const objectType = node.objectType ?? 'table'
    const connection = getConnection(node.connectionId)
    const canPreview = objectType === 'table' || objectType === 'view'

    return [
      ...(canPreview ? [{ key: 'select', label: '生成 SELECT 查询' }] : []),
      { key: 'ddl', label: '查看 DDL' },
      ...(objectType === 'table' && connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
        ? [{ key: 'edit', label: '修改表' }]
        : []),
      { key: 'copy', label: '复制对象名' },
      { type: 'divider' },
      ...(canPreview ? [{ key: 'export', label: '导出', icon: <FileAddOutlined /> }] : []),
      ...(connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
        ? [{ key: 'import', label: '导入', icon: <PlayCircleOutlined /> }]
        : []),
      ...(canPreview ? [{ type: 'divider' as const }, { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }] : [])
    ]
  }

  const handleObjectContextMenuClick = (key: string, node: DatabaseTreeNode): void => {
    if ((node.kind !== 'table' && node.kind !== 'db-object') || !node.connectionId || !node.tableName) {
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
    const folderMenuItems = connectionFolders.map((folder) => ({
      key: `move-folder:${folder.id}`,
      label: folder.name,
      disabled: currentFolderId === folder.id
    }))

    return [
      ...(connection.is_open
        ? [{ key: 'close', label: '关闭连接', icon: <CloseCircleOutlined />, disabled: loading }]
        : [{ key: 'open', label: '打开连接', icon: <PlayCircleOutlined />, disabled: loading }]),
      ...(connection.database_type === 'redis' || connection.database_type === 'sqlite' ? [] : [{
        key: 'new-database',
        label: connection.database_type === 'oracle' ? '新建用户' : '新建库',
        icon: <PlusOutlined />
      }]),
      ...(connection.database_type !== 'mongodb' && connection.database_type !== 'redis'
        ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }]
        : []),
      ...(connectionFolders.length > 0
        ? [{
            type: 'divider' as const
          }, {
            key: 'move-folder',
            label: '添加到分组',
            icon: <FolderAddOutlined />,
            children: folderMenuItems
          }]
        : []),
      ...(currentFolderId
        ? [{ type: 'divider' as const }, { key: 'move-root', label: '移出分组', icon: <FolderOpenOutlined /> }]
        : [])
    ]
  }

  const getObjectGroupContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (node.kind !== 'object-group' || !node.objectType || (node.objectType !== 'table' && node.objectType !== 'view')) {
      return []
    }

    return [{ key: 'catalog', label: '查看列表' }]
  }

  const getFolderContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (node.kind !== 'folder' || !node.folderId) {
      return []
    }

    return [
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
      if (key === 'rename-folder') {
        openRenameFolderModal(node.folderId)
      }
      if (key === 'delete-folder') {
        deleteFolder(node.folderId)
      }
    } else if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      if (connection) {
        handleConnectionContextMenuClick(key, connection)
      }
    } else if (node.kind === 'database' || node.kind === 'pg-schema') {
      handleDatabaseContextMenuClick(key, node)
    } else if (node.kind === 'object-group' && key === 'catalog' && node.connectionId && (node.objectType === 'table' || node.objectType === 'view')) {
      void openTableCatalog(node.connectionId, node.databaseName, node.pgDatabaseName, node.objectType)
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
      const folderDropZone = dragOverFolderTarget?.folderId === node.folderId ? dragOverFolderTarget.zone : undefined
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
          <span className={`table-tree-title${loading ? ' is-loading' : ''}`}>{highlightTreeSearchText(String(node.title ?? ''))}</span>
          <Tag className="folder-count-tag">{connectionCount}</Tag>
        </Flex>
      )
    }

    if (node.kind === 'folder-drop-placeholder') {
      return <span className="folder-drop-placeholder-title resource-tree-node-title" data-tree-node-key={String(node.key)} />
    }

    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection
        ? renderConnectionTitle(node, connection)
        : <span className="resource-tree-node-title" data-tree-node-key={String(node.key)}>{node.title as React.ReactNode}</span>
    }

    if (node.kind === 'column') {
      const title = String(node.title ?? '')
      return <span className={`table-tree-title resource-tree-node-title${loading ? ' is-loading' : ''}`} title={title} data-tree-node-key={String(node.key)}>{highlightTreeSearchText(title)}</span>
    }

    if ((node.kind === 'database' || node.kind === 'pg-schema') && node.connectionId && node.databaseName) {
      const connectionId = node.connectionId
      const databaseName = node.databaseName
      const isPgDb = node.kind === 'database' && isSchemaScopedType(getConnection(connectionId)?.database_type)
      const selKey = `${connectionId}:${databaseName}`
      const schemas = allSchemas[selKey] ?? []
      const selectedSchemaList = selectedSchemas[selKey] ?? schemas
      const schemaCount = schemas.length
      const handleSchemaCommit = (nextSelected: string[]): void => {
        const currentSelected = selectedSchemasRef.current[selKey] ?? selectedSchemaList
        const changed = !stringArrayEquals(
          [...currentSelected].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })),
          [...nextSelected].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
        )
        setSelectedSchemas((current) => {
          const next = { ...current, [selKey]: nextSelected }
          selectedSchemasRef.current = next
          return next
        })
        if (changed) {
          refreshDatabaseNode(connectionId, databaseName, nextSelected)
        }
      }

      return (
        <Flex align="center" justify="space-between" className="tree-title-row resource-tree-node-title" data-tree-node-key={String(node.key)}>
          <div className="tree-title-with-size">
            <span className={`table-tree-title${loading ? ' is-loading' : ''}`}>{highlightTreeSearchText(String(node.title ?? ''))}</span>
            <span className="tree-node-actions">
              {renderAIContextButton(node)}
              {node.sizeDisplay && <span className="tree-size-badge" title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}>{node.sizeDisplay}</span>}
            </span>
          </div>
          {isPgDb && schemaCount > 0 && (
            <TreeSelectorPopover options={schemas} selectedValues={selectedSchemaList} onCommit={handleSchemaCommit} />
          )}
        </Flex>
      )
    }

    if ((node.kind !== 'table' && node.kind !== 'db-object') || !node.connectionId || !node.tableName) {
      return (
        <span className="resource-tree-node-title" data-tree-node-key={String(node.key)}>
          {highlightTreeSearchText(String(node.title ?? ''))}
        </span>
      )
    }

    return (
      <Flex align="center" justify="space-between" className="tree-title-with-size resource-tree-node-title" data-tree-node-key={String(node.key)}>
        <span className="table-tree-title" title={node.kind === 'table' ? (node.comment?.trim() || String(node.title ?? '')) : String(node.title ?? '')}>
          {highlightTreeSearchText(String(node.title ?? ''))}
        </span>
        <span className="tree-node-actions">
          {node.sizeDisplay && <span className="tree-size-badge" title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}>{node.sizeDisplay}</span>}
        </span>
      </Flex>
    )
  }

  const toggleRedisValue = (tabKey: string, rowKey: string): void => {
    setWorkspaceTabs((current) => current.map((tab) => {
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
    }))
  }

  const updateRedisEdit = (tabKey: string, rowKey: string, patch: Partial<RedisKeyEdit>): void => {
    setWorkspaceTabs((current) => current.map((tab) => {
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
    }))
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
    setWorkspaceTabs((current) => current.map((tab) => {
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
    }))
  }

  const clearRuntimeColumnSelection = (tabKey: string): void => {
    const selectedColumn = selectedColumnRefs.current[tabKey]
    if (!selectedColumn) {
      return
    }
    selectedColumnRefs.current[tabKey] = undefined
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container.querySelectorAll<HTMLElement>(`[data-column-key="${CSS.escape(selectedColumn)}"]`).forEach((element) => {
      element.classList.remove('column-selected-runtime')
    })
    container.querySelectorAll<HTMLElement>(`.editable-cell[data-cell-column-key="${CSS.escape(selectedColumn)}"]`).forEach((element) => {
      element.classList.remove('column-selected-runtime-inner')
    })
    container.querySelectorAll(`[data-column-button="${CSS.escape(selectedColumn)}"]`).forEach((element) => element.classList.remove('column-select-button-runtime-selected'))
  }

  const clearRenderedCellSelection = (tabKey: string): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container.querySelectorAll<HTMLElement>('.editable-cell.cell-selected-runtime, td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host').forEach((element) => {
      element.classList.remove('cell-selected-runtime')
      element.classList.remove('cell-selected-runtime-host')
    })
    renderedSelectedCellRefs.current[tabKey] = undefined
  }

  const clearActiveSearchCellHighlight = (tabKey: string): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container.querySelectorAll('.cell-search-active').forEach((element) => element.classList.remove('cell-search-active'))
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
      container.querySelectorAll<HTMLElement>(`.editable-cell[data-cell-key="${CSS.escape(cellKey)}"]`).forEach((element) => {
        element.classList.remove('cell-selected-runtime')
        element.closest<HTMLElement>('td, .ant-table-cell')?.classList.remove('cell-selected-runtime-host')
      })
    })

    cellKeys.forEach((cellKey) => {
      container.querySelectorAll<HTMLElement>(`.editable-cell[data-cell-key="${CSS.escape(cellKey)}"]`).forEach((element) => {
        if (!previousRenderedKeySet.has(cellKey) || !element.classList.contains('cell-selected-runtime')) {
          element.classList.add('cell-selected-runtime')
        }
        const host = element.closest<HTMLElement>('td, .ant-table-cell')
        if (host && (!previousRenderedKeySet.has(cellKey) || !host.classList.contains('cell-selected-runtime-host'))) {
          host.classList.add('cell-selected-runtime-host')
        }
      })
      nextRenderedKeys.push(cellKey)
    })

    renderedSelectedCellRefs.current[tabKey] = nextRenderedKeys.length > 0 ? nextRenderedKeys : undefined
  }

  const applyRuntimeColumnSelection = (tabKey: string, column: string): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    clearRuntimeColumnSelection(tabKey)
    selectedColumnRefs.current[tabKey] = column
    container.querySelectorAll<HTMLElement>(`[data-column-key="${CSS.escape(column)}"]`).forEach((element) => {
      element.classList.add('column-selected-runtime')
      element.querySelectorAll<HTMLElement>(`.editable-cell[data-cell-column-key="${CSS.escape(column)}"]`).forEach((cell) => {
        cell.classList.add('column-selected-runtime-inner')
      })
    })
    container.querySelectorAll<HTMLElement>(`[data-column-button="${CSS.escape(column)}"]`).forEach((element) => {
      element.classList.add('column-select-button-runtime-selected')
    })
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
    const hasRuntimeSelection = Boolean(runtimeSelectedCellRefs.current[tabKey]?.length)
    const hasCommittedSelection = Boolean(selectedCellRefs.current[tabKey]?.length)
    const hasContextSelection = Boolean(contextMenuCellSelectionRefs.current[tabKey])
    const hasRenderedSelection = Boolean(renderedSelectedCellRefs.current[tabKey]?.length)
      || Boolean(tableBodyRefs.current[tabKey]?.querySelector('.editable-cell.cell-selected-runtime, td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host'))
    if (!hasRuntimeSelection && !hasCommittedSelection && !hasContextSelection && !hasRenderedSelection) {
      cancelPendingCellSelectionInteractions(tabKey)
      return
    }
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
    updateSelectedCells(tabKey, [])
    clearRenderedCellSelection(tabKey)
    syncInspectorSelection(tabKey, [])
  }

  const clearSelectedRowsForTab = (tabKey: string): void => {
    const selectedRowKeys = (rowSelectionDraftRefs.current[tabKey] ?? selectedRowRefs.current[tabKey] ?? []).map((key) => String(key))
    if (selectedRowKeys.length === 0) {
      return
    }
    rowSelectionDraftRefs.current[tabKey] = undefined
    selectedRowRefs.current[tabKey] = undefined
    const container = tableBodyRefs.current[tabKey]
    if (container) {
      const renderedRowKeys = renderedSelectedRowRefs.current[tabKey] ?? []
      for (const rowKey of renderedRowKeys) {
        const trs = container.querySelectorAll<HTMLElement>('tr[data-row-key="' + CSS.escape(rowKey) + '"], .ant-table-row[data-row-key="' + CSS.escape(rowKey) + '"]')
        trs.forEach(function(el) {
          el.classList.remove('row-selected')
          el.querySelector<HTMLElement>('.row-number-button')?.classList.remove('selected')
        })
      }
    }
    renderedSelectedRowRefs.current[tabKey] = undefined
  }

  const scheduleRenderedCellSelectionSync = (tabKey: string): void => {
    const isVirtualTable = Boolean(getResultTableVirtualHolder(tabKey))
    if (isVirtualTable) {
      if (pendingRenderedCellSelectionTimeoutRefs.current[tabKey]) {
        window.clearTimeout(pendingRenderedCellSelectionTimeoutRefs.current[tabKey])
      }
      pendingRenderedCellSelectionTimeoutRefs.current[tabKey] = window.setTimeout(() => {
        pendingRenderedCellSelectionTimeoutRefs.current[tabKey] = undefined
        if (pendingRenderedCellSelectionFrameRefs.current[tabKey]) {
          return
        }
        pendingRenderedCellSelectionFrameRefs.current[tabKey] = window.requestAnimationFrame(() => {
          pendingRenderedCellSelectionFrameRefs.current[tabKey] = undefined
          syncRenderedCellSelection(tabKey)
        })
      }, 72)
      return
    }
    if (pendingRenderedCellSelectionFrameRefs.current[tabKey]) {
      return
    }
    pendingRenderedCellSelectionFrameRefs.current[tabKey] = window.requestAnimationFrame(() => {
      pendingRenderedCellSelectionFrameRefs.current[tabKey] = undefined
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
    <ResultTablePanel
      tab={tab}
      refs={resultTableRefs}
      getConnection={getConnection}
      getImmediateTableSearchState={getImmediateTableSearchState}
      updateWorkspaceTab={updateWorkspaceTab}
      updateTableSearchState={updateTableSearchState}
      changeTabPage={changeTabPage}
      changeTabLimit={changeTabLimit}
      previewTable={previewTable}
      previewRedisDatabase={previewRedisDatabase}
      showObjectDdl={showObjectDdl}
      addPreviewRow={addPreviewRow}
      markSelectedRowsDeleted={markSelectedRowsDeleted}
      submitPreviewChanges={submitPreviewChanges}
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
      scheduleNativeHorizontalScrollbarSync={scheduleNativeHorizontalScrollbarSync}
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
      tableSearchShortcut={shortcutSettings.table_search}
    />
  )

  const renderResultTableRef = useRef(renderResultTable)
  renderResultTableRef.current = renderResultTable

  const getDefaultDatabaseName = useCallback((connection?: ConnectionInfo): string | undefined => {
    if (!connection) {
      return undefined
    }
    if (connection.database_type !== 'mysql' && connection.database_type !== 'dm' && connection.database_type !== 'oracle' && connection.database_type !== 'mongodb' && connection.database_type !== 'redis' && connection.database_type !== 'clickhouse') {
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
  }, [allDatabases])

  const getDefaultPgDatabase = useCallback((connection: ConnectionInfo): string | undefined => {
    if (connection.database_type !== 'postgresql' && connection.database_type !== 'gaussdb') {
      return undefined
    }

    const connectionDb = connection.database?.split('@')[0]
    const dbNames = allDatabases[connection.connection_id] ?? []

    if (connectionDb && dbNames.includes(connectionDb)) {
      return connectionDb
    }

    return connectionDb || dbNames[0]
  }, [allDatabases])

  const getDefaultPgSchema = useCallback((schemas: string[]): string | undefined => {
    return schemas.includes('public') ? 'public' : schemas[0]
  }, [])

  const preloadCompletionForDatabase = useCallback(async (connectionId: string, databaseName: string): Promise<void> => {
    const cacheKey = `${connectionId}:${databaseName}`
    const connection = getConnection(connectionId)

    if (!connection?.is_open || completionTables[cacheKey]) {
      return
    }

    try {
      const data = await requestJson<{ tables: TableInfo[] }>(`/connections/${connectionId}/tables?database=${encodeURIComponent(databaseName)}`)
      const tableNames = data.tables.map((t) => t.name)
      setCompletionTables((current) => ({ ...current, [cacheKey]: tableNames }))
    } catch {
      // ignore
    }
  }, [completionTables, getConnection, requestJson])

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

  const treeRuntime = useMemo(() => createTreeRuntime({
    requestJson: (path, options) => requestJsonRef.current(path, options),
    withPgDatabase,
    getConnection: (connectionId) => getConnectionRef.current(connectionId),
    isSchemaScopedType,
    preloadCompletionForDatabase: (connectionId, databaseName) => preloadCompletionForDatabaseRef.current(connectionId, databaseName),
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
    notifyTreeLoadingStateChanged: () => {
      setTreeLoadingVersion((current) => current + 1)
    },
    showError: (error, fallback) => showErrorRef.current(error, fallback),
    connectionTypeIcons
  }), [
    withPgDatabase,
    isSchemaScopedType
  ])

  const ensureDatabasesLoaded = useCallback(async (connectionId: string, connectionOverride?: ConnectionInfo): Promise<void> => {
    const connection = connectionOverride ?? getConnection(connectionId)
    if (!connection?.is_open || allDatabases[connectionId]) {
      return
    }

    try {
      const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connectionId}/databases`)
      const dbNames = data.databases.map((d) => d.name)
      setAllDatabases((current) => ({ ...current, [connectionId]: dbNames }))
    } catch {
      // ignore
    }
  }, [allDatabases, getConnection, requestJson])

  const ensureSchemasLoaded = useCallback(async (connectionId: string, pgDatabaseName: string): Promise<string[]> => {
    const key = `${connectionId}:${pgDatabaseName}`
    const connection = getConnection(connectionId)

    if (!connection?.is_open) {
      return []
    }

    if (allSchemas[key]) {
      return allSchemas[key]
    }

    try {
      const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connectionId}/schemas?database=${encodeURIComponent(pgDatabaseName)}`)
      const schemaNames = data.databases.map((s) => s.name)
      setAllSchemas((current) => ({ ...current, [key]: schemaNames }))
      return schemaNames
    } catch {
      return []
    }
  }, [allSchemas, getConnection, requestJson])

  const openRedisDatabaseBrowser = async (connectionId: string, databaseName: string, limit = REDIS_DEFAULT_LIMIT, page = 1): Promise<void> => {
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
        return current.map((tab) => (tab.key === tabKey ? { ...tab, limit, page, loading: true, error: undefined } : tab))
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

  const previewRedisDatabase = async (connectionId: string, databaseName: string, limit = REDIS_DEFAULT_LIMIT, page = 1, tabKey = `redis:${connectionId}:${databaseName}`, where = ''): Promise<void> => {
    try {
      const previewPath = withWhereQuery(withPageQuery(withPgDatabase(`/connections/${connectionId}/tables/__DATADJINN_REDIS_DATABASE__/preview`, databaseName), limit, page), where)
      const result = await requestJson<QueryResponse>(previewPath)
      updateWorkspaceTab(tabKey, { result, redisEdits: buildRedisEdits(result.rows), redisExpandedValues: {}, page, limit, where, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载 Redis Key 失败' })
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
    setSelectedConnectionIds((current) => current.length > 0 ? current : (data.connections[0]?.connection_id ? [data.connections[0].connection_id] : []))
    setSelectedTreeKeys((current) => current.length > 0 ? current : (data.connections[0]?.connection_id ? [`connection:${data.connections[0].connection_id}`] : []))

    refreshTree(data.connections)
  }

  const {
    ensureQueryContextTreeExpanded,
    preloadConnectionTree,
    preloadDatabaseChildren,
    reloadNodeChildren,
    collapseTreeNode,
    toggleOrLoadTreeNode
  } = treeRuntime

  const openConnectionModalRef = useRef<(nextDatabaseType: DatabaseType) => Promise<void>>(async () => undefined)

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
        database: 'postgres'
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
        dm_driver_id: undefined
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
        driver_id: undefined
      }
    }
    if (nextDatabaseType === 'oracle') {
      return {
        database_type: 'oracle',
        name: 'Oracle',
        host: '127.0.0.1',
        port: 1521,
        username: 'system',
        database: 'orclpdb1'
      }
    }
    if (nextDatabaseType === 'mongodb') {
      return {
        database_type: 'mongodb',
        name: 'MongoDB',
        host: '127.0.0.1',
        port: 27017,
        database: 'admin'
      }
    }
    if (nextDatabaseType === 'redis') {
      return {
        database_type: 'redis',
        name: 'Redis',
        host: '127.0.0.1',
        port: 6379,
        database: '0'
      }
    }
    if (nextDatabaseType === 'clickhouse') {
      return {
        database_type: 'clickhouse',
        name: 'ClickHouse',
        host: '127.0.0.1',
        port: 8123,
        username: 'default',
        database: 'default'
      }
    }
    return {
      database_type: 'mysql',
      name: 'MySQL',
      host: '127.0.0.1',
      port: 3306
    }
  }

  const openConnectionModal = async (nextDatabaseType: DatabaseType): Promise<void> => {
    const defaults = buildCreateConnectionDefaults(nextDatabaseType)
    setConnectionMode('create')
    setEditingConnectionInfoId(undefined)
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
    if (connectionModalHydrationFrameRef.current != null) {
      window.cancelAnimationFrame(connectionModalHydrationFrameRef.current)
      connectionModalHydrationFrameRef.current = undefined
    }
    setConnectionMode('edit')
    setEditingConnectionInfoId(connection.connection_id)
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
      const data = await requestJson<ConnectionFormValues>(`/connections/${connection.connection_id}`)
      const formValues = { ...data }
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
      form.setFieldsValue(formValues)
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载连接信息失败')
      setConnectionModalOpen(false)
    } finally {
      setConnectionLoading(false)
    }
  }

  const stableConnectionCreateMenuItems = useMemo<NonNullable<MenuProps['items']>>(() => [
      { key: 'sqlite', label: 'SQLite', icon: <img src={sqliteIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'mysql', label: 'MySQL', icon: <img src={mysqlIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'postgresql', label: 'PostgreSQL', icon: <img src={postgresIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'oracle', label: 'Oracle', icon: <img src={oracleIcon} alt="Oracle" style={{ width: 16, height: 16 }} /> },
      { key: 'mongodb', label: 'MongoDB', icon: <img src={mongoIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'redis', label: 'Redis', icon: <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} /> },
      { key: 'clickhouse', label: 'ClickHouse', icon: <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} /> },
      {
        key: 'others',
        label: '其他',
        icon: <DatabaseOutlined />,
        popupClassName: 'resource-create-submenu-popup',
        children: [
          { key: 'dm', label: '达梦', icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} /> },
          { key: 'gaussdb', label: '高斯数据库', icon: <DatabaseOutlined /> }
        ]
      }
    ], [])

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
      render: (value?: DatabaseType) => value ? DATABASE_TYPE_LABELS[value] : '-'
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

  const resourceCreateMenu = useMemo(() => ({
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
  }), [openCreateFolderModal, stableConnectionCreateMenuItems])

  const cleanFormValues = (values: ConnectionFormValues): ConnectionFormValues => {
    if (values.database_type === 'sqlite') {
      return {
        name: values.name,
        database_type: 'sqlite',
        sqlite_path: values.sqlite_path
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
        database: values.database
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
        driver_id: values.driver_id ?? values.dm_driver_id
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
        driver_id: values.driver_id
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
        database: values.database
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
        database: values.database
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
        database: values.database
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
        database: values.database
      }
    }

    return {
      name: values.name,
      database_type: 'mysql',
      host: values.host,
      port: values.port,
      username: values.username,
      password: values.password,
      database: values.database
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
        title: '需要重启应用',
        content: 'JDBC Java 环境已修改。由于 JVM 启动后不能切换 Java 版本，重启应用后才能生效。是否现在重启？',
        okText: '确认并重启',
        cancelText: '取消',
        centered: true,
        maskClosable: false,
        onOk: async () => {
          await window.api.relaunchApp()
        },
        onCancel: () => {
          setJavaRestartRequired(true)
        }
      })
      return
    }

    messageApi.success(savedEnabled ? `JDBC Java 环境已设置为 Java ${result.major ?? '未知版本'}` : '已关闭 JDBC Java 环境')
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
        ? result.drivers.map((driver) => normalizeDriverInfo(driver)).filter((driver): driver is DriverInfo => driver !== null)
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
        const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.(db|sqlite|sqlite3)$/i, '')
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
    return connections.some((connection) =>
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

  const isConnectionPasswordRetryError = (message: string): boolean => {
    const normalized = message.toLowerCase()
    return normalized.includes('密码错误') ||
      normalized.includes('用户名或密码错误') ||
      normalized.includes('用户名密码错误') ||
      normalized.includes('认证失败') ||
      normalized.includes('authentication failed') ||
      normalized.includes('wrongpass') ||
      normalized.includes('invalid username-password pair')
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
    setImportConnectionCandidates([])
    setImportConnectionParsing(false)
    setImportingConnections(false)
  }, [])

  const openImportConnectionModal = useCallback((): void => {
    setImportConnectionModalOpen(true)
  }, [])

  const openImportConnectionModalRef = useRef(openImportConnectionModal)
  openImportConnectionModalRef.current = openImportConnectionModal
  const handleConnectionCreateMenuClickRef = useRef<(info: { key: string }) => void>(() => undefined)

  const closeImportConnectionModal = useCallback((): void => {
    setImportConnectionModalOpen(false)
  }, [])

  const closeImportConnectionResultModal = (): void => {
    setImportConnectionResultOpen(false)
    setImportConnectionResult(null)
  }

  const parseImportConnections = (): void => {
    const rawText = importConnectionRawText.trim()
    if (!rawText) {
      messageApi.warning('请先粘贴连接配置文本')
      return
    }

    if (importConnectionSource !== 'datagrip') {
      messageApi.warning('当前仅支持 DataGrip 导入')
      return
    }

    setImportConnectionParsing(true)
    try {
      const usedNames = new Set(connections.map((connection) => connection.name.trim().toLocaleLowerCase()).filter(Boolean))
      const candidates = parseDataGripImportText(rawText).map<ImportConnectionCandidate>((candidate) => {
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
    const readyCandidates = importConnectionCandidates.filter((candidate) => candidate.payload && candidate.status !== 'error')
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
    const usedNames = new Set(nextConnections.map((connection) => connection.name.trim().toLocaleLowerCase()).filter(Boolean))

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
          const finalPayload: ConnectionFormValues = importName === payload.name
            ? payload
            : {
                ...payload,
                name: importName
              }
          const finalMessage = importName === candidate.name
            ? candidate.message
            : [candidate.message, `再次导入时名称已自动调整为 ${importName}`].filter(Boolean).join('；')
          const created = await requestJson<ConnectionInfo>('/connections', {
            method: 'POST',
            body: JSON.stringify(cleanFormValues(finalPayload))
          })
          nextConnections = [...nextConnections, created]
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

  const driverTypeOptionsForDatabase = (databaseType: DriverDatabaseType): { label: string; value: DriverType }[] =>
    DRIVER_DATABASE_META[databaseType].supportedDriverTypes.map((type) => ({
      value: type,
      label: type === 'python' ? 'dmPython pyd 驱动' : type === 'whl' ? 'dmPython whl 驱动' : 'JDBC jar 驱动'
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
      void window.api.getAppInfo().then(setAppInfo).catch(() => undefined)

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
  }

  const addDriver = async (): Promise<void> => {
    setDriverSaving(true)
    try {
      const values = await driverForm.validateFields()
      const body = { database_type: values.database_type, driver_type: values.driver_type, name: values.name, path: values.path, enabled: values.enabled }
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

  const driverPathLabel = (databaseType: DriverDatabaseType, driverTypeValue: DriverType): string => {
    if (driverTypeValue === 'python') {
      return 'dmPython pyd 文件'
    }
    if (driverTypeValue === 'whl') {
      return 'dmPython whl 文件'
    }
    return `${DRIVER_DATABASE_META[databaseType].shortLabel} JDBC jar 文件`
  }

  const driverPathPlaceholder = (databaseType: DriverDatabaseType, driverTypeValue: DriverType): string => {
    if (driverTypeValue === 'python') {
      return '请选择 dmPython.pyd'
    }
    if (driverTypeValue === 'whl') {
      return '请选择 dmPython whl 文件'
    }
    return databaseType === 'gaussdb' ? '请选择高斯 JDBC jar' : '请选择 DmJdbcDriver.jar'
  }

  const manualDriverOptionDrivers = selectedManualDriver && !selectedManualDriver.enabled ? [selectedManualDriver, ...currentEnabledDrivers] : currentEnabledDrivers
  const manualDriverOptions = manualDriverOptionDrivers.map((driver) => ({
    label: `${driverTypeLabel(driver.driver_type)} - ${driver.name}${driver.enabled ? '' : '（已禁用）'}`,
    value: driver.id,
    disabled: !driver.enabled
  }))

  const testConnection = async (): Promise<void> => {
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
        'dm_driver_id'
      ])
      const result = await requestJson<ConnectionTestResponse>('/connections/test', {
        method: 'POST',
        body: JSON.stringify(cleanFormValues(values))
      })

      if (result.success) {
        messageApi.success(result.message || '数据库连接测试成功')
      } else {
        showError(result.message || '数据库连接测试失败')
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '测试连接失败')
    } finally {
      setTestingConnection(false)
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
        const connection = await requestJson<ConnectionInfo>(`/connections/${editingConnectionInfoId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
        const nextConnections = connections.map((item) => (item.connection_id === connection.connection_id ? connection : item))
        setConnections(nextConnections)
        setTreeData((current) => replaceConnectionNode(current, connection, buildConnectionNode))
        setConnectionModalOpen(false)
        return
      }

      const connection = await requestJson<ConnectionInfo>('/connections', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      const nextConnections = [...connections, connection]
      setConnections(nextConnections)
      setSelectedConnectionId(connection.connection_id)
      selectConnectionNodes([connection.connection_id], connection.connection_id)
      refreshTree(nextConnections)
      setConnectionModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : connectionMode === 'edit' ? '更新连接失败' : '保存连接失败')
    } finally {
      setConnectionLoading(false)
    }
  }

  const retryOpenConnectionWithPassword = async (connectionId: string, password: string): Promise<ConnectionInfo> => {
    const request = await requestJson<ConnectionFormValues>(`/connections/${connectionId}`)
    const updated = await requestJson<ConnectionInfo>(`/connections/${connectionId}`, {
      method: 'PUT',
      body: JSON.stringify(cleanFormValues({
        ...request,
        password
      }))
    })
    setConnections((current) => current.map((item) => (item.connection_id === connectionId ? updated : item)))
    setTreeData((current) => replaceConnectionNode(current, updated, buildConnectionNode))
    return await requestJson<ConnectionInfo>(`/connections/${connectionId}/open`, { method: 'POST' })
  }

  const openConnectionById = async (connectionId: string): Promise<ConnectionInfo | undefined> => {
    setConnectionTreeLoadingText(connectionId, '正在打开连接...')
    try {
      const currentConnection = getConnection(connectionId)
      if (currentConnection && !currentConnection.has_password && currentConnection.database_type !== 'sqlite' && currentConnection.database_type !== 'redis') {
        openConnectionPasswordPrompt(currentConnection, '当前连接未保存密码，请输入密码后重试')
        return undefined
      }

      const connection = await requestJson<ConnectionInfo>(`/connections/${connectionId}/open`, { method: 'POST' })

      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setTreeData((current) => {
        const next = replaceConnectionNode(current, connection, buildConnectionNode, connection.database_type !== 'sqlite')
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
        await waitForUiCommit()
      } else {
        setConnectionTreeLoadingText(connectionId, '正在加载库表...')
        await preloadConnectionTree(connection)
      }
      return connection
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '打开连接失败'
      const currentConnection = getConnection(connectionId)
      if (currentConnection && currentConnection.database_type !== 'sqlite' && currentConnection.database_type !== 'redis' && isConnectionPasswordRetryError(errorMessage)) {
        openConnectionPasswordPrompt(currentConnection, errorMessage)
        return undefined
      }
      showError(errorMessage)
      return undefined
    } finally {
      setConnectionTreeLoadingText(connectionId)
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

    setConnectionTreeLoadingText(connectionId, '正在验证密码...')
    try {
      const connection = await retryOpenConnectionWithPassword(connectionId, password)
      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setTreeData((current) => replaceConnectionNode(current, connection, buildConnectionNode))

      const connKey = `connection:${connectionId}`
      setExpandedKeys((current) => {
        const next = current.includes(connKey) ? current : [...current, connKey]
        expandedKeysRef.current = next
        return next
      })

      if (connection.database_type === 'sqlite') {
        await ensureDatabasesLoaded(connectionId, connection)
        await waitForUiCommit()
      } else {
        setConnectionTreeLoadingText(connectionId, '正在加载库表...')
        await preloadConnectionTree(connection)
      }
      closeConnectionPasswordPrompt()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '密码验证失败'
      setConnectionPasswordPromptReason(errorMessage)
      showError(errorMessage)
    } finally {
      setConnectionTreeLoadingText(connectionId)
    }
  }

  const closeConnectionById = async (connectionId: string): Promise<void> => {
    try {
      const connection = await requestJson<ConnectionInfo>(`/connections/${connectionId}/close`, { method: 'POST' })
      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setSelectedConnectionIds((current) => current.filter((id) => id !== connectionId))
      setSelectedTreeKeys((current) => current.filter((key) => {
        const value = String(key)
        return value !== `connection:${connectionId}` && !value.includes(`:${connectionId}:`)
      }))
      setFocusedTreeNode((current) => current?.connectionId === connectionId ? undefined : current)
      setTreeContextMenu((current) => current?.node.connectionId === connectionId ? null : current)
      setExpandedKeys((keys) => {
        const next = keys.filter((k) => !String(k).startsWith(`connection:${connectionId}`) && !String(k).includes(`:${connectionId}:`))
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
        setSelectedConnectionId((current) => (current === connectionId ? nextConnections[0]?.connection_id : current))
        setSelectedConnectionIds((current) => current.filter((id) => id !== connectionId))
        setSelectedTreeKeys((current) => current.filter((key) => key !== `connection:${connectionId}`))
        setWorkspaceTabs((current) => current.filter((tab) => tab.connectionId !== connectionId))
        refreshTree(nextConnections)
      }
    })
  }

  const showObjectDdl = async (connectionId: string, name: string, type: DbObjectType, databaseName?: string, pgDatabaseName?: string): Promise<void> => {
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
        const result = await requestJson<ObjectDdlResponse>(`/connections/${connectionId}/objects/${encodeURIComponent(name)}/ddl?${params.toString()}`)
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
          await requestJson(`/connections/${connectionId}/databases/${encodeURIComponent(databaseName)}`, { method: 'DELETE' })
          setSelectedDatabases((current) => {
            const nextList = (current[connectionId] ?? []).filter((name) => name !== databaseName)
            return { ...current, [connectionId]: nextList }
          })
          setWorkspaceTabs((current) => current.filter((tab) => tab.connectionId !== connectionId || tab.databaseName !== databaseName))
          refreshConnectionNode(connectionId)
          messageApi.success('数据库删除成功')
        } catch (err) {
          showError(err instanceof Error ? err.message : '删除数据库失败')
        }
      }
    })
  }

  const deleteDbObject = (connectionId: string, objectName: string, objectType: DbObjectType, databaseName?: string, pgDatabaseName?: string): void => {
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
          await requestJson(`/connections/${connectionId}/objects/${encodeURIComponent(objectName)}?${params.toString()}`, { method: 'DELETE' })
          setWorkspaceTabs((current) => current.filter((tab) => tab.connectionId !== connectionId || tab.tableName !== objectName || tab.databaseName !== databaseName || tab.pgDatabaseName !== pgDatabaseName))
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
        const created = await requestJson<{ name: string }>(`/connections/${creatingDatabaseConnectionId}/databases`, {
          method: 'POST',
          body: JSON.stringify({ name: createdName, password: isOracleUser ? databaseCreatePassword : undefined })
        })
        createdName = created.name
      }
      setDatabaseCreateModalOpen(false)
      setCreatingSchemaDatabaseName('')
      setDatabaseCreatePassword('')

      if (isSchema) {
        const selKey = `${creatingDatabaseConnectionId}:${creatingSchemaDatabaseName}`
        const dbKey = `database:${creatingDatabaseConnectionId}:${creatingSchemaDatabaseName}`

        try {
          const schemaData = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${creatingDatabaseConnectionId}/schemas?database=${encodeURIComponent(creatingSchemaDatabaseName)}`)
          const schemaNames = schemaData.databases.map((s) => s.name)
          setAllSchemas((current) => ({ ...current, [selKey]: schemaNames }))
          setSelectedSchemas((current) => {
            const existing = current[selKey] ?? []
            const merged = existing.includes(databaseCreateName) ? existing : [...existing, databaseCreateName]
            return { ...current, [selKey]: merged }
          })
          setExpandedKeys((current) => current.includes(dbKey) ? current : [...current, dbKey])

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
      showError(err instanceof Error ? err.message : isSchema ? '创建 Schema 失败' : isOracleUser ? '创建用户失败' : '创建数据库失败')
    } finally {
      setDatabaseCreateLoading(false)
    }
  }

  const addNewColumn = (): void => {
    const key = `col-${Date.now()}`
    setNewTableColumns((current) => [...current, {
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
    }])
  }

  const removeNewColumn = (key: string): void => {
    setNewTableColumns((current) => current.filter((col) => col.key !== key))
  }

  const updateNewColumn = (key: string, patch: Partial<ColumnDef>): void => {
    setNewTableColumns((current) => current.map((col) => (col.key === key ? { ...col, ...patch } : col)))
  }

  const updateEditingColumn = (key: string, patch: Partial<ColumnDef>): void => {
    setEditingColumns((current) => current.map((col) => (col.key === key ? { ...col, ...patch } : col)))
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
      await requestJson<{ name: string; message: string }>(`/connections/${createTableConnectionId}/tables`, {
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
      })

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
  const openSqlFileDialog = async (connectionId: string, databaseName?: string, pgDatabaseName?: string): Promise<void> => {
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
    let defaultPgDb = pgDatabaseName ?? ''

    if (connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'gaussdb' || connection?.database_type === 'oracle' || connection?.database_type === 'mongodb' || connection?.database_type === 'redis' || connection?.database_type === 'clickhouse') {
      try {
        const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connectionId}/databases`)
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
      const result = await requestJson<SqlFileRunResponse>(`/connections/${sqlFileConnectionId}/sql-file`, {
        method: 'POST',
        body: JSON.stringify({ sql: sqlFileContent, database: sqlFileDatabase || undefined, pg_database: sqlFilePgDatabase || undefined })
      })
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

  const openExportModal = (connectionId: string, database?: string, pgDatabase?: string, table?: string): void => {
    const connection = getConnection(connectionId)
    setExportConnectionId(connectionId)
    setExportDatabase(database ?? '')
    setExportPgDatabase(pgDatabase ?? '')
    setExportTable(table ?? '')
    setExportScope(table ? 'table' : pgDatabase ? 'schema' : 'database')
    setExportFormat(connection?.database_type === 'mongodb' || connection?.database_type === 'redis' ? 'json' : 'sql')
    setExportContent('schema_data')
    setExportModalOpen(true)
  }

  const runExport = async (): Promise<void> => {
    setExportLoading(true)
    try {
      const defaultName = exportTable || exportPgDatabase || exportDatabase || 'export'
      const extension = exportFormat === 'csv' ? 'csv' : exportFormat === 'json' ? 'json' : 'sql'
      const outputPath = await window.api.selectExportPath(exportFormat, `${defaultName}.${extension}`)
      if (!outputPath) {
        return
      }
      const result = await requestJson<{ success: boolean; message: string; file_path?: string }>('/backup/export', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: exportConnectionId,
          database: exportDatabase || undefined,
          pg_database: exportPgDatabase || undefined,
          table: exportTable || undefined,
          scope: exportScope,
          format: exportFormat,
          content: exportContent,
          output_path: outputPath
        })
      })
      messageApi.success(result.message)
      setExportModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportLoading(false)
    }
  }

  const openImportModal = (connectionId: string, database?: string, pgDatabase?: string, table?: string): void => {
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

  const openBackupRestoreModal = (connectionId: string, database?: string, pgDatabase?: string): void => {
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
      const result = await requestJson<{ success: boolean; message: string; file_path?: string }>('/backup/create', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: backupRestoreConnectionId,
          database: backupRestoreDatabase || undefined,
          pg_database: backupRestorePgDatabase || undefined,
          output_path: outputPath
        })
      })
      messageApi.success(result.file_path ? `${result.message}：${result.file_path}` : result.message)
      setBackupRestoreModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : '备份失败')
    } finally {
      setBackupRestoreLoading(false)
    }
  }

  const updatePreviewCells = (tabKey: string, patches: Array<{ rowKey: string, column: string, value: unknown }>): void => {
    if (patches.length === 0) {
      return
    }
    const rowPatches = new Map<string, Array<{ column: string, value: unknown }>>()
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

  const updatePreviewCell = (tabKey: string, rowKey: string, column: string, value: unknown): void => {
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
    updateWorkspaceTab(tab.key, { editRows: [...(tab.editRows ?? []), row], columnFilterOptions: undefined })
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
    const inserted = edits.filter((edit) => edit.state === 'inserted' && !edit.deleted).map(toPayload)
    const updated = edits.filter((edit) => edit.state === 'updated' && !edit.deleted).map(toPayload)
    const deleted = edits.filter((edit) => edit.deleted && edit.originalKey).map((edit) => edit.originalKey!)

    updateWorkspaceTab(tab.key, { loading: true, error: undefined })

    try {
      const result = await requestJson<QueryResponse>(withPageQuery(withDatabaseQuery(`/connections/${tab.connectionId}/redis/data`, tab.databaseName), tab.limit ?? REDIS_DEFAULT_LIMIT, tab.page ?? 1), {
        method: 'PUT',
        body: JSON.stringify({ inserted, updated, deleted })
      })
      updateWorkspaceTab(tab.key, { result, redisEdits: buildRedisEdits(result.rows), redisExpandedValues: {}, page: tab.page ?? 1, loading: false, error: undefined })
      refreshDatabaseNode(tab.connectionId, tab.databaseName)
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '提交 Redis 数据失败' })
    }
  }

  const markSelectedRowsDeleted = (tab: WorkspaceTab, selectedRowKeysOverride?: string[]): void => {
    const selectedRowKeys = selectedRowKeysOverride ?? (tab.selectedRowKeyMap ? Object.keys(tab.selectedRowKeyMap) : (tab.selectedRowKeys ?? []).map(String))
    const selected = new Set(selectedRowKeys)
    const editRows = (tab.editRows ?? [])
      .filter((row) => !(row.__state === 'inserted' && selected.has(row.__rowKey)))
      .map((row) => (selected.has(row.__rowKey) ? { ...row, __deleted: true } : row))
    delete rowSelectionDraftRefs.current[tab.key]
    delete selectedRowRefs.current[tab.key]
    delete renderedSelectedRowRefs.current[tab.key]
    updateWorkspaceTab(tab.key, { editRows, selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined })
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
      const { __rowKey, __state, __deleted, __original, ...values } = row
      return values
    }
    const inserted = rows.filter((row) => row.__state === 'inserted' && !row.__deleted).map(cleanRow)
    const updated = rows
      .filter((row) => row.__state === 'updated' && !row.__deleted)
      .map((row) => ({ original: row.__original ?? cleanRow(row), values: cleanRow(row) }))
    const deleted = rows.filter((row) => row.__deleted && row.__state !== 'inserted').map((row) => row.__original ?? cleanRow(row))

    updateWorkspaceTab(tab.key, { loading: true, error: undefined })

    try {
      const dataPath = withSortQuery(withWhereQuery(withPageQuery(withPgDatabase(`/connections/${tab.connectionId}/tables/${encodeURIComponent(tab.tableName)}/data`, tab.databaseName, tab.pgDatabaseName), limit, page), tab.where), tab.sortState)
      const [result, columnsData] = await Promise.all([
        requestJson<QueryResponse>(dataPath, {
          method: 'PUT',
          body: JSON.stringify({ inserted, updated, deleted })
        }),
        requestJson<ColumnsResponse>(withPgDatabase(`/connections/${tab.connectionId}/tables/${encodeURIComponent(tab.tableName)}/columns`, tab.databaseName, tab.pgDatabaseName))
      ])
      const columnInfoMap = Object.fromEntries(columnsData.columns.map((item) => [item.name, item] as const))
      editingCellRefs.current[tab.key] = undefined
      updateWorkspaceTab(tab.key, { result, columnInfoMap, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, where: tab.where?.trim() ?? '', loading: false, error: undefined })
      requestAnimationFrame(() => syncRenderedCellSelection(tab.key))
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '提交表数据失败' })
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

    startTransition(() => {
      setSelectedConnectionId(connectionId)
    })
    if (tabExists) {
      setWorkspaceTabsAndActiveTabKey((current) => current.map((tab) => (
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
      )), tabKey)
    }

    try {
      const effectiveSortState = sortState !== undefined ? sortState : existingPreviewTab?.sortState
      const previewPath = withSortQuery(withWhereQuery(withPageQuery(withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/preview`, databaseName, pgDatabaseName), limit, page), whereCondition), effectiveSortState)
      const [result, columnsData] = await Promise.all([
        requestJson<QueryResponse>(previewPath),
        requestJson<ColumnsResponse>(
          withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns`, databaseName, pgDatabaseName)
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
              ? ((current.find((tab) => tab.key === tabKey)?.tableRenderVersion ?? 0) + 1)
              : 1,
            sortState: effectiveSortState
          }

          if (!current.some((tab) => tab.key === tabKey)) {
            return [...current, nextPreviewTab]
          }

          return current.map((tab) => (
            tab.key === tabKey
              ? {
                ...tab,
                ...nextPreviewTab
              }
              : tab
          ))
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
        updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载表数据失败' })
      } else {
        startTransition(() => {
          setWorkspaceTabsAndActiveTabKey((current) => [
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
          ], tabKey)
        })
      }
    }
  }

  const openTableCatalog = async (connectionId: string, databaseName?: string, pgDatabaseName?: string, objectType: 'table' | 'view' = 'table'): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const connection = getConnection(connectionId)
    const scopeTitle = isSchemaScopedType(connection?.database_type)
      ? [pgDatabaseName, databaseName].filter(Boolean).join('.')
      : (databaseName || pgDatabaseName || connection?.database || connection?.name || '当前库')
    const tabKey = `table-list:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${objectType}`

    setSelectedConnectionId(connectionId)
    setActiveTabKey(tabKey)
    setWorkspaceTabs((current) => {
      const exists = current.some((tab) => tab.key === tabKey)
      if (exists) {
        return current.map((tab) => (tab.key === tabKey ? { ...tab, loading: true, error: undefined } : tab))
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
      const rows = objectType === 'view'
        ? (await requestJson<{ objects: DbObjectInfo[] }>(`${withPgDatabase(`/connections/${connectionId}/objects`, databaseName, pgDatabaseName)}${databaseName || pgDatabaseName ? '&' : '?'}type=view`)).objects.map((object, index) => ({
            __rowKey: `view-list:${index}`,
            名称: object.name,
            注释: ''
          }))
        : (await requestJson<{ tables: TableInfo[] }>(`${withPgDatabase(`/connections/${connectionId}/tables`, databaseName, pgDatabaseName)}${databaseName || pgDatabaseName ? '&' : '?'}include_comment=true`)).tables.map((table, index) => ({
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
      updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载表列表失败' })
      showError(err instanceof Error ? err.message : '加载表列表失败')
    }
  }

  const resolvePreferredQueryContext = (connectionId?: string): { databaseName?: string; pgDatabaseName?: string } => {
    const connId = connectionId ?? selectedConnectionId
    const currentActiveTabKey = useWorkspaceStore.getState().activeTabKey
    const currentActiveTab = currentActiveTabKey ? useWorkspaceStore.getState().getTabByKey(currentActiveTabKey) : undefined
    const contextCandidates: Array<{
      connectionId?: string
      databaseName?: string
      pgDatabaseName?: string
    } | undefined> = [focusedTreeNode, currentActiveTab, aiActiveContext]

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

  const openQueryWorkspace = (initialSql = 'select * from users;', title?: string, connectionId?: string, databaseName?: string, pgDatabaseName?: string): string => {
    const nextIndex = queryCounter
    const tabKey = `query:${Date.now()}:${nextIndex}`
    const connId = connectionId ?? selectedConnectionId
    const connection = getConnection(connId)
    const preferredContext = resolvePreferredQueryContext(connId)

    let finalDb = databaseName ?? preferredContext.databaseName
    let finalPgDb = pgDatabaseName ?? preferredContext.pgDatabaseName

    if ((isDatabaseScopedType(connection?.database_type) || connection?.database_type === 'dm' || connection?.database_type === 'oracle') && !finalDb) {
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

      if ((isDatabaseScopedType(connection?.database_type)) && finalDb) {
        void preloadCompletionForDatabase(connId, finalDb)
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
      }
    }
  }

  const resolveQueryExecutionContext = async (tab: WorkspaceTab): Promise<(WorkspaceTab & { treeOpenedForExecution?: boolean }) | undefined> => {
    if (!tab.connectionId) {
      return undefined
    }

    let connection = getConnection(tab.connectionId)
    if (!connection) {
      return undefined
    }

    let treeOpenedForExecution = false
    if (!connection.is_open) {
      const openedConnection = await openConnectionById(tab.connectionId)
      if (!openedConnection) {
        return undefined
      }
      connection = openedConnection
      treeOpenedForExecution = true
    }

    let nextDatabaseName = tab.databaseName
    let nextPgDatabaseName = tab.pgDatabaseName

    if (isDatabaseScopedType(connection.database_type) || connection.database_type === 'dm' || connection.database_type === 'oracle') {
      let loadedDatabases = allDatabases[tab.connectionId] ?? []
      if (loadedDatabases.length === 0) {
        await ensureDatabasesLoaded(tab.connectionId)
        loadedDatabases = allDatabasesRef.current[tab.connectionId] ?? []
      }
      const availableDatabases = loadedDatabases.length > 0 ? loadedDatabases : (selectedDatabasesRef.current[tab.connectionId] ?? [])
      if (!nextDatabaseName || !availableDatabases.includes(nextDatabaseName)) {
        nextDatabaseName = selectedDatabasesRef.current[tab.connectionId]?.[0]
          ?? availableDatabases[0]
          ?? getDefaultDatabaseName(connection)
      }
    }

    if (isSchemaScopedType(connection.database_type)) {
      let loadedDatabases = allDatabases[tab.connectionId] ?? []
      if (loadedDatabases.length === 0) {
        await ensureDatabasesLoaded(tab.connectionId)
        loadedDatabases = allDatabasesRef.current[tab.connectionId] ?? []
      }
      const availablePgDatabases = loadedDatabases.length > 0 ? loadedDatabases : (selectedDatabasesRef.current[tab.connectionId] ?? [])
      if (!nextPgDatabaseName || !availablePgDatabases.includes(nextPgDatabaseName)) {
        nextPgDatabaseName = selectedDatabasesRef.current[tab.connectionId]?.[0]
          ?? availablePgDatabases[0]
          ?? getDefaultPgDatabase(connection)
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

  const appendSqlToQueryWorkspace = useCallback((sql: string, title?: string): void => {
    const nextSql = sql.trimEnd()
    if (!nextSql) {
      return
    }

    const currentActiveTabKey = useWorkspaceStore.getState().activeTabKey
    const activeTab = currentActiveTabKey ? useWorkspaceStore.getState().getTabByKey(currentActiveTabKey) : undefined
    const canReuseActiveQuery = activeTab?.kind === 'query' && (
      activeTab.connectionId === aiActiveContext?.connectionId &&
      (activeTab.databaseName ?? '') === (aiActiveContext?.databaseName ?? '') &&
      (activeTab.pgDatabaseName ?? '') === (aiActiveContext?.pgDatabaseName ?? '')
    )
    if (canReuseActiveQuery && activeTab?.kind === 'query') {
      const separator = activeTab.sql.trim() ? '\n\n' : ''
      updateWorkspaceTab(activeTab.key, { sql: `${activeTab.sql}${separator}${nextSql}` })
      return
    }

    openQueryWorkspaceRef.current(nextSql, title ?? 'AI 生成 SQL', aiActiveContext?.connectionId, aiActiveContext?.databaseName, aiActiveContext?.pgDatabaseName)
  }, [aiActiveContext, updateWorkspaceTab])

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
    const activePreviewCandidate = currentActiveTabKey ? useWorkspaceStore.getState().getTabByKey(currentActiveTabKey) : undefined
    const activePreview = activePreviewCandidate?.kind === 'preview' && activePreviewCandidate.connectionId && activePreviewCandidate.tableName
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

  const handleAiPanelResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    aiPanelResizeRef.current = { startX: event.clientX, startSize: aiPanelSize }
    setResizingAiPanel(true)
  }, [aiPanelSize])

  const handleAiPanelWorkspaceAction = useCallback((action: AIWorkspaceAction) => {
    if (action.type === 'append_query_sql') {
      appendSqlToQueryWorkspace(action.sql, action.title)
    }
  }, [appendSqlToQueryWorkspace])

  const handleAiPanelAgentDataChanged = useCallback(() => {
    refreshAfterAgentChange()
  }, [refreshAfterAgentChange])

  const changeTabLimit = async (tab: WorkspaceTab, limit: number): Promise<void> => {
    updateWorkspaceTab(tab.key, { limit, page: 1, loading: true, error: undefined })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, limit, page: 1 })
      return
    }

    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      await previewRedisDatabase(tab.connectionId, tab.databaseName, limit, 1, tab.key, tab.where)
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(tab.connectionId, tab.tableName, tab.databaseName, tab.pgDatabaseName, limit, 1, tab.where)
    }
  }

  const changeTabPage = async (tab: WorkspaceTab, page: number): Promise<void> => {
    const nextPage = Math.max(1, page)
    updateWorkspaceTab(tab.key, { page: nextPage, loading: true, error: undefined })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, page: nextPage })
      return
    }

    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      await previewRedisDatabase(tab.connectionId, tab.databaseName, tab.limit ?? REDIS_DEFAULT_LIMIT, nextPage, tab.key, tab.where)
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(tab.connectionId, tab.tableName, tab.databaseName, tab.pgDatabaseName, tab.limit ?? PREVIEW_DEFAULT_LIMIT, nextPage, tab.where)
    }
  }

  const runQuery = useCallback(async (tab: WorkspaceTab, selectedSql?: string): Promise<void> => {
    const liveSelectionPayload = sqlEditorHandleRefs.current[tab.key]?.getSelectionPayload()
    const executionContext = liveSelectionPayload ?? sqlExecutionContextRef.current[tab.key] ?? sqlExecutionContextByTab[tab.key]
    const sqlToExecute = selectedSql?.trim()
      || executionContext?.selectedSql?.trim()
      || executionContext?.currentStatementSql?.trim()
      || tab.sql.trim()

    if (!tab.connectionId) {
      return
    }

    if (!sqlToExecute) {
      return
    }

    const resolvedTab = await resolveQueryExecutionContext(tab)
    if (!resolvedTab) {
      return
    }
    if (resolvedTab.treeOpenedForExecution) {
      await locateTreePath([
        `connection:${resolvedTab.connectionId}`,
        ...(resolvedTab.pgDatabaseName ? [`database:${resolvedTab.connectionId}:${resolvedTab.pgDatabaseName}`] : []),
        ...(resolvedTab.databaseName && resolvedTab.pgDatabaseName
          ? [`pg-schema:${resolvedTab.connectionId}:${resolvedTab.pgDatabaseName}:${resolvedTab.databaseName}`]
          : resolvedTab.databaseName
            ? [`database:${resolvedTab.connectionId}:${resolvedTab.databaseName}`]
            : [])
      ])
    }

    const connection = getConnection(resolvedTab.connectionId)

    if ((isDatabaseScopedType(connection?.database_type) || connection?.database_type === 'dm' || connection?.database_type === 'oracle') && !resolvedTab.databaseName) {
      return
    }

    if (isSchemaScopedType(connection?.database_type) && !resolvedTab.pgDatabaseName) {
      return
    }

    if (isSchemaScopedType(connection?.database_type) && !resolvedTab.databaseName) {
      return
    }

    updateWorkspaceTab(resolvedTab.key, {
      loading: true,
      error: undefined,
      resultVisible: true,
      resultCollapsed: false,
      resultKind: 'query',
      commandMessage: undefined,
      commandAffectedRows: undefined
    })

    try {
      const connection = getConnection(resolvedTab.connectionId)
      const result = await requestJson<QueryResponse>('/query', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: resolvedTab.connectionId,
          sql: sqlToExecute,
          limit: resolvedTab.limit ?? QUERY_DEFAULT_LIMIT,
          offset: Math.max(0, (resolvedTab.page ?? 1) - 1) * (resolvedTab.limit ?? QUERY_DEFAULT_LIMIT),
          database: connection?.database_type === 'mysql' || connection?.database_type === 'dm' || connection?.database_type === 'oracle' || isSchemaScopedType(connection?.database_type) || connection?.database_type === 'mongodb' || connection?.database_type === 'redis' || connection?.database_type === 'clickhouse' ? (resolvedTab.databaseName || undefined) : undefined,
          pg_database: isSchemaScopedType(connection?.database_type) ? (resolvedTab.pgDatabaseName || undefined) : undefined
        })
      })
      const isCommandResult = result.columns.length === 2
        && result.columns.includes('message')
        && result.columns.includes('affected_rows')
        && result.rows.length === 1
      const commandRow = isCommandResult ? result.rows[0] : undefined
      updateWorkspaceTab(resolvedTab.key, {
        result,
        page: resolvedTab.page ?? 1,
        selectedRowKeys: [],
        selectedRowKeyMap: {},
        columnFilterOptions: undefined,
        loading: false,
        error: undefined,
        resultVisible: true,
        resultCollapsed: false,
        resultKind: isCommandResult ? 'command' : 'query',
        commandMessage: isCommandResult && typeof commandRow?.message === 'string' ? commandRow.message : undefined,
        commandAffectedRows: isCommandResult && typeof commandRow?.affected_rows === 'number' ? commandRow.affected_rows : null
      })
    } catch (err) {
      updateWorkspaceTab(resolvedTab.key, {
        loading: false,
        error: err instanceof Error ? err.message : '查询失败',
        resultVisible: true,
        resultCollapsed: false,
        resultKind: 'error',
        commandMessage: undefined,
        commandAffectedRows: undefined
      })
    }
  }, [
    sqlExecutionContextByTab,
    isDatabaseScopedType,
    isSchemaScopedType,
    getConnection,
    locateTreePath,
    requestJson,
    resolveQueryExecutionContext,
    updateWorkspaceTab
  ])

  const renderWorkspaceTab = useCallback((tab: WorkspaceTab): React.ReactNode => {
    return renderWorkspaceTabContent({
      tab,
      theme,
      getConnection,
      connections,
      allDatabases,
      allSchemas,
      shortcutSettings,
      executionContext: sqlExecutionContextByTab[tab.key] ?? sqlExecutionContextRef.current[tab.key],
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
  }, [
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
  ])

  const handleActiveWorkspaceTabChange = useCallback((key: string) => {
    setActiveTabKey(key)
  }, [setActiveTabKey])

  const workspaceRenderVersionToken = useMemo(() => ({}), [workspaceTabSummaryCount])

  const stableRenderWorkspaceTabRef = useRef(renderWorkspaceTab)
  stableRenderWorkspaceTabRef.current = renderWorkspaceTab

  const stableRenderWorkspaceTab = useCallback((tab: WorkspaceTab, _active: boolean): React.ReactNode => {
    return stableRenderWorkspaceTabRef.current(tab)
  }, [])

  const stableConnectionCreateMenuHandler = useCallback((info: { key: string }) => {
    handleConnectionCreateMenuClickRef.current(info)
  }, [])

  const handleConnectionDriverChange = useCallback((value: string): void => {
    form.setFieldsValue({
      driver_id: value,
      dm_driver_id: connectionModalDatabaseType === 'dm' ? value : undefined
    })
  }, [connectionModalDatabaseType, form])

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
      window.api.onUpdateAvailable((info) => handleUpdateAvailable(info, true)),
      window.api.onUpdateNotAvailable((info) => setUpdateInfo(info)),
      window.api.onUpdateDownloadProgress((progress) => {
        setDownloadingUpdate(true)
        setUpdateProgress(progress)
      }),
      window.api.onUpdateDownloaded((info) => {
        setDownloadingUpdate(false)
        setUpdateInfo(info)
        setUpdateProgress((current) => ({ percent: 100, transferred: current?.transferred ?? 0, total: current?.total }))
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
    void loadConnections().catch(() => undefined)
  }, [backendStatus.state, backendStatus.apiBaseUrl])

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
  const updateDownloaded = updateMode === 'portable'
    ? Boolean(updateInfo?.downloadedPath)
    : Boolean(updateInfo?.installerDownloaded)
  const updateActionText = updateMode === 'portable' ? '下载绿色版' : '下载并安装'
  const updateStatusMessage = updateInfo?.available
    ? `发现新版本 ${updateInfo.latestVersion ?? ''}`
    : `当前版本 ${updateSettings?.currentVersion ?? updateInfo?.currentVersion ?? ''}`

  const backendReady = backendStatus.state === 'online'
  const showBackendStatusTag = startupUiReady || backendStatus.state === 'failed' || backendStatus.state === 'crashed'
  const backendStatusIcon = backendReady ? <CheckCircleOutlined /> : <CloseCircleOutlined />
  const activeAIConnection = getConnection(aiActiveContext?.connectionId)
  const aiContextConnection = activeAIConnection?.is_open ? activeAIConnection : undefined
  const aiDatabase = isSchemaScopedType(aiContextConnection?.database_type)
    ? aiActiveContext?.databaseName
    : aiActiveContext?.databaseName
  const aiPgDatabase = isSchemaScopedType(aiContextConnection?.database_type) && aiContextConnection
    ? aiActiveContext?.pgDatabaseName
    : undefined
  const aiDbName = isSchemaScopedType(aiContextConnection?.database_type)
    ? [aiPgDatabase, aiDatabase].filter(Boolean).join('.')
    : aiDatabase
  const primaryAIContextSource: AIContextSource | undefined = useMemo(() => (
    aiContextConnection && aiDbName
      ? {
          id: contextSourceId({
            type: isSchemaScopedType(aiContextConnection.database_type) && aiDatabase ? 'schema' : 'database',
            connectionId: aiContextConnection.connection_id,
            database: isSchemaScopedType(aiContextConnection.database_type) ? aiPgDatabase : aiDatabase,
            schema: isSchemaScopedType(aiContextConnection.database_type) ? aiDatabase : undefined,
            pgDatabase: isSchemaScopedType(aiContextConnection.database_type) ? aiPgDatabase : undefined
          }),
          type: isSchemaScopedType(aiContextConnection.database_type) && aiDatabase ? 'schema' : 'database',
          connectionId: aiContextConnection.connection_id,
          connectionName: aiContextConnection.name,
          dbType: aiContextConnection.database_type,
          database: isSchemaScopedType(aiContextConnection.database_type) ? aiPgDatabase : aiDatabase,
          schema: isSchemaScopedType(aiContextConnection.database_type) ? aiDatabase : undefined,
          pgDatabase: isSchemaScopedType(aiContextConnection.database_type) ? aiPgDatabase : undefined
        }
      : undefined
  ), [aiContextConnection, aiDatabase, aiDbName, aiPgDatabase, isSchemaScopedType])
  const effectiveAIContextSources = useMemo(() => (
    primaryAIContextSource
      ? [primaryAIContextSource, ...aiContextSources.filter((source) => source.id !== primaryAIContextSource.id)]
      : aiContextSources
  ), [aiContextSources, primaryAIContextSource])
  const focusedConnection = getConnection(focusedTreeNode?.connectionId)
  const focusedResource = useMemo(() => (
    focusedTreeNode
      ? {
          kind: focusedTreeNode.kind,
          connectionId: focusedTreeNode.connectionId,
          connectionName: focusedConnection?.name,
          dbType: focusedConnection?.database_type,
          database: isSchemaScopedType(focusedConnection?.database_type) ? focusedTreeNode.pgDatabaseName : focusedTreeNode.databaseName,
          schema: isSchemaScopedType(focusedConnection?.database_type) ? focusedTreeNode.databaseName : undefined,
          pgDatabase: focusedTreeNode.pgDatabaseName,
          table: focusedTreeNode.tableName,
          objectType: focusedTreeNode.objectType,
          name: String(focusedTreeNode.title ?? focusedTreeNode.tableName ?? focusedTreeNode.databaseName ?? focusedConnection?.name ?? ''),
          sizeDisplay: focusedTreeNode.sizeDisplay,
          rowCount: focusedTreeNode.rowCount
        }
      : undefined
  ), [focusedConnection?.database_type, focusedConnection?.name, focusedTreeNode])
  const connectionSummaries = useMemo(() => connections.map((connection) => ({
    connectionId: connection.connection_id,
    name: connection.name,
    dbType: connection.database_type,
    database: connection.database,
    isOpen: connection.is_open,
    serverVersion: connection.server_version
  })), [connections])
  const aiPanelContent = useMemo(() => {
    if (!aiPanelOpen) {
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
    requestJson,
    aiContextConnection,
    aiDbName,
    aiDatabase,
    aiPgDatabase,
    focusedResource,
    connectionSummaries,
    effectiveAIContextSources,
    primaryAIContextSource,
    removeAIContextSource,
    handleAiPanelWorkspaceAction,
    handleAiPanelAgentDataChanged,
    shortcutSettings.ai_send,
    shortcutSettings.ai_newline,
    shortcutSettings.ai_stop
  ])

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
            <div className="brand-mark"><img src={appIcon} alt="" /></div>
            <Typography.Title level={4} className="brand-title">DataDjinn</Typography.Title>
          </Space>
          <div className="titlebar-spacer" />
          <Space className="toolbar-actions titlebar-no-drag" size={4}>
            <Button className="toolbar-query-btn" type="primary" size="small" icon={<FileAddOutlined />} onClick={() => openQueryWorkspace('', '新建查询')} title="新建查询" aria-label="新建查询">
              新建查询
            </Button>
            <Button className="toolbar-icon-btn" type="text" size="small" icon={<HistoryOutlined />} onClick={openQueryHistoryModal} title="历史查询窗口" aria-label="历史查询窗口" />
            <Button className="toolbar-icon-btn" type="text" size="small" icon={<SettingOutlined />} onClick={() => openSettings('app')} title="设置" aria-label="设置" />
            <Button className={`toolbar-icon-btn${updateInfo?.available || downloadingUpdate ? ' is-highlighted' : ''}`} type={updateInfo?.available || downloadingUpdate ? 'primary' : 'text'} size="small" icon={<CloudDownloadOutlined />} loading={checkingUpdate} onClick={() => { openUpdateModal(); if (!downloadingUpdate) { void checkForUpdates(true) } }} title="检查更新" aria-label="检查更新" />
            <Button className="toolbar-icon-btn" type="text" size="small" icon={<ReloadOutlined />} loading={healthLoading} onClick={() => void checkHealth()} title="同步状态" aria-label="同步状态" />
            <Button className={`toolbar-icon-btn${aiPanelOpen ? ' is-highlighted' : ''}`} type={aiPanelOpen ? 'primary' : 'text'} size="small" icon={<MessageOutlined />} onClick={() => setAiPanelOpen((open) => !open)} title={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} aria-label={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} />
            <Button className="theme-toggle-btn" type="text" size="small" icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} />
            {showBackendStatusTag && (
              <Tag className="service-pill" icon={backendStatusIcon} color={BACKEND_COLORS[backendStatus.state]} title={backendStatus.message}>{BACKEND_LABELS[backendStatus.state]}</Tag>
            )}
          </Space>
          <Space className="window-controls titlebar-no-drag" size={0}>
            <Button className="window-control-btn" type="text" onClick={() => void window.api.minimizeWindow()} title="最小化" aria-label="最小化">
              <span className="window-glyph window-glyph-minimize" aria-hidden="true" />
            </Button>
            <Button className="window-control-btn" type="text" onClick={() => void window.api.toggleMaximizeWindow()} title="最大化" aria-label="最大化">
              <span className="window-glyph window-glyph-maximize" aria-hidden="true" />
            </Button>
            <Button className="window-control-btn window-control-close" type="text" danger onClick={() => void window.api.closeWindow()} title="关闭" aria-label="关闭">
              <span className="window-glyph window-glyph-close" aria-hidden="true" />
            </Button>
          </Space>
        </Flex>
      </Layout.Header>
      <Layout.Content className="app-content">
        <div ref={workspaceShellRef} className="workspace">
          <div ref={resourcePanelRef} className="resource-panel" style={{ width: resourcePanelSize, flex: `0 0 ${resourcePanelSize}px` }}>
            <div className="resource-header">
              <Space className="resource-header-copy" direction="vertical" size={2}>
                <Typography.Text className="panel-kicker">DATABASE EXPLORER</Typography.Text>
                <Typography.Title level={5} className="panel-title">数据资产</Typography.Title>
              </Space>
              <Space className="resource-header-actions" size={8}>
                <Button className="resource-import" size="small" icon={<LoginOutlined />} onClick={openImportConnectionModal}>导入连接</Button>
                <Dropdown menu={resourceCreateMenu} trigger={['click']} overlayClassName="resource-create-dropdown" {...FAST_PRELOADED_DROPDOWN_PROPS}>
                  <Button className="resource-add" type="primary" size="small" icon={<PlusOutlined />}>新建</Button>
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
              setTreeSearchText={setTreeSearchText}
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
              resourcePanelResizeRef.current = { startX: event.clientX, startSize: resourcePanelSize }
              setResizingResourcePanel(true)
            }}
          />
          <MainWorkspacePanel
            mainPanelRef={mainPanelRef}
            aiDockPanelRef={aiDockPanelRef}
            theme={theme}
            aiPanelOpen={aiPanelOpen}
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
        width={680}
        className="update-window-modal"
        maskClosable={false}
        deferContentMount
      >
        {(contentReady) => contentReady ? (
        <Space direction="vertical" className="full-width update-modal-layout" size="middle">
          <Alert
            className="update-status-alert"
            type={updateInfo?.available ? 'info' : 'success'}
            showIcon
            message={updateStatusMessage}
            description={updateMode === 'installer' ? '安装版支持自动下载，并在重启后安装更新。' : '绿色版支持检测并下载新版 zip，下载后需要关闭应用并手动解压替换。'}
          />
          <Flex justify="space-between" align="center" className="update-meta-strip">
            <Typography.Text>当前版本：{updateSettings?.currentVersion ?? updateInfo?.currentVersion ?? '-'}</Typography.Text>
            <Tag color={updateMode === 'installer' ? 'blue' : 'purple'}>{updateMode === 'installer' ? '安装版' : '绿色版'}</Tag>
          </Flex>
          {updateInfo?.latestVersion && <Typography.Text className="update-version-line">最新版本：{updateInfo.latestVersion}</Typography.Text>}
          <Flex justify="space-between" align="center" className="update-toggle-card">
            <Typography.Text>启动时自动检查更新</Typography.Text>
            <Switch className="update-auto-check-switch" checked={updateSettings?.autoCheckUpdates ?? true} onChange={(checked) => void window.api.setAutoCheckUpdates(checked).then(refreshUpdateSettings)} />
          </Flex>
          {updateInfo?.releaseNotes && (
            <div className="update-release-notes ai-markdown" dangerouslySetInnerHTML={renderMarkdown(updateInfo.releaseNotes)} />
          )}
          {updateProgress && (
            <Progress percent={updateProgress.percent} status={updateProgress.percent >= 100 ? 'success' : 'active'} />
          )}
          {updateInfo?.downloadedPath && (
            <Alert className="update-status-alert" type="success" showIcon message="绿色版更新包已下载" description={`文件位置：${updateInfo.downloadedPath}。请关闭应用后手动解压替换旧目录。`} />
          )}
          <Flex justify="end" gap={8} wrap="wrap" className="update-modal-actions">
            <Button onClick={() => void checkForUpdates(true)} loading={checkingUpdate}>重新检查</Button>
            {updateInfo?.releaseUrl && <Button onClick={() => void window.api.openReleasePage(updateInfo.releaseUrl)}>查看发布页</Button>}
            {updateInfo?.available && <Button onClick={() => void skipUpdate()}>跳过此版本</Button>}
            {updateInfo?.available && !updateDownloaded && <Button type="primary" loading={downloadingUpdate} onClick={() => void downloadUpdate()}>{updateActionText}</Button>}
            {updateDownloaded && <Button type="primary" onClick={() => void installUpdate()}>{updateMode === 'installer' ? '重启并安装' : '打开下载位置'}</Button>}
          </Flex>
        </Space>
        ) : (
          <div className="deferred-modal-loading"><LoadingOutlined spin /></div>
        )}
      </ImperativeModalHost>
      <ImperativeModalHost
        ref={queryHistoryModalRef}
        title="历史查询窗口"
        footer={null}
        width={760}
        className="query-history-window-modal"
        deferContentMount
      >
        {(contentReady) => contentReady ? (
        <div className="query-history-modal">
          <div className="query-history-summary-card">
            <div className="query-history-summary-icon"><HistoryOutlined /></div>
            <div className="query-history-summary-copy">
              <div className="query-history-summary-title">双击恢复查询窗口</div>
              <div className="query-history-summary-meta">
                共 {persistedQueryWorkspaces.length} 个历史查询，按连接分组展示，删除操作会先二次确认。
              </div>
            </div>
          </div>
          {queryHistoryGroups.length ? queryHistoryGroups.map(({ groupName, items, latestPersistedAt }) => (
            <div key={groupName} className="query-history-group">
              <div className="query-history-group-header">
                <div className="query-history-group-title-wrap">
                  <div className="query-history-group-title">{groupName}</div>
                  <div className="query-history-group-meta">最近保存于 {formatQueryHistoryTime(latestPersistedAt)}</div>
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
                        <div className="query-history-item-time">{formatQueryHistoryTime(item.persistedAt)}</div>
                      </div>
                      <div className="query-history-item-meta">
                        {[item.pgDatabaseName, item.databaseName].filter(Boolean).join('.') || '未选择库'}
                      </div>
                      <div className="query-history-item-sql">{getQueryHistoryPreviewText(item.sql)}</div>
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
          )) : (
            <div className="query-history-empty">
              <div className="query-history-empty-title">还没有历史查询</div>
              <div className="query-history-empty-meta">新建查询窗口后会自动保存到这里，后续可以双击直接恢复。</div>
            </div>
          )}
        </div>
        ) : (
          <div className="deferred-modal-loading"><LoadingOutlined spin /></div>
        )}
      </ImperativeModalHost>
      <Modal
        title="导入连接"
        open={importConnectionModalOpen}
        width={980}
        className="import-connection-modal"
        onCancel={closeImportConnectionModal}
        afterOpenChange={(nextOpen) => {
          if (!nextOpen) {
            resetImportConnectionState()
          }
        }}
        maskClosable={false}
        {...FAST_MODAL_PROPS}
        footer={(
          <Space>
            <Button onClick={closeImportConnectionModal}>关闭</Button>
            <Button loading={importConnectionParsing} onClick={parseImportConnections}>解析</Button>
            <Button
              type="primary"
              loading={importingConnections}
              disabled={importConnectionCandidates.filter((candidate) => candidate.payload && candidate.status !== 'error').length === 0}
              onClick={() => void importParsedConnections()}
            >
              导入
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" className="full-width import-connection-layout" size={18}>
          <div className="import-connection-hero">
            <div className="import-connection-hero-badge">Data Source Import</div>
            <Typography.Title level={4}>粘贴 DataGrip / IDEA 数据源配置，批量导入到 DataDjinn</Typography.Title>
            <Typography.Text type="secondary">先解析，再确认导入。解析结果会提前展示可导入状态和失败原因。</Typography.Text>
          </div>
          <Form layout="vertical" className="import-connection-form">
            <Form.Item label="来源" className="import-connection-field">
              <Select
                value={importConnectionSource}
                options={IMPORT_CONNECTION_SOURCE_OPTIONS}
                onChange={(value) => setImportConnectionSource(value as ImportConnectionSource)}
              />
            </Form.Item>
            <Form.Item
              label="连接配置文本"
              className="import-connection-field import-connection-field-textarea"
              extra="选中复制DataGrip/IDEA中的数据源并复制粘贴到上方。"
            >
              <Input.TextArea
                value={importConnectionRawText}
                autoSize={{ minRows: 10, maxRows: 18 }}
                placeholder="#DataSourceSettings# ..."
                onChange={(event) => setImportConnectionRawText(event.target.value)}
              />
            </Form.Item>
          </Form>
          {importConnectionCandidates.length > 0 && (
            <Space direction="vertical" className="full-width import-connection-preview" size={12}>
              <Flex justify="space-between" align="center" className="import-connection-preview-header">
                <Typography.Text strong>解析结果</Typography.Text>
                <Typography.Text type="secondary">
                  共 {importConnectionCandidates.length} 个，{importConnectionCandidates.filter((candidate) => candidate.status !== 'error' && candidate.payload).length} 个可导入
                </Typography.Text>
              </Flex>
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                scroll={{ y: 280 }}
                columns={importConnectionPreviewColumns}
                dataSource={importConnectionCandidates}
              />
            </Space>
          )}
        </Space>
      </Modal>
      <Modal
        title="导入结果"
        open={importConnectionResultOpen}
        width={880}
        className="import-connection-result-modal"
        onCancel={closeImportConnectionResultModal}
        footer={<Button type="primary" onClick={closeImportConnectionResultModal}>关闭</Button>}
        maskClosable={false}
        {...FAST_MODAL_PROPS}
      >
        {importConnectionResult && (
          <Space direction="vertical" className="full-width import-connection-result-layout" size={14}>
            <Alert
              type={importConnectionResult.failed.length > 0 ? 'warning' : 'success'}
              showIcon
              message={`成功 ${importConnectionResult.success.length} 个，失败 ${importConnectionResult.failed.length} 个`}
            />
            {importConnectionResult.success.length > 0 && (
              <Space direction="vertical" className="full-width import-connection-result-section" size={8}>
                <Typography.Text strong>导入成功</Typography.Text>
                <Table
                  rowKey={(record) => `${record.name}-${record.database_type ?? 'unknown'}-success`}
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '名称', dataIndex: 'name', key: 'name', width: 220, ellipsis: true },
                    { title: '类型', dataIndex: 'database_type', key: 'database_type', width: 100, render: (value?: DatabaseType) => value ? DATABASE_TYPE_LABELS[value] : '-' },
                    { title: '说明', dataIndex: 'message', key: 'message', ellipsis: true, render: (value?: string) => value || '-' }
                  ]}
                  dataSource={importConnectionResult.success}
                />
              </Space>
            )}
            {importConnectionResult.failed.length > 0 && (
              <Space direction="vertical" className="full-width import-connection-result-section import-connection-result-section-danger" size={8}>
                <Typography.Text strong>导入失败</Typography.Text>
                <Table
                  rowKey={(record) => `${record.name}-${record.database_type ?? 'unknown'}-failed`}
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '名称', dataIndex: 'name', key: 'name', width: 220, ellipsis: true },
                    { title: '类型', dataIndex: 'database_type', key: 'database_type', width: 100, render: (value?: DatabaseType) => value ? DATABASE_TYPE_LABELS[value] : '-' },
                    { title: '失败原因', dataIndex: 'message', key: 'message', ellipsis: true, render: (value?: string) => value || '-' }
                  ]}
                  dataSource={importConnectionResult.failed}
                />
              </Space>
            )}
          </Space>
        )}
      </Modal>
      <Modal
        title="输入连接密码"
        open={connectionPasswordPromptOpen}
        onCancel={closeConnectionPasswordPrompt}
        onOk={() => void submitConnectionPasswordPrompt()}
        okText="重试连接"
        cancelText="取消"
        maskClosable={false}
        {...FAST_MODAL_PROPS}
      >
        <Space direction="vertical" className="full-width" size={12}>
          <Typography.Text>
            <Typography.Text strong>连接：</Typography.Text>
            {connectionPasswordPromptConnectionName}
          </Typography.Text>
          <Alert type="warning" showIcon message={connectionPasswordPromptReason || '请输入密码后重试连接'} />
          <Input.Password
            autoFocus
            value={connectionPasswordDraft}
            placeholder="请输入密码"
            onChange={(event) => setConnectionPasswordDraft(event.target.value)}
            onPressEnter={() => void submitConnectionPasswordPrompt()}
          />
        </Space>
      </Modal>
      <ImperativeModalHost
        ref={settingsModalRef}
        title="设置"
        footer={null}
        width={1040}
        className="settings-window-modal"
        maskClosable={false}
        deferContentMount
      >
        {(contentReady) => contentReady ? (
        <Flex gap={18} align="stretch" className="settings-layout">
          <div className="settings-sidebar">
            <Menu
              mode="inline"
              selectedKeys={[settingsSection]}
              onClick={({ key }) => switchSettingsSection(key as SettingsSection)}
              items={[
                { key: 'app', icon: <SettingOutlined />, label: '应用' },
                { key: 'shortcuts', icon: <ThunderboltOutlined />, label: '快捷键' },
                { key: 'drivers', icon: <DatabaseOutlined />, label: '驱动管理' }
              ]}
            />
          </div>
          <div className="settings-content">
            {settingsSection === 'app' ? (
              <Space direction="vertical" className="full-width settings-section-stack" size="large">
                <div className="settings-about-card">
                  <img className="settings-about-logo" src={appLogoHorizontal} alt="DataDjinn" />
                  <Typography.Text type="secondary">当前版本：{appInfo?.version ?? updateSettings?.currentVersion ?? '-'}</Typography.Text>
                </div>
                <Button className="settings-glass-action" icon={<GithubOutlined />} onClick={() => void window.api.openProjectHome()}>
                  GitHub
                </Button>
              </Space>
            ) : settingsSection === 'shortcuts' ? (
              <Space direction="vertical" className="full-width settings-section-stack" size="large">
                <div className="settings-section-card settings-shortcut-card">
                  <Typography.Title level={5} style={{ marginTop: 0 }}>SQL 编辑器</Typography.Title>
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
                      onReset={() => setShortcutSettings((current) => ({ ...current, sql_execute: DEFAULT_SHORTCUT_SETTINGS.sql_execute }))}
                    />
                    <ShortcutRecorder
                      label={SHORTCUT_SETTING_LABELS.sql_delete_line}
                      value={shortcutSettings.sql_delete_line}
                      defaultValue={DEFAULT_SHORTCUT_SETTINGS.sql_delete_line}
                      recording={recordingShortcutAction === 'sql_delete_line'}
                      onStartRecord={() => setRecordingShortcutAction('sql_delete_line')}
                      onCancel={() => setRecordingShortcutAction(null)}
                      onChange={(value) => {
                        setShortcutSettings((current) => ({ ...current, sql_delete_line: value }))
                        setRecordingShortcutAction(null)
                      }}
                      onReset={() => setShortcutSettings((current) => ({ ...current, sql_delete_line: DEFAULT_SHORTCUT_SETTINGS.sql_delete_line }))}
                    />
                    <ShortcutRecorder
                      label={SHORTCUT_SETTING_LABELS.sql_duplicate_line_down}
                      value={shortcutSettings.sql_duplicate_line_down}
                      defaultValue={DEFAULT_SHORTCUT_SETTINGS.sql_duplicate_line_down}
                      recording={recordingShortcutAction === 'sql_duplicate_line_down'}
                      onStartRecord={() => setRecordingShortcutAction('sql_duplicate_line_down')}
                      onCancel={() => setRecordingShortcutAction(null)}
                      onChange={(value) => {
                        setShortcutSettings((current) => ({ ...current, sql_duplicate_line_down: value }))
                        setRecordingShortcutAction(null)
                      }}
                      onReset={() => setShortcutSettings((current) => ({ ...current, sql_duplicate_line_down: DEFAULT_SHORTCUT_SETTINGS.sql_duplicate_line_down }))}
                    />
                    <ShortcutRecorder
                      label={SHORTCUT_SETTING_LABELS.table_search}
                      value={shortcutSettings.table_search}
                      defaultValue={DEFAULT_SHORTCUT_SETTINGS.table_search}
                      recording={recordingShortcutAction === 'table_search'}
                      onStartRecord={() => setRecordingShortcutAction('table_search')}
                      onCancel={() => setRecordingShortcutAction(null)}
                      onChange={(value) => {
                        setShortcutSettings((current) => ({ ...current, table_search: value }))
                        setRecordingShortcutAction(null)
                      }}
                      onReset={() => setShortcutSettings((current) => ({ ...current, table_search: DEFAULT_SHORTCUT_SETTINGS.table_search }))}
                    />
                  </Space>
                </div>
                <div className="settings-section-card settings-shortcut-card">
                  <Typography.Title level={5} style={{ marginTop: 0 }}>AI 窗口</Typography.Title>
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
                      onReset={() => setShortcutSettings((current) => ({ ...current, ai_send: DEFAULT_SHORTCUT_SETTINGS.ai_send }))}
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
                      onReset={() => setShortcutSettings((current) => ({ ...current, ai_newline: DEFAULT_SHORTCUT_SETTINGS.ai_newline }))}
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
                      onReset={() => setShortcutSettings((current) => ({ ...current, ai_stop: DEFAULT_SHORTCUT_SETTINGS.ai_stop }))}
                    />
                  </Space>
                </div>
              </Space>
            ) : (
              <Space direction="vertical" className="full-width settings-section-stack" size="middle">
                <Space direction="vertical" className="full-width settings-section-card settings-jdbc-card" size="small">
                  <Typography.Title level={5} style={{ margin: 0 }}>全局 JDBC Java 环境</Typography.Title>
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
                      <Typography.Text>启用 JDBC Java 环境</Typography.Text>
                      <Typography.Text type="secondary">关闭后应用启动时不会加载 Java，使用 JDBC 驱动连接时需要先开启并配置。</Typography.Text>
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
                        if (!normalizedInput || selectedJavaRuntimeValues.has(normalizedInput)) {
                          return true
                        }
                        return String(option?.value ?? '').toLowerCase().includes(normalizedInput) || String(option?.label ?? '').toLowerCase().includes(normalizedInput)
                      }}
                      className="full-width"
                    />
                    <Button disabled={!jdbcJavaEnabled} onClick={() => void selectJavaDirectory()}>选择</Button>
                    <Button type="primary" onClick={() => void saveJdbcJavaConfig()}>保存</Button>
                  </Space.Compact>
                </Space>
                <div className="driver-manager-shell">
                  <div className="driver-manager-nav">
                    <div className="driver-manager-nav-panel">
                      <Typography.Text strong>数据库类型</Typography.Text>
                    </div>
                    {DRIVER_DATABASE_ORDER.map((databaseType) => {
                      const meta = DRIVER_DATABASE_META[databaseType]
                      const databaseDrivers = drivers.filter((driver) => driver.database_type === databaseType)
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
                        <span>{driverTypeOptionsForDatabase(selectedDriverDatabaseType).length}</span>
                        <small>支持格式</small>
                      </div>
                    </div>
                    <div className="driver-manager-section-card">
                      <Flex justify="space-between" align="center" gap={12}>
                        <Space direction="vertical" size={2}>
                          <Typography.Title level={5} style={{ margin: 0 }}>{selectedDriverDatabaseMeta.label}驱动</Typography.Title>
                        </Space>
                        <Space size={8} wrap>
                          <Tag>{selectedDriverDatabaseMeta.shortLabel}</Tag>
                          <Button loading={driversLoading} onClick={() => void loadDrivers()}>刷新</Button>
                        </Space>
                      </Flex>
                      <Table<DriverInfo>
                        size="small"
                        rowKey="id"
                        loading={driversLoading}
                        pagination={false}
                        tableLayout="fixed"
                        locale={{ emptyText: `${selectedDriverDatabaseMeta.shortLabel} 暂无已配置驱动` }}
                        dataSource={selectedDatabaseDrivers}
                        columns={[
                          { title: '名称', dataIndex: 'name', width: 180, ellipsis: true, render: (value: string) => <Typography.Text ellipsis title={value}>{value}</Typography.Text> },
                          { title: '驱动类型', dataIndex: 'driver_type', width: 110, render: (value: DriverInfo['driver_type']) => driverTypeLabel(value) },
                          { title: '驱动文件', ellipsis: true, render: (_: unknown, driver) => <Typography.Text ellipsis title={driver.path ?? undefined}>{driver.path}</Typography.Text> },
                          { title: '操作', width: 132, render: (_: unknown, driver) => <Space size={4} wrap={false}><Button size="small" onClick={() => void testDriver(driver)}>测试</Button><Button danger size="small" onClick={() => void deleteDriver(driver)}>删除</Button></Space> }
                        ]}
                      />
                    </div>
                    <div className="driver-manager-section-card">
                      <Space direction="vertical" size={2} className="full-width">
                        <Typography.Title level={5} style={{ margin: 0 }}>添加 {selectedDriverDatabaseMeta.shortLabel} 驱动</Typography.Title>
                        <Typography.Text type="secondary">支持 {selectedDriverTypeLabels}</Typography.Text>
                      </Space>
                      <Form form={driverForm} layout="vertical" initialValues={{ database_type: 'dm', driver_type: 'jdbc', enabled: true }}>
                        <Form.Item name="database_type" style={{ display: 'none' }}>
                          <Input />
                        </Form.Item>
                        <Form.Item name="driver_type" label="驱动类型" rules={[{ required: true, message: '请选择驱动类型' }]}>
                          <Select popupClassName="settings-glass-select-dropdown" options={driverTypeOptionsForDatabase(selectedDriverDatabaseType)} />
                        </Form.Item>
                        <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
                          <Input placeholder={selectedDriverDatabaseType === 'gaussdb' ? '例如：高斯 JDBC 生产环境' : '例如：达梦 JDBC / 本机 dmPython'} />
                        </Form.Item>
                        <Form.Item
                          name="path"
                          label={driverPathLabel(selectedDriverDatabaseType, driverType)}
                          rules={[{ required: true, message: `请选择${driverPathLabel(selectedDriverDatabaseType, driverType)}` }]}
                        >
                          <Input readOnly placeholder={driverPathPlaceholder(selectedDriverDatabaseType, driverType)} addonAfter={<Button type="link" size="small" onClick={() => void selectDriverFile()}>选择</Button>} />
                        </Form.Item>
                        <Button type="primary" loading={driverSaving} onClick={() => void addDriver()}>添加驱动</Button>
                      </Form>
                    </div>
                  </div>
                </div>
              </Space>
            )}
          </div>
        </Flex>
        ) : (
          <div className="deferred-modal-loading"><LoadingOutlined spin /></div>
        )}
      </ImperativeModalHost>
      <Modal title={editingTableName ? `修改表：${editingTableName}` : '修改表'} open={tableEditorOpen} okText="保存" cancelText="取消" confirmLoading={tableEditorLoading} onOk={() => void saveTableEditor()} onCancel={() => setTableEditorOpen(false)} width={980} okButtonProps={{ disabled: !tableDesignerSupportsEdit(getConnection(editingConnectionId)?.database_type) }} maskClosable={false} {...FAST_MODAL_PROPS}>
        {renderTableDesigner('edit', editingConnectionId, editingDatabaseName, editingPgDatabaseName, editingTableName ?? '', undefined, editingTableComment, setEditingTableComment, editingColumns, tableEditorLoading)}
      </Modal>
      <Modal title={creatingSchemaDatabaseName ? '新建 Schema' : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' ? '新建用户' : '新增数据库'} open={databaseCreateModalOpen} className="database-create-modal" okText="创建" cancelText="取消" confirmLoading={databaseCreateLoading} onOk={() => void createDatabase()} onCancel={() => { setDatabaseCreateModalOpen(false); setCreatingSchemaDatabaseName(''); setDatabaseCreatePassword('') }} okButtonProps={{ disabled: !databaseCreateName.trim() || (getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' && !creatingSchemaDatabaseName && !databaseCreatePassword.trim()) }} maskClosable={false} {...FAST_MODAL_PROPS}>
        <Form layout="vertical" className="database-create-form">
          <Form.Item label={creatingSchemaDatabaseName ? 'Schema 名称' : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' ? '用户名' : '数据库名称'} required>
            <Input placeholder={creatingSchemaDatabaseName ? '请输入 Schema 名称' : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' ? '请输入用户名' : '请输入数据库名称'} value={databaseCreateName} onChange={(event) => setDatabaseCreateName(event.target.value)} onPressEnter={() => void createDatabase()} />
          </Form.Item>
          {getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' && !creatingSchemaDatabaseName && (
            <Form.Item label="用户密码" required>
              <Input.Password placeholder="请输入用户密码" value={databaseCreatePassword} onChange={(event) => setDatabaseCreatePassword(event.target.value)} onPressEnter={() => void createDatabase()} />
            </Form.Item>
          )}
          <Typography.Text type="secondary">{getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' && !creatingSchemaDatabaseName ? '用户名仅允许字母、数字、下划线，首字符不能是数字；创建后会自动授予基础开发权限。' : '仅允许字母、数字、下划线，首字符不能是数字，长度 1-64。'}</Typography.Text>
        </Form>
      </Modal>
      <Modal title="运行 SQL 文件" open={sqlFileModalOpen} okText="执行" cancelText="取消" confirmLoading={sqlFileLoading} onOk={() => void runSqlFile()} onCancel={() => setSqlFileModalOpen(false)} okButtonProps={{ danger: true, disabled: sqlFileDatabases.length > 0 && !sqlFileDatabase }} footer={sqlFileResult ? undefined : (_, { OkBtn, CancelBtn }) => (<Space><CancelBtn /><OkBtn /></Space>)} maskClosable={false} {...FAST_MODAL_PROPS}>
        {sqlFileResult ? (
          <Space direction="vertical" className="full-width">
            <Alert type={sqlFileResult.failed_count === 0 ? 'success' : 'warning'} message={`执行完成：${sqlFileResult.success_count} 条成功，${sqlFileResult.failed_count} 条失败`} showIcon />
            {sqlFileResult.errors.length > 0 && (
              <Space direction="vertical" className="full-width sql-file-errors">
                <Typography.Text strong>错误信息：</Typography.Text>
                <Input.TextArea value={sqlFileResult.errors.join('\n\n')} autoSize={{ minRows: 4, maxRows: 12 }} readOnly />
              </Space>
            )}
            <Button type="default" block onClick={() => setSqlFileModalOpen(false)}>关闭</Button>
          </Space>
        ) : (
          <Space direction="vertical" className="full-width">
            <Alert type="warning" message="SQL 文件可能包含 DDL/DML 写操作，执行后不可撤销，请确认无误后再执行。" showIcon />
            <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(sqlFileConnectionId)?.name ?? sqlFileConnectionId}</Typography.Text>
            <Typography.Text><Typography.Text strong>文件：</Typography.Text>{sqlFileName}</Typography.Text>
            <Typography.Text><Typography.Text strong>SQL 行数：</Typography.Text>{sqlFileContent ? sqlFileContent.split('\n').length : 0}</Typography.Text>
            <Form layout="vertical">
              <Form.Item label={isSchemaScopedType(getConnection(sqlFileConnectionId)?.database_type) ? '目标 Schema' : '目标数据库'} required={sqlFileDatabases.length > 0} rules={sqlFileDatabases.length > 0 ? [{ required: true, message: isSchemaScopedType(getConnection(sqlFileConnectionId)?.database_type) ? '请选择目标 Schema' : '请选择目标数据库' }] : undefined}>
                {sqlFileDatabases.length > 0 ? (<Select placeholder={isSchemaScopedType(getConnection(sqlFileConnectionId)?.database_type) ? '请选择目标 Schema' : '请选择目标数据库'} value={sqlFileDatabase || undefined} onChange={(value) => setSqlFileDatabase(value)} options={sqlFileDatabases.map((db) => ({ label: db.name, value: db.name }))} />) : (<Input placeholder="留空则使用连接默认数据库" value={sqlFileDatabase} onChange={(event) => setSqlFileDatabase(event.target.value)} />)}
              </Form.Item>
            </Form>
          </Space>
        )}
      </Modal>
      <DdlPreviewModal ref={ddlPreviewModalRef} theme={theme} onError={(errorMessage) => showError(errorMessage)} />
      <Modal
        title={folderEditorMode === 'rename' ? '重命名分组' : '新建分组'}
        open={folderEditorOpen}
        className="folder-editor-modal"
        okText={folderEditorMode === 'rename' ? '保存' : '创建'}
        cancelText="取消"
        onOk={saveFolder}
        onCancel={() => {
          setFolderEditorOpen(false)
          setEditingFolderId(undefined)
          setFolderNameDraft('')
        }}
        okButtonProps={{ disabled: !folderNameDraft.trim() }}
        centered
        maskClosable={false}
        {...FAST_MODAL_PROPS}
      >
        <Form layout="vertical" className="folder-editor-form">
          <Form.Item label="分组名称" required>
            <Input
              value={folderNameDraft}
              placeholder="例如：生产环境 / 测试环境 / 客户项目"
              onChange={(event) => setFolderNameDraft(event.target.value)}
              onPressEnter={(event) => {
                event.preventDefault()
                saveFolder()
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '新建集合' : '新建表'} open={createTableModalOpen} okText="创建" cancelText="取消" confirmLoading={createTableLoading} onOk={() => void createTable()} onCancel={() => setCreateTableModalOpen(false)} width={980} okButtonProps={{ disabled: !newTableName.trim() || (getConnection(createTableConnectionId)?.database_type !== 'mongodb' && newTableColumns.filter((c) => c.name.trim()).length === 0) }} maskClosable={false} {...FAST_MODAL_PROPS}>
        {renderTableDesigner('create', createTableConnectionId, createTableDatabaseName, createTablePgDatabaseName || undefined, newTableName, setNewTableName, newTableComment, setNewTableComment, newTableColumns, createTableLoading)}
      </Modal>
      <ConnectionEditorModal
        form={form}
        open={connectionModalOpen}
        mode={connectionMode}
        databaseType={connectionModalDatabaseType}
        loading={connectionLoading}
        testingConnection={testingConnection}
        driversLoading={driversLoading}
        manualDriverOptions={manualDriverOptions}
        selectedManualDriver={selectedManualDriver}
        driverLabel={selectedManualDriver ? driverTypeLabel(selectedManualDriver.driver_type) : ''}
        onOk={() => void saveConnection()}
        onCancel={() => setConnectionModalOpen(false)}
        onTestConnection={() => void testConnection()}
        onSelectSqliteFile={() => void selectSqliteFile()}
        onOpenDriverManager={openDriverManager}
        onDriverChange={handleConnectionDriverChange}
      />
      <Modal title="备份" open={backupRestoreModalOpen} okText="选择路径并备份" cancelText="取消" confirmLoading={backupRestoreLoading} onOk={() => void runBackup()} onCancel={() => setBackupRestoreModalOpen(false)} maskClosable={false} {...FAST_MODAL_PROPS}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(backupRestoreConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>数据库：</Typography.Text>{backupRestorePgDatabase || backupRestoreDatabase || '默认'}</Typography.Text>
          <Alert type="info" message="备份会生成 SQL 脚本，包含建表语句和数据，可随时通过导入功能恢复。" showIcon />
        </Space>
      </Modal>
      <Modal title="导出" open={exportModalOpen} okText="选择路径并导出" cancelText="取消" confirmLoading={exportLoading} onOk={() => void runExport()} onCancel={() => setExportModalOpen(false)} maskClosable={false} {...FAST_MODAL_PROPS}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(exportConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>范围：</Typography.Text>{exportScope === 'table' ? `表 ${exportTable}` : exportScope === 'schema' ? `Schema ${exportPgDatabase}` : `数据库 ${exportDatabase || '默认'}`}</Typography.Text>
          <Form layout="vertical">
            <Form.Item label="导出格式">
              <Select value={exportFormat} onChange={(value) => setExportFormat(value)} options={getConnection(exportConnectionId)?.database_type === 'mongodb' || getConnection(exportConnectionId)?.database_type === 'redis' ? [{ label: 'JSON', value: 'json' }] : [{ label: 'SQL 脚本', value: 'sql' }, { label: 'CSV', value: 'csv' }]} />
            </Form.Item>
            {exportFormat === 'sql' && (
              <Form.Item label="导出内容">
                <Select value={exportContent} onChange={(value) => setExportContent(value)} options={[{ label: '结构 + 数据', value: 'schema_data' }, { label: '仅结构', value: 'schema' }, { label: '仅数据', value: 'data' }]} />
              </Form.Item>
            )}
          </Form>
          {exportFormat === 'csv' && exportScope !== 'table' && <Alert type="info" message="CSV 多表导出会创建目录，每张表一个 CSV 文件。" showIcon />}
          {exportFormat === 'json' && <Alert type="info" message="Redis / MongoDB 会导出为 JSON 文件，便于留档或迁移前查看。" showIcon />}
          {exportFormat === 'sql' && <Alert type="info" message="SQL 导出用于迁移或查看，可选仅结构、仅数据或结构加数据；完整恢复请使用备份。" showIcon />}
        </Space>
      </Modal>
      <Modal title="导入" open={importModalOpen} okText="导入" cancelText="取消" confirmLoading={importLoading} onOk={() => void runImport()} onCancel={() => setImportModalOpen(false)} okButtonProps={{ disabled: !importPath }} maskClosable={false} {...FAST_MODAL_PROPS}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(importConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>目标：</Typography.Text>{importTable ? `表 ${importTable}` : importPgDatabase ? `Schema ${importPgDatabase}` : `数据库 ${importDatabase || '默认'}`}</Typography.Text>
          <Form layout="vertical">
            <Form.Item label="导入文件（SQL/CSV，自动按扩展名识别）" required>
              <Input readOnly placeholder="请选择导入文件" value={importPath} addonAfter={<Button type="link" size="small" onClick={() => void selectImportFilePath()}>选择</Button>} />
            </Form.Item>
          </Form>
          <Alert type="warning" message="导入 SQL 会逐条执行文件中的语句；导入 CSV 会 INSERT 到目标表，请确保表结构与 CSV 表头一致。" showIcon />
        </Space>
      </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default App


