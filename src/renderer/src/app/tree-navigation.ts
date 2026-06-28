import type { RefObject } from 'react'
import { collectTreeNodesByKey, isLoadableTreeNode, isTreeNodeChildrenLoaded, type DatabaseTreeNode, type DbObjectType } from './tree-model'
import type { WorkspaceTab } from './workspace-model'

const waitForNextFrame = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => resolve())
})

type EnsureTreePathExpandedOptions = {
  targetPath?: string[]
  treeDataRef: RefObject<DatabaseTreeNode[]>
  expandedKeysRef: RefObject<React.Key[]>
  setExpandedKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
  reloadNodeChildren: (node: DatabaseTreeNode, expand?: boolean) => Promise<void>
}

export const ensureTreePathExpanded = async ({
  targetPath,
  treeDataRef,
  expandedKeysRef,
  setExpandedKeys,
  reloadNodeChildren
}: EnsureTreePathExpandedOptions): Promise<DatabaseTreeNode | undefined> => {
  if (!targetPath || targetPath.length === 0) {
    return undefined
  }

  for (let index = 0; index < targetPath.length - 1; index += 1) {
    const currentMap = collectTreeNodesByKey(treeDataRef.current ?? [])
    const currentNode = currentMap.get(targetPath[index])
    if (!currentNode) {
      return undefined
    }
    if (!isTreeNodeChildrenLoaded(currentNode) && isLoadableTreeNode(currentNode)) {
      await reloadNodeChildren({ ...currentNode, isLeaf: false })
      await waitForNextFrame()
    } else if (!expandedKeysRef.current?.includes(currentNode.key as React.Key)) {
      setExpandedKeys((current) => current.includes(currentNode.key as React.Key) ? current : [...current, currentNode.key as React.Key])
      await waitForNextFrame()
    }
  }

  const nodeMap = collectTreeNodesByKey(treeDataRef.current ?? [])
  const targetNode = nodeMap.get(targetPath[targetPath.length - 1])
  if (!targetNode) {
    return undefined
  }

  if (isLoadableTreeNode(targetNode) && !expandedKeysRef.current?.includes(targetNode.key as React.Key)) {
    setExpandedKeys((current) => current.includes(targetNode.key as React.Key) ? current : [...current, targetNode.key as React.Key])
    await waitForNextFrame()
  }

  return targetNode
}

type LocateTreePathOptions = {
  targetPath?: string[]
  treeDataRef: RefObject<DatabaseTreeNode[]>
  expandedKeysRef: RefObject<React.Key[]>
  setExpandedKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
  reloadNodeChildren: (node: DatabaseTreeNode, expand?: boolean) => Promise<void>
  handleTreeSelection: (node: DatabaseTreeNode) => void
  resourceTreeContainerRef: RefObject<HTMLDivElement | null>
  resourceTreeRef: RefObject<unknown>
  resourceTreeViewportRef: RefObject<HTMLDivElement | null>
  enableVirtualTree: boolean
  resourceTreeHeight: number
  resourceTreeItemHeight: number
}

export const locateTreePathInView = async ({
  targetPath,
  treeDataRef,
  expandedKeysRef,
  setExpandedKeys,
  reloadNodeChildren,
  handleTreeSelection,
  resourceTreeContainerRef,
  resourceTreeRef,
  resourceTreeViewportRef,
  enableVirtualTree,
  resourceTreeHeight,
  resourceTreeItemHeight
}: LocateTreePathOptions): Promise<void> => {
  const targetNode = await ensureTreePathExpanded({
    targetPath,
    treeDataRef,
    expandedKeysRef,
    setExpandedKeys,
    reloadNodeChildren
  })
  if (!targetNode) {
    return
  }

  handleTreeSelection(targetNode)
  resourceTreeContainerRef.current?.focus()
  if (enableVirtualTree) {
    const treeApi = resourceTreeRef.current as { scrollTo?: (options: { key: React.Key; align?: 'top' | 'bottom' | 'auto'; offset?: number }) => void } | null
    treeApi?.scrollTo?.({
      key: targetNode.key as React.Key,
      align: 'top',
      offset: Math.max(Math.floor(resourceTreeHeight / 2) - resourceTreeItemHeight, 0)
    })
    await waitForNextFrame()
  } else {
    await waitForNextFrame()
  }
  const selectedNode = resourceTreeViewportRef.current?.querySelector('.ant-tree-node-content-wrapper.ant-tree-node-selected')
  selectedNode?.scrollIntoView({ block: 'center' })
}

export const buildActiveTreePath = (tab?: WorkspaceTab): string[] | undefined => {
  if (!tab?.connectionId) {
    return undefined
  }

  if (tab.kind === 'preview' && tab.tableName) {
    return [
      `connection:${tab.connectionId}`,
      ...(tab.pgDatabaseName ? [`database:${tab.connectionId}:${tab.pgDatabaseName}`] : []),
      ...(tab.databaseName && tab.pgDatabaseName
        ? [`pg-schema:${tab.connectionId}:${tab.pgDatabaseName}:${tab.databaseName}`]
        : tab.databaseName
          ? [`database:${tab.connectionId}:${tab.databaseName}`]
          : []),
      `object-group:${tab.connectionId}:${tab.pgDatabaseName ?? ''}:${tab.databaseName ?? ''}:table`,
      `table:${tab.connectionId}:${tab.pgDatabaseName ?? ''}:${tab.databaseName ?? ''}:table:${tab.tableName}`
    ]
  }

  if (tab.kind === 'table-list') {
    const objectType: DbObjectType = tab.title.includes('视图列表') ? 'view' : 'table'
    return [
      `connection:${tab.connectionId}`,
      ...(tab.pgDatabaseName ? [`database:${tab.connectionId}:${tab.pgDatabaseName}`] : []),
      ...(tab.databaseName && tab.pgDatabaseName
        ? [`pg-schema:${tab.connectionId}:${tab.pgDatabaseName}:${tab.databaseName}`]
        : tab.databaseName
          ? [`database:${tab.connectionId}:${tab.databaseName}`]
          : []),
      `object-group:${tab.connectionId}:${tab.pgDatabaseName ?? ''}:${tab.databaseName ?? ''}:${objectType}`
    ]
  }

  if (tab.kind === 'redis-browser' && tab.databaseName) {
    return [
      `connection:${tab.connectionId}`,
      `database:${tab.connectionId}:${tab.databaseName}`
    ]
  }

  if (tab.kind === 'query') {
    return [
      `connection:${tab.connectionId}`,
      ...(tab.pgDatabaseName ? [`database:${tab.connectionId}:${tab.pgDatabaseName}`] : []),
      ...(tab.databaseName && tab.pgDatabaseName
        ? [`pg-schema:${tab.connectionId}:${tab.pgDatabaseName}:${tab.databaseName}`]
        : tab.databaseName
          ? [`database:${tab.connectionId}:${tab.databaseName}`]
          : [])
    ]
  }

  return undefined
}
