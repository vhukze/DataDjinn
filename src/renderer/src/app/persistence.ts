import type { DatabaseType } from './data-sources'

export const STORAGE_DB = 'datadjinn-selected-databases'
export const STORAGE_SCHEMA = 'datadjinn-selected-schemas'
export const STORAGE_CONNECTION_FOLDERS = 'datadjinn-connection-folders'
export const STORAGE_CONNECTION_FOLDER_ASSIGNMENTS = 'datadjinn-connection-folder-assignments'
export const STORAGE_CONNECTION_FOLDER_ORDER = 'datadjinn-connection-folder-order'
export const STORAGE_ROOT_CONNECTION_ORDER = 'datadjinn-root-connection-order'
export const STORAGE_ROOT_ITEM_ORDER = 'datadjinn-root-item-order'
export const STORAGE_FOLDER_CONNECTION_ORDER = 'datadjinn-folder-connection-order'
export const STORAGE_QUERY_WORKSPACES = 'datadjinn-query-workspaces'
export const STORAGE_SHORTCUT_SETTINGS = 'datadjinn-shortcut-settings'

export type DatabaseSelectionConnection = {
  database_type: DatabaseType
  database: string
}

export type DatabaseSelectionItem = {
  name: string
  size_bytes?: number | null
}

export const readPersisted = (key: string): Record<string, string[]> => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export const readPersistedJson = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) as T : fallback
  } catch {
    return fallback
  }
}

export const mergeOrderedIds = (availableIds: string[], preferredIds: string[]): string[] => {
  const available = new Set(availableIds)
  const ordered = preferredIds.filter((id) => available.has(id))
  const orderedSet = new Set(ordered)
  return [...ordered, ...availableIds.filter((id) => !orderedSet.has(id))]
}

export const stringArrayEquals = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index])

export const stringRecordArrayEquals = (left: Record<string, string[]>, right: Record<string, string[]>): boolean => {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return stringArrayEquals(leftKeys, rightKeys) && leftKeys.every((key) => stringArrayEquals(left[key] ?? [], right[key] ?? []))
}

export const rootFolderOrderId = (folderId: string): string => `folder:${folderId}`
export const rootConnectionOrderId = (connectionId: string): string => `connection:${connectionId}`

export const insertIdsAroundTarget = (ids: string[], movingIds: string[], targetId: string, placeAfter: boolean): string[] => {
  const movingSet = new Set(movingIds)
  const filtered = ids.filter((id) => !movingSet.has(id))
  const targetIndex = filtered.indexOf(targetId)
  if (targetIndex < 0) {
    return [...filtered, ...movingIds]
  }
  const insertIndex = placeAfter ? targetIndex + 1 : targetIndex
  return [...filtered.slice(0, insertIndex), ...movingIds, ...filtered.slice(insertIndex)]
}

export const filterPersistedValues = (persisted: string[], available: string[]): string[] => {
  const filtered = persisted.filter((value) => available.includes(value))
  return filtered.length > 0 ? filtered : available
}

export const defaultSelectedDatabases = (
  connection: DatabaseSelectionConnection,
  available: string[],
  databases: DatabaseSelectionItem[] = []
): string[] => {
  if (connection.database_type === 'redis') {
    const nonEmpty = databases.filter((database) => (database.size_bytes ?? 0) > 0).map((database) => database.name)
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
