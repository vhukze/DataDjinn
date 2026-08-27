import { Button, Checkbox, Flex, Input, Modal, Popover, Space, Tag } from 'antd'
import { DatabaseOutlined } from '@ant-design/icons'
import type { BackendStatus, GitHubDeviceAuthorization, GitHubDeviceAuthorizationPoll } from './app-model'
import type { ConnectionInfo } from './connection-model'
import type { DatabaseType } from './data-sources'
import type { DatabaseTreeNode } from './tree-model'
import type { ConnectionTypeIcons } from './tree-builders'
import clickhouseIcon from '../assets/icons/clickhouse.png'
import dmIcon from '../assets/icons/dm.svg'
import mongoIcon from '../assets/icons/mongo.png'
import mysqlIcon from '../assets/icons/mysql.png'
import oracleIcon from '../assets/icons/oracle.png'
import postgresIcon from '../assets/icons/postgres.png'
import redisIcon from '../assets/icons/redis.png'
import sqliteIcon from '../assets/icons/sqllite.png'
import { flushSync } from 'react-dom'
import { memo, useCallback, useEffect, useState } from 'react'
import type React from 'react'
import { useWorkspaceStore } from './workspace-store'

export const RESOURCE_TREE_ITEM_HEIGHT = 30
export const SSH_TEST_REQUEST_TIMEOUT_MS = 10_000
export const DATABASE_CONNECTION_REQUEST_TIMEOUT_MS = 10_000
const SYNC_DEVICE_STORAGE_KEY = 'datadjinn-sync-device-id'
export const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000

export const showErrorModal = (error: unknown, fallback = '操作失败'): void => {
  const content = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
  Modal.error({
    title: '操作失败',
    centered: true,
    okText: '确认',
    width: 720,
    content: <Space direction="vertical" className="full-width"><Input.TextArea value={content} autoSize={{ minRows: 4, maxRows: 12 }} readOnly /></Space>
  })
}

export const createConnectionTypeIcons = (): ConnectionTypeIcons => ({
  gaussdb: <DatabaseOutlined />,
  postgresql: <img src={postgresIcon} alt="PG" style={{ width: 16, height: 16 }} />,
  mongodb: <img src={mongoIcon} alt="MongoDB" style={{ width: 16, height: 16 }} />,
  redis: <img src={redisIcon} alt="Redis" style={{ width: 16, height: 16 }} />,
  clickhouse: <img src={clickhouseIcon} alt="ClickHouse" style={{ width: 16, height: 16 }} />,
  oracle: <img src={oracleIcon} alt="Oracle" style={{ width: 16, height: 16 }} />,
  mysql: <img src={mysqlIcon} alt="MySQL" style={{ width: 16, height: 16 }} />,
  dm: <img src={dmIcon} alt="DM" style={{ width: 16, height: 16 }} />,
  sqlite: <img src={sqliteIcon} alt="SQLite" style={{ width: 16, height: 16 }} />
})

export type GitSyncPayload = {
  format: 'datadjinn-sync'
  version: 1
  generated_at: string
  device_id: string
  connections: Record<string, Record<string, unknown>>
  settings: Record<string, unknown>
  preferences: Record<string, unknown>
}

export type GitSyncConflict = {
  key: string
  path: string
  path_segments: string[]
  base_exists: boolean
  local_exists: boolean
  remote_exists: boolean
  base?: unknown
  local?: unknown
  remote?: unknown
}

export type GitSyncMergeResult = {
  payload: GitSyncPayload
  conflicts: GitSyncConflict[]
}

export type GitSyncLocalState = {
  passphrase?: string
  basePayload?: GitSyncPayload
  remoteSha?: string
  lastSyncedAt?: number
  autoSyncEnabled?: boolean
}

export type GitSyncFileStatus = {
  repository?: { full_name: string; html_url: string } | null
  exists: boolean
  sha?: string | null
}

export type SchemaVersionInfo = {
  id: string
  message: string
  committed_at?: string | null
}

export type SchemaSnapshot = {
  connection_id: string
  database_type: DatabaseType
  captured_at: string
  fingerprint: string
  objects: Array<{
    scope?: string | null
    name: string
    type: string
    ddl: string
  }>
  skipped_objects: string[]
}

export type TableDataSnapshot = {
  connection_id: string
  database_type: DatabaseType
  table_name: string
  database?: string | null
  pg_database?: string | null
  captured_at: string
  fingerprint: string
  columns: string[]
  identity_columns: string[]
  identity_mode: 'primary_key' | 'unique_key' | 'snapshot_only'
  rows: Array<Record<string, unknown>>
}

export type SchemaSnapshotResult = {
  snapshot: SchemaSnapshot
  changed: boolean
  version_id?: string | null
}

export type GitSnapshotTask = {
  id: string
  connection_id: string
  title: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  current: number
  total: number
  percent: number
  detail: string
  error?: string | null
  started_at: string
  finished_at?: string | null
  result?: Record<string, unknown> | null
}

