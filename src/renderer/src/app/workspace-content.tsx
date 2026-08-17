import { lazy, Suspense, type ReactNode } from 'react'
import type { ConnectionInfo } from './connection-model'
import type { SqlCompletionContext, SqlEditorHandle } from '../components/SqlEditor'
import type { SqlEditorExecutionContext, WorkspaceTab } from './workspace-model'

const QueryWorkspacePanel = lazy(() => import('./query-workspace-panel'))

type ShortcutSettingsLike = {
  sql_execute: string
  sql_delete_line: string
  sql_duplicate_line_down: string
}

type RenderWorkspaceTabOptions = {
  tab: WorkspaceTab
  theme: 'dark' | 'light'
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  connections: ConnectionInfo[]
  allDatabases: Record<string, string[]>
  allSchemas: Record<string, string[]>
  shortcutSettings: ShortcutSettingsLike
  executionContext?: SqlEditorExecutionContext
  setQueryResultToggleRef: (tabKey: string, element: HTMLButtonElement | null) => void
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
  renderResultTable: (tab: WorkspaceTab) => ReactNode
  runQuery: (tab: WorkspaceTab, sql?: string) => Promise<void> | void
  buildSqlCompletionContext: (tab: WorkspaceTab) => SqlCompletionContext
  scheduleQuerySqlDraftCommit: (tabKey: string, sql: string) => void
  handleSqlExecutionContextChange: (tabKey: string, payload: SqlEditorExecutionContext) => void
  setSqlEditorHandle: (tabKey: string, handle: SqlEditorHandle | null) => void
}

export const renderWorkspaceTabContent = ({
  tab,
  theme,
  getConnection,
  connections,
  allDatabases,
  allSchemas,
  shortcutSettings,
  executionContext,
  setQueryResultToggleRef,
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
  setSqlEditorHandle
}: RenderWorkspaceTabOptions): ReactNode => {
  if (tab.kind === 'table-list') {
    return <div className="query-workspace">{renderResultTable(tab)}</div>
  }

  if (tab.kind === 'query') {
    return (
      <Suspense fallback={<div className="deferred-modal-loading">正在加载 SQL 工作区...</div>}>
        <QueryWorkspacePanel
          tab={tab}
          theme={theme}
          connection={getConnection(tab.connectionId)}
          connections={connections}
          allDatabases={allDatabases}
          allSchemas={allSchemas}
          shortcutSettings={shortcutSettings}
          executionContext={executionContext}
          queryResultToggleRef={(element) => setQueryResultToggleRef(tab.key, element)}
          getDefaultDatabaseName={getDefaultDatabaseName}
          getDefaultPgDatabase={getDefaultPgDatabase}
          getDefaultPgSchema={getDefaultPgSchema}
          isSchemaScopedType={isSchemaScopedType}
          isDatabaseScopedType={isDatabaseScopedType}
          ensureDatabasesLoaded={ensureDatabasesLoaded}
          ensureSchemasLoaded={ensureSchemasLoaded}
          preloadCompletionForDatabase={preloadCompletionForDatabase}
          updateWorkspaceTab={updateWorkspaceTab}
          renderResultTable={renderResultTable}
          runQuery={runQuery}
          buildSqlCompletionContext={buildSqlCompletionContext}
          scheduleQuerySqlDraftCommit={scheduleQuerySqlDraftCommit}
          handleSqlExecutionContextChange={handleSqlExecutionContextChange}
          onEditorReady={(tabKey, handle) => setSqlEditorHandle(tabKey, handle)}
        />
      </Suspense>
    )
  }

  return <div className="query-workspace">{renderResultTable(tab)}</div>
}
