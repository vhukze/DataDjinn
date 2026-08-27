import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownloadOutlined,
  DownOutlined,
  GithubOutlined,
  LeftOutlined,
  LoadingOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { Alert, Button, Flex, Input, InputNumber, Select, Space, Tag, Typography } from 'antd'
import type React from 'react'
import { memo } from 'react'
import { ResultTableHeader, WhereClauseInput } from './table-region'
import type { ConnectionInfo } from './connection-model'
import type { MultiStatementResult, TableSearchUiState, WorkspaceTab, RedisKeyEdit } from './workspace-model'

type SearchMeta = {
  matchCount: number
  resetKey: string
  focusSearchMatch: (matchIndex: number) => void
}

type EditableCellProps = {
  tabKey: string
  rowKey: string
  column: string
  value: unknown
  editable: boolean
  selected: boolean
  draft?: boolean
  onCellDragEnter: () => void
  onPrepareContextSelection: (tabKey: string, cellKey: string) => string[]
  onOpenContextMenu: (
    tabKey: string,
    cellKey: string,
    clientX: number,
    clientY: number,
    selection: string[]
  ) => void
  onStartCellSelection: (
    tabKey: string,
    rowKey: string,
    column: string,
    modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) => void
  onOpenEditor: (
    tabKey: string,
    rowKey: string,
    column: string,
    host: HTMLElement,
    value: unknown
  ) => void
  displayContent?: React.ReactNode
  renderVersion?: string
}

function ResultEditableCellView({
  tabKey,
  rowKey,
  column,
  value,
  editable,
  selected,
  draft = false,
  onCellDragEnter,
  onPrepareContextSelection,
  onOpenContextMenu,
  onStartCellSelection,
  onOpenEditor,
  displayContent
}: EditableCellProps): React.ReactNode {
  const cellKey = `${rowKey}:${column}`
  const clearNativeSelection = (): void => {
    window.getSelection()?.removeAllRanges()
  }
  return (
    <span
      className={`editable-cell${value === null || value === undefined ? ' editable-cell-null' : ''}${draft ? ' editable-cell-draft' : ''}${selected ? ' cell-selected-runtime' : ''}`}
      data-cell-column-key={column}
      data-row-key={rowKey}
      data-cell-key={cellKey}
      draggable={false}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const selection = onPrepareContextSelection(tabKey, cellKey)
        onOpenContextMenu(tabKey, cellKey, event.clientX, event.clientY, selection)
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return
        }
        if ((event.target as HTMLElement | null)?.closest('.editable-cell-dom-input')) {
          return
        }
        clearNativeSelection()
        event.stopPropagation()
        onStartCellSelection(tabKey, rowKey, column, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey
        })
      }}
      onDoubleClick={(event) => {
        if (!editable) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        onOpenEditor(tabKey, rowKey, column, event.currentTarget, value)
      }}
      onMouseEnter={(event) => {
        if ((event.buttons & 1) !== 1) {
          return
        }
        onCellDragEnter()
      }}
      onMouseUp={(event) => {
        if (event.button !== 0) {
          return
        }
        if ((event.target as HTMLElement | null)?.closest('.editable-cell-dom-input')) {
          return
        }
        clearNativeSelection()
      }}
    >
      {displayContent}
    </span>
  )
}

type ResultStatusProps = {
  tab: WorkspaceTab
  connection?: ConnectionInfo
  pendingChanges: number
  pager?: React.ReactNode
  isSchemaScopedType: (databaseType?: ConnectionInfo['database_type']) => boolean
  onPointerClearSelection?: () => void
  onOpenTableGitHistory?: () => void
}

