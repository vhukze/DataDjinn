export type GitSyncConflictDisplayContext = {
  connectionNames: Record<string, string>
  folderNames: Record<string, string>
  folderParents?: Record<string, string | undefined>
}

export type GitSyncConflictDisplay = {
  title: string
  description: string
}

export type GitSyncConflictLike = {
  key: string
  path_segments: string[]
}

export type GitSyncConflictGroup<T extends GitSyncConflictLike = GitSyncConflictLike> = {
  key: string
  title: string
  description: string
  conflicts: T[]
}

export type GitSyncTreeOrder = {
  roots: string[]
  children: Record<string, string[]>
  customized?: boolean
}

export type GitSyncTreeFolder = {
  id: string
  parentId?: string
}

export type GitSyncTreeSnapshotInput = {
  folders: GitSyncTreeFolder[]
  connectionIds: string[]
  assignments: Record<string, string>
  folderOrder: string[]
  folderConnectionOrder: Record<string, string[]>
  rootItemOrder: string[]
  rootConnectionOrder: string[]
  pinnedRootItemIds: string[]
  rootItemOrderCustomized: boolean
}

export type GitSyncTreeDiffNode = {
  id: string
  label: string
  kind: 'folder' | 'connection'
  depth: number
  status: 'same' | 'added' | 'removed' | 'moved'
}

