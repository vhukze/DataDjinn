import { DownOutlined, FormatPainterOutlined, PlayCircleOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Dropdown, Select, Splitter } from 'antd'
import type { MenuProps } from 'antd'
import { memo, useEffect, useMemo, useRef } from 'react'
import SqlEditor from '../components/SqlEditor'
import type {
  SqlCompletionContext,
  SqlEditorHandle,
  SqlStatementInfo
} from '../components/SqlEditor'
import type { ConnectionInfo } from './connection-model'
import { getQuerySelectWidth } from './query-utils'
import type { SqlEditorExecutionContext, WorkspaceTab } from './workspace-model'

type ShortcutSettingsLike = {
  sql_execute: string
  sql_delete_line: string
  sql_duplicate_line_down: string
}

type QueryWorkspacePanelProps = {
  tab: WorkspaceTab
  theme: 'dark' | 'light'
  connection?: ConnectionInfo
  connections: ConnectionInfo[]
  allDatabases: Record<string, string[]>
  allSchemas: Record<string, string[]>
  shortcutSettings: ShortcutSettingsLike
  executionContext?: SqlEditorExecutionContext
  queryResultToggleRef: (element: HTMLButtonElement | null) => void
  getDefaultDatabaseName: (connection?: ConnectionInfo) => string | undefined
  getDefaultPgDatabase: (connection: ConnectionInfo) => string | undefined
  getDefaultPgSchema: (schemas: string[]) => string | undefined
  isSchemaScopedType: (databaseType?: ConnectionInfo['database_type']) => boolean
  isDatabaseScopedType: (databaseType?: ConnectionInfo['database_type']) => boolean
  ensureDatabasesLoaded: (connectionId: string) => Promise<void> | void
  ensureSchemasLoaded: (connectionId: string, pgDatabaseName: string) => Promise<string[]>
  preloadCompletionForDatabase: (
    connectionId: string,
    databaseName?: string
  ) => Promise<void> | void
  updateWorkspaceTab: (key: string, patch: Partial<WorkspaceTab>) => void
  renderResultTable: (tab: WorkspaceTab) => React.ReactNode
  runQuery: (tab: WorkspaceTab, sql?: string) => Promise<void> | void
  buildSqlCompletionContext: (tab: WorkspaceTab) => SqlCompletionContext
  scheduleQuerySqlDraftCommit: (tabKey: string, sql: string) => void
  handleSqlExecutionContextChange: (tabKey: string, payload: SqlEditorExecutionContext) => void
  onEditorReady: (tabKey: string, handle: SqlEditorHandle | null) => void
}

const SELECT_CONNECTION_PLACEHOLDER = '选择连接'
const SELECT_SCHEMA_PLACEHOLDER = '选择 Schema'
const SELECT_DATABASE_PLACEHOLDER = '选择 Database'
const SELECT_STORE_PLACEHOLDER = '选择数据库'
const SELECT_REDIS_DB_PLACEHOLDER = '选择 Redis DB'
const SELECT_LIBRARY_PLACEHOLDER = '选择库'
const EXECUTE_LABEL = '执行'
const COLLAPSE_RESULT_LABEL = '收起查询结果'
const EXPAND_RESULT_LABEL = '展开查询结果'
const EXECUTE_STATEMENT_ARIA_LABEL = '选择执行语句'

