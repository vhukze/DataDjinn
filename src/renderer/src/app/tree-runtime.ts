import type { MutableRefObject } from 'react'
import type { ConnectionInfo, ColumnInfo, DatabaseInfo, DbObjectInfo } from './connection-model'
import type { DatabaseType } from './data-sources'
import type { ConnectionTypeIcons } from './tree-builders'
import {
  buildConnectionNode as buildConnectionNodeFromModule,
  buildDatabaseNode as buildDatabaseNodeFromModule,
  buildObjectGroupNodes as buildObjectGroupNodesFromModule,
  buildPgSchemaNode as buildPgSchemaNodeFromModule
} from './tree-builders'
import {
  DB_OBJECT_GROUP_BY_TYPE,
  collectTreeNodesByKey,
  isLoadableTreeNode,
  isTreeNodeChildrenLoaded,
  plainObjectIconByType,
  updateTreeNode,
  type DatabaseTreeNode,
  type DbObjectType
} from './tree-model'

export const filterPersistedTreeValues = (persisted: string[], available: string[]): string[] => {
  const filtered = persisted.filter((value) => available.includes(value))
  return filtered.length > 0 ? filtered : available
}

export const getDefaultSelectedDatabases = (
  connection: ConnectionInfo,
  available: string[],
  databases: DatabaseInfo[] = []
): string[] => {
  if (connection.database_type === 'redis') {
    const nonEmpty = databases
      .filter((database) => (database.size_bytes ?? 0) > 0)
      .map((database) => database.name)
    const configured = connection.database?.split('@')[0]
    if (configured && available.includes(configured) && !nonEmpty.includes(configured)) {
      nonEmpty.unshift(configured)
    }
    return nonEmpty.length > 0 ? nonEmpty : available.slice(0, 1)
  }

  if (connection.database_type === 'oracle') {
    return available.slice(0, 1)
  }

  const configured = connection.database?.split('@')[0]
  return configured && available.includes(configured) ? [configured] : available
}

export const getVisibleConnectionIdsFromTree = (
  treeData: DatabaseTreeNode[],
  expandedKeys: React.Key[]
): string[] => {
  const result: string[] = []
  for (const node of treeData) {
    if (node.kind === 'connection' && node.connectionId) {
      result.push(node.connectionId)
      continue
    }
    if (node.kind === 'folder' && node.folderId && expandedKeys.includes(node.key as React.Key)) {
      for (const child of node.children ?? []) {
        if (child.kind === 'connection' && child.connectionId) {
          result.push(child.connectionId)
        }
      }
    }
  }
  return result
}

export const buildTreeConnectionNode = (
  connection: ConnectionInfo,
  connectionTypeIcons: ConnectionTypeIcons
): DatabaseTreeNode => buildConnectionNodeFromModule(connection, connectionTypeIcons)

export const buildTreeDatabaseNode = (
  connection: ConnectionInfo,
  database: DatabaseInfo
): DatabaseTreeNode => buildDatabaseNodeFromModule(connection, database)

export const buildTreePgSchemaNode = (
  connection: ConnectionInfo,
  pgDatabaseName: string,
  schema: DatabaseInfo
): DatabaseTreeNode => buildPgSchemaNodeFromModule(connection, pgDatabaseName, schema)

export const buildTreeObjectGroupNodes = (
  connectionId: string,
  databaseType: DatabaseType,
  databaseName?: string,
  pgDatabaseName?: string
): DatabaseTreeNode[] =>
  buildObjectGroupNodesFromModule(connectionId, databaseType, databaseName, pgDatabaseName)

type TreeRuntimeDeps = {
  requestJson: <T>(path: string, options?: RequestInit) => Promise<T>
  withPgDatabase: (path: string, databaseName?: string, pgDatabaseName?: string) => string
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  isSchemaScopedType: (databaseType?: DatabaseType) => boolean
  preloadCompletionForDatabase: (connectionId: string, databaseName: string) => Promise<void>
  setAllDatabases: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  setSelectedDatabases: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  selectedDatabasesRef: MutableRefObject<Record<string, string[]>>
  setAllSchemas: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  setSelectedSchemas: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  selectedSchemasRef: MutableRefObject<Record<string, string[]>>
  setTreeData: React.Dispatch<React.SetStateAction<DatabaseTreeNode[]>>
  treeDataRef: MutableRefObject<DatabaseTreeNode[]>
  treeLoadingKeysRef: MutableRefObject<Set<React.Key>>
  expandedKeysRef: MutableRefObject<React.Key[]>
  setExpandedKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
  captureTreeScrollPosition?: () => () => void
  notifyTreeLoadingStateChanged: () => void
  showError: (error: unknown, fallback?: string) => void
  connectionTypeIcons: ConnectionTypeIcons
}