export type VersioningScopeConfig = {
  scope_kind: 'database' | 'schema' | 'single'
  available_scopes: string[]
  selected_scopes: string[]
}

export const getSyncDeviceId = (): string => {
  const stored = localStorage.getItem(SYNC_DEVICE_STORAGE_KEY)
  if (stored) {
    return stored
  }
  const created = crypto.randomUUID()
  localStorage.setItem(SYNC_DEVICE_STORAGE_KEY, created)
  return created
}

export type ApiRequestOptions = RequestInit & {
  timeoutMs?: number
}

export type TreeSearchMatch = {
  key: string
  path: string[]
  node: DatabaseTreeNode
}

export const getConnectionAddress = (
  connection: Pick<ConnectionInfo, 'host' | 'port'>
): string | undefined =>
  connection.host?.trim()
    ? `${connection.host}${connection.port ? `:${connection.port}` : ''}`
    : undefined

export const collectTreeSearchMatches = (
  nodes: DatabaseTreeNode[],
  connections: ConnectionInfo[],
  keyword: string
): TreeSearchMatch[] => {
  if (!keyword) {
    return []
  }

  const connectionsById = new Map(
    connections.map((connection) => [connection.connection_id, connection])
  )
  const matches: TreeSearchMatch[] = []
  const visit = (currentNodes: DatabaseTreeNode[], parentPath: string[]): void => {
    for (const node of currentNodes) {
      if (node.kind === 'folder-drop-placeholder') {
        continue
      }
      const key = String(node.key)
      const path = [...parentPath, key]
      const connection = node.connectionId ? connectionsById.get(node.connectionId) : undefined
      const nodeName =
        node.kind === 'column' ? node.columnName ?? String(node.title ?? '') : String(node.title ?? '')
      const connectionAddress =
        node.kind === 'connection' && connection ? getConnectionAddress(connection) ?? '' : ''
      const searchText = `${nodeName}\n${connectionAddress}`.toLowerCase()
      if (searchText.includes(keyword)) {
        matches.push({ key, path, node })
      }
      if (node.children?.length) {
        visit(node.children as DatabaseTreeNode[], path)
      }
    }
  }

  visit(nodes, [])
  return matches
}

export const FOLDER_DROP_PLACEHOLDER_KEY_PREFIX = 'folder-drop-placeholder:'
export const FAST_MODAL_PROPS = {
  destroyOnHidden: true,
  centered: true,
  transitionName: '',
  maskTransitionName: ''
} as const
export const FAST_DROPDOWN_PROPS = {
  destroyOnHidden: true,
  transitionName: ''
} as const

export type ExportFormat = 'sql' | 'csv' | 'json' | 'markdown'
export type ExportOrigin = 'tree' | 'result'
export type ExportDataScope = 'current_page' | 'all'
export type RoutineExecutionTarget = {
  connectionId: string
  name: string
  databaseName?: string
  pgDatabaseName?: string
}
export type RoutineArgumentDraft = {
  value: string
  isNull: boolean
  useDefault: boolean
}

export const FAST_PRELOADED_DROPDOWN_PROPS = {
  ...FAST_DROPDOWN_PROPS,
  forceRender: true
} as const

export type ConnectionTransferTestWindow = typeof window & {
  __DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__?: string
  __DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_CONTENT__?: string
  __DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_PATH__?: string
  __DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_HANDLER__?: (payload: {
    filePath: string
    content: string
  }) => void | Promise<void>
}

export type GitHubDeviceFlowTestWindow = typeof window & {
  __DATADJINN_TEST_GITHUB_DEVICE_AUTHORIZATION__?: GitHubDeviceAuthorization
  __DATADJINN_TEST_GITHUB_DEVICE_POLL__?: GitHubDeviceAuthorizationPoll
}

type TreeSelectorPopoverProps = {
  options: string[]
  selectedValues: string[]
  onCommit: (nextSelected: string[]) => void
}

