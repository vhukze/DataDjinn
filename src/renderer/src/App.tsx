import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  DownOutlined,
  FileAddOutlined,
  FilterOutlined,
  FunctionOutlined,
  GithubOutlined,
  MessageOutlined,
  EditOutlined,
  DeleteOutlined,
  BorderOutlined,
  AimOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  EyeOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  LoginOutlined,
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
  SearchOutlined,
  HistoryOutlined,
  UnorderedListOutlined,
  UpOutlined,
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
import { ApartmentOutlined } from '@ant-design/icons'
import type { InputRef, MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { DataNode } from 'antd/es/tree'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { createPortal, flushSync } from 'react-dom'
import { forwardRef, memo, startTransition, useCallback, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTheme } from './context/ThemeContext'
import AIPanel from './components/AIPanel'
import SqlEditor from './components/SqlEditor'
import type { SqlCompletionColumn, SqlCompletionContext, SqlCompletionTable, SqlDialect } from './components/SqlEditor'
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

const MemoAIPanel = memo(AIPanel, (prev, next) => (
  prev.requestJson === next.requestJson &&
  prev.connectionContext === next.connectionContext &&
  prev.workspace === next.workspace &&
  prev.contextSources === next.contextSources &&
  prev.primaryContextSourceId === next.primaryContextSourceId
))

const RESOURCE_TREE_ITEM_HEIGHT = 30
const FOLDER_DROP_PLACEHOLDER_KEY_PREFIX = 'folder-drop-placeholder:'

type WorkspaceTabsViewProps = {
  workspaceTabs: WorkspaceTab[]
  activeTabKey?: string
  activeTabSearchState?: TableSearchUiState
  onActiveTabChange: (key: string) => void
  onCloseTab: (key: string) => void
  onRenameTab: (key: string, title: string) => void
  renderWorkspaceTab: (tab: WorkspaceTab) => React.ReactNode
}

const WorkspaceTabsView = memo(function WorkspaceTabsView({
  workspaceTabs,
  activeTabKey,
  activeTabSearchState,
  onActiveTabChange,
  onCloseTab,
  onRenameTab,
  renderWorkspaceTab
}: WorkspaceTabsViewProps) {
  const [editingTabKey, setEditingTabKey] = useState<string>()
  const [editingTabTitle, setEditingTabTitle] = useState('')
  const items = useMemo(() => (
    workspaceTabs.map((tab) => ({
      key: tab.key,
      label: editingTabKey === tab.key
        ? (
          <Input
            size="small"
            value={editingTabTitle}
            autoFocus
            onChange={(event) => setEditingTabTitle(event.currentTarget.value)}
            onBlur={() => {
              const nextTitle = editingTabTitle.trim()
              if (nextTitle) {
                onRenameTab(tab.key, nextTitle)
              }
              setEditingTabKey(undefined)
            }}
            onPressEnter={() => {
              const nextTitle = editingTabTitle.trim()
              if (nextTitle) {
                onRenameTab(tab.key, nextTitle)
              }
              setEditingTabKey(undefined)
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditingTabKey(undefined)
              }
            }}
          />
        )
        : (
          <span
            onDoubleClick={(event) => {
              event.stopPropagation()
              setEditingTabKey(tab.key)
              setEditingTabTitle(tab.title)
            }}
          >
            {tab.title}
          </span>
        ),
      closable: true,
      children: tab.key === activeTabKey ? renderWorkspaceTab(tab) : null
    }))
  ), [activeTabKey, activeTabSearchState, editingTabKey, editingTabTitle, onRenameTab, renderWorkspaceTab, workspaceTabs])

  return (
    <Tabs
      className="workspace-tabs"
      type="editable-card"
      hideAdd
      destroyOnHidden
      activeKey={activeTabKey}
      onChange={onActiveTabChange}
      onEdit={(targetKey, action) => {
        if (action === 'remove' && typeof targetKey === 'string') {
          onCloseTab(targetKey)
        }
      }}
      items={items}
    />
  )
}, (prev, next) => (
  prev.workspaceTabs === next.workspaceTabs &&
  prev.activeTabKey === next.activeTabKey &&
  prev.activeTabSearchState === next.activeTabSearchState &&
  prev.renderWorkspaceTab === next.renderWorkspaceTab &&
  prev.onCloseTab === next.onCloseTab &&
  prev.onActiveTabChange === next.onActiveTabChange &&
  prev.onRenameTab === next.onRenameTab
))

type WhereClauseInputProps = {
  tabKey: string
  columns: string[]
  value?: string
  label?: string
  placeholder?: string
  disableSuggestions?: boolean
  onSubmit: (value: string) => void
}

const WhereClauseInput = memo(function WhereClauseInput({
  tabKey,
  columns,
  value,
  label,
  placeholder,
  disableSuggestions,
  onSubmit
}: WhereClauseInputProps) {
  const [inputValue, setInputValue] = useState(value ?? '')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const inputRef = useRef<InputRef | null>(null)

  useEffect(() => {
    setInputValue(value ?? '')
    setHighlightedIndex(0)
    setSuggestionsDismissed(false)
  }, [tabKey, value])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const suggestionState = useMemo(() => {
    if (disableSuggestions) {
      return { token: '', start: -1, options: [] as string[] }
    }
    const match = /(^|[^A-Za-z0-9_"])([A-Za-z_][A-Za-z0-9_]*)$/.exec(inputValue)
    if (!match) {
      return { token: '', start: -1, options: [] as string[] }
    }

    const token = match[2] ?? ''
    if (!token.trim()) {
      return { token: '', start: -1, options: [] as string[] }
    }

    const lowerToken = token.toLowerCase()
    const options = columns
      .filter((column) => column !== '__rowKey' && column.toLowerCase().includes(lowerToken))
      .slice(0, 8)

    return {
      token,
      start: inputValue.length - token.length,
      options
    }
  }, [columns, inputValue])

  useEffect(() => {
    setHighlightedIndex((current) => {
      if (suggestionState.options.length <= 0) {
        return 0
      }
      return Math.min(current, suggestionState.options.length - 1)
    })
  }, [suggestionState.options])

  const applySuggestion = (nextColumn: string): void => {
    if (!nextColumn || suggestionState.start < 0) {
      return
    }
    const nextValue = `${inputValue.slice(0, suggestionState.start)}${nextColumn}`
    setInputValue(nextValue)
    setHighlightedIndex(0)
    setSuggestionsDismissed(true)
  }

  const suggestionsOpen = !suggestionsDismissed && suggestionState.options.length > 0
  const highlightedWhereHtml = useMemo(() => {
    if (!inputValue) {
      return ''
    }
    return buildWhereHighlightedHtml(inputValue) ?? escapeHtml(inputValue)
  }, [inputValue])
  const handleWhereInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (suggestionsOpen && event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => (current + 1) % suggestionState.options.length)
      return
    }
    if (suggestionsOpen && event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => (current - 1 + suggestionState.options.length) % suggestionState.options.length)
      return
    }
    if (suggestionsOpen && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      applySuggestion(suggestionState.options[highlightedIndex] ?? suggestionState.options[0] ?? '')
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit(inputValue)
    }
  }

  return (
    <div className="preview-where-shell">
      <div className="preview-where-inline">
        <span className="preview-where-label">{label ?? 'WHERE'}</span>
        <div className="preview-where-editor">
          {inputValue && (
            <span
              className="preview-where-highlight"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightedWhereHtml }}
            />
          )}
        <Input
          ref={inputRef}
          className="preview-where-field"
          size="small"
          variant="borderless"
          value={inputValue}
          placeholder={placeholder ?? '输入过滤条件，例如：id = 2，回车查询'}
          allowClear
          onChange={(event) => {
            setInputValue(event.currentTarget.value)
            setHighlightedIndex(0)
            setSuggestionsDismissed(false)
          }}
          onClear={() => {
            setInputValue('')
            setHighlightedIndex(0)
            setSuggestionsDismissed(false)
            requestAnimationFrame(() => {
              inputRef.current?.focus()
            })
          }}
          onKeyDown={handleWhereInputKeyDown}
          onPressEnter={() => undefined}
        />
        </div>
      </div>
      {suggestionsOpen && (
        <div className="preview-where-suggestions">
          {suggestionState.options.map((option, index) => (
            <button
              key={`${tabKey}-${option}`}
              type="button"
              className={index === highlightedIndex ? 'preview-where-option is-active' : 'preview-where-option'}
              onMouseDown={(event) => {
                event.preventDefault()
                applySuggestion(option)
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}, (prev, next) => (
  prev.tabKey === next.tabKey &&
  prev.value === next.value &&
  prev.columns === next.columns
))

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

const WHERE_HIGHLIGHT_KEYWORDS = [
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'TRUE',
  'FALSE',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END'
]

const buildWhereHighlightedHtml = (text: string): string | null => {
  if (!text) {
    return null
  }
  const pattern = /'(?:''|[^'])*'|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\b(?:AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|NULL|TRUE|FALSE|CASE|WHEN|THEN|ELSE|END)\b/gi
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) {
    return null
  }

  let cursor = 0
  let html = ''
  for (const match of matches) {
    const matchIndex = match.index ?? -1
    const matchedText = match[0] ?? ''
    if (matchIndex < 0 || matchedText.length === 0) {
      continue
    }
    if (matchIndex > cursor) {
      html += escapeHtml(text.slice(cursor, matchIndex))
    }
    const upper = matchedText.toUpperCase()
    let className = 'where-token where-token-identifier'
    if (/^'.*'$|^".*"$/.test(matchedText)) {
      className = 'where-token where-token-string'
    } else if (/^\d+(?:\.\d+)?$/.test(matchedText)) {
      className = 'where-token where-token-number'
    } else if (WHERE_HIGHLIGHT_KEYWORDS.includes(upper)) {
      className = upper === 'NULL' || upper === 'TRUE' || upper === 'FALSE'
        ? 'where-token where-token-constant'
        : 'where-token where-token-keyword'
    }
    html += `<span class="${className}">${escapeHtml(matchedText)}</span>`
    cursor = matchIndex + matchedText.length
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor))
  }
  return html || null
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

  if (connection.database_type === 'oracle') {
    return available.slice(0, 1)
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

const INTEGER_TYPE_PREFIXES = ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'serial', 'bigserial', 'smallserial', 'number']
const NUMERIC_TYPE_PREFIXES = [...INTEGER_TYPE_PREFIXES, 'decimal', 'numeric', 'float', 'double', 'real']

const tableDesignerSupportsComments = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle'
const tableDesignerSupportsUnique = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
const tableDesignerSupportsAutoIncrement = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
const tableDesignerSupportsAutoIncrementStep = (databaseType?: DatabaseType): boolean => databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle'
const tableDesignerSupportsMinMax = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
const tableDesignerSupportsEdit = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
const isIntegerLikeType = (type: string): boolean => INTEGER_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))
const isNumericLikeType = (type: string): boolean => NUMERIC_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))

const PREVIEW_DEFAULT_LIMIT = 300
const QUERY_DEFAULT_LIMIT = 1000
const REDIS_DEFAULT_LIMIT = 500
const JDBC_COMPATIBLE_DATABASE_TYPES: DatabaseType[] = ['dm', 'gaussdb']

type DatabaseType = 'sqlite' | 'mysql' | 'postgresql' | 'dm' | 'gaussdb' | 'oracle' | 'mongodb' | 'redis' | 'clickhouse'
type WorkspaceTabKind = 'preview' | 'query' | 'redis-browser' | 'table-list'

const DATABASE_TYPE_LABELS: Record<DatabaseType, string> = {
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

type ImportConnectionSource = 'datagrip'
type ImportConnectionCandidateStatus = 'ready' | 'warning' | 'error'

type ImportConnectionCandidate = {
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

type ImportConnectionResultItem = {
  name: string
  database_type?: DatabaseType
  message?: string
}

type ImportConnectionResult = {
  success: ImportConnectionResultItem[]
  failed: ImportConnectionResultItem[]
}

const IMPORT_CONNECTION_SOURCE_OPTIONS = [
  { label: 'DataGrip', value: 'datagrip' }
]

const defaultPortForDatabaseType = (databaseType: DatabaseType): number | undefined => {
  if (databaseType === 'postgresql') {
    return 5432
  }
  if (databaseType === 'mysql') {
    return 3306
  }
  if (databaseType === 'dm') {
    return 5236
  }
  if (databaseType === 'gaussdb') {
    return 8000
  }
  if (databaseType === 'oracle') {
    return 1521
  }
  if (databaseType === 'mongodb') {
    return 27017
  }
  if (databaseType === 'redis') {
    return 6379
  }
  if (databaseType === 'clickhouse') {
    return 8123
  }
  return undefined
}

const trimToUndefined = (value?: string | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const sanitizeImportedXml = (xml: string): string =>
  xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;')

const inferDataGripDatabaseType = (params: {
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

  if (fingerprint.includes('clickhouse')) {
    return 'clickhouse'
  }
  if (fingerprint.includes('postgres')) {
    return 'postgresql'
  }
  if (fingerprint.includes('gauss')) {
    return 'gaussdb'
  }
  if (fingerprint.includes('dm dbms') || fingerprint.includes('dm.jdbc.driver') || fingerprint.includes('jdbc:dm:')) {
    return 'dm'
  }
  if (fingerprint.includes('redis')) {
    return 'redis'
  }
  if (fingerprint.includes('oracle')) {
    return 'oracle'
  }
  if (fingerprint.includes('mysql')) {
    return 'mysql'
  }
  if (fingerprint.includes('mongo')) {
    return 'mongodb'
  }
  return undefined
}

const parseJdbcUrlToConnectionFields = (jdbcUrl: string, databaseType: DatabaseType): Pick<ConnectionFormValues, 'host' | 'port' | 'database'> => {
  const normalized = jdbcUrl.trim()

  if (!normalized.toLowerCase().startsWith('jdbc:')) {
    throw new Error('不是有效的 JDBC URL')
  }

  const runtimeUrlValue = normalized.replace(/^jdbc:/i, '')
  let runtimeUrl: URL | null = null
  let host: string | undefined
  let port: number | string | undefined
  let pathname = ''
  let schema: string | undefined

  try {
    runtimeUrl = new URL(runtimeUrlValue)
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
    return {
      host,
      port,
      database: schema ?? trimToUndefined(pathname)
    }
  }

  if (databaseType === 'redis') {
    return {
      host,
      port,
      database: trimToUndefined(pathname) ?? '0'
    }
  }

  return {
    host,
    port,
    database: trimToUndefined(pathname)
  }
}

const parseDataGripImportText = (rawText: string): ImportConnectionCandidate[] => {
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
      const databaseType = inferDataGripDatabaseType({
        dbms,
        product,
        driverRef,
        jdbcDriver,
        jdbcUrl
      })
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

const isDatabaseScopedType = (databaseType?: DatabaseType): databaseType is 'mysql' | 'mongodb' | 'redis' | 'clickhouse' =>
  databaseType === 'mysql' || databaseType === 'mongodb' || databaseType === 'redis' || databaseType === 'clickhouse'

const isSchemaScopedType = (databaseType?: DatabaseType): databaseType is 'postgresql' | 'gaussdb' =>
  databaseType === 'postgresql' || databaseType === 'gaussdb'

type HealthStatus = {
  status: string
  app: string
  version: string
}

type ConnectionFormValues = {
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
}

type ConnectionInfo = {
  connection_id: string
  name: string
  database_type: DatabaseType
  host?: string
  port?: number | string
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

const isDriverDatabaseType = (value: unknown): value is DriverDatabaseType => value === 'dm' || value === 'gaussdb'
const isDriverType = (value: unknown): value is DriverType => value === 'jdbc' || value === 'python' || value === 'whl'
const isDriverSource = (value: unknown): value is DriverInfo['source'] => value === 'auto' || value === 'manual'

const normalizeDriverInfo = (value: unknown): DriverInfo | null => {
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

type DriverDatabaseMeta = {
  label: string
  shortLabel: string
  supportedDriverTypes: DriverType[]
  icon: React.ReactNode
}

const DRIVER_DATABASE_ORDER: DriverDatabaseType[] = ['dm', 'gaussdb']

const DRIVER_DATABASE_META: Record<DriverDatabaseType, DriverDatabaseMeta> = {
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

type SettingsSection = 'app' | 'shortcuts' | 'drivers'

type ShortcutAction =
  | 'sql_execute'
  | 'sql_delete_line'
  | 'sql_duplicate_line_down'
  | 'ai_send'
  | 'ai_newline'
  | 'ai_stop'

type ShortcutSettings = Record<ShortcutAction, string>

type SqlEditorExecutionContext = {
  selectedSql: string
  currentStatementSql: string
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
  comment?: string | null
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
  default_value?: string | null
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
  sort_column?: string | null
  sort_direction?: string | null
}

type QueryResultKind = 'query' | 'command' | 'error'

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

type CellInspectorView = 'record' | 'value' | 'aggregate'

type ValueDisplayMode = 'raw' | 'json'

const tryFormatJsonText = (value: unknown): string | null => {
  if (value === null || value === undefined || isDefaultValueMarker(value)) {
    return null
  }
  const raw = typeof value === 'string' ? value.trim() : JSON.stringify(value)
  if (!raw) {
    return null
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return null
  }
}

type WorkspaceTab = {
  key: string
  title: string
  kind: WorkspaceTabKind
  connectionId?: string
  databaseName?: string
  pgDatabaseName?: string
  tableName?: string
  objectType?: DbObjectType
  sql: string
  limit?: number
  page?: number
  loading: boolean
  result?: QueryResponse
  columnInfoMap?: Record<string, ColumnInfo>
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
  error?: string
  resultVisible?: boolean
  resultCollapsed?: boolean
  resultKind?: QueryResultKind
  commandMessage?: string
  commandAffectedRows?: number | null
  queryEditorHeight?: number
  valueDisplayMode?: ValueDisplayMode
  redisMode?: RedisBrowserMode
  redisExpandedValues?: RedisExpandedValues
  redisEdits?: Record<string, RedisKeyEdit>
  where?: string
  pageSearchVisible?: boolean
  pageSearchQuery?: string
  pageSearchCaseSensitive?: boolean
  pageSearchRegex?: boolean
  pageSearchWholeWord?: boolean
  pageSearchFilterRows?: boolean
  pageSearchActiveMatchIndex?: number
  persistedAt?: number
}

type PersistedQueryWorkspace = {
  key: string
  title: string
  connectionId?: string
  connectionName?: string
  databaseName?: string
  pgDatabaseName?: string
  sql: string
  limit?: number
  queryEditorHeight?: number
  persistedAt: number
}

const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  sql_execute: 'Ctrl+Enter',
  sql_delete_line: 'Ctrl+D',
  sql_duplicate_line_down: 'Ctrl+Alt+ArrowDown',
  ai_send: 'Enter',
  ai_newline: 'Shift+Enter',
  ai_stop: 'Ctrl+C'
}

const SHORTCUT_SETTING_LABELS: Record<ShortcutAction, string> = {
  sql_execute: '执行 SQL',
  sql_delete_line: '删除行',
  sql_duplicate_line_down: '复制行到下一行',
  ai_send: '发送',
  ai_newline: '换行',
  ai_stop: '停止'
}

type DefaultValueMarker = {
  __datadjinn_action__: 'default'
}

type EditingCellState = Record<string, { rowKey: string; column: string } | undefined>

type TableSearchUiState = {
  visible: boolean
  query: string
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
  filterRows: boolean
  activeMatchIndex: number
}

const normalizeShortcutText = (shortcut?: string): string => shortcut?.replace(/\s+/g, '').toLowerCase() ?? ''

const formatShortcutFromEvent = (event: React.KeyboardEvent<HTMLElement>): string => {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) {
    parts.push('Ctrl')
  }
  if (event.altKey) {
    parts.push('Alt')
  }
  if (event.shiftKey) {
    parts.push('Shift')
  }

  let key = event.key
  if (key === ' ') {
    key = 'Space'
  } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    key = key
  } else if (key.length === 1) {
    key = key.toUpperCase()
  }

  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key)
  }

  return parts.join('+')
}

const isModifierOnlyKey = (key: string): boolean => ['Control', 'Shift', 'Alt', 'Meta'].includes(key)

const ShortcutRecorder = memo(function ShortcutRecorder({
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
            if (!recording) {
              onStartRecord()
            }
          }}
          onKeyDown={(event) => {
            if (!recording) {
              return
            }
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

type DdlPreviewModalHandle = {
  open: (payload: {
    title: string
    dialect: SqlDialect
    load: () => Promise<string>
  }) => void
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const buildHighlightedHtml = (text: string, regex: RegExp): string | null => {
  if (text.length === 0) {
    return null
  }
  const matches = [...text.matchAll(regex)]
  if (matches.length === 0) {
    return null
  }
  let cursor = 0
  let html = ''
  for (const match of matches) {
    const matchIndex = match.index ?? -1
    const matchedText = match[0] ?? ''
    if (matchIndex < 0 || matchedText.length === 0) {
      continue
    }
    if (matchIndex > cursor) {
      html += escapeHtml(text.slice(cursor, matchIndex))
    }
    html += `<mark class="table-search-highlight">${escapeHtml(matchedText)}</mark>`
    cursor = matchIndex + matchedText.length
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor))
  }
  return html.length > 0 ? html : null
}

type SearchMatcher = {
  matches: (text: string) => boolean
  highlight: (text: string) => string | null
}

const buildPlainHighlightedHtml = (text: string, query: string, caseSensitive: boolean): string | null => {
  if (!query || !text) {
    return null
  }
  const sourceText = caseSensitive ? text : text.toLocaleLowerCase()
  const sourceQuery = caseSensitive ? query : query.toLocaleLowerCase()
  const queryLength = sourceQuery.length
  if (queryLength === 0) {
    return null
  }
  let cursor = 0
  let html = ''
  let found = false
  while (cursor < text.length) {
    const matchIndex = sourceText.indexOf(sourceQuery, cursor)
    if (matchIndex < 0) {
      break
    }
    found = true
    if (matchIndex > cursor) {
      html += escapeHtml(text.slice(cursor, matchIndex))
    }
    html += `<mark class="table-search-highlight">${escapeHtml(text.slice(matchIndex, matchIndex + queryLength))}</mark>`
    cursor = matchIndex + queryLength
  }
  if (!found) {
    return null
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor))
  }
  return html
}

const createSearchMatcher = (query: string, options: {
  regex: boolean
  wholeWord: boolean
  caseSensitive: boolean
}): SearchMatcher | null => {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return null
  }

  if (!options.regex && !options.wholeWord) {
    const normalizedQuery = options.caseSensitive ? trimmedQuery : trimmedQuery.toLocaleLowerCase()
    return {
      matches: (text: string) => {
        if (!text) {
          return false
        }
        const normalizedText = options.caseSensitive ? text : text.toLocaleLowerCase()
        return normalizedText.includes(normalizedQuery)
      },
      highlight: (text: string) => buildPlainHighlightedHtml(text, trimmedQuery, options.caseSensitive)
    }
  }

  try {
    const escaped = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const basePattern = options.regex ? trimmedQuery : escaped
    const source = options.wholeWord ? `\\b(?:${basePattern})\\b` : basePattern
    const testRegex = new RegExp(source, options.caseSensitive ? '' : 'i')
    if (testRegex.test('')) {
      return null
    }
    const highlightFlags = options.caseSensitive ? 'g' : 'gi'
    return {
      matches: (text: string) => {
        if (!text) {
          return false
        }
        testRegex.lastIndex = 0
        return testRegex.test(text)
      },
      highlight: (text: string) => {
        if (!text) {
          return null
        }
        return buildHighlightedHtml(text, new RegExp(source, highlightFlags))
      }
    }
  } catch {
    return null
  }
}

const SearchHighlightedText = memo(function SearchHighlightedText({
  text,
  highlightedHtml,
  className
}: {
  text: string
  highlightedHtml?: string
  className?: string
}) {
  if (!highlightedHtml) {
    return className ? <span className={className}>{text}</span> : <>{text}</>
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
})

const isResultTableScrollbarInteraction = (event: React.MouseEvent<HTMLDivElement>): boolean => {
  const target = event.target as HTMLElement | null
  if (target?.closest('.ant-table-tbody-virtual-scrollbar, .rc-virtual-list-scrollbar')) {
    return true
  }

  const container = event.currentTarget
  const rect = container.getBoundingClientRect()
  const scrollbarWidth = container.offsetWidth - container.clientWidth
  const scrollbarHeight = container.offsetHeight - container.clientHeight
  const pointerX = event.clientX - rect.left
  const pointerY = event.clientY - rect.top

  if (scrollbarWidth > 0 && container.scrollHeight > container.clientHeight) {
    const verticalScrollbarStart = rect.width - scrollbarWidth
    if (pointerX >= verticalScrollbarStart) {
      return true
    }
  }

  if (scrollbarHeight > 0 && container.scrollWidth > container.clientWidth) {
    const horizontalScrollbarStart = rect.height - scrollbarHeight
    if (pointerY >= horizontalScrollbarStart) {
      return true
    }
  }

  return false
}

const scheduleSelectionRenderSync = (callback: () => void): void => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      callback()
    })
  })
}

