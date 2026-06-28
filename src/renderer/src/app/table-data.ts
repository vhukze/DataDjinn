export type DefaultValueMarker = {
  __datadjinn_action__: 'default'
}

export type EditableRowLike = Record<string, unknown> & {
  __rowKey: string
  __state?: 'inserted' | 'updated'
  __deleted?: boolean
  __original?: Record<string, unknown>
}

export type RedisKeyEditLike = {
  rowKey: string
  key: string
  type: string
  value: string
  ttl?: number | null
  state?: 'inserted' | 'updated'
  deleted?: boolean
  originalKey?: string
}

export type ColumnInfoLike = {
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

export type ColumnDefLike = {
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

export type RedisPendingTabLike = {
  redisEdits?: Record<string, { state?: 'inserted' | 'updated'; deleted?: boolean }>
}

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

export const buildEditableRows = (rows: Record<string, unknown>[]): EditableRowLike[] =>
  rows.map((row, index) => ({
    ...cloneRowSnapshot(row),
    __rowKey: `row:${index}`,
    __original: cloneRowSnapshot(row)
  }))

export const tableFilterValueKey = (value: unknown): string => {
  if (isDefaultValueMarker(value)) {
    return '__DATADJINN_DEFAULT__'
  }
  return value === null || value === undefined ? '__DATADJINN_NULL__' : String(value)
}

export const displayValue = (value: unknown): string => {
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

export const buildRedisEdits = (rows: Record<string, unknown>[]): Record<string, RedisKeyEditLike> =>
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

export const toColumnDef = (column: ColumnInfoLike): ColumnDefLike => ({
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

export const countRedisPendingChanges = (tab: RedisPendingTabLike): number =>
  Object.values(tab.redisEdits ?? {}).filter((edit) => edit.state || edit.deleted).length

export const redisTtlDisplay = (ttl: unknown): string => {
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