export const TreeSelectorPopover = memo(function TreeSelectorPopover({
  options,
  selectedValues,
  onCommit
}: TreeSelectorPopoverProps): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [draftSelected, setDraftSelected] = useState<string[]>(selectedValues)
  const closeAndCommit = useCallback((): void => {
    setOpen(false)
    onCommit(draftSelected)
  }, [draftSelected, onCommit])

  useEffect(() => {
    if (!open) {
      setDraftSelected(selectedValues)
    }
  }, [open, selectedValues])

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }
      if (target.closest('.tree-selector-popover') || target.closest('.selector-badge')) {
        return
      }
      closeAndCommit()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      closeAndCommit()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [closeAndCommit, open])

  return (
    <Popover
      trigger={[]}
      open={open}
      overlayClassName="tree-selector-popover no-motion-overlay"
      destroyOnHidden={false}
      forceRender
      motion={{ motionName: '' }}
      content={
        <div className="tree-selector-popover-body">
          <Flex vertical gap={8}>
            <Button
              className="tree-selector-toggle-btn"
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation()
                setDraftSelected(draftSelected.length === options.length ? [options[0]] : options)
              }}
            >
              {draftSelected.length === options.length ? '取消全选' : '全选'}
            </Button>
            <Checkbox.Group
              className="tree-selector-checkbox-group"
              value={draftSelected}
              onChange={(values) => {
                if (values.length === 0) {
                  return
                }
                setDraftSelected(values as string[])
              }}
            >
              <Flex vertical gap={6}>
                {options.map((item) => (
                  <Checkbox className="tree-selector-checkbox" key={item} value={item}>
                    {item}
                  </Checkbox>
                ))}
              </Flex>
            </Checkbox.Group>
          </Flex>
        </div>
      }
    >
      <Tag
        className="selector-badge"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          flushSync(() => {
            if (open) {
              closeAndCommit()
              return
            }
            setDraftSelected(selectedValues)
            setOpen(true)
          })
        }}
      >
        {selectedValues.length}/{options.length}
      </Tag>
    </Popover>
  )
})

export const formatQueryHistoryTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '未知时间'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

export const getQueryHistoryPreviewText = (sql?: string): string => {
  const normalized = (sql ?? '').replace(/\s+/g, ' ').trim()
  return normalized || '空查询'
}

export const WorkspaceTabCountBadge = (): React.JSX.Element => {
  const workspaceTabCount = useWorkspaceStore((state) => state.tabs.length)
  return (
    <span className="summary-pill summary-pill-tabs">
      <strong>{workspaceTabCount}</strong>
      <span className="summary-label">工作页</span>
    </span>
  )
}

export const BACKEND_LABELS: Record<BackendStatus['state'], string> = {
  starting: '服务启动中',
  online: '服务正常',
  failed: '服务异常',
  stopped: '服务已停止',
  crashed: '服务已崩溃'
}

export const BACKEND_COLORS: Record<
  BackendStatus['state'],
  'success' | 'processing' | 'error' | 'default'
> = {
  starting: 'processing',
  online: 'success',
  failed: 'error',
  stopped: 'default',
  crashed: 'error'
}

export const STORAGE_DB = 'datadjinn-selected-databases'
export const STORAGE_SCHEMA = 'datadjinn-selected-schemas'
export const STORAGE_CONNECTION_FOLDERS = 'datadjinn-connection-folders'
export const STORAGE_CONNECTION_FOLDER_ASSIGNMENTS = 'datadjinn-connection-folder-assignments'
export const STORAGE_CONNECTION_FOLDER_ORDER = 'datadjinn-connection-folder-order'
export const STORAGE_ROOT_CONNECTION_ORDER = 'datadjinn-root-connection-order'
export const STORAGE_ROOT_ITEM_ORDER = 'datadjinn-root-item-order'
export const STORAGE_ROOT_ITEM_ORDER_CUSTOMIZED = 'datadjinn-root-item-order-customized'
export const STORAGE_PINNED_ROOT_ITEM_IDS = 'datadjinn-pinned-root-item-ids'
export const STORAGE_FOLDER_CONNECTION_ORDER = 'datadjinn-folder-connection-order'
export const STORAGE_QUERY_WORKSPACES = 'datadjinn-query-workspaces'
export const STORAGE_SHORTCUT_SETTINGS = 'datadjinn-shortcut-settings'
export const RESOURCE_PANEL_MIN_WIDTH = 304

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
    return stored ? (JSON.parse(stored) as T) : fallback
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

export const stringRecordArrayEquals = (
  left: Record<string, string[]>,
  right: Record<string, string[]>
): boolean => {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    stringArrayEquals(leftKeys, rightKeys) &&
    leftKeys.every((key) => stringArrayEquals(left[key] ?? [], right[key] ?? []))
  )
}

export const rootFolderOrderId = (folderId: string): string => `folder:${folderId}`
export const rootConnectionOrderId = (connectionId: string): string => `connection:${connectionId}`

export type ApiErrorResponse = {
  __datadjinnApiError: string
  __datadjinnApiErrorCode?: string
}

export type ApiRequestError = Error & { code?: string }

export const isApiErrorResponse = (value: unknown): value is ApiErrorResponse =>
  Boolean(
    value &&
      typeof value === 'object' &&
      '__datadjinnApiError' in value &&
      typeof value.__datadjinnApiError === 'string'
  )

export const insertIdsAroundTarget = (
  ids: string[],
  movingIds: string[],
  targetId: string,
  placeAfter: boolean
): string[] => {
  const movingSet = new Set(movingIds)
  const filtered = ids.filter((id) => !movingSet.has(id))
  const targetIndex = filtered.indexOf(targetId)
  if (targetIndex < 0) {
    return [...filtered, ...movingIds]
  }
  const insertIndex = placeAfter ? targetIndex + 1 : targetIndex
  return [...filtered.slice(0, insertIndex), ...movingIds, ...filtered.slice(insertIndex)]
}