export function ResultStatusBar({
  tab,
  connection,
  pendingChanges,
  pager,
  isSchemaScopedType,
  onPointerClearSelection,
  onOpenTableGitHistory
}: ResultStatusProps): React.ReactNode {
  const totalRows = tab.result?.total_count ?? tab.result?.row_count
  const showPager =
    tab.kind !== 'table-list' && tab.resultKind !== 'command' && tab.resultKind !== 'error'
  const rowText = tab.result
    ? tab.kind === 'preview'
      ? `总行数 ${totalRows ?? 0} 行`
      : tab.kind === 'table-list'
        ? `${tab.result.row_count} 张表`
        : tab.kind === 'redis-browser'
          ? `${tab.result.row_count} 项`
          : `${tab.result.row_count} 行`
    : '暂无结果'

  return (
    <div
      className="result-status"
      data-result-status="true"
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return
        }
        const target = event.target as HTMLElement
        if (
          target.closest(
            '.table-toolbar-inline-actions, .result-status-pager-shell, .preview-where-field, button, input, [role="button"]'
          )
        ) {
          return
        }
        onPointerClearSelection?.()
      }}
    >
      <Space wrap className="result-status-left">
        {tab.kind === 'preview' && connection && connection.database_type !== 'mongodb' && connection.database_type !== 'redis' && onOpenTableGitHistory ? (
          <Button
            type="text"
            size="small"
            className="table-git-history-button"
            icon={<GithubOutlined />}
            title="查看当前表 Git 提交记录"
            aria-label="查看当前表 Git 提交记录"
            onClick={(event) => {
              event.stopPropagation()
              onOpenTableGitHistory()
            }}
          />
        ) : null}
        <Tag
          className="result-status-pill result-status-kind-pill"
          color={
            tab.kind === 'query'
              ? 'blue'
              : tab.kind === 'redis-browser'
                ? 'red'
                : tab.kind === 'table-list'
                  ? 'gold'
                  : 'green'
          }
        >
          {tab.kind === 'query'
            ? 'SQL 查询'
            : tab.kind === 'redis-browser'
              ? 'Redis 浏览'
              : tab.kind === 'table-list'
                ? '表列表'
                : '表预览'}
        </Tag>
        {connection && <Tag className="result-status-pill">{connection.name}</Tag>}
        {tab.kind === 'redis-browser' && tab.databaseName && (
          <Tag className="result-status-pill">{tab.databaseName}</Tag>
        )}
        {tab.kind === 'table-list' && (tab.databaseName || tab.pgDatabaseName) && (
          <Tag className="result-status-pill">
            {isSchemaScopedType(connection?.database_type)
              ? [tab.pgDatabaseName, tab.databaseName].filter(Boolean).join('.')
              : tab.databaseName || tab.pgDatabaseName}
          </Tag>
        )}
        {tab.tableName && tab.kind !== 'redis-browser' && (
          <Tag className="result-status-pill">{tab.tableName}</Tag>
        )}
        <Typography.Text type="secondary" className="result-status-summary">
          {rowText}
        </Typography.Text>
        {tab.result?.limited && (
          <Tag className="result-status-pill result-status-warning-pill" color="warning">
            已截断
          </Tag>
        )}
        {pendingChanges > 0 && (
          <Tag className="result-status-pill result-status-warning-pill" color="orange">
            {pendingChanges} 项未提交
          </Tag>
        )}
      </Space>
      {showPager && pager ? (
        <div className="result-status-right result-status-pager-shell">{pager}</div>
      ) : null}
    </div>
  )
}

type QueryExecutionStatusProps = {
  tab: WorkspaceTab
  onClose: (patch: Partial<WorkspaceTab>) => void
}

export function QueryExecutionStatusCard({
  tab,
  onClose
}: QueryExecutionStatusProps): React.ReactNode {
  if (tab.resultKind === 'command') {
    return (
      <div className="query-execution-card success">
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          className="query-execution-close"
          aria-label="关闭"
          onClick={() =>
            onClose({
              resultKind: undefined,
              commandMessage: undefined,
              commandAffectedRows: undefined,
              error: undefined
            })
          }
        />
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
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          className="query-execution-close"
          aria-label="关闭"
          onClick={() => onClose({ resultKind: undefined, error: undefined })}
        />
        <CloseCircleOutlined />
        <div className="query-execution-card-body">
          <div className="query-execution-error-scroll">
            <Typography.Text className="query-execution-error-text">
              {tab.error || '未知错误'}
            </Typography.Text>
          </div>
        </div>
      </div>
    )
  }

  return null
}