const PageSearchControls = memo(function PageSearchControls({
  state,
  matchCount,
  activeMatchIndex,
  onStateChange,
  onPrevious,
  onNext,
  onClearActiveHighlight,
  onRequestClose
}: {
  state: TableSearchUiState
  matchCount: number
  activeMatchIndex: number
  onStateChange: (patch: Partial<TableSearchUiState>) => void
  onPrevious: () => void
  onNext: () => void
  onClearActiveHighlight: () => void
  onRequestClose: () => void
}) {
  const [draftQuery, setDraftQuery] = useState(state.query)
  const composingRef = useRef(false)
  const skipNextDeferredSyncRef = useRef(false)
  const inputRef = useRef<InputRef | null>(null)

  useEffect(() => {
    setDraftQuery(state.query)
  }, [state.query])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (skipNextDeferredSyncRef.current) {
      skipNextDeferredSyncRef.current = false
      return
    }
    if (composingRef.current || draftQuery === state.query) {
      return
    }
    const timer = window.setTimeout(() => {
      onClearActiveHighlight()
      startTransition(() => {
        onStateChange({
          query: draftQuery,
          activeMatchIndex: 0
        })
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [draftQuery, onClearActiveHighlight, onStateChange, state.query])

  let hasRegexError = false
  if (state.regex && draftQuery.trim()) {
    try {
      const source = state.wholeWord ? `\\b(?:${draftQuery})\\b` : draftQuery
      const tester = new RegExp(source, state.caseSensitive ? 'g' : 'gi')
      tester.lastIndex = 0
      if (tester.test('')) {
        hasRegexError = true
      }
    } catch {
      hasRegexError = true
    }
  }

  return (
    <Flex align="center" gap={8} className="table-search-bar">
      <Input
        ref={inputRef}
        size="small"
        className="table-search-input"
        value={draftQuery}
        allowClear
        variant="borderless"
        status={hasRegexError ? 'error' : undefined}
        onChange={(event) => {
          setDraftQuery(event.target.value)
        }}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false
          const nextValue = event.currentTarget.value
          skipNextDeferredSyncRef.current = true
          setDraftQuery(nextValue)
          onClearActiveHighlight()
          startTransition(() => {
            onStateChange({
              query: nextValue,
              activeMatchIndex: 0
            })
          })
        }}
      />
      <Space size={4} className="table-search-nav">
        <Button
          size="small"
          type="text"
          className="table-search-icon-btn"
          icon={<UpOutlined />}
          title="上一个"
          aria-label="上一个"
          disabled={matchCount === 0 || hasRegexError}
          onClick={onPrevious}
        />
        <Button
          size="small"
          type="text"
          className="table-search-icon-btn"
          icon={<DownOutlined />}
          title="下一个"
          aria-label="下一个"
          disabled={matchCount === 0 || hasRegexError}
          onClick={onNext}
        />
        <Typography.Text type="secondary" className="table-search-counter">
          {matchCount > 0 ? `${activeMatchIndex + 1}/${matchCount}` : '0/0'}
        </Typography.Text>
      </Space>
      <Space size={4} className="table-search-options">
        <Button
          size="small"
          type="text"
          className={state.caseSensitive ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="区分大小写"
          aria-label="区分大小写"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({
              query: draftQuery,
              caseSensitive: !state.caseSensitive,
              activeMatchIndex: 0
            })
          }}
        >
          <span className="table-search-flag">Aa</span>
        </Button>
        <Button
          size="small"
          type="text"
          className={state.regex ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="正则表达式"
          aria-label="正则表达式"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({
              query: draftQuery,
              regex: !state.regex,
              activeMatchIndex: 0
            })
          }}
        >
          <span className="table-search-flag">.*</span>
        </Button>
        <Button
          size="small"
          type="text"
          className={state.wholeWord ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="整词匹配"
          aria-label="整词匹配"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({
              query: draftQuery,
              wholeWord: !state.wholeWord,
              activeMatchIndex: 0
            })
          }}
        >
          <span className="table-search-flag">W</span>
        </Button>
        <Button
          size="small"
          type="text"
          className={state.filterRows ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="只显示命中行"
          aria-label="只显示命中行"
          onClick={() => onStateChange({ query: draftQuery, filterRows: !state.filterRows, activeMatchIndex: 0 })}
        >
          <FilterOutlined />
        </Button>
        <Button
          size="small"
          type="text"
          className="table-search-icon-btn"
          icon={<CloseOutlined />}
          title="关闭搜索"
          aria-label="关闭搜索"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({ visible: false })
            onRequestClose()
          }}
        />
      </Space>
    </Flex>
  )
})

const DdlPreviewModal = memo(forwardRef<DdlPreviewModalHandle, {
  theme: 'dark' | 'light'
  onError: (message: string) => void
}>(
  function DdlPreviewModal({ theme, onError }, ref) {
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [loading, setLoading] = useState(false)
    const [dialect, setDialect] = useState<SqlDialect>('sqlite')

    useImperativeHandle(ref, () => ({
      open: ({ title, dialect, load }) => {
        setTitle(title)
        setContent('')
        setDialect(dialect)
        setLoading(true)
        setOpen(true)
        window.setTimeout(() => {
          void load().then((nextContent) => {
            setContent(nextContent)
          }).catch((err) => {
            setOpen(false)
            onError(err instanceof Error ? err.message : '获取 DDL 失败')
          }).finally(() => {
            setLoading(false)
          })
        }, 0)
      }
    }), [onError])

    return (
      <Modal title={title || '查看 DDL'} open={open} footer={null} onCancel={() => setOpen(false)} width={980} centered maskClosable={false}>
        <div className="ddl-preview-shell">
          <SqlEditor
            value={loading ? '-- 加载中...' : content}
            onChange={() => undefined}
            theme={theme}
            readOnly
            height="60vh"
            completionContext={{ dialect }}
          />
        </div>
      </Modal>
    )
  }
))

type ImperativeModalHandle = {
  open: () => void
  close: () => void
}

const ImperativeModalHost = memo(forwardRef<ImperativeModalHandle, {
  title: string
  width?: number
  footer?: React.ReactNode | null
  maskClosable?: boolean
  children: React.ReactNode
  onClosed?: () => void
}>(function ImperativeModalHost({
  title,
  width,
  footer = null,
  maskClosable = false,
  children,
  onClosed
}, ref) {
  const [open, setOpen] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false)
  }), [])

  return (
    <Modal
      title={title}
      open={open}
      width={width}
      footer={footer}
      maskClosable={maskClosable}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      onCancel={() => {
        setOpen(false)
        onClosed?.()
      }}
    >
      {children}
    </Modal>
  )
}))

