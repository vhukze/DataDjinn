import type { SqlStatementInfo } from '../components/SqlEditor'
import type { ColumnInfo, QueryResponse } from './connection-model'
import type { DbObjectType } from './tree-model'

export type WorkspaceTabKind = 'preview' | 'query' | 'redis-browser' | 'table-list'

export type EditableRow = Record<string, unknown> & {
  __rowKey: string
  __state?: 'inserted' | 'updated'
  __deleted?: boolean
  __original?: Record<string, unknown>
}

export type RedisKeyEdit = {
  rowKey: string
  key: string
  type: string
  value: string
  ttl?: number | null
  state?: 'inserted' | 'updated'
  deleted?: boolean
  originalKey?: string
}

export type ColumnFilterOption = {
  value: string
  label: string
  count: number
}

export type RedisBrowserMode = 'database' | 'key'

export type RedisExpandedValues = Record<string, true>

export type CellInspectorView = 'record' | 'value' | 'aggregate'

export type ValueDisplayMode = 'raw' | 'json'

export type WorkspaceTab = {
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
  resultKind?: 'query' | 'command' | 'error'
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
  tableRenderVersion?: number
  columnWidths?: Record<string, number>
  persistedAt?: number
}

export type PersistedQueryWorkspace = {
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

export type TableSearchUiState = {
  visible: boolean
  query: string
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
  filterRows: boolean
  activeMatchIndex: number
}

export type SqlEditorExecutionContext = {
  selectedSql: string
  currentStatementSql: string
  statements: SqlStatementInfo[]
  currentStatementIndex: number
}

export type AIContextSource = {
  id: string
  type: 'database' | 'schema'
  connectionId: string
  connectionName: string
  dbType: import('./data-sources').DatabaseType
  database?: string
  schema?: string
  pgDatabase?: string
  sizeDisplay?: string | null
  sizeBytes?: number | null
  storageSizeDisplay?: string | null
  storageSizeBytes?: number | null
}

export type AIActiveContext = {
  connectionId: string
  databaseName?: string
  pgDatabaseName?: string
}

export type AIWorkspaceAction = {
  type: 'append_query_sql'
  sql: string
  title?: string
}
