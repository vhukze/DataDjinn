import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  FilterOutlined,
  FunctionOutlined,
  GithubOutlined,
  MessageOutlined,
  EditOutlined,
  DeleteOutlined,
  BorderOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  EyeOutlined,
  MinusOutlined,
  MoonOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RightOutlined,
  SaveOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  RobotOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SunOutlined,
  TableOutlined,
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
  InputNumber,
  Layout,
  Menu,
  Modal,
  Popover,
  Progress,
  Select,
  Space,
  Splitter,
  Switch,
  Table,
  Tabs,
  Tag,
  theme as antdTheme,
  Tree,
  Typography,
  message
} from 'antd'
import type { MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { DataNode } from 'antd/es/tree'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from './context/ThemeContext'
import AIPanel from './components/AIPanel'
import SqlEditor from './components/SqlEditor'
import type { SqlCompletionColumn, SqlCompletionContext, SqlCompletionTable } from './components/SqlEditor'
import mysqlIcon from './assets/icons/mysql.png'
import postgresIcon from './assets/icons/postgres.png'
import sqliteIcon from './assets/icons/sqllite.png'
import dmIcon from './assets/icons/dm.svg'
import mongoIcon from './assets/icons/mongo.png'
import redisIcon from './assets/icons/redis.png'
import clickhouseIcon from './assets/icons/clickhouse.png'
import appIcon from '../../../resources/icon.svg'
import appLogoHorizontal from '../../../resources/logo-horizontal.svg'

type BackendStatus = {
  state: 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
  restartAttempt?: number
  maxRestartAttempts?: number
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
const readPersisted = (key: string): Record<string, string[]> => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

const filterPersistedValues = (persisted: string[], available: string[]): string[] => {
  const filtered = persisted.filter((v) => available.includes(v))
  return filtered.length > 0 ? filtered : available
}

const defaultSelectedDatabases = (connection: ConnectionInfo, available: string[], databases: DatabaseInfo[] = []): string[] => {
  if (connection.database_type === 'redis') {
    const nonEmpty = databases.filter((database) => (database.size_bytes ?? 0) > 0).map((database) => database.name)
    const configured = connection.database?.split('@')[0]
    if (configured && available.includes(configured) && !nonEmpty.includes(configured)) {
      nonEmpty.unshift(configured)
    }
    return nonEmpty.length > 0 ? nonEmpty : available.slice(0, 1)
  }

  const configured = connection.database?.split('@')[0]
  return configured && available.includes(configured) ? [configured] : available
}

const renderMarkdown = (content: string): { __html: string } => ({
  __html: DOMPurify.sanitize(marked.parse(content || '') as string)
})

const COMMON_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT',
  'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'TEXT',
  'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
  'BOOLEAN',
  'DATE', 'DATETIME', 'TIMESTAMP',
  'BLOB', 'BYTEA'
]

const INTEGER_TYPE_PREFIXES = ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'serial', 'bigserial', 'smallserial']
const NUMERIC_TYPE_PREFIXES = [...INTEGER_TYPE_PREFIXES, 'decimal', 'numeric', 'float', 'double', 'real']

const tableDesignerSupportsComments = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql'
const tableDesignerSupportsUnique = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'sqlite'
const tableDesignerSupportsAutoIncrement = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'sqlite'
const tableDesignerSupportsAutoIncrementStep = (databaseType?: DatabaseType): boolean => databaseType === 'postgresql'
const tableDesignerSupportsMinMax = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'sqlite'
const tableDesignerSupportsEdit = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'sqlite'
const isIntegerLikeType = (type: string): boolean => INTEGER_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))
const isNumericLikeType = (type: string): boolean => NUMERIC_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))

const PREVIEW_DEFAULT_LIMIT = 300
const QUERY_DEFAULT_LIMIT = 1000
const REDIS_DEFAULT_LIMIT = 500

type DatabaseType = 'sqlite' | 'mysql' | 'postgresql' | 'dm' | 'mongodb' | 'redis' | 'clickhouse'
type WorkspaceTabKind = 'preview' | 'query' | 'redis-browser'

type HealthStatus = {
  status: string
  app: string
  version: string
}

type ConnectionFormValues = {
  name: string
  database_type: DatabaseType
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
  sqlite_path?: string
  dm_driver_id?: string
  dm_driver_path?: string
}

type ConnectionInfo = {
  connection_id: string
  name: string
  database_type: DatabaseType
  database: string
  has_password: boolean
  is_open: boolean
  server_version?: string | null
}

type ConnectionTestResponse = {
  success: boolean
  message: string
}

type DriverDatabaseType = 'dm' | 'gaussdb'

type DriverType = 'jdbc' | 'python' | 'whl'

type DriverInfo = {
  id: string
  database_type: DriverDatabaseType
  driver_type: DriverType
  name: string
  source: 'auto' | 'manual'
  enabled: boolean
  path?: string | null
}

type DriverFormValues = {
  database_type: DriverDatabaseType
  driver_type: DriverType
  name: string
  path?: string
  enabled: boolean
}

type JavaRuntimeInfo = {
  home: string
  major?: number | null
  jvm_path: string
}

type JavaDetectResponse = {
  runtimes: JavaRuntimeInfo[]
  preferred?: string | null
  configured?: string | null
  enabled: boolean
}

type JavaRuntimeConfigResponse = {
  java_home?: string | null
  major?: number | null
  jvm_path?: string | null
  enabled: boolean
}

type AppInfo = {
  name: string
  version: string
  projectUrl: string
}

type SettingsSection = 'app' | 'drivers'

type UpdateMode = 'installer' | 'portable'

type UpdateInfo = {
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

type DatabaseInfo = {
  name: string
  size_bytes?: number | null
  size_display?: string | null
  storage_size_bytes?: number | null
  storage_size_display?: string | null
}

type TableInfo = {
  name: string
  size_bytes?: number | null
  size_display?: string | null
  storage_size_bytes?: number | null
  storage_size_display?: string | null
  row_count?: number | null
}

type DbObjectInfo = TableInfo & {
  type: DbObjectType
}

type ColumnInfo = {
  name: string
  type: string
  nullable: boolean
  primary_key: boolean
  comment?: string | null
  unique?: boolean
  auto_increment?: boolean
  auto_increment_step?: number | null
  minimum?: string | null
  maximum?: string | null
}

type ColumnsResponse = {
  columns: ColumnInfo[]
  table_comment?: string | null
}

type QueryResponse = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  limited: boolean
  total_count?: number | null
}

type ObjectDdlResponse = {
  ddl: string
}

type SqlFileRunResponse = {
  success_count: number
  failed_count: number
  errors: string[]
}

type EditableRow = Record<string, unknown> & {
  __rowKey: string
  __state?: 'inserted' | 'updated'
  __deleted?: boolean
  __original?: Record<string, unknown>
}

type RedisKeyEdit = {
  rowKey: string
  key: string
  type: string
  value: string
  ttl?: number | null
  state?: 'inserted' | 'updated'
  deleted?: boolean
  originalKey?: string
}

type ColumnFilterOption = {
  value: string
  label: string
  count: number
}

type RedisBrowserMode = 'database' | 'key'

type RedisExpandedValues = Record<string, true>

type WorkspaceTab = {
  key: string
  title: string
  kind: WorkspaceTabKind
  connectionId?: string
  databaseName?: string
  pgDatabaseName?: string
  tableName?: string
  sql: string
  limit?: number
  page?: number
  loading: boolean
  result?: QueryResponse
  editRows?: EditableRow[]
  selectedRowKeys?: React.Key[]
  selectedRowKeyMap?: Record<string, true>
  selectedColumns?: string[]
  selectedColumnMap?: Record<string, true>
  columnOrder?: string[]
  sortState?: { column: string; direction: 'ascend' | 'descend' }
  columnFilters?: Record<string, string[]>
  columnFilterOptions?: Record<string, ColumnFilterOption[]>
  draggingColumn?: string
  editingCell?: { rowKey: string; column: string }
  error?: string
  redisMode?: RedisBrowserMode
  redisExpandedValues?: RedisExpandedValues
  redisEdits?: Record<string, RedisKeyEdit>
  where?: string
}

type ColumnDef = {
  key: string
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  comment: string
  unique: boolean
  autoIncrement: boolean
  autoIncrementStep?: number | null
  minimum: string
  maximum: string
}

type TableDesignerMode = 'create' | 'edit'

type DbObjectType = 'table' | 'view' | 'trigger' | 'procedure' | 'function' | 'sequence' | 'index'
type TreeNodeKind = 'connection' | 'database' | 'pg-schema' | 'object-group' | 'table' | 'db-object' | 'column'

type DbObjectGroupMeta = {
  type: DbObjectType
  title: string
  icon: React.ReactNode
}

const DB_OBJECT_GROUPS: DbObjectGroupMeta[] = [
  { type: 'table', title: '表', icon: <TableOutlined /> },
  { type: 'view', title: '视图', icon: <EyeOutlined /> },
  { type: 'trigger', title: '触发器', icon: <ThunderboltOutlined /> },
  { type: 'procedure', title: '存储过程', icon: <FunctionOutlined /> },
  { type: 'function', title: '函数', icon: <FunctionOutlined /> },
  { type: 'sequence', title: '序列', icon: <DatabaseOutlined /> },
  { type: 'index', title: '索引', icon: <BranchesOutlined /> }
]

const DB_OBJECT_GROUP_BY_TYPE = Object.fromEntries(DB_OBJECT_GROUPS.map((group) => [group.type, group])) as Record<DbObjectType, DbObjectGroupMeta>

const objectGroupTitle = (type: DbObjectType, databaseType?: DatabaseType): string => {
  if (databaseType === 'redis' && type === 'table') {
    return 'Key'
  }
  if (databaseType === 'mongodb' && type === 'table') {
    return '集合'
  }
  return DB_OBJECT_GROUP_BY_TYPE[type].title
}

const DB_OBJECT_TYPES_BY_DATABASE: Record<DatabaseType, DbObjectType[]> = {
  sqlite: ['table', 'view', 'trigger', 'index'],
  mysql: ['table', 'view', 'trigger', 'procedure', 'function', 'index'],
  postgresql: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  dm: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  clickhouse: ['table', 'view'],
  mongodb: ['table'],
  redis: ['table']
}

type AIContextSource = {
  id: string
  type: 'database' | 'schema'
  connectionId: string
  connectionName: string
  dbType: DatabaseType
  database?: string
  schema?: string
  pgDatabase?: string
  sizeDisplay?: string | null
  sizeBytes?: number | null
  storageSizeDisplay?: string | null
  storageSizeBytes?: number | null
}

type AIActiveContext = {
  connectionId: string
  databaseName?: string
  pgDatabaseName?: string
}

type AIWorkspaceAction = {
  type: 'append_query_sql'
  sql: string
  title?: string
}

type DatabaseTreeNode = DataNode & {
  kind: TreeNodeKind
  connectionId?: string
  databaseName?: string
  pgDatabaseName?: string
  tableName?: string
  objectType?: DbObjectType
  sizeDisplay?: string | null
  sizeBytes?: number | null
  storageSizeDisplay?: string | null
  storageSizeBytes?: number | null
  rowCount?: number | null
  columnName?: string
  columnType?: string
  nullable?: boolean
  primaryKey?: boolean
  closed?: boolean
  childrenLoaded?: boolean
  children?: DatabaseTreeNode[]
}

const editableValue = (value: string): unknown => {
  if (value.trim() === '' || value.trim().toLowerCase() === 'null') {
    return null
  }

  return value
}

const isCellValueEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true
  }

  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true
  }

  return String(left) === String(right)
}

const buildEditableRows = (rows: Record<string, unknown>[]): EditableRow[] =>
  rows.map((row, index) => ({ ...row, __rowKey: `row:${index}`, __original: row }))

const buildRedisEdits = (rows: Record<string, unknown>[]): Record<string, RedisKeyEdit> =>
  Object.fromEntries(rows.map((row, index) => {
    const key = String(row.key ?? `key:${index}`)
    const rowKey = `${key}:${index}`
    const ttl = Number(row.ttl)
    return [rowKey, {
      rowKey,
      key,
      type: String(row.type ?? 'string'),
      value: displayValue(row.value),
      ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
      originalKey: key
    }]
  }))

const toColumnDef = (column: ColumnInfo): ColumnDef => ({
  key: column.name,
  name: column.name,
  type: column.type,
  nullable: column.nullable,
  primaryKey: column.primary_key,
  comment: column.comment ?? '',
  unique: column.unique ?? false,
  autoIncrement: column.auto_increment ?? false,
  autoIncrementStep: column.auto_increment_step ?? undefined,
  minimum: column.minimum ?? '',
  maximum: column.maximum ?? ''
})

const countRedisPendingChanges = (tab: WorkspaceTab): number =>
  Object.values(tab.redisEdits ?? {}).filter((edit) => edit.state || edit.deleted).length

const tableFilterValueKey = (value: unknown): string => value === null || value === undefined ? '__DATADJINN_NULL__' : String(value)

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value, null, 2)
}