const LightweightPopover = memo(function LightweightPopover({
  open,
  anchorRef,
  onClose,
  children
}: {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>()

  useEffect(() => {
    if (!open) {
      return
    }

    const updatePosition = (): void => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }
      const rect = anchor.getBoundingClientRect()
      setPosition({
        top: rect.bottom + window.scrollY + 6,
        left: Math.max(12, rect.right + window.scrollX - 240)
      })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return
      }
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [anchorRef, onClose, open])

  if (!open || !position) {
    return null
  }

  return createPortal(
    <div
      ref={panelRef}
      className="lightweight-popover"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
})

const ColumnFilterTrigger = memo(function ColumnFilterTrigger({
  column,
  checkedValues,
  sourceRows,
  onChange
}: {
  column: string
  checkedValues: string[]
  sourceRows: EditableRow[]
  onChange: (values: string[]) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const options = useMemo(() => buildColumnFilterOptions(sourceRows, column), [column, sourceRows])
  const [draftValues, setDraftValues] = useState<string[]>(checkedValues)

  useEffect(() => {
    setDraftValues(checkedValues)
  }, [checkedValues])

  const allChecked = options.length > 0 && draftValues.length === options.length
  const partiallyChecked = draftValues.length > 0 && draftValues.length < options.length

  const applyFilterChange = (values: string[]): void => {
    setDraftValues(values)
    window.setTimeout(() => {
      onChange(values)
    }, 0)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`column-filter-button${draftValues.length > 0 ? ' active' : ''}`}
        title="筛选本页数据"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <FilterOutlined />
      </button>
      <LightweightPopover
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
      >
        <div className="column-filter-popover">
          <Space direction="vertical" className="column-filter-popover">
            <Typography.Text strong>{column} 筛选</Typography.Text>
            {options.length > 0 && (
              <Checkbox
                checked={allChecked}
                indeterminate={partiallyChecked}
                onChange={(event) => {
                  applyFilterChange(event.target.checked ? options.map((option) => option.value) : [])
                }}
              >
                全选
              </Checkbox>
            )}
            <Checkbox.Group value={draftValues} onChange={(values) => applyFilterChange(values.map(String))}>
              <Space direction="vertical" className="column-filter-options">
                {options.length > 0 ? options.map((option) => (
                  <Checkbox key={option.value} value={option.value}>
                    {option.label} <Typography.Text type="secondary">({option.count})</Typography.Text>
                  </Checkbox>
                )) : (
                  <Typography.Text type="secondary">暂无可筛选项</Typography.Text>
                )}
              </Space>
            </Checkbox.Group>
          </Space>
        </div>
      </LightweightPopover>
    </>
  )
})

const ResultTableBodyView = memo(function ResultTableBodyView({
  tab,
  searchSignature,
  editingCellKey,
  selectedRowKeyMap,
  tableColumns,
  tableRows,
  tableScrollX,
  tableScrollY,
  setBodyRef,
  setHeaderRef,
  onScrollCapture,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseLeave
}: {
  tab: WorkspaceTab
  searchSignature: string
  editingCellKey?: string
  selectedRowKeyMap: Record<string, true>
  tableColumns: ColumnsType<EditableRow>
  tableRows: EditableRow[]
  tableScrollX: number
  tableScrollY: number
  setBodyRef: (element: HTMLDivElement | null) => void
  setHeaderRef: (element: HTMLDivElement | null) => void
  onScrollCapture: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
}) {
  void searchSignature
  void editingCellKey

  return (
    <div
      ref={setBodyRef}
      className="result-table-body"
      tabIndex={0}
      style={{ '--result-table-scroll-y': `${tableScrollY}px` } as React.CSSProperties}
      onMouseEnter={(event) => {
        const currentTarget = event.currentTarget
        setHeaderRef(currentTarget.querySelector<HTMLDivElement>('.ant-table-thead'))
      }}
      onScrollCapture={onScrollCapture}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
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
  )
}, (prev, next) => (
  prev.tab === next.tab
  && prev.searchSignature === next.searchSignature
  && prev.editingCellKey === next.editingCellKey
  && prev.selectedRowKeyMap === next.selectedRowKeyMap
  && prev.tableScrollX === next.tableScrollX
  && prev.tableScrollY === next.tableScrollY
))

const ResultTableHeader = memo(function ResultTableHeader({
  leftActions,
  whereInput,
  rightActions,
  searchState,
  searchMeta,
  onSearchStateChange,
  onClearActiveHighlight,
  searchVisible,
  onToggleSearch
}: {
  leftActions: React.ReactNode
  whereInput: React.ReactNode
  rightActions?: React.ReactNode
  searchState: TableSearchUiState
  searchMeta: {
    matchCount: number
    resetKey: string
    focusSearchMatch: (matchIndex: number) => void
  }
  onSearchStateChange: (patch: Partial<TableSearchUiState>) => void
  onClearActiveHighlight: () => void
  searchVisible: boolean
  onToggleSearch: () => void
}) {
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  useEffect(() => {
    setActiveMatchIndex(0)
  }, [searchMeta.resetKey])

  useEffect(() => {
    setActiveMatchIndex((current) => {
      if (searchMeta.matchCount <= 0) {
        return 0
      }
      return Math.min(Math.max(current, 0), searchMeta.matchCount - 1)
    })
  }, [searchMeta.matchCount])

  return (
    <>
      <Flex align="center" justify="space-between" gap={8} className="table-data-toolbar">
        {leftActions}
        <Flex align="center" justify="end" gap={8} className="table-data-toolbar-right">
          {whereInput}
          {rightActions}
        </Flex>
      </Flex>
      {searchVisible && (
        <PageSearchControls
          state={searchState}
          matchCount={searchMeta.matchCount}
          activeMatchIndex={activeMatchIndex}
          onStateChange={onSearchStateChange}
          onPrevious={() => {
            if (searchMeta.matchCount === 0) {
              return
            }
            const nextIndex = activeMatchIndex <= 0 ? searchMeta.matchCount - 1 : activeMatchIndex - 1
            setActiveMatchIndex(nextIndex)
            searchMeta.focusSearchMatch(nextIndex)
          }}
          onNext={() => {
            if (searchMeta.matchCount === 0) {
              return
            }
            const nextIndex = activeMatchIndex >= searchMeta.matchCount - 1 ? 0 : activeMatchIndex + 1
            setActiveMatchIndex(nextIndex)
            searchMeta.focusSearchMatch(nextIndex)
          }}
          onClearActiveHighlight={onClearActiveHighlight}
          onRequestClose={onToggleSearch}
        />
      )}
    </>
  )
})

type CellInspectorPanelHandle = {
  open: (view: CellInspectorView, selection: string[]) => void
  close: () => void
  setSelection: (selection: string[]) => void
}

const CellInspectorPanel = memo(forwardRef<CellInspectorPanelHandle, {
  tabKey: string
  orderedColumns: string[]
  rowByKey: Map<string, EditableRow>
  columnInfoMap?: Record<string, ColumnInfo>
  editable: boolean
  onUpdateValue: (rowKey: string, column: string, rawValue: string) => void
}>(
  function CellInspectorPanel({
    tabKey,
    orderedColumns,
    rowByKey,
    columnInfoMap,
    editable,
    onUpdateValue
  }, ref) {
    const [open, setOpen] = useState(false)
    const [view, setView] = useState<CellInspectorView>('record')
    const [selection, setSelection] = useState<string[]>([])
    const [valueDisplayMode, setValueDisplayMode] = useState<ValueDisplayMode>('raw')
    const openRef = useRef(open)

    useEffect(() => {
      openRef.current = open
    }, [open])

    useImperativeHandle(ref, () => ({
      open: (nextView, nextSelection) => {
        setSelection((current) => (
          current.length === nextSelection.length && current.every((item, index) => item === nextSelection[index])
            ? current
            : [...nextSelection]
        ))
        setView(nextView)
        setOpen(true)
      },
      close: () => {
        setOpen(false)
      },
      setSelection: (nextSelection) => {
        if (!openRef.current) {
          return
        }
        setSelection((current) => (
          current.length === nextSelection.length && current.every((item, index) => item === nextSelection[index])
            ? current
            : [...nextSelection]
        ))
      }
    }), [])

    const orderedRowKeys = useMemo(() => Array.from(rowByKey.keys()), [rowByKey])
    const orderedRowKeysByLength = useMemo(() => [...orderedRowKeys].sort((left, right) => right.length - left.length), [orderedRowKeys])
    const orderedColumnIndexMap = useMemo(() => Object.fromEntries(orderedColumns.map((column, index) => [column, index] as const)), [orderedColumns])

    const bounds = useMemo(() => {
      const parseCellKey = (cellKey: string): { rowKey: string; column: string } | null => {
        for (const rowKey of orderedRowKeysByLength) {
          const prefix = `${rowKey}:`
          if (cellKey.startsWith(prefix)) {
            return { rowKey, column: cellKey.slice(prefix.length) }
          }
        }
        return null
      }

      const entries = selection
        .map((cellKey) => {
          const parsed = parseCellKey(cellKey)
          if (!parsed) {
            return null
          }
          const rowIndex = orderedRowKeys.indexOf(parsed.rowKey)
          const columnIndex = orderedColumnIndexMap[parsed.column]
          if (rowIndex < 0 || columnIndex === undefined) {
            return null
          }
          return {
            cellKey,
            rowKey: parsed.rowKey,
            column: parsed.column,
            rowIndex,
            columnIndex,
            value: rowByKey.get(parsed.rowKey)?.[parsed.column]
          }
        })
        .filter((entry): entry is {
          cellKey: string
          rowKey: string
          column: string
          rowIndex: number
          columnIndex: number
          value: unknown
        } => entry !== null)

      if (entries.length === 0) {
        return null
      }

      const rowIndexes = entries.map((entry) => entry.rowIndex)
      const columnIndexes = entries.map((entry) => entry.columnIndex)
      const rowStart = Math.min(...rowIndexes)
      const rowEnd = Math.max(...rowIndexes)
      const columnStart = Math.min(...columnIndexes)
      const columnEnd = Math.max(...columnIndexes)

      return {
        rowKeys: orderedRowKeys.slice(rowStart, rowEnd + 1),
        columns: orderedColumns.slice(columnStart, columnEnd + 1)
      }
    }, [orderedColumnIndexMap, orderedColumns, orderedRowKeys, orderedRowKeysByLength, rowByKey, selection])

    const columnTypeOf = (column: string): string | undefined => columnInfoMap?.[column]?.type ?? undefined
    const anchorSelection = useMemo(() => {
      if (!bounds) {
        return null
      }
      const rowKey = bounds.rowKeys[0]
      const column = bounds.columns[0]
      return {
        rowKey,
        column,
        value: rowByKey.get(rowKey)?.[column]
      }
    }, [bounds, rowByKey])
    const formattedJsonValue = useMemo(
      () => tryFormatJsonText(anchorSelection?.value),
      [anchorSelection?.value]
    )

    useEffect(() => {
      setValueDisplayMode('raw')
    }, [anchorSelection?.rowKey, anchorSelection?.column, anchorSelection?.value])

    const renderRecordView = (): React.ReactNode => {
      if (!bounds) {
        return <div className="cell-inspector-empty"><Typography.Text type="secondary">请选择单元格后查看记录</Typography.Text></div>
      }
      return (
        <div className="cell-inspector-records">
          {bounds.rowKeys.map((rowKey) => {
            const row = rowByKey.get(rowKey)
            return (
              <div className="cell-inspector-record" key={rowKey}>
                {orderedColumns.map((column) => (
                  <div className="cell-inspector-field" key={column}>
                    <div className="cell-inspector-field-label">
                      <Typography.Text type="secondary" ellipsis title={column}>{column}</Typography.Text>
                      {columnTypeOf(column) && <span className="cell-inspector-field-type">{columnTypeOf(column)}</span>}
                    </div>
                    <Input.TextArea
                      className="cell-inspector-field-value"
                      readOnly={!editable}
                      rows={3}
                      value={row?.[column] === null || row?.[column] === undefined || isDefaultValueMarker(row?.[column]) ? '' : String(row?.[column])}
                      placeholder={row?.[column] === null || row?.[column] === undefined ? 'NULL' : isDefaultValueMarker(row?.[column]) ? 'DEFAULT' : undefined}
                      onChange={(event) => {
                        if (!editable) {
                          return
                        }
                        onUpdateValue(rowKey, column, event.currentTarget.value)
                      }}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )
    }

    const renderValueView = (): React.ReactNode => {
      if (!bounds || !anchorSelection) {
        return <div className="cell-inspector-empty"><Typography.Text type="secondary">请选择单元格后查看值</Typography.Text></div>
      }
      const anchorRowKey = anchorSelection.rowKey
      const anchorColumn = anchorSelection.column
      const anchorValue = anchorSelection.value
      const readonlyJsonMode = valueDisplayMode === 'json' && Boolean(formattedJsonValue)
      return (
        <div className="cell-inspector-value-wrap">
          <Flex align="center" justify="space-between" gap={8} className="cell-inspector-value-toolbar">
            <Typography.Text type="secondary" className="cell-inspector-value-meta">{anchorColumn}{columnTypeOf(anchorColumn) ? ` · ${columnTypeOf(anchorColumn)}` : ''}</Typography.Text>
            {formattedJsonValue && (
              <Button type="text" size="small" onClick={() => setValueDisplayMode((current) => current === 'json' ? 'raw' : 'json')}>
                {readonlyJsonMode ? '原始编辑' : 'JSON 格式化'}
              </Button>
            )}
          </Flex>
          <Input.TextArea
            className="cell-inspector-value-area"
            readOnly={!editable || readonlyJsonMode}
            value={readonlyJsonMode
              ? formattedJsonValue ?? ''
              : anchorValue === null || anchorValue === undefined || isDefaultValueMarker(anchorValue)
                ? ''
                : String(anchorValue)}
            placeholder={anchorValue === null || anchorValue === undefined ? 'NULL' : isDefaultValueMarker(anchorValue) ? 'DEFAULT' : undefined}
            onChange={(event) => {
              if (!editable || readonlyJsonMode) {
                return
              }
              onUpdateValue(anchorRowKey, anchorColumn, event.currentTarget.value)
            }}
          />
        </div>
      )
    }

    const renderAggregateView = (): React.ReactNode => {
      if (!bounds) {
        return <div className="cell-inspector-empty"><Typography.Text type="secondary">请选择单元格后查看聚合</Typography.Text></div>
      }
      const flatValues = bounds.rowKeys.flatMap((rowKey) => bounds.columns.map((column) => rowByKey.get(rowKey)?.[column]))
      const nonEmpty = flatValues.filter((value) => value !== null && value !== undefined && !isDefaultValueMarker(value))
      const numbers = nonEmpty
        .map((value) => (typeof value === 'number' ? value : Number(String(value))))
        .filter((value) => Number.isFinite(value)) as number[]
      const rowsCount = bounds.rowKeys.length
      const colsCount = bounds.columns.length
      const formatNumber = (value: number): string => Number.isFinite(value) ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : '-'
      const stats: Array<{ order: number; label: string; value: string }> = [
        { order: 1, label: '非空值数量', value: String(nonEmpty.length) },
        { order: 2, label: '数值数量', value: String(numbers.length) },
        { order: 3, label: '选中行数', value: String(rowsCount) },
        { order: 4, label: '选中列数', value: String(colsCount) }
      ]
      if (numbers.length > 0) {
        const sum = numbers.reduce((total, value) => total + value, 0)
        const avg = sum / numbers.length
        const sorted = [...numbers].sort((left, right) => left - right)
        const middle = Math.floor(sorted.length / 2)
        const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
        stats.push(
          { order: 5, label: '求和', value: formatNumber(sum) },
          { order: 6, label: '平均值', value: formatNumber(avg) },
          { order: 7, label: '最小值', value: formatNumber(sorted[0]) },
          { order: 8, label: '最大值', value: formatNumber(sorted[sorted.length - 1]) },
          { order: 9, label: '中位数', value: formatNumber(median) }
        )
      }
      return (
        <div className="cell-inspector-aggregate">
          {stats.sort((left, right) => left.order - right.order).map((stat) => (
            <div className="cell-inspector-aggregate-row" key={stat.label}>
              <span className="cell-inspector-aggregate-label" title={stat.label}>{stat.label}</span>
              <span className="cell-inspector-aggregate-value">{stat.value}</span>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className={`cell-inspector${open ? ' is-open' : ''}`} data-tab-key={tabKey}>
        <div className="cell-inspector-header">
          <div className="cell-inspector-tabs">
            <button type="button" className={`cell-inspector-tab${view === 'record' ? ' active' : ''}`} onClick={() => setView('record')}>记录</button>
            <button type="button" className={`cell-inspector-tab${view === 'value' ? ' active' : ''}`} onClick={() => setView('value')}>值</button>
            <button type="button" className={`cell-inspector-tab${view === 'aggregate' ? ' active' : ''}`} onClick={() => setView('aggregate')}>聚合</button>
          </div>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setOpen(false)} aria-label="关闭" />
        </div>
        <div className="cell-inspector-body">
          {view === 'record' ? renderRecordView() : view === 'value' ? renderValueView() : renderAggregateView()}
        </div>
      </div>
    )
  }
), (prev, next) => (
  prev.tabKey === next.tabKey
  && prev.orderedColumns === next.orderedColumns
  && prev.rowByKey === next.rowByKey
  && prev.columnInfoMap === next.columnInfoMap
  && prev.editable === next.editable
  && prev.onUpdateValue === next.onUpdateValue
))

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
type TreeNodeKind = 'folder' | 'folder-drop-placeholder' | 'connection' | 'database' | 'pg-schema' | 'object-group' | 'table' | 'db-object' | 'column'

type ConnectionFolder = {
  id: string
  name: string
}

type DbObjectGroupMeta = {
  type: DbObjectType
  title: string
  icon: React.ReactNode
}

const treeIconBadge = (icon: React.ReactNode, tone: 'database' | 'schema' | 'table' | 'view' | 'trigger' | 'routine' | 'sequence' | 'index'): React.ReactNode => (
  <span className={`tree-icon-badge tree-icon-${tone}`}>
    {icon}
  </span>
)

const DB_OBJECT_GROUPS: DbObjectGroupMeta[] = [
  { type: 'table', title: '表', icon: treeIconBadge(<TableOutlined />, 'table') },
  { type: 'view', title: '视图', icon: treeIconBadge(<EyeOutlined />, 'view') },
  { type: 'trigger', title: '触发器', icon: treeIconBadge(<ThunderboltOutlined />, 'trigger') },
  { type: 'procedure', title: '存储过程', icon: treeIconBadge(<FunctionOutlined />, 'routine') },
  { type: 'function', title: '函数', icon: treeIconBadge(<FunctionOutlined />, 'routine') },
  { type: 'sequence', title: '序列', icon: treeIconBadge(<DatabaseOutlined />, 'sequence') },
  { type: 'index', title: '索引', icon: treeIconBadge(<BranchesOutlined />, 'index') }
]

const DB_OBJECT_GROUP_BY_TYPE = Object.fromEntries(DB_OBJECT_GROUPS.map((group) => [group.type, group])) as Record<DbObjectType, DbObjectGroupMeta>

const plainObjectIconByType: Record<DbObjectType, React.ReactNode> = {
  table: <TableOutlined />,
  view: <EyeOutlined />,
  trigger: <ThunderboltOutlined />,
  procedure: <FunctionOutlined />,
  function: <FunctionOutlined />,
  sequence: <DatabaseOutlined />,
  index: <BranchesOutlined />
}

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
  gaussdb: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  oracle: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
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
  folderId?: string
  connectionId?: string
  'data-connection-id'?: string
  databaseName?: string
  pgDatabaseName?: string
  tableName?: string
  objectType?: DbObjectType
  sizeDisplay?: string | null
  sizeBytes?: number | null
  storageSizeDisplay?: string | null
  storageSizeBytes?: number | null
  rowCount?: number | null
  comment?: string | null
  columnName?: string
  columnType?: string
  nullable?: boolean
  primaryKey?: boolean
  closed?: boolean
  childrenLoaded?: boolean
  children?: DatabaseTreeNode[]
}

const editableValue = (value: string): unknown => {
  return value
}

const createDefaultValueMarker = (): DefaultValueMarker => ({ __datadjinn_action__: 'default' })

const isDefaultValueMarker = (value: unknown): value is DefaultValueMarker => (
  value !== null
  && typeof value === 'object'
  && '__datadjinn_action__' in value
  && (value as DefaultValueMarker).__datadjinn_action__ === 'default'
)

const cellDisplayText = (value: unknown): string => (
  isDefaultValueMarker(value) ? 'DEFAULT' : value === null || value === undefined ? 'NULL' : String(value)
)

const isCellValueEqual = (left: unknown, right: unknown): boolean => {
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

const tableFilterValueKey = (value: unknown): string => {
  if (isDefaultValueMarker(value)) {
    return '__DATADJINN_DEFAULT__'
  }
  return value === null || value === undefined ? '__DATADJINN_NULL__' : String(value)
}

const displayValue = (value: unknown): string => {
  if (isDefaultValueMarker(value)) {
    return 'DEFAULT'
  }
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

const tableFilterValueLabel = (value: string): string => {
  if (value === '__DATADJINN_NULL__') {
    return 'NULL'
  }
  if (value === '__DATADJINN_DEFAULT__') {
    return 'DEFAULT'
  }
  return value
}

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

const QUERY_SELECT_MIN_WIDTH = 160
const QUERY_SELECT_MAX_WIDTH = 320
const QUERY_SELECT_HORIZONTAL_PADDING = 52
const QUERY_SELECT_CHAR_WIDTH = 8

const getQuerySelectWidth = (labels: string[], fallbackLabel?: string): number => {
  const candidates = [...labels, fallbackLabel ?? ''].filter(Boolean)
  const longestLength = candidates.reduce((max, current) => Math.max(max, current.length), 0)
  const estimatedWidth = longestLength * QUERY_SELECT_CHAR_WIDTH + QUERY_SELECT_HORIZONTAL_PADDING
  return Math.min(QUERY_SELECT_MAX_WIDTH, Math.max(QUERY_SELECT_MIN_WIDTH, estimatedWidth))
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
  const [connectionsInitialized, setConnectionsInitialized] = useState(false)
  const [startupUiReady, setStartupUiReady] = useState(false)
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([])
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<React.Key[]>([])
  const [connectionSelectionAnchorId, setConnectionSelectionAnchorId] = useState<string>()
  const [treeData, setTreeData] = useState<DatabaseTreeNode[]>([])
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [connectionTreeLoading, setConnectionTreeLoading] = useState<Record<string, string>>({})
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
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([])
  const [activeTabKey, setActiveTabKey] = useState<string>()
  const [queryHistoryContentReady, setQueryHistoryContentReady] = useState(false)
  const [sqlExecutionContextByTab, setSqlExecutionContextByTab] = useState<Record<string, SqlEditorExecutionContext>>({})
  const [resourcePanelSize, setResourcePanelSize] = useState(340)
  const [aiPanelSize, setAiPanelSize] = useState(360)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
  const [treeSearchOpen, setTreeSearchOpen] = useState(false)
  const [treeSearchText, setTreeSearchText] = useState('')
  const treeSearchInputRef = useRef<InputRef | null>(null)
  const queryHistoryModalRef = useRef<ImperativeModalHandle | null>(null)
  const settingsModalRef = useRef<ImperativeModalHandle | null>(null)
  const updateModalRef = useRef<ImperativeModalHandle | null>(null)
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
  const [settingsContentReady, setSettingsContentReady] = useState(false)
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
  const [updateModalContentReady, setUpdateModalContentReady] = useState(false)
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
  const currentDriverDatabaseType = driverDatabaseTypeForConnection(databaseType)
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

  useEffect(() => {
    for (const tab of workspaceTabs) {
      if (tab.kind !== 'query') {
        continue
      }
      persistQueryWorkspace(tab)
    }
  }, [workspaceTabs])

  const [allDatabases, setAllDatabases] = useState<Record<string, string[]>>({})
  const [allSchemas, setAllSchemas] = useState<Record<string, string[]>>({})
  const [activeSelector, setActiveSelector] = useState<string | null>(null)
  const [draftSelectedDatabases, setDraftSelectedDatabases] = useState<Record<string, string[]>>({})
  const [draftSelectedSchemas, setDraftSelectedSchemas] = useState<Record<string, string[]>>({})
  const [completionTables, setCompletionTables] = useState<Record<string, string[]>>({})
  const [tableBodyHeights, setTableBodyHeights] = useState<Record<string, number>>({})
  const [editingCells, setEditingCells] = useState<EditingCellState>({})
  const [resourceTreeHeight, setResourceTreeHeight] = useState(360)
  const [dragOverFolderTarget, setDragOverFolderTarget] = useState<{ folderId: string; zone: 'before' | 'after' }>()
  const [dragOverConnectionTarget, setDragOverConnectionTarget] = useState<{ connectionId: string; folderId?: string; zone: 'before' | 'after' }>()
  const [tableSearchUiState, setTableSearchUiState] = useState<Record<string, TableSearchUiState>>({})
  const treeDataRef = useRef<DatabaseTreeNode[]>([])
  const expandedKeysRef = useRef<React.Key[]>([])
  const resourceTreeRef = useRef<unknown>(null)
  const tableBodyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const tableHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const resourceTreeContainerRef = useRef<HTMLDivElement | null>(null)
  const resourceTreeViewportRef = useRef<HTMLDivElement | null>(null)
  const workspaceShellRef = useRef<HTMLDivElement | null>(null)
  const resourcePanelRef = useRef<HTMLDivElement | null>(null)
  const mainPanelRef = useRef<HTMLDivElement | null>(null)
  const aiDockPanelRef = useRef<HTMLDivElement | null>(null)
  const selectedColumnRefs = useRef<Record<string, string | undefined>>({})
  const selectedCellRefs = useRef<Record<string, string[] | undefined>>({})
  const runtimeSelectedCellRefs = useRef<Record<string, string[] | undefined>>({})
  const cellDragAnchorRefs = useRef<Record<string, { rowKey: string; column: string } | undefined>>({})
  const scrollbarDragRefs = useRef<Record<string, boolean | undefined>>({})
  const pendingCellDragTargetRefs = useRef<Record<string, { rowKey: string; column: string } | undefined>>({})
  const pendingCellDragFrameRefs = useRef<Record<string, number | undefined>>({})
  const pendingRenderedCellSelectionFrameRefs = useRef<Record<string, number | undefined>>({})
  const committingEditingCellRefs = useRef<Record<string, boolean | undefined>>({})
  const cellClipboardRef = useRef<{ text: string, values: unknown[][] } | null>(null)
  const contextMenuCellSelectionRefs = useRef<Record<string, string[] | undefined>>({})
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

  const { theme, toggleTheme } = useTheme()
  const activeTabSearchState = activeTabKey
    ? tableSearchUiState[activeTabKey]
    : undefined

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
    setTreeData((current) => replaceConnectionNode(current, connection, true))
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

  const renderConnectionTitle = (connection: ConnectionInfo): React.ReactNode => {
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
        className={`connection-tree-title ${connection.is_open ? 'is-open' : 'is-closed'}${isSelected ? ' is-selected' : ''}${connectionDropZone ? ` connection-drop-${connectionDropZone}` : ''}`}
        align="center"
        title={connectionMeta}
        data-connection-id={connection.connection_id}
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
  icon: treeIconBadge(<DatabaseOutlined />, 'database'),
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
  icon: treeIconBadge(<ApartmentOutlined />, 'schema'),
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
      const children = connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'gaussdb' || connection.database_type === 'oracle' || connection.database_type === 'mongodb' || connection.database_type === 'redis' || connection.database_type === 'clickhouse'
      ? undefined
      : buildObjectGroupNodes(connection.connection_id, undefined, undefined, connection.database_type)

    return {
      key: `connection:${connection.connection_id}`,
      title: connection.name,
      icon:
        connection.database_type === 'postgresql' ? (
          <img src={postgresIcon} alt="PG" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'gaussdb' ? (
          <DatabaseOutlined />
        ) : connection.database_type === 'mongodb' ? (
          <img src={mongoIcon} alt="MongoDB" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'redis' ? (
          <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'clickhouse' ? (
          <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'oracle' ? (
          <img src={oracleIcon} alt="Oracle" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'mysql' ? (
          <img src={mysqlIcon} alt="MySQL" style={{ width: 16, height: 16 }} />
        ) : connection.database_type === 'dm' ? (
          <img src={dmIcon} alt="DM" style={{ width: 16, height: 16 }} />
        ) : (
          <img src={sqliteIcon} alt="SQLite" style={{ width: 16, height: 16 }} />
        ),
      kind: 'connection',
      connectionId: connection.connection_id,
      'data-connection-id': connection.connection_id,
      className: `${connection.is_open ? '' : 'tree-node-closed '}tree-connection-row`.trim(),
      children,
      closed: !connection.is_open,
      childrenLoaded: Boolean(children),
      isLeaf: !connection.is_open
    }
  }

  const buildFolderDropPlaceholderNode = (folderId: string): DatabaseTreeNode => ({
    key: `${FOLDER_DROP_PLACEHOLDER_KEY_PREFIX}${folderId}`,
    title: '',
    kind: 'folder-drop-placeholder',
    folderId,
    className: 'folder-drop-placeholder-node',
    childrenLoaded: true,
    isLeaf: true
  })

  const buildFolderNode = (folder: ConnectionFolder, children: DatabaseTreeNode[]): DatabaseTreeNode => ({
    key: `folder:${folder.id}`,
    title: folder.name,
    icon: <FolderOpenOutlined />,
    kind: 'folder',
    folderId: folder.id,
    children: children.length > 0 ? children : [buildFolderDropPlaceholderNode(folder.id)],
    childrenLoaded: true,
    isLeaf: false
  })

  const collectConnectionNodesById = (nodes: DatabaseTreeNode[]): Map<string, DatabaseTreeNode> => {
    const map = new Map<string, DatabaseTreeNode>()
    const visit = (currentNodes: DatabaseTreeNode[]): void => {
      for (const node of currentNodes) {
        if (node.kind === 'connection' && node.connectionId) {
          map.set(node.connectionId, node)
        }
        if (node.children?.length) {
          visit(node.children)
        }
      }
    }
    visit(nodes)
    return map
  }

  const collectTreeNodesByKey = (nodes: DatabaseTreeNode[]): Map<string, DatabaseTreeNode> => {
    const map = new Map<string, DatabaseTreeNode>()
    const visit = (currentNodes: DatabaseTreeNode[]): void => {
      for (const node of currentNodes) {
        map.set(String(node.key), node)
        if (node.children?.length) {
          visit(node.children as DatabaseTreeNode[])
        }
      }
    }
    visit(nodes)
    return map
  }

  const getTreeNodeCopyName = (node: DatabaseTreeNode): string => {
    if (node.kind === 'column' && node.columnName) {
      return node.columnName
    }
    if ((node.kind === 'table' || node.kind === 'db-object') && node.tableName) {
      return node.tableName
    }
    if ((node.kind === 'database' || node.kind === 'pg-schema') && node.databaseName) {
      return node.databaseName
    }
    if (node.kind === 'object-group') {
      return String(node.title ?? (node.objectType ? objectGroupTitle(node.objectType) : '对象'))
    }
    return String(node.title ?? '')
  }

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

  const waitForNextFrame = (): Promise<void> => new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })

  const locateTreePath = async (targetPath?: string[]): Promise<void> => {
    if (!targetPath || targetPath.length === 0) {
      return
    }

    for (let index = 0; index < targetPath.length - 1; index += 1) {
      const currentMap = collectTreeNodesByKey(treeDataRef.current)
      const currentNode = currentMap.get(targetPath[index])
      if (!currentNode) {
        return
      }
      if (!isTreeNodeChildrenLoaded(currentNode) && isLoadableTreeNode(currentNode)) {
        await reloadNodeChildren({ ...currentNode, isLeaf: false })
        await waitForNextFrame()
      } else if (!expandedKeysRef.current.includes(currentNode.key as React.Key)) {
        setExpandedKeys((current) => current.includes(currentNode.key as React.Key) ? current : [...current, currentNode.key as React.Key])
        await waitForNextFrame()
      }
    }

    const nodeMap = collectTreeNodesByKey(treeDataRef.current)
    const targetNode = nodeMap.get(targetPath[targetPath.length - 1])
    if (!targetNode) {
      return
    }

    if (isLoadableTreeNode(targetNode) && !expandedKeysRef.current.includes(targetNode.key as React.Key)) {
      setExpandedKeys((current) => current.includes(targetNode.key as React.Key) ? current : [...current, targetNode.key as React.Key])
      await waitForNextFrame()
    }

    handleTreeSelection(targetNode)
    resourceTreeContainerRef.current?.focus()
    if (enableVirtualTree) {
      const treeApi = resourceTreeRef.current as { scrollTo?: (options: { key: React.Key, align?: 'top' | 'bottom' | 'auto', offset?: number }) => void } | null
      treeApi?.scrollTo?.({
        key: targetNode.key as React.Key,
        align: 'top',
        offset: Math.max(Math.floor(resourceTreeHeight / 2) - RESOURCE_TREE_ITEM_HEIGHT, 0)
      })
      await waitForNextFrame()
    } else {
      await waitForNextFrame()
    }
    const selectedNode = resourceTreeViewportRef.current?.querySelector('.ant-tree-node-content-wrapper.ant-tree-node-selected')
    selectedNode?.scrollIntoView({ block: 'center' })
  }

  const locateActiveTreeNode = async (): Promise<void> => {
    const currentTab = workspaceTabs.find((tab) => tab.key === activeTabKey)
    if (!currentTab?.connectionId) {
      return
    }

    let targetPath: string[] | undefined
    if (currentTab.kind === 'preview' && currentTab.tableName) {
      targetPath = [
        `connection:${currentTab.connectionId}`,
        ...(currentTab.pgDatabaseName ? [`database:${currentTab.connectionId}:${currentTab.pgDatabaseName}`] : []),
        ...(currentTab.databaseName && currentTab.pgDatabaseName ? [`pg-schema:${currentTab.connectionId}:${currentTab.pgDatabaseName}:${currentTab.databaseName}`] : currentTab.databaseName ? [`database:${currentTab.connectionId}:${currentTab.databaseName}`] : []),
        `object-group:${currentTab.connectionId}:${currentTab.pgDatabaseName ?? ''}:${currentTab.databaseName ?? ''}:table`,
        `table:${currentTab.connectionId}:${currentTab.pgDatabaseName ?? ''}:${currentTab.databaseName ?? ''}:table:${currentTab.tableName}`
      ]
    } else if (currentTab.kind === 'table-list') {
      const objectType: DbObjectType = currentTab.title.includes('视图列表') ? 'view' : 'table'
      targetPath = [
        `connection:${currentTab.connectionId}`,
        ...(currentTab.pgDatabaseName ? [`database:${currentTab.connectionId}:${currentTab.pgDatabaseName}`] : []),
        ...(currentTab.databaseName && currentTab.pgDatabaseName ? [`pg-schema:${currentTab.connectionId}:${currentTab.pgDatabaseName}:${currentTab.databaseName}`] : currentTab.databaseName ? [`database:${currentTab.connectionId}:${currentTab.databaseName}`] : []),
        `object-group:${currentTab.connectionId}:${currentTab.pgDatabaseName ?? ''}:${currentTab.databaseName ?? ''}:${objectType}`
      ]
    } else if (currentTab.kind === 'redis-browser' && currentTab.databaseName) {
      targetPath = [
        `connection:${currentTab.connectionId}`,
        `database:${currentTab.connectionId}:${currentTab.databaseName}`
      ]
    } else if (currentTab.kind === 'query') {
      targetPath = [
        `connection:${currentTab.connectionId}`,
        ...(currentTab.pgDatabaseName ? [`database:${currentTab.connectionId}:${currentTab.pgDatabaseName}`] : []),
        ...(currentTab.databaseName && currentTab.pgDatabaseName
          ? [`pg-schema:${currentTab.connectionId}:${currentTab.pgDatabaseName}:${currentTab.databaseName}`]
          : currentTab.databaseName
            ? [`database:${currentTab.connectionId}:${currentTab.databaseName}`]
            : [])
      ]
    }

    await locateTreePath(targetPath)
  }

  const findTreeKeyPathByPredicate = (nodes: DatabaseTreeNode[], predicate: (node: DatabaseTreeNode) => boolean, parentPath: string[] = []): string[] | undefined => {
    for (const node of nodes) {
      const nextPath = [...parentPath, String(node.key)]
      if (predicate(node)) {
        return nextPath
      }
      if (node.children?.length) {
        const childPath = findTreeKeyPathByPredicate(node.children as DatabaseTreeNode[], predicate, nextPath)
        if (childPath) {
          return childPath
        }
      }
    }
    return undefined
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
    const existingConnectionNodes = collectConnectionNodesById(currentNodes)
    const groupedNodes = new Map<string, DatabaseTreeNode[]>()
    const rootNodeMap = new Map<string, DatabaseTreeNode>()

    for (const connection of nextConnections) {
      const existingNode = existingConnectionNodes.get(connection.connection_id)
      const nextNode = buildConnectionNode(connection)
      const folderId = connectionFolderAssignments[connection.connection_id]
      const node = existingNode && connection.is_open
        ? { ...nextNode, folderId, children: existingNode.children, childrenLoaded: existingNode.childrenLoaded }
        : { ...nextNode, folderId }

      if (folderId && connectionFolders.some((folder) => folder.id === folderId)) {
        const items = groupedNodes.get(folderId) ?? []
        items.push(node)
        groupedNodes.set(folderId, items)
      } else {
        rootNodeMap.set(connection.connection_id, node)
      }
    }

    const folderIds = connectionFolders.map((folder) => folder.id)
    const rootConnectionIds = [...rootNodeMap.keys()]
    const orderedRootItems = mergeOrderedIds([...folderIds.map(rootFolderOrderId), ...rootConnectionIds.map(rootConnectionOrderId)], rootItemOrder)

    return orderedRootItems
      .map((itemId) => {
        if (itemId.startsWith('connection:')) {
          return rootNodeMap.get(itemId.slice('connection:'.length))
        }

        const folderId = itemId.slice('folder:'.length)
        const folder = connectionFolders.find((item) => item.id === folderId)
        if (!folder) {
          return undefined
        }

          const childNodes = groupedNodes.get(folder.id) ?? []
          const childNodeMap = new Map(childNodes.map((node) => [node.connectionId ?? String(node.key), node]))
          const orderedChildIds = mergeOrderedIds(childNodes.map((node) => node.connectionId ?? String(node.key)), folderConnectionOrder[folder.id] ?? [])
          return buildFolderNode(
            folder,
            orderedChildIds
              .map((connectionId) => childNodeMap.get(connectionId))
              .filter((node): node is DatabaseTreeNode => Boolean(node))
          )
      })
      .filter((node): node is DatabaseTreeNode => Boolean(node))
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
    const connection = getConnection(connectionId)

    if (!connection) {
      return
    }

    void (async () => {
      setConnectionTreeLoadingText(connectionId, '正在刷新连接...')
      try {
        const connKey = `connection:${connectionId}`
        const snapshot = expandedKeys.map(String)

      if (connection.database_type === 'mysql' || connection.database_type === 'postgresql' || connection.database_type === 'dm' || connection.database_type === 'gaussdb' || connection.database_type === 'oracle' || connection.database_type === 'mongodb' || connection.database_type === 'redis' || connection.database_type === 'clickhouse') {
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
          setExpandedKeys(Array.from(new Set([connKey, ...stillExpanded])))
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

  const replaceConnectionNode = (nodes: DatabaseTreeNode[], connection: ConnectionInfo, preserveChildren?: boolean): DatabaseTreeNode[] => {
    const visit = (currentNodes: DatabaseTreeNode[]): [DatabaseTreeNode[], boolean] => {
      let changed = false

      const nextNodes = currentNodes.map((node) => {
        if (node.kind === 'connection' && node.connectionId === connection.connection_id) {
          changed = true
          const nextNode = buildConnectionNode(connection)
          return preserveChildren && connection.is_open
            ? { ...nextNode, folderId: node.folderId, children: node.children, childrenLoaded: node.childrenLoaded }
            : { ...nextNode, folderId: node.folderId }
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
    const result: string[] = []
    for (const node of treeData) {
      if (node.kind === 'connection' && node.connectionId) {
        result.push(node.connectionId)
        continue
      }
      if (node.kind === 'folder' && node.folderId && expandedKeys.includes(node.key as React.Key)) {
        for (const child of node.children ?? []) {
          if (child.kind === 'connection' && child.connectionId) {
            result.push(child.connectionId)
          }
        }
      }
    }
    return result
  }

  const selectConnectionNodes = (connectionIds: string[], anchorId?: string): void => {
    const nextConnectionIds = Array.from(new Set(connectionIds))
    setSelectedConnectionIds(nextConnectionIds)
    setSelectedTreeKeys(nextConnectionIds.map((connectionId) => `connection:${connectionId}`))
    setConnectionSelectionAnchorId(anchorId ?? nextConnectionIds.at(-1))
  }

  const handleTreeSelection = (node: DatabaseTreeNode, nativeEvent?: MouseEvent): void => {
    resourceTreeContainerRef.current?.focus()
    startTransition(() => {
      setFocusedTreeNode(node)
      if (node.connectionId) {
        setSelectedConnectionId(node.connectionId)
      }
    })

    if (node.kind !== 'connection' || !node.connectionId) {
      setSelectedConnectionIds([])
      setSelectedTreeKeys([node.key as React.Key])
      return
    }

    const event = nativeEvent
    if (event?.shiftKey && connectionSelectionAnchorId) {
      const visibleConnectionIds = getVisibleConnectionIds()
      const anchorIndex = visibleConnectionIds.indexOf(connectionSelectionAnchorId)
      const currentIndex = visibleConnectionIds.indexOf(node.connectionId)
      if (anchorIndex >= 0 && currentIndex >= 0) {
        const [startIndex, endIndex] = anchorIndex <= currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex]
        selectConnectionNodes(visibleConnectionIds.slice(startIndex, endIndex + 1), connectionSelectionAnchorId)
        return
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      const nextConnectionIds = selectedConnectionIds.includes(node.connectionId)
        ? selectedConnectionIds.filter((connectionId) => connectionId !== node.connectionId)
        : [...selectedConnectionIds, node.connectionId]
      selectConnectionNodes(nextConnectionIds.length > 0 ? nextConnectionIds : [node.connectionId], node.connectionId)
      return
    }

    selectConnectionNodes([node.connectionId], node.connectionId)
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

  const getRelativeDropPosition = (node: DatabaseTreeNode, dropPosition: number): number => {
    const pos = (node as DatabaseTreeNode & { pos?: string }).pos
    const index = Number(pos?.split('-').at(-1))
    return Number.isFinite(index) ? dropPosition - index : Math.sign(dropPosition)
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

  const updateWorkspaceTab = (key: string, patch: Partial<WorkspaceTab>): void => {
    setWorkspaceTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)))
  }

  const renameWorkspaceTab = (key: string, title: string): void => {
    updateWorkspaceTab(key, { title })
  }

  const persistQueryWorkspace = (tab: WorkspaceTab): void => {
    if (tab.kind !== 'query') {
      return
    }
    const sql = tab.sql ?? ''
    const persistedAt = Date.now()
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
      persistedAt
    }
    setPersistedQueryWorkspaces((current) => {
      const next = [nextItem, ...current.filter((item) => item.key !== tab.key)]
      return next.slice(0, 200)
    })
  }

  const removePersistedQueryWorkspace = (key: string): void => {
    setPersistedQueryWorkspaces((current) => current.filter((item) => item.key !== key))
  }

  const getDefaultTableSearchUiState = (_tab: WorkspaceTab): TableSearchUiState => ({
    visible: false,
    query: '',
    caseSensitive: false,
    regex: false,
    wholeWord: false,
    filterRows: false,
    activeMatchIndex: 0
  })

  const getImmediateTableSearchState = (tab: WorkspaceTab): TableSearchUiState =>
    tableSearchUiState[tab.key] ?? getDefaultTableSearchUiState(tab)

  const updateTableSearchState = (tab: WorkspaceTab, patch: Partial<TableSearchUiState>): void => {
    if (inlineCellEditorRefs.current[tab.key]) {
      commitInlineCellEditor(tab.key)
    }
    setTableSearchUiState((current) => {
      const previousState = current[tab.key] ?? getDefaultTableSearchUiState(tab)
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
        return current
      }
      return {
        ...current,
        [tab.key]: nextState
      }
    })
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
    const nextContent = displayValue ?? current.originalContent
    current.input.remove()
    if (current.host.isConnected) {
      current.host.textContent = nextContent
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
    setEditingCells((current) => {
      if (!current[tabKey]) {
        return current
      }
      return { ...current, [tabKey]: undefined }
    })
    syncRenderedCellSelection(tabKey)
  }

  const commitInlineCellEditor = (tabKey: string): void => {
    const current = inlineCellEditorRefs.current[tabKey]
    if (!current || committingEditingCellRefs.current[tabKey]) {
      return
    }
    committingEditingCellRefs.current[tabKey] = true
    const nextValue = current.input.value
    const { rowKey, column } = current
    if (nextValue === current.initialInputValue) {
      closeEditingCell(tabKey, cellDisplayText(current.originalValue))
      setEditingCells((state) => ({ ...state, [tabKey]: undefined }))
      return
    }
    closeEditingCell(tabKey, cellDisplayText(editableValue(nextValue)))
    window.setTimeout(() => {
      updatePreviewCell(tabKey, rowKey, column, editableValue(nextValue))
    }, 0)
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
    input.addEventListener('mousedown', (event) => event.stopPropagation())
    input.addEventListener('dblclick', (event) => event.stopPropagation())
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commitInlineCellEditor(tabKey)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeEditingCell(tabKey)
      }
    })
    input.addEventListener('blur', () => commitInlineCellEditor(tabKey))
    host.textContent = ''
    host.classList.add('editable-cell-inline-editing')
    host.appendChild(input)
    inlineCellEditorRefs.current[tabKey] = { rowKey, column, input, host, originalContent, originalValue: rawValue, initialInputValue }
    setEditingCells((current) => ({ ...current, [tabKey]: { rowKey, column } }))
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
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
      const nextHeight = Math.max(160, element.clientHeight - 39)
      setTableBodyHeights((current) => current[activeTabKey] === nextHeight ? current : { ...current, [activeTabKey]: nextHeight })
    }

    updateTableBodyHeight()
    const observer = new ResizeObserver(updateTableBodyHeight)
    observer.observe(element)

    return () => observer.disconnect()
  }, [activeTabKey, workspaceTabs.length])

  useEffect(() => {
    if (!activeTabKey) {
      return
    }
    const activeTab = workspaceTabs.find((tab) => tab.key === activeTabKey)
    if (!activeTab || activeTab.loading) {
      return
    }
    requestAnimationFrame(() => {
      syncRenderedCellSelection(activeTabKey)
    })
  }, [activeTabKey, workspaceTabs])

  useEffect(() => {
    const element = resourceTreeViewportRef.current
    if (!element) {
      return
    }

    const updateTreeHeight = (): void => {
      const nextHeight = Math.max(240, Math.floor(element.clientHeight))
      setResourceTreeHeight((current) => current === nextHeight ? current : nextHeight)
    }

    updateTreeHeight()
    const observer = new ResizeObserver(updateTreeHeight)
    observer.observe(element)

    return () => observer.disconnect()
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

  const closeWorkspaceTab = (key: string): void => {
    setWorkspaceTabs((current) => {
      const index = current.findIndex((tab) => tab.key === key)
      const nextTabs = current.filter((tab) => tab.key !== key)

      if (activeTabKey === key) {
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
    delete runtimeSelectedCellRefs.current[key]
    delete scrollbarDragRefs.current[key]
    delete contextMenuCellSelectionRefs.current[key]
    cellInspectorPanelRefs.current[key]?.close()
    delete cellInspectorPanelRefs.current[key]
    delete selectedColumnRefs.current[key]
    delete tableBodyRefs.current[key]
  }

  const connectionMap = useMemo(() => new Map(connections.map((connection) => [connection.connection_id, connection])), [connections])
  const getConnection = useCallback((connectionId?: string): ConnectionInfo | undefined => (
    connectionId ? connectionMap.get(connectionId) : undefined
  ), [connectionMap])
  const deferredTreeData = useDeferredValue(treeData)
  useEffect(() => {
    treeDataRef.current = treeData
  }, [treeData])
  useEffect(() => {
    expandedKeysRef.current = expandedKeys
  }, [expandedKeys])

  const resourceTreeNodeCount = useMemo(() => {
    let count = 0
    const walk = (nodes: DatabaseTreeNode[]): void => {
      for (const node of nodes) {
        count += 1
        if (node.children?.length) {
          walk(node.children as DatabaseTreeNode[])
        }
      }
    }
    walk(treeData)
    return count
  }, [treeData])

  const enableVirtualTree = resourceTreeNodeCount > 240
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
        databaseName: isDatabaseScopedType(connection.database_type) || connection.database_type === 'dm' || connection.database_type === 'oracle' ? getDefaultDatabaseName(connection) : undefined,
        pgDatabaseName: isSchemaScopedType(connection.database_type) ? getDefaultPgDatabase(connection) : undefined
      })
      return
    }

    if (node.kind === 'database') {
      const schemaKey = `${node.connectionId}:${node.databaseName}`
      const schemas = selectedSchemas[schemaKey] ?? allSchemas[schemaKey] ?? []
      setAiActiveContext({
        connectionId: node.connectionId,
        databaseName: isSchemaScopedType(connection.database_type) ? getDefaultPgSchema(schemas) : node.databaseName,
        pgDatabaseName: isSchemaScopedType(connection.database_type) ? node.databaseName : undefined
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
      if (connection.database_type === 'sqlite') {
        void openConnectionModal('sqlite')
      } else {
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
      ...(connection.database_type === 'redis' ? [] : [{
        key: 'new-database',
        label: connection.database_type === 'sqlite' ? '新增 SQLite 数据库文件' : connection.database_type === 'oracle' ? '新建用户' : '新建库',
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
          className={`tree-title-row folder-title-row${folderDropZone ? ` folder-drop-${folderDropZone}` : ''}`}
          data-folder-id={node.folderId}
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
      return <span className="folder-drop-placeholder-title" />
    }

    if (node.kind === 'connection' && node.connectionId) {
      const connection = getConnection(node.connectionId)
      return connection ? renderConnectionTitle(connection) : (node.title as React.ReactNode)
    }

    if (node.kind === 'column') {
      const title = String(node.title ?? '')
      return <span className={`table-tree-title${loading ? ' is-loading' : ''}`} title={title}>{highlightTreeSearchText(title)}</span>
    }

    if ((node.kind === 'database' || node.kind === 'pg-schema') && node.connectionId && node.databaseName) {
      const connectionId = node.connectionId
      const databaseName = node.databaseName
      const isPgDb = node.kind === 'database' && isSchemaScopedType(getConnection(connectionId)?.database_type)
      const selKey = `${connectionId}:${databaseName}`
      const schemas = allSchemas[selKey] ?? []
      const selectedSchemaList = selectedSchemas[selKey] ?? schemas
      const draftSelectedSchemaList = draftSelectedSchemas[selKey] ?? selectedSchemaList
      const schemaCount = schemas.length
      const selectedCount = selectedSchemaList.length

      return (
        <Flex align="center" justify="space-between" className="tree-title-row">
          <div className="tree-title-with-size">
            <span className={`table-tree-title${loading ? ' is-loading' : ''}`}>{highlightTreeSearchText(String(node.title ?? ''))}</span>
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
      return highlightTreeSearchText(String(node.title ?? ''))
    }

    return (
      <Flex align="center" justify="space-between" className="tree-title-with-size">
        <span className="table-tree-title" title={node.kind === 'table' ? (node.comment?.trim() || String(node.title ?? '')) : String(node.title ?? '')}>
          {highlightTreeSearchText(String(node.title ?? ''))}
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
    const showPager = tab.kind !== 'table-list' && tab.resultKind !== 'command' && tab.resultKind !== 'error'
    const rowText = tab.result
      ? tab.kind === 'preview'
        ? `总行数 ${totalRows ?? 0} 行`
        : tab.kind === 'table-list'
          ? `${tab.result.row_count} 张表`
        : tab.kind === 'redis-browser'
          ? `${tab.result.row_count} 项`
          : `${tab.result.row_count} 行`
      : '暂无结果'
    const pendingChanges = countPendingChanges(tab)

    return (
      <Flex align="center" justify="space-between" gap={8} className="result-status">
        <Space wrap className="result-status-left">
          <Tag color={tab.kind === 'query' ? 'blue' : tab.kind === 'redis-browser' ? 'red' : tab.kind === 'table-list' ? 'gold' : 'green'}>
            {tab.kind === 'query' ? 'SQL 查询' : tab.kind === 'redis-browser' ? 'Redis 浏览' : tab.kind === 'table-list' ? '表列表' : '表预览'}
          </Tag>
          {connection && <Tag>{connection.name}</Tag>}
          {tab.kind === 'redis-browser' && tab.databaseName && <Tag>{tab.databaseName}</Tag>}
          {tab.kind === 'table-list' && (tab.databaseName || tab.pgDatabaseName) && (
            <Tag>{isSchemaScopedType(connection?.database_type) ? [tab.pgDatabaseName, tab.databaseName].filter(Boolean).join('.') : (tab.databaseName || tab.pgDatabaseName)}</Tag>
          )}
          {tab.tableName && tab.kind !== 'redis-browser' && <Tag>{tab.tableName}</Tag>}
          <Typography.Text type="secondary">{rowText}</Typography.Text>
          {tab.result?.limited && <Tag color="warning">已截断</Tag>}
          {pendingChanges > 0 && <Tag color="orange">{pendingChanges} 项未提交</Tag>}
        </Space>
        {showPager && <div className="result-status-right">{renderResultPager(tab)}</div>}
      </Flex>
    )
  }

  const renderQueryExecutionStatus = (tab: WorkspaceTab): React.ReactNode => {
    if (tab.resultKind === 'command') {
      return (
        <div className="query-execution-card success">
          <Button type="text" size="small" icon={<CloseOutlined />} className="query-execution-close" aria-label="关闭" onClick={() => updateWorkspaceTab(tab.key, { resultKind: undefined, commandMessage: undefined, commandAffectedRows: undefined, error: undefined })} />
          <CheckCircleOutlined />
          <div className="query-execution-card-body">
            <Typography.Text strong>{tab.commandMessage || '执行成功'}</Typography.Text>
            <Typography.Text type="secondary">
              影响数据 {tab.commandAffectedRows ?? 0} 行
            </Typography.Text>
          </div>
        </div>
      )
    }

    if (tab.resultKind === 'error') {
      return (
        <div className="query-execution-card error">
          <Button type="text" size="small" icon={<CloseOutlined />} className="query-execution-close" aria-label="关闭" onClick={() => updateWorkspaceTab(tab.key, { resultKind: undefined, error: undefined })} />
          <CloseCircleOutlined />
          <div className="query-execution-card-body">
            <Typography.Text>{tab.error || '未知错误'}</Typography.Text>
          </div>
        </div>
      )
    }

    return null
  }

  const renderEditableCell = (
    tabKey: string,
    rowKey: string,
    column: string,
    value: unknown,
    editable: boolean,
    onCellDragEnter: () => void,
    contextMenuItems: MenuProps['items'],
    onContextMenuAction: (key: string, cellKey: string) => void,
    onContextSelection: (cellKey: string) => void,
    displayContent?: React.ReactNode
  ): React.ReactNode => {
    const cellKey = `${rowKey}:${column}`
    return (
      <Dropdown
        trigger={['contextMenu']}
        onOpenChange={(open) => {
          if (!open) {
            scheduleSelectionRenderSync(() => syncRenderedCellSelection(tabKey))
          }
        }}
        menu={{
          items: contextMenuItems,
          onClick: ({ key }) => {
            onContextMenuAction(String(key), cellKey)
          }
        }}
      >
        <span
          className={`editable-cell${value === null || value === undefined ? ' editable-cell-null' : ''}`}
          data-column-key={column}
          data-row-key={rowKey}
          data-cell-key={cellKey}
          onContextMenu={(event) => {
            event.stopPropagation()
            tableBodyRefs.current[tabKey]?.focus()
            rowDragAnchorRefs.current[tabKey] = undefined
            cellDragAnchorRefs.current[tabKey] = undefined
            pendingCellDragTargetRefs.current[tabKey] = undefined
            const committedSelection = selectedCellRefs.current[tabKey] ?? []
            if (!committedSelection.includes(cellKey)) {
              runtimeSelectedCellRefs.current[tabKey] = undefined
            } else {
              runtimeSelectedCellRefs.current[tabKey] = [...committedSelection]
            }
            syncRenderedCellSelection(tabKey)
            scheduleSelectionRenderSync(() => syncRenderedCellSelection(tabKey))
            clearRuntimeColumnSelection(tabKey)
            onContextSelection(cellKey)
          }}
          onMouseDown={(event) => {
            if (event.button !== 0 || inlineCellEditorRefs.current[tabKey]) {
              return
            }
            event.stopPropagation()
            tableBodyRefs.current[tabKey]?.focus()
            cellDragAnchorRefs.current[tabKey] = { rowKey, column }
            applyRuntimeCellSelection(tabKey, rowKey, column)
            clearRuntimeColumnSelection(tabKey)
          }}
          onDoubleClick={(event) => {
            if (!editable) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            rowDragAnchorRefs.current[tabKey] = undefined
            cellDragAnchorRefs.current[tabKey] = undefined
            pendingCellDragTargetRefs.current[tabKey] = undefined
            runtimeSelectedCellRefs.current[tabKey] = undefined
            openInlineCellEditor(tabKey, rowKey, column, event.currentTarget, value)
          }}
          onMouseEnter={onCellDragEnter}
          onMouseUp={(event) => {
            event.stopPropagation()
            if (event.button !== 0) {
              return
            }
            if (editingCells[tabKey]?.rowKey === rowKey && editingCells[tabKey]?.column === column) {
              return
            }
            rowDragAnchorRefs.current[tabKey] = undefined
            cellDragAnchorRefs.current[tabKey] = undefined
            if (pendingCellDragFrameRefs.current[tabKey]) {
              window.cancelAnimationFrame(pendingCellDragFrameRefs.current[tabKey]!)
              pendingCellDragFrameRefs.current[tabKey] = undefined
            }
            pendingCellDragTargetRefs.current[tabKey] = undefined
            commitRuntimeCellSelection(tabKey, runtimeSelectedCellRefs.current[tabKey] ?? [])
          }}
        >
          {displayContent ?? cellDisplayText(value)}
        </span>
      </Dropdown>
    )
  }

  const renderWhereInput = (tab: WorkspaceTab): React.ReactNode => {
    if (tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName) {
      return (
        <WhereClauseInput
          tabKey={tab.key}
          columns={['key', 'type', 'ttl', 'length', 'memory', 'value']}
          label="KEY LIKE"
          placeholder="输入 Redis Key 名称，回车模糊查询"
          disableSuggestions
          value={tab.where ?? ''}
          onSubmit={(nextWhere) => {
            updateWorkspaceTab(tab.key, { where: nextWhere })
            void previewRedisDatabase(tab.connectionId!, tab.databaseName!, tab.limit, 1, tab.key, nextWhere)
          }}
        />
      )
    }

    if (tab.kind !== 'preview' || !tab.connectionId || !tab.tableName) {
      return null
    }

    return (
      <WhereClauseInput
        tabKey={tab.key}
        columns={(tab.result?.columns ?? []).filter((column) => column !== '__rowKey')}
        value={tab.where ?? ''}
        onSubmit={(nextWhere) => {
          updateWorkspaceTab(tab.key, { where: nextWhere })
          const previewObjectType = tab.objectType === 'view' ? 'view' : 'table'
          void previewTable(tab.connectionId!, tab.tableName!, tab.databaseName, tab.pgDatabaseName, tab.limit, 1, nextWhere, previewObjectType)
        }}
      />
    )
  }

  const renderTableToolbar = (
    tab: WorkspaceTab,
    searchMeta: {
      matchCount: number
      resetKey: string
      focusSearchMatch: (matchIndex: number) => void
    }
  ): React.ReactNode => {
    if (tab.kind === 'table-list') {
      return null
    }

    const searchState = getImmediateTableSearchState(tab)
    const connection = getConnection(tab.connectionId)
    const showPreviewActions = tab.kind === 'preview' && tab.connectionId && tab.tableName && connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis'
    const showRedisRefresh = tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName
    const showPreviewSearch = tab.kind === 'preview' || tab.kind === 'redis-browser'
    const showPreviewDdl = Boolean(tab.kind === 'preview' && tab.connectionId && tab.tableName)

    const leftActions = (
      <Space size={4} className="table-data-actions">
        {showRedisRefresh && (
          <>
            <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<ReloadOutlined />} title="刷新" aria-label="刷新" loading={tab.loading} onClick={() => void previewRedisDatabase(tab.connectionId!, tab.databaseName!, tab.limit, tab.page, tab.key, tab.where)} />
            <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<PlusOutlined />} title="新增一行" aria-label="新增一行" onClick={() => addRedisRow(tab)} />
            <Button className="table-toolbar-icon-btn" type="text" size="small" icon={<SaveOutlined />} title="提交" aria-label="提交" disabled={countRedisPendingChanges(tab) === 0} loading={tab.loading} onClick={() => void submitRedisChanges(tab)} />
          </>
        )}
        {showPreviewActions && (
          <>
            <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<ReloadOutlined />} title="刷新" aria-label="刷新" loading={tab.loading} onClick={() => void previewTable(tab.connectionId!, tab.tableName!, tab.databaseName, tab.pgDatabaseName, tab.limit, tab.page, tab.where)} />
            <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<PlusOutlined />} title="新增行" aria-label="新增行" onClick={() => addPreviewRow(tab)} />
            <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<MinusOutlined />} title="删除选中行" aria-label="删除选中行" disabled={!tab.selectedRowKeys?.length} onClick={() => markSelectedRowsDeleted(tab)} />
            <Button className="table-toolbar-icon-btn" type="text" size="small" icon={<SaveOutlined />} title="提交" aria-label="提交" disabled={countPendingChanges(tab) === 0} loading={tab.loading} onClick={() => void submitPreviewChanges(tab)} />
          </>
        )}
      </Space>
    )

    return (
      <ResultTableHeader
        leftActions={leftActions}
        whereInput={renderWhereInput(tab)}
        rightActions={showPreviewSearch || showPreviewDdl ? (
          <Space size={4} className="table-toolbar-inline-actions">
            {showPreviewSearch && (
              <Button
                size="small"
                type="text"
                icon={<SearchOutlined />}
                title="页内搜索"
                aria-label="页内搜索"
                className={searchState.query.trim() || searchState.visible ? 'table-toolbar-icon-btn table-toolbar-toggle is-active' : 'table-toolbar-icon-btn table-toolbar-toggle'}
                onClick={() => {
                  if (searchState.query.trim() || searchState.visible) {
                    clearActiveSearchCellHighlight(tab.key)
                    updateTableSearchState(tab, {
                      visible: false,
                      query: '',
                      filterRows: false,
                      activeMatchIndex: 0
                    })
                    return
                  }
                  updateTableSearchState(tab, { visible: true })
                }}
              />
            )}
            {showPreviewDdl && (
              <Button
                size="small"
                type="text"
                title="查看 DDL"
                aria-label="查看 DDL"
                className="table-toolbar-icon-btn table-ddl-button"
                onClick={() => void showObjectDdl(tab.connectionId!, tab.tableName!, tab.objectType ?? 'table', tab.databaseName, tab.pgDatabaseName)}
              >
                DDL
              </Button>
            )}
          </Space>
        ) : null}
        searchState={searchState}
        searchMeta={searchMeta}
        onSearchStateChange={(patch) => updateTableSearchState(tab, patch)}
        onClearActiveHighlight={() => clearActiveSearchCellHighlight(tab.key)}
        searchVisible={Boolean(searchState.query.trim() || searchState.visible)}
        onToggleSearch={() => {
          if (searchState.query.trim() || searchState.visible) {
            clearActiveSearchCellHighlight(tab.key)
            updateTableSearchState(tab, {
              visible: false,
              query: '',
              filterRows: false,
              activeMatchIndex: 0
            })
            return
          }
          updateTableSearchState(tab, { visible: true })
        }}
      />
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
    const showPageSearch = tab.kind === 'query'
    const searchState = getImmediateTableSearchState(tab)
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
        <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<DoubleLeftOutlined />} title="棣栭〉" aria-label="棣栭〉" disabled={tab.loading || page <= 1} onClick={() => void changeTabPage(tab, 1)} />
        <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<LeftOutlined />} title="上一页" aria-label="上一页" disabled={tab.loading || page <= 1} onClick={() => void changeTabPage(tab, page - 1)} />
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
        <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<RightOutlined />} title="下一页" aria-label="下一页" disabled={tab.loading || !hasNext} onClick={() => void changeTabPage(tab, page + 1)} />
        <Button className="table-toolbar-icon-btn" size="small" type="text" icon={<DoubleRightOutlined />} title="末页" aria-label="末页" disabled={tab.loading || !totalPages || page >= totalPages} onClick={() => totalPages && void changeTabPage(tab, totalPages)} />
        <Select
          size="small"
          variant="borderless"
          value={limit}
          className="result-limit-select"
          options={[300, 500, 1000].map((value) => ({ label: `${value} 条/页`, value }))}
          disabled={tab.loading}
          onChange={(value) => void changeTabLimit(tab, value)}
        />
        {showPageSearch && (
          <Button
            size="small"
            icon={<SearchOutlined />}
            title="页内搜索"
            aria-label="页内搜索"
            className={searchState.query.trim() || searchState.visible ? 'table-toolbar-toggle is-active' : 'table-toolbar-toggle'}
            onClick={() => {
              if (searchState.query.trim() || searchState.visible) {
                clearActiveSearchCellHighlight(tab.key)
                updateTableSearchState(tab, {
                  visible: false,
                  query: '',
                  filterRows: false,
                  activeMatchIndex: 0
                })
                return
              }
              updateTableSearchState(tab, { visible: true })
            }}
          />
        )}
      </Space>
    )
  }

  const clearRuntimeColumnSelection = (tabKey: string): void => {
    selectedColumnRefs.current[tabKey] = undefined
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container.querySelectorAll('.column-selected-runtime').forEach((element) => element.classList.remove('column-selected-runtime'))
    container.querySelectorAll('.column-select-button-runtime-selected').forEach((element) => element.classList.remove('column-select-button-runtime-selected'))
  }

  const clearRenderedCellSelection = (tabKey: string): void => {
    const container = tableBodyRefs.current[tabKey]
    if (!container) {
      return
    }
    container.querySelectorAll('.cell-selected-runtime').forEach((element) => element.classList.remove('cell-selected-runtime'))
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
    container.querySelectorAll<HTMLElement>('.cell-selected-runtime').forEach((element) => {
      const renderedCellKey = element.dataset.cellKey ?? ''
      if (!nextCellKeySet.has(renderedCellKey)) {
        element.classList.remove('cell-selected-runtime')
      }
    })
    for (const cellKey of cellKeys) {
      container
        .querySelector<HTMLElement>(`.editable-cell[data-cell-key="${CSS.escape(cellKey)}"]`)
        ?.classList.add('cell-selected-runtime')
    }
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

  const scheduleRenderedCellSelectionSync = (tabKey: string): void => {
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
    clearRuntimeCellSelection(tabKey)
    setCommittedCellSelection(tabKey, cellKeys)
  }

  const renderRedisBrowser = (tab: WorkspaceTab): React.ReactNode => {
    const rows = tab.result?.rows ?? []
    const edits = tab.redisEdits ?? {}
    return (
      <div className="result-table-shell">
        {renderResultStatus(tab)}
        {renderTableToolbar(tab, {
          matchCount: 0,
          resetKey: '',
          focusSearchMatch: () => undefined
        })}
        {tab.error && <Alert className="result-inline-alert" message={tab.error} type="error" showIcon closable onClose={() => updateWorkspaceTab(tab.key, { error: undefined })} />}
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
                  {expanded ? <DownOutlined /> : <RightOutlined />}
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
                    <Button className="redis-delete-button" size="small" danger type="text" icon={<DeleteOutlined />} aria-label="删除" title="删除" onClick={() => deleteRedisRow(tab.key, rowKey)} />
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
    if (tab.kind === 'query' && !tab.resultVisible) {
      return (
        <div className="query-result-empty">
          <Typography.Text type="secondary">执行 SQL 后在这里查看查询结果或执行状态</Typography.Text>
        </div>
      )
    }

    const searchState = getImmediateTableSearchState(tab)
    const supportsCellSelection = tab.kind === 'preview' || tab.kind === 'query' || tab.kind === 'table-list'
    const supportsWritableCells = tab.kind === 'preview'
    const baseTableRows: EditableRow[] = tab.kind === 'preview' ? (tab.editRows ?? []) : (tab.result?.rows.map((row, index) => ({ ...row, __rowKey: `query:${index}` })) ?? [])
    const selectedRowKeyMap = tab.selectedRowKeyMap ?? Object.fromEntries((tab.selectedRowKeys ?? []).map((key) => [String(key), true]))
    const resultColumns = tab.result?.columns ?? []
    const orderedColumns = [...(tab.columnOrder ?? []).filter((column) => resultColumns.includes(column)), ...resultColumns.filter((column) => !(tab.columnOrder ?? []).includes(column))]
    const columnFilters = tab.columnFilters ?? {}
    const filterColumns = Object.keys(columnFilters)
    const filteredRows = filterColumns.length > 0
      ? baseTableRows.filter((row) => filterColumns.every((column) => columnFilters[column]?.includes(tableFilterValueKey(row[column]))))
      : baseTableRows
    const sortedRows = filteredRows
    const connection = getConnection(tab.connectionId)
    const pageSearchText = searchState.query.trim()
    const searchMatcher = createSearchMatcher(pageSearchText, {
      regex: searchState.regex,
      wholeWord: searchState.wholeWord,
      caseSensitive: searchState.caseSensitive
    })

    const allSearchMatches: Array<{ cellKey: string; rowKey: string; column: string }> = []
    const matchedCellKeySet = new Set<string>()
    const highlightedCellHtmlCache = new Map<string, string | null>()
    if (searchMatcher) {
      for (const row of sortedRows) {
        for (const column of orderedColumns) {
          const text = cellDisplayText(row[column])
          if (!text) {
            continue
          }
          if (!searchMatcher.matches(text)) {
            continue
          }
          const cellKey = `${row.__rowKey}:${column}`
          matchedCellKeySet.add(cellKey)
          allSearchMatches.push({
            cellKey,
            rowKey: row.__rowKey,
            column
          })
        }
      }
    }

    const matchedRowKeySet = new Set(allSearchMatches.map((match) => match.rowKey))
    const tableRows = searchState.filterRows && searchMatcher
      ? sortedRows.filter((row) => matchedRowKeySet.has(row.__rowKey))
      : sortedRows
    const rowNumberOffset = ((tab.page ?? 1) - 1) * (tab.limit ?? (tab.kind === 'preview' ? PREVIEW_DEFAULT_LIMIT : QUERY_DEFAULT_LIMIT))
    const orderedRowKeys = tableRows.map((row) => row.__rowKey)
    const orderedColumnIndexMap = Object.fromEntries(orderedColumns.map((column, index) => [column, index]))
    const orderedRowKeysByLength = [...orderedRowKeys].sort((left, right) => right.length - left.length)
    const rowByKey = new Map(tableRows.map((row) => [row.__rowKey, row]))
    const visibleRowKeySet = new Set(orderedRowKeys)
    const searchMatches = allSearchMatches.filter((match) => visibleRowKeySet.has(match.rowKey))
    const highlightResultText = (cellKey: string, text: string, className?: string): React.ReactNode => (
      <SearchHighlightedText
        text={text}
        className={className}
        highlightedHtml={(() => {
          if (!matchedCellKeySet.has(cellKey) || !searchMatcher) {
            return undefined
          }
          if (!highlightedCellHtmlCache.has(cellKey)) {
            highlightedCellHtmlCache.set(cellKey, searchMatcher.highlight(text))
          }
          return highlightedCellHtmlCache.get(cellKey) ?? undefined
        })()}
      />
    )

    const focusSearchMatch = (matchIndex: number): void => {
      const match = searchMatches[matchIndex]
      if (!match) {
        return
      }
      clearActiveSearchCellHighlight(tab.key)
      if (supportsCellSelection) {
        clearRuntimeColumnSelection(tab.key)
        rowDragAnchorRefs.current[tab.key] = undefined
        cellDragAnchorRefs.current[tab.key] = undefined
        pendingCellDragTargetRefs.current[tab.key] = undefined
        setCommittedCellSelection(tab.key, [match.cellKey])
      }
      requestAnimationFrame(() => {
        const container = tableBodyRefs.current[tab.key]
        if (!container) {
          return
        }
        container.focus()
        const cellElement = container.querySelector<HTMLElement>(`[data-cell-key="${CSS.escape(match.cellKey)}"]`)
        const hostCell = cellElement?.closest('td') as HTMLElement | null
        if (hostCell) {
          hostCell.classList.add('cell-search-active')
          hostCell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        } else {
          cellElement?.classList.add('cell-search-active')
          cellElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      })
    }

    const parseCellKey = (cellKey: string): { rowKey: string; column: string } | null => {
      for (const rowKey of orderedRowKeysByLength) {
        const prefix = `${rowKey}:`
        if (cellKey.startsWith(prefix)) {
          return { rowKey, column: cellKey.slice(prefix.length) }
        }
      }
      return null
    }

    const getSelectionEntries = (cellKeys: string[]) => cellKeys
      .map((cellKey) => {
        const parsed = parseCellKey(cellKey)
        if (!parsed) {
          return null
        }
        const rowIndex = orderedRowKeys.indexOf(parsed.rowKey)
        const columnIndex = orderedColumnIndexMap[parsed.column]
        if (rowIndex < 0 || columnIndex === undefined) {
          return null
        }
        return {
          cellKey,
          rowKey: parsed.rowKey,
          column: parsed.column,
          rowIndex,
          columnIndex,
          value: rowByKey.get(parsed.rowKey)?.[parsed.column]
        }
      })
      .filter((entry): entry is {
        cellKey: string
        rowKey: string
        column: string
        rowIndex: number
        columnIndex: number
        value: unknown
      } => entry !== null)

    const getCommittedCellSelection = (): string[] => {
      const runtime = runtimeSelectedCellRefs.current[tab.key] ?? []
      if (runtime.length > 0) {
        return runtime
      }
      return selectedCellRefs.current[tab.key] ?? []
    }

    const getSelectionBounds = (cellKeys = getCommittedCellSelection()): {
      rowStart: number
      rowEnd: number
      columnStart: number
      columnEnd: number
      rowKeys: string[]
      columns: string[]
      entries: Array<{
        cellKey: string
        rowKey: string
        column: string
        rowIndex: number
        columnIndex: number
        value: unknown
      }>
    } | null => {
      const entries = getSelectionEntries(cellKeys)
      if (entries.length === 0) {
        return null
      }
      const rowIndexes = entries.map((entry) => entry.rowIndex)
      const columnIndexes = entries.map((entry) => entry.columnIndex)
      const rowStart = Math.min(...rowIndexes)
      const rowEnd = Math.max(...rowIndexes)
      const columnStart = Math.min(...columnIndexes)
      const columnEnd = Math.max(...columnIndexes)
      return {
        rowStart,
        rowEnd,
        columnStart,
        columnEnd,
        rowKeys: orderedRowKeys.slice(rowStart, rowEnd + 1),
        columns: orderedColumns.slice(columnStart, columnEnd + 1),
        entries
      }
    }

    const getCellSelectionMatrix = (cellKeys = getCommittedCellSelection()): unknown[][] => {
      const bounds = getSelectionBounds(cellKeys)
      if (!bounds) {
        return []
      }
      return bounds.rowKeys.map((rowKey) => bounds.columns.map((column) => rowByKey.get(rowKey)?.[column] ?? null))
    }

    const getSelectedCellPatchesForValue = (value: unknown, cellKeys = getCommittedCellSelection()): Array<{ rowKey: string; column: string; value: unknown }> => {
      const bounds = getSelectionBounds(cellKeys)
      if (!bounds) {
        return []
      }
      return bounds.rowKeys.flatMap((rowKey) => bounds.columns.map((column) => ({ rowKey, column, value })))
    }

    const ensureContextSelection = (cellKey: string): string[] => {
      const currentSelection = getCommittedCellSelection()
      if (currentSelection.includes(cellKey)) {
        contextMenuCellSelectionRefs.current[tab.key] = currentSelection
        return currentSelection
      }
      clearRuntimeColumnSelection(tab.key)
      rowDragAnchorRefs.current[tab.key] = undefined
      cellDragAnchorRefs.current[tab.key] = undefined
      pendingCellDragTargetRefs.current[tab.key] = undefined
      if (pendingCellDragFrameRefs.current[tab.key]) {
        window.cancelAnimationFrame(pendingCellDragFrameRefs.current[tab.key]!)
        pendingCellDragFrameRefs.current[tab.key] = undefined
      }
      const nextSelection = [cellKey]
      setCommittedCellSelection(tab.key, nextSelection)
      contextMenuCellSelectionRefs.current[tab.key] = nextSelection
      return nextSelection
    }

    const serializeCellValue = (value: unknown): string => {
      if (isDefaultValueMarker(value)) {
        return 'DEFAULT'
      }
      if (value === null || value === undefined) {
        return 'NULL'
      }
      if (typeof value === 'string') {
        return value
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      }
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }

    const buildSelectionClipboardText = (values: unknown[][]): string => values
      .map((row) => row.map((value) => serializeCellValue(value)).join('\t'))
      .join('\n')

    const writeSelectionToClipboard = async (values: unknown[][]): Promise<void> => {
      const text = buildSelectionClipboardText(values)
      cellClipboardRef.current = { text, values }
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        showError('复制单元格内容失败')
      }
    }

    const copySelectedCells = async (cellKeys = getCommittedCellSelection()): Promise<void> => {
      const values = getCellSelectionMatrix(cellKeys)
      if (values.length === 0) {
        return
      }
      await writeSelectionToClipboard(values)
    }

    const quoteIdentifier = (identifier: string): string => {
      if (connection?.database_type === 'mysql' || connection?.database_type === 'clickhouse') {
        return `\`${identifier.replaceAll('`', '``')}\``
      }
      return `"${identifier.replaceAll('"', '""')}"`
    }

    const getQualifiedTableNameForCopy = (): string => {
      if (!tab.tableName) {
        return ''
      }
      if (isSchemaScopedType(connection?.database_type)) {
        return [tab.pgDatabaseName, tab.databaseName, tab.tableName].filter(Boolean).map((part) => quoteIdentifier(String(part))).join('.')
      }
      return [tab.databaseName, tab.tableName].filter(Boolean).map((part) => quoteIdentifier(String(part))).join('.')
    }

    const toSqlLiteral = (value: unknown): string => {
      if (isDefaultValueMarker(value)) {
        return 'DEFAULT'
      }
      if (value === null || value === undefined) {
        return 'NULL'
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : 'NULL'
      }
      if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE'
      }
      const serialized = typeof value === 'string' ? value : serializeCellValue(value)
      return `'${serialized.replaceAll("'", "''")}'`
    }

    const copySelectionAsInsert = async (cellKeys = getCommittedCellSelection()): Promise<void> => {
      const bounds = getSelectionBounds(cellKeys)
      if (!bounds || bounds.columns.length === 0 || bounds.rowKeys.length === 0 || !tab.tableName) {
        return
      }
      const qualifiedTableName = getQualifiedTableNameForCopy()
      const quotedColumns = bounds.columns.map((column) => quoteIdentifier(column)).join(', ')
      const sql = bounds.rowKeys.map((rowKey) => {
        const row = rowByKey.get(rowKey)
        const values = bounds.columns.map((column) => toSqlLiteral(row?.[column]))
        return `INSERT INTO ${qualifiedTableName} (${quotedColumns}) VALUES (${values.join(', ')});`
      }).join('\n')
      cellClipboardRef.current = { text: sql, values: getCellSelectionMatrix(cellKeys) }
      try {
        await navigator.clipboard.writeText(sql)
      } catch {
        showError('复制 INSERT 失败')
      }
    }

    const copySelectionAsMarkdown = async (cellKeys = getCommittedCellSelection()): Promise<void> => {
      const bounds = getSelectionBounds(cellKeys)
      if (!bounds || bounds.columns.length === 0 || bounds.rowKeys.length === 0) {
        return
      }
      const escapeMarkdownCell = (value: unknown): string => serializeCellValue(value)
        .replaceAll('|', '\\|')
        .replaceAll('\r\n', '<br />')
        .replaceAll('\n', '<br />')
      const header = `| ${bounds.columns.join(' | ')} |`
      const separator = `| ${bounds.columns.map(() => '---').join(' | ')} |`
      const lines = bounds.rowKeys.map((rowKey) => `| ${bounds.columns.map((column) => escapeMarkdownCell(rowByKey.get(rowKey)?.[column])).join(' | ')} |`)
      const markdown = [header, separator, ...lines].join('\n')
      cellClipboardRef.current = { text: markdown, values: getCellSelectionMatrix(cellKeys) }
      try {
        await navigator.clipboard.writeText(markdown)
      } catch {
        showError('复制 Markdown 失败')
      }
    }

    const parseClipboardText = (text: string): unknown[][] => {
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
      if (normalized.length === 0) {
        return [['']]
      }
      return normalized.split('\n').map((line) => line.split('\t'))
    }

    const pasteIntoSelectedCells = async (): Promise<void> => {
      if (!supportsWritableCells) {
        return
      }
      const selection = getCommittedCellSelection()
      const bounds = getSelectionBounds(selection)
      if (!bounds) {
        return
      }

      let clipboardText = ''
      try {
        clipboardText = await navigator.clipboard.readText()
      } catch {
        clipboardText = cellClipboardRef.current?.text ?? ''
      }
      if (!clipboardText && !cellClipboardRef.current) {
        return
      }

      const normalizedText = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
      const cachedText = cellClipboardRef.current?.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
      const values = normalizedText && cachedText === normalizedText
        ? (cellClipboardRef.current?.values ?? parseClipboardText(clipboardText))
        : parseClipboardText(clipboardText || cellClipboardRef.current?.text || '')
      if (values.length === 0 || values[0]?.length === 0) {
        return
      }

      clearInlineCellEditor(tab.key)
      clearRuntimeColumnSelection(tab.key)

      let patches: Array<{ rowKey: string; column: string; value: unknown }> = []
      if (values.length === 1 && values[0].length === 1 && selection.length > 1) {
        patches = getSelectedCellPatchesForValue(values[0][0], selection)
      } else {
        for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
          const rowKey = orderedRowKeys[bounds.rowStart + rowOffset]
          if (!rowKey) {
            break
          }
          for (let columnOffset = 0; columnOffset < values[rowOffset].length; columnOffset += 1) {
            const column = orderedColumns[bounds.columnStart + columnOffset]
            if (!column) {
              break
            }
            patches.push({ rowKey, column, value: values[rowOffset][columnOffset] })
          }
        }
      }
      updatePreviewCells(tab.key, patches)
    }

    const readOnlyCellContextMenuItems: MenuProps['items'] = [
      { key: 'copy-selection', label: '复制' },
      { key: 'copy-as-insert', label: '复制为 INSERT' },
      { key: 'copy-as-md', label: '复制为 MD' },
      { type: 'divider' },
      { key: 'inspect-record', label: '记录视图' },
      { key: 'inspect-value', label: '值视图' },
      { key: 'inspect-aggregate', label: '聚合视图' }
    ]

    const previewCellContextMenuItems: MenuProps['items'] = [
      ...readOnlyCellContextMenuItems,
      { type: 'divider' },
      { key: 'set-null', label: '设为 NULL' },
      { key: 'set-default', label: '设为 DEFAULT' }
    ]

    const handleCellContextMenuAction = (actionKey: string, cellKey: string): void => {
      const selection = contextMenuCellSelectionRefs.current[tab.key] ?? ensureContextSelection(cellKey)
      if (actionKey === 'copy-selection') {
        void copySelectedCells(selection)
        return
      }
      if (actionKey === 'copy-as-insert') {
        void copySelectionAsInsert(selection)
        return
      }
      if (actionKey === 'copy-as-md') {
        void copySelectionAsMarkdown(selection)
        return
      }
      if (actionKey === 'inspect-record' || actionKey === 'inspect-value' || actionKey === 'inspect-aggregate') {
        const view: CellInspectorView = actionKey === 'inspect-record' ? 'record' : actionKey === 'inspect-value' ? 'value' : 'aggregate'
        setCommittedCellSelection(tab.key, selection)
        cellInspectorPanelRefs.current[tab.key]?.open(view, selection)
        contextMenuCellSelectionRefs.current[tab.key] = undefined
        return
      }
      if (!supportsWritableCells) {
        contextMenuCellSelectionRefs.current[tab.key] = undefined
        return
      }
      if (actionKey === 'set-null') {
        clearInlineCellEditor(tab.key)
        updatePreviewCells(tab.key, getSelectedCellPatchesForValue(null, selection))
        return
      }
      if (actionKey === 'set-default') {
        clearInlineCellEditor(tab.key)
        updatePreviewCells(tab.key, getSelectedCellPatchesForValue(createDefaultValueMarker(), selection))
      }
      contextMenuCellSelectionRefs.current[tab.key] = undefined
    }

    const isEditableTarget = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      return Boolean(
        element?.closest('input, textarea, [contenteditable="true"], .monaco-editor, .editable-cell-dom-input')
      )
    }

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
      setTimeout(() => applySelectedRows(draft), 0)
    }

    const clearSelectedRows = (): void => {
      if (!tab.selectedRowKeys?.length && !rowSelectionDraftRefs.current[tab.key]?.length) {
        return
      }
      previewSelectedRows([])
      rowSelectionDraftRefs.current[tab.key] = undefined
      setTimeout(() => applySelectedRows([]), 0)
    }

    const toggleColumnSort = (column: string): void => {
      const nextSort = !tab.sortState || tab.sortState.column !== column
        ? { column, direction: 'ascend' as const }
        : tab.sortState.direction === 'ascend'
          ? { column, direction: 'descend' as const }
          : undefined
      syncRuntimeSortButtons(tab.key, nextSort)
      startTransition(() => {
        updateWorkspaceTab(tab.key, { sortState: nextSort })
      })
      if (tab.kind === 'preview' && tab.connectionId && tab.tableName) {
        const previewObjectType = tab.objectType === 'view' ? 'view' : 'table'
        window.setTimeout(() => {
          startTransition(() => {
            updateWorkspaceTab(tab.key, { loading: true })
          })
          void previewTable(
            tab.connectionId!,
            tab.tableName!,
            tab.databaseName,
            tab.pgDatabaseName,
            tab.limit ?? PREVIEW_DEFAULT_LIMIT,
            1,
            tab.where,
            previewObjectType,
            nextSort
          )
        }, 0)
      }
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

    const updateDragCellSelection = (rowKey: string, column: string): void => {
      const anchor = cellDragAnchorRefs.current[tab.key]
      if (!anchor) {
        return
      }
      const pendingTarget = pendingCellDragTargetRefs.current[tab.key]
      if (pendingTarget?.rowKey === rowKey && pendingTarget.column === column) {
        return
      }
      pendingCellDragTargetRefs.current[tab.key] = { rowKey, column }
      if (pendingCellDragFrameRefs.current[tab.key]) {
        return
      }
      pendingCellDragFrameRefs.current[tab.key] = window.requestAnimationFrame(() => {
        pendingCellDragFrameRefs.current[tab.key] = undefined
        const latestAnchor = cellDragAnchorRefs.current[tab.key]
        const latestTarget = pendingCellDragTargetRefs.current[tab.key]
        if (!latestAnchor || !latestTarget) {
          return
        }
        pendingCellDragTargetRefs.current[tab.key] = undefined
        const startRowIndex = orderedRowKeys.indexOf(latestAnchor.rowKey)
        const endRowIndex = orderedRowKeys.indexOf(latestTarget.rowKey)
        const startColumnIndex = orderedColumnIndexMap[latestAnchor.column]
        const endColumnIndex = orderedColumnIndexMap[latestTarget.column]
        if (startRowIndex < 0 || endRowIndex < 0 || startColumnIndex === undefined || endColumnIndex === undefined) {
          return
        }
        const rowStart = Math.min(startRowIndex, endRowIndex)
        const rowEnd = Math.max(startRowIndex, endRowIndex)
        const columnStart = Math.min(startColumnIndex, endColumnIndex)
        const columnEnd = Math.max(startColumnIndex, endColumnIndex)
        const nextCellKeys: string[] = []
        for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
          for (let columnIndex = columnStart; columnIndex <= columnEnd; columnIndex += 1) {
            nextCellKeys.push(`${orderedRowKeys[rowIndex]}:${orderedColumns[columnIndex]}`)
          }
        }
        const committedCellKeys = selectedCellRefs.current[tab.key] ?? []
        const runtimeCellKeys = runtimeSelectedCellRefs.current[tab.key] ?? committedCellKeys
        if (runtimeCellKeys.length === nextCellKeys.length && runtimeCellKeys.every((key, index) => key === nextCellKeys[index])) {
          return
        }
        applyRuntimeCellRangeSelection(tab.key, nextCellKeys)
      })
    }

    const copyColumnName = async (column: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(column)
        messageApi.success('列名称已复制')
      } catch {
        showError('复制列名称失败')
      }
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

    const renderColumnTitle = (column: string): React.ReactNode => {
      const checkedValues = columnFilters[column] ?? []
      const sortDirection = tab.sortState?.column === column ? tab.sortState.direction : undefined
      const sortIcon = (
        <span className="column-sort-icon" data-direction={sortDirection ?? 'none'} aria-hidden="true">
          {sortDirection === 'descend' ? '↓' : sortDirection === 'ascend' ? '↑' : '⇅'}
        </span>
      )

      return (
        <Dropdown
          trigger={['contextMenu']}
          transitionName=""
          overlayClassName="no-motion-overlay"
          menu={{
            items: [{ key: 'copy-column-name', label: '复制列名称' }],
            onClick: ({ key }) => {
              if (key === 'copy-column-name') {
                void copyColumnName(column)
              }
            }
          }}
        >
          <Flex align="center" gap={4} className="column-header-content" onContextMenu={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={`column-select-button${tab.draggingColumn === column ? ' dragging' : ''}`}
              data-column-button={column}
              title="点击选中当前列，拖动可调整列顺序"
              draggable
              onClick={(event) => {
                event.stopPropagation()
                applyRuntimeColumnSelection(tab.key, column)
                clearRuntimeCellSelection(tab.key)
                if (editingCells[tab.key]) {
                  setEditingCells((current) => ({ ...current, [tab.key]: undefined }))
                }
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
            <button
              type="button"
              className={`column-sort-button${tab.sortState?.column === column ? ' active' : ''}`}
              data-column-key={column}
              title="切换排序"
              onClick={(event) => {
                event.stopPropagation()
                toggleColumnSort(column)
              }}
            >
              {sortIcon}
            </button>
            <ColumnFilterTrigger
              column={column}
              checkedValues={checkedValues}
              sourceRows={baseTableRows}
              onChange={(values) => updateColumnFilter(column, values)}
            />
          </Flex>
        </Dropdown>
      )
    }

    const rowNumberColumn: ColumnsType<EditableRow>[number] = {
      title: (
        <button
          type="button"
          className="row-number-select-all"
          title="选中当前表格全部内容"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            clearRuntimeColumnSelection(tab.key)
            clearSelectedRows()
            const allCellKeys = orderedRowKeys.flatMap((rowKey) => orderedColumns.map((column) => `${rowKey}:${column}`))
            setCommittedCellSelection(tab.key, allCellKeys)
          }}
        >
          <UnorderedListOutlined />
        </button>
      ),
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
              if (event.ctrlKey || event.metaKey) {
                rowDragAnchorRefs.current[tab.key] = undefined
                const currentSelection = new Set((rowSelectionDraftRefs.current[tab.key] ?? tab.selectedRowKeys ?? []).map(String))
                if (currentSelection.has(row.__rowKey)) {
                  currentSelection.delete(row.__rowKey)
                } else {
                  currentSelection.add(row.__rowKey)
                }
                const nextSelected = orderedRowKeys.filter((key) => currentSelection.has(key))
                previewSelectedRows(nextSelected)
                setTimeout(() => applySelectedRows(nextSelected), 0)
                return
              }
              rowDragAnchorRefs.current[tab.key] = row.__rowKey
              previewSelectedRows([row.__rowKey])
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
        onCell: (row: EditableRow) => ({
          'data-column-key': column,
          'data-row-key': row.__rowKey,
          'data-cell-key': `${row.__rowKey}:${column}`,
        } as React.TdHTMLAttributes<HTMLElement>),
        render: (value: unknown, row: EditableRow) => (
          supportsCellSelection
            ? renderEditableCell(
              tab.key,
              row.__rowKey,
              column,
              value,
              supportsWritableCells,
              () => updateDragCellSelection(row.__rowKey, column),
              supportsWritableCells ? previewCellContextMenuItems : readOnlyCellContextMenuItems,
              handleCellContextMenuAction,
              ensureContextSelection,
              highlightResultText(`${row.__rowKey}:${column}`, cellDisplayText(value), 'table-cell-text')
            )
            : highlightResultText(`${row.__rowKey}:${column}`, cellDisplayText(value), 'table-cell-text')
        )
      })) ?? []
    const tableColumns: ColumnsType<EditableRow> = supportsCellSelection ? [rowNumberColumn, ...dataColumns] : dataColumns
    const tableScrollX = Math.max((tab.result?.columns.length ?? 0) * 180 + (supportsCellSelection ? 34 : 0), 720)
    const tableScrollY = tableBodyHeights[tab.key] ?? 320
    const searchSignature = `${searchState.query}\u0000${searchState.caseSensitive ? 1 : 0}\u0000${searchState.regex ? 1 : 0}\u0000${searchState.wholeWord ? 1 : 0}\u0000${searchState.filterRows ? 1 : 0}`
    const editingCellKey = editingCells[tab.key] ? `${editingCells[tab.key]!.rowKey}:${editingCells[tab.key]!.column}` : undefined
    if (tab.kind === 'redis-browser') {
      return renderRedisBrowser(tab)
    }

    return (
      <div className="result-table-shell">
        {renderResultStatus(tab)}
        {renderTableToolbar(tab, {
          matchCount: searchMatches.length,
          resetKey: `${searchState.query}\u0000${searchState.caseSensitive ? 1 : 0}\u0000${searchState.regex ? 1 : 0}\u0000${searchState.wholeWord ? 1 : 0}\u0000${searchState.filterRows ? 1 : 0}\u0000${searchMatches.length}`,
          focusSearchMatch
        })}
        {(tab.resultKind === 'command' || tab.resultKind === 'error') && renderQueryExecutionStatus(tab)}
        {tab.error && tab.resultKind !== 'error' && <Alert className="result-inline-alert" message={tab.error} type="error" showIcon closable onClose={() => updateWorkspaceTab(tab.key, { error: undefined })} />}
        {tab.resultKind === 'command' || tab.resultKind === 'error'
          ? null
          : (
        <div className="result-table-content">
        <ResultTableBodyView
          tab={tab}
          searchSignature={searchSignature}
          editingCellKey={editingCellKey}
          selectedRowKeyMap={selectedRowKeyMap}
          tableColumns={tableColumns}
          tableRows={tableRows}
          tableScrollX={tableScrollX}
          tableScrollY={tableScrollY}
          setBodyRef={(element) => { tableBodyRefs.current[tab.key] = element }}
          setHeaderRef={(element) => { tableHeaderRefs.current[tab.key] = element }}
          onScrollCapture={() => scheduleRenderedCellSelectionSync(tab.key)}
          onKeyDown={(event) => {
            if (!supportsCellSelection || isEditableTarget(event.target)) {
              return
            }
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'c') {
              const selection = getCommittedCellSelection()
              if (selection.length === 0) {
                return
              }
              event.preventDefault()
              void copySelectedCells(selection)
            }
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'v') {
              if (!supportsWritableCells) {
                return
              }
              const selection = getCommittedCellSelection()
              if (selection.length === 0) {
                return
              }
              event.preventDefault()
              void pasteIntoSelectedCells()
            }
          }}
          onMouseDown={(event) => {
            const target = event.target as HTMLElement
            const activeInlineEditor = inlineCellEditorRefs.current[tab.key]
            if (activeInlineEditor && !target.closest('.editable-cell-dom-input')) {
              commitInlineCellEditor(tab.key)
            }
            if (isResultTableScrollbarInteraction(event)) {
              scrollbarDragRefs.current[tab.key] = true
              return
            }
            scrollbarDragRefs.current[tab.key] = undefined
            if (!target.closest('.row-number-button')) {
              clearSelectedRows()
            }
            if (!target.closest('.column-header-content')) {
              clearRuntimeColumnSelection(tab.key)
            }
            if (!target.closest('[data-cell-key]')) {
              clearActiveSearchCellHighlight(tab.key)
              clearRuntimeCellSelection(tab.key)
            }
          }}
          onMouseUp={(event) => {
            if (event.button !== 0) {
              return
            }
            if (scrollbarDragRefs.current[tab.key]) {
              scrollbarDragRefs.current[tab.key] = undefined
              return
            }
            if (editingCells[tab.key]) {
              rowDragAnchorRefs.current[tab.key] = undefined
              cellDragAnchorRefs.current[tab.key] = undefined
              pendingCellDragTargetRefs.current[tab.key] = undefined
              return
            }
            rowDragAnchorRefs.current[tab.key] = undefined
            cellDragAnchorRefs.current[tab.key] = undefined
            if (pendingCellDragFrameRefs.current[tab.key]) {
              window.cancelAnimationFrame(pendingCellDragFrameRefs.current[tab.key]!)
              pendingCellDragFrameRefs.current[tab.key] = undefined
            }
            pendingCellDragTargetRefs.current[tab.key] = undefined
            commitRuntimeCellSelection(tab.key, runtimeSelectedCellRefs.current[tab.key] ?? [])
            commitPreviewSelectedRows()
          }}
          onMouseLeave={() => {
            if (scrollbarDragRefs.current[tab.key]) {
              return
            }
            if (!cellDragAnchorRefs.current[tab.key] && !rowDragAnchorRefs.current[tab.key]) {
              return
            }
            rowDragAnchorRefs.current[tab.key] = undefined
            cellDragAnchorRefs.current[tab.key] = undefined
            if (pendingCellDragFrameRefs.current[tab.key]) {
              window.cancelAnimationFrame(pendingCellDragFrameRefs.current[tab.key]!)
              pendingCellDragFrameRefs.current[tab.key] = undefined
            }
            pendingCellDragTargetRefs.current[tab.key] = undefined
            commitRuntimeCellSelection(tab.key, runtimeSelectedCellRefs.current[tab.key] ?? [])
            commitPreviewSelectedRows()
          }}
        />
        <CellInspectorPanel
          ref={(instance) => { cellInspectorPanelRefs.current[tab.key] = instance }}
          tabKey={tab.key}
          orderedColumns={orderedColumns}
          rowByKey={rowByKey}
          columnInfoMap={tab.columnInfoMap}
          editable={supportsWritableCells && tab.kind === 'preview'}
          onUpdateValue={(rowKey, column, rawValue) => updatePreviewCell(tab.key, rowKey, column, editableValue(rawValue))}
        />
        </div>
            )}
      </div>
    )
  }

  const getDefaultDatabaseName = (connection: ConnectionInfo): string | undefined => {
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
  }

  const getDefaultPgDatabase = (connection: ConnectionInfo): string | undefined => {
    if (connection.database_type !== 'postgresql' && connection.database_type !== 'gaussdb') {
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
  }

  const ensureDatabasesLoaded = async (connectionId: string): Promise<void> => {
    const connection = getConnection(connectionId)
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
  }

  const ensureSchemasLoaded = async (connectionId: string, pgDatabaseName: string): Promise<string[]> => {
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
  }

  const renderWorkspaceTab = (tab: WorkspaceTab): React.ReactNode => {
    if (tab.kind === 'table-list') {
      return <div className="query-workspace">{renderResultTable(tab)}</div>
    }

    if (tab.kind === 'query') {
      const connection = getConnection(tab.connectionId)
      const isMysql = connection?.database_type === 'mysql'
      const isDm = connection?.database_type === 'dm'
      const isPg = isSchemaScopedType(connection?.database_type)
      const isMongo = connection?.database_type === 'mongodb'
      const isRedis = connection?.database_type === 'redis'
      const isClickHouse = connection?.database_type === 'clickhouse'
      const dbOptions = tab.connectionId ? (allDatabases[tab.connectionId] ?? []) : []
      const schemaKey = tab.connectionId && tab.pgDatabaseName ? `${tab.connectionId}:${tab.pgDatabaseName}` : ''
      const schemaOptions = schemaKey ? (allSchemas[schemaKey] ?? []) : []
      const connectionSelectWidth = getQuerySelectWidth(connections.map((item) => item.name), '选择连接')
      const databaseSelectWidth = getQuerySelectWidth(dbOptions, isPg ? '选择 Database' : (isDm || connection?.database_type === 'oracle') ? '选择 Schema' : isMongo ? '选择数据库' : isRedis ? '选择 Redis DB' : isClickHouse ? '选择数据库' : '选择库')
      const schemaSelectWidth = getQuerySelectWidth(schemaOptions, '选择 Schema')

      const resultVisible = Boolean(tab.resultVisible)
      const resultCollapsed = Boolean(tab.resultCollapsed)
      const queryEditorHeight = tab.queryEditorHeight ?? 280

      return (
        <div className="query-workspace">
          <Space className="query-toolbar">
            <Select
              className="connection-select"
              placeholder="选择连接"
              value={tab.connectionId}
              variant="borderless"
              style={{ width: connectionSelectWidth }}
              onChange={(connectionId) => {
                const nextConn = getConnection(connectionId)
                void ensureDatabasesLoaded(connectionId)
                const nextDb = isDatabaseScopedType(nextConn?.database_type) || nextConn?.database_type === 'dm' || nextConn?.database_type === 'oracle' ? getDefaultDatabaseName(nextConn) : undefined
                const nextPgDb = isSchemaScopedType(nextConn?.database_type) ? getDefaultPgDatabase(nextConn!) : undefined
                updateWorkspaceTab(tab.key, {
                  connectionId,
                  databaseName: nextDb,
                  pgDatabaseName: nextPgDb
                })

                if ((isDatabaseScopedType(nextConn?.database_type) || nextConn?.database_type === 'dm' || nextConn?.database_type === 'oracle') && nextDb) {
                  void preloadCompletionForDatabase(connectionId, nextDb)
                }
              }}
              options={connections.map((c) => ({ label: c.name, value: c.connection_id }))}
            />
            {(isMysql || isPg || isDm || connection?.database_type === 'oracle' || isMongo || isRedis || isClickHouse) && (
              <Select
                className="database-select"
                placeholder={isPg ? '选择 Database' : (isDm || connection?.database_type === 'oracle') ? '选择 Schema' : isMongo ? '选择数据库' : isRedis ? '选择 Redis DB' : isClickHouse ? '选择数据库' : '选择库'}
                value={isPg ? (tab.pgDatabaseName || undefined) : (tab.databaseName || undefined)}
                variant="borderless"
                style={{ width: databaseSelectWidth }}
                onChange={async (value) => {
                  if (isPg) {
                    const schemaNames = await ensureSchemasLoaded(tab.connectionId!, value)
                    const defaultSchema = getDefaultPgSchema(schemaNames)
                    updateWorkspaceTab(tab.key, { pgDatabaseName: value, databaseName: defaultSchema })
                  } else {
                    updateWorkspaceTab(tab.key, { databaseName: value })
                    if (!isDm && connection?.database_type !== 'oracle') {
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
                variant="borderless"
                style={{ width: schemaSelectWidth }}
                onChange={(value) => updateWorkspaceTab(tab.key, { databaseName: value })}
                options={schemaOptions.map((name) => ({ label: name, value: name }))}
              />
            )}
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={tab.loading}
              onClick={() => void runQuery(tab, sqlExecutionContextByTab[tab.key]?.selectedSql || sqlExecutionContextByTab[tab.key]?.currentStatementSql || tab.sql)}
            >
              执行
            </Button>
          </Space>
          {resultVisible && !resultCollapsed ? (
            <div className="query-splitter-wrap">
            <button
              type="button"
              className="query-result-toggle query-result-toggle-collapse"
              style={{ top: `${Math.max(44, queryEditorHeight)}px` }}
              ref={(element) => { queryResultToggleRefs.current[tab.key] = element }}
              onClick={() => updateWorkspaceTab(tab.key, { resultCollapsed: true })}
              aria-label="收起查询结果"
              title="收起查询结果"
            >
              <DownOutlined />
            </button>
            <Splitter
              className="query-body-splitter"
              layout="vertical"
              onResize={(sizes) => {
                const nextHeight = sizes[0]
                if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
                  const toggle = queryResultToggleRefs.current[tab.key]
                  if (toggle) {
                    toggle.style.top = `${Math.max(44, nextHeight)}px`
                  }
                }
              }}
              onResizeEnd={(sizes) => {
                const nextHeight = sizes[0]
                if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
                  updateWorkspaceTab(tab.key, { queryEditorHeight: nextHeight })
                }
              }}
            >
              <Splitter.Panel defaultSize={queryEditorHeight} min={160} max="75%" className="sql-editor-panel">
                <div className="sql-editor-container">
                  <SqlEditor
                    value={tab.sql}
                    onChange={(sql) => updateWorkspaceTab(tab.key, { sql })}
                    onExecute={(payload) => void runQuery(tab, payload.sql)}
                    onSelectionChange={(payload) => setSqlExecutionContextByTab((current) => ({
                      ...current,
                      [tab.key]: {
                        selectedSql: payload.selectedSql,
                        currentStatementSql: payload.currentStatementSql
                      }
                    }))}
                    theme={theme}
                    completionContext={buildSqlCompletionContext(tab)}
                    shortcuts={{
                      execute: shortcutSettings.sql_execute,
                      deleteLine: shortcutSettings.sql_delete_line,
                      duplicateLineDown: shortcutSettings.sql_duplicate_line_down
                    }}
                  />
                </div>
              </Splitter.Panel>
              <Splitter.Panel min={120}>
                <div className="query-result-panel">
                  {renderResultTable(tab)}
                </div>
              </Splitter.Panel>
            </Splitter>
            </div>
          ) : (
            <div className="query-editor-only">
              <div className="sql-editor-container">
                <SqlEditor
                  value={tab.sql}
                  onChange={(sql) => updateWorkspaceTab(tab.key, { sql })}
                  onExecute={(payload) => void runQuery(tab, payload.sql)}
                  onSelectionChange={(payload) => setSqlExecutionContextByTab((current) => ({
                    ...current,
                    [tab.key]: {
                      selectedSql: payload.selectedSql,
                      currentStatementSql: payload.currentStatementSql
                    }
                  }))}
                  theme={theme}
                  completionContext={buildSqlCompletionContext(tab)}
                  shortcuts={{
                    execute: shortcutSettings.sql_execute,
                    deleteLine: shortcutSettings.sql_delete_line,
                    duplicateLineDown: shortcutSettings.sql_duplicate_line_down
                  }}
                />
              </div>
              {resultVisible && resultCollapsed && (
                <button
                  type="button"
                  className="query-result-toggle query-result-toggle-expand"
                  onClick={() => updateWorkspaceTab(tab.key, { resultCollapsed: false })}
                  aria-label="展开查询结果"
                  title="展开查询结果"
                >
                  <UpOutlined />
                </button>
              )}
            </div>
          )}
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

  const objectNodesForGroup = async (connectionId: string, objectType: DbObjectType, databaseName?: string, pgDatabaseName?: string): Promise<DatabaseTreeNode[]> => {
    const path = withPgDatabase(`/connections/${connectionId}/objects`, databaseName, pgDatabaseName)
    const data = await requestJson<{ objects: DbObjectInfo[] }>(`${path}${databaseName || pgDatabaseName ? '&' : '?'}type=${objectType}`)
    return data.objects.map<DatabaseTreeNode>((object) => {
      const resolvedType = DB_OBJECT_GROUP_BY_TYPE[object.type as DbObjectType] ? object.type as DbObjectType : objectType
      const kind = resolvedType === 'table' ? 'table' : 'db-object'
      const group = DB_OBJECT_GROUP_BY_TYPE[resolvedType]

      return {
        key: `${kind}:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${resolvedType}:${object.name}`,
        title: object.name,
        comment: object.comment ?? null,
        icon: plainObjectIconByType[resolvedType] ?? group.icon,
        kind,
        connectionId,
        databaseName,
        pgDatabaseName,
        tableName: object.name,
        objectType: resolvedType,
        sizeDisplay: object.size_display,
        sizeBytes: object.size_bytes,
        storageSizeDisplay: object.storage_size_display,
        storageSizeBytes: object.storage_size_bytes,
        rowCount: object.row_count,
        childrenLoaded: false,
        isLeaf: resolvedType !== 'table'
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

    if (isSchemaScopedType(connection.database_type)) {
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

      if (connection?.database_type !== 'mysql' && connection?.database_type !== 'postgresql' && connection?.database_type !== 'gaussdb' && connection?.database_type !== 'dm' && connection?.database_type !== 'oracle' && connection?.database_type !== 'mongodb' && connection?.database_type !== 'redis' && connection?.database_type !== 'clickhouse') {
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
    setTreeData((current) => [...current])
    try {
      const children = await loadChildrenForNode(node)
      if (node.kind !== 'connection') {
        setTreeData((current) => updateTreeNode(current, node.key as React.Key, children))
      }
      if (expand) {
        setExpandedKeys((current) => current.includes(node.key as React.Key) ? current : [...current, node.key as React.Key])
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载树节点失败')
    } finally {
      treeLoadingKeysRef.current.delete(node.key)
      setTreeData((current) => [...current])
    }
  }

  const isTreeNodeChildrenLoaded = (node: DatabaseTreeNode): boolean =>
    Boolean(node.isLeaf || node.childrenLoaded || node.children?.length)

  const isLoadableTreeNode = (node: DatabaseTreeNode): boolean => {
    if (node.kind === 'database' && node.connectionId && getConnection(node.connectionId)?.database_type === 'redis') {
      return false
    }

    return node.kind === 'folder' || node.kind === 'connection' || node.kind === 'database' || node.kind === 'pg-schema' || node.kind === 'object-group' || node.kind === 'table'
  }

  const collapseTreeNode = (node: DatabaseTreeNode): void => {
    const key = node.key as React.Key
    flushSync(() => {
      setExpandedKeys((current) => current.filter((item) => item !== key))
    })
  }

  const toggleOrLoadTreeNode = (node: DatabaseTreeNode): void => {
    if (!node.key || !isLoadableTreeNode(node)) {
      return
    }
    if (treeLoadingKeysRef.current.has(node.key as React.Key)) {
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

    flushSync(() => {
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
        username: 'SYSDBA',
        driver_id: undefined,
        dm_driver_id: undefined
      })
    } else if (nextDatabaseType === 'gaussdb') {
      await loadDrivers()
      form.setFieldsValue({
        database_type: 'gaussdb',
        name: '高斯数据库',
        host: '127.0.0.1',
        port: 8000,
        username: 'gaussdb',
        database: 'postgres',
        driver_id: undefined
      })
    } else if (nextDatabaseType === 'oracle') {
      form.setFieldsValue({
        database_type: 'oracle',
        name: 'Oracle',
        host: '127.0.0.1',
        port: 1521,
        username: 'system',
        database: 'orclpdb1'
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
    form.resetFields()
    setConnectionModalOpen(true)
    setConnectionLoading(true)

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
      { key: 'oracle', label: 'Oracle', icon: <img src={oracleIcon} alt="Oracle" style={{ width: 16, height: 16 }} /> },
      { key: 'mongodb', label: 'MongoDB', icon: <img src={mongoIcon} alt="" style={{ width: 16, height: 16 }} /> },
      { key: 'redis', label: 'Redis', icon: <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} /> },
      { key: 'clickhouse', label: 'ClickHouse', icon: <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} /> },
      {
        key: 'others',
        label: '其他',
        icon: <DatabaseOutlined />,
        children: [
          { key: 'dm', label: '达梦', icon: <img src={dmIcon} alt="" style={{ width: 16, height: 16 }} /> },
          { key: 'gaussdb', label: '高斯数据库', icon: <DatabaseOutlined /> }
        ]
      }
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'others') {
        return
      }
      void openConnectionModal(key as DatabaseType)
    }
  }

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

  const resourceCreateMenu = {
    items: [
      { key: 'folder', label: '新建分组', icon: <FolderAddOutlined /> },
      { type: 'divider' as const },
      ...connectionCreateMenu.items
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'folder') {
        openCreateFolderModal()
        return
      }
      void openConnectionModal(key as DatabaseType)
    }
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

  const resetImportConnectionState = (): void => {
    setImportConnectionSource('datagrip')
    setImportConnectionRawText('')
    setImportConnectionCandidates([])
    setImportConnectionParsing(false)
    setImportingConnections(false)
  }

  const openImportConnectionModal = (): void => {
    resetImportConnectionState()
    setImportConnectionModalOpen(true)
  }

  const closeImportConnectionModal = (): void => {
    setImportConnectionModalOpen(false)
    resetImportConnectionState()
  }

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
    setSettingsContentReady(false)
    window.setTimeout(() => {
      setSettingsContentReady(true)
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
    setQueryHistoryContentReady(false)
    window.setTimeout(() => {
      setQueryHistoryContentReady(true)
    }, 0)
  }

  const openUpdateModal = (): void => {
    updateModalRef.current?.open()
    setUpdateModalContentReady(false)
    window.setTimeout(() => {
      setUpdateModalContentReady(true)
    }, 0)
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
    setTreeData((current) => replaceConnectionNode(current, updated))
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
      setTreeData((current) => replaceConnectionNode(current, connection))

      const connKey = `connection:${connectionId}`
      setExpandedKeys((current) => current.includes(connKey) ? current : [...current, connKey])

      if (connection.database_type === 'sqlite') {
        setTreeData((current) => updateTreeNode(current, connKey, buildConnectionNode(connection).children ?? []))
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
      setTreeData((current) => replaceConnectionNode(current, connection))

      const connKey = `connection:${connectionId}`
      setExpandedKeys((current) => current.includes(connKey) ? current : [...current, connKey])

      if (connection.database_type === 'sqlite') {
        setTreeData((current) => updateTreeNode(current, connKey, buildConnectionNode(connection).children ?? []))
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
      setExpandedKeys((keys) => keys.filter((k) => !String(k).startsWith(`connection:${connectionId}`) && !String(k).includes(`:${connectionId}:`)))
      setTreeData((current) => replaceConnectionNode(current, connection))
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
    const isCreateMode = mode === 'create'
    const isMongo = connection?.database_type === 'mongodb'
    const supportsComments = tableDesignerSupportsComments(connection?.database_type)
    const supportsUnique = tableDesignerSupportsUnique(connection?.database_type)
    const supportsAutoIncrement = tableDesignerSupportsAutoIncrement(connection?.database_type)
    const supportsAutoIncrementStep = tableDesignerSupportsAutoIncrementStep(connection?.database_type)
    const supportsMinMax = tableDesignerSupportsMinMax(connection?.database_type)
    const scopeLabel = isSchemaScopedType(connection?.database_type)
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
              <Typography.Text type="secondary">{isSchemaScopedType(connection?.database_type) ? '数据库 / Schema' : '数据库'}</Typography.Text>
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
    setEditingCells((current) => ({ ...current, [tabKey]: undefined }))
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
      setEditingCells((current) => ({ ...current, [tab.key]: undefined }))
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
    if (!ensureConnectionOpen(connectionId)) {
      return
    }

    const whereCondition = where.trim()
    const tabKey = `preview:${connectionId}:${pgDatabaseName ?? databaseName ?? 'main'}:${tableName}`
    clearInlineCellEditor(tabKey)

    setSelectedConnectionId(connectionId)
    setActiveTabKey(tabKey)
    setWorkspaceTabs((current) => {
      const exists = current.some((tab) => tab.key === tabKey)

      if (exists) {
        return current.map((tab) => (tab.key === tabKey ? { ...tab, limit, page, where: whereCondition, objectType, loading: true, error: undefined } : tab))
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
          objectType,
          sql: '',
          limit,
          page,
          where: whereCondition,
          loading: true
        }
      ]
    })

    try {
      const currentPreviewTab = workspaceTabs.find((tab) => tab.key === tabKey)
      const effectiveSortState = sortState !== undefined ? sortState : currentPreviewTab?.sortState
      const previewPath = withSortQuery(withWhereQuery(withPageQuery(withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/preview`, databaseName, pgDatabaseName), limit, page), whereCondition), effectiveSortState)
      const [result, columnsData] = await Promise.all([
        requestJson<QueryResponse>(previewPath),
        requestJson<ColumnsResponse>(withPgDatabase(`/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns`, databaseName, pgDatabaseName))
      ])
      const columnInfoMap = Object.fromEntries(columnsData.columns.map((item) => [item.name, item] as const))
      setEditingCells((current) => ({ ...current, [tabKey]: undefined }))
      updateWorkspaceTab(tabKey, { result, columnInfoMap, editRows: buildEditableRows(result.rows), selectedRowKeys: [], selectedRowKeyMap: {}, columnFilterOptions: undefined, where: whereCondition, loading: false, error: undefined })
      requestAnimationFrame(() => syncRenderedCellSelection(tabKey))
    } catch (err) {
      updateWorkspaceTab(tabKey, { loading: false, error: err instanceof Error ? err.message : '加载表数据失败' })
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
    const currentActiveTab = workspaceTabs.find((tab) => tab.key === activeTabKey)
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

  const openPersistedQueryWorkspace = (item: PersistedQueryWorkspace): void => {
    const existing = workspaceTabs.find((tab) => tab.key === item.key)
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

  const resolveQueryExecutionContext = async (tab: WorkspaceTab): Promise<WorkspaceTab | undefined> => {
    if (!tab.connectionId) {
      return undefined
    }

    let connection = getConnection(tab.connectionId)
    if (!connection) {
      return undefined
    }

    if (!connection.is_open) {
      const openedConnection = await openConnectionById(tab.connectionId)
      if (!openedConnection) {
        return undefined
      }
      connection = openedConnection
    }

    let nextDatabaseName = tab.databaseName
    let nextPgDatabaseName = tab.pgDatabaseName

    if (isDatabaseScopedType(connection.database_type) || connection.database_type === 'dm' || connection.database_type === 'oracle') {
      const loadedDatabases = allDatabases[tab.connectionId] ?? []
      if (loadedDatabases.length === 0) {
        await ensureDatabasesLoaded(tab.connectionId)
      }
      const availableDatabases = allDatabases[tab.connectionId] ?? selectedDatabasesRef.current[tab.connectionId] ?? []
      if (!nextDatabaseName || !availableDatabases.includes(nextDatabaseName)) {
        nextDatabaseName = selectedDatabasesRef.current[tab.connectionId]?.[0]
          ?? availableDatabases[0]
          ?? getDefaultDatabaseName(connection)
      }
    }

    if (isSchemaScopedType(connection.database_type)) {
      const loadedDatabases = allDatabases[tab.connectionId] ?? []
      if (loadedDatabases.length === 0) {
        await ensureDatabasesLoaded(tab.connectionId)
      }
      const availablePgDatabases = allDatabases[tab.connectionId] ?? selectedDatabasesRef.current[tab.connectionId] ?? []
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

    setSelectedConnectionId(tab.connectionId)
    setSelectedConnectionIds([tab.connectionId])
    setSelectedTreeKeys([`connection:${tab.connectionId}`])
    setExpandedKeys((current) => Array.from(new Set([
      ...current,
      `connection:${tab.connectionId}`,
      ...(nextPgDatabaseName ? [`database:${tab.connectionId}:${nextPgDatabaseName}`] : []),
      ...(nextDatabaseName && nextPgDatabaseName
        ? [`pg-schema:${tab.connectionId}:${nextPgDatabaseName}:${nextDatabaseName}`]
        : nextDatabaseName
          ? [`database:${tab.connectionId}:${nextDatabaseName}`]
          : [])
    ])))

    return {
      ...tab,
      databaseName: nextDatabaseName,
      pgDatabaseName: nextPgDatabaseName
    }
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

  const runQuery = async (tab: WorkspaceTab, selectedSql?: string): Promise<void> => {
    const executionContext = sqlExecutionContextByTab[tab.key]
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
    await locateTreePath([
      `connection:${resolvedTab.connectionId}`,
      ...(resolvedTab.pgDatabaseName ? [`database:${resolvedTab.connectionId}:${resolvedTab.pgDatabaseName}`] : []),
      ...(resolvedTab.databaseName && resolvedTab.pgDatabaseName
        ? [`pg-schema:${resolvedTab.connectionId}:${resolvedTab.pgDatabaseName}:${resolvedTab.databaseName}`]
        : resolvedTab.databaseName
          ? [`database:${resolvedTab.connectionId}:${resolvedTab.databaseName}`]
          : [])
    ])

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
  const activeTab = workspaceTabs.find((tab) => tab.key === activeTabKey)
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
  const primaryAIContextSource: AIContextSource | undefined = aiContextConnection && aiDbName
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
  const effectiveAIContextSources = primaryAIContextSource
    ? [primaryAIContextSource, ...aiContextSources.filter((source) => source.id !== primaryAIContextSource.id)]
    : aiContextSources
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
  const recentQueries = useMemo(
    () => workspaceTabs.filter((tab) => tab.kind === 'query' && tab.sql.trim()).slice(-5).map((tab) => tab.sql),
    [workspaceTabs]
  )
  const visibleResultColumns = activeTab?.result?.columns ?? []
  const visibleResultSample = activeTab?.result?.rows.slice(0, 5) ?? []

  const aiWorkspacePayload = useMemo(() => ({
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
    recent_queries: recentQueries,
    visible_result_columns: visibleResultColumns,
    visible_result_sample: visibleResultSample,
    context_sources: effectiveAIContextSources
  }), [activeTab?.kind, activeTab?.sql, activeTab?.tableName, aiContextConnection?.database_type, aiContextConnection?.name, aiContextConnection?.server_version, aiDatabase, aiPgDatabase, connectionSummaries, effectiveAIContextSources, focusedResource, recentQueries, visibleResultColumns, visibleResultSample])

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
            <Button className="toolbar-query-btn" type="primary" size="small" icon={<FileAddOutlined />} onClick={() => openQueryWorkspace('', '新建查询')} title="新建查询" aria-label="新建查询">
              新建查询
            </Button>
            <Button type="text" size="small" icon={<HistoryOutlined />} onClick={openQueryHistoryModal} title="历史查询窗口" aria-label="历史查询窗口" />
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => openSettings('app')} title="设置" aria-label="设置" />
            <Button type={updateInfo?.available || downloadingUpdate ? 'primary' : 'text'} size="small" icon={<CloudDownloadOutlined />} loading={checkingUpdate} onClick={() => { openUpdateModal(); if (!downloadingUpdate) { void checkForUpdates(true) } }} title="检查更新" aria-label="检查更新" />
            <Button type="text" size="small" icon={<ReloadOutlined />} loading={healthLoading} onClick={() => void checkHealth()} title="同步状态" aria-label="同步状态" />
            <Button type={aiPanelOpen ? 'primary' : 'text'} size="small" icon={<MessageOutlined />} onClick={() => setAiPanelOpen((open) => !open)} title={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} aria-label={aiPanelOpen ? '关闭 AI 侧栏' : '打开 AI 侧栏'} />
            <Button className="theme-toggle-btn" type="text" size="small" icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'} />
            {showBackendStatusTag && (
              <Tag className="service-pill" icon={backendStatusIcon} color={BACKEND_COLORS[backendStatus.state]} title={backendStatus.message}>{BACKEND_LABELS[backendStatus.state]}</Tag>
            )}
          </Space>
          <Space className="window-controls titlebar-no-drag" size={0}>
            <Button type="text" icon={<MinusOutlined />} onClick={() => void window.api.minimizeWindow()} title="最小化" aria-label="最小化" />
            <Button type="text" icon={<BorderOutlined />} onClick={() => void window.api.toggleMaximizeWindow()} title="最大化" aria-label="最大化" />
            <Button type="text" danger icon={<CloseCircleOutlined />} onClick={() => void window.api.closeWindow()} title="关闭" aria-label="关闭" />
          </Space>
        </Flex>
      </Layout.Header>
      <Layout.Content className="app-content">
        <div ref={workspaceShellRef} className="workspace">
          <div ref={resourcePanelRef} className="resource-panel" style={{ width: resourcePanelSize, flex: `0 0 ${resourcePanelSize}px` }}>
            <div className="resource-header">
              <Space direction="vertical" size={2}>
                <Typography.Text className="panel-kicker">DATABASE EXPLORER</Typography.Text>
                <Typography.Title level={5} className="panel-title">数据资产</Typography.Title>
              </Space>
              <Space size={8}>
                <Button className="resource-import" size="small" icon={<LoginOutlined />} onClick={openImportConnectionModal}>导入连接</Button>
                <Dropdown menu={resourceCreateMenu} trigger={['click']}>
                  <Button className="resource-add" type="primary" size="small" icon={<PlusOutlined />}>新建</Button>
                </Dropdown>
              </Space>
            </div>
            <div className="connection-summary-strip">
              <span className="summary-pill summary-pill-connections"><strong>{connections.length}</strong> 连接</span>
              <span className="summary-pill summary-pill-folders"><strong>{connectionFolders.length}</strong> 分组</span>
              <span className="summary-pill summary-pill-tabs"><strong>{workspaceTabs.length}</strong> 工作页</span>
            </div>
            <div className="resource-toolbar">
              <Space size={4}>
                <Button
                  className="resource-toolbar-icon-btn"
                  size="small"
                  type={treeSearchOpen ? 'primary' : 'text'}
                  icon={<SearchOutlined />}
                  title="搜索当前树"
                  aria-label="搜索当前树"
                  onClick={() => {
                    const nextOpen = !treeSearchOpen
                    setTreeSearchOpen(nextOpen)
                    if (!nextOpen) {
                      setTreeSearchText('')
                    }
                  }}
                />
                <Button
                  className="resource-toolbar-icon-btn"
                  size="small"
                  type="text"
                  icon={<AimOutlined />}
                  title="定位当前对象"
                  aria-label="定位当前对象"
                  onClick={() => locateActiveTreeNode()}
                />
              </Space>
              {treeSearchOpen && (
                    <Input
                      ref={treeSearchInputRef}
                      size="small"
                      allowClear
                      className="tree-search-input"
                      value={treeSearchText}
                      onChange={(event) => setTreeSearchText(event.target.value)}
                    />
              )}
            </div>
            <div
              ref={resourceTreeContainerRef}
              className="resource-tree-shell"
              tabIndex={0}
              onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') {
                  return
                }
                const target = event.target as HTMLElement | null
                if (target?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) {
                  return
                }
                event.preventDefault()
                void copyTreeNodeNames()
              }}
            >
              <div
                ref={resourceTreeViewportRef}
                className={`resource-tree-viewport${enableVirtualTree ? ' virtual' : ' non-virtual'}`}
              >
                {!connectionsInitialized || !backendReady ? (
                  <div className="resource-tree-loading-state">
                    <div className="resource-tree-loading-spinner"><LoadingOutlined spin /></div>
                    <Typography.Text type="secondary">正在加载连接与数据库结构...</Typography.Text>
                  </div>
                ) : treeData.length === 0 ? (
                  <Alert message="暂无数据库连接或分组" description="先创建一个连接，或者新建分组开始整理。" type="info" showIcon />
                ) : (
                  <Tree
                    ref={(node) => {
                      resourceTreeRef.current = node
                    }}
                    multiple
                    showIcon
                    blockNode
                    virtual={enableVirtualTree}
                    draggable={{
                      icon: false,
                      nodeDraggable: (node) => {
                        const treeNode = node as unknown as Partial<DatabaseTreeNode>
                        const nodeKind = getTreeNodeKindFromKey(treeNode)
                        return nodeKind === 'connection' || nodeKind === 'folder'
                      }
                    }}
                    allowDrop={allowTreeDrop}
                    dropIndicatorRender={(props) => (
                      <div
                        style={{
                          pointerEvents: 'none',
                          position: 'absolute',
                          right: 0,
                          height: 2,
                          background: 'var(--dj-accent)',
                          top: props.dropPosition === -1 ? 0 : undefined,
                          bottom: props.dropPosition === 1 || props.dropPosition === 0 ? 0 : undefined,
                          left: props.dropPosition === -1 ? -props.dropLevelOffset * props.indent : props.dropPosition === 0 ? props.indent : -props.dropLevelOffset * props.indent
                        }}
                      />
                    )}
                    onDragOver={({ event }) => {
                      if (draggingConnectionIdsRef.current.length === 0) {
                        const target = event.target as HTMLElement | null
                        const draggedConnectionElement = target?.closest<HTMLElement>('[data-connection-id]')
                        const draggedConnectionId = draggedConnectionElement?.dataset.connectionId
                        if (draggedConnectionId) {
                          draggingConnectionIdsRef.current = selectedConnectionIds.includes(draggedConnectionId)
                            ? selectedConnectionIds
                            : [draggedConnectionId]
                          draggingConnectionFolderIdRef.current = connectionFolderAssignments[draggedConnectionId]
                        }
                      }
                      const target = event.target as HTMLElement | null
                      const connectionElement = target?.closest<HTMLElement>('[data-connection-id]')
                      const connectionId = connectionElement?.dataset.connectionId
                      if (connectionElement && connectionId) {
                        const rect = connectionElement.getBoundingClientRect()
                        updateDragOverConnectionTarget({
                          connectionId,
                          folderId: connectionFolderAssignments[connectionId],
                          zone: event.clientY - rect.top >= rect.height / 2 ? 'after' : 'before'
                        })
                        updateDragOverFolderTarget(undefined)
                      } else {
                        updateDragOverConnectionTarget(undefined)
                      }

                      const folderElement = target?.closest<HTMLElement>('[data-folder-id]')
                      const folderId = folderElement?.dataset.folderId
                      if (!folderElement || !folderId) {
                        return
                      }
                      const rect = folderElement.getBoundingClientRect()
                      const offsetY = event.clientY - rect.top
                      updateDragOverFolderTarget({
                        folderId,
                        zone: offsetY >= rect.height / 2 ? 'after' : 'before'
                      })
                    }}
                    onDragEnd={() => {
                      updateDragOverFolderTarget(undefined)
                      clearConnectionDragState()
                    }}
                    height={enableVirtualTree ? resourceTreeHeight : undefined}
                    itemHeight={RESOURCE_TREE_ITEM_HEIGHT}
                    motion={false}
                    switcherIcon={(nodeProps) => (
                      nodeProps.eventKey != null && treeLoadingKeysRef.current.has(nodeProps.eventKey)
                        ? <LoadingOutlined spin className="tree-node-loading-icon" />
                        : undefined
                    )}
                    treeData={treeData}
                    expandedKeys={expandedKeys}
                    onExpand={(keys, info) => {
                      const node = info.node as DatabaseTreeNode
                      if (node.key && treeLoadingKeysRef.current.has(node.key as React.Key)) {
                        return
                      }
                      if (isTreeNodeChildrenLoaded(node) || !isLoadableTreeNode(node)) {
                        flushSync(() => {
                          setExpandedKeys(keys)
                        })
                        if (info.expanded && (node.kind === 'database' || node.kind === 'pg-schema')) {
                          activateAIContextFromNode(node)
                        }
                        return
                      }
                      if (!info.expanded) {
                        collapseTreeNode(node)
                        return
                      }
                      setExpandedKeys(keys)
                      if (node.kind === 'database' || node.kind === 'pg-schema') {
                        activateAIContextFromNode(node)
                      }
                      if (!isTreeNodeChildrenLoaded(node) && isLoadableTreeNode(node)) {
                        void reloadNodeChildren({ ...node, isLeaf: false }, true)
                      }
                    }}
                    titleRender={(node) => renderTreeTitle(node as DatabaseTreeNode)}
                    selectedKeys={selectedTreeKeys}
                    onSelect={(_, info) => {
                      const node = info.node as DatabaseTreeNode
                      handleTreeSelection(node, info.nativeEvent as MouseEvent)
                    }}
                    onRightClick={({ node, event }) => {
                      event.preventDefault()
                      resourceTreeContainerRef.current?.focus()
                      const treeNode = node as DatabaseTreeNode
                      const items = getTreeContextMenuItems(treeNode)
                      if (!items || items.length === 0) {
                        return
                      }
                      if (treeNode.kind === 'connection' && treeNode.connectionId && !selectedConnectionIds.includes(treeNode.connectionId)) {
                        selectConnectionNodes([treeNode.connectionId], treeNode.connectionId)
                      } else if (treeNode.kind !== 'connection') {
                        setSelectedTreeKeys([treeNode.key as React.Key])
                      }
                      startTransition(() => {
                        setFocusedTreeNode(treeNode)
                        if (treeNode.connectionId) {
                          setSelectedConnectionId(treeNode.connectionId)
                        }
                      })
                      setTreeContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        node: treeNode
                      })
                    }}
                    onDrop={handleTreeDrop}
                    onDoubleClick={(_, node) => {
                      const treeNode = node as DatabaseTreeNode
                      startTransition(() => {
                        setFocusedTreeNode(treeNode)
                        if (treeNode.connectionId) {
                          setSelectedConnectionId(treeNode.connectionId)
                        }
                      })
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
                            const connectionId = treeNode.connectionId
                            const tableName = treeNode.tableName
                            const objectType: 'table' | 'view' = treeNode.objectType
                            requestAnimationFrame(() => {
                              void previewTable(connectionId, tableName, treeNode.databaseName, treeNode.pgDatabaseName, PREVIEW_DEFAULT_LIMIT, 1, '', objectType)
                            })
                          }
                          return
                        }
                      if (treeNode.kind === 'connection' && treeNode.connectionId) {
                        const conn = getConnection(treeNode.connectionId)
                        if (conn && !conn.is_open) {
                          void openConnectionById(treeNode.connectionId).then((openedConnection) => {
                            if (openedConnection?.is_open) {
                              toggleOrLoadTreeNode({ ...treeNode, childrenLoaded: openedConnection.database_type === 'sqlite' })
                            }
                          })
                          return
                        }
                      }
                      toggleOrLoadTreeNode(treeNode)
                    }}
                  />
                )}
              </div>
              {treeContextMenu && (
                <div className="tree-context-menu-backdrop">
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
          </div>
          <div
            className={`workspace-side-resizer${resizingResourcePanel ? ' active' : ''}`}
            onMouseDown={(event) => {
              resourcePanelResizeRef.current = { startX: event.clientX, startSize: resourcePanelSize }
              setResizingResourcePanel(true)
            }}
          />
          <div ref={mainPanelRef} className="main-panel">
            <div className={`studio-shell${resizingResourcePanel || resizingAiPanel ? ' studio-shell-suspended' : ''}`}>
              <div className="editor-placeholder">
                {workspaceTabs.length === 0 ? (
                  <div className="empty-workspace"><FileAddOutlined /><Typography.Text type="secondary">连接数据库后，可以浏览库表结构、预览数据、编写 SQL，并让 Djinn Agent 辅助分析与执行受控操作。</Typography.Text><Space><Button icon={<LoginOutlined />} onClick={openImportConnectionModal}>导入连接</Button><Dropdown menu={connectionCreateMenu} trigger={['click']}><Button icon={<PlusOutlined />}>创建连接</Button></Dropdown></Space></div>
                ) : (
                  <WorkspaceTabsView
                    workspaceTabs={workspaceTabs}
                    activeTabKey={activeTabKey}
                    activeTabSearchState={activeTabSearchState}
                    onActiveTabChange={setActiveTabKey}
                    onCloseTab={closeWorkspaceTab}
                    onRenameTab={renameWorkspaceTab}
                    renderWorkspaceTab={renderWorkspaceTab}
                  />
                )}
              </div>
              {aiPanelOpen && (
                <>
                  <div
                    className={`ai-panel-resizer${resizingAiPanel ? ' active' : ''}`}
                    onMouseDown={(event) => {
                      aiPanelResizeRef.current = { startX: event.clientX, startSize: aiPanelSize }
                      setResizingAiPanel(true)
                    }}
                  />
                  <div ref={aiDockPanelRef} className="ai-dock-panel" style={{ width: aiPanelSize, flex: `0 0 ${aiPanelSize}px` }}>
                    <MemoAIPanel
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
                      workspace={aiWorkspacePayload}
                      contextSources={effectiveAIContextSources}
                      primaryContextSourceId={primaryAIContextSource?.id}
                      onRemoveContextSource={removeAIContextSource}
                    onWorkspaceAction={(action: AIWorkspaceAction) => {
                      if (action.type === 'append_query_sql') {
                        appendSqlToQueryWorkspace(action.sql, action.title)
                      }
                    }}
                    onAgentDataChanged={refreshAfterAgentChange}
                    shortcuts={{
                      send: shortcutSettings.ai_send,
                      newline: shortcutSettings.ai_newline,
                      stop: shortcutSettings.ai_stop
                    }}
                  />
                </div>
              </>
            )}
            </div>
          </div>
        </div>
      </Layout.Content>
      <ImperativeModalHost
        ref={updateModalRef}
        title="应用更新"
        footer={null}
        width={680}
        maskClosable={false}
        onClosed={() => setUpdateModalContentReady(false)}
      >
        {updateModalContentReady ? (
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
        ) : (
          <div className="deferred-modal-loading"><LoadingOutlined spin /></div>
        )}
      </ImperativeModalHost>
      <ImperativeModalHost
        ref={queryHistoryModalRef}
        title="历史查询窗口"
        footer={null}
        width={760}
        onClosed={() => setQueryHistoryContentReady(false)}
      >
        {queryHistoryContentReady ? (
        <div className="query-history-modal">
          {Object.entries(
            persistedQueryWorkspaces.reduce<Record<string, PersistedQueryWorkspace[]>>((groups, item) => {
              const connectionName = getConnection(item.connectionId)?.name ?? item.connectionName ?? '未绑定连接'
              if (!groups[connectionName]) {
                groups[connectionName] = []
              }
              groups[connectionName].push(item)
              return groups
            }, {})
          ).map(([groupName, items]) => (
            <div key={groupName} className="query-history-group">
              <div className="query-history-group-title">{groupName}</div>
              <div className="query-history-group-list">
                {items
                  .sort((left, right) => right.persistedAt - left.persistedAt)
                  .map((item) => (
                    <div
                      key={item.key}
                      className="query-history-item"
                      onDoubleClick={() => {
                        openPersistedQueryWorkspace(item)
                        queryHistoryModalRef.current?.close()
                      }}
                    >
                      <div className="query-history-item-main">
                        <div className="query-history-item-title">{item.title}</div>
                        <div className="query-history-item-meta">
                          {[item.pgDatabaseName, item.databaseName].filter(Boolean).join('.')}
                        </div>
                        <div className="query-history-item-sql">{item.sql || '空查询'}</div>
                      </div>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(event) => {
                          event.stopPropagation()
                          removePersistedQueryWorkspace(item.key)
                        }}
                      />
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
        ) : (
          <div className="deferred-modal-loading"><LoadingOutlined spin /></div>
        )}
      </ImperativeModalHost>
      <Modal
        title="导入连接"
        open={importConnectionModalOpen}
        width={980}
        onCancel={closeImportConnectionModal}
        maskClosable={false}
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
        <Space direction="vertical" className="full-width" size={16}>
          <Form layout="vertical">
            <Form.Item label="来源">
              <Select
                value={importConnectionSource}
                options={IMPORT_CONNECTION_SOURCE_OPTIONS}
                onChange={(value) => setImportConnectionSource(value as ImportConnectionSource)}
              />
            </Form.Item>
            <Form.Item label="连接配置文本" extra="选中复制DataGrip/IDEA中的数据源并复制粘贴到上方。">
              <Input.TextArea
                value={importConnectionRawText}
                autoSize={{ minRows: 10, maxRows: 18 }}
                placeholder="#DataSourceSettings# ..."
                onChange={(event) => setImportConnectionRawText(event.target.value)}
              />
            </Form.Item>
          </Form>
          {importConnectionCandidates.length > 0 && (
            <Space direction="vertical" className="full-width" size={10}>
              <Flex justify="space-between" align="center">
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
        onCancel={closeImportConnectionResultModal}
        footer={<Button type="primary" onClick={closeImportConnectionResultModal}>关闭</Button>}
        maskClosable={false}
      >
        {importConnectionResult && (
          <Space direction="vertical" className="full-width" size={12}>
            <Alert
              type={importConnectionResult.failed.length > 0 ? 'warning' : 'success'}
              showIcon
              message={`成功 ${importConnectionResult.success.length} 个，失败 ${importConnectionResult.failed.length} 个`}
            />
            {importConnectionResult.success.length > 0 && (
              <Space direction="vertical" className="full-width" size={8}>
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
              <Space direction="vertical" className="full-width" size={8}>
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
        maskClosable={false}
        onClosed={() => setSettingsContentReady(false)}
      >
        {settingsContentReady ? (
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
              <Space direction="vertical" className="full-width" size="large">
                <div className="settings-about-card">
                  <img className="settings-about-logo" src={appLogoHorizontal} alt="DataDjinn" />
                  <Typography.Text type="secondary">当前版本：{appInfo?.version ?? updateSettings?.currentVersion ?? '-'}</Typography.Text>
                </div>
                <Button icon={<GithubOutlined />} onClick={() => void window.api.openProjectHome()}>
                  GitHub
                </Button>
              </Space>
            ) : settingsSection === 'shortcuts' ? (
              <Space direction="vertical" className="full-width" size="large">
                <div>
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
                  </Space>
                </div>
                <div>
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
                          <Select options={driverTypeOptionsForDatabase(selectedDriverDatabaseType)} />
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
      <Modal title={editingTableName ? `修改表：${editingTableName}` : '修改表'} open={tableEditorOpen} okText="保存" cancelText="取消" confirmLoading={tableEditorLoading} onOk={() => void saveTableEditor()} onCancel={() => setTableEditorOpen(false)} width={980} okButtonProps={{ disabled: !tableDesignerSupportsEdit(getConnection(editingConnectionId)?.database_type) }} maskClosable={false}>
        {renderTableDesigner('edit', editingConnectionId, editingDatabaseName, editingPgDatabaseName, editingTableName ?? '', undefined, editingTableComment, setEditingTableComment, editingColumns, tableEditorLoading)}
      </Modal>
      <Modal title={creatingSchemaDatabaseName ? '新建 Schema' : getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' ? '新建用户' : '新增数据库'} open={databaseCreateModalOpen} okText="创建" cancelText="取消" confirmLoading={databaseCreateLoading} onOk={() => void createDatabase()} onCancel={() => { setDatabaseCreateModalOpen(false); setCreatingSchemaDatabaseName(''); setDatabaseCreatePassword('') }} okButtonProps={{ disabled: !databaseCreateName.trim() || (getConnection(creatingDatabaseConnectionId)?.database_type === 'oracle' && !creatingSchemaDatabaseName && !databaseCreatePassword.trim()) }} maskClosable={false}>
        <Form layout="vertical">
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
      >
        <Form layout="vertical">
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
      <Modal title={getConnection(createTableConnectionId)?.database_type === 'mongodb' ? '新建集合' : '新建表'} open={createTableModalOpen} okText="创建" cancelText="取消" confirmLoading={createTableLoading} onOk={() => void createTable()} onCancel={() => setCreateTableModalOpen(false)} width={980} okButtonProps={{ disabled: !newTableName.trim() || (getConnection(createTableConnectionId)?.database_type !== 'mongodb' && newTableColumns.filter((c) => c.name.trim()).length === 0) }} maskClosable={false}>
        {renderTableDesigner('create', createTableConnectionId, createTableDatabaseName, createTablePgDatabaseName || undefined, newTableName, setNewTableName, newTableComment, setNewTableComment, newTableColumns, createTableLoading)}
      </Modal>
      <Modal title={connectionMode === 'edit' ? '编辑数据库连接' : '保存数据库连接'} open={connectionModalOpen} okText={connectionMode === 'edit' ? '保存修改' : '保存连接'} cancelText="取消" confirmLoading={connectionLoading} onOk={() => void saveConnection()} onCancel={() => setConnectionModalOpen(false)} footer={(_, { OkBtn, CancelBtn }) => (<Space><Button loading={testingConnection} onClick={() => void testConnection()}>测试连接</Button><CancelBtn /><OkBtn /></Space>)} maskClosable={false}>
        <Form form={form} layout="vertical" initialValues={{ database_type: 'sqlite' }}>
          <Form.Item
            name="name"
            label="连接名称"
            rules={[{ required: true, message: '请输入连接名称' }]}
          >
            <Input placeholder="例如：本地 SQLite" />
          </Form.Item>
          <Form.Item name="database_type" style={{ display: 'none' }}><Input /></Form.Item>
          {databaseType === 'sqlite' ? (
            <Form.Item name="sqlite_path" label="SQLite 文件路径" rules={[{ required: true, message: '请输入 SQLite 文件路径' }]}><Input placeholder="data/datadjinn.sqlite" /></Form.Item>
          ) : (
            <>
              <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机' }]}><Input placeholder="127.0.0.1" /></Form.Item>
              <Form.Item
                name="port"
                label="端口"
                rules={[
                  { required: true, message: '请输入端口' },
                  ...(databaseType === 'clickhouse'
                    ? [{
                      validator: async (_rule: unknown, value: unknown) => {
                        const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
                        if (!normalized) {
                          return
                        }
                        const segments = normalized.split(',').map((item) => item.trim()).filter(Boolean)
                        if (segments.length === 0 || segments.some((item) => !/^\d+$/.test(item) || Number(item) < 1 || Number(item) > 65535)) {
                          throw new Error('ClickHouse 端口支持单个端口或逗号分隔的多个端口')
                        }
                      }
                    }]
                    : [])
                ]}
              >
                {databaseType === 'clickhouse' ? (
                  <Input className="full-width" placeholder="例如：8123 或 8123,8124" />
                ) : (
                  <InputNumber min={1} max={65535} className="full-width" placeholder={databaseType === 'postgresql' ? '5432' : databaseType === 'gaussdb' ? '8000' : databaseType === 'oracle' ? '1521' : databaseType === 'dm' ? '5236' : databaseType === 'mongodb' ? '27017' : databaseType === 'redis' ? '6379' : '3306'} />
                )}
              </Form.Item>
              <Form.Item name="username" label="用户名" rules={databaseType === 'mongodb' || databaseType === 'redis' ? undefined : [{ required: true, message: '请输入用户名' }]}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'gaussdb' ? 'gaussdb' : databaseType === 'oracle' ? 'system' : databaseType === 'dm' ? 'SYSDBA' : databaseType === 'redis' ? 'Redis ACL 用户名，可选' : databaseType === 'clickhouse' ? 'default' : undefined} /></Form.Item>
              <Form.Item name="password" label="密码"><Input.Password /></Form.Item>
              <Form.Item name="database" label={databaseType === 'postgresql' || databaseType === 'gaussdb' ? '数据库名' : databaseType === 'oracle' ? '服务名' : databaseType === 'dm' ? '默认 Schema（可选）' : databaseType === 'mongodb' ? '认证库/默认库（可选）' : databaseType === 'redis' ? '默认 DB 序号（可选）' : databaseType === 'clickhouse' ? '默认数据库' : '默认数据库（可选）'} rules={databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' ? [{ required: true, message: databaseType === 'oracle' ? '请输入服务名' : '请输入数据库名' }] : undefined}><Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'gaussdb' ? 'postgres' : databaseType === 'oracle' ? '例如：orclpdb1' : databaseType === 'dm' ? '不填则使用默认 Schema' : databaseType === 'mongodb' ? '默认 admin，也可填业务库名' : databaseType === 'redis' ? '默认 0，例如 0、1、2' : databaseType === 'clickhouse' ? '默认 default' : '不填则连接服务器并加载全部数据库'} /></Form.Item>
              {databaseType && JDBC_COMPATIBLE_DATABASE_TYPES.includes(databaseType) && (
                <>
                  <Form.Item name="driver_id" label={`${DRIVER_DATABASE_META[driverDatabaseTypeForConnection(databaseType) ?? 'dm'].shortLabel}驱动`} rules={[{ required: true, message: '请选择驱动' }]}>
                    <Select
                      loading={driversLoading}
                      placeholder={`请选择已添加的${DRIVER_DATABASE_META[driverDatabaseTypeForConnection(databaseType) ?? 'dm'].shortLabel}驱动`}
                      options={manualDriverOptions}
                      notFoundContent={`暂无可用${DRIVER_DATABASE_META[driverDatabaseTypeForConnection(databaseType) ?? 'dm'].shortLabel}驱动`}
                      onChange={(value) => {
                        form.setFieldsValue({
                          driver_id: value,
                          dm_driver_id: databaseType === 'dm' ? value : undefined
                        })
                      }}
                    />
                  </Form.Item>
                  <Alert
                    type={selectedManualDriver ? 'info' : 'warning'}
                    showIcon
                    message={selectedManualDriver ? `当前选择：${driverTypeLabel(selectedManualDriver.driver_type)} - ${selectedManualDriver.name}` : '未选择驱动，请先在驱动管理中添加并选择兼容驱动'}
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


