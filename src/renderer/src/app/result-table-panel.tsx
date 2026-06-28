import { UnorderedListOutlined } from '@ant-design/icons'
import { Alert, Dropdown, Flex, Spin, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { MessageInstance } from 'antd/es/message/interface'
import type { ColumnsType, TableRef } from 'antd/es/table'
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, Key, MutableRefObject, ReactNode, TdHTMLAttributes } from 'react'
import type { ConnectionInfo } from './connection-model'
import {
  countRedisPendingChanges,
  createDefaultValueMarker,
  editableValue,
  isDefaultValueMarker,
  normalizeShortcutText,
  PREVIEW_DEFAULT_LIMIT,
  QUERY_DEFAULT_LIMIT,
  RESULT_TABLE_VIRTUAL_THRESHOLD,
  redisTtlDisplay,
  cellDisplayText
} from './app-shared'
import type { CellInspectorView, EditableRow, RedisKeyEdit, TableSearchUiState, WorkspaceTab } from './workspace-model'
import type { DbObjectType } from './tree-model'
import { buildResultTableDerivedState } from './result-table-state'
import {
  QueryExecutionStatusCard,
  ResultEditableCell,
  RedisBrowserPanel,
  ResultPager,
  ResultTableToolbar,
  ResultWhereInput,
  ResultStatusBar
} from './result-table-chrome'
import CellInspectorPanel, { type CellInspectorPanelHandle } from './cell-inspector-panel'
import {
  ColumnFilterTrigger,
  getResultTableScrollHeight,
  ResultTableBodyView,
  SearchHighlightedText
} from './table-region'
import {
  DEFAULT_RESULT_COLUMN_WIDTH,
  normalizeCellSelectionKeys
} from './query-utils'
import { useWorkspaceStore } from './workspace-store'

export type HorizontalScrollTableRef = TableRef & {
  scrollTo?: (config: { left?: number }) => void
}

type InlineCellEditorState = {
  rowKey: string
  column: string
  input: HTMLInputElement
  host: HTMLElement
  originalContent: string
  originalValue: unknown
  initialInputValue: string
}

type ColumnResizeState = {
  tabKey: string
  column: string
  columnIndex: number
  pointerId: number
  startX: number
  startWidth: number
  lastWidth: number
  headerCells: HTMLElement[]
  headerColElements: HTMLTableColElement[]
  bodyColElements: HTMLTableColElement[]
  virtual: boolean
  virtualCells?: HTMLElement[]
  pendingWidth?: number
  frameId?: number
}

export type ResultTablePanelRefs = {
  tableComponentRefs: MutableRefObject<Record<string, HorizontalScrollTableRef | null>>
  tableBodyRefs: MutableRefObject<Record<string, HTMLDivElement | null>>
  tableHeaderRefs: MutableRefObject<Record<string, HTMLDivElement | null>>
  tableNativeHorizontalScrollbarRefs: MutableRefObject<Record<string, HTMLDivElement | null>>
  selectedColumnRefs: MutableRefObject<Record<string, string | undefined>>
  selectedCellRefs: MutableRefObject<Record<string, string[] | undefined>>
  renderedSelectedRowRefs: MutableRefObject<Record<string, string[] | undefined>>
  runtimeSelectedCellRefs: MutableRefObject<Record<string, string[] | undefined>>
  cellDragAnchorRefs: MutableRefObject<Record<string, { rowKey: string; column: string } | undefined>>
  scrollbarDragRefs: MutableRefObject<Record<string, boolean | undefined>>
  pendingCellDragTargetRefs: MutableRefObject<Record<string, { rowKey: string; column: string } | undefined>>
  pendingCellDragFrameRefs: MutableRefObject<Record<string, number | undefined>>
  pendingRowDragTargetRefs: MutableRefObject<Record<string, string | undefined>>
  pendingRowDragFrameRefs: MutableRefObject<Record<string, number | undefined>>
  committingEditingCellRefs: MutableRefObject<Record<string, boolean | undefined>>
  editingCellRefs: MutableRefObject<Record<string, { rowKey: string; column: string } | undefined>>
  suppressInlineEditorCommitRefs: MutableRefObject<Record<string, boolean | undefined>>
  cellClipboardRef: MutableRefObject<{ text: string; values: unknown[][] } | null>
  contextMenuCellSelectionRefs: MutableRefObject<Record<string, string[] | undefined>>
  contextMenuCellSelectionSnapshotRefs: MutableRefObject<Record<string, { anchorCellKey: string; cellKeys: string[] } | undefined>>
  cellInspectorPanelRefs: MutableRefObject<Record<string, CellInspectorPanelHandle | null>>
  inlineCellEditorRefs: MutableRefObject<Record<string, InlineCellEditorState | undefined>>
  committedSelectedCellRangeRefs: MutableRefObject<Record<string, string[] | undefined>>
  rowDragAnchorRefs: MutableRefObject<Record<string, string | undefined>>
  rowSelectionDraftRefs: MutableRefObject<Record<string, Key[] | undefined>>
  columnResizeRefs: MutableRefObject<Record<string, ColumnResizeState | undefined>>
}