const redisTtlDisplay = (ttl: unknown): string => {
  const seconds = Number(ttl)
  if (!Number.isFinite(seconds)) {
    return String(ttl)
  }
  if (seconds === -1) {
    return '不过期'
  }
  if (seconds === -2) {
    return '不存在'
  }
  if (seconds < 0) {
    return `${seconds} 秒`
  }
  if (seconds < 60) {
    return `${seconds} 秒后过期`
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒后过期`
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分后过期`
  }
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时后过期`
}

const tableFilterValueLabel = (value: string): string => value === '__DATADJINN_NULL__' ? 'NULL' : value

const sortFilterOptions = (options: ColumnFilterOption[]): ColumnFilterOption[] =>
  options.sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))

const buildColumnFilterOptions = (rows: EditableRow[], column: string): ColumnFilterOption[] => {
  const filterCounts = new Map<string, number>()
  for (const row of rows) {
    const valueKey = tableFilterValueKey(row[column])
    filterCounts.set(valueKey, (filterCounts.get(valueKey) ?? 0) + 1)
  }

  return sortFilterOptions([...filterCounts.entries()].map(([value, count]) => ({
    value,
    label: tableFilterValueLabel(value),
    count
  })))
}

function App(): React.JSX.Element {
  const [form] = Form.useForm<ConnectionFormValues>()
  const [driverForm] = Form.useForm<DriverFormValues>()
  const databaseType = Form.useWatch('database_type', form) ?? 'sqlite'
  const driverDatabaseType = Form.useWatch('database_type', driverForm) ?? 'dm'
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
  const [treeData, setTreeData] = useState<DatabaseTreeNode[]>([])
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [connectionTreeLoading, setConnectionTreeLoading] = useState<Record<string, string>>({})
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionMode, setConnectionMode] = useState<'create' | 'edit'>('create')
  const [editingConnectionInfoId, setEditingConnectionInfoId] = useState<string>()
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([])
  const [activeTabKey, setActiveTabKey] = useState<string>()
  const [selectedSqlByTab, setSelectedSqlByTab] = useState<Record<string, string>>({})
  const [resourcePanelSize, setResourcePanelSize] = useState(340)
  const [aiPanelSize, setAiPanelSize] = useState(360)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
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
  const [driverManagerOpen, setDriverManagerOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('app')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [javaRestartRequired, setJavaRestartRequired] = useState(false)
  const [updateModalOpen, setUpdateModalOpen] = useState(false)
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
  const allDmDrivers = drivers.filter((driver) => driver.database_type === 'dm')
  const dmDrivers = allDmDrivers.filter((driver) => driver.enabled)
  const selectedDmDriverId = Form.useWatch('dm_driver_id', form)
  const selectedDmDriver = allDmDrivers.find((driver) => driver.id === selectedDmDriverId)
  const [driversLoading, setDriversLoading] = useState(false)
  const [driverSaving, setDriverSaving] = useState(false)
  const [selectedDatabases, setSelectedDatabases] = useState<Record<string, string[]>>(() => readPersisted(STORAGE_DB))
  const [selectedSchemas, setSelectedSchemas] = useState<Record<string, string[]>>(() => readPersisted(STORAGE_SCHEMA))
  const selectedDatabasesRef = useRef(selectedDatabases)
  const selectedSchemasRef = useRef(selectedSchemas)

  useEffect(() => {
    selectedDatabasesRef.current = selectedDatabases
  }, [selectedDatabases])

  useEffect(() => {
    selectedSchemasRef.current = selectedSchemas
  }, [selectedSchemas])
  const [allDatabases, setAllDatabases] = useState<Record<string, string[]>>({})
  const [allSchemas, setAllSchemas] = useState<Record<string, string[]>>({})
  const [activeSelector, setActiveSelector] = useState<string | null>(null)
  const [draftSelectedDatabases, setDraftSelectedDatabases] = useState<Record<string, string[]>>({})
  const [draftSelectedSchemas, setDraftSelectedSchemas] = useState<Record<string, string[]>>({})
  const [completionTables, setCompletionTables] = useState<Record<string, string[]>>({})
  const [tableBodyHeights, setTableBodyHeights] = useState<Record<string, number>>({})
  const [ddlModalOpen, setDdlModalOpen] = useState(false)
  const [ddlModalTitle, setDdlModalTitle] = useState('')
  const [ddlContent, setDdlContent] = useState('')
  const [ddlLoading, setDdlLoading] = useState(false)
  const tableBodyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rowDragAnchorRefs = useRef<Record<string, string | undefined>>({})
  const rowSelectionDraftRefs = useRef<Record<string, React.Key[] | undefined>>({})
  const treeLoadingKeysRef = useRef<Set<React.Key>>(new Set())

  const { theme, toggleTheme } = useTheme()

  const refreshUpdateSettings = async (): Promise<void> => {
    const settings = await window.api.getUpdateSettings()
    setUpdateSettings(settings)
  }

  const handleUpdateAvailable = (info: UpdateInfo, open = true): void => {
    setUpdateInfo(info)
    setUpdateProgress(null)
    if (open && info.latestVersion !== updateSettings?.skippedUpdateVersion) {
      setUpdateModalOpen(true)
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
    setUpdateModalOpen(false)
  }

  const normalizeRequestError = (error: unknown): Error => {
    const message = error instanceof Error ? error.message : String(error || '操作失败')
    if (message.includes('Timeout reading from socket')) {
      return new Error('请求后端超时，请检查数据库主机和端口是否正确、服务是否已启动，或稍后重试')
    }
    return error instanceof Error ? error : new Error(message)
  }

  const requestJson = async <T,>(path: string, options?: RequestInit): Promise<T> => {
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
  }

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
      schemaName: connection?.database_type === 'postgresql' ? tab.databaseName : undefined,
      databases: databaseNames,
      schemas: schemaKey ? allSchemas[schemaKey] ?? [] : [],
      tables,
      columns
    }
  }

  const renderConnectionTitle = (connection: ConnectionInfo): React.ReactNode => {
    const loadingText = connectionTreeLoading[connection.connection_id]
    const loading = Boolean(loadingText)

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
          ...(connection.database_type === 'redis' ? [] : [{
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
      <Flex className="connection-tree-title" align="center">
        <div className="connection-tree-main">
          <Typography.Text className="connection-tree-name" ellipsis title={connection.name}>
            {connection.name}
          </Typography.Text>
          <Typography.Text type="secondary" className="connection-tree-address" ellipsis title={connection.database}>
            {connection.database}
          </Typography.Text>
        </div>
        <Space className="connection-tree-actions" size={2}>
          {renderDatabaseSelector(connection.connection_id)}
          <Button
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
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(event) => {
              event.stopPropagation()
              void openEditConnectionModal(connection)
            }}
          />
          <Button
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
      </Flex>
      </>
    )
  }

  const buildObjectGroupNodes = (connectionId: string, databaseName?: string, pgDatabaseName?: string, databaseType?: DatabaseType): DatabaseTreeNode[] => {
    const connection = getConnection(connectionId)
    const objectTypes = DB_OBJECT_TYPES_BY_DATABASE[databaseType ?? connection?.database_type ?? 'sqlite']

    return DB_OBJECT_GROUPS.filter((group) => objectTypes.includes(group.type)).map((group) => ({
      key: `object-group:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${group.type}`,
      title: objectGroupTitle(group.type, databaseType ?? connection?.database_type),
      icon: group.icon,
      kind: 'object-group',
      connectionId,
      databaseName,
      pgDatabaseName,
      objectType: group.type,
      childrenLoaded: false,
      isLeaf: false
    }))
  }

  const buildDatabaseNode = (connection: ConnectionInfo, database: DatabaseInfo): DatabaseTreeNode => ({
    key: `database:${connection.connection_id}:${database.name}`,
    title: database.name,
    icon: <DatabaseOutlined />,
    kind: 'database',
    connectionId: connection.connection_id,
    databaseName: database.name,
    sizeDisplay: database.size_display,
    sizeBytes: database.size_bytes,
    storageSizeDisplay: database.storage_size_display,
    storageSizeBytes: database.storage_size_bytes,
    childrenLoaded: connection.database_type === 'redis',
    isLeaf: connection.database_type === 'redis'
  })

  const buildPgSchemaNode = (connection: ConnectionInfo, pgDatabaseName: string, schema: DatabaseInfo): DatabaseTreeNode => ({
    key: `pg-schema:${connection.connection_id}:${pgDatabaseName}:${schema.name}`,
    title: schema.name,
    icon: <BranchesOutlined />,
    kind: 'pg-schema',
    connectionId: connection.connection_id,
    databaseName: schema.name,
    pgDatabaseName,
    sizeDisplay: schema.size_display,
    sizeBytes: schema.size_bytes,
    storageSizeDisplay: schema.storage_size_display,
    storageSizeBytes: schema.storage_size_bytes,
    childrenLoaded: false,
    isLeaf: false
  })

  const buildConnectionNode = (connection: ConnectionInfo): DatabaseTreeNode => {
    const children = connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'mongodb' || connection.database_type === 'redis' || connection.database_type === 'clickhouse'
      ? undefined
      : buildObjectGroupNodes(connection.connection_id, undefined, undefined, connection.database_type)

    return {
      key: `connection:${connection.connection_id}`,
      title: connection.name,
      icon:
        connection.database_type === 'postgresql' ? (
          <img src={postgresIcon} alt="PG" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'mongodb' ? (
          <img src={mongoIcon} alt="MongoDB" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'redis' ? (
          <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'clickhouse' ? (
          <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'mysql' ? (
          <img src={mysqlIcon} alt="MySQL" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'dm' ? (
          <img src={dmIcon} alt="DM" style={{ width: 16, height: 16 }} />
        ) : (
          <img src={sqliteIcon} alt="SQLite" style={{ width: 16, height: 16 }} />
        ),
      kind: 'connection',
      connectionId: connection.connection_id,
      children,
      className: connection.is_open ? undefined : 'tree-node-closed',
      closed: !connection.is_open,
      childrenLoaded: Boolean(children),
      isLeaf: !connection.is_open
    }
  }

  const refreshTree = (nextConnections: ConnectionInfo[]): void => {
    setTreeData(nextConnections.map(buildConnectionNode))
  }

  const refreshConnectionNode = (connectionId: string, selectedDatabaseOverride?: string[]): void => {
    const connection = getConnection(connectionId)

    if (!connection) {
      return
    }

    void (async () => {
      setConnectionTreeLoadingText(connectionId, '正在刷新连接...')
      try {
        const connKey = `connection:${connectionId}`
        const snapshot = expandedKeys.map(String)

        if (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'mongodb' || connection.database_type === 'redis' || connection.database_type === 'clickhouse') {
          const databaseNodes = await preloadConnectionTree(connection, selectedDatabaseOverride)
          const selectedNames = new Set(databaseNodes.map((node) => node.databaseName).filter(Boolean))
          const stillExpanded = snapshot.filter((k) => {
            if (k === connKey) return false
            if (k.startsWith(`database:${connectionId}:`)) {
              if (connection.database_type === 'redis') {
                return false
              }
              const dbName = k.slice(`database:${connectionId}:`.length).split(':')[0]
              return selectedNames.has(dbName)
            }
            return k.startsWith(`pg-schema:${connectionId}:`) || k.startsWith(`object-group:${connectionId}:`) || k.startsWith(`table:${connectionId}:`)
          })
          startTransition(() => {
            setExpandedKeys(Array.from(new Set([connKey, ...stillExpanded])))
          })
        } else {
          setTreeData((current) =>
            current.map((node) => {
              if (node.key === connKey) {
                const nextChildren = buildConnectionNode(connection).children
                return { ...node, children: nextChildren, childrenLoaded: Boolean(nextChildren) }
              }

              return node
            })
          )
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : '刷新连接失败')
      } finally {
        setConnectionTreeLoadingText(connectionId)
      }
    })()
  }

  const refreshDatabaseNode = (connectionId: string, databaseName: string, selectedSchemaOverride?: string[]): void => {
    const connection = getConnection(connectionId)
    if (!connection) {
      return
    }

    void (async () => {
      setConnectionTreeLoadingText(connectionId, '正在加载表列表...')
      try {
        const children = await preloadDatabaseChildren(connection, databaseName, selectedSchemaOverride)
        setTreeData((current) => updateTreeNode(current, `database:${connectionId}:${databaseName}`, children))
      } catch (err) {
        showError(err instanceof Error ? err.message : '加载表列表失败')
      } finally {
        setConnectionTreeLoadingText(connectionId)
      }
    })()
  }

  const replaceConnectionNode = (nodes: DatabaseTreeNode[], connection: ConnectionInfo, preserveChildren?: boolean): DatabaseTreeNode[] =>
    nodes.map((node) => {
      if (node.key !== `connection:${connection.connection_id}`) {
        return node
      }

      const nextNode = buildConnectionNode(connection)
      return preserveChildren && connection.is_open ? { ...nextNode, children: node.children, childrenLoaded: node.childrenLoaded } : nextNode
    })

  const updateTreeNode = (nodes: DatabaseTreeNode[], key: React.Key, children: DatabaseTreeNode[]): DatabaseTreeNode[] => {
    const visit = (currentNodes: DatabaseTreeNode[]): [DatabaseTreeNode[], boolean] => {
      let changed = false

      const nextNodes = currentNodes.map((node) => {
        if (node.key === key) {
          changed = true
          return { ...node, children, childrenLoaded: true }
        }

        if (!node.children?.length) {
          return node
        }

        const [nextChildren, childChanged] = visit(node.children)
        if (!childChanged) {
          return node
        }

        changed = true
        return { ...node, children: nextChildren }
      })

      return [changed ? nextNodes : currentNodes, changed]
    }

    return visit(nodes)[0]
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

  const updateWorkspaceTab = (key: string, patch: Partial<WorkspaceTab>): void => {
    setWorkspaceTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)))
  }

  useEffect(() => {
    if (!activeTabKey) {
      return
    }

    const element = tableBodyRefs.current[activeTabKey]
    if (!element) {
      return
    }

    const updateTableBodyHeight = (): void => {
      setTableBodyHeights((current) => ({ ...current, [activeTabKey]: Math.max(160, element.clientHeight - 39) }))
    }

    updateTableBodyHeight()
    const observer = new ResizeObserver(updateTableBodyHeight)
    observer.observe(element)

    return () => observer.disconnect()
  }, [activeTabKey, workspaceTabs.length])

  useEffect(() => {
    if (!treeContextMenu) {
      return
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setTreeContextMenu(null)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [treeContextMenu])

  const closeWorkspaceTab = (key: string): void => {
    setWorkspaceTabs((current) => {
      const index = current.findIndex((tab) => tab.key === key)
      const nextTabs = current.filter((tab) => tab.key !== key)

      if (activeTabKey === key) {
        setActiveTabKey(nextTabs[index - 1]?.key ?? nextTabs[index]?.key)
      }

      return nextTabs
    })
  }

  const connectionMap = useMemo(() => new Map(connections.map((connection) => [connection.connection_id, connection])), [connections])
  const getConnection = useCallback((connectionId?: string): ConnectionInfo | undefined => (
    connectionId ? connectionMap.get(connectionId) : undefined
  ), [connectionMap])
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
          const databaseName = connection?.database_type === 'postgresql' ? node.pgDatabaseName : node.databaseName
          const schemaName = connection?.database_type === 'postgresql' ? node.databaseName : undefined
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

    walk(treeData)
    return index
  }, [connectionMap, treeData])
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

  const withPgDatabase = (path: string, databaseName?: string, pgDatabaseName?: string): string => {
    const params: string[] = []

    if (databaseName) {
      params.push(`database=${encodeURIComponent(databaseName)}`)
    }

    if (pgDatabaseName) {
      params.push(`pg_database=${encodeURIComponent(pgDatabaseName)}`)
    }

    return params.length > 0 ? `${path}?${params.join('&')}` : path
  }

  const withPageQuery = (path: string, limit: number, page = 1): string => {
    const offset = Math.max(0, page - 1) * limit
    return `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`
  }

  const withWhereQuery = (path: string, where?: string): string => {
    const condition = where?.trim()
    return condition ? `${path}${path.includes('?') ? '&' : '?'}where=${encodeURIComponent(condition)}` : path
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

    if (connection?.database_type === 'postgresql') {
      const quotedTable = `"${tableName.replaceAll('"', '""')}"`
      return databaseName ? `"${databaseName.replaceAll('"', '""')}".${quotedTable}` : quotedTable
    }

    return `"${tableName.replaceAll('"', '""')}"`
  }

  const copyTableName = async (tableName: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(tableName)
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
      pgDatabase: node.kind === 'pg-schema' ? node.pgDatabaseName : connection.database_type === 'postgresql' ? node.databaseName : undefined,
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

  const removeAIContextSource = (sourceId: string): void => {
    setAiContextSources((current) => current.filter((source) => source.id !== sourceId))
  }

  const isDatabaseScopedType = (databaseType?: DatabaseType): databaseType is 'mysql' | 'mongodb' | 'redis' | 'clickhouse' =>
    databaseType === 'mysql' || databaseType === 'mongodb' || databaseType === 'redis' || databaseType === 'clickhouse'

  const activateAIContextFromNode = (node: DatabaseTreeNode): void => {
    if (!node.connectionId) {
      return
    }

    const connection = getConnection(node.connectionId)
    if (!connection?.is_open) {
      return
    }

    if (node.kind === 'connection') {
      setAiActiveContext({
        connectionId: node.connectionId,
        databaseName: isDatabaseScopedType(connection.database_type) ? getDefaultDatabaseName(connection) : undefined,
        pgDatabaseName: connection.database_type === 'postgresql' ? getDefaultPgDatabase(connection) : undefined
      })
      return
    }

    if (node.kind === 'database') {
      const schemaKey = `${node.connectionId}:${node.databaseName}`
      const schemas = selectedSchemas[schemaKey] ?? allSchemas[schemaKey] ?? []
      setAiActiveContext({
        connectionId: node.connectionId,
        databaseName: connection.database_type === 'postgresql' ? getDefaultPgSchema(schemas) : node.databaseName,
        pgDatabaseName: connection.database_type === 'postgresql' ? node.databaseName : undefined
      })
      return
    }

    if (node.kind === 'pg-schema') {
      setAiActiveContext({
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        pgDatabaseName: node.pgDatabaseName
      })
      return
    }

    if ((node.kind === 'table' || node.kind === 'db-object' || node.kind === 'object-group') && (node.databaseName || node.pgDatabaseName)) {
      setAiActiveContext({
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        pgDatabaseName: node.pgDatabaseName
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
    const dbList = allDatabases[connectionId] ?? []
    const selected = selectedDatabases[connectionId] ?? dbList
    const draftSelected = draftSelectedDatabases[connectionId] ?? selected
    const popKey = `db:${connectionId}`

    if (dbList.length === 0) {
      return null
    }

    return (
      <Popover
        trigger="click"
        open={activeSelector === popKey}
        onOpenChange={(open) => {
          if (open) {
            setDraftSelectedDatabases((current) => ({
              ...current,
              [connectionId]: selected
            }))
            setActiveSelector(popKey)
          } else {
            const nextSelected = draftSelectedDatabases[connectionId] ?? selected
            setSelectedDatabases((current) => {
              const next = { ...current, [connectionId]: nextSelected }
              selectedDatabasesRef.current = next
              return next
            })
            setActiveSelector(null)
            refreshConnectionNode(connectionId, nextSelected)
          }
        }}
        content={
          <div style={{ maxHeight: 260, overflowY: 'auto', minWidth: 180 }}>
            <Flex vertical gap={6}>
              <Button size="small" type="link" onClick={(event) => {
                event.stopPropagation()
                setDraftSelectedDatabases((current) => ({
                  ...current,
                  [connectionId]: draftSelected.length === dbList.length ? [dbList[0]] : dbList
                }))
              }}>
                {draftSelected.length === dbList.length ? '取消全选' : '全选'}
              </Button>
              <Checkbox.Group
                value={draftSelected}
                onChange={(values) => {
                  if (values.length === 0) {
                    return
                  }

                  setDraftSelectedDatabases((current) => ({
                    ...current,
                    [connectionId]: values as string[]
                  }))
                }}
              >
                <Flex vertical gap={4}>
                  {dbList.map((dbName) => (
                    <Checkbox key={dbName} value={dbName}>
                      {dbName}
                    </Checkbox>
                  ))}
                </Flex>
              </Checkbox.Group>
            </Flex>
          </div>
        }
      >
        <Tag className="selector-badge" onClick={(event) => event.stopPropagation()}>
          {selected.length}/{dbList.length}
        </Tag>
      </Popover>
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

  const getDatabaseContextMenu = (node: DatabaseTreeNode): MenuProps['items'] => {
    if ((!node.connectionId || !node.databaseName) || (node.kind !== 'database' && node.kind !== 'pg-schema')) {
      return []
    }

    const connection = getConnection(node.connectionId)
    const isPgDb = node.kind === 'database' && connection?.database_type === 'postgresql'

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
      ...(!isPgDb && (connection?.database_type === 'mysql' || connection?.database_type === 'postgresql')
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
    const isPgDb = node.kind === 'database' && connection?.database_type === 'postgresql'

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
              type: connection?.database_type === 'postgresql' ? 'INTEGER' : connection?.database_type === 'clickhouse' ? 'UInt64' : 'INT',
              nullable: false,
              primaryKey: connection?.database_type !== 'clickhouse',
              comment: '',
              unique: false,
              autoIncrement: connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'sqlite',
              autoIncrementStep: connection?.database_type === 'postgresql' ? 1 : undefined,
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
    return [
      ...(connection.is_open
        ? [{ key: 'close', label: '关闭连接', icon: <CloseCircleOutlined />, disabled: loading }]
        : [{ key: 'open', label: '打开连接', icon: <PlayCircleOutlined />, disabled: loading }]),
      ...(connection.database_type === 'redis' ? [] : [{
        key: 'new-database',
        label: connection.database_type === 'sqlite' ? '新增 SQLite 数据库文件' : '新建库',
        icon: <PlusOutlined />
      }]),
      ...(connection.database_type !== 'mongodb' && connection.database_type !== 'redis'
        ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }]
        : [])
    ]
  }

  const getTreeContextMenuItems = (node: DatabaseTreeNode): MenuProps['items'] => {
    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection ? getConnectionContextMenu(connection) : []
    }
    if (node.kind === 'database' || node.kind === 'pg-schema') {
      return getDatabaseContextMenu(node)
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
    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      if (connection) {
        handleConnectionContextMenuClick(key, connection)
      }
    } else if (node.kind === 'database' || node.kind === 'pg-schema') {
      handleDatabaseContextMenuClick(key, node)
    } else if (node.kind === 'table' || node.kind === 'db-object') {
      handleObjectContextMenuClick(key, node)
    }

    setTreeContextMenu(null)
  }

  const renderTreeTitle = (node: DatabaseTreeNode): React.ReactNode => {
    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection ? renderConnectionTitle(connection) : (node.title as React.ReactNode)
    }

    if ((node.kind === 'database' || node.kind === 'pg-schema') && node.connectionId && node.databaseName) {
      const connectionId = node.connectionId
      const databaseName = node.databaseName
      const isPgDb = node.kind === 'database' && getConnection(connectionId)?.database_type === 'postgresql'
      const selKey = `${connectionId}:${databaseName}`
      const schemas = allSchemas[selKey] ?? []
      const selectedSchemaList = selectedSchemas[selKey] ?? schemas
      const draftSelectedSchemaList = draftSelectedSchemas[selKey] ?? selectedSchemaList
      const schemaCount = schemas.length
      const selectedCount = selectedSchemaList.length

      return (
        <Flex align="center" justify="space-between" className="tree-title-row">
          <div className="tree-title-with-size">
            <span className="table-tree-title">{node.title as React.ReactNode}</span>
            <span className="tree-node-actions">
              {focusedTreeNode?.key === node.key && renderAIContextButton(node)}
              {node.sizeDisplay && <span className="tree-size-badge" title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}>{node.sizeDisplay}</span>}
            </span>
          </div>
          {isPgDb && schemaCount > 0 && (
            <Popover
              trigger="click"
              open={activeSelector === selKey}
              onOpenChange={(open) => {
                if (open) {
                  setDraftSelectedSchemas((current) => ({
                    ...current,
                    [selKey]: selectedSchemaList
                  }))
                  setActiveSelector(selKey)
                } else {
                  const nextSelected = draftSelectedSchemas[selKey] ?? selectedSchemaList
                  setSelectedSchemas((current) => {
                    const next = { ...current, [selKey]: nextSelected }
                    selectedSchemasRef.current = next
                    return next
                  })
                  setActiveSelector(null)
                  refreshDatabaseNode(connectionId, databaseName, nextSelected)
                }
              }}
              content={
                <div style={{ maxHeight: 260, overflowY: 'auto', minWidth: 180 }}>
                  <Flex vertical gap={6}>
                    <Button size="small" type="link" onClick={(event) => {
                      event.stopPropagation()
                      setDraftSelectedSchemas((current) => ({
                        ...current,
                        [selKey]: draftSelectedSchemaList.length === schemas.length ? [schemas[0]] : schemas
                      }))
                    }}>
                      {draftSelectedSchemaList.length === schemas.length ? '取消全选' : '全选'}
                    </Button>
                    <Checkbox.Group
                      value={draftSelectedSchemaList}
                      onChange={(values) => {
                        if (values.length === 0) {
                          return
                        }

                        setDraftSelectedSchemas((current) => ({
                          ...current,
                          [selKey]: values as string[]
                        }))
                      }}
                    >
                      <Flex vertical gap={4}>
                        {schemas.map((schemaName) => (
                          <Checkbox key={schemaName} value={schemaName}>
                            {schemaName}
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
                onClick={(event) => event.stopPropagation()}
              >
                {selectedCount}/{schemaCount}
              </Tag>
            </Popover>
          )}
        </Flex>
      )
    }

    if ((node.kind !== 'table' && node.kind !== 'db-object') || !node.connectionId || !node.tableName) {
      return node.title as React.ReactNode
    }

    return (
      <Flex align="center" justify="space-between" className="tree-title-with-size">
        <span className="table-tree-title">
          {node.title as React.ReactNode}
        </span>
        <span className="tree-node-actions">
          {node.sizeDisplay && <span className="tree-size-badge" title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}>{node.sizeDisplay}</span>}
        </span>
      </Flex>
    )
  }

  const countPendingChanges = (tab: WorkspaceTab): number => {
    if (tab.kind === 'redis-browser') {
      return countRedisPendingChanges(tab)
    }

    if (tab.kind !== 'preview') {
      return 0
    }

    return tab.editRows?.filter((row) => row.__state || row.__deleted).length ?? 0
  }

  const renderResultStatus = (tab: WorkspaceTab): React.ReactNode => {
    const connection = getConnection(tab.connectionId)
    const totalRows = tab.result?.total_count ?? tab.result?.row_count
    const rowText = tab.result
      ? tab.kind === 'preview'
        ? `总行数 ${totalRows ?? 0} 行`
        : tab.kind === 'redis-browser'
          ? `${tab.result.row_count} 项`
          : `${tab.result.row_count} 行`
      : '暂无结果'
    const pendingChanges = countPendingChanges(tab)

    return (
      <Flex align="center" justify="space-between" gap={8} className="result-status">
        <Space wrap>
          <Tag color={tab.kind === 'query' ? 'blue' : tab.kind === 'redis-browser' ? 'red' : 'green'}>{tab.kind === 'query' ? 'SQL 查询' : tab.kind === 'redis-browser' ? 'Redis 浏览' : '表预览'}</Tag>
          {connection && <Tag>{connection.name}</Tag>}
          {tab.kind === 'redis-browser' && tab.databaseName && <Tag>{tab.databaseName}</Tag>}
          {tab.tableName && tab.kind !== 'redis-browser' && <Tag>{tab.tableName}</Tag>}
          <Typography.Text type="secondary">{rowText}</Typography.Text>
          {tab.result?.limited && <Tag color="warning">已截断</Tag>}
          {pendingChanges > 0 && <Tag color="orange">{pendingChanges} 项未提交</Tag>}
        </Space>
      </Flex>
    )
  }

  const renderEditableCell = (tab: WorkspaceTab, row: EditableRow, column: string, value: unknown): React.ReactNode => {
    const isEditing = tab.editingCell?.rowKey === row.__rowKey && tab.editingCell.column === column

    if (isEditing) {
      return (
        <Input
          autoFocus
          size="small"
          defaultValue={value === null || value === undefined ? '' : String(value)}
          onPressEnter={(event) => updatePreviewCell(tab.key, row.__rowKey, column, editableValue(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              updateWorkspaceTab(tab.key, { editingCell: undefined })
            }
          }}
          onBlur={(event) => updatePreviewCell(tab.key, row.__rowKey, column, editableValue(event.currentTarget.value))}
        />
      )
    }

    return (
      <span className="editable-cell" onDoubleClick={() => updateWorkspaceTab(tab.key, { editingCell: { rowKey: row.__rowKey, column } })}>
        {value === null || value === undefined ? <Typography.Text type="secondary">NULL</Typography.Text> : String(value)}
      </span>
    )
  }

  const renderWhereInput = (tab: WorkspaceTab): React.ReactNode => {
    if (tab.kind !== 'preview' || !tab.connectionId || !tab.tableName) {
      return null
    }

    const fieldOptions = (tab.result?.columns ?? [])
      .filter((column) => column !== '__rowKey')
      .map((column) => ({ value: column, label: column }))

    return (
      <AutoComplete
        className="preview-where-input"
        options={fieldOptions}
        value={tab.where ?? ''}
        filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
        onChange={(value) => updateWorkspaceTab(tab.key, { where: value })}
        onSelect={(value) => updateWorkspaceTab(tab.key, { where: value })}
      >
        <Input
          size="small"
          allowClear
          addonBefore="WHERE"
          placeholder="输入过滤条件，例如：id = 2，回车查询"
          onPressEnter={(event) => void previewTable(tab.connectionId!, tab.tableName!, tab.databaseName, tab.pgDatabaseName, tab.limit, 1, event.currentTarget.value)}
        />
      </AutoComplete>
    )
  }

  const renderTableToolbar = (tab: WorkspaceTab): React.ReactNode => {
    const connection = getConnection(tab.connectionId)
    const showPreviewActions = tab.kind === 'preview' && tab.connectionId && tab.tableName && connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
    const showRedisRefresh = tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName

    return (
      <Flex align="center" justify="space-between" gap={8} className="table-data-toolbar">
        <Space size={4} className="table-data-actions">
          {showRedisRefresh && (
            <>
              <Button size="small" icon={<ReloadOutlined />} title="刷新" aria-label="刷新" loading={tab.loading} onClick={() => void previewRedisDatabase(tab.connectionId!, tab.databaseName!, tab.limit, tab.page)} />
              <Button size="small" icon={<PlusOutlined />} title="新增一行" aria-label="新增一行" onClick={() => addRedisRow(tab)} />
              <Button type="primary" size="small" icon={<SaveOutlined />} title="提交" aria-label="提交" disabled={countRedisPendingChanges(tab) === 0} loading={tab.loading} onClick={() => void submitRedisChanges(tab)} />
            </>
          )}
          {showPreviewActions && (
            <>
              <Button size="small" icon={<ReloadOutlined />} title="刷新" aria-label="刷新" loading={tab.loading} onClick={() => void previewTable(tab.connectionId!, tab.tableName!, tab.databaseName, tab.pgDatabaseName, tab.limit, tab.page, tab.where)} />
              <Button size="small" icon={<PlusOutlined />} title="新增行" aria-label="新增行" onClick={() => addPreviewRow(tab)} />
              <Button size="small" icon={<MinusOutlined />} title="删除选中行" aria-label="删除选中行" disabled={!tab.selectedRowKeys?.length} onClick={() => markSelectedRowsDeleted(tab)} />
              <Button type="primary" size="small" icon={<SaveOutlined />} title="提交" aria-label="提交" disabled={countPendingChanges(tab) === 0} loading={tab.loading} onClick={() => void submitPreviewChanges(tab)} />
            </>
          )}
        </Space>
        {renderWhereInput(tab)}
        {renderResultPager(tab)}
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

  const renderResultPager = (tab: WorkspaceTab): React.ReactNode => {
    const limit = tab.limit ?? (tab.kind === 'preview' ? PREVIEW_DEFAULT_LIMIT : QUERY_DEFAULT_LIMIT)
    const page = tab.page ?? 1
    const totalPages = tab.result?.total_count ? Math.max(1, Math.ceil(tab.result.total_count / limit)) : undefined
    const hasNext = totalPages ? page < totalPages : !!tab.result?.limited
    const jumpToPage = (rawValue: string): void => {
      const parsed = Number(rawValue.trim())
      if (!Number.isFinite(parsed) || parsed < 1) {
        return
      }
      const nextPage = totalPages ? Math.min(Math.floor(parsed), totalPages) : Math.floor(parsed)
      if (nextPage !== page) {
        void changeTabPage(tab, nextPage)
      }
    }

    return (
      <Space size={4} className="result-pager">
        <Button size="small" icon={<DoubleLeftOutlined />} title="棣栭〉" aria-label="棣栭〉" disabled={tab.loading || page <= 1} onClick={() => void changeTabPage(tab, 1)} />
        <Button size="small" icon={<LeftOutlined />} title="上一页" aria-label="上一页" disabled={tab.loading || page <= 1} onClick={() => void changeTabPage(tab, page - 1)} />
        <Input
          size="small"
          key={`${tab.key}:${page}:${totalPages ?? 'open'}`}
          className="result-page-input"
          defaultValue={String(page)}
          inputMode="numeric"
          aria-label="椤电爜"
          onPressEnter={(event) => {
            jumpToPage(event.currentTarget.value)
            event.currentTarget.blur()
          }}
          onBlur={(event) => {
            event.currentTarget.value = String(page)
          }}
        />
        <Button size="small" icon={<RightOutlined />} title="下一页" aria-label="下一页" disabled={tab.loading || !hasNext} onClick={() => void changeTabPage(tab, page + 1)} />
        <Button size="small" icon={<DoubleRightOutlined />} title="末页" aria-label="末页" disabled={tab.loading || !totalPages || page >= totalPages} onClick={() => totalPages && void changeTabPage(tab, totalPages)} />
        <Select
          size="small"
          value={limit}
          className="result-limit-select"
          options={[300, 500, 1000].map((value) => ({ label: `${value} 条/页`, value }))}
          onChange={(value) => void changeTabLimit(tab, value)}
        />
      </Space>
    )
  }

  const renderRedisBrowser = (tab: WorkspaceTab): React.ReactNode => {
    const rows = tab.result?.rows ?? []
    const edits = tab.redisEdits ?? {}
    return (
      <div className="result-table-shell">
        {renderResultStatus(tab)}
        {renderTableToolbar(tab)}
        {tab.error && <Alert message="加载失败" description={tab.error} type="error" showIcon />}
        {tab.result?.limited && <Alert message="还有更多 Key，可以点击下一页继续查看" type="warning" showIcon />}
        <div className="redis-browser-list">
          {tab.loading && <Typography.Text type="secondary">加载中...</Typography.Text>}
          {!tab.loading && Object.values(edits).filter((edit) => !edit.deleted).length === 0 && <Typography.Text type="secondary">当前 DB 暂无 Key</Typography.Text>}
          {Object.values(edits).map((edit, index) => {
            if (edit.deleted) {
              return null
            }
            const sourceRow = rows[index] ?? {}
            const rowKey = edit.rowKey
            const expanded = Boolean(tab.redisExpandedValues?.[rowKey])
            return (
              <div className={`redis-key-card${edit.state ? ' redis-key-card-dirty' : ''}`} key={rowKey}>
                <button className="redis-expand-button" type="button" onClick={() => toggleRedisValue(tab.key, rowKey)} aria-label={expanded ? '收起值' : '展开值'}>
                  {expanded ? '▼' : '▶'}
                </button>
                <div className="redis-key-main">
                  <Flex align="center" gap={8} wrap="wrap">
                    <Input size="small" className="redis-key-input" value={edit.key} placeholder="Key" onChange={(event) => updateRedisEdit(tab.key, rowKey, { key: event.target.value })} />
                    <Select size="small" className="redis-type-select" value={edit.type} options={['string', 'hash', 'list', 'set', 'zset'].map((value) => ({ label: value, value }))} onChange={(value) => updateRedisEdit(tab.key, rowKey, { type: value })} />
                    <InputNumber size="small" className="redis-ttl-input" min={1} placeholder="TTL 秒" value={edit.ttl ?? null} onChange={(value) => updateRedisEdit(tab.key, rowKey, { ttl: typeof value === 'number' ? value : null })} />
                    {edit.state && <Tag color="orange">未提交</Tag>}
                    {!edit.state && sourceRow.ttl !== undefined && <Tag>{redisTtlDisplay(sourceRow.ttl)}</Tag>}
                    {sourceRow.length !== undefined && <Tag>长度 {String(sourceRow.length)}</Tag>}
                    {sourceRow.memory !== undefined && <Tag>内存 {String(sourceRow.memory)} B</Tag>}
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteRedisRow(tab.key, rowKey)}>
                      删除
                    </Button>
                  </Flex>
                  {expanded && (
                    <Input.TextArea className="redis-value-editor" value={edit.value} autoSize={{ minRows: 4, maxRows: 14 }} onChange={(event) => updateRedisEdit(tab.key, rowKey, { value: event.target.value })} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderResultTable = (tab: WorkspaceTab): React.ReactNode => {
    const baseTableRows: EditableRow[] = tab.kind === 'preview' ? (tab.editRows ?? []) : (tab.result?.rows.map((row, index) => ({ ...row, __rowKey: `query:${index}` })) ?? [])
    const selectedRowKeyMap = tab.selectedRowKeyMap ?? Object.fromEntries((tab.selectedRowKeys ?? []).map((key) => [String(key), true]))
    const selectedColumnMap = tab.selectedColumnMap ?? Object.fromEntries((tab.selectedColumns ?? []).map((column) => [column, true]))
    const resultColumns = tab.result?.columns ?? []
    const orderedColumns = [...(tab.columnOrder ?? []).filter((column) => resultColumns.includes(column)), ...resultColumns.filter((column) => !(tab.columnOrder ?? []).includes(column))]
    const columnFilters = tab.columnFilters ?? {}
    const filterColumns = Object.keys(columnFilters)
    const filteredRows = filterColumns.length > 0
      ? baseTableRows.filter((row) => filterColumns.every((column) => columnFilters[column]?.includes(tableFilterValueKey(row[column]))))
      : baseTableRows
    const tableRows = tab.sortState
      ? [...filteredRows].sort((left, right) => {
          const leftValue = left[tab.sortState!.column]
          const rightValue = right[tab.sortState!.column]
          const leftEmpty = leftValue === null || leftValue === undefined
          const rightEmpty = rightValue === null || rightValue === undefined
          if (leftEmpty || rightEmpty) {
            return leftEmpty === rightEmpty ? 0 : leftEmpty ? -1 : 1
          }
          const leftNumber = Number(leftValue)
          const rightNumber = Number(rightValue)
          const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
            ? leftNumber - rightNumber
            : String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
          return tab.sortState!.direction === 'ascend' ? result : -result
        })
      : filteredRows
    const rowNumberOffset = ((tab.page ?? 1) - 1) * (tab.limit ?? (tab.kind === 'preview' ? PREVIEW_DEFAULT_LIMIT : QUERY_DEFAULT_LIMIT))

    const applySelectedRows = (nextSelectedRowKeys: React.Key[]): void => {
      const nextSelectedRowKeyMap = Object.fromEntries(nextSelectedRowKeys.map((key) => [String(key), true as const]))
      const currentSelected = JSON.stringify((tab.selectedRowKeys ?? []).map(String))
      const nextSelected = JSON.stringify(nextSelectedRowKeys.map(String))
      if (currentSelected === nextSelected) {
        return
      }
      updateWorkspaceTab(tab.key, {
        selectedRowKeys: nextSelectedRowKeys,
        selectedRowKeyMap: nextSelectedRowKeyMap
      })
    }

    const previewSelectedRows = (nextSelectedRowKeys: React.Key[]): void => {
      rowSelectionDraftRefs.current[tab.key] = nextSelectedRowKeys
      const nextSelectedSet = new Set(nextSelectedRowKeys.map(String))
      const currentSelected = tableBodyRefs.current[tab.key]?.querySelectorAll('.row-selected') ?? []
      currentSelected.forEach((element) => element.classList.remove('row-selected'))
      tableBodyRefs.current[tab.key]?.querySelectorAll<HTMLElement>('[data-row-key]').forEach((element) => {
        if (nextSelectedSet.has(element.dataset.rowKey ?? '')) {
          element.classList.add('row-selected')
        }
      })
    }

    const commitPreviewSelectedRows = (): void => {
      const draft = rowSelectionDraftRefs.current[tab.key]
      if (!draft) {
        return
      }
      rowSelectionDraftRefs.current[tab.key] = undefined
      applySelectedRows(draft)
    }

    const clearSelectedRows = (): void => {
      if (!tab.selectedRowKeys?.length && !rowSelectionDraftRefs.current[tab.key]?.length) {
        return
      }
      rowSelectionDraftRefs.current[tab.key] = undefined
      applySelectedRows([])
    }

    const selectCurrentRow = (rowKey: string): void => {
      previewSelectedRows([rowKey])
    }

    const selectCurrentColumn = (column: string): void => {
      updateWorkspaceTab(tab.key, {
        selectedColumns: [column],
        selectedColumnMap: { [column]: true },
        editingCell: undefined
      })
    }

    const clearSelectedColumns = (): void => {
      if (!tab.selectedColumns?.length && !Object.keys(tab.selectedColumnMap ?? {}).length) {
        return
      }
      updateWorkspaceTab(tab.key, { selectedColumns: [], selectedColumnMap: {} })
    }

    const toggleColumnSort = (column: string): void => {
      const nextSort = !tab.sortState || tab.sortState.column !== column
        ? { column, direction: 'ascend' as const }
        : tab.sortState.direction === 'ascend'
          ? { column, direction: 'descend' as const }
          : undefined
      updateWorkspaceTab(tab.key, { sortState: nextSort })
    }

    const updateColumnFilter = (column: string, values: string[]): void => {
      const nextFilters = { ...(tab.columnFilters ?? {}) }
      if (values.length === 0) {
        delete nextFilters[column]
      } else {
        nextFilters[column] = values
      }
      updateWorkspaceTab(tab.key, { columnFilters: nextFilters })
    }

    const clearColumnFilter = (column: string): void => {
      const nextFilters = { ...(tab.columnFilters ?? {}) }
      delete nextFilters[column]
      updateWorkspaceTab(tab.key, { columnFilters: nextFilters })
    }

    const updateDragRowSelection = (rowKey: string): void => {
      const anchor = rowDragAnchorRefs.current[tab.key]
      if (!anchor) {
        return
      }
      const start = tableRows.findIndex((row) => row.__rowKey === anchor)
      const end = tableRows.findIndex((row) => row.__rowKey === rowKey)
      if (start < 0 || end < 0) {
        return
      }
      const nextSelected = tableRows.slice(Math.min(start, end), Math.max(start, end) + 1).map((row) => row.__rowKey)
      const currentDraft = rowSelectionDraftRefs.current[tab.key]
      if (currentDraft && currentDraft.length === nextSelected.length && currentDraft.every((key, index) => String(key) === String(nextSelected[index]))) {
        return
      }
      previewSelectedRows(nextSelected)
    }

    const moveColumn = (fromColumn: string, toColumn: string): void => {
      if (fromColumn === toColumn) {
        return
      }
      const nextOrder = [...orderedColumns]
      const fromIndex = nextOrder.indexOf(fromColumn)
      const toIndex = nextOrder.indexOf(toColumn)
      if (fromIndex < 0 || toIndex < 0) {
        return
      }
      const [moved] = nextOrder.splice(fromIndex, 1)
      nextOrder.splice(toIndex, 0, moved)
      updateWorkspaceTab(tab.key, { columnOrder: nextOrder, draggingColumn: undefined })
    }

    const getColumnFilterOptions = (column: string): ColumnFilterOption[] => tab.columnFilterOptions?.[column] ?? []

    const prepareColumnFilterOptions = (column: string): void => {
      if (tab.columnFilterOptions?.[column]) {
        return
      }
      updateWorkspaceTab(tab.key, {
        columnFilterOptions: {
          ...(tab.columnFilterOptions ?? {}),
          [column]: buildColumnFilterOptions(baseTableRows, column)
        }
      })
    }

    const renderColumnTitle = (column: string): React.ReactNode => {
      const filterOptions = getColumnFilterOptions(column)
      const checkedValues = columnFilters[column] ?? []
      const sortIcon = tab.sortState?.column === column
        ? tab.sortState.direction === 'ascend'
          ? <SortAscendingOutlined />
          : <SortDescendingOutlined />
        : <span className="column-sort-default-icon" aria-hidden="true">⇅</span>

      return (
        <Flex align="center" gap={4} className="column-header-content">
          <button
            type="button"
            className={`column-select-button${selectedColumnMap[column] ? ' selected' : ''}${tab.draggingColumn === column ? ' dragging' : ''}`}
            title="点击选中当前列，拖动可调整列顺序"
            draggable
            onClick={(event) => {
              event.stopPropagation()
              selectCurrentColumn(column)
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', column)
              updateWorkspaceTab(tab.key, { draggingColumn: column })
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              moveColumn(event.dataTransfer.getData('text/plain') || tab.draggingColumn || column, column)
            }}
            onDragEnd={() => updateWorkspaceTab(tab.key, { draggingColumn: undefined })}
          >
            {column}
          </button>
          <button type="button" className={`column-sort-button${tab.sortState?.column === column ? ' active' : ''}`} title="切换排序" onClick={(event) => { event.stopPropagation(); toggleColumnSort(column) }}>
            {sortIcon}
          </button>
          <Popover
            trigger="click"
            placement="bottomRight"
            onOpenChange={(open) => {
              if (open) {
                prepareColumnFilterOptions(column)
              }
            }}
            content={(
              <Space direction="vertical" className="column-filter-popover">
                <Typography.Text strong>{column} 筛选</Typography.Text>
                <Checkbox.Group value={checkedValues} onChange={(values) => updateColumnFilter(column, values.map(String))}>
                  <Space direction="vertical" className="column-filter-options">
                    {filterOptions.length > 0 ? filterOptions.map((option) => (
                      <Checkbox key={option.value} value={option.value}>{option.label} <Typography.Text type="secondary">({option.count})</Typography.Text></Checkbox>
                    )) : <Typography.Text type="secondary">点击筛选后加载选项</Typography.Text>}
                  </Space>
                </Checkbox.Group>
                <Flex justify="space-between" align="center">
                  <Button size="small" type="link" onClick={() => updateColumnFilter(column, filterOptions.map((option) => option.value))} disabled={filterOptions.length === 0}>全选</Button>
                  <Button size="small" type="link" onClick={() => clearColumnFilter(column)}>清空</Button>
                </Flex>
              </Space>
            )}
          >
            <button type="button" className={`column-filter-button${checkedValues.length > 0 ? ' active' : ''}`} title="筛选本页数据" onClick={(event) => event.stopPropagation()}>
              <FilterOutlined />
            </button>
          </Popover>
        </Flex>
      )
    }

    const rowNumberColumn: ColumnsType<EditableRow>[number] = {
      title: <span className="row-number-header">#</span>,
      key: '__rowNumber',
      width: 34,
      fixed: 'left',
      className: 'row-number-cell',
      render: (_value: unknown, row: EditableRow, index: number) => {
        const selected = Boolean(selectedRowKeyMap[row.__rowKey])
        return (
          <button
            type="button"
            className={`row-number-button${selected ? ' selected' : ''}`}
            title="选中当前行，拖动可选择多行"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              rowDragAnchorRefs.current[tab.key] = row.__rowKey
              selectCurrentRow(row.__rowKey)
            }}
            onMouseEnter={() => updateDragRowSelection(row.__rowKey)}
          >
            {rowNumberOffset + index + 1}
          </button>
        )
      }
    }

    const dataColumns: ColumnsType<EditableRow> =
      orderedColumns.map((column) => ({
        title: renderColumnTitle(column),
        dataIndex: column,
        key: column,
        width: 180,
        ellipsis: true,
        className: selectedColumnMap[column] ? 'column-selected-cell' : undefined,
        render: (value: unknown, row: EditableRow) => (tab.kind === 'preview' ? renderEditableCell(tab, row, column, value) : <span className="table-cell-text">{value === null || value === undefined ? 'NULL' : String(value)}</span>)
      })) ?? []
    const tableColumns: ColumnsType<EditableRow> = tab.kind === 'preview' ? [rowNumberColumn, ...dataColumns] : dataColumns
    const tableScrollX = Math.max((tab.result?.columns.length ?? 0) * 180 + (tab.kind === 'preview' ? 34 : 0), 720)
    const tableScrollY = tableBodyHeights[tab.key] ?? 320

    if (tab.kind === 'redis-browser') {
      return renderRedisBrowser(tab)
    }

    return (
      <div className="result-table-shell">
        {renderResultStatus(tab)}
        {renderTableToolbar(tab)}
        {tab.error && <Alert message="执行失败" description={tab.error} type="error" showIcon />}
        {tab.result?.limited && <Alert message="还有更多数据，可以点击下一页继续查看" type="warning" showIcon />}
        <div
          ref={(element) => { tableBodyRefs.current[tab.key] = element }}
          className="result-table-body"
          style={{ '--result-table-scroll-y': `${tableScrollY}px` } as React.CSSProperties}
          onMouseDown={(event) => {
            const target = event.target as HTMLElement
            if (!target.closest('.row-number-button')) {
              clearSelectedRows()
            }
            if (!target.closest('.column-header-content')) {
              clearSelectedColumns()
            }
          }}
          onMouseUp={() => {
            rowDragAnchorRefs.current[tab.key] = undefined
            commitPreviewSelectedRows()
          }}
          onMouseLeave={() => {
            rowDragAnchorRefs.current[tab.key] = undefined
            commitPreviewSelectedRows()
          }}
        >
          <Table
            className="result-table"
            rowClassName={(row) => [
              row.__deleted ? 'row-deleted' : row.__state ? `row-${row.__state}` : '',
              selectedRowKeyMap[row.__rowKey] ? 'row-selected' : ''
            ].filter(Boolean).join(' ')}
            size="small"
            loading={tab.loading}
            columns={tableColumns}
            dataSource={tableRows}
            rowKey="__rowKey"
            pagination={false}
            scroll={{ x: tableScrollX, y: tableScrollY }}
            tableLayout="fixed"
            locale={{ emptyText: tab.kind === 'query' ? '暂无查询结果' : '暂无表数据' }}
          />
        </div>
      </div>
    )
  }

  const getDefaultDatabaseName = (connection: ConnectionInfo): string | undefined => {
    if (connection.database_type !== 'mysql' && connection.database_type !== 'mongodb' && connection.database_type !== 'redis' && connection.database_type !== 'clickhouse') {
      return undefined
    }

    if (connection.database && !connection.database.includes(':')) {
      return connection.database
    }

    const dbNames = allDatabases[connection.connection_id] ?? []
    if (dbNames.length > 0) {
      return dbNames[0]
    }

    return undefined
  }

  const getDefaultPgDatabase = (connection: ConnectionInfo): string | undefined => {
    if (connection.database_type !== 'postgresql') {
      return undefined
    }

    const connectionDb = connection.database?.split('@')[0]
    const dbNames = allDatabases[connection.connection_id] ?? []

    if (connectionDb && dbNames.includes(connectionDb)) {
      return connectionDb
    }

    return connectionDb || dbNames[0]
  }

  const getDefaultPgSchema = (schemas: string[]): string | undefined => {
    return schemas.includes('public') ? 'public' : schemas[0]
  }

  const preloadCompletionForDatabase = async (connectionId: string, databaseName: string): Promise<void> => {
    const cacheKey = `${connectionId}:${databaseName}`

    if (completionTables[cacheKey]) {
      return
    }

    try {
      const data = await requestJson<{ tables: TableInfo[] }>(`/connections/${connectionId}/tables?database=${encodeURIComponent(databaseName)}`)
      const tableNames = data.tables.map((t) => t.name)
      setCompletionTables((current) => ({ ...current, [cacheKey]: tableNames }))
    } catch {
      // ignore
    }
  }

  const ensureDatabasesLoaded = async (connectionId: string): Promise<void> => {
    if (allDatabases[connectionId]) {
      return
    }

    try {
      const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connectionId}/databases`)
      const dbNames = data.databases.map((d) => d.name)
      setAllDatabases((current) => ({ ...current, [connectionId]: dbNames }))
    } catch {
      // ignore
    }
  }

  const ensureSchemasLoaded = async (connectionId: string, pgDatabaseName: string): Promise<string[]> => {
    const key = `${connectionId}:${pgDatabaseName}`

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
  }

  const renderWorkspaceTab = (tab: WorkspaceTab): React.ReactNode => {
    if (tab.kind === 'query') {
      const connection = getConnection(tab.connectionId)
      const isMysql = connection?.database_type === 'mysql'
      const isDm = connection?.database_type === 'dm'
      const isPg = connection?.database_type === 'postgresql'
      const isMongo = connection?.database_type === 'mongodb'
      const isRedis = connection?.database_type === 'redis'
      const isClickHouse = connection?.database_type === 'clickhouse'
      const dbOptions = tab.connectionId ? (allDatabases[tab.connectionId] ?? []) : []
      const schemaKey = tab.connectionId && tab.pgDatabaseName ? `${tab.connectionId}:${tab.pgDatabaseName}` : ''
      const schemaOptions = schemaKey ? (allSchemas[schemaKey] ?? []) : []

      return (
        <div className="query-workspace">
          <Space className="query-toolbar">
            <Select
              className="connection-select"
              placeholder="选择连接"
              value={tab.connectionId}
              onChange={(connectionId) => {
                const nextConn = getConnection(connectionId)
                void ensureDatabasesLoaded(connectionId)
                const nextDb = isDatabaseScopedType(nextConn?.database_type) ? getDefaultDatabaseName(nextConn) : undefined
                const nextPgDb = nextConn?.database_type === 'postgresql' ? getDefaultPgDatabase(nextConn!) : undefined
                updateWorkspaceTab(tab.key, {
                  connectionId,
                  databaseName: nextDb,
                  pgDatabaseName: nextPgDb
                })

                if ((isDatabaseScopedType(nextConn?.database_type)) && nextDb) {
                  void preloadCompletionForDatabase(connectionId, nextDb)
                }
              }}
              options={connections.map((c) => ({ label: c.name, value: c.connection_id }))}
            />
            {(isMysql || isPg || isDm || isMongo || isRedis || isClickHouse) && (
              <Select
                className="database-select"
                placeholder={isPg ? '选择 Database' : isDm ? '选择 Schema' : isMongo ? '选择数据库' : isRedis ? '选择 Redis DB' : isClickHouse ? '选择数据库' : '选择库'}
                value={isPg ? (tab.pgDatabaseName || undefined) : (tab.databaseName || undefined)}
                onChange={async (value) => {
                  if (isPg) {
                    const schemaNames = await ensureSchemasLoaded(tab.connectionId!, value)
                    const defaultSchema = getDefaultPgSchema(schemaNames)
                    updateWorkspaceTab(tab.key, { pgDatabaseName: value, databaseName: defaultSchema })
                  } else {
                    updateWorkspaceTab(tab.key, { databaseName: value })
                    if (!isDm) {
                      void preloadCompletionForDatabase(tab.connectionId!, value)
                    }
                  }
                }}
                onDropdownVisibleChange={(open) => {
                  if (open && tab.connectionId) {
                    void ensureDatabasesLoaded(tab.connectionId)
                  }
                }}
                options={dbOptions.map((name) => ({ label: name, value: name }))}
              />
            )}
            {isPg && tab.pgDatabaseName && (
              <Select
                className="schema-select"
                placeholder="选择 Schema"
                value={tab.databaseName || undefined}
                onChange={(value) => updateWorkspaceTab(tab.key, { databaseName: value })}
                options={schemaOptions.map((name) => ({ label: name, value: name }))}
              />
            )}
            <Button type="primary" icon={<PlayCircleOutlined />} loading={tab.loading} onClick={() => void runQuery(tab, selectedSqlByTab[tab.key])}>
              执行
            </Button>
          </Space>
          <Splitter className="query-body-splitter" layout="vertical">
            <Splitter.Panel defaultSize={280} min={160} max="75%" className="sql-editor-panel">
              <div className="sql-editor-container">
                <SqlEditor
                  value={tab.sql}
                  onChange={(sql) => updateWorkspaceTab(tab.key, { sql })}
                  onExecute={(selectedSql) => void runQuery(tab, selectedSql)}
                  onSelectionChange={(selectedSql) => setSelectedSqlByTab((current) => ({ ...current, [tab.key]: selectedSql }))}
                  theme={theme}
                  completionContext={buildSqlCompletionContext(tab)}
                />
              </div>
            </Splitter.Panel>
            <Splitter.Panel min={120}>
              {renderResultTable(tab)}
            </Splitter.Panel>
          </Splitter>
        </div>
      )
    }

    return <div className="query-workspace">{renderResultTable(tab)}</div>
  }

  const openRedisDatabaseBrowser = async (connectionId: string, databaseName: string, limit = REDIS_DEFAULT_LIMIT, page = 1): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const tabKey = `redis:${connectionId}:${databaseName}`
    setSelectedConnectionId(connectionId)
    setActiveTabKey(tabKey)
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
          loading: true,
          redisMode: 'database',
          redisExpandedValues: {}
        }
      ]
    })

    await previewRedisDatabase(connectionId, databaseName, limit, page, tabKey)
  }

  const previewRedisDatabase = async (connectionId: string, databaseName: string, limit = REDIS_DEFAULT_LIMIT, page = 1, tabKey = `redis:${connectionId}:${databaseName}`): Promise<void> => {
    try {
      const result = await requestJson<QueryResponse>(withPageQuery(withPgDatabase(`/connections/${connectionId}/tables/__DATADJINN_REDIS_DATABASE__/preview`, databaseName), limit, page))
      updateWorkspaceTab(tabKey, { result, redisEdits: buildRedisEdits(result.rows), redisExpandedValues: {}, page, limit, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载 Redis Key 失败' })
      showError(err instanceof Error ? err.message : '加载 Redis Key 失败')
    }
  }

  const checkHealth = async (): Promise<void> => {
    setHealthLoading(true)

    try {
      await requestJson<HealthStatus>('/health')
    } catch (err) {
      showError(err instanceof Error ? err.message : '无法连接后端服务')
    } finally {
      setHealthLoading(false)
    }
  }

  const loadConnections = async (): Promise<void> => {
    const data = await requestJson<{ connections: ConnectionInfo[] }>('/connections')
    setConnections(data.connections)
    setSelectedConnectionId((current) => current ?? data.connections[0]?.connection_id)

    for (const connection of data.connections) {
      if (connection.is_open && (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'mongodb' || connection.database_type === 'redis' || connection.database_type === 'clickhouse')) {
        try {
          const dbData = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connection.connection_id}/databases`)
          const dbNames = dbData.databases.map((d) => d.name)
          setAllDatabases((current) => ({ ...current, [connection.connection_id]: dbNames }))
          setSelectedDatabases((current) => {
            if (!current[connection.connection_id]) {
              if (connection.database_type === 'postgresql') {
                const connDb = connection.database.split('@')[0]
                if (dbNames.includes(connDb)) {
                  return { ...current, [connection.connection_id]: [connDb] }
                }
              }

              return { ...current, [connection.connection_id]: defaultSelectedDatabases(connection, dbNames, dbData.databases) }
            }

            const filtered = filterPersistedValues(current[connection.connection_id], dbNames)
            return { ...current, [connection.connection_id]: filtered }
          })
        } catch {
          // ignore
        }
      }
    }

    refreshTree(data.connections)
  }

  const objectNodesForGroup = async (connectionId: string, objectType: DbObjectType, databaseName?: string, pgDatabaseName?: string): Promise<DatabaseTreeNode[]> => {
    const path = withPgDatabase(`/connections/${connectionId}/objects`, databaseName, pgDatabaseName)
    const data = await requestJson<{ objects: DbObjectInfo[] }>(`${path}${databaseName || pgDatabaseName ? '&' : '?'}type=${objectType}`)
    return data.objects.map<DatabaseTreeNode>((object) => {
      const kind = object.type === 'table' ? 'table' : 'db-object'
      const group = DB_OBJECT_GROUP_BY_TYPE[object.type]

      return {
        key: `${kind}:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${object.type}:${object.name}`,
        title: object.name,
        icon: group.icon,
        kind,
        connectionId,
        databaseName,
        pgDatabaseName,
        tableName: object.name,
        objectType: object.type,
        sizeDisplay: object.size_display,
        sizeBytes: object.size_bytes,
        storageSizeDisplay: object.storage_size_display,
        storageSizeBytes: object.storage_size_bytes,
        rowCount: object.row_count,
        childrenLoaded: false,
        isLeaf: object.type !== 'table'
      }
    })
  }

  const preloadObjectGroupNodes = async (connectionId: string, databaseName?: string, pgDatabaseName?: string, databaseType?: DatabaseType): Promise<DatabaseTreeNode[]> => {
    return buildObjectGroupNodes(connectionId, databaseName, pgDatabaseName, databaseType)
  }

  const preloadDatabaseChildren = async (connection: ConnectionInfo, databaseName: string, selectedSchemaOverride?: string[]): Promise<DatabaseTreeNode[]> => {
    if (connection.database_type === 'redis') {
      return []
    }

    if (connection.database_type === 'postgresql') {
      const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connection.connection_id}/schemas?database=${encodeURIComponent(databaseName)}`)
      const selKey = `${connection.connection_id}:${databaseName}`
      const schemaNames = data.databases.map((schema) => schema.name)
      const currentSelected = selectedSchemaOverride ?? selectedSchemasRef.current[selKey]
      const nextSelected = currentSelected ? filterPersistedValues(currentSelected, schemaNames) : schemaNames

      setAllSchemas((current) => ({ ...current, [selKey]: schemaNames }))
      setSelectedSchemas((current) => {
        const next = { ...current, [selKey]: nextSelected }
        selectedSchemasRef.current = next
        return next
      })

      return data.databases
        .filter((schema) => nextSelected.includes(schema.name))
        .map((schema) => buildPgSchemaNode(connection, databaseName, schema))
    }

    void preloadCompletionForDatabase(connection.connection_id, databaseName)
    return preloadObjectGroupNodes(connection.connection_id, databaseName, undefined, connection.database_type)
  }

  const preloadConnectionTree = async (connection: ConnectionInfo, selectedDatabaseOverride?: string[]): Promise<DatabaseTreeNode[]> => {
    const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connection.connection_id}/databases`)
    const dbNames = data.databases.map((database) => database.name)
    const currentSelected = selectedDatabaseOverride ?? selectedDatabasesRef.current[connection.connection_id]
    const nextSelected = currentSelected ? filterPersistedValues(currentSelected, dbNames) : defaultSelectedDatabases(connection, dbNames, data.databases)

    setAllDatabases((current) => ({ ...current, [connection.connection_id]: dbNames }))
    setSelectedDatabases((current) => {
      const next = { ...current, [connection.connection_id]: nextSelected }
      selectedDatabasesRef.current = next
      return next
    })

    const databaseNodes = data.databases
      .filter((database) => nextSelected.includes(database.name))
      .map((database) => buildDatabaseNode(connection, database))

    setTreeData((current) => updateTreeNode(current, `connection:${connection.connection_id}`, databaseNodes))
    return databaseNodes
  }

  const loadChildrenForNode = async (node: DatabaseTreeNode): Promise<DatabaseTreeNode[]> => {
    if (node.closed) {
      return []
    }

    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)

      if (connection?.database_type !== 'mysql' && connection?.database_type !== 'postgresql' && connection?.database_type !== 'dm' && connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis' && connection?.database_type !== 'clickhouse') {
        return []
      }

      return preloadConnectionTree(connection)
    }

    if (node.kind === 'database' && node.connectionId && node.databaseName) {
      const connection = getConnection(node.connectionId)

      if (!connection || connection.database_type === 'redis') {
        return []
      }

      return preloadDatabaseChildren(connection, node.databaseName)
    }

    if (node.kind === 'pg-schema' && node.connectionId && node.databaseName) {
      return preloadObjectGroupNodes(node.connectionId, node.databaseName, node.pgDatabaseName, getConnection(node.connectionId)?.database_type)
    }

    if (node.kind === 'object-group' && node.connectionId && node.objectType) {
      return objectNodesForGroup(node.connectionId, node.objectType, node.databaseName, node.pgDatabaseName)
    }

    if (node.kind === 'table' && node.connectionId && node.tableName) {
      const data = await requestJson<{ columns: ColumnInfo[] }>(withPgDatabase(`/connections/${node.connectionId}/tables/${encodeURIComponent(node.tableName)}/columns`, node.databaseName, node.pgDatabaseName))
      return data.columns.map<DatabaseTreeNode>((column) => ({
        key: `column:${node.connectionId}:${node.databaseName ?? 'main'}:${node.tableName}:${column.name}`,
        title: `${column.name} · ${column.type}${column.primary_key ? ' · PK' : ''}${column.nullable ? '' : ' · NOT NULL'}`,
        kind: 'column',
        columnName: column.name,
        columnType: column.type,
        nullable: column.nullable,
        primaryKey: column.primary_key,
        isLeaf: true
      }))
    }

    return []
  }

  const reloadNodeChildren = async (node: DatabaseTreeNode, expand = true): Promise<void> => {
    if (!node.key || treeLoadingKeysRef.current.has(node.key)) {
      return
    }

    treeLoadingKeysRef.current.add(node.key)
    try {
      const children = await loadChildrenForNode(node)
      if (node.kind !== 'connection') {
        setTreeData((current) => updateTreeNode(current, node.key as React.Key, children))
      }
      if (expand) {
        startTransition(() => {
          setExpandedKeys((current) => current.includes(node.key as React.Key) ? current : [...current, node.key as React.Key])
        })
      }
    } finally {
      treeLoadingKeysRef.current.delete(node.key)
    }
  }

  const isTreeNodeChildrenLoaded = (node: DatabaseTreeNode): boolean =>
    Boolean(node.isLeaf || node.childrenLoaded || node.children?.length)

  const isLoadableTreeNode = (node: DatabaseTreeNode): boolean => {
    if (node.kind === 'database' && node.connectionId && getConnection(node.connectionId)?.database_type === 'redis') {
      return false
    }

    return node.kind === 'connection' || node.kind === 'database' || node.kind === 'pg-schema' || node.kind === 'object-group' || node.kind === 'table'
  }

  const collapseTreeNode = (node: DatabaseTreeNode): void => {
    const key = node.key as React.Key
    startTransition(() => {
      setExpandedKeys((current) => current.filter((item) => item !== key))
    })
  }

  const toggleOrLoadTreeNode = (node: DatabaseTreeNode): void => {
    if (!node.key || !isLoadableTreeNode(node)) {
      return
    }

    const key = node.key as React.Key
    const isExpanded = expandedKeys.includes(key)

    if (isExpanded) {
      collapseTreeNode(node)
      return
    }

    if (!isTreeNodeChildrenLoaded(node)) {
      void reloadNodeChildren({ ...node, isLeaf: false })
      return
    }

    startTransition(() => {
      setExpandedKeys((current) => current.includes(key) ? current : [...current, key])
    })
  }

  const openConnectionModal = async (nextDatabaseType: DatabaseType): Promise<void> => {
    setConnectionMode('create')
    setEditingConnectionInfoId(undefined)
    form.resetFields()

    if (nextDatabaseType === 'sqlite') {
      form.setFieldsValue({
        database_type: 'sqlite',
        name: '本地 SQLite',
        sqlite_path: 'data/datadjinn.sqlite'
      })
    } else if (nextDatabaseType === 'postgresql') {
      form.setFieldsValue({
        database_type: 'postgresql',
        name: 'PostgreSQL',
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres'
      })
    } else if (nextDatabaseType === 'dm') {
      await loadDrivers()
      form.setFieldsValue({
        database_type: 'dm',
        name: '达梦',
        host: '127.0.0.1',
        port: 5236,
        username: 'SYSDBA'
      })
    } else if (nextDatabaseType === 'mongodb') {
      form.setFieldsValue({
        database_type: 'mongodb',
        name: 'MongoDB',
        host: '127.0.0.1',
        port: 27017,
        database: 'admin'
      })
    } else if (nextDatabaseType === 'redis') {
      form.setFieldsValue({
        database_type: 'redis',
        name: 'Redis',
        host: '127.0.0.1',
        port: 6379,
        database: '0'
      })
    } else if (nextDatabaseType === 'clickhouse') {
      form.setFieldsValue({
        database_type: 'clickhouse',
        name: 'ClickHouse',
        host: '127.0.0.1',
        port: 8123,
        username: 'default',
        database: 'default'
      })
    } else {
      form.setFieldsValue({
        database_type: 'mysql',
        name: 'MySQL',
        host: '127.0.0.1',
        port: 3306
      })
    }

    setConnectionModalOpen(true)
  }

  const openEditConnectionModal = async (connection: ConnectionInfo): Promise<void> => {
    setConnectionMode('edit')
    setEditingConnectionInfoId(connection.connection_id)
    setConnectionModalOpen(true)
    setConnectionLoading(true)

    try {
      const data = await requestJson<ConnectionFormValues>(`/connections/${connection.connection_id}`)
      const formValues = { ...data }
      if (data.database_type === 'dm') {
        const loadedDrivers = await loadDrivers()
        const hasSelectedDriver = loadedDrivers.some(
          (driver) => driver.database_type === 'dm' && driver.id === data.dm_driver_id
        )
        if (!hasSelectedDriver) {
          formValues.dm_driver_id = undefined
        }
      }
      form.setFieldsValue(formValues)
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载连接信息失败')
      setConnectionModalOpen(false)
    } finally {
      setConnectionLoading(false)
    }
  }

  const connectionCreateMenu = {
    items: [
      { key: 'sqlite', label: 'SQLite', icon: <img src={sqliteIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'mysql', label: 'MySQL', icon: <img src={mysqlIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'postgresql', label: 'PostgreSQL', icon: <img src={postgresIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'dm', label: '达梦', icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'mongodb', label: 'MongoDB', icon: <img src={mongoIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'redis', label: 'Redis', icon: <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} /> },
      { key: 'clickhouse', label: 'ClickHouse', icon: <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} /> }
    ],
    onClick: ({ key }: { key: string }) => void openConnectionModal(key as DatabaseType)
  }

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
        dm_driver_id: values.dm_driver_id
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
      setDrivers(result.drivers)
      return result.drivers
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载驱动失败')
      return []
    } finally {
      setDriversLoading(false)
    }
  }

  const openSettings = (section: SettingsSection = 'app'): void => {
    setSettingsSection(section)
    setDriverManagerOpen(true)
    void window.api.getAppInfo().then(setAppInfo).catch(() => undefined)

    if (section === 'drivers') {
      driverForm.setFieldsValue({ database_type: 'dm', driver_type: 'jdbc', name: '', enabled: true })
      void loadDrivers()
      void loadJavaRuntimes()
    }
  }

  const openDriverManager = (): void => {
    openSettings('drivers')
  }

  const switchSettingsSection = (section: SettingsSection): void => {
    setSettingsSection(section)
    if (section === 'drivers') {
      driverForm.setFieldsValue({ database_type: driverForm.getFieldValue('database_type') ?? 'dm', driver_type: driverForm.getFieldValue('driver_type') ?? 'jdbc', enabled: true })
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
      driverForm.setFieldsValue({ database_type: values.database_type, driver_type: 'jdbc', name: '', path: undefined, enabled: true })
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

  const dmDriverOptionDrivers = selectedDmDriver && !selectedDmDriver.enabled ? [selectedDmDriver, ...dmDrivers] : dmDrivers
  const dmDriverOptions = dmDriverOptionDrivers.map((driver) => ({
    label: `${driverTypeLabel(driver.driver_type)} - ${driver.name}${driver.enabled ? '' : '（已禁用）'}`,
    value: driver.id,
    disabled: !driver.enabled
  }))

  const testConnection = async (): Promise<void> => {
    setTestingConnection(true)

    try {
      const values = await form.validateFields()
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
        setTreeData((current) => replaceConnectionNode(current, connection))
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
      setTreeData((current) => [...current, buildConnectionNode(connection)])
      setConnectionModalOpen(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : connectionMode === 'edit' ? '更新连接失败' : '保存连接失败')
    } finally {
      setConnectionLoading(false)
    }
  }

  const openConnectionById = async (connectionId: string): Promise<void> => {
    setConnectionTreeLoadingText(connectionId, '正在打开连接...')
    try {
      const connection = await requestJson<ConnectionInfo>(`/connections/${connectionId}/open`, { method: 'POST' })

      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setTreeData((current) => replaceConnectionNode(current, connection))

      const connKey = `connection:${connectionId}`
      setExpandedKeys((current) => current.includes(connKey) ? current : [...current, connKey])

      if (connection.database_type === 'sqlite') {
        setTreeData((current) => updateTreeNode(current, connKey, buildConnectionNode(connection).children ?? []))
      } else {
        setConnectionTreeLoadingText(connectionId, '正在加载库表...')
        await preloadConnectionTree(connection)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '打开连接失败')
    } finally {
      setConnectionTreeLoadingText(connectionId)
    }
  }

  const closeConnectionById = async (connectionId: string): Promise<void> => {
    try {
      const connection = await requestJson<ConnectionInfo>(`/connections/${connectionId}/close`, { method: 'POST' })
      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setExpandedKeys((keys) => keys.filter((k) => !String(k).startsWith(`connection:${connectionId}`) && !String(k).includes(`:${connectionId}:`)))
      setTreeData((current) => replaceConnectionNode(current, connection))
    } catch (err) {
      showError(err instanceof Error ? err.message : '关闭连接失败')
    }
  }

  const deleteConnection = async (connectionId: string): Promise<void> => {
    await requestJson<{ success: boolean }>(`/connections/${connectionId}`, {
      method: 'DELETE'
    })
    const nextConnections = connections.filter((connection) => connection.connection_id !== connectionId)
    setConnections(nextConnections)
    setSelectedConnectionId((current) => (current === connectionId ? nextConnections[0]?.connection_id : current))
    setWorkspaceTabs((current) => current.filter((tab) => tab.connectionId !== connectionId))
    refreshTree(nextConnections)
  }

  const showObjectDdl = async (connectionId: string, name: string, type: DbObjectType, databaseName?: string, pgDatabaseName?: string): Promise<void> => {
    setDdlModalTitle(`${name} DDL`)
    setDdlContent('')
    setDdlLoading(true)
    setDdlModalOpen(true)

    const params = new URLSearchParams({ type })
    if (databaseName) {
      params.set('database', databaseName)
    }
    if (pgDatabaseName) {
      params.set('pg_database', pgDatabaseName)
    }

    try {
      const result = await requestJson<ObjectDdlResponse>(`/connections/${connectionId}/objects/${encodeURIComponent(name)}/ddl?${params.toString()}`)
      setDdlContent(result.ddl)
    } catch (err) {
      setDdlModalOpen(false)
      showError(err instanceof Error ? err.message : '获取 DDL 失败')
    } finally {
      setDdlLoading(false)
    }
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
          body: JSON.stringify({ name: createdName })
        })
        createdName = created.name
      }
      setDatabaseCreateModalOpen(false)
      setCreatingSchemaDatabaseName('')

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
            icon: <BranchesOutlined />,
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
      showError(err instanceof Error ? err.message : isSchema ? '创建 Schema 失败' : '创建数据库失败')
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
    const isCreateMode = mode === 'create'
    const isMongo = connection?.database_type === 'mongodb'
    const supportsComments = tableDesignerSupportsComments(connection?.database_type)
    const supportsUnique = tableDesignerSupportsUnique(connection?.database_type)
    const supportsAutoIncrement = tableDesignerSupportsAutoIncrement(connection?.database_type)
    const supportsAutoIncrementStep = tableDesignerSupportsAutoIncrementStep(connection?.database_type)
    const supportsMinMax = tableDesignerSupportsMinMax(connection?.database_type)
    const scopeLabel = connection?.database_type === 'postgresql'
      ? (databaseName ? `${pgDatabaseName ?? '-'} / ${databaseName}` : (pgDatabaseName ?? '-'))
      : (databaseName || '默认')
    const validColumns = columns.filter((column) => column.name.trim())
    const primaryKeyColumns = validColumns.filter((column) => column.primaryKey).map((column) => column.name.trim())
    const typeOptions = COMMON_TYPES.map((type) => ({ label: type, value: type }))
    const updateColumn = isCreateMode ? updateNewColumn : updateEditingColumn
    const canAddRemoveColumns = isCreateMode && !isMongo
    const canUseAutoIncrement = (column: ColumnDef): boolean => supportsAutoIncrement && isIntegerLikeType(column.type)
    const canUseAutoIncrementStep = (column: ColumnDef): boolean => supportsAutoIncrementStep && canUseAutoIncrement(column) && column.autoIncrement
    const canUseMinMax = (column: ColumnDef): boolean => supportsMinMax && isNumericLikeType(column.type)

    const commitColumnPatch = (column: ColumnDef, patch: Partial<ColumnDef>): void => {
      const next: ColumnDef = { ...column, ...patch }
      if (next.primaryKey) {
        next.nullable = false
        next.unique = false
      }
      if (!supportsComments) {
        next.comment = ''
      }
      if (!supportsUnique) {
        next.unique = false
      }
      if (!supportsAutoIncrement || !isIntegerLikeType(next.type)) {
        next.autoIncrement = false
        next.autoIncrementStep = undefined
      }
      if (next.autoIncrement) {
        next.nullable = false
        if (!supportsAutoIncrementStep) {
          next.autoIncrementStep = undefined
        } else if (!next.autoIncrementStep || next.autoIncrementStep < 1) {
          next.autoIncrementStep = 1
        }
      }
      if (!supportsMinMax || !isNumericLikeType(next.type)) {
        next.minimum = ''
        next.maximum = ''
      }
      updateColumn(column.key, next)
    }

    const renderColumnOptions = (column: ColumnDef): React.ReactNode => (
      <div className="table-designer-expanded-card">
        <div className="table-designer-expanded-grid">
          <div className="table-designer-section-card">
            <Flex align="center" justify="space-between" className="table-designer-section-head">
              <Typography.Text strong>字段约束</Typography.Text>
              <Tag color="blue">{column.name.trim() || '未命名字段'}</Tag>
            </Flex>
            <div className="table-designer-option-list">
              <div className="table-designer-option-row">
                <Typography.Text className="table-designer-option-label">设为主键</Typography.Text>
                <Checkbox
                  checked={column.primaryKey}
                  onChange={(event) => commitColumnPatch(column, {
                    primaryKey: event.target.checked,
                    nullable: event.target.checked ? false : column.nullable
                  })}
                />
              </div>
              <div className="table-designer-option-row">
                <Typography.Text className="table-designer-option-label">不允许为空</Typography.Text>
                <Checkbox
                  checked={!column.nullable}
                  disabled={column.primaryKey || column.autoIncrement}
                  onChange={(event) => commitColumnPatch(column, { nullable: !event.target.checked })}
                />
              </div>
              {supportsUnique && (
                <div className="table-designer-option-row">
                  <Typography.Text className="table-designer-option-label">值必须唯一</Typography.Text>
                  <Checkbox
                    checked={column.unique}
                    disabled={column.primaryKey}
                    onChange={(event) => commitColumnPatch(column, { unique: event.target.checked })}
                  />
                </div>
              )}
              {canUseAutoIncrement(column) && (
                <div className="table-designer-option-row">
                  <Typography.Text className="table-designer-option-label">自动递增</Typography.Text>
                  <Checkbox
                    checked={column.autoIncrement}
                    onChange={(event) => commitColumnPatch(column, { autoIncrement: event.target.checked })}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="table-designer-section-card">
            <Flex align="center" justify="space-between" className="table-designer-section-head">
              <Typography.Text strong>类型规则</Typography.Text>
              <Typography.Text type="secondary">{column.type || '未填写类型'}</Typography.Text>
            </Flex>
            <div className="table-designer-option-list">
              <div className="table-designer-hint-card">
                <Typography.Text type="secondary">
                  {canUseAutoIncrement(column)
                    ? '当前字段是整数类型，可设置自增。'
                    : canUseMinMax(column)
                      ? '当前字段是数值类型，可设置最小值和最大值。'
                      : '当前字段按数据库原始类型创建，没有额外数值规则。'}
                </Typography.Text>
              </div>
              {canUseAutoIncrementStep(column) && (
                <div className="table-designer-option-row">
                  <Typography.Text className="table-designer-option-label">自增步长</Typography.Text>
                  <InputNumber
                    size="small"
                    min={1}
                    className="table-designer-option-control"
                    value={column.autoIncrementStep ?? undefined}
                    onChange={(nextValue) => commitColumnPatch(column, { autoIncrementStep: typeof nextValue === 'number' ? nextValue : undefined })}
                  />
                </div>
              )}
              {canUseMinMax(column) && (
                <>
                  <div className="table-designer-option-row">
                    <Typography.Text className="table-designer-option-label">最小值</Typography.Text>
                    <Input
                      size="small"
                      className="table-designer-option-control"
                      value={column.minimum}
                      onChange={(event) => commitColumnPatch(column, { minimum: event.target.value })}
                    />
                  </div>
                  <div className="table-designer-option-row">
                    <Typography.Text className="table-designer-option-label">最大值</Typography.Text>
                    <Input
                      size="small"
                      className="table-designer-option-control"
                      value={column.maximum}
                      onChange={(event) => commitColumnPatch(column, { maximum: event.target.value })}
                    />
                  </div>
                </>
              )}
              {!canUseAutoIncrementStep(column) && !canUseMinMax(column) && (
                <div className="table-designer-option-empty">
                  <Typography.Text type="secondary">这个字段类型当前没有更多可设置的数值规则。</Typography.Text>
                </div>
              )}
            </div>
          </div>
        </div>
        {canAddRemoveColumns && (
          <Flex justify="end">
            <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNewColumn(column.key)}>
              删除字段
            </Button>
          </Flex>
        )}
      </div>
    )

    const columnDefs: ColumnsType<ColumnDef> = [
      {
        title: '字段名',
        dataIndex: 'name',
        key: 'name',
        width: 240,
        render: (value: string, column: ColumnDef) => (
          <Input
            size="small"
            value={value}
            placeholder="字段名"
            disabled={!isCreateMode}
            onChange={(event) => commitColumnPatch(column, { name: event.target.value })}
          />
        )
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        width: 260,
        render: (value: string, column: ColumnDef) => (
          <AutoComplete
            value={value}
            options={typeOptions}
            onChange={(nextValue) => commitColumnPatch(column, { type: nextValue })}
            filterOption={(inputValue, option) => String(option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
          >
            <Input size="small" placeholder="例如 VARCHAR(100)" />
          </AutoComplete>
        )
      },
      {
        title: '字段注释',
        dataIndex: 'comment',
        key: 'comment',
        width: 300,
        render: (value: string, column: ColumnDef) => (
          <Input
            size="small"
            value={value}
            disabled={!supportsComments}
            placeholder={supportsComments ? '例如：用户昵称、创建时间' : '当前数据库暂不支持字段注释'}
            onChange={(event) => commitColumnPatch(column, { comment: event.target.value })}
          />
        )
      }
    ]

    const tabs = isMongo
      ? []
      : [
          {
            key: 'columns',
            label: '字段',
            children: (
              <Space direction="vertical" className="full-width" size="middle">
                <Flex align="center" justify="space-between" className="table-designer-toolbar">
                  <Space size={8}>
                    <Typography.Text strong>字段</Typography.Text>
                    <Tag>{validColumns.length} 列</Tag>
                    {!isCreateMode && <Typography.Text type="secondary">当前只支持修改已有字段属性，不支持新增、删除或重命名字段。</Typography.Text>}
                  </Space>
                  {canAddRemoveColumns && <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addNewColumn}>新增字段</Button>}
                </Flex>
                <Table<ColumnDef>
                  className="table-designer-grid"
                  size="small"
                  rowKey="key"
                  loading={loading}
                  pagination={false}
                  tableLayout="fixed"
                  scroll={{ x: 860, y: 360 }}
                  dataSource={columns}
                  columns={columnDefs}
                  expandable={{
                    expandedRowRender: (column) => renderColumnOptions(column),
                    rowExpandable: () => true
                  }}
                  locale={{ emptyText: '暂无字段' }}
                />
              </Space>
            )
          },
          {
            key: 'indexes',
            label: '约束摘要',
            children: (
              <Space direction="vertical" className="full-width" size="middle">
                <Alert type="info" showIcon message="当前先展示主键摘要，索引、外键和其他约束后续再补。" />
                <div className="table-designer-index-card">
                  <Flex align="center" justify="space-between">
                    <Space size={8}>
                      <Tag color="blue">PRIMARY</Tag>
                      <Typography.Text strong>主键</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary">{primaryKeyColumns.length > 0 ? `${primaryKeyColumns.length} 列` : '未设置'}</Typography.Text>
                  </Flex>
                  <Typography.Text type="secondary">
                    {primaryKeyColumns.length > 0 ? primaryKeyColumns.join(', ') : '当前没有主键字段'}
                  </Typography.Text>
                </div>
              </Space>
            )
          }
        ]

    return (
      <Space direction="vertical" className="full-width" size="middle">
        <div className="table-designer-header">
          <div className="table-designer-header-main">
            <Typography.Text type="secondary">{isCreateMode ? '新建结构' : '编辑结构'}</Typography.Text>
            <Input
              size="large"
              value={tableName}
              placeholder={isMongo ? '请输入集合名' : '请输入表名'}
              disabled={!isCreateMode}
              onChange={(event) => setTableName?.(event.target.value)}
            />
            {!isMongo && (
              <Input
                value={tableComment}
                placeholder="表注释"
                disabled={!supportsComments}
                onChange={(event) => setTableComment?.(event.target.value)}
              />
            )}
          </div>
          <div className="table-designer-meta">
            <div className="table-designer-meta-card">
              <Typography.Text type="secondary">连接</Typography.Text>
              <Typography.Text strong>{connection?.name ?? '-'}</Typography.Text>
            </div>
            <div className="table-designer-meta-card">
              <Typography.Text type="secondary">{connection?.database_type === 'postgresql' ? '数据库 / Schema' : '数据库'}</Typography.Text>
              <Typography.Text strong>{scopeLabel}</Typography.Text>
            </div>
            <div className="table-designer-meta-card">
              <Typography.Text type="secondary">类型</Typography.Text>
              <Typography.Text strong>{isMongo ? '集合' : '数据表'}</Typography.Text>
            </div>
          </div>
        </div>
        {tabs.length > 0
          ? <Tabs className="table-designer-tabs" items={tabs} />
          : <Alert type="info" showIcon message="MongoDB 只需要填写集合名，字段结构会在写入文档后逐步推断。" />}
      </Space>
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
    const isPg = conn?.database_type === 'postgresql'

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

    if (connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'mongodb' || connection?.database_type === 'redis' || connection?.database_type === 'clickhouse') {
      try {
        const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${connectionId}/databases`)
        databases = data.databases
      } catch {
        databases = []
      }

      if (!defaultDb && connection.database_type === 'postgresql') {
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

  const updatePreviewCell = (tabKey: string, rowKey: string, column: string, value: unknown): void => {
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (tab.key !== tabKey) {
          return tab
        }

        return {
          ...tab,
          columnFilterOptions: undefined,
          editingCell: undefined,
          editRows: tab.editRows?.map((row) => {
            if (row.__rowKey !== rowKey) {
              return row
            }

            if (isCellValueEqual(row[column], value)) {
              return row
            }

            return {
              ...row,
              [column]: value,
              __state: row.__state === 'inserted' ? 'inserted' : 'updated'
            }
          })
        }
      })
    )
  }

  const addPreviewRow = (tab: WorkspaceTab): void => {
    const columns = tab.result?.columns ?? []
    const row = columns.reduce<EditableRow>((nextRow, column) => ({ ...nextRow, [column]: null }), {
      __rowKey: `new:${Date.now()}`,
      __state: 'inserted'
    })
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
      showError(err instanceof Error ? err.message : '提交 Redis 数据失败')
    }
  }

  const markSelectedRowsDeleted = (tab: WorkspaceTab): void => {
    const selected = tab.selectedRowKeyMap ? new Set(Object.keys(tab.selectedRowKeyMap)) : new Set((tab.selectedRowKeys ?? []).map(String))
    const editRows = (tab.editRows ?? [])
      .filter((row) => !(row.__state === 'inserted' && selected.has(row.__rowKey)))
      .map((row) => (selected.has(row.__rowKey) ? { ...row, __deleted: true } : row))
    updateWorkspaceTab(tab.key, { editRows, selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined })
  }

  const submitPreviewChanges = async (tab: WorkspaceTab): Promise<void> => {
    if (!tab.connectionId || !tab.tableName) {
      return
    }

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
      const dataPath = withWhereQuery(withPageQuery(withPgDatabase(`/connections/${tab.connectionId}/tables/${encodeURIComponent(tab.tableName)}/data`, tab.databaseName, tab.pgDatabaseName), limit, page), tab.where)
      const result = await requestJson<QueryResponse>(dataPath, {
        method: 'PUT',
        body: JSON.stringify({ inserted, updated, deleted })
      })
      updateWorkspaceTab(tab.key, { result, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, editingCell: undefined, where: tab.where?.trim() ?? '', loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '提交表数据失败' })
      showError(err instanceof Error ? err.message : '提交表数据失败')
    }
  }

  const previewTable = async (connectionId: string, tableName: string, databaseName?: string, pgDatabaseName?: string, limit = PREVIEW_DEFAULT_LIMIT, page = 1, where = ''): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const whereCondition = where.trim()
    const tabKey = `preview:${connectionId}:${pgDatabaseName ?? databaseName ?? 'main'}:${tableName}`

    setSelectedConnectionId(connectionId)
    setActiveTabKey(tabKey)
    setWorkspaceTabs((current) => {
      const exists = current.some((tab) => tab.key === tabKey)

      if (exists) {
        return current.map((tab) => (tab.key === tabKey ? { ...tab, limit, page, where: whereCondition, loading: true, error: undefined } : tab))
      }

      return [
        ...current,
        {
          key: tabKey,
          title: databaseName ? `${databaseName}.${tableName}` : tableName,
          kind: 'preview',
          connectionId,
          databaseName,
          pgDatabaseName,
          tableName,
          sql: '',
          limit,
          page,
          where: whereCondition,
          loading: true
        }
      ]
    })

    try {
      const previewPath = withWhereQuery(withPageQuery(withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/preview`, databaseName, pgDatabaseName), limit, page), whereCondition)
      const result = await requestJson<QueryResponse>(previewPath)
      updateWorkspaceTab(tabKey, { result, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, editingCell: undefined, where: whereCondition, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载表数据失败' })
      showError(err instanceof Error ? err.message : '加载表数据失败')
    }
  }

  const openQueryWorkspace = (initialSql = 'select * from users;', title?: string, connectionId?: string, databaseName?: string, pgDatabaseName?: string): string => {
    const nextIndex = queryCounter
    const tabKey = `query:${Date.now()}:${nextIndex}`
    const connId = connectionId ?? selectedConnectionId
    const connection = getConnection(connId)

    let finalDb = databaseName
    let finalPgDb = pgDatabaseName

    if ((isDatabaseScopedType(connection?.database_type)) && !finalDb) {
      finalDb = getDefaultDatabaseName(connection)
    }

    if (connection?.database_type === 'postgresql' && !finalPgDb) {
      finalPgDb = getDefaultPgDatabase(connection)
    }

    if (connection?.database_type === 'postgresql' && !finalDb && finalPgDb) {
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
        loading: false
        }
    ])
    setActiveTabKey(tabKey)

    if (connId) {
      void ensureDatabasesLoaded(connId)

      if ((isDatabaseScopedType(connection?.database_type)) && finalDb) {
        void preloadCompletionForDatabase(connId, finalDb)
      }

      if (connection?.database_type === 'postgresql' && finalPgDb && !finalDb) {
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

  const appendSqlToQueryWorkspace = (sql: string, title?: string): void => {
    const nextSql = sql.trimEnd()
    if (!nextSql) {
      return
    }

    const activeTab = workspaceTabs.find((tab) => tab.key === activeTabKey)
    if (activeTab?.kind === 'query') {
      const separator = activeTab.sql.trim() ? '\n\n' : ''
      updateWorkspaceTab(activeTab.key, { sql: `${activeTab.sql}${separator}${nextSql}` })
      return
    }

    openQueryWorkspace(nextSql, title ?? 'AI 生成 SQL', aiActiveContext?.connectionId, aiActiveContext?.databaseName, aiActiveContext?.pgDatabaseName)
  }

  const refreshAfterAgentChange = (): void => {
    if (aiActiveContext?.connectionId) {
      if (aiActiveContext.pgDatabaseName) {
        refreshDatabaseNode(aiActiveContext.connectionId, aiActiveContext.pgDatabaseName)
      } else if (aiActiveContext.databaseName) {
        refreshDatabaseNode(aiActiveContext.connectionId, aiActiveContext.databaseName)
      } else {
        refreshConnectionNode(aiActiveContext.connectionId)
      }
    }

    const activePreview = workspaceTabs.find((tab) => tab.key === activeTabKey && tab.kind === 'preview' && tab.connectionId && tab.tableName)
    if (activePreview?.connectionId && activePreview.tableName) {
      void previewTable(activePreview.connectionId, activePreview.tableName, activePreview.databaseName, activePreview.pgDatabaseName, activePreview.limit, activePreview.page, activePreview.where)
    }
  }

  const changeTabLimit = async (tab: WorkspaceTab, limit: number): Promise<void> => {
    updateWorkspaceTab(tab.key, { limit, page: 1 })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, limit, page: 1 })
      return
    }

    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      await previewRedisDatabase(tab.connectionId, tab.databaseName, limit, 1)
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(tab.connectionId, tab.tableName, tab.databaseName, tab.pgDatabaseName, limit, 1, tab.where)
    }
  }

  const changeTabPage = async (tab: WorkspaceTab, page: number): Promise<void> => {
    const nextPage = Math.max(1, page)
    updateWorkspaceTab(tab.key, { page: nextPage })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, page: nextPage })
      return
    }

    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      await previewRedisDatabase(tab.connectionId, tab.databaseName, tab.limit ?? REDIS_DEFAULT_LIMIT, nextPage)
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(tab.connectionId, tab.tableName, tab.databaseName, tab.pgDatabaseName, tab.limit ?? PREVIEW_DEFAULT_LIMIT, nextPage, tab.where)
    }
  }

  const runQuery = async (tab: WorkspaceTab, selectedSql?: string): Promise<void> => {
    const sqlToExecute = selectedSql?.trim() || tab.sql

    if (!tab.connectionId) {
      return
    }

    if (!ensureConnectionOpen(tab.connectionId)) {
      return
    }

    const connection = getConnection(tab.connectionId)

    if ((isDatabaseScopedType(connection?.database_type)) && !tab.databaseName) {
      return
    }

    if (connection?.database_type === 'postgresql' && !tab.pgDatabaseName) {
      return
    }

    if (connection?.database_type === 'postgresql' && !tab.databaseName) {
      return
    }

    updateWorkspaceTab(tab.key, { loading: true, error: undefined })

    try {
      const connection = getConnection(tab.connectionId)
      const result = await requestJson<QueryResponse>('/query', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: tab.connectionId,
          sql: sqlToExecute,
          limit: tab.limit ?? QUERY_DEFAULT_LIMIT,
          offset: Math.max(0, (tab.page ?? 1) - 1) * (tab.limit ?? QUERY_DEFAULT_LIMIT),
          database: connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'mongodb' || connection?.database_type === 'redis' || connection?.database_type === 'clickhouse' ? (tab.databaseName || undefined) : undefined,
          pg_database: connection?.database_type === 'postgresql' ? (tab.pgDatabaseName || undefined) : undefined
        })
      })
      updateWorkspaceTab(tab.key, { result, page: tab.page ?? 1, selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '查询失败' })
      showError(err instanceof Error ? err.message : '查询失败')
    }
  }

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
      window.api.onUpdateDownloadProgress(setUpdateProgress),
      window.api.onUpdateDownloaded((info) => {
        setDownloadingUpdate(false)
        setUpdateInfo(info)
        setUpdateProgress((current) => ({ percent: 100, transferred: current?.transferred ?? 0, total: current?.total }))
        setUpdateModalOpen(true)
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

    void checkHealth()
    void loadConnections().catch(() => undefined)
  }, [backendStatus.state, backendStatus.apiBaseUrl])

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
  const backendStatusIcon = backendReady ? <CheckCircleOutlined /> : <CloseCircleOutlined />
  const activeTab = workspaceTabs.find((tab) => tab.key === activeTabKey)
  const activeAIConnection = getConnection(aiActiveContext?.connectionId)
  const aiContextConnection = activeAIConnection?.is_open ? activeAIConnection : undefined
  const aiDatabase = aiContextConnection?.database_type === 'postgresql'
    ? aiActiveContext?.databaseName
    : aiActiveContext?.databaseName
  const aiPgDatabase = aiContextConnection?.database_type === 'postgresql' && aiContextConnection
    ? aiActiveContext?.pgDatabaseName
    : undefined
  const aiDbName = aiContextConnection?.database_type === 'postgresql'
    ? [aiPgDatabase, aiDatabase].filter(Boolean).join('.')
    : aiDatabase
  const primaryAIContextSource: AIContextSource | undefined = aiContextConnection && aiDbName
    ? {
        id: contextSourceId({
          type: aiContextConnection.database_type === 'postgresql' && aiDatabase ? 'schema' : 'database',
          connectionId: aiContextConnection.connection_id,
          database: aiContextConnection.database_type === 'postgresql' ? aiPgDatabase : aiDatabase,
          schema: aiContextConnection.database_type === 'postgresql' ? aiDatabase : undefined,
          pgDatabase: aiContextConnection.database_type === 'postgresql' ? aiPgDatabase : undefined
        }),
        type: aiContextConnection.database_type === 'postgresql' && aiDatabase ? 'schema' : 'database',
        connectionId: aiContextConnection.connection_id,
        connectionName: aiContextConnection.name,
        dbType: aiContextConnection.database_type,
        database: aiContextConnection.database_type === 'postgresql' ? aiPgDatabase : aiDatabase,
        schema: aiContextConnection.database_type === 'postgresql' ? aiDatabase : undefined,
        pgDatabase: aiContextConnection.database_type === 'postgresql' ? aiPgDatabase : undefined
      }
    : undefined
  const effectiveAIContextSources = primaryAIContextSource
    ? [primaryAIContextSource, ...aiContextSources.filter((source) => source.id !== primaryAIContextSource.id)]
    : aiContextSources
  const focusedConnection = getConnection(focusedTreeNode?.connectionId)
  const focusedResource = focusedTreeNode
    ? {
        kind: focusedTreeNode.kind,
        connectionId: focusedTreeNode.connectionId,
        connectionName: focusedConnection?.name,
        dbType: focusedConnection?.database_type,
        database: focusedConnection?.database_type === 'postgresql' ? focusedTreeNode.pgDatabaseName : focusedTreeNode.databaseName,
        schema: focusedConnection?.database_type === 'postgresql' ? focusedTreeNode.databaseName : undefined,
        pgDatabase: focusedTreeNode.pgDatabaseName,
        table: focusedTreeNode.tableName,
        objectType: focusedTreeNode.objectType,
        name: String(focusedTreeNode.title ?? focusedTreeNode.tableName ?? focusedTreeNode.databaseName ?? focusedConnection?.name ?? ''),
        sizeDisplay: focusedTreeNode.sizeDisplay,
        rowCount: focusedTreeNode.rowCount
      }
    : undefined
  const connectionSummaries = connections.map((connection) => ({
    connectionId: connection.connection_id,
    name: connection.name,
    dbType: connection.database_type,
    database: connection.database,
    isOpen: connection.is_open,
    serverVersion: connection.server_version
  }))

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
          Modal: {
            contentBg: theme === 'dark' ? '#363a42' : '#ffffff',
            headerBg: theme === 'dark' ? '#363a42' : '#ffffff',
            footerBg: theme === 'dark' ? '#363a42' : '#ffffff'
          }
        }
      }}
    >
      <Layout className="app-shell">
      {contextHolder}
      <Layout.Header className="app-header">
        <Flex align="center" justify="space-between" className="app-toolbar">
          <Space size="middle">
            <div className="brand-mark"><img src={appIcon} alt="" /></div>
            <Typography.Title level={4} className="brand-title">DataDjinn</Typography.Title>
          </Space>
          <div className="titlebar-spacer" />
          <Space className="toolbar-actions titlebar-no-drag" size={4}>
            <Button type="text" size="small" icon={<FileAddOutlined />} onClick={() => openQueryWorkspace()} title="新建查询" aria-label="新建查询" />
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => openSettings('app')} title="设置" aria-label="设置" />
            <Button type={updateInfo?.available || downloadingUpdate ? 'primary' : 'text'} size="small" icon={<CloudDownloadOutlined />} loading={checkingUpdate} onClick={() => { setUpdateModalOpen(true); if (!downloadingUpdate) { void checkForUpdates(true) } }} title="检查更新" aria-label="检查更新" />
            <Button type="text" size="small" icon={<ReloadOutlined />} loading={healthLoading} onClick={() => void checkHealth()} title="同步状态" aria-label="同步状态" />
            <Button type={aiPanelOpen ? 'primary' : 'text'} size="small" icon={<MessageOutlined />} onClick={() => setAiPanelOpen((open) => !open)} title={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} aria-label={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} />
            <Button className="theme-toggle-btn" type="text" size="small" icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} />
            <Tag className="service-pill" icon={backendStatusIcon} color={BACKEND_COLORS[backendStatus.state]} title={backendStatus.message}>{BACKEND_LABELS[backendStatus.state]}</Tag>
          </Space>
          <Space className="window-controls titlebar-no-drag" size={0}>
            <Button type="text" icon={<MinusOutlined />} onClick={() => void window.api.minimizeWindow()} title="最小化" aria-label="最小化" />
            <Button type="text" icon={<BorderOutlined />} onClick={() => void window.api.toggleMaximizeWindow()} title="最大化" aria-label="最大化" />
            <Button type="text" danger icon={<CloseCircleOutlined />} onClick={() => void window.api.closeWindow()} title="关闭" aria-label="关闭" />
          </Space>
        </Flex>
      </Layout.Header>
      <Layout.Content className="app-content">
        <Splitter className="workspace" onResize={(sizes) => setResourcePanelSize(sizes[0] as number)}>
          <Splitter.Panel size={resourcePanelSize} min={220} max={500} className="resource-panel">
            <div className="resource-header">
              <Space direction="vertical" size={2}>
                <Typography.Text className="panel-kicker">DATABASE EXPLORER</Typography.Text>
                <Typography.Title level={5} className="panel-title">数据资产</Typography.Title>
              </Space>
              <Dropdown menu={connectionCreateMenu} trigger={['click']}>
                <Button className="resource-add" type="primary" size="small" icon={<PlusOutlined />}>新建</Button>
              </Dropdown>
            </div>
            <div className="connection-summary-grid">
              <div className="summary-card"><span>{connections.length}</span><small>连接</small></div>
              <div className="summary-card accent"><span>{workspaceTabs.length}</span><small>工作页</small></div>
            </div>
            <div className="resource-tree-shell">
              <div className="resource-tree-viewport">
                {connections.length === 0 ? (
                  <Alert message="暂无数据库连接" description="先创建一个 SQLite 或 MySQL 连接。" type="info" showIcon />
                ) : (
                  <Tree
                    showIcon
                    blockNode
                    virtual={false}
                    motion={null}
                    treeData={treeData}
                    expandedKeys={expandedKeys}
                    onExpand={(keys, info) => {
                      const node = info.node as DatabaseTreeNode
                      if (!info.expanded) {
                        collapseTreeNode(node)
                        return
                      }
                      startTransition(() => {
                        setExpandedKeys(keys)
                      })
                      if (!isTreeNodeChildrenLoaded(node) && isLoadableTreeNode(node)) {
                        void reloadNodeChildren({ ...node, isLeaf: false }, false)
                      }
                    }}
                    titleRender={(node) => renderTreeTitle(node as DatabaseTreeNode)}
                    selectedKeys={selectedConnectionId ? [`connection:${selectedConnectionId}`] : []}
                    onSelect={(_, info) => {
                      const node = info.node as DatabaseTreeNode
                      setFocusedTreeNode(node)
                      if (node.connectionId) {
                        setSelectedConnectionId(node.connectionId)
                      }
                    }}
                    onRightClick={({ node, event }) => {
                      event.preventDefault()
                      const treeNode = node as DatabaseTreeNode
                      const items = getTreeContextMenuItems(treeNode)
                      if (!items || items.length === 0) {
                        return
                      }
                      setFocusedTreeNode(treeNode)
                      if (treeNode.connectionId) {
                        setSelectedConnectionId(treeNode.connectionId)
                      }
                      setTreeContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        node: treeNode
                      })
                    }}
                    onDoubleClick={(_, node) => {
                      const treeNode = node as DatabaseTreeNode
                      setFocusedTreeNode(treeNode)
                      if (treeNode.kind === 'database' || treeNode.kind === 'pg-schema') {
                        activateAIContextFromNode(treeNode)
                      }
                      if (treeNode.kind === 'database' && treeNode.connectionId && treeNode.databaseName && getConnection(treeNode.connectionId)?.database_type === 'redis') {
                        activateAIContextFromNode(treeNode)
                        void openRedisDatabaseBrowser(treeNode.connectionId, treeNode.databaseName)
                        return
                      }
                      if ((treeNode.kind === 'table' || treeNode.kind === 'db-object') && treeNode.connectionId && treeNode.tableName && (treeNode.objectType === 'table' || treeNode.objectType === 'view')) {
                        activateAIContextFromNode(treeNode)
                        const connection = getConnection(treeNode.connectionId)
                        if (connection?.database_type === 'redis') {
                          void openRedisDatabaseBrowser(treeNode.connectionId, treeNode.databaseName ?? getDefaultDatabaseName(connection) ?? 'db0')
                        } else {
                          void previewTable(treeNode.connectionId, treeNode.tableName, treeNode.databaseName, treeNode.pgDatabaseName)
                        }
                        return
                      }
                      if (treeNode.kind === 'connection' && treeNode.connectionId) {
                        const conn = getConnection(treeNode.connectionId)
                        if (conn && !conn.is_open) {
                          void openConnectionById(treeNode.connectionId)
                          return
                        }
                      }
                      toggleOrLoadTreeNode(treeNode)
                    }}
                  />
                )}
              </div>
              {treeContextMenu && (
                <div className="tree-context-menu-backdrop" onMouseDown={() => setTreeContextMenu(null)}>
                  <div
                    className="tree-context-menu-panel"
                    style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <Menu items={getTreeContextMenuItems(treeContextMenu.node)} onClick={handleTreeContextMenuClick} />
                  </div>
                </div>
              )}
            </div>
          </Splitter.Panel>
          <Splitter.Panel>
            <div className="main-panel">
              <Splitter className="studio-shell" onResize={(sizes) => {
                if (aiPanelOpen) {
                  setAiPanelSize(sizes[1] as number)
                }
              }}>
                <Splitter.Panel>
                  <div className="editor-placeholder">
                    {workspaceTabs.length === 0 ? (
                      <div className="empty-workspace"><FileAddOutlined /><Typography.Text type="secondary">连接数据库后，可以浏览库表结构、预览数据、编写 SQL，并让 Djinn Agent 辅助分析与执行受控操作。</Typography.Text><Space><Dropdown menu={connectionCreateMenu} trigger={['click']}><Button icon={<PlusOutlined />}>创建连接</Button></Dropdown></Space></div>
                    ) : (
                      <Tabs className="workspace-tabs" type="editable-card" hideAdd destroyOnHidden activeKey={activeTabKey} onChange={setActiveTabKey} onEdit={(targetKey, action) => { if (action === 'remove' && typeof targetKey === 'string') { closeWorkspaceTab(targetKey) } }} items={workspaceTabs.map((tab) => ({ key: tab.key, label: tab.title, closable: true, children: tab.key === activeTabKey ? renderWorkspaceTab(tab) : null }))} />
                    )}
                  </div>
                </Splitter.Panel>
                {aiPanelOpen && (
                  <Splitter.Panel size={aiPanelSize} min={260} max={720} className="ai-dock-panel">
                    <AIPanel
                      requestJson={requestJson}
                      connectionContext={{
                        connectionId: aiContextConnection?.is_open ? aiContextConnection.connection_id : undefined,
                        dbType: aiContextConnection?.database_type,
                        dbName: aiDbName,
                        database: aiDatabase,
                        pgDatabase: aiPgDatabase,
                        connectionName: aiContextConnection?.name,
                        serverVersion: aiContextConnection?.server_version
                      }}
                      workspace={{
                        active_sql: activeTab?.sql,
                        active_tab_kind: activeTab?.kind,
                        selected_table: activeTab?.tableName,
                        current_connection_name: aiContextConnection?.name,
                        current_db_type: aiContextConnection?.database_type,
                        current_server_version: aiContextConnection?.server_version,
                        current_database: aiDatabase,
                        current_pg_database: aiPgDatabase,
                        focused_resource: focusedResource,
                        connections: connectionSummaries,
                        recent_queries: workspaceTabs.filter((tab) => tab.kind === 'query' && tab.sql.trim()).slice(-5).map((tab) => tab.sql),
                        visible_result_columns: activeTab?.result?.columns ?? [],
                        visible_result_sample: activeTab?.result?.rows.slice(0, 5) ?? [],
                        context_sources: effectiveAIContextSources
                      }}
                      contextSources={effectiveAIContextSources}
                      primaryContextSourceId={primaryAIContextSource?.id}
                      onRemoveContextSource={removeAIContextSource}
                      onWorkspaceAction={(action: AIWorkspaceAction) => {
                        if (action.type === 'append_query_sql') {
                          appendSqlToQueryWorkspace(action.sql, action.title)
                        }
                      }}
                      onAgentDataChanged={refreshAfterAgentChange}
                    />
                  </Splitter.Panel>
                )}
              </Splitter>
            </div>
          </Splitter.Panel>
        </Splitter>
      </Layout.Content>
      <Modal title="应用更新" open={updateModalOpen} onCancel={() => setUpdateModalOpen(false)} footer={null} width={680} maskClosable={false}>
        <Space direction="vertical" className="full-width" size="middle">
          <Alert
            type={updateInfo?.available ? 'info' : 'success'}
            showIcon
            message={updateStatusMessage}
            description={updateMode === 'installer' ? '安装版支持自动下载，并在重启后安装更新。' : '绿色版支持检测并下载新版 zip，下载后需要关闭应用并手动解压替换。'}
          />
          <Flex justify="space-between" align="center">
            <Typography.Text>当前版本：{updateSettings?.currentVersion ?? updateInfo?.currentVersion ?? '-'}</Typography.Text>
            <Tag color={updateMode === 'installer' ? 'blue' : 'purple'}>{updateMode === 'installer' ? '安装版' : '绿色版'}</Tag>
          </Flex>
          {updateInfo?.latestVersion && <Typography.Text>最新版本：{updateInfo.latestVersion}</Typography.Text>}
          <Flex justify="space-between" align="center">
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
            <Alert type="success" showIcon message="绿色版更新包已下载" description={`文件位置：${updateInfo.downloadedPath}。请关闭应用后手动解压替换旧目录。`} />
          )}
          <Flex justify="end" gap={8} wrap="wrap">
            <Button onClick={() => void checkForUpdates(true)} loading={checkingUpdate}>重新检查</Button>
            {updateInfo?.releaseUrl && <Button onClick={() => void window.api.openReleasePage(updateInfo.releaseUrl)}>查看发布页</Button>}
            {updateInfo?.available && <Button onClick={() => void skipUpdate()}>跳过此版本</Button>}
            {updateInfo?.available && !updateDownloaded && <Button type="primary" loading={downloadingUpdate} onClick={() => void downloadUpdate()}>{updateActionText}</Button>}
            {updateDownloaded && <Button type="primary" onClick={() => void installUpdate()}>{updateMode === 'installer' ? '重启并安装' : '打开下载位置'}</Button>}
          </Flex>
        </Space>
      </Modal>
      <Modal title="设置" open={driverManagerOpen} footer={null} onCancel={() => setDriverManagerOpen(false)} width={980} maskClosable={false}>
        <Flex gap={18} align="stretch" className="settings-layout">
          <div className="settings-sidebar">
            <Menu
              mode="inline"
              selectedKeys={[settingsSection]}
              onClick={({ key }) => switchSettingsSection(key as SettingsSection)}
              items={[
                { key: 'app', icon: <SettingOutlined />, label: '应用' },
                { key: 'drivers', icon: <DatabaseOutlined />, label: '驱动管理' }
              ]}
            />
          </div>
          <div className="settings-content">
            {settingsSection === 'app' ? (
              <Space direction="vertical" className="full-width" size="large">
                <div className="settings-about-card">
                  <img className="settings-about-logo" src={appLogoHorizontal} alt="DataDjinn" />
                  <Typography.Text type="secondary">当前版本：{appInfo?.version ?? updateSettings?.currentVersion ?? '-'}</Typography.Text>
                </div>
                <Button icon={<GithubOutlined />} onClick={() => void window.api.openProjectHome()}>
                  GitHub
                </Button>
              </Space>
            ) : (
              <Space direction="vertical" className="full-width" size="middle">
                <Space direction="vertical" className="full-width" size="small">
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
                <Flex justify="space-between" align="center">
                  <Typography.Title level={5} style={{ margin: 0 }}>数据库驱动</Typography.Title>
                  <Button loading={driversLoading} onClick={() => void loadDrivers()}>刷新</Button>
                </Flex>
                <Table<DriverInfo>
                  size="small"
                  rowKey="id"
                  loading={driversLoading}
                  pagination={false}
                  tableLayout="fixed"
                  scroll={{ x: 980 }}
                  dataSource={drivers}
                  columns={[
                    { title: '数据库', dataIndex: 'database_type', width: 100, render: (value: DriverDatabaseType) => value === 'dm' ? '达梦' : '高斯' },
                    { title: '名称', dataIndex: 'name', width: 160, ellipsis: true, render: (value: string) => <Typography.Text ellipsis title={value}>{value}</Typography.Text> },
                    { title: '类型', dataIndex: 'driver_type', width: 120, render: (value: DriverInfo['driver_type']) => driverTypeLabel(value) },
                    { title: '来源', dataIndex: 'source', width: 90, render: () => '手动添加' },
                    { title: '驱动文件', width: 330, ellipsis: true, render: (_: unknown, driver) => <Typography.Text ellipsis title={driver.path ?? undefined}>{driver.path}</Typography.Text> },
                    { title: '状态', dataIndex: 'enabled', width: 80, render: (value: boolean) => value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag> },
                    { title: '操作', width: 150, fixed: 'right', render: (_: unknown, driver) => <Space size={4} wrap={false}><Button size="small" onClick={() => void testDriver(driver)}>测试</Button><Button danger size="small" onClick={() => void deleteDriver(driver)}>删除</Button></Space> }
                  ]}
                />
                <Form form={driverForm} layout="vertical" initialValues={{ database_type: 'dm', driver_type: 'jdbc', enabled: true }}>
                  <Form.Item name="database_type" label="数据库类型" rules={[{ required: true, message: '请选择数据库类型' }]}>
                    <Select
                      options={[{ label: '达梦 DM', value: 'dm' }, { label: '高斯数据库（预留）', value: 'gaussdb' }]}
                      onChange={(value: DriverDatabaseType) => {
                        if (value === 'gaussdb') {
                          driverForm.setFieldValue('driver_type', 'jdbc')
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item name="driver_type" label="添加驱动类型" rules={[{ required: true, message: '请选择驱动类型' }]}>
                    <Select options={driverDatabaseType === 'gaussdb' ? [{ label: 'JDBC jar 驱动', value: 'jdbc' }] : [{ label: 'JDBC jar 驱动', value: 'jdbc' }, { label: 'dmPython pyd 驱动', value: 'python' }, { label: 'dmPython whl 驱动', value: 'whl' }]} />
                  </Form.Item>
                  {driverDatabaseType === 'gaussdb' && <Alert type="warning" showIcon message="高斯数据库驱动当前仅保存配置，连接功能后续接入。" />}
                  <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
                    <Input placeholder={driverDatabaseType === 'gaussdb' ? '例如：高斯 JDBC' : '例如：达梦 JDBC / 本机 dmPython'} />
                  </Form.Item>
                  <Form.Item
                    name="path"
                    label={driverType === 'python' ? 'dmPython pyd 文件' : driverType === 'whl' ? 'dmPython whl 文件' : 'JDBC jar 文件'}
                    rules={[{ required: true, message: driverType === 'python' ? '请选择 dmPython pyd 文件' : driverType === 'whl' ? '请选择 dmPython whl 文件' : '请选择 JDBC jar 文件' }]}
                  >
                    <Input readOnly placeholder={driverType === 'python' ? '请选择 dmPython.pyd' : driverType === 'whl' ? '请选择 dmPython whl 文件' : driverDatabaseType === 'gaussdb' ? '请选择高斯 JDBC jar' : '请选择 DmJdbcDriver.jar'} addonAfter={<Button type="link" size="small" onClick={() => void selectDriverFile()}>选择</Button>} />
                  </Form.Item>
                  <Button type="primary" loading={driverSaving} onClick={() => void addDriver()}>添加驱动</Button>
                </Form>
              </Space>
            )}
          </div>
        </Flex>
      </Modal>
      <Modal title={editingTableName ? `修改表：${editingTableName}` : '修改表'} open={tableEditorOpen} okText="保存" cancelText="取消" confirmLoading={tableEditorLoading} onOk={() => void saveTableEditor()} onCancel={() => setTableEditorOpen(false)} width={980} okButtonProps={{ disabled: !tableDesignerSupportsEdit(getConnection(editingConnectionId)?.database_type) }} maskClosable={false}>
        {renderTableDesigner('edit', editingConnectionId, editingDatabaseName, editingPgDatabaseName, editingTableName ?? '', undefined, editingTableComment, setEditingTableComment, editingColumns, tableEditorLoading)}
      </Modal>
      <Modal title={creatingSchemaDatabaseName ? '新建 Schema' : '新增数据库'} open={databaseCreateModalOpen} okText="创建" cancelText="取消" confirmLoading={databaseCreateLoading} onOk={() => void createDatabase()} onCancel={() => { setDatabaseCreateModalOpen(false); setCreatingSchemaDatabaseName('') }} okButtonProps={{ disabled: !databaseCreateName.trim() }} maskClosable={false}>
        <Form layout="vertical">
          <Form.Item label={creatingSchemaDatabaseName ? 'Schema 名称' : '数据库名称'} required>
            <Input placeholder={creatingSchemaDatabaseName ? '请输入 Schema 名称' : '请输入数据库名称'} value={databaseCreateName} onChange={(event) => setDatabaseCreateName(event.target.value)} onPressEnter={() => void createDatabase()} />
          </Form.Item>
          <Typography.Text type="secondary">仅允许字母、数字、下划线，首字符不能是数字，长度 1-64。</Typography.Text>
        </Form>
      </Modal>
      <Modal title="运行 SQL 文件" open={sqlFileModalOpen} okText="执行" cancelText="取消" confirmLoading={sqlFileLoading} onOk={() => void runSqlFile()} onCancel={() => setSqlFileModalOpen(false)} okButtonProps={{ danger: true, disabled: sqlFileDatabases.length > 0 && !sqlFileDatabase }} footer={sqlFileResult ? undefined : (_, { OkBtn, CancelBtn }) => (<Space><CancelBtn /><OkBtn /></Space>)} maskClosable={false}>
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
              <Form.Item label={getConnection(sqlFileConnectionId)?.database_type === 'postgresql' ? '目标 Schema' : '目标数据库'} required={sqlFileDatabases.length > 0} rules={sqlFileDatabases.length > 0 ? [{ required: true, message: getConnection(sqlFileConnectionId)?.database_type === 'postgresql' ? '请选择目标 Schema' : '请选择目标数据库' }] : undefined}>
                {sqlFileDatabases.length > 0 ? (<Select placeholder={getConnection(sqlFileConnectionId)?.database_type === 'postgresql' ? '请选择目标 Schema' : '请选择目标数据库'} value={sqlFileDatabase || undefined} onChange={(value) => setSqlFileDatabase(value)} options={sqlFileDatabases.map((db) => ({ label: db.name, value: db.name }))} />) : (<Input placeholder="留空则使用连接默认数据库" value={sqlFileDatabase} onChange={(event) => setSqlFileDatabase(event.target.value)} />)}
              </Form.Item>
            </Form>
          </Space>
        )}
      </Modal>
      <Modal title={ddlModalTitle || '查看 DDL'} open={ddlModalOpen} footer={null} onCancel={() => setDdlModalOpen(false)} width={820} centered maskClosable={false}>
        <Input.TextArea value={ddlLoading ? '加载中...' : ddlContent} autoSize={{ minRows: 12, maxRows: 24 }} readOnly />
      </Modal>
      <Modal title={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '新建集合' : '新建表'} open={createTableModalOpen} okText="创建" cancelText="取消" confirmLoading={createTableLoading} onOk={() => void createTable()} onCancel={() => setCreateTableModalOpen(false)} width={980} okButtonProps={{ disabled: !newTableName.trim() || (getConnection(createTableConnectionId)?.database_type !== 'mongodb' && newTableColumns.filter((c) => c.name.trim()).length === 0) }} maskClosable={false}>
        {renderTableDesigner('create', createTableConnectionId, createTableDatabaseName, createTablePgDatabaseName || undefined, newTableName, setNewTableName, newTableComment, setNewTableComment, newTableColumns, createTableLoading)}
      </Modal>
      <Modal title={connectionMode === 'edit' ? '编辑数据库连接' : '保存数据库连接'} open={connectionModalOpen} okText={connectionMode === 'edit' ? '保存修改' : '保存连接'} cancelText="取消" confirmLoading={connectionLoading} onOk={() => void saveConnection()} onCancel={() => setConnectionModalOpen(false)} footer={(_, { OkBtn, CancelBtn }) => (<Space><Button loading={testingConnection} onClick={() => void testConnection()}>测试连接</Button><CancelBtn /><OkBtn /></Space>)} maskClosable={false}>
        <Form form={form} layout="vertical" initialValues={{ database_type: 'sqlite' }}>
          <Form.Item name="name" label="连接名称" rules={[{ required: true, message: '请输入连接名称' }]}><Input placeholder="例如：本地 SQLite" /></Form.Item>
          <Form.Item name="database_type" style={{ display: 'none' }}><Input /></Form.Item>
          {databaseType === 'sqlite' ? (
            <Form.Item name="sqlite_path" label="SQLite 文件路径" rules={[{ required: true, message: '请输入 SQLite 文件路径' }]}><Input placeholder="data/datadjinn.sqlite" /></Form.Item>
          ) : (
            <>
              <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机' }]}><Input placeholder="127.0.0.1" /></Form.Item>
              <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}><InputNumber min={1} max={65535} className="full-width" placeholder={databaseType === 'postgresql' ? '5432' : databaseType === 'dm' ? '5236' : databaseType === 'mongodb' ? '27017' : databaseType === 'redis' ? '6379' : databaseType === 'clickhouse' ? '8123' : '3306'} /></Form.Item>
              <Form.Item name="username" label="用户名" rules={databaseType === 'mongodb' || databaseType === 'redis' ? undefined : [{ required: true, message: '请输入用户名' }]}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'dm' ? 'SYSDBA' : databaseType === 'redis' ? 'Redis ACL 用户名，可选' : databaseType === 'clickhouse' ? 'default' : undefined} /></Form.Item>
              <Form.Item name="password" label="密码"><Input.Password /></Form.Item>
              <Form.Item name="database" label={databaseType === 'postgresql' ? '数据库名' : databaseType === 'dm' ? '默认 Schema（可选）' : databaseType === 'mongodb' ? '认证库/默认库（可选）' : databaseType === 'redis' ? '默认 DB 序号（可选）' : databaseType === 'clickhouse' ? '默认数据库' : '默认数据库（可选）'} rules={databaseType === 'postgresql' ? [{ required: true, message: '请输入数据库名' }] : undefined}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'dm' ? '不填则使用默认 Schema' : databaseType === 'mongodb' ? '默认 admin，也可填业务库名' : databaseType === 'redis' ? '默认 0，例如 0、1、2' : databaseType === 'clickhouse' ? '默认 default' : '不填则连接服务器并加载全部数据库'} /></Form.Item>
              {databaseType === 'dm' && (
                <>
                  <Form.Item name="dm_driver_id" label="达梦驱动" rules={[{ required: true, message: '请选择达梦驱动' }]}>
                    <Select
                      loading={driversLoading}
                      placeholder="请选择已添加的达梦驱动"
                      options={dmDriverOptions}
                      notFoundContent="暂无可用达梦驱动"
                    />
                  </Form.Item>
                  <Alert
                    type={selectedDmDriver ? 'info' : 'warning'}
                    showIcon
                    message={selectedDmDriver ? `当前选择：${driverTypeLabel(selectedDmDriver.driver_type)} - ${selectedDmDriver.name}` : '未选择达梦驱动，请先在驱动管理中添加并选择 JDBC jar、dmPython pyd 或 dmPython whl 驱动'}
                    action={<Button size="small" onClick={openDriverManager}>驱动管理</Button>}
                  />
                </>
              )}
            </>
          )}
        </Form>
      </Modal>
      <Modal title="备份" open={backupRestoreModalOpen} okText="选择路径并备份" cancelText="取消" confirmLoading={backupRestoreLoading} onOk={() => void runBackup()} onCancel={() => setBackupRestoreModalOpen(false)} maskClosable={false}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(backupRestoreConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>数据库：</Typography.Text>{backupRestorePgDatabase || backupRestoreDatabase || '默认'}</Typography.Text>
          <Alert type="info" message="备份会生成 SQL 脚本，包含建表语句和数据，可随时通过导入功能恢复。" showIcon />
        </Space>
      </Modal>
      <Modal title="导出" open={exportModalOpen} okText="选择路径并导出" cancelText="取消" confirmLoading={exportLoading} onOk={() => void runExport()} onCancel={() => setExportModalOpen(false)} maskClosable={false}>
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
      <Modal title="导入" open={importModalOpen} okText="导入" cancelText="取消" confirmLoading={importLoading} onOk={() => void runImport()} onCancel={() => setImportModalOpen(false)} okButtonProps={{ disabled: !importPath }} maskClosable={false}>
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


