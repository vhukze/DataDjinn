import { expect, test } from '@playwright/test'
import { createTreeRuntime } from '../../src/renderer/src/app/tree-runtime'

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
