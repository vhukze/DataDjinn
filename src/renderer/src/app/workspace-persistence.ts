import type { ConnectionInfo } from './connection-model'
import type { PersistedQueryWorkspace, WorkspaceTab } from './workspace-model'

export const buildPersistedQueryWorkspace = (
  tab: WorkspaceTab,
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
): PersistedQueryWorkspace | undefined => {
  if (tab.kind !== 'query') {
    return undefined
  }

  const sql = tab.sql ?? ''
  const connection = getConnection(tab.connectionId)
  return {
    key: tab.key,
    title: tab.title,
    connectionId: tab.connectionId,
    connectionName: connection?.name,
    databaseName: tab.databaseName,
    pgDatabaseName: tab.pgDatabaseName,
    sql,
    limit: tab.limit,
    queryEditorHeight: tab.queryEditorHeight,
    persistedAt: tab.persistedAt ?? Date.now()
  }
}

export const isSamePersistedQueryWorkspace = (
  left: PersistedQueryWorkspace,
  right: PersistedQueryWorkspace
): boolean => (
  left.title === right.title
  && left.connectionId === right.connectionId
  && left.connectionName === right.connectionName
  && left.databaseName === right.databaseName
  && left.pgDatabaseName === right.pgDatabaseName
  && left.sql === right.sql
  && left.limit === right.limit
  && left.queryEditorHeight === right.queryEditorHeight
)

export const upsertPersistedQueryWorkspace = (
  current: PersistedQueryWorkspace[],
  nextItem: PersistedQueryWorkspace,
  maxItems = 200
): PersistedQueryWorkspace[] => {
  const currentItem = current.find((item) => item.key === nextItem.key)
  if (currentItem && isSamePersistedQueryWorkspace(currentItem, nextItem)) {
    return current
  }
  return [nextItem, ...current.filter((item) => item.key !== nextItem.key)].slice(0, maxItems)
}
