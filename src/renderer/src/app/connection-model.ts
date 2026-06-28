import type { DatabaseType } from './data-sources'
import type { DbObjectType } from './tree-model'

export type HealthStatus = {
  status: string
  app: string
  version: string
}

export type ConnectionInfo = {
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

export type ConnectionTestResponse = {
  success: boolean
  message: string
}

export type DatabaseInfo = {
  name: string
  size_bytes?: number | null
  size_display?: string | null
  storage_size_bytes?: number | null
  storage_size_display?: string | null
}

export type TableInfo = {
  name: string
  comment?: string | null
  size_bytes?: number | null
  size_display?: string | null
  storage_size_bytes?: number | null
  storage_size_display?: string | null
  row_count?: number | null
}

export type DbObjectInfo = TableInfo & {
  type: DbObjectType
}

export type ColumnInfo = {
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

export type ColumnsResponse = {
  columns: ColumnInfo[]
  table_comment?: string | null
}

export type QueryResponse = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  limited: boolean
  total_count?: number | null
  sort_column?: string | null
  sort_direction?: string | null
}

export type QueryResultKind = 'query' | 'command' | 'error'

export type ObjectDdlResponse = {
  ddl: string
}

export type SequenceDetailResponse = {
  name: string
  schema?: string | null
  start_value?: string | null
  minimum_value?: string | null
  maximum_value?: string | null
  increment_by?: string | null
  cache_size?: string | null
  cycle?: boolean | null
  current_value?: string | null
  last_number?: string | null
}

export type SqlFileRunResponse = {
  success_count: number
  failed_count: number
  errors: string[]
}