export type TreeRuntimeApi = {
  objectNodesForGroup: (
    connectionId: string,
    objectType: DbObjectType,
    databaseName?: string,
    pgDatabaseName?: string
  ) => Promise<DatabaseTreeNode[]>
  preloadObjectGroupNodes: (
    connectionId: string,
    databaseName?: string,
    pgDatabaseName?: string,
    databaseType?: DatabaseType
  ) => Promise<DatabaseTreeNode[]>
  preloadDatabaseChildren: (
    connection: ConnectionInfo,
    databaseName: string,
    selectedSchemaOverride?: string[]
  ) => Promise<DatabaseTreeNode[]>
  preloadConnectionTree: (
    connection: ConnectionInfo,
    selectedDatabaseOverride?: string[]
  ) => Promise<DatabaseTreeNode[]>
  loadChildrenForNode: (node: DatabaseTreeNode) => Promise<DatabaseTreeNode[]>
  reloadNodeChildren: (node: DatabaseTreeNode, expand?: boolean) => Promise<void>
  setTreeDataSnapshot: (nextTreeData: DatabaseTreeNode[]) => void
  updateTreeNodeSnapshot: (key: React.Key, children: DatabaseTreeNode[]) => void
  ensureQueryContextTreeExpanded: (
    connection: ConnectionInfo,
    databaseName?: string,
    pgDatabaseName?: string
  ) => Promise<void>
  collapseTreeNode: (node: DatabaseTreeNode) => void
  toggleOrLoadTreeNode: (node: DatabaseTreeNode) => void
}

