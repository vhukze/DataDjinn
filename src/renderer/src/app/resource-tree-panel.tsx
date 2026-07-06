import { LoadingOutlined } from '@ant-design/icons'
import { Alert, Menu, Tree, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Key, MutableRefObject, RefObject } from 'react'
import { createPortal } from 'react-dom'
import ReactBitsDock from '../components/ui/ReactBitsDock'
import ReactBitsSearchInput from '../components/ui/ReactBitsSearchInput'
import type { ConnectionInfo } from './connection-model'
import type { DatabaseType } from './data-sources'
import type { DatabaseTreeNode } from './tree-model'
import {
  clampTreeContextMenuPosition,
  estimateTreeContextMenuHeight,
  TREE_CONTEXT_MENU_FALLBACK_HEIGHT,
  TREE_CONTEXT_MENU_FALLBACK_WIDTH
} from './tree-context-menu-position'

type ResourceTreePanelProps = {
  resourceTreeContainerRef: RefObject<HTMLDivElement | null>
  resourceTreeViewportRef: RefObject<HTMLDivElement | null>
  resourceTreeRef: MutableRefObject<unknown>
  treeSearchInputRef: RefObject<HTMLInputElement | null>
  connectionsInitialized: boolean
  backendReady: boolean
  treeData: DatabaseTreeNode[]
  itemHeight: number
  enableVirtualTree: boolean
  resourceTreeHeight: number
  expandedKeys: Key[]
  selectedTreeKeys: Key[]
  selectedConnectionIds: string[]
  treeSearchOpen: boolean
  treeSearchText: string
  setTreeSearchText: React.Dispatch<React.SetStateAction<string>>
  treeContextMenu: { x: number; y: number; node: DatabaseTreeNode } | null
  treeLoadingVersion: number
  treeLoadingKeysRef: MutableRefObject<Set<Key>>
  connectionFolderAssignments: Record<string, string | undefined>
  draggingConnectionIdsRef: MutableRefObject<string[]>
  draggingConnectionFolderIdRef: MutableRefObject<string | undefined>
  resourceCreateToolbarItems: Array<{
    key: string
    icon: React.ReactNode
    label: string
    active?: boolean
    onClick: () => void
  }>
  getConnection: (connectionId?: string) => ConnectionInfo | undefined
  getTreeNodeKindFromKey: (node: Partial<DatabaseTreeNode>, placeholderPrefix: string) => string | undefined
  folderDropPlaceholderKeyPrefix: string
  isTreeNodeChildrenLoaded: (node: DatabaseTreeNode) => boolean
  isLoadableTreeNode: (node: DatabaseTreeNode, databaseType?: DatabaseType) => boolean
  allowTreeDrop: () => boolean
  updateDragOverConnectionTarget: (value: { connectionId: string; folderId?: string; zone: 'before' | 'after' } | undefined) => void
  updateDragOverFolderTarget: (value: { folderId: string; zone: 'before' | 'after' } | undefined) => void
  clearConnectionDragState: () => void
  activateAIContextFromNode: (node: DatabaseTreeNode) => void
  collapseTreeNode: (node: DatabaseTreeNode) => void
  reloadNodeChildren: (node: DatabaseTreeNode, expand?: boolean) => Promise<void>
  renderTreeTitle: (node: DatabaseTreeNode) => React.ReactNode
  handleTreeSelection: (node: DatabaseTreeNode, nativeEvent?: MouseEvent) => void
  selectConnectionNodes: (connectionIds: string[], anchorId?: string) => void
  setFocusedTreeNode: (node: DatabaseTreeNode) => void
  setSelectedConnectionId: (connectionId?: string) => void
  setExpandedKeys: React.Dispatch<React.SetStateAction<Key[]>>
  setSelectedTreeKeys: React.Dispatch<React.SetStateAction<Key[]>>
  setTreeContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; node: DatabaseTreeNode } | null>>
  getTreeContextMenuItems: (node: DatabaseTreeNode) => MenuProps['items']
  handleTreeContextMenuClick: ({ key }: { key: string }) => void
  handleTreeDrop: (info: {
    node: unknown
    dragNode: unknown
    dropToGap?: boolean
    dropPosition?: number
    event?: React.MouseEvent<HTMLElement>
  }) => void
  toggleOrLoadTreeNode: (node: DatabaseTreeNode) => void
  openConnectionById: (connectionId: string) => Promise<{ is_open?: boolean; database_type?: string } | undefined>
  openRedisDatabaseBrowser: (connectionId: string, databaseName: string) => Promise<void>
  getDefaultDatabaseName: (connection?: ConnectionInfo) => string | undefined
  previewTable: (
    connectionId: string,
    tableName: string,
    databaseName?: string,
    pgDatabaseName?: string,
    limit?: number,
    page?: number,
    where?: string,
    objectType?: 'table' | 'view'
  ) => Promise<void>
  previewDefaultLimit: number
  copyTreeNodeNames: () => Promise<void>
}


