import { UnorderedListOutlined } from '@ant-design/icons'
import { Alert, Dropdown, Flex, Menu, Spin, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { MessageInstance } from 'antd/es/message/interface'
import type { ColumnsType, TableRef } from 'antd/es/table'
import { createPortal } from 'react-dom'
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  ComponentProps,
  CSSProperties,
  Key,
  MutableRefObject,
  ReactNode,
  TdHTMLAttributes
} from 'react'
import type { ConnectionInfo } from './connection-model'
import {
  countRedisPendingChanges,
  createDefaultValueMarker,
  editableValue,
  isDefaultValueMarker,
  normalizeShortcutText,
  PREVIEW_DEFAULT_LIMIT,
  QUERY_DEFAULT_LIMIT,
  redisTtlDisplay,
  cellDisplayText,
  isCellValueEqual
} from './app-shared'
import type {
  CellInspectorView,
  EditableRow,
  RedisKeyEdit,
  TableSearchUiState,
  WorkspaceTab
} from './workspace-model'
import type { DbObjectType } from './tree-model'
import { buildResultTableDerivedState } from './result-table-state'
import {
  QueryExecutionStatusCard,
  MultiStatementExecutionCard,
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
import { DEFAULT_RESULT_COLUMN_WIDTH, normalizeCellSelectionKeys } from './query-utils'
import { useWorkspaceStore } from './workspace-store'

export type HorizontalScrollTableRef = TableRef & {
  scrollTo?: (config: { left?: number }) => void
}

type InlineCellEditorState = {
  rowKey: string
  column: string
  input: HTMLInputElement
  host: HTMLElement
  originalValue: unknown
  initialInputValue: string
  batchCells?: Array<{ rowKey: string; column: string }>
  batchHosts?: HTMLElement[]
  batchOriginalValues?: Array<{ rowKey: string; column: string; value: unknown }>
}

type ColumnResizeState = {
  tabKey: string
  column: string
  columnIndex: number
  pointerId: number
  startX: number
  startWidth: number
  startTableWidth: number
  lastWidth: number
  tableWidthHost?: HTMLElement
  headerCells: HTMLElement[]
  headerColElements: HTMLTableColElement[]
  bodyColElements: HTMLTableColElement[]
  virtual: boolean
  virtualCells?: HTMLElement[]
  pendingWidth?: number
  frameId?: number
}

type CellContextMenuState = {
  cellKey: string
  x: number
  y: number
  selection: string[]
}

const RESULT_CELL_CONTEXT_MENU_SELECTOR =
  '.result-cell-context-menu-panel, .result-cell-context-menu-backdrop'

export type ResultTablePanelRefs = {
  tableComponentRefs: MutableRefObject<Record<string, HorizontalScrollTableRef | null>>
  tableBodyRefs: MutableRefObject<Record<string, HTMLDivElement | null>>
  tableHeaderRefs: MutableRefObject<Record<string, HTMLDivElement | null>>
  pendingPreviewRowScrollRefs: MutableRefObject<Record<string, string | undefined>>
  tableScrollTopRefs: MutableRefObject<Record<string, number | undefined>>
  tableScrollLeftRefs: MutableRefObject<Record<string, number | undefined>>
  tableScrollRestoreLocks: MutableRefObject<Record<string, number | undefined>>
  selectedColumnRefs: MutableRefObject<Record<string, string | undefined>>
  selectedCellRefs: MutableRefObject<Record<string, string[] | undefined>>
  selectedRowRefs: MutableRefObject<Record<string, string[] | undefined>>
  renderedSelectedRowRefs: MutableRefObject<Record<string, string[] | undefined>>
  runtimeSelectedCellRefs: MutableRefObject<Record<string, string[] | undefined>>
  cellDragAnchorRefs: MutableRefObject<
    Record<string, { rowKey: string; column: string } | undefined>
  >
  scrollbarDragRefs: MutableRefObject<Record<string, boolean | undefined>>
  pendingCellDragTargetRefs: MutableRefObject<
    Record<string, { rowKey: string; column: string } | undefined>
  >
  pendingCellDragFrameRefs: MutableRefObject<Record<string, number | undefined>>
  pendingRowDragTargetRefs: MutableRefObject<Record<string, string | undefined>>
  pendingRowDragFrameRefs: MutableRefObject<Record<string, number | undefined>>
  suppressNextShellClickClearRefs: MutableRefObject<Record<string, boolean | undefined>>
  suppressNextCellMouseDownRefs: MutableRefObject<Record<string, string | undefined>>
  contextMenuSelectionLockRefs: MutableRefObject<Record<string, boolean | undefined>>
  committingEditingCellRefs: MutableRefObject<Record<string, boolean | undefined>>
  editingCellRefs: MutableRefObject<Record<string, { rowKey: string; column: string } | undefined>>
  suppressInlineEditorCommitRefs: MutableRefObject<Record<string, boolean | undefined>>
  cellClipboardRef: MutableRefObject<{ text: string; values: unknown[][] } | null>
  contextMenuCellSelectionRefs: MutableRefObject<Record<string, string[] | undefined>>
  contextMenuCellSelectionSnapshotRefs: MutableRefObject<
    Record<string, { anchorCellKey: string; cellKeys: string[] } | undefined>
  >
  cellInspectorPanelRefs: MutableRefObject<Record<string, CellInspectorPanelHandle | null>>
  inlineCellEditorRefs: MutableRefObject<Record<string, InlineCellEditorState | undefined>>
  committedSelectedCellRangeRefs: MutableRefObject<Record<string, string[] | undefined>>
  cellSelectionAnchorRefs: MutableRefObject<
    Record<string, { rowKey: string; column: string } | undefined>
  >
  rowDragAnchorRefs: MutableRefObject<Record<string, string | undefined>>
  rowSelectionAnchorRefs: MutableRefObject<Record<string, string | undefined>>
  rowSelectionDraftRefs: MutableRefObject<Record<string, Key[] | undefined>>
  columnResizeRefs: MutableRefObject<Record<string, ColumnResizeState | undefined>>
}

type ResultTablePanelProps = {
  tab: WorkspaceTab
  searchState: TableSearchUiState
  refs: ResultTablePanelRefs
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  updateWorkspaceTab: (tabKey: string, patch: Partial<WorkspaceTab>) => void
  updateTableSearchState: (tab: WorkspaceTab, patch: Partial<TableSearchUiState>) => void
  changeTabPage: (tab: WorkspaceTab, page: number) => Promise<void>
  changeTabLastPage: (tab: WorkspaceTab) => Promise<void>
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
  previewRedisDatabase: (
    connectionId: string,
    databaseName: string,
    limit?: number,
    page?: number,
    tabKey?: string,
    where?: string
  ) => Promise<void>
  showObjectDdl: (
    connectionId: string,
    name: string,
    type: DbObjectType,
    databaseName?: string,
    pgDatabaseName?: string
  ) => Promise<void>
  openResultExportModal: (tab: WorkspaceTab) => void
  addPreviewRow: (tab: WorkspaceTab) => void
  markSelectedRowsDeleted: (tab: WorkspaceTab, selectedRowKeysOverride?: string[]) => void
  submitPreviewChanges: (tab: WorkspaceTab) => Promise<void>
  submitQueryChanges: (tab: WorkspaceTab) => Promise<void>
  addRedisRow: (tab: WorkspaceTab) => void
  submitRedisChanges: (tab: WorkspaceTab) => Promise<void>
  toggleRedisValue: (tabKey: string, rowKey: string) => void
  updateRedisEdit: (tabKey: string, rowKey: string, patch: Partial<RedisKeyEdit>) => void
  deleteRedisRow: (tabKey: string, rowKey: string) => void
  updatePreviewCell: (tabKey: string, rowKey: string, column: string, value: unknown) => void
  updatePreviewCells: (
    tabKey: string,
    patches: Array<{ rowKey: string; column: string; value: unknown }>
  ) => void
  syncRenderedCellSelection: (tabKey: string) => void
  clearInlineCellEditor: (tabKey: string) => void
  discardInlineCellEditor: (tabKey: string) => void
  commitInlineCellEditor: (tabKey: string, options?: { restoreFocus?: boolean }) => void
  openInlineCellEditor: (
    tabKey: string,
    rowKey: string,
    column: string,
    host: HTMLElement,
    rawValue: unknown,
    options?: {
      initialValue?: string
      batchCells?: Array<{ rowKey: string; column: string }>
      batchOriginalValues?: Array<{ rowKey: string; column: string; value: unknown }>
    }
  ) => void
  scheduleRenderedCellSelectionSync: (tabKey: string) => void
  clearRuntimeColumnSelection: (tabKey: string) => void
  clearActiveSearchCellHighlight: (tabKey: string) => void
  clearAllCellSelection: (tabKey: string) => void
  clearSelectedRowsForTab: (tabKey: string) => void
  applyRuntimeColumnSelection: (tabKey: string, column: string) => void
  applyRuntimeCellSelection: (tabKey: string, rowKey: string, column: string) => void
  applyRuntimeCellRangeSelection: (tabKey: string, cellKeys: string[]) => void
  commitRuntimeCellSelection: (tabKey: string, cellKeys: string[]) => void
  setCommittedCellSelection: (tabKey: string, cellKeys: string[]) => void
  syncRuntimeSortButtons: (
    tabKey: string,
    sortState?: { column: string; direction: 'ascend' | 'descend' }
  ) => void
  showError: (error: unknown, fallback?: string) => void
  messageApi: MessageInstance
  isSchemaScopedType: (databaseType?: ConnectionInfo['database_type']) => boolean
  onOpenTableGitHistory?: (tab: WorkspaceTab) => void
  tableSearchShortcut: string
}

const shouldUseVirtualTable = (tab: WorkspaceTab): boolean =>
  tab.kind === 'query' || tab.kind === 'preview'

const HORIZONTAL_COLUMN_VIRTUALIZATION_THRESHOLD = 32
const HORIZONTAL_COLUMN_OVERSCAN = 1

type HorizontalColumnRange = {
  start: number
  end: number
}

const ResultTablePanel = memo(
  function ResultTablePanel({
    tab,
    searchState,
    refs,
    getConnection,
    updateWorkspaceTab,
    updateTableSearchState,
    changeTabPage,
    changeTabLastPage,
    changeTabLimit,
    previewTable,
    previewRedisDatabase,
    showObjectDdl,
    openResultExportModal,
    addPreviewRow,
    markSelectedRowsDeleted,
    submitPreviewChanges,
    submitQueryChanges,
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
    onOpenTableGitHistory,
    tableSearchShortcut
  }: ResultTablePanelProps): ReactNode {
    const active = useWorkspaceStore((state) => state.activeTabKey === tab.key)
    const hasMultiStatementResults = tab.multiStatementResults !== undefined
    const tableBodyHostRef = useRef<HTMLDivElement | null>(null)
    const [tableScrollY, setTableScrollY] = useState(320)
    const [tableViewportWidth, setTableViewportWidth] = useState(0)
    const [horizontalColumnRange, setHorizontalColumnRange] = useState<HorizontalColumnRange>({
      start: 0,
      end: HORIZONTAL_COLUMN_VIRTUALIZATION_THRESHOLD
    })
    const horizontalColumnRangeFrameRef = useRef<number | undefined>(undefined)
    const pendingHorizontalColumnRangeRef = useRef<
      { scrollLeft: number; viewportWidth: number } | undefined
    >(undefined)
    const [searchVisibleLocal, setSearchVisibleLocal] = useState(
      Boolean(searchState.query.trim() || searchState.visible)
    )
    const [cellContextMenu, setCellContextMenu] = useState<CellContextMenuState | null>(null)
    const rowDragPointerRef = useRef<{ x: number; y: number } | null>(null)
    const rowDragAutoScrollFrameRef = useRef<number | undefined>(undefined)
    const cellDragPointerRef = useRef<{ x: number; y: number } | null>(null)
    const cellDragAutoScrollFrameRef = useRef<number | undefined>(undefined)

    useEffect(() => {
      if (searchState.query.trim() || searchState.visible) {
        setSearchVisibleLocal(true)
      }
    }, [searchState.query, searchState.visible])

    useLayoutEffect(() => {
      if (!cellContextMenu) {
        return
      }
      syncRenderedCellSelection(tab.key)
    }, [cellContextMenu, syncRenderedCellSelection, tab.key])

    useEffect(() => {
      if (!cellContextMenu) {
        return
      }

      const forceCloseContextMenu = (): void => {
        setCellContextMenu(null)
        refs.suppressNextCellMouseDownRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock(0)
      }

      const closeContextMenu = (target: EventTarget | null): void => {
        const element = target as HTMLElement | null
        if (element?.closest(`.ant-dropdown, ${RESULT_CELL_CONTEXT_MENU_SELECTOR}`)) {
          return
        }
        forceCloseContextMenu()
      }

      const handlePointerDown = (event: PointerEvent): void => {
        closeContextMenu(event.target)
      }

      const handleMouseDown = (event: MouseEvent): void => {
        closeContextMenu(event.target)
      }

      const handleContextMenu = (event: MouseEvent): void => {
        const element = event.target as HTMLElement | null
        if (
          element?.closest(`.ant-dropdown, ${RESULT_CELL_CONTEXT_MENU_SELECTOR}, [data-cell-key]`)
        ) {
          return
        }
        closeContextMenu(event.target)
      }

      window.addEventListener('pointerdown', handlePointerDown, true)
      window.addEventListener('mousedown', handleMouseDown, true)
      window.addEventListener('contextmenu', handleContextMenu, true)
      return () => {
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('mousedown', handleMouseDown, true)
        window.removeEventListener('contextmenu', handleContextMenu, true)
      }
    }, [cellContextMenu, refs, tab.key])

    const handleBodyRef = useCallback(
      (element: HTMLDivElement | null) => {
        tableBodyHostRef.current = element
        refs.tableBodyRefs.current[tab.key] = element
        refs.tableHeaderRefs.current[tab.key] =
          element?.querySelector<HTMLDivElement>('.ant-table-header') ?? null
      },
      [refs, tab.key]
    )

    useEffect(() => {
      const container = tableBodyHostRef.current
      if (!container) {
        return
      }
      const holder = container.querySelector<HTMLElement>(
        '.ant-table-tbody-virtual-holder, .ant-table-body'
      )
      if (!holder) {
        return
      }
      const savedScrollTop = refs.tableScrollTopRefs.current[tab.key]
      if (savedScrollTop === undefined || Math.abs(holder.scrollTop - savedScrollTop) <= 1) {
        return
      }
      holder.scrollTop = savedScrollTop
    }, [refs, tab.key, tab.tableRenderVersion])

    useEffect(() => {
      const savedScrollLeft = refs.tableScrollLeftRefs.current[tab.key]
      if (savedScrollLeft === undefined) {
        return
      }
      const restoreLockVersion = (refs.tableScrollRestoreLocks.current[tab.key] ?? 0) + 1
      refs.tableScrollRestoreLocks.current[tab.key] = restoreLockVersion

      const restoreScrollLeft = (): void => {
        if (refs.tableScrollRestoreLocks.current[tab.key] !== restoreLockVersion) {
          return
        }
        const container = tableBodyHostRef.current
        const virtualHolder = container?.querySelector<HTMLElement>('.ant-table-tbody-virtual-holder')
        const header = container?.querySelector<HTMLElement>('.ant-table-header')
        if (virtualHolder && header) {
          if (Math.abs(savedScrollLeft - header.scrollLeft) > 1) {
            refs.tableComponentRefs.current[tab.key]?.scrollTo?.({ left: savedScrollLeft })
            header.scrollLeft = savedScrollLeft
            header.dispatchEvent(new Event('scroll', { bubbles: true }))
          }
          return
        }
        const scrollElements = Array.from(
          container?.querySelectorAll<HTMLElement>(
            '.ant-table-tbody-virtual-holder, .ant-table-body, .ant-table-tbody-virtual-scrollbar-horizontal'
          ) ?? []
        )
        scrollElements.forEach((element) => {
          if (element.scrollWidth <= element.clientWidth || Math.abs(element.scrollLeft - savedScrollLeft) <= 1) {
            return
          }
          element.scrollLeft = savedScrollLeft
          element.dispatchEvent(new Event('scroll', { bubbles: true }))
        })
      }

      const frameIds: number[] = []
      frameIds.push(window.requestAnimationFrame(restoreScrollLeft))
      frameIds.push(
        window.requestAnimationFrame(() => {
          restoreScrollLeft()
          frameIds.push(window.requestAnimationFrame(restoreScrollLeft))
        })
      )
      // Ant virtual table can mount its horizontal scrollbar after the result rows render.
      // Keep the captured position authoritative until that asynchronous mount has settled.
      const timeoutIds = [80, 180, 360, 640, 900].map((delay) =>
        window.setTimeout(restoreScrollLeft, delay)
      )
      const releaseLockTimeoutId = window.setTimeout(() => {
        if (refs.tableScrollRestoreLocks.current[tab.key] === restoreLockVersion) {
          delete refs.tableScrollRestoreLocks.current[tab.key]
        }
      }, 1100)

      return () => {
        frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId))
        timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
        window.clearTimeout(releaseLockTimeoutId)
        if (refs.tableScrollRestoreLocks.current[tab.key] === restoreLockVersion) {
          delete refs.tableScrollRestoreLocks.current[tab.key]
        }
      }
    }, [refs, tab.key, tab.tableRenderVersion])

    useEffect(() => {
      const container = tableBodyHostRef.current
      if (!container) {
        return
      }

      const observer = new MutationObserver(() => {
        const hasSelection = Boolean(
          refs.selectedCellRefs.current[tab.key]?.length ||
            refs.runtimeSelectedCellRefs.current[tab.key]?.length ||
            refs.selectedRowRefs.current[tab.key]?.length ||
            refs.selectedColumnRefs.current[tab.key]
        )
        if (!hasSelection) {
          return
        }
        // Ant Table may replace virtual rows and cells in one render pass.
        scheduleRenderedCellSelectionSync(tab.key)
      })

      observer.observe(container, {
        childList: true,
        subtree: true
      })

      return () => observer.disconnect()
    }, [refs, scheduleRenderedCellSelectionSync, tab.key, tab.tableRenderVersion])

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

      const measure = (): void => {
        const nextHeight = getResultTableScrollHeight(element)
        if (nextHeight > 0) {
          setTableScrollY((current) => (current === nextHeight ? current : nextHeight))
        }
        const nextWidth = Math.round(element.getBoundingClientRect().width)
        if (nextWidth > 0) {
          setTableViewportWidth((current) => (current === nextWidth ? current : nextWidth))
        }
      }

      let measureFrame: number | undefined
      const scheduleMeasure = (): void => {
        if (measureFrame !== undefined) {
          return
        }
        measureFrame = window.requestAnimationFrame(() => {
          measureFrame = undefined
          measure()
        })
      }

      measure()

      const observer = new ResizeObserver(() => {
        scheduleMeasure()
      })
      observer.observe(element)
      const shell = element.closest<HTMLElement>('.result-table-content')
      if (shell && shell !== element) {
        observer.observe(shell)
      }

      return () => {
        observer.disconnect()
        if (measureFrame !== undefined) {
          window.cancelAnimationFrame(measureFrame)
        }
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

    useEffect(() => {
      if (tab.kind !== 'preview' || !active) {
        return
      }
      const pendingRowKey = refs.pendingPreviewRowScrollRefs.current[tab.key]
      if (!pendingRowKey) {
        return
      }

      const scrollToPendingRow = (): boolean => {
        const container = refs.tableBodyRefs.current[tab.key]
        if (!container) {
          return false
        }
        const targetRow = container.querySelector<HTMLElement>(
          `tr[data-row-key="${CSS.escape(pendingRowKey)}"], .ant-table-row[data-row-key="${CSS.escape(pendingRowKey)}"]`
        )
        if (targetRow) {
          targetRow.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          refs.pendingPreviewRowScrollRefs.current[tab.key] = undefined
          return true
        }
        const holder = container.querySelector<HTMLElement>(
          '.ant-table-tbody-virtual-holder, .ant-table-body'
        )
        if (!holder) {
          return false
        }
        holder.scrollTop = holder.scrollHeight
        const scrolledTargetRow = container.querySelector<HTMLElement>(
          `tr[data-row-key="${CSS.escape(pendingRowKey)}"], .ant-table-row[data-row-key="${CSS.escape(pendingRowKey)}"]`
        )
        if (!scrolledTargetRow) {
          return false
        }
        scrolledTargetRow.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        refs.pendingPreviewRowScrollRefs.current[tab.key] = undefined
        return true
      }

      let frameId = window.requestAnimationFrame(() => {
        if (scrollToPendingRow()) {
          return
        }
        frameId = window.requestAnimationFrame(() => {
          scrollToPendingRow()
        })
      })

      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }, [active, refs, tab.editRows, tab.key, tab.kind])

    const countPendingChanges = (currentTab: WorkspaceTab): number => {
      if (currentTab.kind === 'redis-browser') {
        return countRedisPendingChanges(currentTab)
      }

      if (currentTab.kind !== 'preview' && currentTab.kind !== 'query') {
        return 0
      }

      return currentTab.editRows?.filter((row) => row.__state || row.__deleted).length ?? 0
    }

    const renderResultPager = (currentTab: WorkspaceTab): ReactNode => {
      const effectiveSearchState = { ...searchState, visible: searchVisibleLocal }

      return (
        <ResultPager
          tab={currentTab}
          previewDefaultLimit={PREVIEW_DEFAULT_LIMIT}
          queryDefaultLimit={QUERY_DEFAULT_LIMIT}
          searchState={effectiveSearchState}
          searchVisible={searchVisibleLocal}
          onChangePage={(page) => void changeTabPage(currentTab, page)}
          onChangeLastPage={() => void changeTabLastPage(currentTab)}
          onChangeLimit={(limit) => void changeTabLimit(currentTab, limit)}
          onExportData={() => openResultExportModal(currentTab)}
          onToggleSearch={() => {
            if (searchState.query.trim() || searchVisibleLocal) {
              clearActiveSearchCellHighlight(currentTab.key)
              setSearchVisibleLocal(false)
              if (
                searchState.query.trim() ||
                searchState.filterRows ||
                searchState.activeMatchIndex !== 0
              ) {
                updateTableSearchState(currentTab, {
                  query: '',
                  filterRows: false,
                  activeMatchIndex: 0
                })
              }
              return
            }
            setSearchVisibleLocal(true)
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
        onOpenTableGitHistory={() => onOpenTableGitHistory?.(currentTab)}
        onPointerClearSelection={() => {
          clearActiveSearchCellHighlight(currentTab.key)
          clearRuntimeColumnSelection(currentTab.key)
          clearSelectedRowsForTab(currentTab.key)
          clearAllCellSelection(currentTab.key)
        }}
      />
    )

    const renderQueryExecutionStatus = (currentTab: WorkspaceTab): ReactNode => (
      <QueryExecutionStatusCard
        tab={currentTab}
        onClose={(patch) => updateWorkspaceTab(currentTab.key, patch)}
      />
    )

    const renderWhereInput = (currentTab: WorkspaceTab): ReactNode =>
      currentTab.kind === 'preview' || currentTab.kind === 'redis-browser' ? (
        <ResultWhereInput
          tab={currentTab}
          onUpdateWhere={(nextWhere) => updateWorkspaceTab(currentTab.key, { where: nextWhere })}
          onPreviewTable={(nextTab, nextWhere) => {
            const previewObjectType = nextTab.objectType === 'view' ? 'view' : 'table'
            void previewTable(
              nextTab.connectionId!,
              nextTab.tableName!,
              nextTab.databaseName,
              nextTab.pgDatabaseName,
              nextTab.limit,
              1,
              nextWhere,
              previewObjectType
            )
          }}
          onPreviewRedisDatabase={(nextTab, nextWhere) => {
            void previewRedisDatabase(
              nextTab.connectionId!,
              nextTab.databaseName!,
              nextTab.limit,
              1,
              nextTab.key,
              nextWhere
            )
          }}
        />
      ) : null

    const renderTableToolbar = (
      currentTab: WorkspaceTab,
      searchMeta: {
        matchCount: number
        resetKey: string
        focusSearchMatch: (matchIndex: number) => void
      }
    ): ReactNode => {
      const effectiveSearchState = { ...searchState, visible: searchVisibleLocal }
      const captureTableScrollPosition = (): void => {
        const container = refs.tableBodyRefs.current[currentTab.key]
        const scrollElements = Array.from(
          container?.querySelectorAll<HTMLElement>(
            '.ant-table-tbody-virtual-holder, .ant-table-body, .ant-table-tbody-virtual-scrollbar-horizontal'
          ) ?? []
        )
        const scrollElement = scrollElements.find(
          (element) => element.scrollWidth > element.clientWidth + 1
        )
        if (!scrollElement) {
          return
        }
        refs.tableScrollTopRefs.current[currentTab.key] = scrollElement.scrollTop
        const headerScrollLeft =
          container?.querySelector<HTMLElement>('.ant-table-header')?.scrollLeft ?? 0
        refs.tableScrollLeftRefs.current[currentTab.key] = headerScrollLeft || scrollElement.scrollLeft
        refs.tableScrollRestoreLocks.current[currentTab.key] =
          (refs.tableScrollRestoreLocks.current[currentTab.key] ?? 0) + 1
      }

      return (
        <ResultTableToolbar
          tab={currentTab}
          connection={getConnection(currentTab.connectionId)}
          hasSelectedRows={getCurrentSelectedRowKeys().length > 0}
          pendingChanges={countPendingChanges(currentTab)}
          redisPendingChanges={countRedisPendingChanges(currentTab)}
          searchState={effectiveSearchState}
          searchVisible={searchVisibleLocal}
          searchMeta={searchMeta}
          whereInput={renderWhereInput(currentTab)}
          onToggleSearch={() => {
            if (searchState.query.trim() || searchVisibleLocal) {
              clearActiveSearchCellHighlight(currentTab.key)
              setSearchVisibleLocal(false)
              if (
                searchState.query.trim() ||
                searchState.filterRows ||
                searchState.activeMatchIndex !== 0
              ) {
                updateTableSearchState(currentTab, {
                  query: '',
                  filterRows: false,
                  activeMatchIndex: 0
                })
              }
              return
            }
            setSearchVisibleLocal(true)
          }}
          onSearchStateChange={(patch) => {
            if (patch.visible === true) {
              setSearchVisibleLocal(true)
            }
            if (patch.visible === false) {
              setSearchVisibleLocal(false)
            }
            const { visible: _visible, ...statePatch } = patch
            if (Object.keys(statePatch).length > 0) {
              updateTableSearchState(currentTab, statePatch)
            }
          }}
          onClearActiveHighlight={() => clearActiveSearchCellHighlight(currentTab.key)}
          onShowObjectDdl={(nextTab) =>
            void showObjectDdl(
              nextTab.connectionId!,
              nextTab.tableName!,
              nextTab.objectType ?? 'table',
              nextTab.databaseName,
              nextTab.pgDatabaseName
            )
          }
          onExportData={openResultExportModal}
          onPreviewTableRefresh={(nextTab) => {
            captureTableScrollPosition()
            void previewTable(
              nextTab.connectionId!,
              nextTab.tableName!,
              nextTab.databaseName,
              nextTab.pgDatabaseName,
              nextTab.limit,
              nextTab.page,
              nextTab.where
            )
          }}
          onPreviewRedisRefresh={(nextTab) => {
            captureTableScrollPosition()
            void previewRedisDatabase(
              nextTab.connectionId!,
              nextTab.databaseName!,
              nextTab.limit,
              nextTab.page,
              nextTab.key,
              nextTab.where
            )
          }}
          onAddPreviewRow={addPreviewRow}
          onMarkSelectedRowsDeleted={(nextTab) =>
            markSelectedRowsDeleted(
              nextTab,
              (refs.rowSelectionDraftRefs.current[nextTab.key] ??
                nextTab.selectedRowKeys ??
                refs.selectedRowRefs.current[nextTab.key] ??
                [])
                .map(String)
            )
          }
          onSubmitPreviewChanges={(nextTab) => void submitPreviewChanges(nextTab)}
          onSubmitQueryChanges={(nextTab) => void submitQueryChanges(nextTab)}
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

    const supportsCellSelection =
      tab.kind === 'preview' || tab.kind === 'query' || tab.kind === 'table-list'
    const supportsTableSearch =
      tab.kind === 'preview' || tab.kind === 'query' || tab.kind === 'redis-browser'

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
        if (
          target?.closest(
            'input, textarea, [contenteditable="true"], .monaco-editor, .ai-panel-shell'
          )
        ) {
          return
        }

        event.preventDefault()
        event.stopPropagation()

        if (searchState.query.trim() || searchVisibleLocal) {
          return
        }

        setSearchVisibleLocal(true)
      }

      window.addEventListener('keydown', handleWindowKeyDown, true)
      return () => {
        window.removeEventListener('keydown', handleWindowKeyDown, true)
      }
    }, [
      active,
      searchState.query,
      searchVisibleLocal,
      supportsTableSearch,
      tab,
      tableSearchShortcut
    ])
    const queryWritableColumns = tab.result?.column_origins ?? {}
    const supportsWritableCells =
      tab.kind === 'preview' || (tab.kind === 'query' && Object.keys(queryWritableColumns).length > 0)
    const connection = getConnection(tab.connectionId)
    const derivedState = useMemo(
      () =>
        buildResultTableDerivedState({
          tab,
          searchState,
          previewDefaultLimit: PREVIEW_DEFAULT_LIMIT,
          queryDefaultLimit: QUERY_DEFAULT_LIMIT,
          formatCellText: cellDisplayText
        }),
      [
        searchState,
        tab.kind,
        tab.result?.columns,
        tab.result?.rows,
        tab.editRows,
        tab.columnOrder,
        tab.columnWidths,
        tab.columnFilters,
        tab.page,
        tab.limit
      ]
    )
    const {
      baseTableRows,
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
    const getResultColumnWidth = (column: string): number => {
      const persistedWidth = columnWidths[column]
      if (persistedWidth !== undefined) {
        return persistedWidth
      }
      if (orderedColumns.length === 1 && tableViewportWidth > 0) {
        return Math.max(
          DEFAULT_RESULT_COLUMN_WIDTH,
          tableViewportWidth - (supportsCellSelection ? 34 : 0)
        )
      }
      return DEFAULT_RESULT_COLUMN_WIDTH
    }
    const highlightedCellHtmlCache = useMemo(
      () => new Map<string, string | null>(),
      [
        tab.key,
        searchState.query,
        searchState.caseSensitive,
        searchState.regex,
        searchState.wholeWord,
        searchState.filterRows,
        tableRows,
        orderedColumns
      ]
    )
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
        const cellElement = container.querySelector<HTMLElement>(
          `[data-cell-key="${CSS.escape(match.cellKey)}"]`
        )
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

    const getSelectionEntries = (cellKeys: string[]) =>
      cellKeys
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
        .filter(
          (
            entry
          ): entry is {
            cellKey: string
            rowKey: string
            column: string
            rowIndex: number
            columnIndex: number
            value: unknown
          } => entry !== null
        )

    const getCommittedCellSelection = (): string[] => {
      const runtime = refs.runtimeSelectedCellRefs.current[tab.key] ?? []
      if (runtime.length > 0) {
        return runtime
      }
      return refs.selectedCellRefs.current[tab.key] ?? []
    }

    const getCurrentSelectedRowKeys = (): string[] => {
      const nextSelectedRowKeys =
        refs.rowSelectionDraftRefs.current[tab.key] ??
        refs.selectedRowRefs.current[tab.key] ??
        tab.selectedRowKeys ??
        []
      return nextSelectedRowKeys.map(String).filter((rowKey) => orderedRowKeys.includes(rowKey))
    }

    const getSelectedRowKeysForClipboard = (): string[] => {
      const renderedRows = refs.renderedSelectedRowRefs.current[tab.key]
      if (renderedRows && renderedRows.length > 0) {
        return renderedRows.filter((rowKey) => orderedRowKeys.includes(rowKey))
      }
      return getCurrentSelectedRowKeys()
    }

    const getClipboardSelectionCellKeys = (): string[] => {
      const selectedRows = getSelectedRowKeysForClipboard()
      if (selectedRows.length > 0) {
        return selectedRows.flatMap((rowKey) =>
          orderedColumns.map((column) => `${rowKey}:${column}`)
        )
      }
      const selectedColumn = refs.selectedColumnRefs.current[tab.key]
      if (selectedColumn && orderedColumns.includes(selectedColumn)) {
        return orderedRowKeys.map((rowKey) => `${rowKey}:${selectedColumn}`)
      }
      return getCommittedCellSelection()
    }

    const getEditableTargetCellKeys = (): string[] => {
      const activeSelection = getActiveCellSelection()
      const selection = activeSelection.length > 0 ? activeSelection : getClipboardSelectionCellKeys()
      const anchor = refs.cellSelectionAnchorRefs.current[tab.key]
      const candidateCellKeys =
        selection.length > 0 || !anchor ? selection : [`${anchor.rowKey}:${anchor.column}`]
      return candidateCellKeys.filter((cellKey) => {
        const parsed = parseCellKey(cellKey)
        return Boolean(parsed && (tab.kind === 'preview' || queryWritableColumns[parsed.column]))
      })
    }

    const getCellRangeKeys = (
      anchor: { rowKey: string; column: string },
      target: { rowKey: string; column: string }
    ): string[] => {
      const startRowIndex = orderedRowKeys.indexOf(anchor.rowKey)
      const endRowIndex = orderedRowKeys.indexOf(target.rowKey)
      const startColumnIndex = orderedColumnIndexMap[anchor.column]
      const endColumnIndex = orderedColumnIndexMap[target.column]
      if (
        startRowIndex < 0 ||
        endRowIndex < 0 ||
        startColumnIndex === undefined ||
        endColumnIndex === undefined
      ) {
        return []
      }
      const nextCellKeys: string[] = []
      for (
        let rowIndex = Math.min(startRowIndex, endRowIndex);
        rowIndex <= Math.max(startRowIndex, endRowIndex);
        rowIndex += 1
      ) {
        for (
          let columnIndex = Math.min(startColumnIndex, endColumnIndex);
          columnIndex <= Math.max(startColumnIndex, endColumnIndex);
          columnIndex += 1
        ) {
          nextCellKeys.push(`${orderedRowKeys[rowIndex]}:${orderedColumns[columnIndex]}`)
        }
      }
      return nextCellKeys
    }

    const getSelectionBounds = (
      cellKeys = getCommittedCellSelection()
    ): {
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
      return bounds.rowKeys.map((rowKey) =>
        bounds.columns.map((column) => rowByKey.get(rowKey)?.[column] ?? null)
      )
    }

    const getSelectedCellPatchesForValue = (
      value: unknown,
      cellKeys = getCommittedCellSelection()
    ): Array<{ rowKey: string; column: string; value: unknown }> => {
      const bounds = getSelectionBounds(cellKeys)
      if (!bounds) {
        return []
      }
      return bounds.rowKeys.flatMap((rowKey) =>
        bounds.columns.map((column) => ({ rowKey, column, value }))
      )
    }

    const getDirectCellPatchesForValue = (
      value: unknown,
      cellKeys: string[]
    ): Array<{ rowKey: string; column: string; value: unknown }> =>
      getSelectionEntries(cellKeys).map(({ rowKey, column }) => ({ rowKey, column, value }))

    const startSelectedCellEditing = (initialValue: string): void => {
      const selection = getEditableTargetCellKeys()
      const entries = getSelectionEntries(selection)
      const first = entries[0]
      if (!first) {
        return
      }
      const host = refs.tableBodyRefs.current[tab.key]?.querySelector<HTMLElement>(
        `.editable-cell[data-cell-key="${CSS.escape(first.cellKey)}"]`
      )
      if (!host) {
        return
      }
      openInlineCellEditor(tab.key, first.rowKey, first.column, host, first.value, {
        initialValue,
        batchCells: entries.map(({ rowKey, column }) => ({ rowKey, column })),
        batchOriginalValues: entries.map(({ rowKey, column, value }) => ({ rowKey, column, value }))
      })
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
      return normalizeCellSelectionKeys(
        Array.from(
          refs.tableBodyRefs.current[tab.key]?.querySelectorAll<HTMLElement>(
            '.editable-cell.cell-selected-runtime[data-cell-key]'
          ) ?? []
        )
          .map((element) => element.dataset.cellKey)
          .filter((cellKey): cellKey is string => Boolean(cellKey))
      )
    }

    const getRenderedCellSelection = (): string[] =>
      normalizeCellSelectionKeys(
        Array.from(
          refs.tableBodyRefs.current[tab.key]?.querySelectorAll<HTMLElement>(
            '.editable-cell.cell-selected-runtime[data-cell-key]'
          ) ?? []
        )
          .map((element) => element.dataset.cellKey)
          .filter((cellKey): cellKey is string => Boolean(cellKey))
      )

    const getBestAvailableSelection = (cellKey: string): string[] => {
      const candidates = [
        refs.contextMenuCellSelectionRefs.current[tab.key] ?? [],
        getRenderedCellSelection(),
        refs.committedSelectedCellRangeRefs.current[tab.key] ?? [],
        getActiveCellSelection(),
        refs.selectedCellRefs.current[tab.key] ?? []
      ]
        .map((selection) => normalizeCellSelectionKeys(selection))
        .filter(
          (selection, index, allSelections) =>
            selection.length > 0 &&
            allSelections.findIndex(
              (candidate) =>
                candidate.length === selection.length &&
                candidate.every((key, keyIndex) => key === selection[keyIndex])
            ) === index
        )
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
        const activeRowKeys = getCurrentSelectedRowKeys()
        if (activeRowKeys.includes(parsedCell.rowKey)) {
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

    const buildSelectionClipboardText = (values: unknown[][]): string =>
      values.map((row) => row.map((value) => serializeCellValue(value)).join('\t')).join('\n')

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
        return [tab.pgDatabaseName, tab.databaseName, tab.tableName]
          .filter(Boolean)
          .map((part) => quoteIdentifier(String(part)))
          .join('.')
      }
      return [tab.databaseName, tab.tableName]
        .filter(Boolean)
        .map((part) => quoteIdentifier(String(part)))
        .join('.')
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
      const sql = bounds.rowKeys
        .map((rowKey) => {
          const row = rowByKey.get(rowKey)
          const values = bounds.columns.map((column) => toSqlLiteral(row?.[column]))
          return `INSERT INTO ${qualifiedTableName} (${quotedColumns}) VALUES (${values.join(', ')});`
        })
        .join('\n')
      refs.cellClipboardRef.current = { text: sql, values: getCellSelectionMatrix(cellKeys) }
      try {
        await navigator.clipboard.writeText(sql)
      } catch {
        showError('复制 INSERT 失败')
      }
    }

    const copySelectionAsMarkdown = async (
      cellKeys = getCommittedCellSelection()
    ): Promise<void> => {
      const bounds = getSelectionBounds(cellKeys)
      if (!bounds || bounds.columns.length === 0 || bounds.rowKeys.length === 0) {
        return
      }
      const escapeMarkdownCell = (value: unknown): string =>
        serializeCellValue(value)
          .replaceAll('|', '\\|')
          .replaceAll('\r\n', '<br />')
          .replaceAll('\n', '<br />')
      const header = `| ${bounds.columns.join(' | ')} |`
      const separator = `| ${bounds.columns.map(() => '---').join(' | ')} |`
      const lines = bounds.rowKeys.map(
        (rowKey) =>
          `| ${bounds.columns.map((column) => escapeMarkdownCell(rowByKey.get(rowKey)?.[column])).join(' | ')} |`
      )
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
      const selection = getEditableTargetCellKeys()
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

      const normalizedText = clipboardText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n$/, '')
      const cachedText = refs.cellClipboardRef.current?.text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n$/, '')
      const values =
        normalizedText && cachedText === normalizedText
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
      updatePreviewCells(
        tab.key,
        patches.filter((patch) => tab.kind === 'preview' || Boolean(queryWritableColumns[patch.column]))
      )
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

    function scheduleContextMenuSelectionUnlock(frameCount = 1): void {
      const release = (): void => {
        refs.contextMenuSelectionLockRefs.current[tab.key] = undefined
      }
      if (frameCount <= 0) {
        release()
        return
      }
      let remaining = frameCount
      const step = (): void => {
        remaining -= 1
        if (remaining <= 0) {
          release()
          return
        }
        window.requestAnimationFrame(step)
      }
      window.requestAnimationFrame(step)
    }

    const forceCloseContextMenu = (): void => {
      setCellContextMenu(null)
      refs.suppressNextCellMouseDownRefs.current[tab.key] = undefined
      scheduleContextMenuSelectionUnlock(0)
    }

    const openCellContextMenu = (
      nextTabKey: string,
      cellKey: string,
      clientX: number,
      clientY: number,
      selection: string[]
    ): void => {
      refs.contextMenuSelectionLockRefs.current[nextTabKey] = true
      setCellContextMenu({
        cellKey,
        x: clientX,
        y: clientY,
        selection: [...selection]
      })
      window.requestAnimationFrame(() => {
        syncRenderedCellSelection(nextTabKey)
      })
    }

    const handleCellContextMenuAction = (
      actionKey: string,
      cellKey: string,
      selectionOverride?: string[]
    ): void => {
      const snapshot = refs.contextMenuCellSelectionSnapshotRefs.current[tab.key]
      const selection =
        selectionOverride && selectionOverride.includes(cellKey)
          ? normalizeCellSelectionKeys(selectionOverride)
          : snapshot?.cellKeys.includes(cellKey)
            ? snapshot.cellKeys
            : resolveContextSelection(cellKey)
      refs.suppressNextShellClickClearRefs.current[tab.key] = true
      if (actionKey === 'copy-selection') {
        void copySelectedCells(selection)
        forceCloseContextMenu()
        refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock()
        return
      }
      if (actionKey === 'copy-as-insert') {
        void copySelectionAsInsert(selection)
        forceCloseContextMenu()
        refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock()
        return
      }
      if (actionKey === 'copy-as-md') {
        void copySelectionAsMarkdown(selection)
        forceCloseContextMenu()
        refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock()
        return
      }
      if (
        actionKey === 'inspect-record' ||
        actionKey === 'inspect-value' ||
        actionKey === 'inspect-aggregate'
      ) {
        const view: CellInspectorView =
          actionKey === 'inspect-record'
            ? 'record'
            : actionKey === 'inspect-value'
              ? 'value'
              : 'aggregate'
        setCommittedCellSelection(tab.key, selection)
        refs.runtimeSelectedCellRefs.current[tab.key] = undefined
        refs.cellInspectorPanelRefs.current[tab.key]?.open(view, selection)
        syncRenderedCellSelection(tab.key)
        window.requestAnimationFrame(() => {
          syncRenderedCellSelection(tab.key)
          window.requestAnimationFrame(() => {
            syncRenderedCellSelection(tab.key)
          })
        })
        refs.contextMenuCellSelectionRefs.current[tab.key] = undefined
        forceCloseContextMenu()
        refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock(3)
        return
      }
      if (!supportsWritableCells) {
        refs.contextMenuCellSelectionRefs.current[tab.key] = undefined
        forceCloseContextMenu()
        refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock()
        return
      }
      if (actionKey === 'set-null') {
        clearInlineCellEditor(tab.key)
        updatePreviewCells(
          tab.key,
          getDirectCellPatchesForValue(null, selection).filter(
            (patch) => tab.kind === 'preview' || Boolean(queryWritableColumns[patch.column])
          )
        )
        refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
        scheduleContextMenuSelectionUnlock()
        return
      }
      if (actionKey === 'set-default') {
        clearInlineCellEditor(tab.key)
        updatePreviewCells(
          tab.key,
          getDirectCellPatchesForValue(createDefaultValueMarker(), selection).filter(
            (patch) => tab.kind === 'preview' || Boolean(queryWritableColumns[patch.column])
          )
        )
      }
      refs.contextMenuCellSelectionRefs.current[tab.key] = undefined
      forceCloseContextMenu()
      refs.contextMenuCellSelectionSnapshotRefs.current[tab.key] = undefined
      scheduleContextMenuSelectionUnlock()
    }

    const isEditableTarget = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      return Boolean(
        element?.closest(
          'input, textarea, [contenteditable="true"], .monaco-editor, .editable-cell-dom-input'
        )
      )
    }

    const focusResultTable = (): void => {
      const focus = (): void => refs.tableBodyRefs.current[tab.key]?.focus()
      focus()
      window.requestAnimationFrame(() => {
        if (!refs.inlineCellEditorRefs.current[tab.key]) {
          focus()
        }
      })
    }

    const applySelectedRows = (nextSelectedRowKeys: Key[]): void => {
      const normalizedSelectedRowKeys = nextSelectedRowKeys.map(String)
      const currentSelectedRowKeys =
        refs.selectedRowRefs.current[tab.key] ?? (tab.selectedRowKeys ?? []).map(String)
      const selectionUnchanged =
        currentSelectedRowKeys.length === normalizedSelectedRowKeys.length &&
        currentSelectedRowKeys.every((rowKey, index) => rowKey === normalizedSelectedRowKeys[index])
      refs.selectedRowRefs.current[tab.key] =
        normalizedSelectedRowKeys.length > 0 ? normalizedSelectedRowKeys : undefined
      if (selectionUnchanged) {
        return
      }
      updateWorkspaceTab(tab.key, {
        selectedRowKeys: normalizedSelectedRowKeys,
        selectedRowKeyMap: Object.fromEntries(
          normalizedSelectedRowKeys.map((rowKey) => [rowKey, true as const])
        )
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
          container
            .querySelectorAll<HTMLElement>(
              `tr[data-row-key="${CSS.escape(rowKey)}"], .ant-table-row[data-row-key="${CSS.escape(rowKey)}"]`
            )
            .forEach((rowElement) => {
              rowElement.classList.remove('row-selected')
              rowElement
                .querySelector<HTMLElement>('.row-number-button')
                ?.classList.remove('selected')
            })
        }
      }
      for (const rowKey of nextRowKeys) {
        container
          .querySelectorAll<HTMLElement>(
            `tr[data-row-key="${CSS.escape(rowKey)}"], .ant-table-row[data-row-key="${CSS.escape(rowKey)}"]`
          )
          .forEach((rowElement) => {
            rowElement.classList.add('row-selected')
            rowElement.querySelector<HTMLElement>('.row-number-button')?.classList.add('selected')
          })
      }
      refs.renderedSelectedRowRefs.current[tab.key] =
        nextRowKeys.length > 0 ? nextRowKeys : undefined
    }

    const previewSelectedRows = (nextSelectedRowKeys: Key[]): void => {
      refs.rowSelectionDraftRefs.current[tab.key] = nextSelectedRowKeys
      updateRenderedSelectedRows(nextSelectedRowKeys)
      const normalizedSelectedRowKeys = nextSelectedRowKeys.map(String)
      updateWorkspaceTab(tab.key, {
        selectedRowKeys: normalizedSelectedRowKeys,
        selectedRowKeyMap: Object.fromEntries(
          normalizedSelectedRowKeys.map((rowKey) => [rowKey, true as const])
        )
      })
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
      if (
        !refs.selectedRowRefs.current[tab.key]?.length &&
        !refs.rowSelectionDraftRefs.current[tab.key]?.length &&
        !tab.selectedRowKeys?.length
      ) {
        return
      }
      previewSelectedRows([])
      refs.rowSelectionDraftRefs.current[tab.key] = undefined
      applySelectedRows([])
    }

    const toggleColumnSort = (column: string): void => {
      const nextSort =
        !tab.sortState || tab.sortState.column !== column
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
        flushPendingRowDragSelection()
      })
    }

    const flushPendingRowDragSelection = (): void => {
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
      if (
        currentDraft &&
        currentDraft.length === nextSelected.length &&
        currentDraft.every((key, index) => String(key) === String(nextSelected[index]))
      ) {
        return
      }
      previewSelectedRows(nextSelected)
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
        flushPendingCellDragSelection()
      })
    }

    const flushPendingCellDragSelection = (): void => {
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
      if (
        startRowIndex < 0 ||
        endRowIndex < 0 ||
        startColumnIndex === undefined ||
        endColumnIndex === undefined
      ) {
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
      if (
        runtimeCellKeys.length === nextCellKeys.length &&
        runtimeCellKeys.every((key, index) => key === nextCellKeys[index])
      ) {
        return
      }
      applyRuntimeCellRangeSelection(tab.key, nextCellKeys)
    }

    const stopRowDragAutoScroll = (): void => {
      if (rowDragAutoScrollFrameRef.current) {
        window.cancelAnimationFrame(rowDragAutoScrollFrameRef.current)
        rowDragAutoScrollFrameRef.current = undefined
      }
    }

    const stopCellDragAutoScroll = (): void => {
      if (cellDragAutoScrollFrameRef.current) {
        window.cancelAnimationFrame(cellDragAutoScrollFrameRef.current)
        cellDragAutoScrollFrameRef.current = undefined
      }
    }

    const updateRowDragTargetFromPointer = (): void => {
      const pointer = rowDragPointerRef.current
      const container = refs.tableBodyRefs.current[tab.key]
      if (!pointer || !container || !refs.rowDragAnchorRefs.current[tab.key]) {
        return
      }
      const holder = container.querySelector<HTMLElement>(
        '.ant-table-tbody-virtual-holder, .ant-table-body'
      )
      const rect = holder?.getBoundingClientRect()
      const target = document.elementFromPoint(
        rect ? Math.min(Math.max(pointer.x, rect.left + 4), rect.right - 4) : pointer.x,
        rect ? Math.min(Math.max(pointer.y, rect.top + 4), rect.bottom - 4) : pointer.y
      ) as HTMLElement | null
      const rowKey = target?.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey
      if (rowKey && orderedRowIndexMap[rowKey] !== undefined) {
        updateDragRowSelection(rowKey)
      }
    }

    const updateCellDragTargetFromPointer = (): void => {
      const pointer = cellDragPointerRef.current
      const container = refs.tableBodyRefs.current[tab.key]
      if (!pointer || !container || !refs.cellDragAnchorRefs.current[tab.key]) {
        return
      }
      const holder = container.querySelector<HTMLElement>(
        '.ant-table-tbody-virtual-holder, .ant-table-body'
      )
      const rect = holder?.getBoundingClientRect()
      const target = document.elementFromPoint(
        rect ? Math.min(Math.max(pointer.x, rect.left + 4), rect.right - 4) : pointer.x,
        rect ? Math.min(Math.max(pointer.y, rect.top + 4), rect.bottom - 4) : pointer.y
      ) as HTMLElement | null
      const cell = target?.closest<HTMLElement>('.editable-cell[data-row-key][data-cell-column-key]')
      const rowKey = cell?.dataset.rowKey
      const column = cell?.dataset.cellColumnKey
      if (rowKey && column && orderedRowIndexMap[rowKey] !== undefined && orderedColumnIndexMap[column] !== undefined) {
        updateDragCellSelection(rowKey, column)
      }
    }

    const scheduleRowDragAutoScroll = (): void => {
      if (rowDragAutoScrollFrameRef.current) {
        return
      }
      const tick = (): void => {
        rowDragAutoScrollFrameRef.current = undefined
        const pointer = rowDragPointerRef.current
        const container = refs.tableBodyRefs.current[tab.key]
        const holder = container?.querySelector<HTMLElement>(
          '.ant-table-tbody-virtual-holder, .ant-table-body'
        )
        if (!pointer || !holder || !refs.rowDragAnchorRefs.current[tab.key]) {
          return
        }
        const rect = holder.getBoundingClientRect()
        const edge = 28
        const direction = pointer.y < rect.top + edge ? -1 : pointer.y > rect.bottom - edge ? 1 : 0
        if (!direction) {
          updateRowDragTargetFromPointer()
          return
        }
        const previousScrollTop = holder.scrollTop
        holder.scrollTop +=
          direction *
          Math.max(
            8,
            Math.round(
              (edge - Math.abs(pointer.y - (direction < 0 ? rect.top : rect.bottom))) * 0.7
            )
          )
        const visibleRows = Array.from(
          holder.querySelectorAll<HTMLElement>('[data-row-key]')
        ).filter(
          (element) =>
            element.dataset.rowKey && orderedRowIndexMap[element.dataset.rowKey] !== undefined
        )
        const edgeRowKey = visibleRows[direction < 0 ? 0 : visibleRows.length - 1]?.dataset.rowKey
        if (edgeRowKey) {
          updateDragRowSelection(edgeRowKey)
        } else {
          updateRowDragTargetFromPointer()
        }
        if (holder.scrollTop !== previousScrollTop) {
          rowDragAutoScrollFrameRef.current = window.requestAnimationFrame(tick)
        }
      }
      rowDragAutoScrollFrameRef.current = window.requestAnimationFrame(tick)
    }

    const scheduleCellDragAutoScroll = (): void => {
      if (cellDragAutoScrollFrameRef.current) {
        return
      }
      const tick = (): void => {
        cellDragAutoScrollFrameRef.current = undefined
        const pointer = cellDragPointerRef.current
        const container = refs.tableBodyRefs.current[tab.key]
        const holder = container?.querySelector<HTMLElement>(
          '.ant-table-tbody-virtual-holder, .ant-table-body'
        )
        if (!pointer || !holder || !refs.cellDragAnchorRefs.current[tab.key]) {
          return
        }
        const rect = holder.getBoundingClientRect()
        const edge = 28
        const horizontalDirection =
          pointer.x < rect.left + edge ? -1 : pointer.x > rect.right - edge ? 1 : 0
        const verticalDirection =
          pointer.y < rect.top + edge ? -1 : pointer.y > rect.bottom - edge ? 1 : 0
        if (!horizontalDirection && !verticalDirection) {
          updateCellDragTargetFromPointer()
          return
        }
        const scrollAmount = (direction: number, position: number, edgePosition: number): number =>
          direction * Math.max(8, Math.round((edge - Math.abs(position - edgePosition)) * 0.7))
        const previousScrollTop = holder.scrollTop
        const header = container?.querySelector<HTMLElement>('.ant-table-header')
        const previousScrollLeft = header?.scrollLeft ?? 0
        let horizontalScrollChanged = false
        if (verticalDirection) {
          holder.scrollTop += scrollAmount(
            verticalDirection,
            pointer.y,
            verticalDirection < 0 ? rect.top : rect.bottom
          )
        }
        if (horizontalDirection && header) {
          const amount = scrollAmount(
            horizontalDirection,
            pointer.x,
            horizontalDirection < 0 ? rect.left : rect.right
          )
          const nextScrollLeft = Math.max(
            0,
            Math.min(holder.scrollWidth - holder.clientWidth, previousScrollLeft + amount)
          )
          horizontalScrollChanged = nextScrollLeft !== previousScrollLeft
          if (horizontalScrollChanged) {
            refs.tableComponentRefs.current[tab.key]?.scrollTo?.({ left: nextScrollLeft })
            header.scrollLeft = nextScrollLeft
            header.dispatchEvent(new Event('scroll', { bubbles: true }))
          }
        }
        updateCellDragTargetFromPointer()
        if (
          holder.scrollTop !== previousScrollTop ||
          (header?.scrollLeft ?? 0) !== previousScrollLeft ||
          horizontalScrollChanged
        ) {
          cellDragAutoScrollFrameRef.current = window.requestAnimationFrame(tick)
        }
      }
      cellDragAutoScrollFrameRef.current = window.requestAnimationFrame(tick)
    }

    useEffect(() => {
      const handleMouseMove = (event: MouseEvent): void => {
        const hasRowDrag = Boolean(refs.rowDragAnchorRefs.current[tab.key])
        const hasCellDrag = Boolean(refs.cellDragAnchorRefs.current[tab.key])
        if (!hasRowDrag && !hasCellDrag) {
          return
        }
        if (hasRowDrag) {
          rowDragPointerRef.current = { x: event.clientX, y: event.clientY }
          updateRowDragTargetFromPointer()
          scheduleRowDragAutoScroll()
        }
        if (hasCellDrag) {
          cellDragPointerRef.current = { x: event.clientX, y: event.clientY }
          updateCellDragTargetFromPointer()
          scheduleCellDragAutoScroll()
        }
      }
      const handleMouseUp = (): void => {
        const hasRowDrag = Boolean(refs.rowDragAnchorRefs.current[tab.key])
        const hasCellDrag = Boolean(refs.cellDragAnchorRefs.current[tab.key])
        if (!hasRowDrag && !hasCellDrag) {
          return
        }
        stopRowDragAutoScroll()
        stopCellDragAutoScroll()
        flushPendingCellDragSelection()
        flushPendingRowDragSelection()
        refs.rowDragAnchorRefs.current[tab.key] = undefined
        refs.cellDragAnchorRefs.current[tab.key] = undefined
        refs.pendingRowDragTargetRefs.current[tab.key] = undefined
        refs.pendingCellDragTargetRefs.current[tab.key] = undefined
        if ((refs.runtimeSelectedCellRefs.current[tab.key] ?? []).length > 0) {
          refs.suppressNextShellClickClearRefs.current[tab.key] = true
        }
        commitRuntimeCellSelection(
          tab.key,
          refs.runtimeSelectedCellRefs.current[tab.key] ?? []
        )
        commitPreviewSelectedRows()
      }
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        stopRowDragAutoScroll()
        stopCellDragAutoScroll()
      }
    }, [tab.key, orderedColumns, orderedColumnIndexMap, orderedRowIndexMap, orderedRowKeys])

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
      draft: boolean,
      onCellDragEnter: () => void,
      onContextSelection: (cellKey: string) => string[],
      displayContent?: ReactNode,
      renderVersion?: string
    ): ReactNode => (
      <ResultEditableCellProxy
        tabKey={currentTabKey}
        rowKey={rowKey}
        column={column}
        value={value}
        editable={editable}
        // Selection highlighting is synchronized on the rendered DOM. Keeping it
        // out of the column closure prevents every click from rebuilding all columns.
        selected={false}
        draft={draft}
        onCellDragEnter={onCellDragEnter}
        renderVersion={renderVersion}
        onPrepareContextSelection={(nextTabKey, cellKey) => {
          focusResultTable()
          refs.rowDragAnchorRefs.current[nextTabKey] = undefined
          refs.cellDragAnchorRefs.current[nextTabKey] = undefined
          refs.pendingCellDragTargetRefs.current[nextTabKey] = undefined
          refs.suppressNextCellMouseDownRefs.current[nextTabKey] = cellKey
          const contextSelection = normalizeCellSelectionKeys(onContextSelection(cellKey))
          setCommittedCellSelection(nextTabKey, contextSelection)
          syncRenderedCellSelection(nextTabKey)
          refs.contextMenuCellSelectionRefs.current[nextTabKey] = [...contextSelection]
          refs.contextMenuCellSelectionSnapshotRefs.current[nextTabKey] = {
            anchorCellKey: cellKey,
            cellKeys: [...contextSelection]
          }
          refs.runtimeSelectedCellRefs.current[nextTabKey] = undefined
          return contextSelection
        }}
        onOpenContextMenu={(nextTabKey, nextCellKey, clientX, clientY, selection) => {
          openCellContextMenu(nextTabKey, nextCellKey, clientX, clientY, selection)
        }}
        onStartCellSelection={(nextTabKey, nextRowKey, nextColumn, modifiers) => {
          const nextCellKey = `${nextRowKey}:${nextColumn}`
          if (refs.suppressNextCellMouseDownRefs.current[nextTabKey] === nextCellKey) {
            refs.suppressNextCellMouseDownRefs.current[nextTabKey] = undefined
            return
          }
          if (refs.inlineCellEditorRefs.current[nextTabKey]) {
            return
          }
          // A new left-click selection must not inherit a completed context-menu range.
          refs.contextMenuCellSelectionRefs.current[nextTabKey] = undefined
          refs.contextMenuCellSelectionSnapshotRefs.current[nextTabKey] = undefined
          focusResultTable()
          clearSelectedRowsForTab(nextTabKey)
          clearRuntimeColumnSelection(nextTabKey)
          const nextAnchor = { rowKey: nextRowKey, column: nextColumn }
          if (modifiers.shiftKey) {
            const anchor = refs.cellSelectionAnchorRefs.current[nextTabKey] ?? nextAnchor
            const rangeCellKeys = getCellRangeKeys(anchor, nextAnchor)
            if (rangeCellKeys.length > 0) {
              refs.cellDragAnchorRefs.current[nextTabKey] = undefined
              refs.cellSelectionAnchorRefs.current[nextTabKey] = nextAnchor
              setCommittedCellSelection(nextTabKey, rangeCellKeys)
              return
            }
          }
          if (modifiers.ctrlKey || modifiers.metaKey) {
            refs.cellDragAnchorRefs.current[nextTabKey] = undefined
            refs.cellSelectionAnchorRefs.current[nextTabKey] = nextAnchor
            const selectedCellKeys = new Set(getCommittedCellSelection())
            if (selectedCellKeys.has(nextCellKey)) {
              selectedCellKeys.delete(nextCellKey)
            } else {
              selectedCellKeys.add(nextCellKey)
            }
            const nextCellKeys = orderedRowKeys.flatMap((rowKey) =>
              orderedColumns
                .map((orderedColumn) => `${rowKey}:${orderedColumn}`)
                .filter((cellKey) => selectedCellKeys.has(cellKey))
            )
            setCommittedCellSelection(nextTabKey, nextCellKeys)
            return
          }
          refs.cellSelectionAnchorRefs.current[nextTabKey] = nextAnchor
          refs.cellDragAnchorRefs.current[nextTabKey] = { rowKey: nextRowKey, column: nextColumn }
          applyRuntimeCellSelection(nextTabKey, nextRowKey, nextColumn)
        }}
        onOpenEditor={(nextTabKey, nextRowKey, nextColumn, host, rawValue) => {
          refs.rowDragAnchorRefs.current[nextTabKey] = undefined
          refs.cellDragAnchorRefs.current[nextTabKey] = undefined
          refs.pendingCellDragTargetRefs.current[nextTabKey] = undefined
          refs.runtimeSelectedCellRefs.current[nextTabKey] = undefined
          openInlineCellEditor(nextTabKey, nextRowKey, nextColumn, host, rawValue)
        }}
        displayContent={displayContent ?? cellDisplayText(value)}
      />
    )

    const renderColumnTitle = (column: string): ReactNode => {
      const checkedValues = columnFilters[column] ?? []
      const sortDirection = tab.sortState?.column === column ? tab.sortState.direction : undefined
      const sortIcon = (
        <span
          className="column-sort-icon"
          data-direction={sortDirection ?? 'none'}
          aria-hidden="true"
        >
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
          <Flex
            align="center"
            gap={4}
            className="column-header-content"
            onContextMenu={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`column-select-button${tab.draggingColumn === column ? ' dragging' : ''}${
                (tab.selectedColumns ?? []).includes(column) ? ' column-select-button-runtime-selected' : ''
              }`}
              data-column-button={column}
              title="点击选中当前列，拖动可调整列顺序"
              draggable
              onClick={(event) => {
                event.stopPropagation()
                focusResultTable()
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
                moveColumn(
                  event.dataTransfer.getData('text/plain') || tab.draggingColumn || column,
                  column
                )
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
                const currentWidth = getResultColumnWidth(column)
                const startTableWidth = Math.max(
                  orderedColumns.reduce(
                    (total, item) => total + getResultColumnWidth(item),
                    supportsCellSelection ? 34 : 0
                  ),
                  1
                )
                const columnIndex = orderedColumns.indexOf(column) + (supportsCellSelection ? 1 : 0)
                const header = refs.tableHeaderRefs.current[tab.key]
                const body = refs.tableBodyRefs.current[tab.key]
                const headerCells = header
                  ? Array.from(
                      header.querySelectorAll<HTMLElement>(
                        `[data-column-button="${CSS.escape(column)}"]`
                      )
                    )
                      .map((button) => button.closest('th') as HTMLElement | null)
                      .filter((cell): cell is HTMLElement => Boolean(cell))
                  : []
                const headerColElements = header
                  ? Array.from(
                      header.querySelectorAll<HTMLTableColElement>('table > colgroup > col')
                    )
                  : []
                const bodyColElements = body
                  ? Array.from(
                      body.querySelectorAll<HTMLTableColElement>(
                        '.ant-table-body > table > colgroup > col, .ant-table-tbody-virtual table > colgroup > col, .ant-table-tbody-virtual-holder table > colgroup > col'
                      )
                    )
                  : []
                const enableVirtualTable = shouldUseVirtualTable(tab)
                const virtualCells =
                  enableVirtualTable && body
                    ? Array.from(
                        body.querySelectorAll<HTMLElement>(
                          `.ant-table-tbody-virtual [data-column-key="${CSS.escape(column)}"]`
                        )
                      )
                    : []
                refs.columnResizeRefs.current[`${tab.key}:${column}`] = {
                  tabKey: tab.key,
                  column,
                  columnIndex,
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startWidth: currentWidth,
                  startTableWidth,
                  lastWidth: currentWidth,
                  tableWidthHost: body ?? undefined,
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

    const rowNumberColumn = useMemo<ColumnsType<EditableRow>[number]>(() => ({
      title: (
        <button
          type="button"
          className="row-number-select-all"
          title="选中当前表格全部内容"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            focusResultTable()
            clearRuntimeColumnSelection(tab.key)
            clearSelectedRows()
            const allCellKeys = orderedRowKeys.flatMap((rowKey) =>
              orderedColumns.map((column) => `${rowKey}:${column}`)
            )
            setCommittedCellSelection(tab.key, allCellKeys)
          }}
        >
          <UnorderedListOutlined />
        </button>
      ),
      key: '__rowNumber',
      width: 34,
      fixed: 'left',
      className: 'row-number-cell result-column-width',
      onCell: (row: EditableRow) =>
        ({
          'data-row-key': row.__rowKey,
          style: {
            '--result-column-width': '34px'
          } as CSSProperties
        }) as TdHTMLAttributes<HTMLElement>,
      onHeaderCell: () =>
        ({
          className: 'result-column-width',
          style: {
            '--result-column-width': '34px'
          } as CSSProperties
        }) as TdHTMLAttributes<HTMLElement>,
      render: (_value: unknown, row: EditableRow, index: number) => {
        return (
          <button
            type="button"
            className="row-number-button"
            title="选中当前行，拖动可选择多行"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              focusResultTable()
              clearRuntimeColumnSelection(tab.key)
              clearAllCellSelection(tab.key)
              if (event.shiftKey) {
                const anchor = refs.rowSelectionAnchorRefs.current[tab.key] ?? row.__rowKey
                const start = orderedRowIndexMap[anchor]
                const end = orderedRowIndexMap[row.__rowKey]
                if (start !== undefined && end !== undefined) {
                  const nextSelected = orderedRowKeys.slice(
                    Math.min(start, end),
                    Math.max(start, end) + 1
                  )
                  refs.rowDragAnchorRefs.current[tab.key] = undefined
                  previewSelectedRows(nextSelected)
                  applySelectedRows(nextSelected)
                  return
                }
              }
              if (event.ctrlKey || event.metaKey) {
                refs.rowDragAnchorRefs.current[tab.key] = undefined
                refs.rowSelectionAnchorRefs.current[tab.key] = row.__rowKey
                const currentSelection = new Set(getCurrentSelectedRowKeys())
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
              refs.rowSelectionAnchorRefs.current[tab.key] = row.__rowKey
              previewSelectedRows([row.__rowKey])
            }}
            onMouseEnter={() => updateDragRowSelection(row.__rowKey)}
          >
            {rowNumberOffset + index + 1}
          </button>
        )
      }
    }), [
      tab.key,
      orderedColumns,
      orderedRowKeys,
      orderedRowIndexMap,
      rowNumberOffset
    ])

    const searchSignature = `${searchState.query}\u0000${searchState.caseSensitive ? 1 : 0}\u0000${searchState.regex ? 1 : 0}\u0000${searchState.wholeWord ? 1 : 0}\u0000${searchState.filterRows ? 1 : 0}`
    const renderedTableRows = useMemo(
      () => tableRows.map((row) => ({ ...row, __searchSignature: searchSignature })),
      [searchSignature, tableRows]
    )

    const enableVirtualTable = shouldUseVirtualTable(tab)
    const enableHorizontalColumnVirtualization =
      enableVirtualTable && orderedColumns.length > HORIZONTAL_COLUMN_VIRTUALIZATION_THRESHOLD
    const orderedColumnWidths = useMemo(
      () => orderedColumns.map((column) => getResultColumnWidth(column)),
      [columnWidths, orderedColumns, supportsCellSelection, tableViewportWidth]
    )
    const resolvedHorizontalColumnRange = useCallback(
      (scrollLeft: number, viewportWidth: number): HorizontalColumnRange => {
        if (!enableHorizontalColumnVirtualization) {
          return { start: 0, end: orderedColumns.length }
        }

        const visibleStart = Math.max(0, scrollLeft)
        const visibleEnd = visibleStart + Math.max(viewportWidth, DEFAULT_RESULT_COLUMN_WIDTH * 8)
        let consumedWidth = 0
        let firstVisibleIndex = 0
        let lastVisibleIndex = orderedColumns.length - 1

        for (let index = 0; index < orderedColumnWidths.length; index += 1) {
          const columnEnd = consumedWidth + orderedColumnWidths[index]
          if (columnEnd > visibleStart) {
            firstVisibleIndex = index
            break
          }
          consumedWidth = columnEnd
        }

        consumedWidth = 0
        for (let index = 0; index < orderedColumnWidths.length; index += 1) {
          consumedWidth += orderedColumnWidths[index]
          if (consumedWidth >= visibleEnd) {
            lastVisibleIndex = index
            break
          }
        }

        return {
          start: Math.max(0, firstVisibleIndex - HORIZONTAL_COLUMN_OVERSCAN),
          end: Math.min(orderedColumns.length, lastVisibleIndex + HORIZONTAL_COLUMN_OVERSCAN + 1)
        }
      },
      [enableHorizontalColumnVirtualization, orderedColumnWidths, orderedColumns.length]
    )
    const updateHorizontalColumnRange = useCallback(
      (scrollLeft: number, viewportWidth: number): void => {
        if (!enableHorizontalColumnVirtualization) {
          return
        }
        const nextRange = resolvedHorizontalColumnRange(scrollLeft, viewportWidth)
        startTransition(() => {
          setHorizontalColumnRange((currentRange) =>
            currentRange.start === nextRange.start && currentRange.end === nextRange.end
              ? currentRange
              : nextRange
          )
        })
      },
      [resolvedHorizontalColumnRange]
    )
    const handleHorizontalScroll = useCallback(
      (scrollLeft: number, viewportWidth: number): void => {
        if (!refs.tableScrollRestoreLocks.current[tab.key]) {
          refs.tableScrollLeftRefs.current[tab.key] = scrollLeft
        }
        pendingHorizontalColumnRangeRef.current = { scrollLeft, viewportWidth }
        if (horizontalColumnRangeFrameRef.current !== undefined) {
          return
        }
        horizontalColumnRangeFrameRef.current = window.requestAnimationFrame(() => {
          horizontalColumnRangeFrameRef.current = undefined
          const pending = pendingHorizontalColumnRangeRef.current
          pendingHorizontalColumnRangeRef.current = undefined
          if (pending) {
            updateHorizontalColumnRange(pending.scrollLeft, pending.viewportWidth)
          }
        })
      },
      [refs, tab.key, updateHorizontalColumnRange]
    )

    useEffect(
      () => () => {
        if (horizontalColumnRangeFrameRef.current !== undefined) {
          window.cancelAnimationFrame(horizontalColumnRangeFrameRef.current)
        }
      },
      []
    )

    useEffect(() => {
      const savedScrollLeft = refs.tableScrollLeftRefs.current[tab.key] ?? 0
      updateHorizontalColumnRange(savedScrollLeft, tableViewportWidth)
    }, [refs, tab.key, tableViewportWidth, updateHorizontalColumnRange])

    const displayedColumns = useMemo(() => {
      if (!enableHorizontalColumnVirtualization) {
        return orderedColumns
      }
      return orderedColumns.slice(horizontalColumnRange.start, horizontalColumnRange.end)
    }, [enableHorizontalColumnVirtualization, horizontalColumnRange, orderedColumns])
    const leftColumnSpacerWidth = useMemo(
      () =>
        enableHorizontalColumnVirtualization
          ? orderedColumnWidths
              .slice(0, horizontalColumnRange.start)
              .reduce((total, width) => total + width, 0)
          : 0,
      [enableHorizontalColumnVirtualization, horizontalColumnRange.start, orderedColumnWidths]
    )
    const rightColumnSpacerWidth = useMemo(
      () =>
        enableHorizontalColumnVirtualization
          ? orderedColumnWidths
              .slice(horizontalColumnRange.end)
              .reduce((total, width) => total + width, 0)
          : 0,
      [enableHorizontalColumnVirtualization, horizontalColumnRange.end, orderedColumnWidths]
    )

    const dataColumns = useMemo<ColumnsType<EditableRow>>(() => displayedColumns.map((column) => {
      const columnWidth = getResultColumnWidth(column)
      const columnCellStyle = {
        '--result-column-width': `${columnWidth}px`
      } as CSSProperties

      return {
      title: renderColumnTitle(column),
      dataIndex: column,
      key: column,
      width: columnWidth,
      ellipsis: true,
      className: 'result-column-width',
      shouldCellUpdate: (record, previousRecord) =>
        record[column] !== previousRecord[column] ||
        record.__state !== previousRecord.__state ||
        record.__searchSignature !== previousRecord.__searchSignature,
      onCell: (row: EditableRow) =>
        ({
          'data-column-key': column,
          'data-row-key': row.__rowKey,
          'data-cell-key': `${row.__rowKey}:${column}`,
          className: [
            'result-column-width',
            (tab.selectedColumns ?? []).includes(column) ? 'column-selected-runtime' : ''
          ]
            .filter(Boolean)
            .join(' '),
          style: columnCellStyle
        }) as TdHTMLAttributes<HTMLElement>,
      onHeaderCell: () =>
        ({
          className: 'result-column-width',
          style: columnCellStyle
        }) as TdHTMLAttributes<HTMLElement>,
      render: (value: unknown, row: EditableRow) =>
        supportsCellSelection
          ? renderEditableCell(
              tab.key,
              row.__rowKey,
              column,
              value,
              supportsWritableCells &&
                (tab.kind === 'preview' || Boolean(queryWritableColumns[column])),
              row.__state === 'inserted' ||
                Boolean(row.__original && !isCellValueEqual(value, row.__original[column])),
              () => updateDragCellSelection(row.__rowKey, column),
              ensureContextSelection,
              highlightResultText(
                `${row.__rowKey}:${column}`,
                cellDisplayText(value),
                'table-cell-text'
              ),
              searchSignature
            )
          : highlightResultText(
              `${row.__rowKey}:${column}`,
              cellDisplayText(value),
              'table-cell-text'
            )
      }
    }), [
      displayedColumns,
      columnWidths,
      columnFilters,
      tab.key,
      tab.kind,
      tab.sortState?.column,
      tab.sortState?.direction,
      tab.draggingColumn,
      tab.selectedColumns,
      supportsCellSelection,
      supportsWritableCells,
      queryWritableColumns,
      searchSignature
    ])

    const createColumnSpacer = useCallback(
      (key: string, width: number): ColumnsType<EditableRow>[number] => ({
        key,
        title: null,
        width,
        className: 'result-column-width result-column-virtual-spacer',
        onCell: () =>
          ({
            'aria-hidden': true,
            className: 'result-column-width result-column-virtual-spacer',
            style: { '--result-column-width': `${width}px` } as CSSProperties
          }) as TdHTMLAttributes<HTMLElement>,
        onHeaderCell: () =>
          ({
            'aria-hidden': true,
            className: 'result-column-width result-column-virtual-spacer',
            style: { '--result-column-width': `${width}px` } as CSSProperties
          }) as TdHTMLAttributes<HTMLElement>,
        render: () => null
      }),
      []
    )
    const tableColumns = useMemo<ColumnsType<EditableRow>>(() => {
      const spacerColumns: ColumnsType<EditableRow> = []
      if (leftColumnSpacerWidth > 0) {
        spacerColumns.push(createColumnSpacer('__column-virtual-left', leftColumnSpacerWidth))
      }
      spacerColumns.push(...dataColumns)
      if (rightColumnSpacerWidth > 0) {
        spacerColumns.push(createColumnSpacer('__column-virtual-right', rightColumnSpacerWidth))
      }
      return supportsCellSelection ? [rowNumberColumn, ...spacerColumns] : spacerColumns
    }, [
      createColumnSpacer,
      dataColumns,
      leftColumnSpacerWidth,
      rightColumnSpacerWidth,
      rowNumberColumn,
      supportsCellSelection
    ])
    const tableScrollX = Math.max(
      orderedColumns.reduce(
        (total, column) => total + getResultColumnWidth(column),
        supportsCellSelection ? 34 : 0
      ),
      1
    )

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
      <div
        className={`result-table-shell${tab.kind === 'query' ? ' query-result-table-shell' : ''}`}
        onMouseDownCapture={(event) => {
          if (event.button !== 0) {
            return
          }
          const target = event.target as HTMLElement | null
          if (!target) {
            return
          }
          if (target.closest('.table-data-toolbar, .result-table-search-overlay')) {
            return
          }
          if (target.closest('[data-result-status="true"]')) {
            if (refs.contextMenuSelectionLockRefs.current[tab.key]) {
              return
            }
            clearActiveSearchCellHighlight(tab.key)
            clearRuntimeColumnSelection(tab.key)
            clearSelectedRowsForTab(tab.key)
            clearAllCellSelection(tab.key)
            return
          }
          if (
            target.closest(
              `[data-cell-key], .row-number-button, .row-number-select-all, .column-header-content, .column-select-button, .column-sort-button, .column-resize-handle, .editable-cell-dom-input, .cell-inspector, ${RESULT_CELL_CONTEXT_MENU_SELECTOR}`
            )
          ) {
            return
          }
          if (refs.contextMenuSelectionLockRefs.current[tab.key]) {
            return
          }
          clearActiveSearchCellHighlight(tab.key)
          clearRuntimeColumnSelection(tab.key)
          clearSelectedRowsForTab(tab.key)
          clearAllCellSelection(tab.key)
        }}
        onClickCapture={(event) => {
          if (refs.suppressNextShellClickClearRefs.current[tab.key]) {
            refs.suppressNextShellClickClearRefs.current[tab.key] = undefined
            return
          }
          if (refs.contextMenuSelectionLockRefs.current[tab.key]) {
            return
          }
          const target = event.target as HTMLElement | null
          if (!target) {
            return
          }
          if (target.closest('.table-data-toolbar, .result-table-search-overlay')) {
            return
          }
          if (
            target.closest(
              `[data-cell-key], .row-number-button, .row-number-select-all, .column-header-content, .column-select-button, .column-sort-button, .column-resize-handle, .editable-cell-dom-input, .cell-inspector, ${RESULT_CELL_CONTEXT_MENU_SELECTOR}`
            )
          ) {
            return
          }
          clearAllCellSelection(tab.key)
        }}
      >
        {!hasMultiStatementResults && renderResultStatus(tab)}
        {!hasMultiStatementResults &&
          renderTableToolbar(tab, {
            matchCount: searchMatches.length,
            resetKey: `${searchState.query}\u0000${searchState.caseSensitive ? 1 : 0}\u0000${searchState.regex ? 1 : 0}\u0000${searchState.wholeWord ? 1 : 0}\u0000${searchState.filterRows ? 1 : 0}\u0000${searchMatches.length}`,
            focusSearchMatch
          })}
        {(tab.resultKind === 'command' || tab.resultKind === 'error') &&
          renderQueryExecutionStatus(tab)}
        {tab.multiStatementResults && <MultiStatementExecutionCard results={tab.multiStatementResults} />}
        {tab.error && tab.resultKind !== 'error' && (
          <Alert
            className="result-inline-alert"
            message={tab.error}
            type="error"
            showIcon
            closable
            onClose={() => updateWorkspaceTab(tab.key, { error: undefined })}
          />
        )}
        {hasMultiStatementResults || tab.resultKind === 'command' || tab.resultKind === 'error' ? null : (
          <div
            className={`result-table-content${tab.kind === 'query' ? ' query-result-table-content' : ''}`}
          >
            {active && tab.loading && (
              <div className="result-table-loading-overlay">
                <Spin size="large" />
              </div>
            )}
            <ResultTableBodyView
              tabKey={tab.key}
              tabKind={tab.kind}
              tableRenderVersion={tab.tableRenderVersion}
              selectedRowKeys={tab.selectedRowKeys}
              restoreScrollLeft={refs.tableScrollLeftRefs.current[tab.key]}
              searchSignature={searchSignature}
              tableColumns={tableColumns}
              tableRows={renderedTableRows}
              tableScrollX={tableScrollX}
              tableScrollY={tableScrollY}
              virtual={enableVirtualTable}
              setTableRef={(instance) => {
                refs.tableComponentRefs.current[tab.key] = instance
              }}
              setBodyRef={handleBodyRef}
              setHeaderRef={(element) => {
                refs.tableHeaderRefs.current[tab.key] = element
              }}
              onHorizontalScroll={handleHorizontalScroll}
              onScrollCapture={() => {
                const container = refs.tableBodyRefs.current[tab.key]
                const holder = container?.querySelector<HTMLElement>(
                  '.ant-table-tbody-virtual-holder, .ant-table-body'
                )
                if (holder) {
                  refs.tableScrollTopRefs.current[tab.key] = holder.scrollTop
                }
                const hasSelectedRows = Boolean(
                  refs.rowSelectionDraftRefs.current[tab.key]?.length ||
                    refs.selectedRowRefs.current[tab.key]?.length ||
                    tab.selectedRowKeys?.length
                )
                const selectedRows = hasSelectedRows ? getCurrentSelectedRowKeys() : []
                if (selectedRows.length > 0) {
                  updateRenderedSelectedRows(selectedRows)
                }
                // Virtual rows are replaced while scrolling. Reapply selection only when one
                // actually exists; scanning every rendered cell on each scroll frame makes
                // wide result sets noticeably lag even when the user is only navigating.
                if (
                  selectedRows.length > 0 ||
                  (refs.selectedCellRefs.current[tab.key]?.length ?? 0) > 0 ||
                  (refs.runtimeSelectedCellRefs.current[tab.key]?.length ?? 0) > 0 ||
                  Boolean(refs.selectedColumnRefs.current[tab.key])
                ) {
                  scheduleRenderedCellSelectionSync(tab.key)
                }
              }}
              onKeyDown={(event) => {
                const container = refs.tableBodyRefs.current[tab.key]
                const holder = container?.querySelector<HTMLElement>(
                  '.ant-table-tbody-virtual-holder, .ant-table-body'
                )
                if (holder) {
                  refs.tableScrollTopRefs.current[tab.key] = holder.scrollTop
                }
                if (!supportsCellSelection || isEditableTarget(event.target)) {
                  return
                }
                if (
                  (event.ctrlKey || event.metaKey) &&
                  !event.shiftKey &&
                  event.key.toLowerCase() === 'c'
                ) {
                  const selection = getClipboardSelectionCellKeys()
                  if (selection.length === 0) {
                    return
                  }
                  event.preventDefault()
                  void copySelectedCells(selection)
                }
                if (
                  (event.ctrlKey || event.metaKey) &&
                  !event.shiftKey &&
                  event.key.toLowerCase() === 'v'
                ) {
                  if (!supportsWritableCells) {
                    return
                  }
                  const selection = getCommittedCellSelection()
                  if (selection.length === 0) {
                    return
                  }
                  event.preventDefault()
                  void pasteIntoSelectedCells()
                  return
                }
                if (!supportsWritableCells) {
                  return
                }
                const editableSelection = getEditableTargetCellKeys()
                if (editableSelection.length === 0) {
                  return
                }
                if (event.key === 'Delete') {
                  event.preventDefault()
                  const deletePatches = getDirectCellPatchesForValue(
                    editableValue(''),
                    editableSelection
                  )
                  clearInlineCellEditor(tab.key)
                  updatePreviewCells(tab.key, deletePatches)
                  for (const { rowKey, column } of deletePatches) {
                    const cell = refs.tableBodyRefs.current[tab.key]?.querySelector<HTMLElement>(
                      `.editable-cell[data-cell-key="${CSS.escape(`${rowKey}:${column}`)}"]`
                    )
                    if (cell) {
                      cell.textContent = ''
                    }
                  }
                  return
                }
                if (event.key === 'Backspace') {
                  event.preventDefault()
                  const firstSelectedCell = getSelectionEntries(editableSelection)[0]
                  if (!firstSelectedCell) {
                    return
                  }
                  startSelectedCellEditing(cellDisplayText(firstSelectedCell.value).slice(0, -1))
                  return
                }
                const isTextInput =
                  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
                const isImeInput = event.key === 'Process' || event.nativeEvent.isComposing
                if (!isTextInput && !isImeInput) {
                  return
                }
                if (isTextInput) {
                  event.preventDefault()
                }
                startSelectedCellEditing(isTextInput ? event.key : '')
              }}
              onMouseDown={(event) => {
                if (event.button !== 0) {
                  return
                }
                const target = event.target as HTMLElement
                if (target.closest('.ant-table-tbody-virtual-scrollbar')) {
                  return
                }
                const activeInlineEditor = refs.inlineCellEditorRefs.current[tab.key]
                if (activeInlineEditor && !target.closest('.editable-cell-dom-input')) {
                  commitInlineCellEditor(tab.key)
                }
                refs.scrollbarDragRefs.current[tab.key] = undefined
                if (
                  !target.closest('.row-number-button') &&
                  (tab.selectedRowKeys?.length ||
                    refs.rowSelectionDraftRefs.current[tab.key]?.length)
                ) {
                  clearSelectedRows()
                }
                if (
                  !target.closest('.column-header-content') &&
                  refs.selectedColumnRefs.current[tab.key]
                ) {
                  clearRuntimeColumnSelection(tab.key)
                }
                if (refs.contextMenuSelectionLockRefs.current[tab.key]) {
                  return
                }
                if (
                  !target.closest(
                    `[data-cell-key], .cell-inspector, ${RESULT_CELL_CONTEXT_MENU_SELECTOR}`
                  ) &&
                  (refs.selectedCellRefs.current[tab.key]?.length ||
                    refs.runtimeSelectedCellRefs.current[tab.key]?.length)
                ) {
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
                flushPendingCellDragSelection()
                flushPendingRowDragSelection()
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
                if ((refs.runtimeSelectedCellRefs.current[tab.key] ?? []).length > 0) {
                  refs.suppressNextShellClickClearRefs.current[tab.key] = true
                }
                commitRuntimeCellSelection(
                  tab.key,
                  refs.runtimeSelectedCellRefs.current[tab.key] ?? []
                )
                commitPreviewSelectedRows()
              }}
              onMouseLeave={() => {
                if (refs.scrollbarDragRefs.current[tab.key]) {
                  return
                }
                if (refs.rowDragAnchorRefs.current[tab.key] || refs.cellDragAnchorRefs.current[tab.key]) {
                  return
                }
              }}
            />
            <CellInspectorPanel
              ref={(instance) => {
                refs.cellInspectorPanelRefs.current[tab.key] = instance
              }}
              tabKey={tab.key}
              orderedColumns={orderedColumns}
              rowByKey={rowByKey}
              columnInfoMap={tab.columnInfoMap}
              editable={supportsWritableCells}
              editableColumns={
                tab.kind === 'query' ? Object.keys(queryWritableColumns) : undefined
              }
              onUpdateValue={(rowKey, column, rawValue) =>
                updatePreviewCell(tab.key, rowKey, column, editableValue(rawValue))
              }
            />
            {cellContextMenu &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  className="result-cell-context-menu-backdrop"
                  onMouseDown={() => {
                    forceCloseContextMenu()
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    forceCloseContextMenu()
                  }}
                >
                  <div
                    className="result-cell-context-menu-panel"
                    style={{ left: cellContextMenu.x, top: cellContextMenu.y }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                  >
                    <Menu
                      items={
                        supportsWritableCells
                          ? previewCellContextMenuItems
                          : readOnlyCellContextMenuItems
                      }
                      onClick={({ key }) =>
                        handleCellContextMenuAction(
                          String(key),
                          cellContextMenu.cellKey,
                          cellContextMenu.selection
                        )
                      }
                    />
                  </div>
                </div>,
                document.body
              )}
          </div>
        )}
      </div>
    )
  },
  (prev, next) =>
    prev.tab === next.tab &&
    prev.searchState === next.searchState &&
    prev.refs === next.refs &&
    prev.getConnection === next.getConnection &&
    prev.updateWorkspaceTab === next.updateWorkspaceTab &&
    prev.updateTableSearchState === next.updateTableSearchState &&
    prev.changeTabPage === next.changeTabPage &&
    prev.changeTabLastPage === next.changeTabLastPage &&
    prev.changeTabLimit === next.changeTabLimit &&
    prev.submitQueryChanges === next.submitQueryChanges &&
    prev.previewTable === next.previewTable &&
    prev.previewRedisDatabase === next.previewRedisDatabase &&
    prev.showObjectDdl === next.showObjectDdl &&
    prev.openResultExportModal === next.openResultExportModal &&
    prev.messageApi === next.messageApi &&
    prev.isSchemaScopedType === next.isSchemaScopedType &&
    prev.tableSearchShortcut === next.tableSearchShortcut
)

type ResultEditableCellProxyProps = ComponentProps<typeof ResultEditableCell>

const ResultEditableCellProxy = (props: ResultEditableCellProxyProps): ReactNode => {
  return <ResultEditableCell {...props} />
}

export default ResultTablePanel
