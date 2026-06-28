import type { DatabaseType } from './data-sources'

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

export const tableDesignerSupportsComments = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle'
export const tableDesignerSupportsUnique = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const tableDesignerSupportsAutoIncrement = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const tableDesignerSupportsAutoIncrementStep = (databaseType?: DatabaseType): boolean => databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle'
export const tableDesignerSupportsMinMax = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const tableDesignerSupportsEdit = (databaseType?: DatabaseType): boolean => databaseType === 'mysql' || databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' || databaseType === 'sqlite'
export const isIntegerLikeType = (type: string): boolean => INTEGER_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))
export const isNumericLikeType = (type: string): boolean => NUMERIC_TYPE_PREFIXES.some((prefix) => type.trim().toLowerCase().startsWith(prefix))
