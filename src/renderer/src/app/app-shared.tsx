import { DatabaseOutlined } from '@ant-design/icons'
import { Button, Flex, Space, Typography } from 'antd'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { memo } from 'react'
import type React from 'react'
import type { ShortcutAction, ShortcutSettings } from './app-model'
import type { ColumnInfo } from './connection-model'
import type { DatabaseType } from './data-sources'
import type { SqlStatementInfo } from '../components/SqlEditor'
import type { EditableRow, RedisKeyEdit, WorkspaceTab } from './workspace-model'
import dmIcon from '../assets/icons/dm.svg'

export const renderMarkdown = (content: string): { __html: string } => ({
  __html: DOMPurify.sanitize(marked.parse(content || '') as string)
})

export const COMMON_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT',
  'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'TEXT',
  'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
  'BOOLEAN',
  'DATE', 'DATETIME', 'TIMESTAMP',
  'BLOB', 'BYTEA'
]

const INTEGER_TYPE_PREFIXES = ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'serial', 'bigserial', 'smallserial', 'number']
const NUMERIC_TYPE_PREFIXES = [...INTEGER_TYPE_PREFIXES, 'decimal', 'numeric', 'float', 'double', 'real']

export const tableDesignerSupportsComments = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle'
export const tableDesignerSupportsUnique = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const tableDesignerSupportsAutoIncrement = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const tableDesignerSupportsAutoIncrementStep = (databaseType?: DatabaseType): boolean => databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle'
export const tableDesignerSupportsMinMax = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const tableDesignerSupportsEdit = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const isIntegerLikeType = (type: string): boolean => INTEGER_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))
export const isNumericLikeType = (type: string): boolean => NUMERIC_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))

export const PREVIEW_DEFAULT_LIMIT = 300
export const QUERY_DEFAULT_LIMIT = 1000
export const REDIS_DEFAULT_LIMIT = 500
export const RESULT_TABLE_VIRTUAL_THRESHOLD = 80
export const JDBC_COMPATIBLE_DATABASE_TYPES: DatabaseType[] = ['dm', 'gaussdb']

export const DATABASE_TYPE_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  postgresql: 'PG',
  dm: 'DM',
  gaussdb: 'Gauss',
  oracle: 'Oracle',
  mongodb: 'Mongo',
  redis: 'Redis',
  clickhouse: 'CK'
}

export type ImportConnectionSource = 'datagrip'
export type ImportConnectionCandidateStatus = 'ready' | 'warning' | 'error'
export type SshAuthType = 'password' | 'private_key'

export type ConnectionFormValues = {
  name: string
  database_type: DatabaseType
  host?: string
  port?: number | string
  username?: string
  password?: string
  database?: string
  sqlite_path?: string
  driver_id?: string
  driver_path?: string
  dm_driver_id?: string
  dm_driver_path?: string
  ssh_enabled?: boolean
  ssh_host?: string
  ssh_port?: number
  ssh_username?: string
  ssh_auth_type?: SshAuthType
  ssh_password?: string
  ssh_private_key_path?: string
  ssh_passphrase?: string
}

export type ImportConnectionCandidate = {
  key: string
  name: string
  database_type?: DatabaseType
  host?: string
  port?: number | string
  username?: string
  database?: string
  rawJdbcUrl?: string
  status: ImportConnectionCandidateStatus
  message?: string
  payload?: ConnectionFormValues
}

export type ImportConnectionResultItem = {
  name: string
  database_type?: DatabaseType
  message?: string
}

export type ImportConnectionResult = {
  success: ImportConnectionResultItem[]
  failed: ImportConnectionResultItem[]
}

export const IMPORT_CONNECTION_SOURCE_OPTIONS = [
  { label: 'DataGrip', value: 'datagrip' }
]