type ResultTablePanelProps = {
  tab: WorkspaceTab
  refs: ResultTablePanelRefs
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  getImmediateTableSearchState: (tab: WorkspaceTab) => TableSearchUiState
  updateWorkspaceTab: (tabKey: string, patch: Partial<WorkspaceTab>) => void
  updateTableSearchState: (tab: WorkspaceTab, patch: Partial<TableSearchUiState>) => void
  changeTabPage: (tab: WorkspaceTab, page: number) => Promise<void>
  changeTabLimit: (tab: WorkspaceTab, limit: number) => Promise<void>
  previewTable: (
    connectionId: string,
    tableName: string,
    databaseName?: string,
    pgDatabaseName?: string,
    limit?: number,
    page?: number,
    where?: string,
    objectType?: 'table' | 'view',
    sortState?: { column: string; direction: 'ascend' | 'descend' }
  ) => Promise<void>
  previewRedisDatabase: (connectionId: string, databaseName: string, limit?: number, page?: number, tabKey?: string, where?: string) => Promise<void>
  showObjectDdl: (connectionId: string, name: string, type: DbObjectType, databaseName?: string, pgDatabaseName?: string) => Promise<void>
  addPreviewRow: (tab: WorkspaceTab) => void
  markSelectedRowsDeleted: (tab: WorkspaceTab) => void
  submitPreviewChanges: (tab: WorkspaceTab) => Promise<void>
  addRedisRow: (tab: WorkspaceTab) => void
  submitRedisChanges: (tab: WorkspaceTab) => Promise<void>
  toggleRedisValue: (tabKey: string, rowKey: string) => void
  updateRedisEdit: (tabKey: string, rowKey: string, patch: Partial<RedisKeyEdit>) => void
  deleteRedisRow: (tabKey: string, rowKey: string) => void
  updatePreviewCell: (tabKey: string, rowKey: string, column: string, value: unknown) => void
  updatePreviewCells: (tabKey: string, patches: Array<{ rowKey: string; column: string; value: unknown }>) => void
  syncRenderedCellSelection: (tabKey: string) => void
  clearInlineCellEditor: (tabKey: string) => void
  discardInlineCellEditor: (tabKey: string) => void
  commitInlineCellEditor: (tabKey: string) => void
  openInlineCellEditor: (tabKey: string, rowKey: string, column: string, host: HTMLElement, rawValue: unknown) => void
  scheduleRenderedCellSelectionSync: (tabKey: string) => void
  scheduleNativeHorizontalScrollbarSync: (tabKey: string) => void
  clearRuntimeColumnSelection: (tabKey: string) => void
  clearActiveSearchCellHighlight: (tabKey: string) => void
  clearAllCellSelection: (tabKey: string) => void
  clearSelectedRowsForTab: (tabKey: string) => void
  applyRuntimeColumnSelection: (tabKey: string, column: string) => void
  applyRuntimeCellSelection: (tabKey: string, rowKey: string, column: string) => void
  applyRuntimeCellRangeSelection: (tabKey: string, cellKeys: string[]) => void
  commitRuntimeCellSelection: (tabKey: string, cellKeys: string[]) => void
  setCommittedCellSelection: (tabKey: string, cellKeys: string[]) => void
  syncRuntimeSortButtons: (tabKey: string, sortState?: { column: string; direction: 'ascend' | 'descend' }) => void
  showError: (error: unknown, fallback?: string) => void
  messageApi: MessageInstance
  isSchemaScopedType: (databaseType?: ConnectionInfo['database_type']) => boolean
  tableSearchShortcut: string
}

const shouldUseVirtualTable = (tab: WorkspaceTab, rowCount: number): boolean => (
  tab.kind === 'query' && rowCount >= RESULT_TABLE_VIRTUAL_THRESHOLD
)

