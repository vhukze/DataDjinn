import { useEffect, useRef } from 'react'
import type { Dispatch, Key, RefObject, SetStateAction } from 'react'
import type { ConnectionInfo } from './connection-model'
import type { ShortcutSettings } from './app-model'
import {
  mergeOrderedIds,
  rootConnectionOrderId,
  rootFolderOrderId,
  STORAGE_CONNECTION_FOLDERS,
  STORAGE_CONNECTION_FOLDER_ASSIGNMENTS,
  STORAGE_CONNECTION_FOLDER_ORDER,
  STORAGE_FOLDER_CONNECTION_ORDER,
  STORAGE_QUERY_WORKSPACES,
  STORAGE_ROOT_CONNECTION_ORDER,
  STORAGE_ROOT_ITEM_ORDER,
  STORAGE_SHORTCUT_SETTINGS,
  stringArrayEquals,
  stringRecordArrayEquals
} from './persistence'
import type { ConnectionFolder } from './tree-model'
import type { PersistedQueryWorkspace, WorkspaceTab } from './workspace-model'

type Setter<T> = Dispatch<SetStateAction<T>>

type AppPersistenceOptions = {
  selectedDatabases: Record<string, string[]>
  selectedSchemas: Record<string, string[]>
  connectionFolders: ConnectionFolder[]
  connectionFolderAssignments: Record<string, string>
  connectionFolderOrder: string[]
  rootConnectionOrder: string[]
  rootItemOrder: string[]
  folderConnectionOrder: Record<string, string[]>
  persistedQueryWorkspaces: PersistedQueryWorkspace[]
  shortcutSettings: ShortcutSettings
  connectionsInitialized: boolean
  connections: ConnectionInfo[]
  workspaceTabs: WorkspaceTab[]
  setConnectionFolderAssignments: Setter<Record<string, string>>
  setSelectedConnectionIds: Setter<string[]>
  setSelectedTreeKeys: Setter<Key[]>
  setConnectionSelectionAnchorId: Setter<string | undefined>
  setConnectionFolderOrder: Setter<string[]>
  setRootConnectionOrder: Setter<string[]>
  setRootItemOrder: Setter<string[]>
  setFolderConnectionOrder: Setter<Record<string, string[]>>
  persistQueryWorkspace: (tab: WorkspaceTab) => void
}

type AppPersistenceResult = {
  selectedDatabasesRef: RefObject<Record<string, string[]>>
  selectedSchemasRef: RefObject<Record<string, string[]>>
}

const persistLocalStorage = (key: string, value: unknown): void => {
  localStorage.setItem(key, JSON.stringify(value))
}