export const defaultPortForDatabaseType = (databaseType: DatabaseType): number | undefined => {
  if (databaseType === 'postgresql') return 5432
  if (databaseType === 'mysql') return 3306
  if (databaseType === 'dm') return 5236
  if (databaseType === 'gaussdb') return 8000
  if (databaseType === 'oracle') return 1521
  if (databaseType === 'mongodb') return 27017
  if (databaseType === 'redis') return 6379
  if (databaseType === 'clickhouse') return 8123
  return undefined
}

export const trimToUndefined = (value?: string | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const sanitizeImportedXml = (xml: string): string =>
  xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;')

export const inferDataGripDatabaseType = (params: {
  dbms?: string
  product?: string
  driverRef?: string
  jdbcDriver?: string
  jdbcUrl?: string
}): DatabaseType | undefined => {
  const fingerprint = [
    params.dbms,
    params.product,
    params.driverRef,
    params.jdbcDriver,
    params.jdbcUrl
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()

  if (fingerprint.includes('clickhouse')) return 'clickhouse'
  if (fingerprint.includes('postgres')) return 'postgresql'
  if (fingerprint.includes('gauss')) return 'gaussdb'
  if (fingerprint.includes('dm dbms') || fingerprint.includes('dm.jdbc.driver') || fingerprint.includes('jdbc:dm:')) return 'dm'
  if (fingerprint.includes('redis')) return 'redis'
  if (fingerprint.includes('oracle')) return 'oracle'
  if (fingerprint.includes('mysql')) return 'mysql'
  if (fingerprint.includes('mongo')) return 'mongodb'
  return undefined
}

export const parseJdbcUrlToConnectionFields = (jdbcUrl: string, databaseType: DatabaseType): Pick<ConnectionFormValues, 'host' | 'port' | 'database'> => {
  const normalized = jdbcUrl.trim()
  if (!normalized.toLowerCase().startsWith('jdbc:')) {
    throw new Error('不是有效的 JDBC URL')
  }

  const runtimeUrlValue = normalized.replace(/^jdbc:/i, '')
  let host: string | undefined
  let port: number | string | undefined
  let pathname = ''
  let schema: string | undefined

  try {
    const runtimeUrl = new URL(runtimeUrlValue)
    host = trimToUndefined(runtimeUrl.hostname)
    const parsedPort = runtimeUrl.port ? Number(runtimeUrl.port) : undefined
    port = Number.isFinite(parsedPort) ? parsedPort : undefined
    pathname = decodeURIComponent(runtimeUrl.pathname || '').replace(/^\/+/, '')
    schema = trimToUndefined(runtimeUrl.searchParams.get('schema'))
  } catch {
    const multiHostMatch = runtimeUrlValue.match(/^[a-z0-9+.-]+:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?$/i)
    if (!multiHostMatch) {
      throw new Error('不是有效的 JDBC URL')
    }

    const hostList = multiHostMatch[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const firstHost = hostList[0]
    if (!firstHost) {
      throw new Error('未解析到主机')
    }

    const firstHostMatch = firstHost.match(/^(?:\[([^\]]+)\]|([^:]+))(?:\:(\d+))?$/)
    if (!firstHostMatch) {
      throw new Error('未解析到主机')
    }

    host = trimToUndefined(firstHostMatch[1] || firstHostMatch[2])
    const portList = hostList
      .map((item) => {
        const match = item.match(/^(?:\[[^\]]+\]|[^:]+)(?:\:(\d+))?$/)
        return match?.[1]
      })
      .filter((item): item is string => Boolean(item))
    if (portList.length > 1 && databaseType === 'clickhouse') {
      port = portList.join(',')
    } else {
      const parsedPort = firstHostMatch[3] ? Number(firstHostMatch[3]) : undefined
      port = Number.isFinite(parsedPort) ? parsedPort : undefined
    }
    pathname = decodeURIComponent((multiHostMatch[2] || '').replace(/^\/+/, ''))
    const searchParams = new URLSearchParams(multiHostMatch[3] || '')
    schema = trimToUndefined(searchParams.get('schema'))
  }

  port = port ?? defaultPortForDatabaseType(databaseType)
  if (databaseType !== 'sqlite' && !host) {
    throw new Error('未解析到主机')
  }

  if (databaseType === 'dm') {
    return { host, port, database: schema ?? trimToUndefined(pathname) }
  }
  if (databaseType === 'redis') {
    return { host, port, database: trimToUndefined(pathname) ?? '0' }
  }
  return { host, port, database: trimToUndefined(pathname) }
}

export const parseDataGripImportText = (rawText: string): ImportConnectionCandidate[] => {
  const blockMatches = [...rawText.matchAll(/#LocalDataSource:\s*([^\r\n]+)[\r\n]+#BEGIN#([\s\S]*?)#END#/g)]
  const fallbackMatches = blockMatches.length === 0 ? [...rawText.matchAll(/#BEGIN#([\s\S]*?)#END#/g)] : []
  const blocks = blockMatches.length > 0
    ? blockMatches.map((match, index) => ({ key: `dg-${index}`, label: trimToUndefined(match[1]), xml: match[2] }))
    : fallbackMatches.map((match, index) => ({ key: `dg-${index}`, label: undefined, xml: match[1] }))

  return blocks.map<ImportConnectionCandidate>((block, index) => {
    try {
      const parsed = new DOMParser().parseFromString(sanitizeImportedXml(block.xml.trim()), 'application/xml')
      const parserError = parsed.querySelector('parsererror')
      if (parserError) {
        throw new Error('连接配置 XML 解析失败')
      }

      const dataSource = parsed.querySelector('data-source')
      if (!dataSource) {
        throw new Error('未找到 data-source 节点')
      }

      const databaseInfo = dataSource.querySelector('database-info')
      const jdbcUrl = trimToUndefined(dataSource.querySelector('jdbc-url')?.textContent)
      const username = trimToUndefined(dataSource.querySelector('user-name')?.textContent)
      const driverRef = trimToUndefined(dataSource.querySelector('driver-ref')?.textContent)
      const jdbcDriver = trimToUndefined(dataSource.querySelector('jdbc-driver')?.textContent)
      const product = trimToUndefined(databaseInfo?.getAttribute('product'))
      const dbms = trimToUndefined(databaseInfo?.getAttribute('dbms'))
      const databaseType = inferDataGripDatabaseType({ dbms, product, driverRef, jdbcDriver, jdbcUrl })
      const name = trimToUndefined(dataSource.getAttribute('name')) ?? block.label ?? `导入连接 ${index + 1}`

      if (!jdbcUrl) {
        throw new Error('未解析到 JDBC URL')
      }
      if (!databaseType) {
        throw new Error('当前仅支持导入已识别的 DataGrip 数据源类型')
      }

      const jdbcFields = parseJdbcUrlToConnectionFields(jdbcUrl, databaseType)
      const payload: ConnectionFormValues = {
        name,
        database_type: databaseType,
        host: jdbcFields.host,
        port: jdbcFields.port,
        username,
        password: '',
        database: jdbcFields.database,
        driver_id: undefined,
        dm_driver_id: undefined
      }

      const warnings: string[] = []
      if (databaseType === 'dm' || databaseType === 'gaussdb') {
        warnings.push(`导入后仍需在编辑连接中选择${DATABASE_TYPE_LABELS[databaseType]}驱动`)
      }

      return {
        key: block.key,
        name,
        database_type: databaseType,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        database: payload.database,
        rawJdbcUrl: jdbcUrl,
        status: warnings.length > 0 ? 'warning' : 'ready',
        message: warnings.join('；') || undefined,
        payload
      }
    } catch (error) {
      return {
        key: block.key,
        name: block.label ?? `导入连接 ${index + 1}`,
        rawJdbcUrl: undefined,
        status: 'error',
        message: error instanceof Error ? error.message : '解析失败'
      }
    }
  })
}

export const isDatabaseScopedType = (databaseType?: DatabaseType): databaseType is 'mysql' | 'mongodb' | 'redis' | 'clickhouse' =>
  databaseType === 'mysql' || databaseType === 'mongodb' || databaseType === 'redis' || databaseType === 'clickhouse'

export const isSchemaScopedType = (databaseType?: DatabaseType): databaseType is 'postgresql' | 'gaussdb' =>
  databaseType === 'postgresql' || databaseType === 'gaussdb'

export type DriverDatabaseType = 'dm' | 'gaussdb'
export type DriverType = 'jdbc' | 'python' | 'whl'

export type DriverInfo = {
  id: string
  database_type: DriverDatabaseType
  driver_type: DriverType
  name: string
  source: 'auto' | 'manual'
  enabled: boolean
  path?: string | null
}

const isDriverDatabaseType = (value: unknown): value is DriverDatabaseType => value === 'dm' || value === 'gaussdb'
const isDriverType = (value: unknown): value is DriverType => value === 'jdbc' || value === 'python' || value === 'whl'
const isDriverSource = (value: unknown): value is DriverInfo['source'] => value === 'auto' || value === 'manual'

export const normalizeDriverInfo = (value: unknown): DriverInfo | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<DriverInfo> & Record<string, unknown>
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return null
  }

  return {
    id: candidate.id,
    database_type: isDriverDatabaseType(candidate.database_type) ? candidate.database_type : 'dm',
    driver_type: isDriverType(candidate.driver_type) ? candidate.driver_type : 'jdbc',
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : '未命名驱动',
    source: isDriverSource(candidate.source) ? candidate.source : 'manual',
    enabled: candidate.enabled !== false,
    path: typeof candidate.path === 'string' && candidate.path.trim() ? candidate.path : null
  }
}

export type DriverDatabaseMeta = {
  label: string
  shortLabel: string
  supportedDriverTypes: DriverType[]
  icon: React.ReactNode
}

export const DRIVER_DATABASE_ORDER: DriverDatabaseType[] = ['dm', 'gaussdb']

export const DRIVER_DATABASE_META: Record<DriverDatabaseType, DriverDatabaseMeta> = {
  dm: {
    label: '达梦 DM',
    shortLabel: '达梦',
    supportedDriverTypes: ['jdbc', 'python', 'whl'],
    icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} />
  },
  gaussdb: {
    label: '高斯数据库',
    shortLabel: '高斯',
    supportedDriverTypes: ['jdbc'],
    icon: <DatabaseOutlined />
  }
}

export type DriverFormValues = {
  database_type: DriverDatabaseType
  driver_type: DriverType
  name: string
  path?: string
  enabled: boolean
}

export type JavaRuntimeInfo = {
  home: string
  major?: number | null
  jvm_path: string
}

export type JavaDetectResponse = {
  runtimes: JavaRuntimeInfo[]
  preferred?: string | null
  configured?: string | null
  enabled: boolean
}

export type JavaRuntimeConfigResponse = {
  java_home?: string | null
  major?: number | null
  jvm_path?: string | null
  enabled: boolean
}

export const buildStatementStructureKey = (statements: SqlStatementInfo[] = []): string => (
  statements.map((statement) => `${statement.start}:${statement.end}`).join('|')
)

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

export type DefaultValueMarker = {
  __datadjinn_action__: 'default'
}

export const normalizeShortcutText = (shortcut?: string): string => shortcut?.replace(/\s+/g, '').toLowerCase() ?? ''

export const formatShortcutFromEvent = (event: React.KeyboardEvent<HTMLElement>): string => {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  let key = event.key
  if (key === ' ') {
    key = 'Space'
  } else if (key.length === 1) {
    key = key.toUpperCase()
  }

  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key)
  }
  return parts.join('+')
}

