import { expect, test } from '@playwright/test'
import type { Key } from 'react'
import {
  createTreeRuntime,
  getVisibleConnectionIdsFromTree
} from '../../src/renderer/src/app/tree-runtime'
import type { DatabaseTreeNode } from '../../src/renderer/src/app/tree-model'

test('visible connection range includes expanded nested groups only @bug', async () => {
  const tree: DatabaseTreeNode[] = [
    {
      key: 'folder:root',
      title: '根分组',
      kind: 'folder',
      children: [
        {
          key: 'connection:root-connection',
          title: '根连接',
          kind: 'connection',
          connectionId: 'root-connection'
        },
        {
          key: 'folder:nested',
          title: '子分组',
          kind: 'folder',
          children: [
            {
              key: 'connection:nested-connection',
              title: '子连接',
              kind: 'connection',
              connectionId: 'nested-connection'
            }
          ]
        },
        {
          key: 'folder:collapsed',
          title: '折叠分组',
          kind: 'folder',
          children: [
            {
              key: 'connection:hidden-connection',
              title: '隐藏连接',
              kind: 'connection',
              connectionId: 'hidden-connection'
            }
          ]
        }
      ]
    }
  ]

  expect(getVisibleConnectionIdsFromTree(tree, ['folder:root', 'folder:nested'])).toEqual([
    'root-connection',
    'nested-connection'
  ])
})

test('stale tree requests cannot clear a newer loading state @bug', async () => {
  const pendingResolvers: Array<
    (value: { objects: Array<{ name: string; type: string }> }) => void
  > = []
  const loadingKeys = new Set<Key>()
  const operationVersions = { current: { 'connection-1': 1 } }
  const treeData: DatabaseTreeNode[] = [
    {
      key: 'object-group:connection-1:::view',
      title: '视图',
      kind: 'object-group',
      connectionId: 'connection-1',
      objectType: 'view',
      childrenLoaded: false,
      isLeaf: false
    }
  ]
  const updates: DatabaseTreeNode[][] = []
  const runtime = createTreeRuntime({
    requestJson: () =>
      new Promise((resolve) => {
        pendingResolvers.push(resolve)
      }),
    withPgDatabase: (path) => path,
    getConnection: () => ({ database_type: 'sqlite', is_open: true }),
    isSchemaScopedType: () => false,
    preloadCompletionForDatabase: async () => undefined,
    setAllDatabases: () => undefined,
    setSelectedDatabases: () => undefined,
    selectedDatabasesRef: { current: {} },
    setAllSchemas: () => undefined,
    setSelectedSchemas: () => undefined,
    selectedSchemasRef: { current: {} },
    setTreeData: (update) => {
      const next = typeof update === 'function' ? update(treeData) : update
      updates.push(next)
    },
    treeDataRef: { current: treeData },
    treeLoadingKeysRef: { current: loadingKeys },
    treeOperationVersionRef: operationVersions,
    expandedKeysRef: { current: [] },
    setExpandedKeys: () => undefined,
    notifyTreeLoadingStateChanged: () => undefined,
    showError: () => undefined,
    connectionTypeIcons: {}
  } as never)

  const firstRequest = runtime.reloadNodeChildren(treeData[0], true)
  await Promise.resolve()
  operationVersions.current['connection-1'] = 2
  runtime.invalidateObjectGroupCache('connection-1')
  loadingKeys.delete(treeData[0].key as Key)
  const secondRequest = runtime.reloadNodeChildren(treeData[0], true)
  await Promise.resolve()

  pendingResolvers[0]({ objects: [{ name: 'old-view', type: 'view' }] })
  await firstRequest
  await Promise.resolve()
  expect(loadingKeys.has(treeData[0].key as Key)).toBe(true)
  expect(updates).toHaveLength(0)

  pendingResolvers[1]({ objects: [{ name: 'new-view', type: 'view' }] })
  await secondRequest
  expect(loadingKeys.has(treeData[0].key as Key)).toBe(false)
  expect(updates).toHaveLength(1)
})

for (const statsFail of [false, true]) {
test(`deferred table statistics ${statsFail ? 'failure' : 'success'} retain columns expanded while loading @bug`, async () => {
  let finishStats!: (value: unknown) => void
  let failStats!: (reason: Error) => void
  let columnRequests = 0
  const group: DatabaseTreeNode = {
    key: 'object-group:connection-1::APP:table', title: '表', kind: 'object-group',
    connectionId: 'connection-1', databaseName: 'APP', objectType: 'table', isLeaf: false
  }
  const treeDataRef = { current: [group] }
  const expandedKeysRef = { current: [] as Key[] }
  const runtime = createTreeRuntime({
    requestJson: async (path: string) => {
      if (path.includes('include_stats=true')) {
        return new Promise((resolve, reject) => { finishStats = resolve; failStats = reject })
      }
      if (path.includes('/columns')) {
        columnRequests += 1
        return { columns: [{ name: 'id', type: 'INT', nullable: false, primary_key: true }] }
      }
      return { objects: [{ name: 'items', type: 'table' }] }
    },
    withPgDatabase: (path: string) => `${path}?database=APP`,
    getConnection: () => ({ connection_id: 'connection-1', database_type: 'dm', is_open: true }),
    isSchemaScopedType: () => false, preloadCompletionForDatabase: async () => undefined,
    setAllDatabases: () => undefined, setSelectedDatabases: () => undefined,
    selectedDatabasesRef: { current: {} }, setAllSchemas: () => undefined,
    setSelectedSchemas: () => undefined, selectedSchemasRef: { current: {} },
    setTreeData: (update) => {
      treeDataRef.current = typeof update === 'function' ? update(treeDataRef.current) : update
    },
    treeDataRef, treeLoadingKeysRef: { current: new Set() }, expandedKeysRef,
    setExpandedKeys: () => undefined, notifyTreeLoadingStateChanged: () => undefined,
    showError: (error) => { throw error }, connectionTypeIcons: {}
  } as never)
  await runtime.reloadNodeChildren(group)
  await runtime.reloadNodeChildren(treeDataRef.current[0].children![0] as DatabaseTreeNode)
  const columns = treeDataRef.current[0].children![0].children
  expect(columns).toHaveLength(1)
  if (statsFail) failStats(new Error('statistics unavailable'))
  else finishStats({ objects: [{ name: 'items', type: 'table', size_display: '128 KB' }] })
  await expect.poll(() => treeDataRef.current[0].children![0].sizeLoading).toBe(false)
  const table = treeDataRef.current[0].children![0]
  expect(table.children, 'size updates must not replace the current expanded table with an earlier snapshot').toBe(columns)
  expect(table.childrenLoaded).toBe(true)
  runtime.toggleOrLoadTreeNode(table as DatabaseTreeNode)
  runtime.toggleOrLoadTreeNode(table as DatabaseTreeNode)
  expect(columnRequests).toBe(1)
})
}

