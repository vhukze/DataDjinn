import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  FilterOutlined,
  FunctionOutlined,
  MessageOutlined,
  EditOutlined,
  DeleteOutlined,
  BorderOutlined,
  EyeOutlined,
  MinusOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  PlusOutlined,
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
  Button,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Layout,
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
import type { ColumnsType } from 'antd/es/table'
import type { DataNode } from 'antd/es/tree'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from './context/ThemeContext'
import AIPanel from './components/AIPanel'
import SqlEditor from './components/SqlEditor'
import type { SqlCompletionColumn, SqlCompletionContext, SqlCompletionTable } from './components/SqlEditor'
import mysqlIcon from './assets/icons/mysql.png'
import postgresIcon from './assets/icons/postgres.png'
import sqliteIcon from './assets/icons/sqllite.png'
import dmIcon from './assets/icons/dm.svg'
import mongoIcon from './assets/icons/mongo.png'
import appIcon from '../../../resources/icon.svg'

type BackendStatus = {
  state: 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
}

const BACKEND_LABELS: Record<BackendStatus['state'], string> = {
  starting: 'Backend Starting',
  online: 'Backend Online',
  failed: 'Backend Failed',
  stopped: 'Backend Stopped',
  crashed: 'Backend Crashed'
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

const defaultSelectedDatabases = (connection: ConnectionInfo, available: string[]): string[] => {
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

type DatabaseType = 'sqlite' | 'mysql' | 'postgresql' | 'dm' | 'mongodb'
type WorkspaceTabKind = 'preview' | 'query'

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

type DriverInfo = {
  id: string
  database_type: 'dm'
  driver_type: 'jdbc' | 'python' | 'whl'
  name: string
  source: 'auto' | 'manual'
  enabled: boolean
  path?: string | null
}

type DriverFormValues = {
  database_type: 'dm'
  driver_type: 'jdbc' | 'python' | 'whl'
  name: string
  path?: string
  enabled: boolean
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
  downloadedPath?: string
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
}

type QueryResponse = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  limited: boolean
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

type ColumnFilterOption = {
  value: string
  label: string
  count: number
}

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
}

type ColumnDef = {
  key: string
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

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

const DB_OBJECT_TYPES_BY_DATABASE: Record<DatabaseType, DbObjectType[]> = {
  sqlite: ['table', 'view', 'trigger', 'index'],
  mysql: ['table', 'view', 'trigger', 'procedure', 'function', 'index'],
  postgresql: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  dm: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  mongodb: ['table']
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

const tableFilterValueKey = (value: unknown): string => value === null || value === undefined ? '__DATADJINN_NULL__' : String(value)

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
  const [queryCounter, setQueryCounter] = useState(1)
  const [tableEditorOpen, setTableEditorOpen] = useState(false)
  const [tableEditorLoading, setTableEditorLoading] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<string>()
  const [editingDatabaseName, setEditingDatabaseName] = useState<string>()
  const [editingTableName, setEditingTableName] = useState<string>()
  const [editingColumns, setEditingColumns] = useState<ColumnInfo[]>([])
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
  const [exportFormat, setExportFormat] = useState<'sql' | 'csv'>('sql')
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
  const [newTableColumns, setNewTableColumns] = useState<ColumnDef[]>([])
  const [driverManagerOpen, setDriverManagerOpen] = useState(false)
  const [updateModalOpen, setUpdateModalOpen] = useState(false)
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [downloadingUpdate, setDownloadingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [drivers, setDrivers] = useState<DriverInfo[]>([])
  const dmDrivers = drivers.filter((driver) => driver.database_type === 'dm' && driver.enabled)
  const selectedDmDriverId = Form.useWatch('dm_driver_id', form)
  const selectedDmDriver = dmDrivers.find((driver) => driver.id === selectedDmDriverId)
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

  const { theme, toggleTheme } = useTheme()

  const apiBaseUrl = backendStatus.apiBaseUrl

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
        messageApi.success('绿色版更新包已下载，请关闭应用后手动解压替换')
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '下载更新失败')
    } finally {
      setDownloadingUpdate(false)
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

  const requestJson = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    if (!apiBaseUrl && backendStatus.state !== 'online') {
      throw new Error('后端服务启动中，请稍候')
    }

    return window.api.requestJson<T>(path, {
      method: options?.method,
      headers: options?.headers as Record<string, string> | undefined,
      body: typeof options?.body === 'string' ? options.body : undefined
    })
  }

  const buildSqlCompletionContext = (tab: WorkspaceTab): SqlCompletionContext => {
    const connection = getConnection(tab.connectionId)
    const tables: SqlCompletionTable[] = []
    const columns: SqlCompletionColumn[] = []

    const includeNode = (node: DatabaseTreeNode): boolean => {
      if (!tab.connectionId || node.connectionId !== tab.connectionId) {
        return false
      }
      if (tab.pgDatabaseName && node.pgDatabaseName !== tab.pgDatabaseName) {
        return false
      }
      if (tab.databaseName && node.databaseName !== tab.databaseName) {
        return false
      }
      return true
    }

    const walk = (nodes: DatabaseTreeNode[]): void => {
      for (const node of nodes) {
        if (node.closed) {
          continue
        }

        if (node.kind === 'table' && node.tableName && includeNode(node)) {
          const tableColumns = ((node.children as DatabaseTreeNode[] | undefined) ?? [])
            .filter((child) => child.kind === 'column' && child.columnName)
            .map<SqlCompletionColumn>((child) => ({
              name: child.columnName!,
              type: child.columnType,
              tableName: node.tableName,
              databaseName: connection?.database_type === 'postgresql' ? node.pgDatabaseName : node.databaseName,
              schemaName: connection?.database_type === 'postgresql' ? node.databaseName : undefined,
              nullable: child.nullable,
              primaryKey: child.primaryKey
            }))

          tables.push({
            name: node.tableName,
            databaseName: connection?.database_type === 'postgresql' ? node.pgDatabaseName : node.databaseName,
            schemaName: connection?.database_type === 'postgresql' ? node.databaseName : undefined,
            columns: tableColumns
          })
          columns.push(...tableColumns)
        }

        if (node.children) {
          walk(node.children)
        }
      }
    }

    walk(treeData)

    const cacheKey = tab.connectionId && tab.databaseName ? `${tab.connectionId}:${tab.databaseName}` : ''

    if (cacheKey && completionTables[cacheKey]) {
      for (const tableName of completionTables[cacheKey]) {
        if (!tables.some((t) => t.name === tableName)) {
          tables.push({ name: tableName, databaseName: tab.databaseName })
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

  const renderConnectionTitle = (connection: ConnectionInfo): React.ReactNode => (
    <Dropdown
      trigger={['contextMenu']}
      menu={{
        items: [
          ...(connection.is_open
            ? [
                { key: 'close', label: '关闭连接', icon: <CloseCircleOutlined /> },
                { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
              ]
            : [
                { key: 'open', label: '打开连接', icon: <PlayCircleOutlined /> },
              ]),
          { key: 'edit', label: '编辑连接', icon: <EditOutlined /> },
          {
            key: 'new-database',
            label: connection.database_type === 'sqlite' ? '新增 SQLite 数据库文件' : '新建库',
            icon: <PlusOutlined />
          },
          ...(connection.database_type !== 'mongodb' ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }] : []),
          { type: 'divider' },
          { key: 'disconnect', label: '删除连接', icon: <DeleteOutlined />, danger: true }
        ],
        onClick: ({ key }) => {
          if (key === 'open') {
            void openConnectionById(connection.connection_id)
          }
          if (key === 'close') {
            void closeConnectionById(connection.connection_id)
          }
          if (key === 'refresh') {
            refreshConnectionNode(connection.connection_id)
          }
          if (key === 'edit') {
            void openEditConnectionModal(connection)
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
          if (key === 'disconnect') {
            void deleteConnection(connection.connection_id)
          }
        }
      }}
    >
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
    </Dropdown>
  )

  const buildObjectGroupNodes = (connectionId: string, databaseName?: string, pgDatabaseName?: string, databaseType?: DatabaseType): DatabaseTreeNode[] => {
    const connection = getConnection(connectionId)
    const objectTypes = DB_OBJECT_TYPES_BY_DATABASE[databaseType ?? connection?.database_type ?? 'sqlite']

    return DB_OBJECT_GROUPS.filter((group) => objectTypes.includes(group.type)).map((group) => ({
      key: `object-group:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${group.type}`,
      title: group.title,
      icon: group.icon,
      kind: 'object-group',
      connectionId,
      databaseName,
      pgDatabaseName,
      objectType: group.type,
      isLeaf: false
    }))
  }

  const buildConnectionNode = (connection: ConnectionInfo): DatabaseTreeNode => ({
    key: `connection:${connection.connection_id}`,
    title: connection.name,
    icon:
      connection.database_type === 'postgresql' ? (
        <img src={postgresIcon} alt="PG" style={{ width: 16, height: 16 }} />
      ) : connection.database_type === 'mongodb' ? (
        <img src={mongoIcon} alt="MongoDB" style={{ width: 16, height: 16 }} />
      ) : connection.database_type === 'mysql' ? (
        <img src={mysqlIcon} alt="MySQL" style={{ width: 16, height: 16 }} />
      ) : connection.database_type === 'dm' ? (
        <img src={dmIcon} alt="DM" style={{ width: 16, height: 16 }} />
      ) : (
        <img src={sqliteIcon} alt="SQLite" style={{ width: 16, height: 16 }} />
      ),
    kind: 'connection',
    connectionId: connection.connection_id,
    children: connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'mongodb' ? undefined : buildObjectGroupNodes(connection.connection_id, undefined, undefined, connection.database_type),
    className: connection.is_open ? undefined : 'tree-node-closed',
    closed: !connection.is_open,
    isLeaf: !connection.is_open
  })

  const refreshTree = (nextConnections: ConnectionInfo[]): void => {
    setTreeData(nextConnections.map(buildConnectionNode))
  }

  const refreshConnectionNode = (connectionId: string): void => {
    const connection = connections.find((c) => c.connection_id === connectionId)

    if (!connection) {
      return
    }

    if (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'mongodb') {
      const connKey = `connection:${connectionId}`
      const snapshot = expandedKeys.map(String)

      void reloadNodeChildren({
        key: connKey,
        kind: 'connection',
        connectionId,
        isLeaf: false
      }).then(async () => {
        const stillExpanded = snapshot.filter((k) => {
          if (k === connKey) return false
          if (k.startsWith(`database:${connectionId}:`)) {
            const dbName = k.slice(`database:${connectionId}:`.length).split(':')[0]
            const selected = selectedDatabasesRef.current[connectionId] ?? allDatabases[connectionId] ?? []
            return selected.includes(dbName)
          }
          return k.startsWith(`pg-schema:${connectionId}:`) || k.startsWith(`object-group:${connectionId}:`) || k.startsWith(`table:${connectionId}:`)
        })

        if (stillExpanded.length > 0) {
          setExpandedKeys((current) => Array.from(new Set([...current, ...stillExpanded])))
          await reloadExpandedDescendants(connectionId, stillExpanded)
        }
      })
    } else {
      setTreeData((current) =>
        current.map((node) => {
          if (node.key === `connection:${connectionId}`) {
            return { ...node, children: buildConnectionNode(connection).children }
          }

          return node
        })
      )
    }
  }

  const refreshDatabaseNode = (connectionId: string, databaseName: string): void => {
    void reloadNodeChildren({
      key: `database:${connectionId}:${databaseName}`,
      kind: 'database',
      connectionId,
      databaseName,
      isLeaf: false
    })
  }

  const replaceConnectionNode = (nodes: DatabaseTreeNode[], connection: ConnectionInfo, preserveChildren?: boolean): DatabaseTreeNode[] =>
    nodes.map((node) => {
      if (node.key !== `connection:${connection.connection_id}`) {
        return node
      }

      const nextNode = buildConnectionNode(connection)
      return preserveChildren && connection.is_open ? { ...nextNode, children: node.children } : nextNode
    })

  const updateTreeNode = (nodes: DatabaseTreeNode[], key: React.Key, children: DatabaseTreeNode[]): DatabaseTreeNode[] =>
    nodes.map((node) => {
      if (node.key === key) {
        return { ...node, children }
      }

      if (node.children) {
        return { ...node, children: updateTreeNode(node.children, key, children) }
      }

      return node
    })

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

  const getConnection = (connectionId?: string): ConnectionInfo | undefined => connections.find((connection) => connection.connection_id === connectionId)

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

  const quoteTableName = (connectionId: string, tableName: string, databaseName?: string): string => {
    const connection = getConnection(connectionId)

    if (connection?.database_type === 'mysql') {
      const quotedTable = `\`${tableName.replaceAll('`', '``')}\``
      return databaseName ? `\`${databaseName.replaceAll('`', '``')}\`.${quotedTable}` : quotedTable
    }

    if (connection?.database_type === 'mongodb') {
      return `db.${tableName}.find({})`
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
        databaseName: connection.database_type === 'mysql' || connection.database_type === 'mongodb' ? getDefaultDatabaseName(connection) : undefined,
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
    const sql = connection?.database_type === 'mongodb'
      ? quoteTableName(connectionId, tableName, databaseName)
      : `select * from ${quoteTableName(connectionId, tableName, databaseName)} limit 1000;`
    openQueryWorkspace(sql, `${tableName} 查询`, connectionId, databaseName, pgDatabaseName)
  }

  const openTableEditor = async (connectionId: string, tableName: string, databaseName?: string): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    setEditingConnectionId(connectionId)
    setEditingDatabaseName(databaseName)
    setEditingTableName(tableName)
    setEditingColumns([])
    setTableEditorOpen(true)
    setTableEditorLoading(true)

    try {
      const data = await requestJson<{ columns: ColumnInfo[] }>(withDatabaseQuery(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns`, databaseName))
      setEditingColumns(data.columns)
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
      const data = await requestJson<{ columns: ColumnInfo[] }>(withDatabaseQuery(`/connections/${editingConnectionId}/tables/${encodeURIComponent(editingTableName)}/columns`, editingDatabaseName), {
        method: 'PUT',
        body: JSON.stringify({ columns: editingColumns })
      })
      setEditingColumns(data.columns)
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
            setSelectedDatabases((current) => ({ ...current, [connectionId]: nextSelected }))
            setActiveSelector(null)
            setTimeout(() => refreshConnectionNode(connectionId), 0)
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

  const renderTreeTitle = (node: DatabaseTreeNode): React.ReactNode => {
    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection ? renderConnectionTitle(connection) : (node.title as React.ReactNode)
    }

    if ((node.kind === 'database' || node.kind === 'pg-schema') && node.connectionId && node.databaseName) {
      const connectionId = node.connectionId
      const databaseName = node.databaseName
      const pgDbName = node.pgDatabaseName
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
            <Dropdown
              trigger={['contextMenu']}
              menu={{
                items: [
                  { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
                  ...(isPgDb ? [{ key: 'new-schema', label: '新建模式', icon: <PlusOutlined /> }] : []),
                  ...(!isPgDb ? [{ key: 'new-table', label: getConnection(connectionId)?.database_type === 'mongodb' ? '新建集合' : '新建表', icon: <PlusOutlined /> }] : []),
                  ...(getConnection(connectionId)?.database_type !== 'mongodb' ? [{ key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }] : []),
                  { type: 'divider' },
                  ...(getConnection(connectionId)?.database_type !== 'mongodb' ? [{ key: 'backup', label: '备份', icon: <SaveOutlined /> }] : []),
                  { key: 'export', label: '导出', icon: <FileAddOutlined /> },
                  ...(getConnection(connectionId)?.database_type !== 'mongodb' ? [{ key: 'import', label: '导入', icon: <PlayCircleOutlined /> }] : []),
                  ...(!isPgDb && (getConnection(connectionId)?.database_type === 'mysql' || getConnection(connectionId)?.database_type === 'postgresql') ? [
                    { type: 'divider' as const },
                    { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }
                  ] : [])
                ],
                onClick: ({ key }) => {
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
                    const conn = getConnection(connectionId)
                    setCreateTableConnectionId(connectionId)
                    setCreateTableDatabaseName(databaseName)
                    setCreateTablePgDatabaseName(pgDbName ?? '')
                    setNewTableName('')
                    setNewTableColumns(conn?.database_type === 'mongodb'
                      ? [{ key: 'col-0', name: '_id', type: 'ObjectId', nullable: false, primaryKey: true }]
                      : [
                          { key: 'col-0', name: 'id', type: conn?.database_type === 'postgresql' ? 'INTEGER' : 'INT', nullable: false, primaryKey: true },
                          { key: 'col-1', name: 'name', type: 'VARCHAR(100)', nullable: false, primaryKey: false }
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
              }}
            >
              <span className="table-tree-title">{node.title as React.ReactNode}</span>
            </Dropdown>
            <span className="tree-node-actions">
              {renderAIContextButton(node)}
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
                  setSelectedSchemas((current) => ({ ...current, [selKey]: nextSelected }))
                  setActiveSelector(null)
                  refreshDatabaseNode(connectionId, databaseName)
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

    const connectionId = node.connectionId
    const databaseName = node.databaseName
    const pgDbName = node.pgDatabaseName
    const tableName = node.tableName
    const objectType = node.objectType ?? 'table'
    const canPreview = objectType === 'table' || objectType === 'view'

    return (
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [
            ...(canPreview ? [{ key: 'select', label: '生成 SELECT 查询' }] : []),
            { key: 'ddl', label: '查看 DDL' },
            ...(objectType === 'table' && getConnection(connectionId)?.database_type !== 'mongodb' ? [{ key: 'edit', label: '修改表' }] : []),
            { key: 'copy', label: '复制对象名' },
            { type: 'divider' },
            ...(canPreview ? [
              { key: 'export', label: '导出', icon: <FileAddOutlined /> },
            ] : []),
            ...(getConnection(connectionId)?.database_type !== 'mongodb' ? [{ key: 'import', label: '导入', icon: <PlayCircleOutlined /> }] : []),
            ...(canPreview ? [
              { type: 'divider' as const },
              { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }
            ] : [])
          ],
          onClick: ({ key }) => {
            if (key === 'select') {
              openTableQuery(connectionId, tableName, databaseName, pgDbName)
            }
            if (key === 'ddl') {
              void showObjectDdl(connectionId, tableName, objectType, databaseName, pgDbName)
            }
            if (key === 'edit') {
              void openTableEditor(connectionId, tableName, databaseName)
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
        }}
      >
        <Flex align="center" justify="space-between" className="tree-title-with-size">
          <span className="table-tree-title">
            {node.title as React.ReactNode}
          </span>
          <span className="tree-node-actions">
            {node.sizeDisplay && <span className="tree-size-badge" title={`数据大小：${node.sizeDisplay}${node.storageSizeDisplay ? `，物理占用：${node.storageSizeDisplay}` : ''}`}>{node.sizeDisplay}</span>}
          </span>
        </Flex>
      </Dropdown>
    )
  }

  const countPendingChanges = (tab: WorkspaceTab): number => {
    if (tab.kind !== 'preview') {
      return 0
    }

    return tab.editRows?.filter((row) => row.__state || row.__deleted).length ?? 0
  }

  const renderResultStatus = (tab: WorkspaceTab): React.ReactNode => {
    const connection = getConnection(tab.connectionId)
    const rowText = tab.result ? `${tab.result.row_count} 行` : '暂无结果'
    const pendingChanges = countPendingChanges(tab)

    return (
      <Flex align="center" justify="space-between" gap={8} className="result-status">
        <Space wrap>
          <Tag color={tab.kind === 'query' ? 'blue' : 'green'}>{tab.kind === 'query' ? 'SQL 查询' : '表预览'}</Tag>
          {connection && <Tag>{connection.name}</Tag>}
          {tab.tableName && <Tag>{tab.tableName}</Tag>}
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

  const renderTableToolbar = (tab: WorkspaceTab): React.ReactNode => {
    const showPreviewActions = tab.kind === 'preview' && tab.connectionId && tab.tableName

    return (
      <Flex align="center" justify="space-between" className="table-data-toolbar">
        <Space size={4}>
          {showPreviewActions && (
            <>
              <Button size="small" icon={<ReloadOutlined />} loading={tab.loading} onClick={() => void previewTable(tab.connectionId!, tab.tableName!, tab.databaseName, tab.pgDatabaseName, tab.limit, tab.page)}>
                刷新
              </Button>
              <Button size="small" icon={<PlusOutlined />} onClick={() => addPreviewRow(tab)}>
                新增行
              </Button>
              <Button size="small" icon={<MinusOutlined />} disabled={!tab.selectedRowKeys?.length} onClick={() => markSelectedRowsDeleted(tab)}>
                删除行
              </Button>
              <Button type="primary" size="small" icon={<SaveOutlined />} disabled={countPendingChanges(tab) === 0} loading={tab.loading} onClick={() => void submitPreviewChanges(tab)}>
                提交
              </Button>
            </>
          )}
        </Space>
        {renderResultPager(tab)}
      </Flex>
    )
  }

  const renderResultPager = (tab: WorkspaceTab): React.ReactNode => {
    const limit = tab.limit ?? 1000
    const page = tab.page ?? 1
    const hasNext = !!tab.result?.limited

    return (
      <Space size={4} className="result-pager">
        <Button size="small" disabled={tab.loading || page <= 1} onClick={() => void changeTabPage(tab, page - 1)}>
          上一页
        </Button>
        <InputNumber
          size="small"
          min={1}
          value={page}
          controls={false}
          className="result-page-input"
          onPressEnter={(event) => {
            const value = Number(event.currentTarget.value)
            if (Number.isFinite(value) && value >= 1 && value !== page) {
              void changeTabPage(tab, Math.floor(value))
            }
          }}
        />
        <Button size="small" disabled={tab.loading || !hasNext} onClick={() => void changeTabPage(tab, page + 1)}>
          下一页
        </Button>
        <Select
          size="small"
          value={limit}
          className="result-limit-select"
          options={[500, 1000].map((value) => ({ label: `${value} 条/页`, value }))}
          onChange={(value) => void changeTabLimit(tab, value)}
        />
      </Space>
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
    const rowNumberOffset = ((tab.page ?? 1) - 1) * (tab.limit ?? 1000)

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

    return (
      <div className="result-table-shell">
        {renderResultStatus(tab)}
        {renderTableToolbar(tab)}
        {tab.error && <Alert message="执行失败" description={tab.error} type="error" showIcon />}
        {tab.result?.limited && <Alert message="还有更多数据，可点击下一页继续查看" type="warning" showIcon />}
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
            virtual
            locale={{ emptyText: tab.kind === 'query' ? '暂无查询结果' : '暂无表数据' }}
          />
        </div>
      </div>
    )
  }

  const getDefaultDatabaseName = (connection: ConnectionInfo): string | undefined => {
    if (connection.database_type !== 'mysql' && connection.database_type !== 'mongodb') {
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
                const nextDb = nextConn?.database_type === 'mysql' || nextConn?.database_type === 'mongodb' ? getDefaultDatabaseName(nextConn) : undefined
                const nextPgDb = nextConn?.database_type === 'postgresql' ? getDefaultPgDatabase(nextConn!) : undefined
                updateWorkspaceTab(tab.key, {
                  connectionId,
                  databaseName: nextDb,
                  pgDatabaseName: nextPgDb
                })

                if ((nextConn?.database_type === 'mysql' || nextConn?.database_type === 'mongodb') && nextDb) {
                  void preloadCompletionForDatabase(connectionId, nextDb)
                }
              }}
              options={connections.map((c) => ({ label: c.name, value: c.connection_id }))}
            />
            {(isMysql || isPg || isDm || isMongo) && (
              <Select
                className="database-select"
                placeholder={isPg ? '选择 Database' : isDm ? '选择 Schema' : isMongo ? '选择数据库' : '选择库'}
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
      if (connection.is_open && (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'mongodb')) {
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

              return { ...current, [connection.connection_id]: defaultSelectedDatabases(connection, dbNames) }
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

  const loadChildrenForNode = async (node: DatabaseTreeNode): Promise<DatabaseTreeNode[]> => {
    if (node.closed) {
      return []
    }

    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)

      if (connection?.database_type !== 'mysql' && connection?.database_type !== 'postgresql' && connection?.database_type !== 'dm' && connection?.database_type !== 'mongodb') {
        return []
      }

      const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${node.connectionId}/databases`)
      const dbNames = data.databases.map((d) => d.name)

      const currentSelected = selectedDatabasesRef.current[node.connectionId!]
      const nextSelected = currentSelected ? filterPersistedValues(currentSelected, dbNames) : defaultSelectedDatabases(connection, dbNames)

      setAllDatabases((current) => ({ ...current, [node.connectionId!]: dbNames }))
      setSelectedDatabases((current) => ({ ...current, [node.connectionId!]: nextSelected }))

      return data.databases.filter((d) => nextSelected.includes(d.name)).map<DatabaseTreeNode>((database) => ({
        key: `database:${node.connectionId}:${database.name}`,
        title: database.name,
        icon: <DatabaseOutlined />,
        kind: 'database',
        connectionId: node.connectionId,
        databaseName: database.name,
        sizeDisplay: database.size_display,
        sizeBytes: database.size_bytes,
        storageSizeDisplay: database.storage_size_display,
        storageSizeBytes: database.storage_size_bytes,
        isLeaf: false
      }))
    }

    if (node.kind === 'database' && node.connectionId && node.databaseName) {
      const connection = getConnection(node.connectionId)

      if (connection?.database_type === 'postgresql') {
        const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${node.connectionId}/schemas?database=${encodeURIComponent(node.databaseName!)}`)
        const selKey = `${node.connectionId}:${node.databaseName}`
        const schemaNames = data.databases.map((s) => s.name)
        const currentSelectedSchemas = selectedSchemasRef.current[selKey]
        const nextSelectedSchemas = currentSelectedSchemas ? filterPersistedValues(currentSelectedSchemas, schemaNames) : schemaNames

        setAllSchemas((current) => ({ ...current, [selKey]: schemaNames }))
        setSelectedSchemas((current) => ({ ...current, [selKey]: nextSelectedSchemas }))

        return data.databases.filter((s) => nextSelectedSchemas.includes(s.name)).map<DatabaseTreeNode>((schema) => ({
          key: `pg-schema:${node.connectionId}:${node.databaseName}:${schema.name}`,
          title: schema.name,
          icon: <BranchesOutlined />,
          kind: 'pg-schema',
          connectionId: node.connectionId,
          databaseName: schema.name,
          pgDatabaseName: node.databaseName,
          sizeDisplay: schema.size_display,
          sizeBytes: schema.size_bytes,
          storageSizeDisplay: schema.storage_size_display,
          storageSizeBytes: schema.storage_size_bytes,
          isLeaf: false
        }))
      }

      return buildObjectGroupNodes(node.connectionId, node.databaseName)
    }

    if (node.kind === 'pg-schema' && node.connectionId && node.databaseName) {
      return buildObjectGroupNodes(node.connectionId, node.databaseName, node.pgDatabaseName)
    }

    if (node.kind === 'object-group' && node.connectionId && node.objectType) {
      const data = await requestJson<{ objects: DbObjectInfo[] }>(`${withPgDatabase(`/connections/${node.connectionId}/objects`, node.databaseName, node.pgDatabaseName)}${node.databaseName || node.pgDatabaseName ? '&' : '?'}type=${node.objectType}`)
      return data.objects.map<DatabaseTreeNode>((object) => {
        const kind = object.type === 'table' ? 'table' : 'db-object'
        const group = DB_OBJECT_GROUP_BY_TYPE[object.type]

        return {
          key: `${kind}:${node.connectionId}:${node.pgDatabaseName ?? ''}:${node.databaseName ?? ''}:${object.type}:${object.name}`,
          title: object.name,
          icon: group.icon,
          kind,
          connectionId: node.connectionId,
          databaseName: node.databaseName,
          pgDatabaseName: node.pgDatabaseName,
          tableName: object.name,
          objectType: object.type,
          sizeDisplay: object.size_display,
          sizeBytes: object.size_bytes,
          storageSizeDisplay: object.storage_size_display,
          storageSizeBytes: object.storage_size_bytes,
          rowCount: object.row_count,
          isLeaf: object.type !== 'table'
        }
      })
    }

    if (node.kind === 'table' && node.connectionId && node.tableName) {
      const data = await requestJson<{ columns: ColumnInfo[] }>(withPgDatabase(`/connections/${node.connectionId}/tables/${encodeURIComponent(node.tableName)}/columns`, node.databaseName, node.pgDatabaseName))
      return data.columns.map<DatabaseTreeNode>((column) => ({
        key: `column:${node.connectionId}:${node.databaseName ?? 'main'}:${node.tableName}:${column.name}`,
        title: `${column.name} · ${column.type}${column.primary_key ? ' · PK' : ''}${column.nullable ? '' : ' · NOT NULL'}`,
        kind: 'column',
        isLeaf: true
      }))
    }

    return []
  }

  const reloadExpandedDescendants = async (connectionId: string, expandedSnapshot: string[]): Promise<void> => {
    const descendants = expandedSnapshot
      .filter((k) => {
        return k.startsWith(`database:${connectionId}:`) || k.startsWith(`pg-schema:${connectionId}:`) || k.startsWith(`object-group:${connectionId}:`) || k.startsWith(`table:${connectionId}:`)
      })
      .sort((a, b) => a.split(':').length - b.split(':').length)

    for (const key of descendants) {
      const parts = key.split(':')
      const kind = parts[0] as TreeNodeKind

      if (kind === 'database') {
        await reloadNodeChildren({
          key,
          kind: 'database',
          connectionId,
          databaseName: parts.slice(2).join(':'),
          isLeaf: false
        })
      } else if (kind === 'pg-schema') {
        await reloadNodeChildren({
          key,
          kind: 'pg-schema',
          connectionId,
          databaseName: parts[3],
          pgDatabaseName: parts[2],
          isLeaf: false
        })
      } else if (kind === 'object-group') {
        await reloadNodeChildren({
          key,
          kind: 'object-group',
          connectionId,
          pgDatabaseName: parts[2] || undefined,
          databaseName: parts[3] || undefined,
          objectType: parts[4] as DbObjectType,
          isLeaf: false
        })
      } else if (kind === 'table') {
        await reloadNodeChildren({
          key,
          kind: 'table',
          connectionId,
          pgDatabaseName: parts[2] || undefined,
          databaseName: parts[3] || undefined,
          objectType: 'table',
          tableName: parts.slice(5).join(':'),
          isLeaf: false
        })
      }
    }
  }

  const reloadNodeChildren = async (node: DatabaseTreeNode, expand = true): Promise<void> => {
    const children = await loadChildrenForNode(node)
    setTreeData((current) => updateTreeNode(current, node.key, children))
    if (expand) {
      setExpandedKeys((current) => current.includes(node.key) ? current : [...current, node.key])
    }
  }

  const isLoadableTreeNode = (node: DatabaseTreeNode): boolean =>
    node.kind === 'connection' || node.kind === 'database' || node.kind === 'pg-schema' || node.kind === 'object-group' || node.kind === 'table'

  const collectDescendantKeys = (node: DatabaseTreeNode): Set<React.Key> => {
    const keys = new Set<React.Key>()
    const collect = (children?: DatabaseTreeNode[]): void => {
      children?.forEach((child) => {
        keys.add(child.key)
        collect(child.children)
      })
    }

    collect(node.children)
    return keys
  }

  const collapseTreeNode = (node: DatabaseTreeNode): void => {
    const key = node.key as React.Key
    const descendantKeys = collectDescendantKeys(node)
    setExpandedKeys((current) => current.filter((item) => item !== key && !descendantKeys.has(item)))
  }

  const toggleOrLoadTreeNode = (node: DatabaseTreeNode): void => {
    activateAIContextFromNode(node)

    if (!node.key || !isLoadableTreeNode(node)) {
      return
    }

    const key = node.key as React.Key
    const isExpanded = expandedKeys.includes(key)

    if (isExpanded) {
      collapseTreeNode(node)
      return
    }

    if (!node.children || node.children.length === 0) {
      void reloadNodeChildren({ ...node, isLeaf: false })
      return
    }

    setExpandedKeys((current) => current.includes(key) ? current : [...current, key])
  }

  const loadTreeData = async (node: DatabaseTreeNode): Promise<void> => {
    const children = await loadChildrenForNode(node)

    if (children.length > 0) {
      setTreeData((current) => updateTreeNode(current, node.key, children))
    }
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
      if (data.database_type === 'dm') {
        await loadDrivers()
      }
      form.setFieldsValue(data)
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
      { key: 'mongodb', label: 'MongoDB', icon: <img src={mongoIcon} alt="" style={{ width: 16, height: 16 }} /> }
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

  const loadDrivers = async (): Promise<void> => {
    setDriversLoading(true)
    try {
      const result = await requestJson<{ drivers: DriverInfo[] }>('/drivers')
      setDrivers(result.drivers)
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载驱动失败')
    } finally {
      setDriversLoading(false)
    }
  }

  const openDriverManager = (): void => {
    setDriverManagerOpen(true)
    driverForm.setFieldsValue({ database_type: 'dm', driver_type: 'jdbc', name: '', enabled: true })
    void loadDrivers()
  }

  const addDriver = async (): Promise<void> => {
    setDriverSaving(true)
    try {
      const values = await driverForm.validateFields()
      const body = { database_type: 'dm', driver_type: values.driver_type, name: values.name, path: values.path, enabled: values.enabled }
      await requestJson('/drivers', { method: 'POST', body: JSON.stringify(body) })
      driverForm.setFieldsValue({ database_type: 'dm', driver_type: 'jdbc', name: '', path: undefined, enabled: true })
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

  const dmDriverOptions = dmDrivers.map((driver) => ({
    label: `${driverTypeLabel(driver.driver_type)} · ${driver.name}`,
    value: driver.id
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
      showError(err instanceof Error ? err.message : connectionMode === 'edit' ? '更新连接失败' : '创建连接失败')
    } finally {
      setConnectionLoading(false)
    }
  }

  const openConnectionById = async (connectionId: string): Promise<void> => {
    try {
      const connection = await requestJson<ConnectionInfo>(`/connections/${connectionId}/open`, { method: 'POST' })

      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setTreeData((current) => replaceConnectionNode(current, connection))

      const connKey = `connection:${connectionId}`
      setExpandedKeys((current) => current.includes(connKey) ? current : [...current, connKey])

      if (connection.database_type === 'sqlite') {
        setTreeData((current) => updateTreeNode(current, connKey, buildConnectionNode(connection).children ?? []))
      } else {
        void reloadNodeChildren({ key: connKey, kind: 'connection', connectionId, closed: false, isLeaf: false })
      }

    } catch (err) {
      showError(err instanceof Error ? err.message : '打开连接失败')
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
            selectedDatabasesRef.current = { ...current, [connId]: nextList }
            setTimeout(() => refreshConnectionNode(connId), 0)
            return { ...current, [connId]: nextList }
          }
          return current
        })
        refreshConnectionNode(connId)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : isSchema ? '创建模式失败' : '创建数据库失败')
    } finally {
      setDatabaseCreateLoading(false)
    }
  }

  const addNewColumn = (): void => {
    const key = `col-${Date.now()}`
    setNewTableColumns((current) => [...current, { key, name: '', type: 'VARCHAR(100)', nullable: true, primaryKey: false }])
  }

  const removeNewColumn = (key: string): void => {
    setNewTableColumns((current) => current.filter((col) => col.key !== key))
  }

  const updateNewColumn = (key: string, patch: Partial<ColumnDef>): void => {
    setNewTableColumns((current) => current.map((col) => (col.key === key ? { ...col, ...patch } : col)))
  }

  const createTable = async (): Promise<void> => {
    if (!ensureConnectionOpen(createTableConnectionId)) {
      return
    }

    if (!newTableName.trim()) {
      return
    }

    const validColumns = newTableColumns.filter((col) => col.name.trim())

    if (validColumns.length === 0) {
      return
    }

    setCreateTableLoading(true)
    const conn = getConnection(createTableConnectionId)
    const isPg = conn?.database_type === 'postgresql'

    try {
      const sql = conn?.database_type === 'mongodb'
        ? `db.createCollection("${newTableName.trim().replaceAll('"', '\\"')}")`
        : (() => {
            const columnDefs = validColumns.map((col) => {
              const parts: string[] = [col.name, col.type]

              if (!col.nullable) {
                parts.push('NOT NULL')
              }

              if (col.primaryKey) {
                parts.push('PRIMARY KEY')
              }

              return parts.join(' ')
            })

            return `CREATE TABLE ${newTableName.trim()} (\n  ${columnDefs.join(',\n  ')}\n);`
          })()

      const result = await requestJson<SqlFileRunResponse>(`/connections/${createTableConnectionId}/sql-file`, {
        method: 'POST',
        body: JSON.stringify({ sql, database: createTableDatabaseName || undefined, pg_database: createTablePgDatabaseName || undefined })
      })

      if (result.failed_count > 0) {
        showError(result.errors[0] ?? '创建表失败')
        return
      }

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

    if (connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'mongodb') {
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
    setExportConnectionId(connectionId)
    setExportDatabase(database ?? '')
    setExportPgDatabase(pgDatabase ?? '')
    setExportTable(table ?? '')
    setExportScope(table ? 'table' : pgDatabase ? 'schema' : 'database')
    setExportFormat('sql')
    setExportContent('schema_data')
    setExportModalOpen(true)
  }

  const runExport = async (): Promise<void> => {
    setExportLoading(true)
    try {
      const defaultName = exportTable || exportPgDatabase || exportDatabase || 'export'
      const extension = exportFormat === 'csv' ? 'csv' : 'sql'
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
      const result = await requestJson<QueryResponse>(withPageQuery(withPgDatabase(`/connections/${tab.connectionId}/tables/${encodeURIComponent(tab.tableName)}/data`, tab.databaseName, tab.pgDatabaseName), tab.limit ?? 1000, tab.page ?? 1), {
        method: 'PUT',
        body: JSON.stringify({ inserted, updated, deleted })
      })
      updateWorkspaceTab(tab.key, { result, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, editingCell: undefined, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '提交表数据失败' })
      showError(err instanceof Error ? err.message : '提交表数据失败')
    }
  }

  const previewTable = async (connectionId: string, tableName: string, databaseName?: string, pgDatabaseName?: string, limit = 1000, page = 1): Promise<void> => {
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const tabKey = `preview:${connectionId}:${pgDatabaseName ?? databaseName ?? 'main'}:${tableName}`

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
          title: databaseName ? `${databaseName}.${tableName}` : tableName,
          kind: 'preview',
          connectionId,
          databaseName,
          pgDatabaseName,
          tableName,
          sql: '',
          limit,
          page,
          loading: true
        }
      ]
    })

    try {
      const result = await requestJson<QueryResponse>(withPageQuery(withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/preview`, databaseName, pgDatabaseName), limit, page))
      updateWorkspaceTab(tabKey, { result, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, editingCell: undefined, loading: false, error: undefined })
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

    if ((connection?.database_type === 'mysql' || connection?.database_type === 'mongodb') && !finalDb) {
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

      if ((connection?.database_type === 'mysql' || connection?.database_type === 'mongodb') && finalDb) {
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
      void previewTable(activePreview.connectionId, activePreview.tableName, activePreview.databaseName, activePreview.pgDatabaseName, activePreview.limit, activePreview.page)
    }
  }

  const changeTabLimit = async (tab: WorkspaceTab, limit: number): Promise<void> => {
    updateWorkspaceTab(tab.key, { limit, page: 1 })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, limit, page: 1 })
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(tab.connectionId, tab.tableName, tab.databaseName, tab.pgDatabaseName, limit, 1)
    }
  }

  const changeTabPage = async (tab: WorkspaceTab, page: number): Promise<void> => {
    const nextPage = Math.max(1, page)
    updateWorkspaceTab(tab.key, { page: nextPage })

    if (tab.kind === 'query') {
      await runQuery({ ...tab, page: nextPage })
      return
    }

    if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
      await previewTable(tab.connectionId, tab.tableName, tab.databaseName, tab.pgDatabaseName, tab.limit ?? 1000, nextPage)
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

    if ((connection?.database_type === 'mysql' || connection?.database_type === 'mongodb') && !tab.databaseName) {
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
          limit: tab.limit ?? 1000,
          offset: Math.max(0, (tab.page ?? 1) - 1) * (tab.limit ?? 1000),
          database: connection?.database_type === 'mysql' || connection?.database_type === 'postgresql' || connection?.database_type === 'mongodb' ? (tab.databaseName || undefined) : undefined,
          pg_database: connection?.database_type === 'postgresql' ? (tab.pgDatabaseName || undefined) : undefined
        })
      })
      updateWorkspaceTab(tab.key, { result, page: tab.page ?? 1, selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '查询失败' })
      showError(err instanceof Error ? err.message : '查询失败')
    }
  }

  const restartBackend = async (): Promise<void> => {
    setHealthLoading(true)

    try {
      setBackendStatus(await window.api.restartBackend())
    } catch (err) {
      showError(err instanceof Error ? err.message : '重启后端失败')
    } finally {
      setHealthLoading(false)
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
        setUpdateProgress({ percent: 100, transferred: updateProgress?.transferred ?? 0, total: updateProgress?.total })
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
  const updateDownloaded = Boolean(updateInfo?.downloadedPath) || (updateMode === 'installer' && updateProgress?.percent === 100)
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
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={openDriverManager} title="驱动管理" aria-label="驱动管理" />
            <Button type={updateInfo?.available ? 'primary' : 'text'} size="small" icon={<CloudDownloadOutlined />} loading={checkingUpdate || downloadingUpdate} onClick={() => { setUpdateModalOpen(true); void checkForUpdates(true) }} title="检查更新" aria-label="检查更新" />
            <Button type="text" size="small" icon={<ReloadOutlined />} loading={healthLoading} onClick={() => void checkHealth()} title="同步状态" aria-label="同步状态" />
            {backendStatus.state !== 'starting' && backendStatus.state !== 'online' && <Button type="text" size="small" icon={<ReloadOutlined />} loading={healthLoading} onClick={() => void restartBackend()} title="重启后端" aria-label="重启后端" />}
            <Button type={aiPanelOpen ? 'primary' : 'text'} size="small" icon={<MessageOutlined />} onClick={() => setAiPanelOpen((open) => !open)} title={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} aria-label={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} />
            <Button className="theme-toggle-btn" type="text" size="small" icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} />
            <Tag className="service-pill" icon={backendStatusIcon} color={BACKEND_COLORS[backendStatus.state]}>{BACKEND_LABELS[backendStatus.state]}</Tag>
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
              {connections.length === 0 ? (
                <Alert message="暂无数据库连接" description="先创建一个 SQLite 或 MySQL 连接。" type="info" showIcon />
              ) : (
                <Tree
                  showIcon
                  blockNode
                  virtual
                  treeData={treeData}
                  expandedKeys={expandedKeys}
                  onExpand={(keys, info) => {
                    const node = info.node as DatabaseTreeNode
                    setFocusedTreeNode(node)
                    activateAIContextFromNode(node)
                    if (!info.expanded) {
                      collapseTreeNode(node)
                      return
                    }
                    setExpandedKeys(keys)
                    if ((!node.children || node.children.length === 0) && isLoadableTreeNode(node)) {
                      void reloadNodeChildren({ ...node, isLeaf: false }, false)
                    }
                  }}
                  loadData={(node) => loadTreeData(node as DatabaseTreeNode)}
                  titleRender={(node) => renderTreeTitle(node as DatabaseTreeNode)}
                  selectedKeys={selectedConnectionId ? [`connection:${selectedConnectionId}`] : []}
                  onSelect={(_, info) => {
                    const node = info.node as DatabaseTreeNode
                    setFocusedTreeNode(node)
                    if (node.connectionId) {
                      setSelectedConnectionId(node.connectionId)
                    }
                  }}
                  onDoubleClick={(_, node) => {
                    const treeNode = node as DatabaseTreeNode
                    setFocusedTreeNode(treeNode)
                    if (treeNode.kind === 'database' || treeNode.kind === 'pg-schema') {
                      activateAIContextFromNode(treeNode)
                    }
                    if ((treeNode.kind === 'table' || treeNode.kind === 'db-object') && treeNode.connectionId && treeNode.tableName && (treeNode.objectType === 'table' || treeNode.objectType === 'view')) {
                      activateAIContextFromNode(treeNode)
                      void previewTable(treeNode.connectionId, treeNode.tableName, treeNode.databaseName, treeNode.pgDatabaseName)
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
                      <div className="empty-workspace"><FileAddOutlined /><Typography.Text type="secondary">连接数据库后，可浏览库表结构、预览数据、编写 SQL，并让 Djinn Agent 辅助分析与执行受控操作。</Typography.Text><Space><Dropdown menu={connectionCreateMenu} trigger={['click']}><Button icon={<PlusOutlined />}>创建连接</Button></Dropdown></Space></div>
                    ) : (
                      <Tabs className="workspace-tabs" type="editable-card" hideAdd activeKey={activeTabKey} onChange={setActiveTabKey} onEdit={(targetKey, action) => { if (action === 'remove' && typeof targetKey === 'string') { closeWorkspaceTab(targetKey) } }} items={workspaceTabs.map((tab) => ({ key: tab.key, label: tab.title, closable: true, children: renderWorkspaceTab(tab) }))} />
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
      <Modal title="应用更新" open={updateModalOpen} onCancel={() => setUpdateModalOpen(false)} footer={null} width={680}>
        <Space direction="vertical" className="full-width" size="middle">
          <Alert
            type={updateInfo?.available ? 'info' : 'success'}
            showIcon
            message={updateStatusMessage}
            description={updateMode === 'installer' ? '安装版支持自动下载并在重启后安装更新。' : '绿色版支持检测并下载新版 zip，下载后需要关闭应用并手动解压替换。'}
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
      <Modal title="驱动管理" open={driverManagerOpen} footer={null} onCancel={() => setDriverManagerOpen(false)} width={860}>
        <Space direction="vertical" className="full-width" size="middle">
          <Alert type="info" showIcon message="统一管理数据库驱动。当前先支持达梦，后续其他数据库驱动会继续接入这里。达梦支持 dmPython pyd、dmPython whl 和 JDBC jar，连接时在连接信息中选择具体驱动。" />
          <Flex justify="space-between" align="center">
            <Typography.Title level={5} style={{ margin: 0 }}>达梦 DM</Typography.Title>
            <Space>
              <Button loading={driversLoading} onClick={() => void loadDrivers()}>刷新</Button>
            </Space>
          </Flex>
          <Table<DriverInfo>
            size="small"
            rowKey="id"
            loading={driversLoading}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: 820 }}
            dataSource={drivers.filter((driver) => driver.database_type === 'dm')}
            columns={[
              { title: '名称', dataIndex: 'name', width: 150, ellipsis: true, render: (value: string) => <Typography.Text ellipsis title={value}>{value}</Typography.Text> },
              { title: '类型', dataIndex: 'driver_type', width: 120, render: (value: DriverInfo['driver_type']) => driverTypeLabel(value) },
              { title: '来源', dataIndex: 'source', width: 90, render: () => '手动添加' },
              { title: '驱动文件', width: 300, ellipsis: true, render: (_: unknown, driver) => <Typography.Text ellipsis title={driver.path ?? undefined}>{driver.path}</Typography.Text> },
              { title: '状态', dataIndex: 'enabled', width: 80, render: (value: boolean) => value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag> },
              { title: '操作', width: 150, fixed: 'right', render: (_: unknown, driver) => <Space size={4} wrap={false}><Button size="small" onClick={() => void testDriver(driver)}>测试</Button><Button danger size="small" onClick={() => void deleteDriver(driver)}>删除</Button></Space> }
            ]}
          />
          <Form form={driverForm} layout="vertical" initialValues={{ database_type: 'dm', driver_type: 'jdbc', enabled: true }}>
            <Form.Item name="driver_type" label="添加驱动类型" rules={[{ required: true, message: '请选择驱动类型' }]}>
              <Select options={[{ label: 'JDBC jar 驱动', value: 'jdbc' }, { label: 'dmPython pyd 驱动', value: 'python' }, { label: 'dmPython whl 驱动', value: 'whl' }]} />
            </Form.Item>
            <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
              <Input placeholder="例如：达梦 JDBC / 本机 dmPython" />
            </Form.Item>
            <Form.Item
              name="path"
              label={driverType === 'python' ? 'dmPython pyd 文件' : driverType === 'whl' ? 'dmPython whl 文件' : 'JDBC jar 文件'}
              rules={[{ required: true, message: driverType === 'python' ? '请选择 dmPython pyd 文件' : driverType === 'whl' ? '请选择 dmPython whl 文件' : '请选择 JDBC jar 文件' }]}
            >
              <Input readOnly placeholder={driverType === 'python' ? '请选择 dmPython.pyd' : driverType === 'whl' ? '请选择 dmPython whl 文件' : '请选择 DmJdbcDriver.jar'} addonAfter={<Button type="link" size="small" onClick={() => void selectDriverFile()}>选择</Button>} />
            </Form.Item>
            <Button type="primary" loading={driverSaving} onClick={() => void addDriver()}>添加驱动</Button>
          </Form>
        </Space>
      </Modal>
      <Modal title={editingTableName ? `修改表：${editingTableName}` : '修改表'} open={tableEditorOpen} okText="保存" cancelText="取消" confirmLoading={tableEditorLoading} onOk={() => void saveTableEditor()} onCancel={() => setTableEditorOpen(false)} width={760}>
        <Alert message="支持 SQLite/MySQL 修改已有字段的类型、可空和单字段主键；当前不支持新增、删除或重命名字段。" type="warning" showIcon />
        <Table className="table-editor-grid" size="small" loading={tableEditorLoading} rowKey="name" pagination={false} dataSource={editingColumns} columns={[{ title: '字段名', dataIndex: 'name', key: 'name', render: (value: string) => <Input value={value} disabled /> }, { title: '类型', dataIndex: 'type', key: 'type', render: (value: string, column: ColumnInfo) => <Input value={value} onChange={(event) => { setEditingColumns((current) => current.map((item) => (item.name === column.name ? { ...item, type: event.target.value } : item))) }} /> }, { title: '可空', dataIndex: 'nullable', key: 'nullable', width: 90, render: (value: boolean, column: ColumnInfo) => <Switch checked={value} disabled={column.primary_key} onChange={(checked) => { setEditingColumns((current) => current.map((item) => (item.name === column.name ? { ...item, nullable: checked } : item))) }} /> }, { title: '主键', dataIndex: 'primary_key', key: 'primary_key', width: 90, render: (value: boolean, column: ColumnInfo) => <Switch checked={value} onChange={(checked) => { setEditingColumns((current) => current.map((item) => ({ ...item, primary_key: item.name === column.name ? checked : false }))) }} /> }]} />
      </Modal>
      <Modal title={creatingSchemaDatabaseName ? '新建模式' : '新增数据库'} open={databaseCreateModalOpen} okText="创建" cancelText="取消" confirmLoading={databaseCreateLoading} onOk={() => void createDatabase()} onCancel={() => { setDatabaseCreateModalOpen(false); setCreatingSchemaDatabaseName('') }} okButtonProps={{ disabled: !databaseCreateName.trim() }}>
        <Form layout="vertical">
          <Form.Item label={creatingSchemaDatabaseName ? '模式名称' : '数据库名称'} required>
            <Input placeholder={creatingSchemaDatabaseName ? '请输入模式名称' : '请输入数据库名称'} value={databaseCreateName} onChange={(event) => setDatabaseCreateName(event.target.value)} onPressEnter={() => void createDatabase()} />
          </Form.Item>
          <Typography.Text type="secondary">只允许字母、数字、下划线，首字符不能是数字，长度 1-64</Typography.Text>
        </Form>
      </Modal>
      <Modal title="运行 SQL 文件" open={sqlFileModalOpen} okText="执行" cancelText="取消" confirmLoading={sqlFileLoading} onOk={() => void runSqlFile()} onCancel={() => setSqlFileModalOpen(false)} okButtonProps={{ danger: true, disabled: sqlFileDatabases.length > 0 && !sqlFileDatabase }} footer={sqlFileResult ? undefined : (_, { OkBtn, CancelBtn }) => (<Space><CancelBtn /><OkBtn /></Space>)}>
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
      <Modal title={ddlModalTitle || '查看 DDL'} open={ddlModalOpen} footer={null} onCancel={() => setDdlModalOpen(false)} width={820} centered>
        <Input.TextArea value={ddlLoading ? '加载中...' : ddlContent} autoSize={{ minRows: 12, maxRows: 24 }} readOnly />
      </Modal>
      <Modal title={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '新建集合' : '新建表'} open={createTableModalOpen} okText="创建" cancelText="取消" confirmLoading={createTableLoading} onOk={() => void createTable()} onCancel={() => setCreateTableModalOpen(false)} width={680} okButtonProps={{ disabled: !newTableName.trim() || (getConnection(createTableConnectionId)?.database_type !== 'mongodb' && newTableColumns.filter((c) => c.name.trim()).length === 0) }}>
        <Form layout="vertical">
          <Form.Item label={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '集合名' : '表名'} required><Input placeholder={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '请输入集合名' : '请输入表名'} value={newTableName} onChange={(event) => setNewTableName(event.target.value)} /></Form.Item>
          {getConnection(createTableConnectionId)?.database_type !== 'mongodb' && (
            <>
              <Form.Item label="字段定义">
                <Table size="small" rowKey="key" pagination={false} dataSource={newTableColumns} columns={[{ title: '字段名', dataIndex: 'name', width: 160, render: (value: string, col: ColumnDef) => <Input size="small" value={value} placeholder="字段名" onChange={(event) => updateNewColumn(col.key, { name: event.target.value })} /> }, { title: '类型', dataIndex: 'type', width: 160, render: (value: string, col: ColumnDef) => <Select size="small" style={{ width: '100%' }} value={value} onChange={(v) => updateNewColumn(col.key, { type: v })} options={COMMON_TYPES.map((t) => ({ label: t, value: t }))} /> }, { title: '可空', dataIndex: 'nullable', width: 60, render: (value: boolean, col: ColumnDef) => <Switch size="small" checked={value} disabled={col.primaryKey} onChange={(checked) => updateNewColumn(col.key, { nullable: checked })} /> }, { title: '主键', dataIndex: 'primaryKey', width: 60, render: (value: boolean, col: ColumnDef) => <Switch size="small" checked={value} onChange={(checked) => updateNewColumn(col.key, { primaryKey: checked, nullable: checked ? false : col.nullable })} /> }, { title: '', width: 40, render: (_: unknown, col: ColumnDef) => <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNewColumn(col.key)} /> }]} />
              </Form.Item>
              <Button type="dashed" block icon={<PlusOutlined />} onClick={addNewColumn}>添加字段</Button>
            </>
          )}
        </Form>
      </Modal>
      <Modal title={connectionMode === 'edit' ? '编辑数据库连接' : '新建数据库连接'} open={connectionModalOpen} okText={connectionMode === 'edit' ? '保存修改' : '创建连接'} cancelText="取消" confirmLoading={connectionLoading} onOk={() => void saveConnection()} onCancel={() => setConnectionModalOpen(false)} footer={(_, { OkBtn, CancelBtn }) => (<Space><Button loading={testingConnection} onClick={() => void testConnection()}>测试连接</Button><CancelBtn /><OkBtn /></Space>)}>
        <Form form={form} layout="vertical" initialValues={{ database_type: 'sqlite' }}>
          <Form.Item name="name" label="连接名称" rules={[{ required: true, message: '请输入连接名称' }]}><Input placeholder="例如：本地 SQLite" /></Form.Item>
          <Form.Item name="database_type" style={{ display: 'none' }}><Input /></Form.Item>
          {databaseType === 'sqlite' ? (
            <Form.Item name="sqlite_path" label="SQLite 文件路径" rules={[{ required: true, message: '请输入 SQLite 文件路径' }]}><Input placeholder="data/datadjinn.sqlite" /></Form.Item>
          ) : (
            <>
              <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机' }]}><Input placeholder="127.0.0.1" /></Form.Item>
              <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}><InputNumber min={1} max={65535} className="full-width" placeholder={databaseType === 'postgresql' ? '5432' : databaseType === 'dm' ? '5236' : databaseType === 'mongodb' ? '27017' : '3306'} /></Form.Item>
              <Form.Item name="username" label="用户名" rules={databaseType === 'mongodb' ? undefined : [{ required: true, message: '请输入用户名' }]}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'dm' ? 'SYSDBA' : undefined} /></Form.Item>
              <Form.Item name="password" label="密码"><Input.Password /></Form.Item>
              <Form.Item name="database" label={databaseType === 'postgresql' ? '数据库名' : databaseType === 'dm' ? '默认 Schema（可选）' : databaseType === 'mongodb' ? '认证库/默认库（可选）' : '默认数据库（可选）'} rules={databaseType === 'postgresql' ? [{ required: true, message: '请输入数据库名' }] : undefined}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'dm' ? '不填则使用默认 Schema' : databaseType === 'mongodb' ? '默认 admin；也可填业务库名' : '不填则连接服务器并加载全部数据库'} /></Form.Item>
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
                    message={selectedDmDriver ? `当前选择：${driverTypeLabel(selectedDmDriver.driver_type)} · ${selectedDmDriver.name}` : '未选择达梦驱动，请先在驱动管理中添加并选择 JDBC jar、dmPython pyd 或 dmPython whl 驱动'}
                    action={<Button size="small" onClick={openDriverManager}>驱动管理</Button>}
                  />
                </>
              )}
            </>
          )}
        </Form>
      </Modal>
      <Modal title="备份" open={backupRestoreModalOpen} okText="选择路径并备份" cancelText="取消" confirmLoading={backupRestoreLoading} onOk={() => void runBackup()} onCancel={() => setBackupRestoreModalOpen(false)}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(backupRestoreConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>数据库：</Typography.Text>{backupRestorePgDatabase || backupRestoreDatabase || '默认'}</Typography.Text>
          <Alert type="info" message="备份将生成 SQL 脚本（含建表语句和数据），可随时通过导入功能恢复。" showIcon />
        </Space>
      </Modal>
      <Modal title="导出" open={exportModalOpen} okText="选择路径并导出" cancelText="取消" confirmLoading={exportLoading} onOk={() => void runExport()} onCancel={() => setExportModalOpen(false)}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(exportConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>范围：</Typography.Text>{exportScope === 'table' ? `表 ${exportTable}` : exportScope === 'schema' ? `模式 ${exportPgDatabase}` : `数据库 ${exportDatabase || '默认'}`}</Typography.Text>
          <Form layout="vertical">
            <Form.Item label="导出格式">
              <Select value={exportFormat} onChange={(value) => setExportFormat(value)} options={[{ label: 'SQL 脚本', value: 'sql' }, { label: 'CSV', value: 'csv' }]} />
            </Form.Item>
            {exportFormat === 'sql' && (
              <Form.Item label="导出内容">
                <Select value={exportContent} onChange={(value) => setExportContent(value)} options={[{ label: '结构 + 数据', value: 'schema_data' }, { label: '仅结构', value: 'schema' }, { label: '仅数据', value: 'data' }]} />
              </Form.Item>
            )}
          </Form>
          {exportFormat === 'csv' && exportScope !== 'table' && <Alert type="info" message="CSV 多表导出将创建目录，每表一个 CSV 文件" showIcon />}
          {exportFormat === 'sql' && <Alert type="info" message="SQL 导出用于迁移或查看，可选择仅结构、仅数据或结构+数据；完整可恢复请使用备份。" showIcon />}
        </Space>
      </Modal>
      <Modal title="导入" open={importModalOpen} okText="导入" cancelText="取消" confirmLoading={importLoading} onOk={() => void runImport()} onCancel={() => setImportModalOpen(false)} okButtonProps={{ disabled: !importPath }}>
        <Space direction="vertical" className="full-width">
          <Typography.Text><Typography.Text strong>连接：</Typography.Text>{getConnection(importConnectionId)?.name}</Typography.Text>
          <Typography.Text><Typography.Text strong>目标：</Typography.Text>{importTable ? `表 ${importTable}` : importPgDatabase ? `模式 ${importPgDatabase}` : `数据库 ${importDatabase || '默认'}`}</Typography.Text>
          <Form layout="vertical">
            <Form.Item label="导入文件 (SQL/CSV，自动按扩展名识别)" required>
              <Input readOnly placeholder="请选择导入文件" value={importPath} addonAfter={<Button type="link" size="small" onClick={() => void selectImportFilePath()}>选择</Button>} />
            </Form.Item>
          </Form>
          <Alert type="warning" message="导入 SQL 会逐条执行文件内所有语句；导入 CSV 会 INSERT 到目标表，需确保表结构与 CSV 表头一致。" showIcon />
        </Space>
      </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default App