export const isModifierOnlyKey = (key: string): boolean => ['Control', 'Shift', 'Alt', 'Meta'].includes(key)

export const ShortcutRecorder = memo(function ShortcutRecorder({
  label,
  value,
  defaultValue,
  recording,
  onStartRecord,
  onChange,
  onCancel,
  onReset
}: {
  label: string
  value: string
  defaultValue: string
  recording: boolean
  onStartRecord: () => void
  onChange: (value: string) => void
  onCancel: () => void
  onReset: () => void
}) {
  return (
    <Flex align="center" justify="space-between" gap={12} className="shortcut-setting-item">
      <Space direction="vertical" size={2} className="shortcut-setting-meta">
        <Typography.Text strong>{label}</Typography.Text>
        <Typography.Text type="secondary">默认：{defaultValue}</Typography.Text>
      </Space>
      <Space size={8}>
        <button
          type="button"
          className={`shortcut-capture-button${recording ? ' is-recording' : ''}`}
          onClick={() => {
            if (!recording) onStartRecord()
          }}
          onKeyDown={(event) => {
            if (!recording) return
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape') {
              onCancel()
              return
            }
            if (isModifierOnlyKey(event.key)) {
              return
            }
            const nextShortcut = formatShortcutFromEvent(event)
            if (normalizeShortcutText(nextShortcut)) {
              onChange(nextShortcut)
            }
          }}
        >
          {recording ? '请按快捷键' : value || '未设置'}
        </button>
        <Button size="small" onClick={recording ? onCancel : onStartRecord}>
          {recording ? '取消' : '修改'}
        </Button>
        <Button size="small" onClick={onReset}>恢复默认</Button>
      </Space>
    </Flex>
  )
})

