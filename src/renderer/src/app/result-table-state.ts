import { createSearchMatcher } from './table-region'
import type { EditableRow, TableSearchUiState, WorkspaceTab } from './workspace-model'

type SearchMatch = {
  cellKey: string
  rowKey: string
  column: string
}

type SearchMatcherLike = ReturnType<typeof createSearchMatcher>

const tableFilterValueKey = (value: unknown): string => {
  if (
    value !== null
    && typeof value === 'object'
    && '__datadjinn_action__' in value
    && (value as { __datadjinn_action__?: string }).__datadjinn_action__ === 'default'
  ) {
    return '__DATADJINN_DEFAULT__'
  }
  return value === null || value === undefined ? '__DATADJINN_NULL__' : String(value)
}

const buildBaseTableRows = (tab: WorkspaceTab): EditableRow[] => (
  tab.kind === 'preview'
    ? (tab.editRows ?? [])
    : (tab.result?.rows.map((row, index) => ({ ...row, __rowKey: `query:${index}` })) ?? [])
)

export type ResultTableDerivedState = {
  baseTableRows: EditableRow[]
  selectedRowKeyMap: Record<string, true>
  selectedRowKeysSet: Set<string>
  orderedColumns: string[]
  columnWidths: Record<string, number>
  columnFilters: Record<string, string[]>
  tableRows: EditableRow[]
  rowNumberOffset: number
  orderedRowKeys: string[]
  orderedRowIndexMap: Record<string, number>
  orderedColumnIndexMap: Record<string, number>
  orderedRowKeysByLength: string[]
  rowByKey: Map<string, EditableRow>
  searchMatches: SearchMatch[]
  matchedCellKeySet: Set<string>
  searchMatcher: SearchMatcherLike
}

export const buildResultTableDerivedState = ({
  tab,
  searchState,
  previewDefaultLimit,
  queryDefaultLimit,
  formatCellText
}: {
  tab: WorkspaceTab
  searchState: TableSearchUiState
  previewDefaultLimit: number
  queryDefaultLimit: number
  formatCellText: (value: unknown) => string
}): ResultTableDerivedState => {
  const baseTableRows = buildBaseTableRows(tab)
  const selectedRowKeyMap = tab.selectedRowKeyMap ?? Object.fromEntries((tab.selectedRowKeys ?? []).map((key) => [String(key), true]))
  const selectedRowKeysSet = new Set((tab.selectedRowKeys ?? []).map(String))
  const resultColumns = tab.result?.columns ?? []
  const orderedColumns = [
    ...(tab.columnOrder ?? []).filter((column) => resultColumns.includes(column)),
    ...resultColumns.filter((column) => !(tab.columnOrder ?? []).includes(column))
  ]
  const columnWidths = tab.columnWidths ?? {}
  const columnFilters = tab.columnFilters ?? {}
  const filterColumns = Object.keys(columnFilters)
  const filteredRows = filterColumns.length > 0
    ? baseTableRows.filter((row) => filterColumns.every((column) => columnFilters[column]?.includes(tableFilterValueKey(row[column]))))
    : baseTableRows
  const pageSearchText = searchState.query.trim()
  const searchMatcher = createSearchMatcher(pageSearchText, {
    regex: searchState.regex,
    wholeWord: searchState.wholeWord,
    caseSensitive: searchState.caseSensitive
  })

  const allSearchMatches: SearchMatch[] = []
  const matchedCellKeySet = new Set<string>()
  if (searchMatcher) {
    for (const row of filteredRows) {
      for (const column of orderedColumns) {
        const text = formatCellText(row[column])
        if (!text || !searchMatcher.matches(text)) {
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
    ? filteredRows.filter((row) => matchedRowKeySet.has(row.__rowKey))
    : filteredRows
  const rowNumberOffset = ((tab.page ?? 1) - 1) * (tab.limit ?? (tab.kind === 'preview' ? previewDefaultLimit : queryDefaultLimit))
  const orderedRowKeys = tableRows.map((row) => row.__rowKey)
  const orderedRowIndexMap = Object.fromEntries(orderedRowKeys.map((rowKey, index) => [rowKey, index] as const))
  const orderedColumnIndexMap = Object.fromEntries(orderedColumns.map((column, index) => [column, index]))
  const orderedRowKeysByLength = [...orderedRowKeys].sort((left, right) => right.length - left.length)
  const rowByKey = new Map(tableRows.map((row) => [row.__rowKey, row]))
  const visibleRowKeySet = new Set(orderedRowKeys)
  const searchMatches = allSearchMatches.filter((match) => visibleRowKeySet.has(match.rowKey))

  return {
    baseTableRows,
    selectedRowKeyMap,
    selectedRowKeysSet,
    orderedColumns,
    columnWidths,
    columnFilters,
    tableRows,
    rowNumberOffset,
    orderedRowKeys,
    orderedRowIndexMap,
    orderedColumnIndexMap,
    orderedRowKeysByLength,
    rowByKey,
    searchMatches,
    matchedCellKeySet,
    searchMatcher
  }
}
