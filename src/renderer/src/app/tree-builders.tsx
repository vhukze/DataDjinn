import { ApartmentOutlined, DatabaseOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { ConnectionInfo, DatabaseInfo } from './connection-model'
import type { DatabaseType } from './data-sources'
import {
  collectConnectionNodesById,
  DB_OBJECT_GROUPS,
  DB_OBJECT_TYPES_BY_DATABASE,
  objectGroupTitle,
  treeIconBadge,
  type ConnectionFolder,
  type DatabaseTreeNode
} from './tree-model'

export type ConnectionTypeIcons = Record<DatabaseType, ReactNode>

export const CONNECTION_DATABASE_TYPES_WITH_DATABASE_LEVEL: DatabaseType[] = [
  'mysql',
  'postgresql',
  'dm',
  'gaussdb',
  'oracle',
  'mongodb',
  'redis',
  'clickhouse'
]

const DATABASE_LEVEL_TYPE_SET = new Set<DatabaseType>(CONNECTION_DATABASE_TYPES_WITH_DATABASE_LEVEL)

export const buildObjectGroupNodes = (
  connectionId: string,
  databaseType: DatabaseType,
  databaseName?: string,
  pgDatabaseName?: string
): DatabaseTreeNode[] => {
  const objectTypes = DB_OBJECT_TYPES_BY_DATABASE[databaseType]

  return DB_OBJECT_GROUPS.filter((group) => objectTypes.includes(group.type)).map((group) => ({
    key: `object-group:${connectionId}:${pgDatabaseName ?? ''}:${databaseName ?? ''}:${group.type}`,
    title: objectGroupTitle(group.type, databaseType),
    icon: group.icon,
    kind: 'object-group',
    connectionId,
    databaseName,
    pgDatabaseName,
    objectType: group.type,
    childrenLoaded: false,
    isLeaf: false
  }))
}

export const buildDatabaseNode = (
  connection: ConnectionInfo,
  database: DatabaseInfo
): DatabaseTreeNode => ({
  key: `database:${connection.connection_id}:${database.name}`,
  title: database.name,
  icon: treeIconBadge(<DatabaseOutlined />, 'database'),
  kind: 'database',
  connectionId: connection.connection_id,
  databaseName: database.name,
  sizeDisplay: database.size_display,
  sizeBytes: database.size_bytes,
  storageSizeDisplay: database.storage_size_display,
  storageSizeBytes: database.storage_size_bytes,
  childrenLoaded: connection.database_type === 'redis',
  isLeaf: connection.database_type === 'redis'
})

export const buildPgSchemaNode = (
  connection: ConnectionInfo,
  pgDatabaseName: string,
  schema: DatabaseInfo
): DatabaseTreeNode => ({
  key: `pg-schema:${connection.connection_id}:${pgDatabaseName}:${schema.name}`,
  title: schema.name,
  icon: treeIconBadge(<ApartmentOutlined />, 'schema'),
  kind: 'pg-schema',
  connectionId: connection.connection_id,
  databaseName: schema.name,
  pgDatabaseName,
  sizeDisplay: schema.size_display,
  sizeBytes: schema.size_bytes,
  storageSizeDisplay: schema.storage_size_display,
  storageSizeBytes: schema.storage_size_bytes,
  childrenLoaded: false,
  isLeaf: false
})

export const buildConnectionNode = (
  connection: ConnectionInfo,
  connectionTypeIcons: ConnectionTypeIcons
): DatabaseTreeNode => {
  const children = DATABASE_LEVEL_TYPE_SET.has(connection.database_type)
    ? undefined
    : buildObjectGroupNodes(connection.connection_id, connection.database_type)

  return {
    key: `connection:${connection.connection_id}`,
    title: connection.name,
    icon: connectionTypeIcons[connection.database_type],
    kind: 'connection',
    connectionId: connection.connection_id,
    'data-connection-id': connection.connection_id,
    className: `${connection.is_open ? '' : 'tree-node-closed '}tree-connection-row`.trim(),
    children,
    closed: !connection.is_open,
    childrenLoaded: Boolean(children),
    isLeaf: !connection.is_open
  }
}

export const buildFolderDropPlaceholderNode = (
  folderId: string,
  keyPrefix: string
): DatabaseTreeNode => ({
  key: `${keyPrefix}${folderId}`,
  title: '',
  kind: 'folder-drop-placeholder',
  folderId,
  className: 'folder-drop-placeholder-node',
  childrenLoaded: true,
  isLeaf: true
})

export const buildFolderNode = (
  folder: ConnectionFolder,
  children: DatabaseTreeNode[],
  keyPrefix: string,
  isNested = false
): DatabaseTreeNode => ({
  key: `folder:${folder.id}`,
  title: folder.name,
  kind: 'folder',
  folderId: folder.id,
  className: `tree-folder-row${isNested ? ' tree-folder-child-row' : ''}`,
  children: children.length > 0 ? children : [buildFolderDropPlaceholderNode(folder.id, keyPrefix)],
  childrenLoaded: true,
  isLeaf: false
})

export type BuildResourceTreeOptions = {
  connectionFolderAssignments: Record<string, string>
  connectionFolders: ConnectionFolder[]
  folderOrder: string[]
  folderConnectionOrder: Record<string, string[]>
  rootItemOrder: string[]
  pinnedRootItemIds: string[]
  rootFolderOrderId: (folderId: string) => string
  rootConnectionOrderId: (connectionId: string) => string
  mergeOrderedIds: (availableIds: string[], preferredIds: string[]) => string[]
  buildConnectionNode: (connection: ConnectionInfo) => DatabaseTreeNode
  buildFolderNode: (
    folder: ConnectionFolder,
    children: DatabaseTreeNode[],
    isNested?: boolean
  ) => DatabaseTreeNode
}

export const buildResourceTree = (
  nextConnections: ConnectionInfo[],
  currentNodes: DatabaseTreeNode[] = [],
  options: BuildResourceTreeOptions
): DatabaseTreeNode[] => {
  const {
    connectionFolderAssignments,
    connectionFolders,
    folderOrder,
    folderConnectionOrder,
    rootItemOrder,
    pinnedRootItemIds,
    rootFolderOrderId,
    rootConnectionOrderId,
    mergeOrderedIds,
    buildConnectionNode,
    buildFolderNode
  } = options

  const existingConnectionNodes = collectConnectionNodesById(currentNodes)
  const groupedNodes = new Map<string, DatabaseTreeNode[]>()
  const rootNodeMap = new Map<string, DatabaseTreeNode>()
  const validFolderIds = new Set(connectionFolders.map((folder) => folder.id))
  const inheritFolderTreeContext = (
    childNodes: DatabaseTreeNode[],
    folderId: string
  ): DatabaseTreeNode[] =>
    childNodes.map((child) => ({
      ...child,
      folderId,
      className: `${child.className ?? ''} tree-folder-connection-descendant`.trim(),
      children: child.children
        ? inheritFolderTreeContext(child.children as DatabaseTreeNode[], folderId)
        : child.children
    }))

  for (const connection of nextConnections) {
    const existingNode = existingConnectionNodes.get(connection.connection_id)
    const nextNode = buildConnectionNode(connection)
    const folderId = connectionFolderAssignments[connection.connection_id]
    const node =
      existingNode && connection.is_open
        ? {
            ...nextNode,
            folderId,
            children: existingNode.children,
            childrenLoaded: existingNode.childrenLoaded
          }
        : { ...nextNode, folderId }

    if (folderId && validFolderIds.has(folderId)) {
      const items = groupedNodes.get(folderId) ?? []
      items.push({
        ...node,
        className: `${node.className ?? ''} tree-folder-connection-row`.trim(),
        children: node.children
          ? inheritFolderTreeContext(node.children as DatabaseTreeNode[], folderId)
          : node.children
      })
      groupedNodes.set(folderId, items)
    } else {
      rootNodeMap.set(connection.connection_id, node)
    }
  }

  const folderMap = new Map(connectionFolders.map((folder) => [folder.id, folder]))
  const parentFolderIdById = new Map(
    connectionFolders.map((folder) => [
      folder.id,
      folder.parentId && folder.parentId !== folder.id && folderMap.has(folder.parentId)
        ? folder.parentId
        : undefined
    ])
  )
  const childFolderIdsByParentId = new Map<string | undefined, string[]>()
  connectionFolders.forEach((folder) => {
    const parentId = parentFolderIdById.get(folder.id)
    const children = childFolderIdsByParentId.get(parentId) ?? []
    children.push(folder.id)
    childFolderIdsByParentId.set(parentId, children)
  })
  const folderIds = childFolderIdsByParentId.get(undefined) ?? []
  const rootConnectionIds = [...rootNodeMap.keys()]
  const rootItems = mergeOrderedIds(
    [...folderIds.map(rootFolderOrderId), ...rootConnectionIds.map(rootConnectionOrderId)],
    rootItemOrder
  )
  const folderRootItems = rootItems.filter((itemId) => itemId.startsWith('folder:'))
  const connectionRootItems = rootItems.filter((itemId) => itemId.startsWith('connection:'))
  const orderRootItemsWithinSection = (itemIds: string[]): string[] => {
    const itemIdSet = new Set(itemIds)
    const pinnedItemIds = pinnedRootItemIds.filter((itemId) => itemIdSet.has(itemId))
    const pinnedItemIdSet = new Set(pinnedItemIds)
    return [...pinnedItemIds, ...itemIds.filter((itemId) => !pinnedItemIdSet.has(itemId))]
  }
  // Root folders and root connections are independently sortable sections. A pin never moves
  // a connection ahead of folders, or a folder into the connection section.
  const orderedRootItems = [
    ...orderRootItemsWithinSection(folderRootItems),
    ...orderRootItemsWithinSection(connectionRootItems)
  ]

  const buildFolderTree = (folderId: string, ancestorFolderIds: Set<string>): DatabaseTreeNode | undefined => {
    const folder = folderMap.get(folderId)
    if (!folder || ancestorFolderIds.has(folderId)) {
      return undefined
    }

    const nextAncestorFolderIds = new Set(ancestorFolderIds)
    nextAncestorFolderIds.add(folderId)
    const childFolderIds = mergeOrderedIds(
      childFolderIdsByParentId.get(folderId) ?? [],
      folderOrder
    )
    const childFolderNodes = childFolderIds
      .map((childFolderId) => buildFolderTree(childFolderId, nextAncestorFolderIds))
      .filter((node): node is DatabaseTreeNode => Boolean(node))

    const childNodes = groupedNodes.get(folder.id) ?? []
    const childNodeMap = new Map(
      childNodes.map((node) => [node.connectionId ?? String(node.key), node])
    )
    const orderedChildIds = mergeOrderedIds(
      childNodes.map((node) => node.connectionId ?? String(node.key)),
      folderConnectionOrder[folder.id] ?? []
    )

    return buildFolderNode(
      folder,
      [
        ...childFolderNodes,
        ...orderedChildIds
          .map((connectionId) => childNodeMap.get(connectionId))
          .filter((node): node is DatabaseTreeNode => Boolean(node))
      ],
      Boolean(parentFolderIdById.get(folder.id))
    )
  }

  return orderedRootItems
    .map((itemId) => {
      if (itemId.startsWith('connection:')) {
        return rootNodeMap.get(itemId.slice('connection:'.length))
      }

      const folderId = itemId.slice('folder:'.length)
      return buildFolderTree(folderId, new Set())
    })
    .filter((node): node is DatabaseTreeNode => Boolean(node))
}
