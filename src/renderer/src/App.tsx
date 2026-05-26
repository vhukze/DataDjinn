import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
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
  ReloadOutlined,
  RobotOutlined,
  SunOutlined,
  TableOutlined
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
import { useEffect, useRef, useState } from 'react'
import { useTheme } from './context/ThemeContext'
import AIPanel from './components/AIPanel'
import SqlEditor from './components/SqlEditor'
import type { SqlCompletionColumn, SqlCompletionContext, SqlCompletionTable } from './components/SqlEditor'
import mysqlIcon from './assets/icons/mysql.png'
import postgresIcon from './assets/icons/postgres.png'
import sqliteIcon from './assets/icons/sqllite.png'
import dmIcon from './assets/icons/dm.svg'

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

const COMMON_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT',
  'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'TEXT',
  'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
  'BOOLEAN',
  'DATE', 'DATETIME', 'TIMESTAMP',
  'BLOB', 'BYTEA'
]

type DatabaseType = 'sqlite' | 'mysql' | 'postgresql' | 'dm'
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

type TreeNodeKind = 'connection' | 'database' | 'pg-schema' | 'tables-root' | 'table' | 'column'

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

type DatabaseTreeNode = DataNode & {
  kind: TreeNodeKind
  connectionId?: string
  databaseName?: string
  pgDatabaseName?: string
  tableName?: string
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

function App(): React.JSX.Element {
  const [form] = Form.useForm<ConnectionFormValues>()
  const databaseType = Form.useWatch('database_type', form) ?? 'sqlite'
  const [messageApi, contextHolder] = message.useMessage()
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'starting', message: '后端状态初始化中' })
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState<string | null>(null)
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
  const [resourcePanelSize, setResourcePanelSize] = useState(340)
  const [aiPanelSize, setAiPanelSize] = useState(360)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
  const [aiContextSources, setAiContextSources] = useState<AIContextSource[]>([])
  const [aiActiveContext, setAiActiveContext] = useState<AIActiveContext | undefined>()
  const [queryCounter, setQueryCounter] = useState(1)
  const [tableEditorOpen, setTableEditorOpen] = useState(false)
  const [tableEditorLoading, setTableEditorLoading] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<string>()
  const [editingDatabaseName, setEditingDatabaseName] = useState<string>()
  const [editingTableName, setEditingTableName] = useState<string>()
  const [editingColumns, setEditingColumns] = useState<ColumnInfo[]>([])
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordModalTitle, setPasswordModalTitle] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [visiblePassword, setVisiblePassword] = useState('')
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
  const [createTableModalOpen, setCreateTableModalOpen] = useState(false)
  const [createTableConnectionId, setCreateTableConnectionId] = useState<string>('')
  const [createTableDatabaseName, setCreateTableDatabaseName] = useState<string>('')
  const [createTablePgDatabaseName, setCreateTablePgDatabaseName] = useState<string>('')
  const [createTableLoading, setCreateTableLoading] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableColumns, setNewTableColumns] = useState<ColumnDef[]>([])
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
  const [completionTables, setCompletionTables] = useState<Record<string, string[]>>({})

  const { theme, toggleTheme } = useTheme()

  const apiBaseUrl = backendStatus.apiBaseUrl

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
          { key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> },
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
              openConnectionModal('sqlite')
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
          {connection.has_password && (
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={(event) => {
                event.stopPropagation()
                void showConnectionPassword(connection)
              }}
            />
          )}
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

  const buildConnectionNode = (connection: ConnectionInfo): DatabaseTreeNode => ({
    key: `connection:${connection.connection_id}`,
    title: connection.name,
    icon:
      connection.database_type === 'postgresql' ? (
        <img src={postgresIcon} alt="PG" style={{ width: 16, height: 16 }} />
      ) : connection.database_type === 'mysql' ? (
        <img src={mysqlIcon} alt="MySQL" style={{ width: 16, height: 16 }} />
      ) : connection.database_type === 'dm' ? (
        <img src={dmIcon} alt="DM" style={{ width: 16, height: 16 }} />
      ) : (
        <img src={sqliteIcon} alt="SQLite" style={{ width: 16, height: 16 }} />
      ),
    kind: 'connection',
    connectionId: connection.connection_id,
    children:
      connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm'
        ? undefined
        : [
            {
              key: `tables:${connection.connection_id}`,
              title: '表',
              icon: <TableOutlined />,
              kind: 'tables-root',
              connectionId: connection.connection_id,
              isLeaf: false
            }
          ],
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

    if (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm') {
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
          return k.startsWith(`pg-schema:${connectionId}:`) || k.startsWith(`table:${connectionId}:`)
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

  const getTableScrollY = (): number => {
    const windowHeight = typeof window === 'undefined' ? 720 : window.innerHeight
    return Math.max(220, windowHeight - 430)
  }

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
      messageApi.error('复制失败')
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
    }
  }

  const openTableQuery = (connectionId: string, tableName: string, databaseName?: string, pgDatabaseName?: string): void => {
    setSelectedConnectionId(connectionId)
    openQueryWorkspace(`select * from ${quoteTableName(connectionId, tableName, databaseName)} limit 1000;`, `${tableName} 查询`, connectionId, databaseName, pgDatabaseName)
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
      messageApi.error(err instanceof Error ? err.message : '加载字段失败')
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
      messageApi.error(err instanceof Error ? err.message : '保存表结构失败')
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
          <div style={{ maxHeight: 260, overflowY: 'auto', minWidth: 160 }}>
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
      const schemaCount = (selectedSchemas[selKey] ?? allSchemas[selKey] ?? []).length
      const selectedCount = (selectedSchemas[selKey] ?? []).length

      return (
        <Flex align="center" justify="space-between" className="tree-title-row">
          <div className="tree-title-with-size">
            <Dropdown
              trigger={['contextMenu']}
              menu={{
                items: [
                  { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
                  ...(isPgDb ? [{ key: 'new-schema', label: '新建模式', icon: <PlusOutlined /> }] : []),
                  ...(!isPgDb ? [{ key: 'new-table', label: '新建表', icon: <PlusOutlined /> }] : []),
                  { key: 'run-sql', label: '运行 SQL 文件', icon: <PlayCircleOutlined /> }
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
                    setNewTableColumns([
                      { key: 'col-0', name: 'id', type: conn?.database_type === 'postgresql' ? 'INTEGER' : 'INT', nullable: false, primaryKey: true },
                      { key: 'col-1', name: 'name', type: 'VARCHAR(100)', nullable: false, primaryKey: false }
                    ])
                    setCreateTableModalOpen(true)
                  }
                  if (key === 'run-sql') {
                    void openSqlFileDialog(connectionId, databaseName, pgDbName)
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
                  setActiveSelector(selKey)
                } else {
                  setActiveSelector(null)
                  refreshDatabaseNode(connectionId, databaseName)
                }
              }}
              content={
                <div style={{ maxHeight: 260, overflowY: 'auto', minWidth: 160 }}>
                  <Checkbox.Group
                    value={selectedSchemas[selKey] ?? []}
                    onChange={(values) => {
                      if (values.length === 0) {
                        return
                      }

                      setSelectedSchemas((current) => ({
                        ...current,
                        [selKey]: values as string[]
                      }))
                      setTimeout(() => refreshDatabaseNode(connectionId, databaseName), 0)
                    }}
                  >
                    <Flex vertical gap={4}>
                      {(allSchemas[selKey] ?? []).map((schemaName) => (
                        <Checkbox key={schemaName} value={schemaName}>
                          {schemaName}
                        </Checkbox>
                      ))}
                    </Flex>
                  </Checkbox.Group>
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

    if (node.kind !== 'table' || !node.connectionId || !node.tableName) {
      return node.title as React.ReactNode
    }

    const connectionId = node.connectionId
    const databaseName = node.databaseName
    const pgDbName = node.pgDatabaseName
    const tableName = node.tableName

    return (
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [
            { key: 'preview', label: '预览数据' },
            { key: 'select', label: '生成 SELECT 查询' },
            { key: 'edit', label: '修改表' },
            { key: 'copy', label: '复制表名' }
          ],
          onClick: ({ key }) => {
            if (key === 'preview') {
              void previewTable(connectionId, tableName, databaseName, pgDbName)
            }
            if (key === 'select') {
              openTableQuery(connectionId, tableName, databaseName, pgDbName)
            }
            if (key === 'edit') {
              void openTableEditor(connectionId, tableName, databaseName)
            }
            if (key === 'copy') {
              void copyTableName(tableName)
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
    const tableRows: EditableRow[] = tab.kind === 'preview' ? (tab.editRows ?? []) : (tab.result?.rows.map((row, index) => ({ ...row, __rowKey: `query:${index}` })) ?? [])
    const selectedRowKeyMap = tab.selectedRowKeyMap ?? Object.fromEntries((tab.selectedRowKeys ?? []).map((key) => [String(key), true]))
    const selectedRowKeys = Object.keys(selectedRowKeyMap)
    const allCurrentRowKeys = tableRows.map((row) => row.__rowKey)
    const allCurrentRowsSelected = allCurrentRowKeys.length > 0 && allCurrentRowKeys.every((key) => selectedRowKeyMap[key])
    const rowNumberOffset = ((tab.page ?? 1) - 1) * (tab.limit ?? 1000)

    const updateSelectedRows = (nextSelectedRowKeys: React.Key[]): void => {
      updateWorkspaceTab(tab.key, {
        selectedRowKeys: nextSelectedRowKeys,
        selectedRowKeyMap: Object.fromEntries(nextSelectedRowKeys.map((key) => [String(key), true]))
      })
    }

    const toggleCurrentRow = (rowKey: string): void => {
      const nextSelected = new Set(selectedRowKeys)
      if (nextSelected.has(rowKey)) {
        nextSelected.delete(rowKey)
      } else {
        nextSelected.add(rowKey)
      }
      updateSelectedRows([...nextSelected])
    }

    const toggleAllCurrentRows = (): void => {
      if (allCurrentRowsSelected) {
        const currentRowKeySet = new Set(allCurrentRowKeys)
        updateSelectedRows(selectedRowKeys.filter((key) => !currentRowKeySet.has(String(key))))
        return
      }

      updateSelectedRows([...new Set([...selectedRowKeys, ...allCurrentRowKeys])])
    }

    const rowNumberColumn: ColumnsType<EditableRow>[number] = {
      title: (
        <button type="button" className={`row-number-select-all${allCurrentRowsSelected ? ' selected' : ''}`} title="选中当前页全部数据" onClick={toggleAllCurrentRows}>
          #
        </button>
      ),
      key: '__rowNumber',
      width: 46,
      fixed: 'left',
      className: 'row-number-cell',
      render: (_value: unknown, row: EditableRow, index: number) => {
        const selected = Boolean(selectedRowKeyMap[row.__rowKey])
        return (
          <button type="button" className={`row-number-button${selected ? ' selected' : ''}`} title="选中当前行" onClick={() => toggleCurrentRow(row.__rowKey)}>
            {rowNumberOffset + index + 1}
          </button>
        )
      }
    }

    const dataColumns: ColumnsType<EditableRow> =
      tab.result?.columns.map((column) => ({
        title: column,
        dataIndex: column,
        key: column,
        width: 180,
        ellipsis: true,
        render: (value: unknown, row: EditableRow) => (tab.kind === 'preview' ? renderEditableCell(tab, row, column, value) : <span className="table-cell-text">{value === null || value === undefined ? 'NULL' : String(value)}</span>)
      })) ?? []
    const tableColumns: ColumnsType<EditableRow> = tab.kind === 'preview' ? [rowNumberColumn, ...dataColumns] : dataColumns
    const tableScrollX = Math.max((tab.result?.columns.length ?? 0) * 180 + (tab.kind === 'preview' ? 46 : 0), 720)

    return (
      <div className="result-table-shell">
        {renderResultStatus(tab)}
        {renderTableToolbar(tab)}
        {tab.error && <Alert message="执行失败" description={tab.error} type="error" showIcon />}
        {tab.result?.limited && <Alert message="还有更多数据，可点击下一页继续查看" type="warning" showIcon />}
        <div className="result-table-body">
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
            scroll={{ x: tableScrollX, y: getTableScrollY() }}
            tableLayout="fixed"
            virtual={tableRows.length > 80}
            locale={{ emptyText: tab.kind === 'query' ? '暂无查询结果' : '暂无表数据' }}
          />
        </div>
      </div>
    )
  }

  const getDefaultDatabaseName = (connection: ConnectionInfo): string | undefined => {
    if (connection.database_type !== 'mysql') {
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
                const nextDb = nextConn?.database_type === 'mysql' ? getDefaultDatabaseName(nextConn) : undefined
                const nextPgDb = nextConn?.database_type === 'postgresql' ? getDefaultPgDatabase(nextConn!) : undefined
                updateWorkspaceTab(tab.key, {
                  connectionId,
                  databaseName: nextDb,
                  pgDatabaseName: nextPgDb
                })

                if (nextConn?.database_type === 'mysql' && nextDb) {
                  void preloadCompletionForDatabase(connectionId, nextDb)
                }
              }}
              options={connections.map((c) => ({ label: c.name, value: c.connection_id }))}
            />
            {(isMysql || isPg || isDm) && (
              <Select
                className="database-select"
                placeholder={isPg ? '选择 Database' : isDm ? '选择 Schema' : '选择库'}
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
            <Button type="primary" icon={<PlayCircleOutlined />} loading={tab.loading} onClick={() => void runQuery(tab)}>
              执行
            </Button>
          </Space>
          <div className="sql-editor-container">
            <SqlEditor
              value={tab.sql}
              onChange={(sql) => updateWorkspaceTab(tab.key, { sql })}
              onExecute={() => void runQuery(tab)}
              theme={theme}
              completionContext={buildSqlCompletionContext(tab)}
            />
          </div>
          {renderResultTable(tab)}
        </div>
      )
    }

    return <div className="query-workspace">{renderResultTable(tab)}</div>
  }

  const checkHealth = async (): Promise<void> => {
    setHealthLoading(true)
    setHealthError(null)

    try {
      setHealth(await requestJson<HealthStatus>('/health'))
    } catch (err) {
      setHealth(null)
      setHealthError(err instanceof Error ? err.message : '无法连接后端服务')
    } finally {
      setHealthLoading(false)
    }
  }

  const loadConnections = async (): Promise<void> => {
    const data = await requestJson<{ connections: ConnectionInfo[] }>('/connections')
    setConnections(data.connections)
    setSelectedConnectionId((current) => current ?? data.connections[0]?.connection_id)

    for (const connection of data.connections) {
      if (connection.is_open && (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm')) {
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

              return { ...current, [connection.connection_id]: dbNames }
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

      if (connection?.database_type !== 'mysql' && connection?.database_type !== 'postgresql' && connection?.database_type !== 'dm') {
        return []
      }

      const data = await requestJson<{ databases: DatabaseInfo[] }>(`/connections/${node.connectionId}/databases`)
      const dbNames = data.databases.map((d) => d.name)

      const currentSelected = selectedDatabasesRef.current[node.connectionId!]
      const nextSelected = currentSelected ? filterPersistedValues(currentSelected, dbNames) : dbNames

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
    }

    if ((node.kind === 'tables-root' || node.kind === 'database' || node.kind === 'pg-schema') && node.connectionId) {
      const pgDb = node.kind === 'pg-schema' ? node.pgDatabaseName : undefined
      const queryPath = pgDb
        ? withPgDatabase(`/connections/${node.connectionId}/tables`, node.databaseName, pgDb)
        : withDatabaseQuery(`/connections/${node.connectionId}/tables`, node.databaseName)
      const data = await requestJson<{ tables: TableInfo[] }>(queryPath)
      return data.tables.map<DatabaseTreeNode>((table) => ({
        key: `table:${node.connectionId}:${node.databaseName ?? 'main'}:${table.name}`,
        title: table.name,
        icon: <TableOutlined />,
        kind: 'table',
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        pgDatabaseName: pgDb,
        tableName: table.name,
        sizeDisplay: table.size_display,
        sizeBytes: table.size_bytes,
        storageSizeDisplay: table.storage_size_display,
        storageSizeBytes: table.storage_size_bytes,
        rowCount: table.row_count,
        isLeaf: false
      }))
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
        return k.startsWith(`database:${connectionId}:`) || k.startsWith(`pg-schema:${connectionId}:`) || k.startsWith(`table:${connectionId}:`)
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
      } else if (kind === 'table') {
        let pgDatabaseName: string | undefined

        for (const k of expandedSnapshot) {
          if (k.startsWith(`pg-schema:${connectionId}:`)) {
            const ps = k.split(':')
            if (ps[3] === parts[2]) {
              pgDatabaseName = ps[2]
              break
            }
          }
        }

        await reloadNodeChildren({
          key,
          kind: 'table',
          connectionId,
          databaseName: parts[2],
          pgDatabaseName,
          tableName: parts.slice(3).join(':'),
          isLeaf: false
        })
      }
    }
  }

  const reloadNodeChildren = async (node: DatabaseTreeNode): Promise<void> => {
    const children = await loadChildrenForNode(node)
    setTreeData((current) => updateTreeNode(current, node.key, children))
    setExpandedKeys((current) => current.includes(node.key) ? current : [...current, node.key])
  }

  const isLoadableTreeNode = (node: DatabaseTreeNode): boolean =>
    node.kind === 'connection' || node.kind === 'database' || node.kind === 'pg-schema' || node.kind === 'tables-root'

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

  const showConnectionPassword = async (connection: ConnectionInfo): Promise<void> => {
    setPasswordModalTitle(connection.name)
    setVisiblePassword('')
    setPasswordModalOpen(true)
    setPasswordLoading(true)

    try {
      const data = await requestJson<{ password: string }>(`/connections/${connection.connection_id}/password`)
      setVisiblePassword(data.password)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '读取密码失败')
      setPasswordModalOpen(false)
    } finally {
      setPasswordLoading(false)
    }
  }

  const openConnectionModal = (nextDatabaseType: DatabaseType): void => {
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
      form.setFieldsValue({
        database_type: 'dm',
        name: '达梦',
        host: '127.0.0.1',
        port: 5236,
        username: 'SYSDBA'
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
      form.setFieldsValue(data)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '加载连接信息失败')
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
      { key: 'dm', label: '达梦', icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} /> }
    ],
    onClick: ({ key }: { key: string }) => openConnectionModal(key as DatabaseType)
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
        messageApi.error(result.message || '数据库连接测试失败')
      }
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '测试连接失败')
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
      messageApi.error(err instanceof Error ? err.message : connectionMode === 'edit' ? '更新连接失败' : '创建连接失败')
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
      messageApi.error(err instanceof Error ? err.message : '打开连接失败')
    }
  }

  const closeConnectionById = async (connectionId: string): Promise<void> => {
    try {
      const connection = await requestJson<ConnectionInfo>(`/connections/${connectionId}/close`, { method: 'POST' })
      setConnections((current) => current.map((c) => (c.connection_id === connectionId ? connection : c)))
      setExpandedKeys((keys) => keys.filter((k) => !String(k).startsWith(`connection:${connectionId}`) && !String(k).includes(`:${connectionId}:`)))
      setTreeData((current) => replaceConnectionNode(current, connection))
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '关闭连接失败')
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

  const createDatabase = async (): Promise<void> => {
    if (!ensureConnectionOpen(creatingDatabaseConnectionId)) {
      return
    }

    if (!databaseCreateName.trim()) {
      return
    }

    setDatabaseCreateLoading(true)
    const isSchema = !!creatingSchemaDatabaseName

    try {
      if (isSchema) {
        const schemaUrl = `/connections/${creatingDatabaseConnectionId}/schemas?database=${encodeURIComponent(creatingSchemaDatabaseName)}`
        await requestJson(schemaUrl, {
          method: 'POST',
          body: JSON.stringify({ name: databaseCreateName.trim() })
        })
      } else {
        await requestJson(`/connections/${creatingDatabaseConnectionId}/databases`, {
          method: 'POST',
          body: JSON.stringify({ name: databaseCreateName.trim() })
        })
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
        const dbName = databaseCreateName.trim()
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
      messageApi.error(err instanceof Error ? err.message : isSchema ? '创建模式失败' : '创建数据库失败')
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

      const sql = `CREATE TABLE ${newTableName.trim()} (\n  ${columnDefs.join(',\n  ')}\n);`

      const result = await requestJson<SqlFileRunResponse>(`/connections/${createTableConnectionId}/sql-file`, {
        method: 'POST',
        body: JSON.stringify({ sql, database: createTableDatabaseName || undefined, pg_database: createTablePgDatabaseName || undefined })
      })

      if (result.failed_count > 0) {
        messageApi.error(result.errors[0] ?? '创建表失败')
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
      messageApi.error(err instanceof Error ? err.message : '创建表失败')
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
      messageApi.error('SQL 文件大小超过 5MB 限制')
      return
    }

    const connection = getConnection(connectionId)
    let databases: DatabaseInfo[] = []
    let defaultDb = databaseName ?? ''
    let defaultPgDb = pgDatabaseName ?? ''

    if (connection?.database_type === 'mysql' || connection?.database_type === 'postgresql') {
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

      if (result.failed_count > 0) {
        messageApi.error(`执行完成：${result.success_count} 条成功，${result.failed_count} 条失败`)
      }

      refreshConnectionNode(sqlFileConnectionId)

      if (sqlFileDatabase) {
        refreshDatabaseNode(sqlFileConnectionId, sqlFileDatabase)
      }
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '执行 SQL 文件失败')
    } finally {
      setSqlFileLoading(false)
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
    updateWorkspaceTab(tab.key, { editRows: [...(tab.editRows ?? []), row] })
  }

  const markSelectedRowsDeleted = (tab: WorkspaceTab): void => {
    const selected = tab.selectedRowKeyMap ? new Set(Object.keys(tab.selectedRowKeyMap)) : new Set((tab.selectedRowKeys ?? []).map(String))
    const editRows = (tab.editRows ?? [])
      .filter((row) => !(row.__state === 'inserted' && selected.has(row.__rowKey)))
      .map((row) => (selected.has(row.__rowKey) ? { ...row, __deleted: true } : row))
    updateWorkspaceTab(tab.key, { editRows, selectedRowKeys: [], selectedRowKeyMap: {} })
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
      updateWorkspaceTab(tab.key, { result, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, editingCell: undefined, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '提交表数据失败' })
      messageApi.error(err instanceof Error ? err.message : '提交表数据失败')
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
      updateWorkspaceTab(tabKey, { result, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, editingCell: undefined, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载表数据失败' })
      messageApi.error(err instanceof Error ? err.message : '加载表数据失败')
    }
  }

  const openQueryWorkspace = (initialSql = 'select * from users;', title?: string, connectionId?: string, databaseName?: string, pgDatabaseName?: string): void => {
    const nextIndex = queryCounter
    const tabKey = `query:${Date.now()}:${nextIndex}`
    const connId = connectionId ?? selectedConnectionId
    const connection = getConnection(connId)

    let finalDb = databaseName
    let finalPgDb = pgDatabaseName

    if (connection?.database_type === 'mysql' && !finalDb) {
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

      if (connection?.database_type === 'mysql' && finalDb) {
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

  const runQuery = async (tab: WorkspaceTab): Promise<void> => {
    if (!tab.connectionId) {
      return
    }

    if (!ensureConnectionOpen(tab.connectionId)) {
      return
    }

    const connection = getConnection(tab.connectionId)

    if (connection?.database_type === 'mysql' && !tab.databaseName) {
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
          sql: tab.sql,
          limit: tab.limit ?? 1000,
          offset: Math.max(0, (tab.page ?? 1) - 1) * (tab.limit ?? 1000),
          database: connection?.database_type === 'mysql' ? (tab.databaseName || undefined) : undefined,
          pg_database: connection?.database_type === 'postgresql' ? (tab.pgDatabaseName || undefined) : undefined
        })
      })
      updateWorkspaceTab(tab.key, { result, page: tab.page ?? 1, loading: false, error: undefined })
    } catch (err) {
      updateWorkspaceTab(tab.key, { loading: false, error: err instanceof Error ? err.message : '查询失败' })
      messageApi.error(err instanceof Error ? err.message : '查询失败')
    }
  }

  const restartBackend = async (): Promise<void> => {
    setHealthLoading(true)
    setHealthError(null)

    try {
      setBackendStatus(await window.api.restartBackend())
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '重启后端失败')
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
    if (backendStatus.state !== 'online' || !backendStatus.apiBaseUrl) {
      setHealth(null)
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

  const backendReady = backendStatus.state === 'online'
  const backendStatusIcon = backendReady ? <CheckCircleOutlined /> : <CloseCircleOutlined />
  const activeConnection = getConnection(selectedConnectionId)
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
            <div className="brand-mark"><DatabaseOutlined /></div>
            <div>
              <Typography.Title level={4} className="brand-title">DataDjinn</Typography.Title>
              <Typography.Text className="brand-subtitle">Database Workspace</Typography.Text>
            </div>
          </Space>
          <div className="titlebar-spacer" />
          <Space className="toolbar-actions titlebar-no-drag" size={4}>
            <Dropdown menu={connectionCreateMenu} trigger={['click']}>
              <Button type="text" size="small" icon={<PlusOutlined />} title="新建连接" aria-label="新建连接" />
            </Dropdown>
            <Button type="text" size="small" icon={<CodeOutlined />} onClick={() => openQueryWorkspace()} title="新建查询" aria-label="新建查询" />
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
                  virtual={false}
                  treeData={treeData}
                  expandedKeys={expandedKeys}
                  onExpand={(keys, info) => {
                    const node = info.node as DatabaseTreeNode
                    if (info.expanded && (!node.children || node.children.length === 0) && isLoadableTreeNode(node)) {
                      void reloadNodeChildren({ ...node, isLeaf: false })
                      return
                    }
                    if (!info.expanded) {
                      collapseTreeNode(node)
                      return
                    }
                    setExpandedKeys(keys)
                  }}
                  loadData={(node) => loadTreeData(node as DatabaseTreeNode)}
                  titleRender={(node) => renderTreeTitle(node as DatabaseTreeNode)}
                  selectedKeys={selectedConnectionId ? [`connection:${selectedConnectionId}`] : []}
                  onSelect={(_, info) => {
                    const node = info.node as DatabaseTreeNode
                    if (node.connectionId) {
                      setSelectedConnectionId(node.connectionId)
                    }
                  }}
                  onDoubleClick={(_, node) => {
                    const treeNode = node as DatabaseTreeNode
                    if (treeNode.kind === 'database' || treeNode.kind === 'pg-schema') {
                      activateAIContextFromNode(treeNode)
                    }
                    if (treeNode.kind === 'table' && treeNode.connectionId && treeNode.tableName) {
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
                      <div className="empty-workspace"><CodeOutlined /><Typography.Text type="secondary">连接数据库后，可浏览库表结构、预览数据、编写 SQL，并让 Djinn Agent 辅助分析与执行受控操作。</Typography.Text><Space><Dropdown menu={connectionCreateMenu} trigger={['click']}><Button icon={<PlusOutlined />}>创建连接</Button></Dropdown></Space></div>
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
                        pgDatabase: aiPgDatabase
                      }}
                      workspace={{
                        active_sql: activeTab?.sql,
                        selected_table: activeTab?.tableName,
                        recent_queries: workspaceTabs.filter((tab) => tab.kind === 'query' && tab.sql.trim()).slice(-5).map((tab) => tab.sql),
                        visible_result_columns: activeTab?.result?.columns ?? [],
                        visible_result_sample: activeTab?.result?.rows.slice(0, 5) ?? [],
                        context_sources: effectiveAIContextSources
                      }}
                      contextSources={effectiveAIContextSources}
                      primaryContextSourceId={primaryAIContextSource?.id}
                      onRemoveContextSource={removeAIContextSource}
                    />
                  </Splitter.Panel>
                )}
              </Splitter>
            </div>
          </Splitter.Panel>
        </Splitter>
      </Layout.Content>
      <Layout.Footer className="app-statusbar">
        <Space split={<span className="status-separator" />}>
          <span>{backendReady ? `Backend ${health?.version ?? ''}` : healthError ?? backendStatus.message ?? 'Backend offline'}</span>
          {backendStatus.logPath && <span>{backendStatus.logPath}</span>}
          <span>{activeConnection ? `${activeConnection.database_type.toUpperCase()} · ${activeConnection.database}` : 'No connection selected'}</span>
          <span>{workspaceTabs.length} tabs</span>
        </Space>
      </Layout.Footer>
      <Modal title={editingTableName ? `修改表：${editingTableName}` : '修改表'} open={tableEditorOpen} okText="保存" cancelText="取消" confirmLoading={tableEditorLoading} onOk={() => void saveTableEditor()} onCancel={() => setTableEditorOpen(false)} width={760}>
        <Alert message="支持 SQLite/MySQL 修改已有字段的类型、可空和单字段主键；当前不支持新增、删除或重命名字段。" type="warning" showIcon />
        <Table className="table-editor-grid" size="small" loading={tableEditorLoading} rowKey="name" pagination={false} dataSource={editingColumns} columns={[{ title: '字段名', dataIndex: 'name', key: 'name', render: (value: string) => <Input value={value} disabled /> }, { title: '类型', dataIndex: 'type', key: 'type', render: (value: string, column: ColumnInfo) => <Input value={value} onChange={(event) => { setEditingColumns((current) => current.map((item) => (item.name === column.name ? { ...item, type: event.target.value } : item))) }} /> }, { title: '可空', dataIndex: 'nullable', key: 'nullable', width: 90, render: (value: boolean, column: ColumnInfo) => <Switch checked={value} disabled={column.primary_key} onChange={(checked) => { setEditingColumns((current) => current.map((item) => (item.name === column.name ? { ...item, nullable: checked } : item))) }} /> }, { title: '主键', dataIndex: 'primary_key', key: 'primary_key', width: 90, render: (value: boolean, column: ColumnInfo) => <Switch checked={value} onChange={(checked) => { setEditingColumns((current) => current.map((item) => ({ ...item, primary_key: item.name === column.name ? checked : false }))) }} /> }]} />
      </Modal>
      <Modal title={passwordModalTitle ? `查看密码：${passwordModalTitle}` : '查看密码'} open={passwordModalOpen} footer={null} onCancel={() => setPasswordModalOpen(false)}>
        <Alert message="密码使用当前 Windows 用户凭据加密保存在本机，仅当前系统用户可解密。" type="info" showIcon />
        <Input.Password className="password-viewer" value={passwordLoading ? '读取中...' : visiblePassword} readOnly />
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
            {sqlFileResult.errors.length > 0 && (<div className="sql-file-errors"><Typography.Text strong>错误信息：</Typography.Text>{sqlFileResult.errors.map((err, index) => (<Alert key={index} type="error" message={err} />))}</div>)}
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
      <Modal title="新建表" open={createTableModalOpen} okText="创建" cancelText="取消" confirmLoading={createTableLoading} onOk={() => void createTable()} onCancel={() => setCreateTableModalOpen(false)} width={680} okButtonProps={{ disabled: !newTableName.trim() || newTableColumns.filter((c) => c.name.trim()).length === 0 }}>
        <Form layout="vertical">
          <Form.Item label="表名" required><Input placeholder="请输入表名" value={newTableName} onChange={(event) => setNewTableName(event.target.value)} /></Form.Item>
          <Form.Item label="字段定义">
            <Table size="small" rowKey="key" pagination={false} dataSource={newTableColumns} columns={[{ title: '字段名', dataIndex: 'name', width: 160, render: (value: string, col: ColumnDef) => <Input size="small" value={value} placeholder="字段名" onChange={(event) => updateNewColumn(col.key, { name: event.target.value })} /> }, { title: '类型', dataIndex: 'type', width: 160, render: (value: string, col: ColumnDef) => <Select size="small" style={{ width: '100%' }} value={value} onChange={(v) => updateNewColumn(col.key, { type: v })} options={COMMON_TYPES.map((t) => ({ label: t, value: t }))} /> }, { title: '可空', dataIndex: 'nullable', width: 60, render: (value: boolean, col: ColumnDef) => <Switch size="small" checked={value} disabled={col.primaryKey} onChange={(checked) => updateNewColumn(col.key, { nullable: checked })} /> }, { title: '主键', dataIndex: 'primaryKey', width: 60, render: (value: boolean, col: ColumnDef) => <Switch size="small" checked={value} onChange={(checked) => updateNewColumn(col.key, { primaryKey: checked, nullable: checked ? false : col.nullable })} /> }, { title: '', width: 40, render: (_: unknown, col: ColumnDef) => <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNewColumn(col.key)} /> }]} />
          </Form.Item>
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addNewColumn}>添加字段</Button>
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
              <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}><InputNumber min={1} max={65535} className="full-width" placeholder={databaseType === 'postgresql' ? '5432' : databaseType === 'dm' ? '5236' : '3306'} /></Form.Item>
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'dm' ? 'SYSDBA' : undefined} /></Form.Item>
              <Form.Item name="password" label="密码"><Input.Password /></Form.Item>
              <Form.Item name="database" label={databaseType === 'postgresql' ? '数据库名' : databaseType === 'dm' ? '默认 Schema（可选）' : '默认数据库（可选）'} rules={databaseType === 'postgresql' ? [{ required: true, message: '请输入数据库名' }] : undefined}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'dm' ? '不填则使用默认 Schema' : '不填则连接服务器并加载全部数据库'} /></Form.Item>
            </>
          )}
        </Form>
      </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default App
