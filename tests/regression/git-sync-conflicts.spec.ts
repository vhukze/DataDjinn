import { expect, test } from '@playwright/test'
import {
  buildGitSyncTreeDiff,
  buildGitSyncTreeOrder,
  createDefaultGitSyncConflictChoices,
  describeGitSyncConflict,
  formatGitSyncConflictValue,
  groupGitSyncConflicts
} from '../../src/renderer/src/app/git-sync-conflicts'

const context = {
  connectionNames: {
    'connection-1': '生产库',
    'connection-2': '报表库'
  },
  folderNames: {
    'folder-1': '生产环境',
    'folder-2': '报表环境'
  }
}

test('同步冲突应显示可读的连接和分组名称，而不是内部 ID @bug', async () => {
  expect(
    describeGitSyncConflict(['preferences', 'root_connection_order'], context)
  ).toMatchObject({
    title: '连接树排序'
  })
  expect(
    formatGitSyncConflictValue(
      ['connection-2', 'connection-1'],
      ['preferences', 'root_connection_order'],
      context
    )
  ).toContain('1. 报表库\n2. 生产库')

  expect(
    describeGitSyncConflict(
      ['preferences', 'folder_connection_order', 'folder-1'],
      context
    )
  ).toMatchObject({
    title: '连接树排序'
  })
})

test('连接所属分组冲突应显示连接名和分组名 @bug', async () => {
  expect(
    describeGitSyncConflict(
      ['preferences', 'connection_folder_assignments', 'connection-1'],
      context
    )
  ).toMatchObject({
    title: '连接「生产库」· 所属分组'
  })
  expect(
    formatGitSyncConflictValue(
      'folder-2',
      ['preferences', 'connection_folder_assignments', 'connection-1'],
      context
    )
  ).toBe('分组「报表环境」')
})

test('多个连接树排序字段应合并为一个冲突选择 @bug', async () => {
  const groups = groupGitSyncConflicts([
    { key: 'tree', path_segments: ['preferences', 'tree_order'] },
    { key: 'assignment', path_segments: ['preferences', 'connection_folder_assignments'] }
  ])

  expect(groups).toHaveLength(2)
  expect(groups[0]).toMatchObject({
    key: 'connection-tree-order',
    title: '连接树排序'
  })
  expect(groups[0].conflicts).toHaveLength(1)
})

test('同步冲突默认保留本机并允许直接确认 @bug', async () => {
  const choices = createDefaultGitSyncConflictChoices([
    { key: 'tree', path_segments: ['preferences', 'tree_order'] },
    { key: 'name', path_segments: ['connections', 'connection-1', 'name'] }
  ])

  expect(choices).toEqual({ tree: 'local', name: 'local' })
  expect(Object.values(choices)).toHaveLength(2)
})

test('连接树冲突应保留分组和子分组层级，并标记位置差异 @bug', async () => {
  const localTree = buildGitSyncTreeOrder({
    folders: [
      { id: 'folder-1' },
      { id: 'folder-2', parentId: 'folder-1' }
    ],
    connectionIds: ['connection-1', 'connection-2'],
    assignments: { 'connection-1': 'folder-1', 'connection-2': 'folder-2' },
    folderOrder: ['folder-1', 'folder-2'],
    folderConnectionOrder: {
      'folder-1': ['connection-1'],
      'folder-2': ['connection-2']
    },
    rootItemOrder: ['folder:folder-1'],
    rootConnectionOrder: [],
    pinnedRootItemIds: [],
    rootItemOrderCustomized: true
  })
  const remoteTree = {
    roots: ['folder:folder-1', 'folder:folder-2'],
    children: {
      'folder-1': ['connection:connection-1'],
      'folder-2': ['connection:connection-2']
    }
  }

  const diff = buildGitSyncTreeDiff(localTree, remoteTree, context)

  expect(localTree).toMatchObject({
    roots: ['folder:folder-1'],
    children: {
      'folder-1': ['folder:folder-2', 'connection:connection-1'],
      'folder-2': ['connection:connection-2']
    }
  })
  expect(diff.local).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: '报表环境', depth: 1, status: 'moved' }),
      expect.objectContaining({ label: '生产库', depth: 1, status: 'moved' })
    ])
  )
  expect(diff.remote).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: '报表环境', depth: 0, status: 'moved' }),
      expect.objectContaining({ label: '生产库', depth: 1, status: 'moved' })
    ])
  )
})
