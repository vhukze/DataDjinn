import {
  BranchesOutlined,
  DatabaseOutlined,
  EyeOutlined,
  FunctionOutlined,
  TableOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { ReactNode } from 'react'
import type { ConnectionInfo } from './connection-model'
import type { DatabaseType } from './data-sources'

export type DbObjectType = 'table' | 'view' | 'trigger' | 'procedure' | 'function' | 'sequence' | 'index'
export type TreeNodeKind = 'folder' | 'folder-drop-placeholder' | 'connection' | 'database' | 'pg-schema' | 'object-group' | 'table' | 'db-object' | 'column'

export type ConnectionFolder = {
  id: string
  name: string
}

export type DbObjectGroupMeta = {
  type: DbObjectType
  title: string
  icon: ReactNode
}

export type DatabaseTreeNode = DataNode & {
  kind: TreeNodeKind
  folderId?: string
  connectionId?: string
  'data-connection-id'?: string
  databaseName?: string
  pgDatabaseName?: string
  tableName?: string
  objectType?: DbObjectType
  sizeDisplay?: string | null
  sizeBytes?: number | null
  storageSizeDisplay?: string | null
  storageSizeBytes?: number | null
  rowCount?: number | null
  comment?: string | null
  columnName?: string
  columnType?: string
  nullable?: boolean
  primaryKey?: boolean
  closed?: boolean
  childrenLoaded?: boolean
  children?: DatabaseTreeNode[]
}

export const treeIconBadge = (icon: ReactNode, tone: 'database' | 'schema' | 'table' | 'view' | 'trigger' | 'routine' | 'sequence' | 'index'): ReactNode => (
  <span className={`tree-icon-badge tree-icon-${tone}`}>
    {icon}
  </span>
)

export const DB_OBJECT_GROUPS: DbObjectGroupMeta[] = [
  { type: 'table', title: '表', icon: treeIconBadge(<TableOutlined />, 'table') },
  { type: 'view', title: '视图', icon: treeIconBadge(<EyeOutlined />, 'view') },
  { type: 'trigger', title: '触发器', icon: treeIconBadge(<ThunderboltOutlined />, 'trigger') },
  { type: 'procedure', title: '存储过程', icon: treeIconBadge(<FunctionOutlined />, 'routine') },
  { type: 'function', title: '函数', icon: treeIconBadge(<FunctionOutlined />, 'routine') },
  { type: 'sequence', title: '序列', icon: treeIconBadge(<DatabaseOutlined />, 'sequence') },
  { type: 'index', title: '索引', icon: treeIconBadge(<BranchesOutlined />, 'index') }
]

export const DB_OBJECT_GROUP_BY_TYPE = Object.fromEntries(DB_OBJECT_GROUPS.map((group) => [group.type, group])) as Record<DbObjectType, DbObjectGroupMeta>

export const plainObjectIconByType: Record<DbObjectType, ReactNode> = {
  table: <TableOutlined />,
  view: <EyeOutlined />,
  trigger: <ThunderboltOutlined />,
  procedure: <FunctionOutlined />,
  function: <FunctionOutlined />,
  sequence: <DatabaseOutlined />,
  index: <BranchesOutlined />
}

export const objectGroupTitle = (type: DbObjectType, databaseType?: DatabaseType): string => {
  if (databaseType === 'redis' && type === 'table') {
    return 'Key'
  }
  if (databaseType === 'mongodb' && type === 'table') {
    return '集合'
  }
  return DB_OBJECT_GROUP_BY_TYPE[type].title
}

export const DB_OBJECT_TYPES_BY_DATABASE: Record<DatabaseType, DbObjectType[]> = {
  sqlite: ['table', 'view', 'trigger', 'index'],
  mysql: ['table', 'view', 'trigger', 'procedure', 'function', 'index'],
  postgresql: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  dm: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  gaussdb: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  oracle: ['table', 'view', 'trigger', 'procedure', 'function', 'sequence', 'index'],
  clickhouse: ['table', 'view'],
  mongodb: ['table'],
  redis: ['table']
}

export const collectConnectionNodesById = (nodes: DatabaseTreeNode[]): Map<string, DatabaseTreeNode> => {
  const map = new Map<string, DatabaseTreeNode>()
  const visit = (currentNodes: DatabaseTreeNode[]): void => {
    for (const node of currentNodes) {
      if (node.kind === 'connection' && node.connectionId) {
        map.set(node.connectionId, node)
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return map
}

export const collectTreeNodesByKey = (nodes: DatabaseTreeNode[]): Map<string, DatabaseTreeNode> => {
  const map = new Map<string, DatabaseTreeNode>()
  const visit = (currentNodes: DatabaseTreeNode[]): void => {
    for (const node of currentNodes) {
      map.set(String(node.key), node)
      if (node.children?.length) {
        visit(node.children as DatabaseTreeNode[])
      }
    }
  }
  visit(nodes)
  return map
}

export const collectTreeParentKeysByChildKey = (nodes: DatabaseTreeNode[]): Map<string, string> => {
  const map = new Map<string, string>()
  const visit = (currentNodes: DatabaseTreeNode[], parentKey?: string): void => {
    currentNodes.forEach((node) => {
      const nodeKey = node.key ? String(node.key) : undefined
      if (nodeKey && parentKey) {
        map.set(nodeKey, parentKey)
      }
      if (node.children?.length) {
        visit(node.children as DatabaseTreeNode[], nodeKey)
      }
    })
  }
  visit(nodes)
  return map
}

export const getTreeNodeCopyName = (
  node: DatabaseTreeNode,
  resolveObjectGroupTitle: (type: DbObjectType) => string = (type) => objectGroupTitle(type)
): string => {
  if (node.kind === 'column' && node.columnName) {
    return node.columnName
  }
  if ((node.kind === 'table' || node.kind === 'db-object') && node.tableName) {
    return node.tableName
  }
  if ((node.kind === 'database' || node.kind === 'pg-schema') && node.databaseName) {
    return node.databaseName
  }
  if (node.kind === 'object-group') {
    return String(node.title ?? (node.objectType ? resolveObjectGroupTitle(node.objectType) : '对象'))
  }
  return String(node.title ?? '')
}

export const findTreeKeyPathByPredicate = (
  nodes: DatabaseTreeNode[],
  predicate: (node: DatabaseTreeNode) => boolean,
  parentPath: string[] = []
): string[] | undefined => {
  for (const node of nodes) {
    const nextPath = [...parentPath, String(node.key)]
    if (predicate(node)) {
      return nextPath
    }
    if (node.children?.length) {
      const childPath = findTreeKeyPathByPredicate(node.children as DatabaseTreeNode[], predicate, nextPath)
      if (childPath) {
        return childPath
      }
    }
  }
  return undefined
}

export const updateTreeNode = (nodes: DatabaseTreeNode[], key: React.Key, children: DatabaseTreeNode[]): DatabaseTreeNode[] => {
  const visit = (currentNodes: DatabaseTreeNode[]): [DatabaseTreeNode[], boolean] => {
    let changed = false

    const nextNodes = currentNodes.map((node) => {
      if (node.key === key) {
        changed = true
        return { ...node, children, childrenLoaded: true }
      }

      if (!node.children?.length) {
        return node
      }

      const [nextChildren, childChanged] = visit(node.children)
      if (!childChanged) {
        return node
      }

      changed = true
      return { ...node, children: nextChildren }
    })

    return [changed ? nextNodes : currentNodes, changed]
  }

  return visit(nodes)[0]
}

export const replaceConnectionNode = (
  nodes: DatabaseTreeNode[],
  connection: ConnectionInfo,
  buildConnectionNode: (connection: ConnectionInfo) => DatabaseTreeNode,
  preserveChildren?: boolean
): DatabaseTreeNode[] => {
  const visit = (currentNodes: DatabaseTreeNode[]): [DatabaseTreeNode[], boolean] => {
    let changed = false

    const nextNodes = currentNodes.map((node) => {
      if (node.kind === 'connection' && node.connectionId === connection.connection_id) {
        changed = true
        const nextNode = buildConnectionNode(connection)
        return preserveChildren && connection.is_open
          ? { ...nextNode, folderId: node.folderId, children: node.children, childrenLoaded: node.childrenLoaded }
          : { ...nextNode, folderId: node.folderId }
      }

      if (!node.children?.length) {
        return node
      }

      const [nextChildren, childChanged] = visit(node.children)
      if (!childChanged) {
        return node
      }

      changed = true
      return { ...node, children: nextChildren }
    })

    return [changed ? nextNodes : currentNodes, changed]
  }

  return visit(nodes)[0]
}

export const getTreeNodeKindFromKey = (node: Partial<DatabaseTreeNode>, folderDropPlaceholderKeyPrefix: string): TreeNodeKind | undefined => {
  const key = String(node.key ?? '')
  if (node.kind) {
    return node.kind
  }
  if (key.startsWith('folder:')) {
    return 'folder'
  }
  if (key.startsWith(folderDropPlaceholderKeyPrefix)) {
    return 'folder-drop-placeholder'
  }
  if (key.startsWith('connection:')) {
    return 'connection'
  }
  return undefined
}

export const getRelativeDropPosition = (node: DatabaseTreeNode, dropPosition: number): number => {
  const pos = (node as DatabaseTreeNode & { pos?: string }).pos
  const index = Number(pos?.split('-').at(-1))
  return Number.isFinite(index) ? dropPosition - index : Math.sign(dropPosition)
}

export const isTreeNodeChildrenLoaded = (node: DatabaseTreeNode): boolean =>
  Boolean(node.isLeaf || node.childrenLoaded || node.children?.length)

export const isLoadableTreeNode = (node: DatabaseTreeNode, databaseType?: DatabaseType): boolean => {
  if (node.kind === 'database' && node.connectionId && databaseType === 'redis') {
    return false
  }

  return node.kind === 'folder' || node.kind === 'connection' || node.kind === 'database' || node.kind === 'pg-schema' || node.kind === 'object-group' || node.kind === 'table'
}
