import { lazy, memo, Suspense, useCallback } from 'react'
import type { ConnectionInfo } from './connection-model'
import type { AIContextSource, AIWorkspaceAction } from './workspace-model'
import { useWorkspaceStore } from './workspace-store'

const AIPanel = lazy(() => import('../components/AIPanel'))

type FocusedResource = {
  kind: string
  connectionId?: string
  connectionName?: string
  dbType?: string
  database?: string
  schema?: string
  pgDatabase?: string
  table?: string
  objectType?: string
  name?: string
  sizeDisplay?: string | null
  rowCount?: number | null
}

type ConnectionSummary = {
  connectionId: string
  name: string
  dbType: string
  database?: string
  isOpen: boolean
  serverVersion?: string | null
}

type AIDockPanelHostProps = {
  requestJson: <T>(path: string, options?: RequestInit) => Promise<T>
  aiContextConnection?: ConnectionInfo
  aiDbName?: string
  aiDatabase?: string
  aiPgDatabase?: string
  focusedResource?: FocusedResource
  connectionSummaries: ConnectionSummary[]
  effectiveAIContextSources: AIContextSource[]
  primaryAIContextSource?: AIContextSource
  executionAIContextSource?: AIContextSource
  removeAIContextSource: (sourceId: string) => void
  handleAiPanelWorkspaceAction: (action: AIWorkspaceAction) => void
  handleAiPanelAgentDataChanged: () => void
  shortcutSend: string
  shortcutNewline: string
  shortcutStop: string
}

const MemoAIPanel = memo(
  AIPanel,
  (prev, next) =>
    prev.requestJson === next.requestJson &&
    prev.hasDatabaseContext === next.hasDatabaseContext &&
    prev.getConnectionContext === next.getConnectionContext &&
    prev.getWorkspaceSnapshot === next.getWorkspaceSnapshot &&
    prev.contextSources === next.contextSources &&
    prev.primaryContextSourceId === next.primaryContextSourceId &&
    prev.executionContextSourceId === next.executionContextSourceId
)

const AIDockPanelHost = memo(function AIDockPanelHost({
  requestJson,
  aiContextConnection,
  aiDbName,
  aiDatabase,
  aiPgDatabase,
  focusedResource,
  connectionSummaries,
  effectiveAIContextSources,
  primaryAIContextSource,
  executionAIContextSource,
  removeAIContextSource,
  handleAiPanelWorkspaceAction,
  handleAiPanelAgentDataChanged,
  shortcutSend,
  shortcutNewline,
  shortcutStop
}: AIDockPanelHostProps) {
  const getWorkspaceSnapshot = useCallback(() => {
    const workspaceState = useWorkspaceStore.getState()
    const activeTab = workspaceState.activeTabKey
      ? workspaceState.getTabByKey(workspaceState.activeTabKey)
      : undefined
    return {
      active_sql: activeTab?.sql,
      active_tab_kind: activeTab?.kind,
      selected_table: activeTab?.tableName,
      current_connection_name: aiContextConnection?.name,
      current_db_type: aiContextConnection?.database_type,
      current_server_version: aiContextConnection?.server_version,
      current_database: aiDatabase,
      current_pg_database: aiPgDatabase,
      focused_resource: focusedResource,
      connections: connectionSummaries,
      recent_queries: workspaceState.getRecentQuerySql(),
      context_sources: effectiveAIContextSources
    }
  }, [
    aiContextConnection?.database_type,
    aiContextConnection?.name,
    aiContextConnection?.server_version,
    aiDatabase,
    aiPgDatabase,
    connectionSummaries,
    effectiveAIContextSources,
    focusedResource
  ])

  const hasDatabaseContext = Boolean(
    aiContextConnection?.connection_id
  )
  const getConnectionContext = useCallback(
    () => ({
      connectionId: aiContextConnection?.connection_id,
      dbType: aiContextConnection?.database_type,
      dbName: aiDbName,
      database: aiDatabase,
      pgDatabase: aiPgDatabase,
      connectionName: aiContextConnection?.name,
      serverVersion: aiContextConnection?.server_version
    }),
    [
      aiContextConnection?.connection_id,
      aiContextConnection?.database_type,
      aiContextConnection?.name,
      aiContextConnection?.server_version,
      aiDbName,
      aiDatabase,
      aiPgDatabase
    ]
  )

  return (
    <Suspense fallback={<div className="deferred-modal-loading">正在加载 AI 面板...</div>}>
      <MemoAIPanel
        requestJson={requestJson}
        hasDatabaseContext={hasDatabaseContext}
        getConnectionContext={getConnectionContext}
        getWorkspaceSnapshot={getWorkspaceSnapshot}
        contextSources={effectiveAIContextSources}
        primaryContextSourceId={primaryAIContextSource?.id}
        executionContextSourceId={executionAIContextSource?.id}
        onRemoveContextSource={removeAIContextSource}
        onWorkspaceAction={handleAiPanelWorkspaceAction}
        onAgentDataChanged={handleAiPanelAgentDataChanged}
        shortcuts={{
          send: shortcutSend,
          newline: shortcutNewline,
          stop: shortcutStop
        }}
      />
    </Suspense>
  )
})

export default AIDockPanelHost