export type GitSyncTreeDiff = {
  local: GitSyncTreeDiffNode[]
  remote: GitSyncTreeDiffNode[]
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const orderAvailableIds = (availableIds: string[], preferredIds: string[]): string[] => {
  const available = new Set(availableIds)
  const ordered = preferredIds.filter((id) => available.has(id))
  const orderedSet = new Set(ordered)
  return [...ordered, ...availableIds.filter((id) => !orderedSet.has(id))]
}

const folderItemId = (folderId: string): string => `folder:${folderId}`
const connectionItemId = (connectionId: string): string => `connection:${connectionId}`

export const buildGitSyncTreeOrder = ({
  folders,
  connectionIds,
  assignments,
  folderOrder,
  folderConnectionOrder,
  rootItemOrder,
  rootConnectionOrder,
  pinnedRootItemIds,
  rootItemOrderCustomized
}: GitSyncTreeSnapshotInput): GitSyncTreeOrder => {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const childrenByParent = new Map<string | undefined, string[]>()
  for (const folder of folders) {
    const parentId =
      folder.parentId && folder.parentId !== folder.id && folderById.has(folder.parentId)
        ? folder.parentId
        : undefined
    const childFolderIds = childrenByParent.get(parentId) ?? []
    childFolderIds.push(folder.id)
    childrenByParent.set(parentId, childFolderIds)
  }

  const validFolderIds = new Set(folderById.keys())
  const rootConnectionIds = connectionIds.filter(
    (connectionId) => !assignments[connectionId] || !validFolderIds.has(assignments[connectionId])
  )
  const rootFolderIds = childrenByParent.get(undefined) ?? []
  const defaultRoots = [
    ...orderAvailableIds(rootFolderIds, folderOrder).map(folderItemId),
    ...orderAvailableIds(rootConnectionIds, rootConnectionOrder).map(connectionItemId)
  ]
  const availableRoots = [...rootFolderIds.map(folderItemId), ...rootConnectionIds.map(connectionItemId)]
  const preferredRoots = rootItemOrderCustomized && rootItemOrder.length > 0 ? rootItemOrder : defaultRoots
  const rawRoots = orderAvailableIds(availableRoots, preferredRoots)
  const orderRootSection = (ids: string[]): string[] => {
    const available = new Set(ids)
    const pinned = pinnedRootItemIds.filter((id) => available.has(id))
    const pinnedSet = new Set(pinned)
    return [...pinned, ...ids.filter((id) => !pinnedSet.has(id))]
  }
  const roots = [
    ...orderRootSection(rawRoots.filter((itemId) => itemId.startsWith('folder:'))),
    ...orderRootSection(rawRoots.filter((itemId) => itemId.startsWith('connection:')))
  ]

  const children: Record<string, string[]> = {}
  for (const folder of folders) {
    const childFolders = orderAvailableIds(childrenByParent.get(folder.id) ?? [], folderOrder)
    const childConnections = orderAvailableIds(
      connectionIds.filter((connectionId) => assignments[connectionId] === folder.id),
      folderConnectionOrder[folder.id] ?? []
    )
    children[folder.id] = [
      ...childFolders.map(folderItemId),
      ...childConnections.map(connectionItemId)
    ]
  }
  return { roots, children, ...(rootItemOrderCustomized ? { customized: true } : {}) }
}

const CONNECTION_FIELD_LABELS: Record<string, string> = {
  name: '连接名称',
  database_type: '数据库类型',
  host: '主机地址',
  port: '端口',
  username: '用户名',
  database: '默认数据库',
  sqlite_path: 'SQLite 文件路径',
  ssh_enabled: 'SSH 隧道开关',
  ssh_host: 'SSH 主机',
  ssh_port: 'SSH 端口',
  ssh_username: 'SSH 用户名',
  git_versioning_enabled: 'Git 版本管理开关'
}

const PREFERENCE_LABELS: Record<string, string> = {
  connection_folders: '连接分组列表',
  connection_folder_assignments: '连接所属分组',
  tree_order: '连接树排序',
  connection_folder_order: '连接树排序',
  root_connection_order: '连接树排序',
  root_item_order: '连接树排序',
  folder_connection_order: '连接树排序',
  pinned_root_item_ids: '置顶节点',
  selected_databases: '已选数据库',
  selected_schemas: '已选模式'
}

const CONNECTION_TREE_ORDER_FIELDS = new Set([
  'connection_folder_order',
  'root_connection_order',
  'root_item_order',
  'folder_connection_order',
  'tree_order'
])

export const groupGitSyncConflicts = <T extends GitSyncConflictLike>(
  conflicts: T[]
): GitSyncConflictGroup<T>[] => {
  const groups = new Map<string, GitSyncConflictGroup<T>>()
  for (const conflict of conflicts) {
    const isConnectionTreeOrder =
      conflict.path_segments[0] === 'preferences' &&
      CONNECTION_TREE_ORDER_FIELDS.has(conflict.path_segments[1] ?? '')
    const groupKey = isConnectionTreeOrder ? 'connection-tree-order' : conflict.key
    const existing = groups.get(groupKey)
    if (existing) {
      existing.conflicts.push(conflict)
      continue
    }
    groups.set(groupKey, {
      key: groupKey,
      title: isConnectionTreeOrder ? '连接树排序' : conflict.path_segments.join(' · '),
      description: isConnectionTreeOrder
        ? '本机和远程对连接树排列顺序的修改无法自动合并，请整体选择一侧。'
        : '本机和远程对这项配置的修改无法自动合并。',
      conflicts: [conflict]
    })
  }
  return [...groups.values()]
}

export const createDefaultGitSyncConflictChoices = <T extends GitSyncConflictLike>(
  conflicts: T[]
): Record<string, 'local'> => Object.fromEntries(conflicts.map((conflict) => [conflict.key, 'local']))

const getName = (names: Record<string, string>, id: string, type: string): string =>
  names[id] ?? `${type}（${id.slice(0, 8)}…）`

const getConnectionName = (context: GitSyncConflictDisplayContext, id: string): string =>
  getName(context.connectionNames, id, '连接')

const getFolderName = (context: GitSyncConflictDisplayContext, id: string): string =>
  getName(context.folderNames, id, '分组')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeGitSyncTreeOrder = (
  value: unknown,
  context: GitSyncConflictDisplayContext
): GitSyncTreeOrder => {
  if (!isRecord(value)) {
    return { roots: [], children: {} }
  }
  const roots = toStringArray(value.roots)
  if (isRecord(value.children)) {
    return {
      roots,
      children: Object.fromEntries(
        Object.entries(value.children).map(([folderId, childIds]) => [
          folderId,
          toStringArray(childIds)
        ])
      ),
      ...(value.customized === true ? { customized: true } : {})
    }
  }

  const folderOrder = toStringArray(value.folder_order)
  const folderConnections = isRecord(value.folder_connections) ? value.folder_connections : {}
  const folderIds = new Set([...Object.keys(context.folderNames), ...Object.keys(folderConnections)])
  const folderChildrenByParent = new Map<string | undefined, string[]>()
  for (const folderId of folderIds) {
    const parentId = context.folderParents?.[folderId]
    const childFolderIds = folderChildrenByParent.get(parentId) ?? []
    childFolderIds.push(folderId)
    folderChildrenByParent.set(parentId, childFolderIds)
  }
  const children = Object.fromEntries(
    [...folderIds].map((folderId) => [
      folderId,
      [
        ...orderAvailableIds(folderChildrenByParent.get(folderId) ?? [], folderOrder).map(
          folderItemId
        ),
        ...toStringArray(folderConnections[folderId]).map(connectionItemId)
      ]
    ])
  )
  return {
    roots:
      roots.length > 0
        ? roots
        : orderAvailableIds(folderChildrenByParent.get(undefined) ?? [], folderOrder).map(
            folderItemId
          ),
    children,
    ...(value.customized === true ? { customized: true } : {})
  }
}

type TreeNodeLocation = {
  parentId?: string
  index: number
}

const collectTreeNodeLocations = (tree: GitSyncTreeOrder): Map<string, TreeNodeLocation> => {
  const locations = new Map<string, TreeNodeLocation>()
  const visit = (itemIds: string[], parentId?: string, ancestors = new Set<string>()): void => {
    itemIds.forEach((itemId, index) => {
      if (locations.has(itemId)) {
        return
      }
      locations.set(itemId, { parentId, index })
      if (!itemId.startsWith('folder:')) {
        return
      }
      const folderId = itemId.slice('folder:'.length)
      if (ancestors.has(folderId)) {
        return
      }
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(folderId)
      visit(tree.children[folderId] ?? [], folderId, nextAncestors)
    })
  }
  visit(tree.roots)
  return locations
}

const flattenGitSyncTree = (
  tree: GitSyncTreeOrder,
  oppositeLocations: Map<string, TreeNodeLocation>,
  side: 'local' | 'remote',
  context: GitSyncConflictDisplayContext
): GitSyncTreeDiffNode[] => {
  const locations = collectTreeNodeLocations(tree)
  const rows: GitSyncTreeDiffNode[] = []
  const visited = new Set<string>()
  const visit = (itemIds: string[], depth: number, ancestors = new Set<string>()): void => {
    itemIds.forEach((itemId) => {
      if (visited.has(itemId)) {
        return
      }
      visited.add(itemId)
      const location = locations.get(itemId)
      const opposite = oppositeLocations.get(itemId)
      const kind = itemId.startsWith('folder:') ? 'folder' : 'connection'
      const id = itemId.slice(kind === 'folder' ? 'folder:'.length : 'connection:'.length)
      const status = !opposite
        ? side === 'local'
          ? 'removed'
          : 'added'
        : opposite.parentId !== location?.parentId || opposite.index !== location?.index
          ? 'moved'
          : 'same'
      rows.push({
        id: itemId,
        label: kind === 'folder' ? getFolderName(context, id) : getConnectionName(context, id),
        kind,
        depth,
        status
      })
      if (kind === 'folder' && !ancestors.has(id)) {
        const nextAncestors = new Set(ancestors)
        nextAncestors.add(id)
        visit(tree.children[id] ?? [], depth + 1, nextAncestors)
      }
    })
  }
  visit(tree.roots, 0)
  return rows
}

export const buildGitSyncTreeDiff = (
  localValue: unknown,
  remoteValue: unknown,
  context: GitSyncConflictDisplayContext
): GitSyncTreeDiff => {
  const localTree = normalizeGitSyncTreeOrder(localValue, context)
  const remoteTree = normalizeGitSyncTreeOrder(remoteValue, context)
  return {
    local: flattenGitSyncTree(
      localTree,
      collectTreeNodeLocations(remoteTree),
      'local',
      context
    ),
    remote: flattenGitSyncTree(
      remoteTree,
      collectTreeNodeLocations(localTree),
      'remote',
      context
    )
  }
}

const getOrderItemLabel = (
  value: string,
  pathSegments: string[],
  context: GitSyncConflictDisplayContext
): string => {
  const preference = pathSegments[1]
  if (preference === 'root_connection_order' || preference === 'folder_connection_order') {
    return getConnectionName(context, value)
  }
  if (preference === 'connection_folder_order') {
    return getFolderName(context, value)
  }
  if (preference === 'root_item_order') {
    if (value.startsWith('folder:')) {
      return `分组：${getFolderName(context, value.slice('folder:'.length))}`
    }
    if (value.startsWith('connection:')) {
      return `连接：${getConnectionName(context, value.slice('connection:'.length))}`
    }
  }
  return value
}

export const describeGitSyncConflict = (
  pathSegments: string[],
  context: GitSyncConflictDisplayContext
): GitSyncConflictDisplay => {
  const [scope, first, second] = pathSegments
  if (scope === 'connections' && first) {
    const connectionName = getConnectionName(context, first)
    const fieldName = second ? CONNECTION_FIELD_LABELS[second] ?? second : '连接配置'
    return {
      title: `连接「${connectionName}」· ${fieldName}`,
      description: '同一个连接的此项配置在本机和远程都发生了修改。'
    }
  }

  if (scope === 'preferences' && first) {
    const preferenceName = PREFERENCE_LABELS[first] ?? first
    if (first === 'connection_folder_assignments' && second) {
      return {
        title: `连接「${getConnectionName(context, second)}」· 所属分组`,
        description: '本机和远程把这个连接放到了不同分组。'
      }
    }
    if (first === 'folder_connection_order' && second) {
      return {
        title: '连接树排序',
        description: `本机和远程对连接树中「${getFolderName(context, second)}」内的排列顺序不同。`
      }
    }
    return {
      title: preferenceName,
      description: '本机和远程对这项连接树设置的修改无法自动合并。'
    }
  }

  if (scope === 'settings' && first) {
    return {
      title: `应用设置 · ${first}`,
      description: '本机和远程对这项应用设置的修改无法自动合并。'
    }
  }

  return {
    title: pathSegments.join(' · ') || '同步配置',
    description: '本机和远程对这项配置的修改无法自动合并。'
  }
}

const formatObjectValue = (
  value: Record<string, unknown>,
  pathSegments: string[],
  context: GitSyncConflictDisplayContext
): string => {
  if (pathSegments[0] === 'preferences' && pathSegments[1] === 'tree_order') {
    const roots = Array.isArray(value.roots)
      ? formatGitSyncConflictValue(value.roots, ['preferences', 'root_item_order'], context)
      : '未设置'
    return `连接树根节点：\n${roots}`
  }
  if (pathSegments[0] === 'preferences' && pathSegments[1] === 'connection_folder_assignments') {
    return Object.entries(value)
      .map(
        ([connectionId, folderId]) =>
          `连接「${getConnectionName(context, connectionId)}」 → ${
            typeof folderId === 'string' ? `分组「${getFolderName(context, folderId)}」` : '未分组'
          }`
      )
      .join('\n')
  }
  if (pathSegments[0] === 'preferences' && pathSegments[1] === 'folder_connection_order') {
    return Object.entries(value)
      .map(([folderId, connectionIds]) => {
        const labels = Array.isArray(connectionIds)
          ? connectionIds.map((id) =>
              typeof id === 'string' ? getConnectionName(context, id) : String(id)
            )
          : [String(connectionIds)]
        return `分组「${getFolderName(context, folderId)}」：${labels.join(' → ')}`
      })
      .join('\n')
  }
  return Object.entries(value)
    .map(([key, item]) => `${key}：${typeof item === 'string' ? item : JSON.stringify(item)}`)
    .join('\n')
}

export const formatGitSyncConflictValue = (
  value: unknown,
  pathSegments: string[],
  context: GitSyncConflictDisplayContext
): string => {
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      typeof item === 'string' ? getOrderItemLabel(item, pathSegments, context) : String(item)
    )
    return `共 ${items.length} 项\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
  }
  if (value && typeof value === 'object') {
    return formatObjectValue(value as Record<string, unknown>, pathSegments, context)
  }
  if (
    pathSegments[0] === 'preferences' &&
    pathSegments[1] === 'connection_folder_assignments' &&
    pathSegments[2] &&
    typeof value === 'string'
  ) {
    return `分组「${getFolderName(context, value)}」`
  }
  return value === undefined ? '未设置' : String(value)
}
