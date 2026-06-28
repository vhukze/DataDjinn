import { memo, useMemo } from 'react'
import AIPanel from '../components/AIPanel'
import type { ConnectionInfo } from './connection-model'
import type { AIContextSource, AIWorkspaceAction } from './workspace-model'
import { useWorkspaceStore } from './workspace-store'

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
  removeAIContextSource: (sourceId: string) => void
  handleAiPanelWorkspaceAction: (action: AIWorkspaceAction) => void
  handleAiPanelAgentDataChanged: () => void
  shortcutSend: string
  shortcutNewline: string
  shortcutStop: string
}

const MemoAIPanel = memo(AIPanel, (prev, next) => (
  prev.requestJson === next.requestJson
  && prev.connectionContext === next.connectionContext
  && prev.workspace === next.workspace
  && prev.contextSources === next.contextSources
  && prev.primaryContextSourceId === next.primaryContextSourceId
))

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
  removeAIContextSource,
  handleAiPanelWorkspaceAction,
  handleAiPanelAgentDataChanged,
  shortcutSend,
  shortcutNewline,
  shortcutStop
}: AIDockPanelHostProps) {
  const activeTabKey = useWorkspaceStore((state) => state.activeTabKey)

  const activeTab = useMemo(
    () => (activeTabKey ? useWorkspaceStore.getState().getTabByKey(activeTabKey) : undefined),
    [activeTabKey]
  )
  const recentQueries = useMemo(
    () => useWorkspaceStore.getState().getRecentQuerySql(),
    [activeTabKey, activeTab?.sql]
  )

  const aiWorkspacePayload = useMemo(() => ({
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
    recent_queries: recentQueries,
    context_sources: effectiveAIContextSources
  }), [
    activeTab?.kind,
    activeTab?.sql,
    activeTab?.tableName,
    aiContextConnection?.database_type,
    aiContextConnection?.name,
    aiContextConnection?.server_version,
    aiDatabase,
    aiPgDatabase,
    connectionSummaries,
    effectiveAIContextSources,
    focusedResource,
    recentQueries
  ])

  const connectionContext = useMemo(() => ({
    connectionId: aiContextConnection?.is_open ? aiContextConnection.connection_id : undefined,
    dbType: aiContextConnection?.database_type,
    dbName: aiDbName,
    database: aiDatabase,
    pgDatabase: aiPgDatabase,
    connectionName: aiContextConnection?.name,
    serverVersion: aiContextConnection?.server_version
  }), [
    aiContextConnection,
    aiDbName,
    aiDatabase,
    aiPgDatabase
  ])

  return (
    <MemoAIPanel
      requestJson={requestJson}
      connectionContext={connectionContext}
      workspace={aiWorkspacePayload}
      contextSources={effectiveAIContextSources}
      primaryContextSourceId={primaryAIContextSource?.id}
      onRemoveContextSource={removeAIContextSource}
      onWorkspaceAction={handleAiPanelWorkspaceAction}
      onAgentDataChanged={handleAiPanelAgentDataChanged}
      shortcuts={{
        send: shortcutSend,
        newline: shortcutNewline,
        stop: shortcutStop
      }}
    />
  )
})

export default AIDockPanelHost