export const createTreeRuntime = (deps: TreeRuntimeDeps): TreeRuntimeApi => {
  const buildConnectionNode = (connection: ConnectionInfo): DatabaseTreeNode =>
    buildTreeConnectionNode(connection, deps.connectionTypeIcons)

  const buildDatabaseNode = (
    connection: ConnectionInfo,
    database: DatabaseInfo
  ): DatabaseTreeNode => buildTreeDatabaseNode(connection, database)

  const buildPgSchemaNode = (
    connection: ConnectionInfo,
    pgDatabaseName: string,
    schema: DatabaseInfo
  ): DatabaseTreeNode => buildTreePgSchemaNode(connection, pgDatabaseName, schema)

  const buildObjectGroupNodes = (
    connectionId: string,
    databaseName?: string,
    pgDatabaseName?: string,
    databaseType?: DatabaseType
  ): DatabaseTreeNode[] =>
    buildTreeObjectGroupNodes(
      connectionId,
      databaseType ?? deps.getConnection(connectionId)?.database_type ?? 'sqlite',
      databaseName,
      pgDatabaseName
    )

  const objectGroupCacheKey = (
    connectionId: string,
    objectType: DbObjectType,
    databaseName?: string,
    pgDatabaseName?: string
  ): string => `${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${objectType}`

  const objectGroupChildrenCache = new Map<string, DatabaseTreeNode[]>()
  const objectGroupChildrenPromiseCache = new Map<string, Promise<DatabaseTreeNode[]>>()
  const tableStatsPromiseCache = new Map<string, Promise<void>>()
  const TABLE_STATS_DATABASE_TYPES = new Set<DatabaseType>([
    'mysql',
    'postgresql',
    'dm',
    'gaussdb',
    'oracle',
    'mongodb',
    'redis',
    'clickhouse'
  ])

  const tableObjectRequestPath = (
    connectionId: string,
    databaseName?: string,
    pgDatabaseName?: string
  ): string => {
    const path = deps.withPgDatabase(
      `/connections/${connectionId}/objects`,
      databaseName,
      pgDatabaseName
    )
    return `${path}${databaseName || pgDatabaseName ? '&' : '?'}type=table`
  }

  const loadTableStats = (
    cacheKey: string,
    connectionId: string,
    databaseName: string | undefined,
    pgDatabaseName: string | undefined,
    initialChildren: DatabaseTreeNode[]
  ): void => {
    if (tableStatsPromiseCache.has(cacheKey)) {
      return
    }

    const groupKey = `object-group:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:table`
    const clearLoadingState = (children: DatabaseTreeNode[]): DatabaseTreeNode[] =>
      children.map((child) =>
        child.kind === 'table' ? { ...child, sizeLoading: false } : child
      )
    const statsPromise = deps
      .requestJson<{ objects: DbObjectInfo[] }>(
        `${tableObjectRequestPath(connectionId, databaseName, pgDatabaseName)}&include_stats=true`
      )
      .then(({ objects }) => {
        const statsByName = new Map(objects.map((object) => [object.name, object]))
        const nextChildren = initialChildren.map((child) => {
          if (child.kind !== 'table' || !child.tableName) {
            return child
          }
          const stats = statsByName.get(child.tableName)
          return {
            ...child,
            sizeDisplay: stats?.size_display ?? null,
            sizeBytes: stats?.size_bytes ?? null,
            storageSizeDisplay: stats?.storage_size_display ?? null,
            storageSizeBytes: stats?.storage_size_bytes ?? null,
            rowCount: stats?.row_count ?? null,
            sizeLoading: false
          }
        })
        objectGroupChildrenCache.set(cacheKey, nextChildren)
        deps.setTreeData((current) => {
          const next = updateTreeNode(current, groupKey, nextChildren)
          deps.treeDataRef.current = next
          return next
        })
      })
      .catch(() => {
        const nextChildren = clearLoadingState(initialChildren)
        objectGroupChildrenCache.set(cacheKey, nextChildren)
        deps.setTreeData((current) => {
          const next = updateTreeNode(current, groupKey, nextChildren)
          deps.treeDataRef.current = next
          return next
        })
      })
      .finally(() => {
        tableStatsPromiseCache.delete(cacheKey)
      })

    tableStatsPromiseCache.set(cacheKey, statsPromise)
  }

  const prefetchSqliteObjectGroups = (connectionId: string): void => {
    const connection = deps.getConnection(connectionId)
    if (connection?.database_type !== 'sqlite') {
      return
    }

    for (const objectType of ['view', 'trigger', 'index'] as const) {
      const cacheKey = objectGroupCacheKey(connectionId, objectType)
      if (objectGroupChildrenCache.has(cacheKey) || objectGroupChildrenPromiseCache.has(cacheKey)) {
        continue
      }
      void objectNodesForGroup(connectionId, objectType)
    }
  }

  const getCachedObjectGroupChildren = (node: DatabaseTreeNode): DatabaseTreeNode[] | undefined => {
    if (node.kind !== 'object-group' || !node.connectionId || !node.objectType) {
      return undefined
    }
    return objectGroupChildrenCache.get(
      objectGroupCacheKey(
        node.connectionId,
        node.objectType,
        node.databaseName,
        node.pgDatabaseName
      )
    )
  }

  const objectNodesForGroup = async (
    connectionId: string,
    objectType: DbObjectType,
    databaseName?: string,
    pgDatabaseName?: string
  ): Promise<DatabaseTreeNode[]> => {
    const startedAt = performance.now()
    const cacheKey = objectGroupCacheKey(connectionId, objectType, databaseName, pgDatabaseName)
    const cachedChildren = objectGroupChildrenCache.get(cacheKey)
    if (cachedChildren) {
      console.info('[perf][tree-runtime] object-group-cache-hit', {
        cacheKey,
        objectType,
        duration: Number((performance.now() - startedAt).toFixed(2))
      })
      return cachedChildren
    }

    const pending = objectGroupChildrenPromiseCache.get(cacheKey)
    if (pending) {
      console.info('[perf][tree-runtime] object-group-await-pending', {
        cacheKey,
        objectType,
        duration: Number((performance.now() - startedAt).toFixed(2))
      })
      return pending
    }

    const requestPromise = (async () => {
      const path = deps.withPgDatabase(`/connections/${connectionId}/objects`, databaseName, pgDatabaseName)
      const requestStartedAt = performance.now()
      const data = await deps.requestJson<{ objects: DbObjectInfo[] }>(
        `${path}${databaseName || pgDatabaseName ? '&' : '?'}type=${objectType}`
      )
      console.info('[perf][tree-runtime] object-group-request-resolved', {
        cacheKey,
        objectType,
        objectCount: data.objects.length,
        duration: Number((performance.now() - requestStartedAt).toFixed(2))
      })
      const shouldLoadTableStats =
        objectType === 'table' &&
        TABLE_STATS_DATABASE_TYPES.has(deps.getConnection(connectionId)?.database_type ?? 'sqlite')
      const nextChildren = data.objects.map<DatabaseTreeNode>((object) => {
        const resolvedType = DB_OBJECT_GROUP_BY_TYPE[object.type as DbObjectType]
          ? (object.type as DbObjectType)
          : objectType
        const kind = resolvedType === 'table' ? 'table' : 'db-object'
        const group = DB_OBJECT_GROUP_BY_TYPE[resolvedType]

        return {
          key: `${kind}:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${resolvedType}:${object.name}`,
          title: object.name,
          comment: object.comment ?? null,
          icon: plainObjectIconByType[resolvedType] ?? group.icon,
          kind,
          connectionId,
          databaseName,
          pgDatabaseName,
          tableName: object.name,
          objectType: resolvedType,
          sizeDisplay: object.size_display,
          sizeBytes: object.size_bytes,
          storageSizeDisplay: object.storage_size_display,
          storageSizeBytes: object.storage_size_bytes,
          sizeLoading: resolvedType === 'table' && shouldLoadTableStats,
          rowCount: object.row_count,
          childrenLoaded: false,
          isLeaf: resolvedType !== 'table'
        }
      })
      objectGroupChildrenCache.set(cacheKey, nextChildren)
      console.info('[perf][tree-runtime] object-group-mapped', {
        cacheKey,
        objectType,
        objectCount: nextChildren.length,
        duration: Number((performance.now() - startedAt).toFixed(2))
      })
      return nextChildren
    })()

    objectGroupChildrenPromiseCache.set(cacheKey, requestPromise)
    try {
      return await requestPromise
    } finally {
      objectGroupChildrenPromiseCache.delete(cacheKey)
    }
  }

  const preloadObjectGroupNodes = async (
    connectionId: string,
    databaseName?: string,
    pgDatabaseName?: string,
    databaseType?: DatabaseType
  ): Promise<DatabaseTreeNode[]> =>
    buildObjectGroupNodes(connectionId, databaseName, pgDatabaseName, databaseType)

  const preloadDatabaseChildren = async (
    connection: ConnectionInfo,
    databaseName: string,
    selectedSchemaOverride?: string[]
  ): Promise<DatabaseTreeNode[]> => {
    if (connection.database_type === 'redis') {
      return []
    }

    if (deps.isSchemaScopedType(connection.database_type)) {
      const data = await deps.requestJson<{ databases: DatabaseInfo[] }>(
        `/connections/${connection.connection_id}/schemas?database=${encodeURIComponent(databaseName)}`
      )
      const selectorKey = `${connection.connection_id}:${databaseName}`
      const schemaNames = data.databases.map((schema) => schema.name)
      const currentSelected = selectedSchemaOverride ?? deps.selectedSchemasRef.current[selectorKey]
      const nextSelected = currentSelected
        ? filterPersistedTreeValues(currentSelected, schemaNames)
        : schemaNames

      deps.setAllSchemas((current) => ({ ...current, [selectorKey]: schemaNames }))
      deps.setSelectedSchemas((current) => {
        const next = { ...current, [selectorKey]: nextSelected }
        deps.selectedSchemasRef.current = next
        return next
      })

      return data.databases
        .filter((schema) => nextSelected.includes(schema.name))
        .map((schema) => buildPgSchemaNode(connection, databaseName, schema))
    }

    void deps.preloadCompletionForDatabase(connection.connection_id, databaseName)
    return preloadObjectGroupNodes(
      connection.connection_id,
      databaseName,
      undefined,
      connection.database_type
    )
  }

  const preloadConnectionTree = async (
    connection: ConnectionInfo,
    selectedDatabaseOverride?: string[]
  ): Promise<DatabaseTreeNode[]> => {
    const data = await deps.requestJson<{ databases: DatabaseInfo[] }>(
      `/connections/${connection.connection_id}/databases`
    )
    const dbNames = data.databases.map((database) => database.name)
    const currentSelected =
      selectedDatabaseOverride ?? deps.selectedDatabasesRef.current[connection.connection_id]
    const nextSelected = currentSelected
      ? filterPersistedTreeValues(currentSelected, dbNames)
      : getDefaultSelectedDatabases(connection, dbNames, data.databases)

    deps.setAllDatabases((current) => ({ ...current, [connection.connection_id]: dbNames }))
    deps.setSelectedDatabases((current) => {
      const next = { ...current, [connection.connection_id]: nextSelected }
      deps.selectedDatabasesRef.current = next
      return next
    })

    const databaseNodes = data.databases
      .filter((database) => nextSelected.includes(database.name))
      .map((database) => buildDatabaseNode(connection, database))

    deps.setTreeData((current) => {
      const next = updateTreeNode(current, `connection:${connection.connection_id}`, databaseNodes)
      deps.treeDataRef.current = next
      return next
    })
    return databaseNodes
  }

  const loadChildrenForNode = async (node: DatabaseTreeNode): Promise<DatabaseTreeNode[]> => {
    if (node.closed) {
      return []
    }

    if (node.kind === 'connection' && node.connectionId) {
      const connection = deps.getConnection(node.connectionId)
      if (
        !connection ||
        ![
          'mysql',
          'postgresql',
          'gaussdb',
          'dm',
          'oracle',
          'mongodb',
          'redis',
          'clickhouse'
        ].includes(connection.database_type)
      ) {
        return []
      }
      return preloadConnectionTree(connection)
    }

    if (node.kind === 'database' && node.connectionId && node.databaseName) {
      const connection = deps.getConnection(node.connectionId)
      if (!connection || connection.database_type === 'redis') {
        return []
      }
      return preloadDatabaseChildren(connection, node.databaseName)
    }

    if (node.kind === 'pg-schema' && node.connectionId && node.databaseName) {
      return preloadObjectGroupNodes(
        node.connectionId,
        node.databaseName,
        node.pgDatabaseName,
        deps.getConnection(node.connectionId)?.database_type
      )
    }

    if (node.kind === 'object-group' && node.connectionId && node.objectType) {
      if (node.objectType === 'table') {
        prefetchSqliteObjectGroups(node.connectionId)
      }
      return objectNodesForGroup(
        node.connectionId,
        node.objectType,
        node.databaseName,
        node.pgDatabaseName
      )
    }

    if (node.kind === 'table' && node.connectionId && node.tableName) {
      const data = await deps.requestJson<{ columns: ColumnInfo[] }>(
        deps.withPgDatabase(
          `/connections/${node.connectionId}/tables/${encodeURIComponent(node.tableName)}/columns`,
          node.databaseName,
          node.pgDatabaseName
        )
      )
      return data.columns.map<DatabaseTreeNode>((column) => ({
        key: `column:${node.connectionId}:${node.databaseName ?? 'main'}:${node.tableName}:${column.name}`,
        title: `${column.name} · ${column.type}${column.primary_key ? ' · PK' : ''}${column.nullable ? '' : ' · NOT NULL'}`,
        kind: 'column',
        columnName: column.name,
        columnType: column.type,
        nullable: column.nullable,
        primaryKey: column.primary_key,
        isLeaf: true
      }))
    }

    return []
  }

  const reloadNodeChildren = async (node: DatabaseTreeNode, expand = true): Promise<void> => {
    const startedAt = performance.now()
    if (!node.key || deps.treeLoadingKeysRef.current.has(node.key)) {
      return
    }

    const key = node.key as React.Key
    const restoreTreeScrollPosition = deps.captureTreeScrollPosition?.()
    const cachedChildren = getCachedObjectGroupChildren(node)

    if (expand && !deps.expandedKeysRef.current.includes(key)) {
      deps.expandedKeysRef.current = [...deps.expandedKeysRef.current, key]
      deps.setExpandedKeys(deps.expandedKeysRef.current)
    }

    if (cachedChildren && !isTreeNodeChildrenLoaded(node)) {
      deps.setTreeData((current) => {
        const next = updateTreeNode(current, key, cachedChildren)
        deps.treeDataRef.current = next
        return next
      })
      if (node.objectType === 'table' && cachedChildren.some((child) => child.sizeLoading)) {
        loadTableStats(
          objectGroupCacheKey(node.connectionId!, node.objectType, node.databaseName, node.pgDatabaseName),
          node.connectionId!,
          node.databaseName,
          node.pgDatabaseName,
          cachedChildren
        )
      }
      console.info('[perf][tree-runtime] load-children-from-cache', {
        key,
        kind: node.kind,
        childCount: cachedChildren.length,
        duration: Number((performance.now() - startedAt).toFixed(2))
      })
      restoreTreeScrollPosition?.()
      return
    }

    deps.treeLoadingKeysRef.current.add(node.key)
    deps.notifyTreeLoadingStateChanged()
    try {
      const children = await loadChildrenForNode(node)
      console.info('[perf][tree-runtime] load-children-resolved', {
        key,
        kind: node.kind,
        childCount: children.length,
        duration: Number((performance.now() - startedAt).toFixed(2))
      })
      if (node.kind !== 'connection') {
        deps.setTreeData((current) => {
          const next = updateTreeNode(current, node.key as React.Key, children)
          deps.treeDataRef.current = next
          return next
        })
        if (
          node.kind === 'object-group' &&
          node.objectType === 'table' &&
          node.connectionId &&
          children.some((child) => child.sizeLoading)
        ) {
          loadTableStats(
            objectGroupCacheKey(
              node.connectionId,
              node.objectType,
              node.databaseName,
              node.pgDatabaseName
            ),
            node.connectionId,
            node.databaseName,
            node.pgDatabaseName,
            children
          )
        }
      }
      if (expand && !deps.expandedKeysRef.current.includes(key)) {
        deps.expandedKeysRef.current = [...deps.expandedKeysRef.current, key]
        deps.setExpandedKeys(deps.expandedKeysRef.current)
      }
      console.info('[perf][tree-runtime] load-children-committed', {
        key,
        kind: node.kind,
        duration: Number((performance.now() - startedAt).toFixed(2))
      })
    } catch (error) {
      deps.showError(error instanceof Error ? error.message : '加载树节点失败')
    } finally {
      deps.treeLoadingKeysRef.current.delete(node.key)
      deps.notifyTreeLoadingStateChanged()
      restoreTreeScrollPosition?.()
    }
  }

  const setTreeDataSnapshot = (nextTreeData: DatabaseTreeNode[]): void => {
    deps.treeDataRef.current = nextTreeData
    deps.setTreeData(nextTreeData)
  }

  const updateTreeNodeSnapshot = (key: React.Key, children: DatabaseTreeNode[]): void => {
    setTreeDataSnapshot(updateTreeNode(deps.treeDataRef.current, key, children))
  }

  const ensureQueryContextTreeExpanded = async (
    connection: ConnectionInfo,
    databaseName?: string,
    pgDatabaseName?: string
  ): Promise<void> => {
    const connectionKey = `connection:${connection.connection_id}`
    const nextExpandedKeys = new Set(deps.expandedKeysRef.current.map(String))
    nextExpandedKeys.add(connectionKey)

    if (connection.database_type === 'sqlite') {
      const connectionNode = collectTreeNodesByKey(deps.treeDataRef.current).get(connectionKey)
      if (!connectionNode || !isTreeNodeChildrenLoaded(connectionNode)) {
        updateTreeNodeSnapshot(connectionKey, buildConnectionNode(connection).children ?? [])
      }
      deps.expandedKeysRef.current = Array.from(nextExpandedKeys)
      deps.setExpandedKeys(deps.expandedKeysRef.current)
      return
    }

    if (connection.database_type !== 'redis') {
      const currentSelectedDatabases =
        deps.selectedDatabasesRef.current[connection.connection_id] ?? []
      const requiredDatabase = deps.isSchemaScopedType(connection.database_type)
        ? pgDatabaseName
        : databaseName
      const selectedDatabaseOverride = requiredDatabase
        ? Array.from(new Set([...currentSelectedDatabases, requiredDatabase]))
        : currentSelectedDatabases
      const connectionChildren = await preloadConnectionTree(connection, selectedDatabaseOverride)
      if (connectionChildren.length > 0) {
        updateTreeNodeSnapshot(connectionKey, connectionChildren)
      }
    }

    if (pgDatabaseName && deps.isSchemaScopedType(connection.database_type)) {
      const databaseKey = `database:${connection.connection_id}:${pgDatabaseName}`
      nextExpandedKeys.add(databaseKey)
      const currentSelectedSchemas =
        deps.selectedSchemasRef.current[`${connection.connection_id}:${pgDatabaseName}`] ?? []
      const selectedSchemaOverride = databaseName
        ? Array.from(new Set([...currentSelectedSchemas, databaseName]))
        : currentSelectedSchemas
      const schemaChildren = await preloadDatabaseChildren(
        connection,
        pgDatabaseName,
        selectedSchemaOverride
      )
      updateTreeNodeSnapshot(databaseKey, schemaChildren)

      if (databaseName) {
        const schemaKey = `pg-schema:${connection.connection_id}:${pgDatabaseName}:${databaseName}`
        nextExpandedKeys.add(schemaKey)
        const objectGroupChildren = await preloadObjectGroupNodes(
          connection.connection_id,
          databaseName,
          pgDatabaseName,
          connection.database_type
        )
        updateTreeNodeSnapshot(schemaKey, objectGroupChildren)
      }
    } else if (databaseName && connection.database_type !== 'redis') {
      const databaseKey = `database:${connection.connection_id}:${databaseName}`
      nextExpandedKeys.add(databaseKey)
      const databaseChildren = await preloadDatabaseChildren(connection, databaseName)
      updateTreeNodeSnapshot(databaseKey, databaseChildren)
    }

    deps.expandedKeysRef.current = Array.from(nextExpandedKeys)
    deps.setExpandedKeys(deps.expandedKeysRef.current)
  }

  const collapseTreeNode = (node: DatabaseTreeNode): void => {
    const key = node.key as React.Key
    deps.expandedKeysRef.current = deps.expandedKeysRef.current.filter((item) => item !== key)
    deps.setExpandedKeys(deps.expandedKeysRef.current)
  }

  const toggleOrLoadTreeNode = (node: DatabaseTreeNode): void => {
    if (!node.key || !isLoadableTreeNode(node)) {
      return
    }
    if (deps.treeLoadingKeysRef.current.has(node.key as React.Key)) {
      return
    }

    const key = node.key as React.Key
    if (deps.expandedKeysRef.current.includes(key)) {
      collapseTreeNode(node)
      return
    }

    if (node.kind === 'connection' && node.connectionId) {
      prefetchSqliteObjectGroups(node.connectionId)
    }

    const cachedChildren = getCachedObjectGroupChildren(node)
    if (cachedChildren && !isTreeNodeChildrenLoaded(node)) {
      updateTreeNodeSnapshot(key, cachedChildren)
      deps.expandedKeysRef.current = deps.expandedKeysRef.current.includes(key)
        ? deps.expandedKeysRef.current
        : [...deps.expandedKeysRef.current, key]
      deps.setExpandedKeys(deps.expandedKeysRef.current)
      return
    }

    if (!isTreeNodeChildrenLoaded(node)) {
      void reloadNodeChildren({ ...node, isLeaf: false }, true)
      return
    }

    deps.expandedKeysRef.current = deps.expandedKeysRef.current.includes(key)
      ? deps.expandedKeysRef.current
      : [...deps.expandedKeysRef.current, key]
    deps.setExpandedKeys(deps.expandedKeysRef.current)
  }

  return {
    objectNodesForGroup,
    preloadObjectGroupNodes,
    preloadDatabaseChildren,
    preloadConnectionTree,
    loadChildrenForNode,
    reloadNodeChildren,
    setTreeDataSnapshot,
    updateTreeNodeSnapshot,
    ensureQueryContextTreeExpanded,
    collapseTreeNode,
    toggleOrLoadTreeNode
  }
}