for (const kind of ['database', 'pg-schema', 'object-group'] as const) {
test(`double clicks during ${kind} loading apply immediately and late responses retain the latest expansion @bug`, async () => {
  let resolveObjects!: (value: unknown) => void
  let requestCount = 0
  const node: DatabaseTreeNode = {
    key: `${kind}:connection-1`, title: kind, kind,
    connectionId: 'connection-1', databaseName: 'app', pgDatabaseName: 'primary',
    objectType: 'view', childrenLoaded: false, isLeaf: false
  }
  const expandedKeysRef = { current: [] as Key[] }
  const treeDataRef = { current: [node] }
  const loadingKeys = new Set<Key>()
  const runtime = createTreeRuntime({
    requestJson: () => {
      requestCount += 1
      return new Promise((resolve) => { resolveObjects = resolve })
    },
    withPgDatabase: (path) => path,
    getConnection: () => ({ connection_id: 'connection-1', database_type: 'postgresql', is_open: true }),
    isSchemaScopedType: () => true,
    preloadCompletionForDatabase: async () => undefined,
    setAllDatabases: () => undefined, setSelectedDatabases: () => undefined,
    selectedDatabasesRef: { current: {} }, setAllSchemas: () => undefined,
    setSelectedSchemas: () => undefined, selectedSchemasRef: { current: {} },
    setTreeData: (update) => {
      treeDataRef.current = typeof update === 'function' ? update(treeDataRef.current) : update
    },
    treeDataRef, treeLoadingKeysRef: { current: loadingKeys }, expandedKeysRef,
    setExpandedKeys: () => undefined, notifyTreeLoadingStateChanged: () => undefined,
    showError: (error) => { throw error }, connectionTypeIcons: {}
  } as never)
  const pending = runtime.reloadNodeChildren(node, true)
  expect(expandedKeysRef.current).toEqual([node.key])
  expect(loadingKeys.has(node.key as Key)).toBe(true)
  runtime.toggleOrLoadTreeNode(node)
  expect(expandedKeysRef.current).toEqual([])
  runtime.toggleOrLoadTreeNode(node)
  expect(expandedKeysRef.current).toEqual([node.key])
  runtime.toggleOrLoadTreeNode(node)
  expect(expandedKeysRef.current).toEqual([])
  expect(requestCount).toBe(kind === 'pg-schema' ? 0 : 1)
  if (kind !== 'pg-schema') {
    resolveObjects(kind === 'database' ? { databases: [{ name: 'public' }] } :
      { objects: [{ name: 'new-view', type: 'view' }] })
  }
  await pending
  expect(loadingKeys.size).toBe(0)
  expect(treeDataRef.current[0].children?.length).toBeGreaterThan(0)
  expect(expandedKeysRef.current).toEqual([])
  runtime.toggleOrLoadTreeNode(treeDataRef.current[0])
  expect(expandedKeysRef.current).toEqual([node.key])
  expect(requestCount).toBe(kind === 'pg-schema' ? 0 : 1)
})
}

test('refreshing a connection invalidates cached database object groups @bug', async () => {
  let requestCount = 0
  const runtime = createTreeRuntime({
    requestJson: async () => {
      requestCount += 1
      return { objects: [{ name: `items-${requestCount}`, type: 'table' }] }
    },
    withPgDatabase: (path) => path,
    getConnection: () => ({ database_type: 'sqlite' }),
    isSchemaScopedType: () => false,
    preloadCompletionForDatabase: async () => undefined,
    setAllDatabases: () => undefined,
    setSelectedDatabases: () => undefined,
    selectedDatabasesRef: { current: {} },
    setAllSchemas: () => undefined,
    setSelectedSchemas: () => undefined,
    selectedSchemasRef: { current: {} },
    setTreeData: () => undefined,
    treeDataRef: { current: [] },
    treeLoadingKeysRef: { current: new Set() },
    expandedKeysRef: { current: [] },
    setExpandedKeys: () => undefined,
    notifyTreeLoadingStateChanged: () => undefined,
    showError: () => undefined,
    connectionTypeIcons: {}
  } as never)

  const initial = await runtime.objectNodesForGroup('connection-1', 'table', 'main')
  const cached = await runtime.objectNodesForGroup('connection-1', 'table', 'main')
  runtime.invalidateObjectGroupCache('connection-1')
  const refreshed = await runtime.objectNodesForGroup('connection-1', 'table', 'main')

  expect(requestCount).toBe(2)
  expect(initial[0].title).toBe('items-1')
  expect(cached[0].title).toBe('items-1')
  expect(refreshed[0].title).toBe('items-2')
})
