import type { ConnectionInfo } from './connection-model'
import type { DatabaseTreeNode } from './tree-model'
import type { DatabaseType } from './data-sources'
import { updateTreeNode } from './tree-model'

type TreeRefreshOptions = {
  connectionId: string
  selectedDatabaseOverride?: string[]
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  expandedKeys: React.Key[]
  preloadConnectionTree: (
    connection: ConnectionInfo,
    selectedDatabaseOverride?: string[]
  ) => Promise<DatabaseTreeNode[]>
  buildConnectionNode: (connection: ConnectionInfo) => DatabaseTreeNode
  setTreeData: React.Dispatch<React.SetStateAction<DatabaseTreeNode[]>>
  setExpandedKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
  setConnectionTreeLoadingText: (connectionId: string, text?: string) => void
  showError: (error: unknown, fallback?: string) => void
}

type DatabaseRefreshOptions = {
  connectionId: string
  databaseName: string
  selectedSchemaOverride?: string[]
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  preloadDatabaseChildren: (
    connection: ConnectionInfo,
    databaseName: string,
    selectedSchemaOverride?: string[]
  ) => Promise<DatabaseTreeNode[]>
  setTreeData: React.Dispatch<React.SetStateAction<DatabaseTreeNode[]>>
  setConnectionTreeLoadingText: (connectionId: string, text?: string) => void
  showError: (error: unknown, fallback?: string) => void
}

const DATABASE_LEVEL_TYPES = new Set<DatabaseType>([
  'mysql',
  'postgresql',
  'dm',
  'gaussdb',
  'oracle',
  'mongodb',
  'redis',
  'clickhouse'
])

export const refreshConnectionTreeNode = ({
  connectionId,
  selectedDatabaseOverride,
  getConnection,
  expandedKeys,
  preloadConnectionTree,
  buildConnectionNode,
  setTreeData,
  setExpandedKeys,
  setConnectionTreeLoadingText,
  showError
}: TreeRefreshOptions): void => {
  const connection = getConnection(connectionId)
  if (!connection) {
    return
  }

  void (async () => {
    setConnectionTreeLoadingText(connectionId, '正在刷新连接...')
    try {
      const connectionKey = `connection:${connectionId}`
      const snapshot = expandedKeys.map(String)

      if (DATABASE_LEVEL_TYPES.has(connection.database_type)) {
        const databaseNodes = await preloadConnectionTree(connection, selectedDatabaseOverride)
        const selectedNames = new Set(
          databaseNodes.map((node) => node.databaseName).filter(Boolean)
        )
        const stillExpanded = snapshot.filter((key) => {
          if (key === connectionKey) {
            return false
          }
          if (key.startsWith(`database:${connectionId}:`)) {
            if (connection.database_type === 'redis') {
              return false
            }
            const dbName = key.slice(`database:${connectionId}:`.length).split(':')[0]
            return selectedNames.has(dbName)
          }
          return (
            key.startsWith(`pg-schema:${connectionId}:`) ||
            key.startsWith(`object-group:${connectionId}:`) ||
            key.startsWith(`table:${connectionId}:`)
          )
        })
        setExpandedKeys(Array.from(new Set([connectionKey, ...stillExpanded])))
        return
      }

      setTreeData((current) =>
        current.map((node) => {
          if (node.key === connectionKey) {
            const nextChildren = buildConnectionNode(connection).children
            return { ...node, children: nextChildren, childrenLoaded: Boolean(nextChildren) }
          }
          return node
        })
      )
    } catch (error) {
      showError(error instanceof Error ? error.message : '刷新连接失败')
    } finally {
      setConnectionTreeLoadingText(connectionId)
    }
  })()
}

export const refreshDatabaseTreeNode = ({
  connectionId,
  databaseName,
  selectedSchemaOverride,
  getConnection,
  preloadDatabaseChildren,
  setTreeData,
  setConnectionTreeLoadingText,
  showError
}: DatabaseRefreshOptions): void => {
  const connection = getConnection(connectionId)
  if (!connection) {
    return
  }

  void (async () => {
    setConnectionTreeLoadingText(connectionId, '正在加载表列表...')
    try {
      const children = await preloadDatabaseChildren(
        connection,
        databaseName,
        selectedSchemaOverride
      )
      setTreeData((current) =>
        updateTreeNode(current, `database:${connectionId}:${databaseName}`, children)
      )
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载表列表失败')
    } finally {
      setConnectionTreeLoadingText(connectionId)
    }
  })()
}
