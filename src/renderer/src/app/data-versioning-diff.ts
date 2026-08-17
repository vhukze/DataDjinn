export type DataVersionRowChange = {
  identity: Record<string, unknown>
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  changed_columns: string[]
}

export type TableDataSnapshotDiff = {
  version_id: string
  table_name: string
  identity_columns: string[]
  added: DataVersionRowChange[]
  deleted: DataVersionRowChange[]
  updated: DataVersionRowChange[]
}

export type DataVersionDiffChangedRow = {
  key: string
  identity: Record<string, unknown>
  column: string
  before: unknown
  after: unknown
}

export const formatDataVersionValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const formatDataVersionIdentity = (identity: Record<string, unknown>): string => {
  const values = Object.entries(identity)
  return values.length > 0
    ? values.map(([column, value]) => `${column} = ${formatDataVersionValue(value)}`).join(' · ')
    : '-'
}

export const buildDataVersionDiffChangedRows = (
  changes: DataVersionRowChange[]
): DataVersionDiffChangedRow[] =>
  changes.flatMap((change, changeIndex) =>
    change.changed_columns.map((column) => ({
      key: `${changeIndex}:${column}`,
      identity: change.identity,
      column,
      before: change.before?.[column],
      after: change.after?.[column]
    }))
  )

export const collectDataVersionDiffColumns = (
  changes: DataVersionRowChange[],
  identityColumns: string[],
  side: 'before' | 'after'
): string[] => {
  const columns = new Set<string>()
  for (const change of changes) {
    const row = change[side]
    if (!row) {
      continue
    }
    Object.keys(row).forEach((column) => {
      if (!identityColumns.includes(column)) {
        columns.add(column)
      }
    })
  }
  return [...columns]
}