export const ResultEditableCell = memo(ResultEditableCellView, (previous, next) =>
  previous.tabKey === next.tabKey &&
  previous.rowKey === next.rowKey &&
  previous.column === next.column &&
  previous.value === next.value &&
  previous.editable === next.editable &&
  previous.selected === next.selected &&
  previous.draft === next.draft &&
  previous.renderVersion === next.renderVersion
)

export function MultiStatementExecutionCard({ results }: { results: MultiStatementResult[] }): React.ReactNode {
  if (results.length === 0) {
    return null
  }

  return (
    <div className="query-multi-execution-card" data-testid="multi-statement-results">
      {results.map((item) => {
        const result = item.result
        const isCommandResult = Boolean(
          result &&
            result.columns.length === 2 &&
            result.columns.includes('message') &&
            result.columns.includes('affected_rows')
        )

        return (
          <div
            className={`query-execution-card query-multi-execution-item ${item.status}`}
            data-testid={`multi-statement-item-${item.index}`}
            key={item.index}
          >
            {item.status === 'running' ? <LoadingOutlined spin /> : null}
            {item.status === 'success' ? <CheckCircleOutlined /> : null}
            {item.status === 'error' ? <CloseCircleOutlined /> : null}
            <div className="query-execution-card-body query-multi-execution-body">
              <div className="query-execution-card-heading">
                <Typography.Text strong>{`SQL ${item.index + 1}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {item.status === 'running' ? '执行中' : item.status === 'success' ? '执行成功' : '执行失败'}
                </Typography.Text>
              </div>
              <Typography.Text code className="query-execution-sql">
                {item.sql}
              </Typography.Text>
              {item.status === 'success' && isCommandResult ? (
                <div className="query-multi-execution-command">
                  <Typography.Text strong>执行成功</Typography.Text>
                  <Typography.Text type="secondary">
                    影响数据 {item.affectedRows ?? 0} 行
                  </Typography.Text>
                </div>
              ) : null}
              {item.status === 'success' && result && result.columns.length === 0 ? (
                <Typography.Text type="secondary">执行成功</Typography.Text>
              ) : null}
              {item.status === 'success' && result && result.columns.length > 0 && !isCommandResult ? (
                <div className="query-multi-execution-result">
                  <Typography.Text type="secondary">
                    返回 {result.row_count ?? result.rows.length} 行结果
                  </Typography.Text>
                  {result.rows.length > 0 ? (
                    <div className="query-multi-execution-grid">
                      <div
                        className="query-multi-execution-grid-row header"
                        style={{ gridTemplateColumns: `repeat(${result.columns.length}, minmax(120px, 1fr))` }}
                      >
                        {result.columns.map((column) => (
                          <Typography.Text strong key={column}>
                            {column}
                          </Typography.Text>
                        ))}
                      </div>
                      {result.rows.map((row, rowIndex) => (
                        <div
                          className="query-multi-execution-grid-row"
                          key={rowIndex}
                          style={{ gridTemplateColumns: `repeat(${result.columns.length}, minmax(120px, 1fr))` }}
                        >
                          {result.columns.map((column) => (
                            <Typography.Text key={column}>{String(row[column] ?? '')}</Typography.Text>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {item.status === 'error' ? (
                <div className="query-execution-error-scroll">
                  <Typography.Text className="query-execution-error-text">
                    {item.error || '执行失败'}
                  </Typography.Text>
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

type WhereInputProps = {
  tab: WorkspaceTab
  onUpdateWhere: (nextWhere: string) => void
  onPreviewTable: (tab: WorkspaceTab, nextWhere: string) => void
  onPreviewRedisDatabase: (tab: WorkspaceTab, nextWhere: string) => void
}

export function ResultWhereInput({
  tab,
  onUpdateWhere,
  onPreviewTable,
  onPreviewRedisDatabase
}: WhereInputProps): React.ReactNode {
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
          onUpdateWhere(nextWhere)
          onPreviewRedisDatabase(tab, nextWhere)
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
        onUpdateWhere(nextWhere)
        onPreviewTable(tab, nextWhere)
      }}
    />
  )
}

type ResultPagerProps = {
  tab: WorkspaceTab
  previewDefaultLimit: number
  queryDefaultLimit: number
  searchState: TableSearchUiState
  searchVisible: boolean
  onChangePage: (page: number) => void
  onChangeLastPage: () => void
  onChangeLimit: (limit: number) => void
  onToggleSearch: () => void
  onExportData: () => void
}

export function ResultPager({
  tab,
  previewDefaultLimit,
  queryDefaultLimit,
  searchState,
  searchVisible,
  onChangePage,
  onChangeLastPage,
  onChangeLimit,
  onToggleSearch,
  onExportData
}: ResultPagerProps): React.ReactNode {
  const limit = tab.limit ?? (tab.kind === 'preview' ? previewDefaultLimit : queryDefaultLimit)
  const page = tab.page ?? 1
  const totalPages = tab.result?.total_count
    ? Math.max(1, Math.ceil(tab.result.total_count / limit))
    : undefined
  const hasNext = totalPages ? page < totalPages : !!tab.result?.limited
  const hasLastPage = totalPages ? page < totalPages : hasNext
  const showPageSearch = tab.kind === 'query'
  const showDataExport = Boolean(
    tab.kind === 'query' &&
    tab.resultKind !== 'command' &&
    tab.resultKind !== 'error' &&
    tab.result?.columns.length
  )

  const jumpToPage = (rawValue: string): void => {
    const parsed = Number(rawValue.trim())
    if (!Number.isFinite(parsed) || parsed < 1) {
      return
    }
    const nextPage = totalPages ? Math.min(Math.floor(parsed), totalPages) : Math.floor(parsed)
    if (nextPage !== page) {
      onChangePage(nextPage)
    }
  }

  const handleSearchMouseDown = (event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleSearchClick = (event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    onToggleSearch()
  }
  return (
    <Space size={4} className="result-pager">
      <Button
        className="table-toolbar-icon-btn"
        size="small"
        type="text"
        icon={<DoubleLeftOutlined />}
        title="首页"
        aria-label="首页"
        disabled={tab.loading || page <= 1}
        onClick={() => onChangePage(1)}
      />
      <Button
        className="table-toolbar-icon-btn"
        size="small"
        type="text"
        icon={<LeftOutlined />}
        title="上一页"
        aria-label="上一页"
        disabled={tab.loading || page <= 1}
        onClick={() => onChangePage(page - 1)}
      />
      <Input
        size="small"
        key={`${tab.key}:${page}:${totalPages ?? 'open'}`}
        className="result-page-input"
        defaultValue={String(page)}
        inputMode="numeric"
        aria-label="页码"
        onPressEnter={(event) => {
          jumpToPage(event.currentTarget.value)
          event.currentTarget.blur()
        }}
        onBlur={(event) => {
          event.currentTarget.value = String(page)
        }}
      />
      <Button
        className="table-toolbar-icon-btn"
        size="small"
        type="text"
        icon={<RightOutlined />}
        title="下一页"
        aria-label="下一页"
        disabled={tab.loading || !hasNext}
        onClick={() => onChangePage(page + 1)}
      />
      <Button
        className="table-toolbar-icon-btn"
        size="small"
        type="text"
        icon={<DoubleRightOutlined />}
        title="末页"
        aria-label="末页"
        disabled={tab.loading || !hasLastPage}
        onClick={() => (totalPages ? onChangePage(totalPages) : onChangeLastPage())}
      />
      <Select
        size="small"
        variant="borderless"
        value={limit}
        className="result-limit-select"
        options={[300, 500, 1000].map((value) => ({ label: `${value} 条/页`, value }))}
        disabled={tab.loading}
        onChange={onChangeLimit}
      />
      {showPageSearch && (
        <Button
          size="small"
          type="text"
          icon={<SearchOutlined />}
          title="页内搜索"
          aria-label="页内搜索"
          className={
            searchState.query.trim() || searchVisible
              ? 'table-toolbar-icon-btn table-toolbar-toggle is-active'
              : 'table-toolbar-icon-btn table-toolbar-toggle'
          }
          onMouseDown={handleSearchMouseDown}
          onClick={handleSearchClick}
        />
      )}
      {showDataExport && (
        <Button
          size="small"
          type="text"
          icon={<DownloadOutlined />}
          title="导出数据"
          aria-label="导出数据"
          className="table-toolbar-icon-btn result-export-button"
          onMouseDown={handleSearchMouseDown}
          onClick={onExportData}
        />
      )}
    </Space>
  )
}

type TableToolbarProps = {
  tab: WorkspaceTab
  connection?: ConnectionInfo
  hasSelectedRows: boolean
  pendingChanges: number
  redisPendingChanges: number
  searchState: TableSearchUiState
  searchVisible: boolean
  searchMeta: SearchMeta
  whereInput: React.ReactNode
  onToggleSearch: () => void
  onSearchStateChange: (patch: Partial<TableSearchUiState>) => void
  onClearActiveHighlight: () => void
  onShowObjectDdl: (tab: WorkspaceTab) => void
  onExportData: (tab: WorkspaceTab) => void
  onPreviewTableRefresh: (tab: WorkspaceTab) => void
  onPreviewRedisRefresh: (tab: WorkspaceTab) => void
  onAddPreviewRow: (tab: WorkspaceTab) => void
  onMarkSelectedRowsDeleted: (tab: WorkspaceTab) => void
  onSubmitPreviewChanges: (tab: WorkspaceTab) => void
  onSubmitQueryChanges: (tab: WorkspaceTab) => void
  onAddRedisRow: (tab: WorkspaceTab) => void
  onSubmitRedisChanges: (tab: WorkspaceTab) => void
  onBeforePreviewRefresh: (tabKey: string) => void
  onDiscardInlineEditor: (tabKey: string) => void
}

export function ResultTableToolbar({
  tab,
  connection,
  hasSelectedRows,
  pendingChanges,
  redisPendingChanges,
  searchState,
  searchVisible,
  searchMeta,
  whereInput,
  onToggleSearch,
  onSearchStateChange,
  onClearActiveHighlight,
  onShowObjectDdl,
  onExportData,
  onPreviewTableRefresh,
  onPreviewRedisRefresh,
  onAddPreviewRow,
  onMarkSelectedRowsDeleted,
  onSubmitPreviewChanges,
  onSubmitQueryChanges,
  onAddRedisRow,
  onSubmitRedisChanges,
  onBeforePreviewRefresh,
  onDiscardInlineEditor
}: TableToolbarProps): React.ReactNode {
  if (tab.kind === 'table-list') {
    return null
  }

  const showPreviewActions =
    tab.kind === 'preview' &&
    tab.connectionId &&
    tab.tableName &&
    connection?.database_type !== 'mongodb' &&
    connection?.database_type !== 'redis'
  const showQuerySubmit = tab.kind === 'query' && pendingChanges > 0
  const showRedisRefresh = tab.kind === 'redis-browser' && tab.connectionId && tab.databaseName
  const showPreviewSearch = tab.kind === 'preview' || tab.kind === 'redis-browser'
  const showPreviewDdl = Boolean(tab.kind === 'preview' && tab.connectionId && tab.tableName)
  const showDataExport = Boolean(
    tab.kind === 'preview' &&
    tab.resultKind !== 'command' &&
    tab.resultKind !== 'error' &&
    tab.result?.columns.length
  )
  const handleSearchMouseDown = (event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  const handleSearchClick = (event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    onToggleSearch()
  }
  const handleToolbarButtonMouseDown = (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
  }
  const leftActions =
    showRedisRefresh || showPreviewActions || showQuerySubmit ? (
      <Space size={4} className="table-toolbar-inline-actions">
        {showRedisRefresh && (
          <>
            <Button
              className="table-toolbar-icon-btn"
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              title="刷新"
              aria-label="刷新"
              loading={tab.loading}
              onMouseDown={handleToolbarButtonMouseDown}
              onClick={() => onPreviewRedisRefresh(tab)}
            />
            <Button
              className="table-toolbar-icon-btn"
              size="small"
              type="text"
              icon={<PlusOutlined />}
              title="新增一行"
              aria-label="新增一行"
              onMouseDown={handleToolbarButtonMouseDown}
              onClick={() => onAddRedisRow(tab)}
            />
            <Button
              className={`table-toolbar-icon-btn${redisPendingChanges > 0 ? ' is-pending-save' : ''}`}
              type="text"
              size="small"
              icon={<SaveOutlined />}
              title="提交"
              aria-label="提交"
              disabled={redisPendingChanges === 0}
              loading={tab.loading}
              onMouseDown={handleToolbarButtonMouseDown}
              onClick={() => onSubmitRedisChanges(tab)}
            />
          </>
        )}
        {showPreviewActions && (
          <>
            <Button
              className="table-toolbar-icon-btn"
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              title="刷新"
              aria-label="刷新"
              loading={tab.loading}
              onMouseDownCapture={() => {
                onBeforePreviewRefresh(tab.key)
              }}
              onMouseDown={(event) => {
                event.stopPropagation()
                onDiscardInlineEditor(tab.key)
              }}
              onClick={() => onPreviewTableRefresh(tab)}
            />
            <Button
              className="table-toolbar-icon-btn"
              size="small"
              type="text"
              icon={<PlusOutlined />}
              title="新增行"
              aria-label="新增行"
              onMouseDown={handleToolbarButtonMouseDown}
              onClick={() => onAddPreviewRow(tab)}
            />
            <Button
              className="table-toolbar-icon-btn"
              size="small"
              type="text"
              icon={<MinusOutlined />}
              title="删除选中行"
              aria-label="删除选中行"
              disabled={!hasSelectedRows}
              onMouseDown={handleToolbarButtonMouseDown}
              onClick={() => onMarkSelectedRowsDeleted(tab)}
            />
            <Button
              className={`table-toolbar-icon-btn${pendingChanges > 0 ? ' is-pending-save' : ''}`}
              type="text"
              size="small"
              icon={<SaveOutlined />}
              title="提交"
              aria-label="提交"
              disabled={pendingChanges === 0}
              loading={tab.loading}
              onMouseDown={handleToolbarButtonMouseDown}
              onClick={() => onSubmitPreviewChanges(tab)}
            />
          </>
        )}
        {showQuerySubmit && (
          <Button
            className="table-toolbar-icon-btn is-pending-save"
            type="text"
            size="small"
            icon={<SaveOutlined />}
            title="提交"
            aria-label="提交"
            loading={tab.loading}
            onMouseDown={handleToolbarButtonMouseDown}
            onClick={() => onSubmitQueryChanges(tab)}
          />
        )}
      </Space>
    ) : null

  const rightActions =
    showPreviewSearch || showPreviewDdl || showDataExport ? (
      <Space size={4} className="table-toolbar-inline-actions">
        {showDataExport && (
          <Button
            size="small"
            type="text"
            icon={<DownloadOutlined />}
            title="导出数据"
            aria-label="导出数据"
            className="table-toolbar-icon-btn result-export-button"
            onClick={() => onExportData(tab)}
          />
        )}
        {showPreviewSearch && (
          <Button
            size="small"
            type="text"
            icon={<SearchOutlined />}
            title="页内搜索"
            aria-label="页内搜索"
            className={
              searchState.query.trim() || searchVisible
                ? 'table-toolbar-icon-btn table-toolbar-toggle is-active'
                : 'table-toolbar-icon-btn table-toolbar-toggle'
            }
            onMouseDown={handleSearchMouseDown}
            onClick={handleSearchClick}
          />
        )}
        {showPreviewDdl && (
          <Button
            size="small"
            type="text"
            title="查看 DDL"
            aria-label="查看 DDL"
            className="table-toolbar-icon-btn table-ddl-button"
            onClick={() => onShowObjectDdl(tab)}
          >
            DDL
          </Button>
        )}
      </Space>
    ) : null

  return (
    <ResultTableHeader
      leftActions={leftActions}
      whereInput={whereInput}
      rightActions={rightActions}
      searchState={searchState}
      searchMeta={searchMeta}
      onSearchStateChange={onSearchStateChange}
      onClearActiveHighlight={onClearActiveHighlight}
      searchVisible={Boolean(searchState.query.trim() || searchVisible)}
    />
  )
}

type RedisBrowserProps = {
  tab: WorkspaceTab
  rows: Record<string, unknown>[]
  edits: Record<string, RedisKeyEdit>
  statusBar: React.ReactNode
  toolbar: React.ReactNode
  onCloseError: (tabKey: string) => void
  onToggleRedisValue: (tabKey: string, rowKey: string) => void
  onUpdateRedisEdit: (tabKey: string, rowKey: string, patch: Partial<RedisKeyEdit>) => void
  onDeleteRedisRow: (tabKey: string, rowKey: string) => void
  redisTtlDisplay: (ttl: unknown) => string
}

export function RedisBrowserPanel({
  tab,
  rows,
  edits,
  statusBar,
  toolbar,
  onCloseError,
  onToggleRedisValue,
  onUpdateRedisEdit,
  onDeleteRedisRow,
  redisTtlDisplay
}: RedisBrowserProps): React.ReactNode {
  return (
    <div className={`result-table-shell${tab.kind === 'query' ? ' query-result-table-shell' : ''}`}>
      {statusBar}
      {toolbar}
      {tab.error && (
        <Alert
          className="result-inline-alert"
          message={tab.error}
          type="error"
          showIcon
          closable
          onClose={() => onCloseError(tab.key)}
        />
      )}
      <div className="result-table-content redis-result-table-content">
        <div className="redis-browser-list">
          {tab.loading && <Typography.Text type="secondary">加载中...</Typography.Text>}
          {!tab.loading && Object.values(edits).filter((edit) => !edit.deleted).length === 0 && (
            <Typography.Text type="secondary">当前 DB 暂无 Key</Typography.Text>
          )}
          {Object.values(edits).map((edit, index) => {
            if (edit.deleted) {
              return null
            }
            const sourceRow = rows[index] ?? {}
            const rowKey = edit.rowKey
            const expanded = Boolean(tab.redisExpandedValues?.[rowKey])
            return (
              <div
                className={`redis-key-card${edit.state ? ' redis-key-card-dirty' : ''}`}
                key={rowKey}
              >
                <button
                  className="redis-expand-button"
                  type="button"
                  onClick={() => onToggleRedisValue(tab.key, rowKey)}
                  aria-label={expanded ? '收起值' : '展开值'}
                >
                  {expanded ? <DownOutlined /> : <RightOutlined />}
                </button>
                <div className="redis-key-main">
                  <Flex align="center" gap={8} wrap="wrap">
                    <Input
                      size="small"
                      className="redis-key-input"
                      value={edit.key}
                      placeholder="Key"
                      onChange={(event) =>
                        onUpdateRedisEdit(tab.key, rowKey, { key: event.target.value })
                      }
                    />
                    <Select
                      size="small"
                      className="redis-type-select"
                      value={edit.type}
                      options={['string', 'hash', 'list', 'set', 'zset'].map((value) => ({
                        label: value,
                        value
                      }))}
                      onChange={(value) => onUpdateRedisEdit(tab.key, rowKey, { type: value })}
                    />
                    <InputNumber
                      size="small"
                      className="redis-ttl-input"
                      min={1}
                      placeholder="TTL 秒"
                      value={edit.ttl ?? null}
                      onChange={(value) =>
                        onUpdateRedisEdit(tab.key, rowKey, {
                          ttl: typeof value === 'number' ? value : null
                        })
                      }
                    />
                    {edit.state && <Tag color="orange">未提交</Tag>}
                    {!edit.state && sourceRow.ttl !== undefined && (
                      <Tag>{redisTtlDisplay(sourceRow.ttl)}</Tag>
                    )}
                    {sourceRow.length !== undefined && <Tag>长度 {String(sourceRow.length)}</Tag>}
                    {sourceRow.memory !== undefined && <Tag>内存 {String(sourceRow.memory)} B</Tag>}
                    <Button
                      className="redis-delete-button"
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label="删除"
                      title="删除"
                      onClick={() => onDeleteRedisRow(tab.key, rowKey)}
                    />
                  </Flex>
                  {expanded && (
                    <Input.TextArea
                      className="redis-value-editor"
                      value={edit.value}
                      autoSize={{ minRows: 4, maxRows: 14 }}
                      onChange={(event) =>
                        onUpdateRedisEdit(tab.key, rowKey, { value: event.target.value })
                      }
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
