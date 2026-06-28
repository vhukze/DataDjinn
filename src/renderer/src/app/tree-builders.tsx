import { ApartmentOutlined, DatabaseOutlined, FolderOpenOutlined } from '@ant-design/icons'
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

  return DB_OBJECT_GROUPS
    .filter((group) => objectTypes.includes(group.type))
    .map((group) => ({
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

export const buildDatabaseNode = (connection: ConnectionInfo, database: DatabaseInfo): DatabaseTreeNode => ({
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

export const buildPgSchemaNode = (connection: ConnectionInfo, pgDatabaseName: string, schema: DatabaseInfo): DatabaseTreeNode => ({
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

export const buildFolderDropPlaceholderNode = (folderId: string, keyPrefix: string): DatabaseTreeNode => ({
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
  keyPrefix: string
): DatabaseTreeNode => ({
  key: `folder:${folder.id}`,
  title: folder.name,
  icon: <FolderOpenOutlined />,
  kind: 'folder',
  folderId: folder.id,
  children: children.length > 0 ? children : [buildFolderDropPlaceholderNode(folder.id, keyPrefix)],
  childrenLoaded: true,
  isLeaf: false
})

export type BuildResourceTreeOptions = {
  connectionFolderAssignments: Record<string, string>
  connectionFolders: ConnectionFolder[]
  folderConnectionOrder: Record<string, string[]>
  rootItemOrder: string[]
  rootFolderOrderId: (folderId: string) => string
  rootConnectionOrderId: (connectionId: string) => string
  mergeOrderedIds: (availableIds: string[], preferredIds: string[]) => string[]
  buildConnectionNode: (connection: ConnectionInfo) => DatabaseTreeNode
  buildFolderNode: (folder: ConnectionFolder, children: DatabaseTreeNode[]) => DatabaseTreeNode
}

export const buildResourceTree = (
  nextConnections: ConnectionInfo[],
  currentNodes: DatabaseTreeNode[] = [],
  options: BuildResourceTreeOptions
): DatabaseTreeNode[] => {
  const {
    connectionFolderAssignments,
    connectionFolders,
    folderConnectionOrder,
    rootItemOrder,
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

  for (const connection of nextConnections) {
    const existingNode = existingConnectionNodes.get(connection.connection_id)
    const nextNode = buildConnectionNode(connection)
    const folderId = connectionFolderAssignments[connection.connection_id]
    const node = existingNode && connection.is_open
      ? { ...nextNode, folderId, children: existingNode.children, childrenLoaded: existingNode.childrenLoaded }
      : { ...nextNode, folderId }

    if (folderId && validFolderIds.has(folderId)) {
      const items = groupedNodes.get(folderId) ?? []
      items.push(node)
      groupedNodes.set(folderId, items)
    } else {
      rootNodeMap.set(connection.connection_id, node)
    }
  }

  const folderIds = connectionFolders.map((folder) => folder.id)
  const rootConnectionIds = [...rootNodeMap.keys()]
  const orderedRootItems = mergeOrderedIds(
    [...folderIds.map(rootFolderOrderId), ...rootConnectionIds.map(rootConnectionOrderId)],
    rootItemOrder
  )

  const folderMap = new Map(connectionFolders.map((folder) => [folder.id, folder]))

  return orderedRootItems
    .map((itemId) => {
      if (itemId.startsWith('connection:')) {
        return rootNodeMap.get(itemId.slice('connection:'.length))
      }

      const folderId = itemId.slice('folder:'.length)
      const folder = folderMap.get(folderId)
      if (!folder) {
        return undefined
      }

      const childNodes = groupedNodes.get(folder.id) ?? []
      const childNodeMap = new Map(childNodes.map((node) => [node.connectionId ?? String(node.key), node]))
      const orderedChildIds = mergeOrderedIds(
        childNodes.map((node) => node.connectionId ?? String(node.key)),
        folderConnectionOrder[folder.id] ?? []
      )

      return buildFolderNode(
        folder,
        orderedChildIds
          .map((connectionId) => childNodeMap.get(connectionId))
          .filter((node): node is DatabaseTreeNode => Boolean(node))
      )
    })
    .filter((node): node is DatabaseTreeNode => Boolean(node))
}