export type ColumnDef = {
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

export type TableDesignerMode = 'create' | 'edit'

export const editableValue = (value: string): unknown => value

export const createDefaultValueMarker = (): DefaultValueMarker => ({ __datadjinn_action__: 'default' })

export const isDefaultValueMarker = (value: unknown): value is DefaultValueMarker => (
  value !== null
  && typeof value === 'object'
  && '__datadjinn_action__' in value
  && (value as DefaultValueMarker).__datadjinn_action__ === 'default'
)

export const cellDisplayText = (value: unknown): string => (
  isDefaultValueMarker(value) ? 'DEFAULT' : value === null || value === undefined ? 'NULL' : String(value)
)

export const isCellValueEqual = (left: unknown, right: unknown): boolean => {
  if (isDefaultValueMarker(left) || isDefaultValueMarker(right)) {
    return isDefaultValueMarker(left) && isDefaultValueMarker(right)
  }
  if (left === right) {
    return true
  }
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true
  }
  return String(left) === String(right)
}

export const cloneRowSnapshot = (row: Record<string, unknown>): Record<string, unknown> => ({ ...row })

export const buildEditableRows = (rows: Record<string, unknown>[]): EditableRow[] =>
  rows.map((row, index) => ({
    ...cloneRowSnapshot(row),
    __rowKey: `row:${index}`,
    __original: cloneRowSnapshot(row)
  }))

export const displayValue = (value: unknown): string => {
  if (isDefaultValueMarker(value)) return 'DEFAULT'
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

export const buildRedisEdits = (rows: Record<string, unknown>[]): Record<string, RedisKeyEdit> =>
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

export const toColumnDef = (column: ColumnInfo): ColumnDef => ({
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

export const countRedisPendingChanges = (tab: WorkspaceTab): number =>
  Object.values(tab.redisEdits ?? {}).filter((edit) => edit.state || edit.deleted).length

export const redisTtlDisplay = (ttl: unknown): string => {
  const seconds = Number(ttl)
  if (!Number.isFinite(seconds)) return String(ttl)
  if (seconds === -1) return '不过期'
  if (seconds === -2) return '不存在'
  if (seconds < 0) return `${seconds} 秒`
  if (seconds < 60) return `${seconds} 秒后过期`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒后过期`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分后过期`
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时后过期`
}