const ResultTablePanel = memo(function ResultTablePanel({
  tab,
  refs,
  getConnection,
  getImmediateTableSearchState,
  updateWorkspaceTab,
  updateTableSearchState,
  changeTabPage,
  changeTabLimit,
  previewTable,
  previewRedisDatabase,
  showObjectDdl,
  addPreviewRow,
  markSelectedRowsDeleted,
  submitPreviewChanges,
  addRedisRow,
  submitRedisChanges,
  toggleRedisValue,
  updateRedisEdit,
  deleteRedisRow,
  updatePreviewCell,
  updatePreviewCells,
  syncRenderedCellSelection,
  clearInlineCellEditor,
  discardInlineCellEditor,
  commitInlineCellEditor,
  openInlineCellEditor,
  scheduleRenderedCellSelectionSync,
  scheduleNativeHorizontalScrollbarSync,
  clearRuntimeColumnSelection,
  clearActiveSearchCellHighlight,
  clearAllCellSelection,
  clearSelectedRowsForTab,
  applyRuntimeColumnSelection,
  applyRuntimeCellSelection,
  applyRuntimeCellRangeSelection,
  commitRuntimeCellSelection,
  setCommittedCellSelection,
  syncRuntimeSortButtons,
  showError,
  messageApi,
  isSchemaScopedType,
  tableSearchShortcut
}: ResultTablePanelProps): ReactNode {
  const active = useWorkspaceStore((state) => state.activeTabKey === tab.key)
  const tableBodyHostRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollY, setTableScrollY] = useState(320)

  const handleBodyRef = useCallback((element: HTMLDivElement | null) => {
    tableBodyHostRef.current = element
    refs.tableBodyRefs.current[tab.key] = element
    refs.tableHeaderRefs.current[tab.key] = element?.querySelector<HTMLDivElement>('.ant-table-header') ?? null
  }, [refs, tab.key])

  useEffect(() => {
    if (!active) {
      return
    }
    const element = tableBodyHostRef.current
    if (!element) {
      return
    }
    if (tab.kind === 'query' && !tab.resultVisible) {
      return
    }
    if (tab.resultKind === 'command' || tab.resultKind === 'error') {
      return
    }

    const frameIds = new Set<number>()
    const measure = (): void => {
      const nextHeight = getResultTableScrollHeight(element)
      if (nextHeight > 0) {
        setTableScrollY((current) => current === nextHeight ? current : nextHeight)
      }
    }

    const scheduleMeasure = (depth = 1): void => {
      const frameId = window.requestAnimationFrame(() => {
        frameIds.delete(frameId)
        measure()
        if (depth > 0) {
          scheduleMeasure(depth - 1)
        }
      })
      frameIds.add(frameId)
    }

    measure()
    scheduleMeasure(2)

    const observer = new ResizeObserver(() => {
      measure()
      scheduleMeasure(1)
    })
    observer.observe(element)
    const shell = element.closest<HTMLElement>('.result-table-content')
    if (shell && shell !== element) {
      observer.observe(shell)
    }

    return () => {
      observer.disconnect()
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId))
    }
  }, [
    active,
    tab.key,
    tab.kind,
    tab.loading,
    tab.resultVisible,
    tab.resultCollapsed,
    tab.resultKind,
    tab.result?.rows.length,
    tab.result?.columns.length
  ])

  const countPendingChanges = (currentTab: WorkspaceTab): number => {
    if (currentTab.kind === 'redis-browser') {
      return countRedisPendingChanges(currentTab)
    }

    if (currentTab.kind !== 'preview') {
      return 0
    }

    return currentTab.editRows?.filter((row) => row.__state || row.__deleted).length ?? 0
  }

  const renderResultPager = (currentTab: WorkspaceTab): ReactNode => {
    const searchState = getImmediateTableSearchState(currentTab)

    return (
      <ResultPager
        tab={currentTab}
        previewDefaultLimit={PREVIEW_DEFAULT_LIMIT}
        queryDefaultLimit={QUERY_DEFAULT_LIMIT}
        searchState={searchState}
        onChangePage={(page) => void changeTabPage(currentTab, page)}
        onChangeLimit={(limit) => void changeTabLimit(currentTab, limit)}
        onToggleSearch={() => {
          if (searchState.query.trim() || searchState.visible) {
            clearActiveSearchCellHighlight(currentTab.key)
            updateTableSearchState(currentTab, {
              visible: false,
              query: '',
              filterRows: false,
              activeMatchIndex: 0
            })
            return
          }
          updateTableSearchState(currentTab, { visible: true })
        }}
      />
    )
  }

  const renderResultStatus = (currentTab: WorkspaceTab): ReactNode => (
    <ResultStatusBar
      tab={currentTab}
      connection={getConnection(currentTab.connectionId)}
      pendingChanges={countPendingChanges(currentTab)}
      pager={renderResultPager(currentTab)}
      isSchemaScopedType={isSchemaScopedType}
    />
  )

  const renderQueryExecutionStatus = (currentTab: WorkspaceTab): ReactNode => (
    <QueryExecutionStatusCard
      tab={currentTab}
      onClose={(patch) => updateWorkspaceTab(currentTab.key, patch)}
    />
  )

  const renderWhereInput = (currentTab: WorkspaceTab): ReactNode => (
    <ResultWhereInput
      tab={currentTab}
      onUpdateWhere={(nextWhere) => updateWorkspaceTab(currentTab.key, { where: nextWhere })}
      onPreviewTable={(nextTab, nextWhere) => {
        const previewObjectType = nextTab.objectType === 'view' ? 'view' : 'table'
        void previewTable(nextTab.connectionId!, nextTab.tableName!, nextTab.databaseName, nextTab.pgDatabaseName, nextTab.limit, 1, nextWhere, previewObjectType)
      }}
      onPreviewRedisDatabase={(nextTab, nextWhere) => {
        void previewRedisDatabase(nextTab.connectionId!, nextTab.databaseName!, nextTab.limit, 1, nextTab.key, nextWhere)
      }}
    />
  )

  const renderTableToolbar = (
    currentTab: WorkspaceTab,
    searchMeta: {
      matchCount: number
      resetKey: string
      focusSearchMatch: (matchIndex: number) => void
    }
  ): ReactNode => {
    const searchState = getImmediateTableSearchState(currentTab)

    return (
      <ResultTableToolbar
        tab={currentTab}
        connection={getConnection(currentTab.connectionId)}
        pendingChanges={countPendingChanges(currentTab)}
        redisPendingChanges={countRedisPendingChanges(currentTab)}
        searchState={searchState}
        searchMeta={searchMeta}
        whereInput={renderWhereInput(currentTab)}
        onToggleSearch={() => {
          if (searchState.query.trim() || searchState.visible) {
            clearActiveSearchCellHighlight(currentTab.key)
            updateTableSearchState(currentTab, {
              visible: false,
              query: '',
              filterRows: false,
              activeMatchIndex: 0
            })
            return
          }
          updateTableSearchState(currentTab, { visible: true })
        }}
        onSearchStateChange={(patch) => updateTableSearchState(currentTab, patch)}
        onClearActiveHighlight={() => clearActiveSearchCellHighlight(currentTab.key)}
        onShowObjectDdl={(nextTab) => void showObjectDdl(nextTab.connectionId!, nextTab.tableName!, nextTab.objectType ?? 'table', nextTab.databaseName, nextTab.pgDatabaseName)}
        onPreviewTableRefresh={(nextTab) => void previewTable(nextTab.connectionId!, nextTab.tableName!, nextTab.databaseName, nextTab.pgDatabaseName, nextTab.limit, nextTab.page, nextTab.where)}
        onPreviewRedisRefresh={(nextTab) => void previewRedisDatabase(nextTab.connectionId!, nextTab.databaseName!, nextTab.limit, nextTab.page, nextTab.key, nextTab.where)}
        onAddPreviewRow={addPreviewRow}
        onMarkSelectedRowsDeleted={markSelectedRowsDeleted}
        onSubmitPreviewChanges={(nextTab) => void submitPreviewChanges(nextTab)}
        onAddRedisRow={addRedisRow}
        onSubmitRedisChanges={(nextTab) => void submitRedisChanges(nextTab)}
        onBeforePreviewRefresh={(tabKey) => {
          refs.suppressInlineEditorCommitRefs.current[tabKey] = true
        }}
        onDiscardInlineEditor={discardInlineCellEditor}
      />
    )
  }

  const renderRedisBrowser = (currentTab: WorkspaceTab): ReactNode => (
    <RedisBrowserPanel
      tab={currentTab}
      rows={currentTab.result?.rows ?? []}
      edits={currentTab.redisEdits ?? {}}
      statusBar={renderResultStatus(currentTab)}
      toolbar={renderTableToolbar(currentTab, {
        matchCount: 0,
        resetKey: '',
        focusSearchMatch: () => undefined
      })}
      onCloseError={(tabKey) => updateWorkspaceTab(tabKey, { error: undefined })}
      onToggleRedisValue={toggleRedisValue}
      onUpdateRedisEdit={updateRedisEdit}
      onDeleteRedisRow={deleteRedisRow}
      redisTtlDisplay={redisTtlDisplay}
    />
  )

  const searchState = getImmediateTableSearchState(tab)
  const supportsCellSelection = tab.kind === 'preview' || tab.kind === 'query' || tab.kind === 'table-list'
  const supportsTableSearch = tab.kind === 'preview' || tab.kind === 'query' || tab.kind === 'redis-browser'

  useEffect(() => {
    if (!active || !supportsTableSearch) {
      return
    }

    const normalizedShortcut = normalizeShortcutText(tableSearchShortcut)
    if (!normalizedShortcut) {
      return
    }

    const matchesShortcut = (event: KeyboardEvent): boolean => {
      const parts: string[] = []
      if (event.ctrlKey || event.metaKey) parts.push('ctrl')
      if (event.altKey) parts.push('alt')
      if (event.shiftKey) parts.push('shift')

      let key = event.key
      if (key === ' ') {
        key = 'space'
      } else if (key.length === 1) {
        key = key.toLowerCase()
      } else {
        key = key.toLowerCase()
      }

      if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
        parts.push(key)
      }

      return normalizeShortcutText(parts.join('+')) === normalizedShortcut
    }

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (!matchesShortcut(event)) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"], .monaco-editor, .ai-panel-shell')) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (searchState.query.trim() || searchState.visible) {
        return
      }

      updateTableSearchState(tab, { visible: true })
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true)
    }
  }, [active, searchState.query, searchState.visible, supportsTableSearch, tab, tableSearchShortcut, updateTableSearchState])
  const supportsWritableCells = tab.kind === 'preview'
  const connection = getConnection(tab.connectionId)
  const derivedState = useMemo(() => buildResultTableDerivedState({
    tab,
    searchState,
    previewDefaultLimit: PREVIEW_DEFAULT_LIMIT,
    queryDefaultLimit: QUERY_DEFAULT_LIMIT,
    formatCellText: cellDisplayText
  }), [
    tab,
    searchState,
    tab.result,
    tab.editRows,
    tab.selectedRowKeys,
    tab.selectedRowKeyMap,
    tab.columnOrder,
    tab.columnWidths,
    tab.columnFilters,
    tab.page,
    tab.limit
  ])
  const {
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
  } = derivedState
  const highlightedCellHtmlCache = useMemo(() => new Map<string, string | null>(), [
    tab.key,
    searchState.query,
    searchState.caseSensitive,
    searchState.regex,
    searchState.wholeWord,
    searchState.filterRows,
    tableRows,
    orderedColumns
  ])
  const highlightResultText = (cellKey: string, text: string, className?: string): ReactNode => (
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
      refs.rowDragAnchorRefs.current[tab.key] = undefined
      refs.cellDragAnchorRefs.current[tab.key] = undefined
      refs.pendingCellDragTargetRefs.current[tab.key] = undefined
      setCommittedCellSelection(tab.key, [match.cellKey])
    }
    requestAnimationFrame(() => {
      const container = refs.tableBodyRefs.current[tab.key]
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
    const runtime = refs.runtimeSelectedCellRefs.current[tab.key] ?? []
    if (runtime.length > 0) {
      return runtime
    }
    return refs.selectedCellRefs.current[tab.key] ?? []
  }

  const getSelectedRowKeysForClipboard = (): string[] => {
    const renderedRows = refs.renderedSelectedRowRefs.current[tab.key]
    if (renderedRows && renderedRows.length > 0) {
      return renderedRows.filter((rowKey) => orderedRowKeys.includes(rowKey))
    }
    const draftRows = refs.rowSelectionDraftRefs.current[tab.key]
    if (draftRows && draftRows.length > 0) {
      return draftRows.map(String).filter((rowKey) => orderedRowKeys.includes(rowKey))
    }
    return (tab.selectedRowKeys ?? []).map(String).filter((rowKey) => orderedRowKeys.includes(rowKey))
  }

  const getClipboardSelectionCellKeys = (): string[] => {
    const selectedRows = getSelectedRowKeysForClipboard()
    if (selectedRows.length > 0) {
      return selectedRows.flatMap((rowKey) => orderedColumns.map((column) => `${rowKey}:${column}`))
    }
    const selectedColumn = refs.selectedColumnRefs.current[tab.key]
    if (selectedColumn && orderedColumns.includes(selectedColumn)) {
      return orderedRowKeys.map((rowKey) => `${rowKey}:${selectedColumn}`)
    }
    return getCommittedCellSelection()
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

  const getActiveCellSelection = (): string[] => {
    const runtimeSelection = refs.runtimeSelectedCellRefs.current[tab.key] ?? []
    if (runtimeSelection.length > 0) {
      return normalizeCellSelectionKeys(runtimeSelection)
    }
    const committedSelection = getCommittedCellSelection()
    if (committedSelection.length > 0) {
      return normalizeCellSelectionKeys(committedSelection)
    }
    return normalizeCellSelectionKeys(Array.from(
      refs.tableBodyRefs.current[tab.key]?.querySelectorAll<HTMLElement>('.editable-cell.cell-selected-runtime[data-cell-key]') ?? []
    ).map((element) => element.dataset.cellKey).filter((cellKey): cellKey is string => Boolean(cellKey)))
  }

  const getRenderedCellSelection = (): string[] => normalizeCellSelectionKeys(Array.from(
    refs.tableBodyRefs.current[tab.key]?.querySelectorAll<HTMLElement>('.editable-cell.cell-selected-runtime[data-cell-key]') ?? []
  ).map((element) => element.dataset.cellKey).filter((cellKey): cellKey is string => Boolean(cellKey)))

  const getBestAvailableSelection = (cellKey: string): string[] => {
    const candidates = [
      refs.contextMenuCellSelectionRefs.current[tab.key] ?? [],
      getRenderedCellSelection(),
      refs.committedSelectedCellRangeRefs.current[tab.key] ?? [],
      getActiveCellSelection(),
      refs.selectedCellRefs.current[tab.key] ?? []
    ]
      .map((selection) => normalizeCellSelectionKeys(selection))
      .filter((selection, index, allSelections) => (
        selection.length > 0
        && allSelections.findIndex((candidate) => candidate.length === selection.length && candidate.every((key, keyIndex) => key === selection[keyIndex])) === index
      ))
      .sort((left, right) => right.length - left.length)

    const matchingSelection = candidates.find((selection) => selection.includes(cellKey))
    if (matchingSelection) {
      return matchingSelection
    }
    return candidates[0] ?? []
  }

  const ensureContextSelection = (cellKey: string): string[] => {
    const parsedCell = parseCellKey(cellKey)
    if (parsedCell) {
      if (selectedRowKeysSet.has(parsedCell.rowKey)) {
        const activeRowKeys = (refs.rowSelectionDraftRefs.current[tab.key] ?? tab.selectedRowKeys ?? [])
          .map((key) => String(key))
          .filter((rowKey) => orderedRowKeys.includes(rowKey))
        const rowKeys = activeRowKeys.length > 0 ? activeRowKeys : [parsedCell.rowKey]
        return rowKeys.flatMap((rowKey) => orderedColumns.map((column) => `${rowKey}:${column}`))
      }
      const selectedColumn = refs.selectedColumnRefs.current[tab.key]
      if (selectedColumn && selectedColumn === parsedCell.column) {
        return orderedRowKeys.map((rowKey) => `${rowKey}:${parsedCell.column}`)
      }
    }
    const currentSelection = getBestAvailableSelection(cellKey)
    if (currentSelection.includes(cellKey)) {
      refs.contextMenuCellSelectionRefs.current[tab.key] = currentSelection
      return currentSelection
    }
    clearSelectedRowsForTab(tab.key)
    clearRuntimeColumnSelection(tab.key)
    refs.rowDragAnchorRefs.current[tab.key] = undefined
    refs.cellDragAnchorRefs.current[tab.key] = undefined
    refs.pendingCellDragTargetRefs.current[tab.key] = undefined
    if (refs.pendingCellDragFrameRefs.current[tab.key]) {
      window.cancelAnimationFrame(refs.pendingCellDragFrameRefs.current[tab.key]!)
      refs.pendingCellDragFrameRefs.current[tab.key] = undefined
    }
    const nextSelection = [cellKey]
    setCommittedCellSelection(tab.key, nextSelection)
    refs.contextMenuCellSelectionRefs.current[tab.key] = nextSelection
    return nextSelection
  }

  const resolveContextSelection = (cellKey: string): string[] => {
    const currentSelection = getBestAvailableSelection(cellKey)
    if (currentSelection.includes(cellKey)) {
      return currentSelection
    }
    return ensureContextSelection(cellKey)
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
    refs.cellClipboardRef.current = { text, values }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      showError('复制单元格内容失败')
    }
  }

  const copySelectedCells = async (cellKeys = getClipboardSelectionCellKeys()): Promise<void> => {
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
    refs.cellClipboardRef.current = { text: sql, values: getCellSelectionMatrix(cellKeys) }
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
    refs.cellClipboardRef.current = { text: markdown, values: getCellSelectionMatrix(cellKeys) }
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
      clipboardText = refs.cellClipboardRef.current?.text ?? ''
    }
    if (!clipboardText && !refs.cellClipboardRef.current) {
      return
    }

    const normalizedText = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
    const cachedText = refs.cellClipboardRef.current?.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
    const values = normalizedText && cachedText === normalizedText
      ? (refs.cellClipboardRef.current?.values ?? parseClipboardText(clipboardText))
      : parseClipboardText(clipboardText || refs.cellClipboardRef.current?.text || '')
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
    const snapshot = refs.contextMenuCellSelectionSnapshotRefs.current[tab.key]
    const selection = snapshot?.cellKeys.includes(cellKey)
      ? snapshot.cellKeys
      : resolveContextSelection(cellKey)
    if (actionKey === 'copy-selection') {
      void copySelectedCells(selection)
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      return
    }
    if (actionKey === 'copy-as-insert') {
      void copySelectionAsInsert(selection)
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      return
    }
    if (actionKey === 'copy-as-md') {
      void copySelectionAsMarkdown(selection)
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      return
    }
    if (actionKey === 'inspect-record' || actionKey === 'inspect-value' || actionKey === 'inspect-aggregate') {
      const view: CellInspectorView = actionKey === 'inspect-record' ? 'record' : actionKey === 'inspect-value' ? 'value' : 'aggregate'
      setCommittedCellSelection(tab.key, selection)
      refs.cellInspectorPanelRefs.current[tab.key]?.open(view, selection)
      refs.contextMenuCellSelectionRefs.current[tab.key] = undefined
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      return
    }
    if (!supportsWritableCells) {
      refs.contextMenuCellSelectionRefs.current[tab.key] = undefined
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      return
    }
    if (actionKey === 'set-null') {
      clearInlineCellEditor(tab.key)
      updatePreviewCells(tab.key, getSelectedCellPatchesForValue(null, selection))
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      return
    }
    if (actionKey === 'set-default') {
      clearInlineCellEditor(tab.key)
      updatePreviewCells(tab.key, getSelectedCellPatchesForValue(createDefaultValueMarker(), selection))
    }
    refs.contextMenuCellSelectionRefs.current[tab.key] = undefined
    refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
  }

  const isEditableTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null
    return Boolean(
      element?.closest('input, textarea, [contenteditable="true"], .monaco-editor, .editable-cell-dom-input')
    )
  }

  const applySelectedRows = (nextSelectedRowKeys: Key[]): void => {
    const nextSelectedRowKeyMap = Object.fromEntries(nextSelectedRowKeys.map((key) => [String(key), true as const]))
    const currentSelected = JSON.stringify((tab.selectedRowKeys ?? []).map(String))
    const nextSelected = JSON.stringify(nextSelectedRowKeys.map(String))
    if (currentSelected === nextSelected) {
      return
    }
    startTransition(() => {
      updateWorkspaceTab(tab.key, {
        selectedRowKeys: nextSelectedRowKeys,
        selectedRowKeyMap: nextSelectedRowKeyMap
      })
    })
  }

  const updateRenderedSelectedRows = (nextSelectedRowKeys: Key[]): void => {
    const container = refs.tableBodyRefs.current[tab.key]
    if (!container) {
      return
    }
    const nextRowKeys = nextSelectedRowKeys.map(String)
    const nextRowKeySet = new Set(nextRowKeys)
    const previousRowKeys = refs.renderedSelectedRowRefs.current[tab.key] ?? []
    for (const rowKey of previousRowKeys) {
      if (!nextRowKeySet.has(rowKey)) {
        container.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(rowKey)}"], .ant-table-row[data-row-key="${CSS.escape(rowKey)}"]`)?.classList.remove('row-selected')
      }
    }
    for (const rowKey of nextRowKeys) {
      if (!previousRowKeys.includes(rowKey)) {
        container.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(rowKey)}"], .ant-table-row[data-row-key="${CSS.escape(rowKey)}"]`)?.classList.add('row-selected')
      }
    }
    refs.renderedSelectedRowRefs.current[tab.key] = nextRowKeys.length > 0 ? nextRowKeys : undefined
  }

  const previewSelectedRows = (nextSelectedRowKeys: Key[]): void => {
    refs.rowSelectionDraftRefs.current[tab.key] = nextSelectedRowKeys
    updateRenderedSelectedRows(nextSelectedRowKeys)
  }

  const commitPreviewSelectedRows = (): void => {
    const draft = refs.rowSelectionDraftRefs.current[tab.key]
    if (!draft) {
      return
    }
    refs.rowSelectionDraftRefs.current[tab.key] = undefined
    applySelectedRows(draft)
  }

  const clearSelectedRows = (): void => {
    if (!tab.selectedRowKeys?.length && !refs.rowSelectionDraftRefs.current[tab.key]?.length) {
      return
    }
    previewSelectedRows([])
    refs.rowSelectionDraftRefs.current[tab.key] = undefined
    applySelectedRows([])
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
    const anchor = refs.rowDragAnchorRefs.current[tab.key]
    if (!anchor) {
      return
    }
    const pendingTarget = refs.pendingRowDragTargetRefs.current[tab.key]
    if (pendingTarget === rowKey) {
      return
    }
    refs.pendingRowDragTargetRefs.current[tab.key] = rowKey
    if (refs.pendingRowDragFrameRefs.current[tab.key]) {
      return
    }
    refs.pendingRowDragFrameRefs.current[tab.key] = window.requestAnimationFrame(() => {
      refs.pendingRowDragFrameRefs.current[tab.key] = undefined
      const latestAnchor = refs.rowDragAnchorRefs.current[tab.key]
      const latestTarget = refs.pendingRowDragTargetRefs.current[tab.key]
      if (!latestAnchor || !latestTarget) {
        return
      }
      refs.pendingRowDragTargetRefs.current[tab.key] = undefined
      const start = orderedRowIndexMap[latestAnchor]
      const end = orderedRowIndexMap[latestTarget]
      if (start === undefined || end === undefined) {
        return
      }
      const nextSelected = orderedRowKeys.slice(Math.min(start, end), Math.max(start, end) + 1)
      const currentDraft = refs.rowSelectionDraftRefs.current[tab.key]
      if (currentDraft && currentDraft.length === nextSelected.length && currentDraft.every((key, index) => String(key) === String(nextSelected[index]))) {
        return
      }
      previewSelectedRows(nextSelected)
    })
  }

  const updateDragCellSelection = (rowKey: string, column: string): void => {
    const anchor = refs.cellDragAnchorRefs.current[tab.key]
    if (!anchor) {
      return
    }
    const pendingTarget = refs.pendingCellDragTargetRefs.current[tab.key]
    if (pendingTarget?.rowKey === rowKey && pendingTarget.column === column) {
      return
    }
    refs.pendingCellDragTargetRefs.current[tab.key] = { rowKey, column }
    if (refs.pendingCellDragFrameRefs.current[tab.key]) {
      return
    }
    refs.pendingCellDragFrameRefs.current[tab.key] = window.requestAnimationFrame(() => {
      refs.pendingCellDragFrameRefs.current[tab.key] = undefined
      const latestAnchor = refs.cellDragAnchorRefs.current[tab.key]
      const latestTarget = refs.pendingCellDragTargetRefs.current[tab.key]
      if (!latestAnchor || !latestTarget) {
        return
      }
      refs.pendingCellDragTargetRefs.current[tab.key] = undefined
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
      const committedCellKeys = refs.selectedCellRefs.current[tab.key] ?? []
      const runtimeCellKeys = refs.runtimeSelectedCellRefs.current[tab.key] ?? committedCellKeys
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

  const renderEditableCell = (
    currentTabKey: string,
    rowKey: string,
    column: string,
    value: unknown,
    editable: boolean,
    onCellDragEnter: () => void,
    contextMenuItems: MenuProps['items'],
    onContextMenuAction: (key: string, cellKey: string) => void,
    onContextSelection: (cellKey: string) => string[],
    displayContent?: ReactNode
  ): ReactNode => (
    <ResultEditableCellProxy
      tabKey={currentTabKey}
      rowKey={rowKey}
      column={column}
      value={value}
      editable={editable}
      onCellDragEnter={onCellDragEnter}
      contextMenuItems={contextMenuItems}
      onContextMenuAction={onContextMenuAction}
      onSyncRenderedSelection={syncRenderedCellSelection}
      onPrepareContextSelection={(nextTabKey, cellKey) => {
        refs.tableBodyRefs.current[nextTabKey]?.focus()
        refs.rowDragAnchorRefs.current[nextTabKey] = undefined
        refs.cellDragAnchorRefs.current[nextTabKey] = undefined
        refs.pendingCellDragTargetRefs.current[nextTabKey] = undefined
        const contextSelection = normalizeCellSelectionKeys(onContextSelection(cellKey))
        refs.contextMenuCellSelectionRefs.current[nextTabKey] = [...contextSelection]
        refs.contextMenuCellSelectionSnapshotRefs.current[nextTabKey] = {
          anchorCellKey: cellKey,
          cellKeys: [...contextSelection]
        }
        refs.runtimeSelectedCellRefs.current[nextTabKey] = contextSelection.length > 1 ? [...contextSelection] : undefined
      }}
      onStartCellSelection={(nextTabKey, nextRowKey, nextColumn) => {
        if (refs.inlineCellEditorRefs.current[nextTabKey]) {
          return
        }
        refs.tableBodyRefs.current[nextTabKey]?.focus()
        clearSelectedRowsForTab(nextTabKey)
        refs.cellDragAnchorRefs.current[nextTabKey] = { rowKey: nextRowKey, column: nextColumn }
        applyRuntimeCellSelection(nextTabKey, nextRowKey, nextColumn)
        clearRuntimeColumnSelection(nextTabKey)
      }}
      onOpenEditor={(nextTabKey, nextRowKey, nextColumn, host, rawValue) => {
        refs.rowDragAnchorRefs.current[nextTabKey] = undefined
        refs.cellDragAnchorRefs.current[nextTabKey] = undefined
        refs.pendingCellDragTargetRefs.current[nextTabKey] = undefined
        refs.runtimeSelectedCellRefs.current[nextTabKey] = undefined
        openInlineCellEditor(nextTabKey, nextRowKey, nextColumn, host, rawValue)
      }}
      onFinishCellSelection={(nextTabKey) => {
        if (refs.editingCellRefs.current[nextTabKey]?.rowKey === rowKey && refs.editingCellRefs.current[nextTabKey]?.column === column) {
          return
        }
        refs.rowDragAnchorRefs.current[nextTabKey] = undefined
        refs.cellDragAnchorRefs.current[nextTabKey] = undefined
        if (refs.pendingCellDragFrameRefs.current[nextTabKey]) {
          window.cancelAnimationFrame(refs.pendingCellDragFrameRefs.current[nextTabKey]!)
          refs.pendingCellDragFrameRefs.current[nextTabKey] = undefined
        }
        refs.pendingCellDragTargetRefs.current[nextTabKey] = undefined
        commitRuntimeCellSelection(nextTabKey, refs.runtimeSelectedCellRefs.current[nextTabKey] ?? [])
      }}
      displayContent={displayContent ?? cellDisplayText(value)}
    />
  )

  const renderColumnTitle = (column: string): ReactNode => {
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
              clearSelectedRowsForTab(tab.key)
              applyRuntimeColumnSelection(tab.key, column)
              clearAllCellSelection(tab.key)
              if (refs.editingCellRefs.current[tab.key]) {
                refs.editingCellRefs.current[tab.key] = undefined
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
          <span
            className="column-resize-handle"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const currentWidth = columnWidths[column] ?? DEFAULT_RESULT_COLUMN_WIDTH
              const columnIndex = orderedColumns.indexOf(column) + (supportsCellSelection ? 1 : 0)
              const header = refs.tableHeaderRefs.current[tab.key]
              const body = refs.tableBodyRefs.current[tab.key]
              const headerCells = header
                ? Array.from(header.querySelectorAll<HTMLElement>(`[data-column-button="${CSS.escape(column)}"]`))
                  .map((button) => button.closest('th') as HTMLElement | null)
                  .filter((cell): cell is HTMLElement => Boolean(cell))
                : []
              const headerColElements = header
                ? Array.from(header.querySelectorAll<HTMLTableColElement>('table > colgroup > col'))
                : []
              const bodyColElements = body
                ? Array.from(body.querySelectorAll<HTMLTableColElement>('.ant-table-body > table > colgroup > col, .ant-table-tbody-virtual table > colgroup > col, .ant-table-tbody-virtual-holder table > colgroup > col'))
                : []
              const enableVirtualTable = shouldUseVirtualTable(tab, tableRows.length)
              const virtualCells = enableVirtualTable && body
                ? Array.from(body.querySelectorAll<HTMLElement>(`.ant-table-tbody-virtual [data-column-key="${CSS.escape(column)}"]`))
                : []
              refs.columnResizeRefs.current[`${tab.key}:${column}`] = {
                tabKey: tab.key,
                column,
                columnIndex,
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: currentWidth,
                lastWidth: currentWidth,
                headerCells,
                headerColElements,
                bodyColElements,
                virtual: enableVirtualTable,
                virtualCells
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              event.currentTarget.setPointerCapture(event.pointerId)
              document.body.classList.add('column-resizing')
            }}
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
    onCell: (row: EditableRow) => ({
      'data-row-key': row.__rowKey
    } as TdHTMLAttributes<HTMLElement>),
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
            clearRuntimeColumnSelection(tab.key)
            clearAllCellSelection(tab.key)
            if (event.ctrlKey || event.metaKey) {
              refs.rowDragAnchorRefs.current[tab.key] = undefined
              const currentSelection = new Set((refs.rowSelectionDraftRefs.current[tab.key] ?? tab.selectedRowKeys ?? []).map(String))
              if (currentSelection.has(row.__rowKey)) {
                currentSelection.delete(row.__rowKey)
              } else {
                currentSelection.add(row.__rowKey)
              }
              const nextSelected = orderedRowKeys.filter((key) => currentSelection.has(key))
              previewSelectedRows(nextSelected)
              applySelectedRows(nextSelected)
              return
            }
            refs.rowDragAnchorRefs.current[tab.key] = row.__rowKey
            previewSelectedRows([row.__rowKey])
          }}
          onMouseEnter={() => updateDragRowSelection(row.__rowKey)}
        >
          {rowNumberOffset + index + 1}
        </button>
      )
    }
  }

  const dataColumns: ColumnsType<EditableRow> = orderedColumns.map((column) => ({
    title: renderColumnTitle(column),
    dataIndex: column,
    key: column,
    width: columnWidths[column] ?? DEFAULT_RESULT_COLUMN_WIDTH,
    ellipsis: true,
    onCell: (row: EditableRow) => ({
      'data-column-key': column,
      'data-row-key': row.__rowKey,
      'data-cell-key': `${row.__rowKey}:${column}`
    } as TdHTMLAttributes<HTMLElement>),
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
  }))

  const tableColumns: ColumnsType<EditableRow> = supportsCellSelection ? [rowNumberColumn, ...dataColumns] : dataColumns
  const tableScrollX = Math.max(
    orderedColumns.reduce((total, column) => total + (columnWidths[column] ?? DEFAULT_RESULT_COLUMN_WIDTH), supportsCellSelection ? 34 : 0),
    720
  )
  const enableVirtualTable = shouldUseVirtualTable(tab, tableRows.length)
  const searchSignature = `${searchState.query}\u0000${searchState.caseSensitive ? 1 : 0}\u0000${searchState.regex ? 1 : 0}\u0000${searchState.wholeWord ? 1 : 0}\u0000${searchState.filterRows ? 1 : 0}`

  const showQueryEmptyState = tab.kind === 'query' && !tab.resultVisible

  if (tab.kind === 'redis-browser') {
    return renderRedisBrowser(tab)
  }

  if (showQueryEmptyState) {
    return (
      <div className="query-result-empty">
        <Typography.Text type="secondary">?? SQL ???????????????</Typography.Text>
      </div>
    )
  }

  return (
    <div className={`result-table-shell${tab.kind === 'query' ? ' query-result-table-shell' : ''}`}>
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
          <div className={`result-table-content${tab.kind === 'query' ? ' query-result-table-content' : ''}`}>
            {active && tab.loading && (
              <div className="result-table-loading-overlay">
                <Spin size="large" />
              </div>
            )}
            <ResultTableBodyView
              tab={tab}
              searchSignature={searchSignature}
              selectedRowKeyMap={selectedRowKeyMap}
              tableColumns={tableColumns}
              tableRows={tableRows}
              tableScrollX={tableScrollX}
              tableScrollY={tableScrollY}
              virtual={enableVirtualTable}
              setTableRef={(instance) => {
                refs.tableComponentRefs.current[tab.key] = instance
              }}
              setBodyRef={handleBodyRef}
              setHeaderRef={(element) => { refs.tableHeaderRefs.current[tab.key] = element }}
              onScrollCapture={() => scheduleRenderedCellSelectionSync(tab.key)}
              onKeyDown={(event) => {
                if (!supportsCellSelection || isEditableTarget(event.target)) {
                  return
                }
                if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'c') {
                  const selection = getClipboardSelectionCellKeys()
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
                if (event.button !== 0) {
                  return
                }
                const target = event.target as HTMLElement
                const activeInlineEditor = refs.inlineCellEditorRefs.current[tab.key]
                if (activeInlineEditor && !target.closest('.editable-cell-dom-input')) {
                  commitInlineCellEditor(tab.key)
                }
                refs.scrollbarDragRefs.current[tab.key] = undefined
                if (!target.closest('.row-number-button') && (tab.selectedRowKeys?.length || refs.rowSelectionDraftRefs.current[tab.key]?.length)) {
                  clearSelectedRows()
                }
                if (!target.closest('.column-header-content') && refs.selectedColumnRefs.current[tab.key]) {
                  clearRuntimeColumnSelection(tab.key)
                }
                if (!target.closest('[data-cell-key]') && (refs.selectedCellRefs.current[tab.key]?.length || refs.runtimeSelectedCellRefs.current[tab.key]?.length)) {
                  clearActiveSearchCellHighlight(tab.key)
                  clearAllCellSelection(tab.key)
                }
              }}
              onMouseUp={(event) => {
                if (event.button !== 0) {
                  return
                }
                if (refs.scrollbarDragRefs.current[tab.key]) {
                  refs.scrollbarDragRefs.current[tab.key] = undefined
                  return
                }
                if (refs.editingCellRefs.current[tab.key]) {
                  refs.rowDragAnchorRefs.current[tab.key] = undefined
                  refs.cellDragAnchorRefs.current[tab.key] = undefined
                  refs.pendingCellDragTargetRefs.current[tab.key] = undefined
                  refs.pendingRowDragTargetRefs.current[tab.key] = undefined
                  return
                }
                refs.rowDragAnchorRefs.current[tab.key] = undefined
                refs.cellDragAnchorRefs.current[tab.key] = undefined
                refs.pendingRowDragTargetRefs.current[tab.key] = undefined
                if (refs.pendingCellDragFrameRefs.current[tab.key]) {
                  window.cancelAnimationFrame(refs.pendingCellDragFrameRefs.current[tab.key]!)
                  refs.pendingCellDragFrameRefs.current[tab.key] = undefined
                }
                if (refs.pendingRowDragFrameRefs.current[tab.key]) {
                  window.cancelAnimationFrame(refs.pendingRowDragFrameRefs.current[tab.key]!)
                  refs.pendingRowDragFrameRefs.current[tab.key] = undefined
                }
                refs.pendingCellDragTargetRefs.current[tab.key] = undefined
                commitRuntimeCellSelection(tab.key, refs.runtimeSelectedCellRefs.current[tab.key] ?? [])
                commitPreviewSelectedRows()
              }}
              onMouseLeave={() => {
                if (refs.scrollbarDragRefs.current[tab.key]) {
                  return
                }
                if (!refs.cellDragAnchorRefs.current[tab.key] && !refs.rowDragAnchorRefs.current[tab.key]) {
                  return
                }
                refs.rowDragAnchorRefs.current[tab.key] = undefined
                refs.cellDragAnchorRefs.current[tab.key] = undefined
                refs.pendingRowDragTargetRefs.current[tab.key] = undefined
                if (refs.pendingCellDragFrameRefs.current[tab.key]) {
                  window.cancelAnimationFrame(refs.pendingCellDragFrameRefs.current[tab.key]!)
                  refs.pendingCellDragFrameRefs.current[tab.key] = undefined
                }
                if (refs.pendingRowDragFrameRefs.current[tab.key]) {
                  window.cancelAnimationFrame(refs.pendingRowDragFrameRefs.current[tab.key]!)
                  refs.pendingRowDragFrameRefs.current[tab.key] = undefined
                }
                refs.pendingCellDragTargetRefs.current[tab.key] = undefined
                commitRuntimeCellSelection(tab.key, refs.runtimeSelectedCellRefs.current[tab.key] ?? [])
                commitPreviewSelectedRows()
              }}
            />
            <CellInspectorPanel
              ref={(instance) => { refs.cellInspectorPanelRefs.current[tab.key] = instance }}
              tabKey={tab.key}
              orderedColumns={orderedColumns}
              rowByKey={rowByKey}
              columnInfoMap={tab.columnInfoMap}
              editable={supportsWritableCells && tab.kind === 'preview'}
              onUpdateValue={(rowKey, column, rawValue) => updatePreviewCell(tab.key, rowKey, column, editableValue(rawValue))}
            />
            {active && enableVirtualTable && (
              <div
                ref={(element) => {
                  refs.tableNativeHorizontalScrollbarRefs.current[tab.key] = element
                  if (element) {
                    window.setTimeout(() => {
                      scheduleNativeHorizontalScrollbarSync(tab.key)
                    }, 0)
                  }
                }}
                className="result-table-native-horizontal-scrollbar"
              >
                <div style={{ width: tableScrollX, height: 10 }} />
              </div>
            )}
          </div>
        )}
    </div>
  )
}, (prev, next) => (
  prev.tab === next.tab
  && prev.refs === next.refs
  && prev.getConnection === next.getConnection
  && prev.getImmediateTableSearchState === next.getImmediateTableSearchState
  && prev.updateWorkspaceTab === next.updateWorkspaceTab
  && prev.updateTableSearchState === next.updateTableSearchState
  && prev.changeTabPage === next.changeTabPage
  && prev.changeTabLimit === next.changeTabLimit
  && prev.previewTable === next.previewTable
  && prev.previewRedisDatabase === next.previewRedisDatabase
  && prev.showObjectDdl === next.showObjectDdl
  && prev.messageApi === next.messageApi
  && prev.isSchemaScopedType === next.isSchemaScopedType
  && prev.tableSearchShortcut === next.tableSearchShortcut
))

type ResultEditableCellProxyProps = ComponentProps<typeof ResultEditableCell>

const ResultEditableCellProxy = (props: ResultEditableCellProxyProps): ReactNode => {
  return <ResultEditableCell {...props} />
}

export default ResultTablePanel