const QueryWorkspacePanel = memo(function QueryWorkspacePanel({
  tab,
  theme,
  connection,
  connections,
  allDatabases,
  allSchemas,
  shortcutSettings,
  executionContext,
  queryResultToggleRef,
  getDefaultDatabaseName,
  getDefaultPgDatabase,
  getDefaultPgSchema,
  isSchemaScopedType,
  isDatabaseScopedType,
  ensureDatabasesLoaded,
  ensureSchemasLoaded,
  preloadCompletionForDatabase,
  updateWorkspaceTab,
  renderResultTable,
  runQuery,
  buildSqlCompletionContext,
  scheduleQuerySqlDraftCommit,
  handleSqlExecutionContextChange,
  onEditorReady
}: QueryWorkspacePanelProps) {
  const statementToggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const sqlEditorHandleRef = useRef<SqlEditorHandle | null>(null)

  useEffect(() => {
    if (statementToggleButtonRef.current) {
      statementToggleButtonRef.current.dataset.activeStatementIndex = String(
        executionContext?.currentStatementIndex ?? -1
      )
    }
  }, [executionContext, tab.key])

  const isMysql = connection?.database_type === 'mysql'
  const isDm = connection?.database_type === 'dm'
  const isPg = isSchemaScopedType(connection?.database_type)
  const isMongo = connection?.database_type === 'mongodb'
  const isRedis = connection?.database_type === 'redis'
  const isClickHouse = connection?.database_type === 'clickhouse'
  const dbOptions = tab.connectionId ? (allDatabases[tab.connectionId] ?? []) : []
  const schemaKey =
    tab.connectionId && tab.pgDatabaseName ? `${tab.connectionId}:${tab.pgDatabaseName}` : ''
  const schemaOptions = schemaKey ? (allSchemas[schemaKey] ?? []) : []
  const databaseSelectPlaceholder = isPg
    ? SELECT_DATABASE_PLACEHOLDER
    : isDm || connection?.database_type === 'oracle'
      ? SELECT_SCHEMA_PLACEHOLDER
      : isMongo
        ? SELECT_STORE_PLACEHOLDER
        : isRedis
          ? SELECT_REDIS_DB_PLACEHOLDER
          : isClickHouse
            ? SELECT_STORE_PLACEHOLDER
            : SELECT_LIBRARY_PLACEHOLDER
  const connectionSelectWidth = useMemo(
    () =>
      getQuerySelectWidth(
        connections.map((item) => item.name),
        SELECT_CONNECTION_PLACEHOLDER
      ),
    [connections]
  )
  const databaseSelectWidth = useMemo(
    () => getQuerySelectWidth(dbOptions, databaseSelectPlaceholder),
    [databaseSelectPlaceholder, dbOptions]
  )
  const schemaSelectWidth = useMemo(
    () => getQuerySelectWidth(schemaOptions, SELECT_SCHEMA_PLACEHOLDER),
    [schemaOptions]
  )

  const resultVisible = Boolean(tab.resultVisible)
  const resultCollapsed = Boolean(tab.resultCollapsed)
  const resultPanelVisible = resultVisible && !resultCollapsed
  const queryEditorHeight = tab.queryEditorHeight ?? 280
  const activeStatementIndex = executionContext?.currentStatementIndex ?? -1
  const statementSource = useMemo(
    () =>
      (executionContext?.statements?.length ?? 0) > 0
        ? (executionContext?.statements ?? [])
        : tab.sql.trim()
          ? [buildSingleStatementFallback(tab.sql)]
          : [],
    [executionContext?.statements, tab.sql]
  )

  const statementMenuItems: MenuProps['items'] = useMemo(
    () =>
      statementSource.map((statement, index) => {
        const firstLine =
          statement.text
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean) ?? statement.text.trim()
        const compactTitle = firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine
        const isActive = activeStatementIndex === index
        return {
          key: String(index),
          label: (
            <div className={`query-statement-menu-item${isActive ? ' is-active' : ''}`}>
              <span className="query-statement-menu-title">
                {compactTitle || `SQL ${index + 1}`}
              </span>
              <span className="query-statement-menu-meta">
                第{statement.startLineNumber} 行
                {statement.endLineNumber > statement.startLineNumber
                  ? ` - ${statement.endLineNumber} 行`
                  : ''}
              </span>
            </div>
          )
        }
      }),
    [activeStatementIndex, statementSource]
  )

  return (
    <div className="query-workspace">
      <div className="query-toolbar">
        <div className="query-toolbar-main">
          <div className="query-toolbar-select-shell" style={{ width: connectionSelectWidth }}>
            <Select
              className="connection-select query-toolbar-select"
              placeholder={SELECT_CONNECTION_PLACEHOLDER}
              value={tab.connectionId}
              variant="borderless"
              popupClassName="query-toolbar-select-dropdown"
              classNames={{
                root: 'query-toolbar-select-root',
                popup: {
                  root: 'query-toolbar-select-dropdown'
                }
              }}
              style={{ width: '100%' }}
              onChange={(connectionId) => {
                const nextConn = connections.find((item) => item.connection_id === connectionId)
                void ensureDatabasesLoaded(connectionId)
                const nextDb =
                  isDatabaseScopedType(nextConn?.database_type) ||
                  nextConn?.database_type === 'dm' ||
                  nextConn?.database_type === 'oracle'
                    ? getDefaultDatabaseName(nextConn)
                    : undefined
                const nextPgDb =
                  nextConn && isSchemaScopedType(nextConn.database_type)
                    ? getDefaultPgDatabase(nextConn)
                    : undefined
                updateWorkspaceTab(tab.key, {
                  connectionId,
                  databaseName: nextDb,
                  pgDatabaseName: nextPgDb
                })

                if (
                  (nextConn?.database_type === 'sqlite' ||
                    isDatabaseScopedType(nextConn?.database_type) ||
                    nextConn?.database_type === 'dm' ||
                    nextConn?.database_type === 'oracle') &&
                  (nextDb || nextConn?.database_type === 'sqlite')
                ) {
                  void preloadCompletionForDatabase(connectionId, nextDb)
                }
              }}
              options={connections.map((item) => ({ label: item.name, value: item.connection_id }))}
            />
          </div>
          {(isMysql ||
            isPg ||
            isDm ||
            connection?.database_type === 'oracle' ||
            isMongo ||
            isRedis ||
            isClickHouse) && (
            <div className="query-toolbar-select-shell" style={{ width: databaseSelectWidth }}>
              <Select
                className="database-select query-toolbar-select"
                placeholder={databaseSelectPlaceholder}
                value={isPg ? tab.pgDatabaseName || undefined : tab.databaseName || undefined}
                variant="borderless"
                popupClassName="query-toolbar-select-dropdown"
                classNames={{
                  root: 'query-toolbar-select-root',
                  popup: {
                    root: 'query-toolbar-select-dropdown'
                  }
                }}
                style={{ width: '100%' }}
                onChange={async (value) => {
                  if (isPg && tab.connectionId) {
                    const schemaNames = await ensureSchemasLoaded(tab.connectionId, value)
                    const defaultSchema = getDefaultPgSchema(schemaNames)
                    updateWorkspaceTab(tab.key, {
                      pgDatabaseName: value,
                      databaseName: defaultSchema
                    })
                    return
                  }

                  updateWorkspaceTab(tab.key, { databaseName: value })
                  if (tab.connectionId && !isDm && connection?.database_type !== 'oracle') {
                    void preloadCompletionForDatabase(tab.connectionId, value)
                  }
                }}
                onDropdownVisibleChange={(open) => {
                  if (open && tab.connectionId) {
                    void ensureDatabasesLoaded(tab.connectionId)
                  }
                }}
                options={dbOptions.map((name) => ({ label: name, value: name }))}
              />
            </div>
          )}
          {isPg && tab.pgDatabaseName && (
            <div className="query-toolbar-select-shell" style={{ width: schemaSelectWidth }}>
              <Select
                className="schema-select query-toolbar-select"
                placeholder={SELECT_SCHEMA_PLACEHOLDER}
                value={tab.databaseName || undefined}
                variant="borderless"
                popupClassName="query-toolbar-select-dropdown"
                classNames={{
                  root: 'query-toolbar-select-root',
                  popup: {
                    root: 'query-toolbar-select-dropdown'
                  }
                }}
                style={{ width: '100%' }}
                onChange={(value) => updateWorkspaceTab(tab.key, { databaseName: value })}
                options={schemaOptions.map((name) => ({ label: name, value: name }))}
              />
            </div>
          )}
        </div>
        <div className="query-toolbar-actions">
          <div className="query-execute-group">
            <Button
              className="query-format-button"
              icon={<FormatPainterOutlined />}
              aria-label="格式化 SQL"
              title="格式化选中内容或当前语句"
              onClick={() => sqlEditorHandleRef.current?.formatSelectionOrStatement()}
            />
            <Button
              className="query-execute-button"
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={tab.loading}
              onClick={() => void runQuery(tab)}
            >
              {EXECUTE_LABEL}
            </Button>
            {statementMenuItems.length > 0 && (
              <Dropdown
                trigger={['click']}
                overlayClassName="query-execute-dropdown"
                transitionName=""
                destroyOnHidden
                menu={{
                  items: statementMenuItems,
                  onClick: ({ key }) => {
                    const targetStatement = statementSource[Number(key)]
                    if (targetStatement) {
                      void runQuery(tab, targetStatement.text)
                    }
                  }
                }}
              >
                <Button
                  ref={statementToggleButtonRef}
                  className="query-execute-dropdown-button"
                  type="primary"
                  icon={<DownOutlined />}
                  aria-label={EXECUTE_STATEMENT_ARIA_LABEL}
                  data-active-statement-index={activeStatementIndex}
                />
              </Dropdown>
            )}
          </div>
        </div>
      </div>
      <div className={`query-splitter-wrap${resultPanelVisible ? '' : ' is-result-hidden'}`}>
        <button
          type="button"
          className={`query-result-toggle query-result-toggle-collapse${resultPanelVisible ? '' : ' is-hidden'}`}
          style={{ top: `${Math.max(44, queryEditorHeight)}px` }}
          ref={queryResultToggleRef}
          onClick={() => updateWorkspaceTab(tab.key, { resultCollapsed: true })}
          aria-label={COLLAPSE_RESULT_LABEL}
          title={COLLAPSE_RESULT_LABEL}
        >
          <DownOutlined />
        </button>
        <Splitter
          className={`query-body-splitter${resultPanelVisible ? '' : ' is-result-hidden'}`}
          layout="vertical"
          onResize={(sizes) => {
            const nextHeight = sizes[0]
            if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
              const toggle = document.querySelector<HTMLButtonElement>(
                `button.query-result-toggle-collapse[title="${COLLAPSE_RESULT_LABEL}"]`
              )
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
          <Splitter.Panel
            defaultSize={queryEditorHeight}
            min={160}
            max="75%"
            className="sql-editor-panel"
          >
            <div className="query-surface query-editor-surface">
              <div className="sql-editor-container">
                <SqlEditor
                  value={tab.sql}
                  onChange={(sql) => scheduleQuerySqlDraftCommit(tab.key, sql)}
                  onExecute={(payload) => void runQuery(tab, payload.sql)}
                  onSelectionChange={(payload) => {
                    if (statementToggleButtonRef.current) {
                      statementToggleButtonRef.current.dataset.activeStatementIndex = String(
                        payload.currentStatementIndex
                      )
                    }
                    handleSqlExecutionContextChange(tab.key, payload)
                  }}
                  onReady={(handle) => {
                    sqlEditorHandleRef.current = handle
                    onEditorReady(tab.key, handle)
                  }}
                  theme={theme}
                  completionContext={buildSqlCompletionContext(tab)}
                  shortcuts={{
                    execute: shortcutSettings.sql_execute,
                    deleteLine: shortcutSettings.sql_delete_line,
                    duplicateLineDown: shortcutSettings.sql_duplicate_line_down
                  }}
                />
              </div>
            </div>
          </Splitter.Panel>
          <Splitter.Panel min={120} className="query-result-splitter-panel">
            <div className="query-surface query-result-surface">
              <div className="query-result-panel">{renderResultTable(tab)}</div>
            </div>
          </Splitter.Panel>
        </Splitter>
      </div>
      {resultVisible && resultCollapsed && (
        <button
          type="button"
          className="query-result-toggle query-result-toggle-expand"
          onClick={() => updateWorkspaceTab(tab.key, { resultCollapsed: false })}
          aria-label={EXPAND_RESULT_LABEL}
          title={EXPAND_RESULT_LABEL}
        >
          <UpOutlined />
        </button>
      )}
    </div>
  )
})

const buildSingleStatementFallback = (sql: string): SqlStatementInfo => ({
  text: sql,
  start: 0,
  end: sql.length,
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: sql.split('\n').length,
  endColumn: (sql.split('\n').at(-1)?.length ?? 0) + 1
})

export default QueryWorkspacePanel