export const useAppPersistence = ({
  selectedDatabases,
  selectedSchemas,
  connectionFolders,
  connectionFolderAssignments,
  connectionFolderOrder,
  rootConnectionOrder,
  rootItemOrder,
  folderConnectionOrder,
  persistedQueryWorkspaces,
  shortcutSettings,
  connectionsInitialized,
  connections,
  workspaceTabs,
  setConnectionFolderAssignments,
  setSelectedConnectionIds,
  setSelectedTreeKeys,
  setConnectionSelectionAnchorId,
  setConnectionFolderOrder,
  setRootConnectionOrder,
  setRootItemOrder,
  setFolderConnectionOrder,
  persistQueryWorkspace
}: AppPersistenceOptions): AppPersistenceResult => {
  const selectedDatabasesRef = useRef(selectedDatabases)
  const selectedSchemasRef = useRef(selectedSchemas)

  useEffect(() => {
    selectedDatabasesRef.current = selectedDatabases
  }, [selectedDatabases])

  useEffect(() => {
    selectedSchemasRef.current = selectedSchemas
  }, [selectedSchemas])

  useEffect(() => {
    persistLocalStorage(STORAGE_CONNECTION_FOLDERS, connectionFolders)
  }, [connectionFolders])

  useEffect(() => {
    persistLocalStorage(STORAGE_CONNECTION_FOLDER_ASSIGNMENTS, connectionFolderAssignments)
  }, [connectionFolderAssignments])

  useEffect(() => {
    persistLocalStorage(STORAGE_CONNECTION_FOLDER_ORDER, connectionFolderOrder)
  }, [connectionFolderOrder])

  useEffect(() => {
    persistLocalStorage(STORAGE_ROOT_CONNECTION_ORDER, rootConnectionOrder)
  }, [rootConnectionOrder])

  useEffect(() => {
    persistLocalStorage(STORAGE_ROOT_ITEM_ORDER, rootItemOrder)
  }, [rootItemOrder])

  useEffect(() => {
    persistLocalStorage(STORAGE_FOLDER_CONNECTION_ORDER, folderConnectionOrder)
  }, [folderConnectionOrder])

  useEffect(() => {
    persistLocalStorage(STORAGE_QUERY_WORKSPACES, persistedQueryWorkspaces)
  }, [persistedQueryWorkspaces])

  useEffect(() => {
    persistLocalStorage(STORAGE_SHORTCUT_SETTINGS, shortcutSettings)
  }, [shortcutSettings])

  useEffect(() => {
    if (!connectionsInitialized) {
      return
    }

    const validConnectionIds = new Set(connections.map((connection) => connection.connection_id))
    const validFolderIds = new Set(connectionFolders.map((folder) => folder.id))

    setConnectionFolderAssignments((current) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(current).filter(([connectionId, folderId]) => {
        const keep = validConnectionIds.has(connectionId) && validFolderIds.has(folderId)
        if (!keep) {
          changed = true
        }
        return keep
      }))
      return changed ? next : current
    })

    setSelectedConnectionIds((current) => {
      const next = current.filter((connectionId) => validConnectionIds.has(connectionId))
      return stringArrayEquals(current, next) ? current : next
    })

    setSelectedTreeKeys((current) => {
      const next = current.filter((key) => {
        const value = String(key)
        if (value.startsWith('connection:')) {
          return validConnectionIds.has(value.slice('connection:'.length))
        }
        if (value.startsWith('folder:')) {
          return validFolderIds.has(value.slice('folder:'.length))
        }
        return true
      })
      return current.length === next.length && current.every((item, index) => item === next[index]) ? current : next
    })

    setConnectionSelectionAnchorId((current) => current && validConnectionIds.has(current) ? current : undefined)

    setConnectionFolderOrder((current) => {
      const next = mergeOrderedIds(connectionFolders.map((folder) => folder.id), current)
      return stringArrayEquals(current, next) ? current : next
    })

    setRootConnectionOrder((current) => {
      const next = mergeOrderedIds(
        connections
          .filter((connection) => !connectionFolderAssignments[connection.connection_id] || !validFolderIds.has(connectionFolderAssignments[connection.connection_id]))
          .map((connection) => connection.connection_id),
        current
      )
      return stringArrayEquals(current, next) ? current : next
    })

    setRootItemOrder((current) => {
      const rootConnectionIds = connections
        .filter((connection) => !connectionFolderAssignments[connection.connection_id] || !validFolderIds.has(connectionFolderAssignments[connection.connection_id]))
        .map((connection) => rootConnectionOrderId(connection.connection_id))
      const folderIds = connectionFolders.map((folder) => rootFolderOrderId(folder.id))
      const migratedOrder = current.length > 0
        ? current
        : [
            ...connectionFolderOrder.map(rootFolderOrderId),
            ...rootConnectionOrder.map(rootConnectionOrderId)
          ]
      const next = mergeOrderedIds([...folderIds, ...rootConnectionIds], migratedOrder)
      return stringArrayEquals(current, next) ? current : next
    })

    setFolderConnectionOrder((current) => {
      const next: Record<string, string[]> = {}
      for (const folderId of connectionFolders.map((folder) => folder.id)) {
        const folderConnectionIds = connections
          .filter((connection) => connectionFolderAssignments[connection.connection_id] === folderId)
          .map((connection) => connection.connection_id)
        next[folderId] = mergeOrderedIds(folderConnectionIds, current[folderId] ?? [])
      }
      return stringRecordArrayEquals(current, next) ? current : next
    })
  }, [
    connectionsInitialized,
    connections,
    connectionFolders,
    connectionFolderAssignments,
    connectionFolderOrder,
    rootConnectionOrder,
    setConnectionFolderAssignments,
    setSelectedConnectionIds,
    setSelectedTreeKeys,
    setConnectionSelectionAnchorId,
    setConnectionFolderOrder,
    setRootConnectionOrder,
    setRootItemOrder,
    setFolderConnectionOrder
  ])

  useEffect(() => {
    for (const tab of workspaceTabs) {
      if (tab.kind !== 'query') {
        continue
      }
      persistQueryWorkspace(tab)
    }
  }, [workspaceTabs, persistQueryWorkspace])

  return {
    selectedDatabasesRef,
    selectedSchemasRef
  }
}