const ResourceTreePanel = memo(function ResourceTreePanel({
  resourceTreeContainerRef,
  resourceTreeViewportRef,
  resourceTreeRef,
  treeSearchInputRef,
  connectionsInitialized,
  backendReady,
  treeData,
  itemHeight,
  enableVirtualTree,
  resourceTreeHeight,
  expandedKeys,
  selectedTreeKeys,
  selectedConnectionIds,
  treeSearchOpen,
  treeSearchText,
  setTreeSearchText,
  treeContextMenu,
  treeLoadingVersion,
  treeLoadingKeysRef,
  connectionFolderAssignments,
  draggingConnectionIdsRef,
  draggingConnectionFolderIdRef,
  resourceCreateToolbarItems,
  getConnection,
  getTreeNodeKindFromKey,
  folderDropPlaceholderKeyPrefix,
  isTreeNodeChildrenLoaded,
  isLoadableTreeNode,
  allowTreeDrop,
  updateDragOverConnectionTarget,
  updateDragOverFolderTarget,
  clearConnectionDragState,
  activateAIContextFromNode,
  collapseTreeNode,
  reloadNodeChildren,
  renderTreeTitle,
  handleTreeSelection,
  selectConnectionNodes,
  setFocusedTreeNode,
  setSelectedConnectionId,
  setExpandedKeys,
  setSelectedTreeKeys,
  setTreeContextMenu,
  getTreeContextMenuItems,
  handleTreeContextMenuClick,
  handleTreeDrop,
  toggleOrLoadTreeNode,
  openConnectionById,
  openRedisDatabaseBrowser,
  getDefaultDatabaseName,
  previewTable,
  previewDefaultLimit,
  copyTreeNodeNames,
}: ResourceTreePanelProps) {
  void treeLoadingVersion
  const treeContextMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const treeContextMenuItems = treeContextMenu ? getTreeContextMenuItems(treeContextMenu.node) : []
  const [treeContextMenuStyle, setTreeContextMenuStyle] = useState<{
    left: number
    top: number
    visibility: 'hidden' | 'visible'
  } | null>(null)

  useLayoutEffect(() => {
    if (!treeContextMenu) {
      setTreeContextMenuStyle(null)
      return
    }

    const estimatedPosition = clampTreeContextMenuPosition(
      treeContextMenu.x,
      treeContextMenu.y,
      TREE_CONTEXT_MENU_FALLBACK_WIDTH,
      estimateTreeContextMenuHeight(treeContextMenuItems)
    )

    setTreeContextMenuStyle({
      left: estimatedPosition.left,
      top: estimatedPosition.top,
      visibility: 'hidden'
    })

    const updatePosition = (): void => {
      const panel = treeContextMenuPanelRef.current
      if (!panel) {
        return
      }

      const rect = panel.getBoundingClientRect()
      const width = rect.width || TREE_CONTEXT_MENU_FALLBACK_WIDTH
      const height = rect.height || TREE_CONTEXT_MENU_FALLBACK_HEIGHT
      const nextPosition = clampTreeContextMenuPosition(treeContextMenu.x, treeContextMenu.y, width, height)

      setTreeContextMenuStyle({
        left: nextPosition.left,
        top: nextPosition.top,
        visibility: 'visible'
      })
    }

    let resizeObserver: ResizeObserver | undefined
    const runPositionUpdate = (): void => {
      window.requestAnimationFrame(() => {
        updatePosition()
        window.requestAnimationFrame(updatePosition)
      })
    }

    runPositionUpdate()
    window.addEventListener('resize', runPositionUpdate)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        runPositionUpdate()
      })
      if (treeContextMenuPanelRef.current) {
        resizeObserver.observe(treeContextMenuPanelRef.current)
      }
    }

    return () => {
      window.removeEventListener('resize', runPositionUpdate)
      resizeObserver?.disconnect()
    }
  }, [treeContextMenu])

  const clearPendingTreeSelection = useCallback(() => {
  }, [])

  const commitTreeSelection = useCallback((node: DatabaseTreeNode, nativeEvent?: MouseEvent) => {
    handleTreeSelection(node, nativeEvent)
  }, [handleTreeSelection])

  const scheduleTreeSelection = useCallback((node: DatabaseTreeNode, nativeEvent?: MouseEvent) => {
    if ((nativeEvent?.detail ?? 1) > 1) {
      return
    }
    commitTreeSelection(node, nativeEvent)
  }, [commitTreeSelection])

  return (
    <>
      <div className="resource-toolbar">
        <div className="resource-toolbar-actions">
          <ReactBitsDock
            className="resource-toolbar-dock"
            panelHeight={30}
            dockHeight={36}
            baseItemSize={28}
            magnification={31}
            distance={40}
            items={resourceCreateToolbarItems}
          />
        </div>
        {treeSearchOpen && (
          <ReactBitsSearchInput
            ref={treeSearchInputRef}
            value={treeSearchText}
            onChange={setTreeSearchText}
            onClear={() => setTreeSearchText('')}
          />
        )}
      </div>
      <div
        ref={resourceTreeContainerRef}
        className="resource-tree-shell"
        tabIndex={0}
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') {
            return
          }
          const target = event.target as HTMLElement | null
          if (target?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) {
            return
          }
          event.preventDefault()
          void copyTreeNodeNames()
        }}
      >
        <div
          ref={resourceTreeViewportRef}
          className={`resource-tree-viewport${enableVirtualTree ? ' virtual' : ' non-virtual'}`}
        >
          {!connectionsInitialized || !backendReady ? (
            <div className="resource-tree-loading-state">
              <div className="resource-tree-loading-spinner"><LoadingOutlined spin /></div>
              <Typography.Text type="secondary">正在加载连接与数据库结构...</Typography.Text>
            </div>
          ) : treeData.length === 0 ? (
            <Alert message="暂无数据库连接或分组" description="先创建一个连接，或者新建分组开始整理。" type="info" showIcon />
          ) : (
            <Tree
              ref={(node) => {
                resourceTreeRef.current = node
              }}
              multiple
              showIcon
              blockNode
              virtual={enableVirtualTree}
              draggable={{
                icon: false,
                nodeDraggable: (node) => {
                  const treeNode = node as unknown as Partial<DatabaseTreeNode>
                  const nodeKind = getTreeNodeKindFromKey(treeNode, folderDropPlaceholderKeyPrefix)
                  return nodeKind === 'connection' || nodeKind === 'folder'
                }
              }}
              allowDrop={allowTreeDrop}
              onDragOver={({ event }) => {
                if (draggingConnectionIdsRef.current.length === 0) {
                  const target = event.target as HTMLElement | null
                  const draggedConnectionElement = target?.closest<HTMLElement>('[data-connection-id]')
                  const draggedConnectionId = draggedConnectionElement?.dataset.connectionId
                  if (draggedConnectionId) {
                    draggingConnectionIdsRef.current = selectedConnectionIds.includes(draggedConnectionId)
                      ? selectedConnectionIds
                      : [draggedConnectionId]
                    draggingConnectionFolderIdRef.current = connectionFolderAssignments[draggedConnectionId]
                  }
                }

                const target = event.target as HTMLElement | null
                const connectionElement = target?.closest<HTMLElement>('[data-connection-id]')
                const connectionId = connectionElement?.dataset.connectionId
                if (connectionElement && connectionId) {
                  const rect = connectionElement.getBoundingClientRect()
                  updateDragOverConnectionTarget({
                    connectionId,
                    folderId: connectionFolderAssignments[connectionId],
                    zone: event.clientY - rect.top >= rect.height / 2 ? 'after' : 'before'
                  })
                  updateDragOverFolderTarget(undefined)
                } else {
                  updateDragOverConnectionTarget(undefined)
                }

                const folderElement = target?.closest<HTMLElement>('[data-folder-id]')
                const folderId = folderElement?.dataset.folderId
                if (!folderElement || !folderId) {
                  return
                }
                const rect = folderElement.getBoundingClientRect()
                const offsetY = event.clientY - rect.top
                updateDragOverFolderTarget({
                  folderId,
                  zone: offsetY >= rect.height / 2 ? 'after' : 'before'
                })
              }}
              onDragEnd={() => {
                updateDragOverFolderTarget(undefined)
                clearConnectionDragState()
              }}
              height={enableVirtualTree ? resourceTreeHeight : undefined}
              itemHeight={itemHeight}
              motion={false}
              switcherIcon={(nodeProps) => {
                if (nodeProps.eventKey != null && treeLoadingKeysRef.current.has(nodeProps.eventKey)) {
                  return <LoadingOutlined spin className="tree-node-loading-icon" />
                }
                if (nodeProps.isLeaf) {
                  return undefined
                }
                return (
                  <span className="tree-switcher-glyph" aria-hidden="true">
                    <span className={`tree-switcher-orb${nodeProps.expanded ? ' is-expanded' : ''}`}>
                      <span className="tree-switcher-line tree-switcher-line-horizontal" />
                      <span className="tree-switcher-line tree-switcher-line-vertical" />
                    </span>
                  </span>
                )
              }}
              treeData={treeData}
              expandedKeys={expandedKeys}
              titleRender={(node) => renderTreeTitle(node as DatabaseTreeNode)}
              selectedKeys={selectedTreeKeys}
              onExpand={(keys, info) => {
                const node = info.node as DatabaseTreeNode
                if (node.key && treeLoadingKeysRef.current.has(node.key as Key)) {
                  return
                }
                if (isTreeNodeChildrenLoaded(node) || !isLoadableTreeNode(node, getConnection(node.connectionId)?.database_type)) {
                  setExpandedKeys(keys)
                  if (info.expanded && (node.kind === 'database' || node.kind === 'pg-schema')) {
                    activateAIContextFromNode(node)
                  }
                  return
                }
                if (!info.expanded) {
                  collapseTreeNode(node)
                  return
                }
                setExpandedKeys(keys)
                if (node.kind === 'database' || node.kind === 'pg-schema') {
                  activateAIContextFromNode(node)
                }
                if (!isTreeNodeChildrenLoaded(node) && isLoadableTreeNode(node, getConnection(node.connectionId)?.database_type)) {
                  void reloadNodeChildren({ ...node, isLeaf: false }, true)
                }
              }}
              onSelect={(_, info) => {
                const node = info.node as DatabaseTreeNode
                scheduleTreeSelection(node, info.nativeEvent as MouseEvent)
              }}
              onRightClick={({ node, event }) => {
                event.preventDefault()
                resourceTreeContainerRef.current?.focus()
                const treeNode = node as DatabaseTreeNode
                const items = getTreeContextMenuItems(treeNode)
                if (!items || items.length === 0) {
                  return
                }
                if (treeNode.kind === 'connection' && treeNode.connectionId && !selectedConnectionIds.includes(treeNode.connectionId)) {
                  selectConnectionNodes([treeNode.connectionId], treeNode.connectionId)
                } else if (treeNode.kind !== 'connection') {
                  setSelectedTreeKeys([treeNode.key as Key])
                }
                setFocusedTreeNode(treeNode)
                if (treeNode.connectionId) {
                  setSelectedConnectionId(treeNode.connectionId)
                }
                setTreeContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  node: treeNode
                })
              }}
              onDrop={handleTreeDrop as never}
              onDoubleClick={(event, node) => {
                clearPendingTreeSelection()
                const startedAt = performance.now()
                const treeNode = node as DatabaseTreeNode
                commitTreeSelection(treeNode, event.nativeEvent)
                if (treeNode.kind === 'database' || treeNode.kind === 'pg-schema') {
                  activateAIContextFromNode(treeNode)
                }
                if (treeNode.kind === 'database' && treeNode.connectionId && treeNode.databaseName && getConnection(treeNode.connectionId)?.database_type === 'redis') {
                  console.info('[perf][tree] open-redis-db', {
                    key: treeNode.key,
                    database: treeNode.databaseName,
                    duration: Number((performance.now() - startedAt).toFixed(2))
                  })
                  activateAIContextFromNode(treeNode)
                  void openRedisDatabaseBrowser(treeNode.connectionId, treeNode.databaseName)
                  return
                }
                if ((treeNode.kind === 'table' || treeNode.kind === 'db-object') && treeNode.connectionId && treeNode.tableName && (treeNode.objectType === 'table' || treeNode.objectType === 'view')) {
                  activateAIContextFromNode(treeNode)
                  const connection = getConnection(treeNode.connectionId)
                  if (connection?.database_type === 'redis') {
                    void openRedisDatabaseBrowser(treeNode.connectionId, treeNode.databaseName ?? getDefaultDatabaseName(connection) ?? 'db0')
                  } else {
                    const connectionId = treeNode.connectionId
                    const tableName = treeNode.tableName
                    const objectType: 'table' | 'view' = treeNode.objectType
                    console.info('[perf][tree] preview-table-request', {
                      key: treeNode.key,
                      table: tableName,
                      duration: Number((performance.now() - startedAt).toFixed(2))
                    })
                    requestAnimationFrame(() => {
                      void previewTable(connectionId, tableName, treeNode.databaseName, treeNode.pgDatabaseName, previewDefaultLimit, 1, '', objectType)
                    })
                  }
                  return
                }
                if (treeNode.kind === 'connection' && treeNode.connectionId) {
                  const connection = getConnection(treeNode.connectionId)
                  if (connection && !connection.is_open) {
                    console.info('[perf][tree] open-connection-request', {
                      key: treeNode.key,
                      duration: Number((performance.now() - startedAt).toFixed(2))
                    })
                    void openConnectionById(treeNode.connectionId).then((openedConnection) => {
                      if (openedConnection?.is_open && openedConnection.database_type !== 'sqlite') {
                        toggleOrLoadTreeNode({ ...treeNode, closed: false, childrenLoaded: false, isLeaf: false })
                      }
                    })
                    return
                  }
                  console.info('[perf][tree] toggle-connection', {
                    key: treeNode.key,
                    duration: Number((performance.now() - startedAt).toFixed(2))
                  })
                  toggleOrLoadTreeNode(treeNode)
                  return
                }
                console.info('[perf][tree] toggle-node', {
                  key: treeNode.key,
                  duration: Number((performance.now() - startedAt).toFixed(2))
                })
                toggleOrLoadTreeNode(treeNode)
              }}
            />
          )}
        </div>
        {treeContextMenu && typeof document !== 'undefined' && createPortal(
          <div className="tree-context-menu-backdrop">
            <div
              ref={treeContextMenuPanelRef}
              className="tree-context-menu-panel"
              style={treeContextMenuStyle ?? {
                left: treeContextMenu.x,
                top: treeContextMenu.y,
                visibility: 'hidden'
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Menu items={treeContextMenuItems} onClick={handleTreeContextMenuClick} />
            </div>
          </div>,
          document.body
        )}
      </div>
    </>
  )
}, (prev, next) => (
  prev.connectionsInitialized === next.connectionsInitialized
  && prev.backendReady === next.backendReady
  && prev.treeData === next.treeData
  && prev.itemHeight === next.itemHeight
  && prev.enableVirtualTree === next.enableVirtualTree
  && prev.resourceTreeHeight === next.resourceTreeHeight
  && prev.expandedKeys === next.expandedKeys
  && prev.selectedTreeKeys === next.selectedTreeKeys
  && prev.selectedConnectionIds === next.selectedConnectionIds
  && prev.treeSearchOpen === next.treeSearchOpen
  && prev.treeSearchText === next.treeSearchText
  && prev.treeContextMenu === next.treeContextMenu
  && prev.treeLoadingVersion === next.treeLoadingVersion
))

export default ResourceTreePanel
