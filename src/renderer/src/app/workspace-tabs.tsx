import { Input, Tabs } from 'antd'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceTab } from './workspace-model'
import { useWorkspaceStore } from './workspace-store'

export type WorkspaceTabBase = {
  key: string
  title: string
}

export type WorkspaceTabsViewProps = {
  workspaceTabs: WorkspaceTabBase[]
  activeTabKey?: string
  onActiveTabChange: (key: string) => void
  onCloseTab: (key: string) => void
  onRenameTab: (key: string, title: string) => void
  renderWorkspaceTab: (tab: WorkspaceTab, active: boolean) => React.ReactNode
}

const MAX_CACHED_TAB_PANES = 3

function WorkspaceTabContentInner({
  tab,
  active,
  renderWorkspaceTabRef
}: {
  tab: WorkspaceTabBase
  active: boolean
  renderWorkspaceTabRef: React.MutableRefObject<(tab: WorkspaceTab, active: boolean) => React.ReactNode>
}) {
  const fullTab = useWorkspaceStore(useCallback((state) => state.getTabByKey(tab.key), [tab.key]))
  if (!fullTab) {
    return null
  }
  return <>{renderWorkspaceTabRef.current(fullTab, active)}</>
}

const WorkspaceTabContent = memo(WorkspaceTabContentInner) as (props: {
  tab: WorkspaceTabBase
  active: boolean
  renderWorkspaceTabRef: React.MutableRefObject<(tab: WorkspaceTab, active: boolean) => React.ReactNode>
}) => React.ReactElement

const WorkspaceTabPane = memo(function WorkspaceTabPane({
  tab,
  active,
  renderWorkspaceTabRef
}: {
  tab: WorkspaceTabBase
  active: boolean
  renderWorkspaceTabRef: React.MutableRefObject<(tab: WorkspaceTab, active: boolean) => React.ReactNode>
}) {
  return (
    <div className={active ? 'workspace-active-content' : 'workspace-inactive-content'} aria-hidden={!active}>
      <WorkspaceTabContent
        tab={tab}
        active={active}
        renderWorkspaceTabRef={renderWorkspaceTabRef}
      />
    </div>
  )
}, (prev, next) => (
  prev.tab === next.tab
  && prev.active === next.active
))

function WorkspaceTabsViewInner({
  workspaceTabs,
  activeTabKey,
  onActiveTabChange,
  onCloseTab,
  onRenameTab,
  renderWorkspaceTab
}: WorkspaceTabsViewProps) {
  const [editingTabKey, setEditingTabKey] = useState<string>()
  const [editingTabTitle, setEditingTabTitle] = useState('')
  const [mountedTabKeys, setMountedTabKeys] = useState<string[]>(() => activeTabKey ? [activeTabKey] : [])
  const renderWorkspaceTabRef = useRef<(tab: WorkspaceTab, active: boolean) => React.ReactNode>(renderWorkspaceTab)
  const onActiveTabChangeRef = useRef(onActiveTabChange)
  const onCloseTabRef = useRef(onCloseTab)
  const onRenameTabRef = useRef(onRenameTab)
  const pendingSwitchRef = useRef<{ key: string; startedAt: number } | null>(null)

  renderWorkspaceTabRef.current = renderWorkspaceTab
  onActiveTabChangeRef.current = onActiveTabChange
  onCloseTabRef.current = onCloseTab
  onRenameTabRef.current = onRenameTab

  const handleTabChange = useCallback((key: string) => {
    pendingSwitchRef.current = { key, startedAt: performance.now() }
    onActiveTabChangeRef.current(key)
  }, [])

  useEffect(() => {
    const pending = pendingSwitchRef.current
    if (!pending || pending.key !== activeTabKey) {
      return
    }
    const duration = performance.now() - pending.startedAt
    console.info('[perf][workspace-tab] switch-committed', {
      key: activeTabKey,
      duration: Number(duration.toFixed(2))
    })
    pendingSwitchRef.current = null
  }, [activeTabKey])

  useEffect(() => {
    const availableKeys = new Set(workspaceTabs.map((tab) => tab.key))
    setMountedTabKeys((current) => {
      const filtered = current.filter((key) => availableKeys.has(key))
      if (!activeTabKey || !availableKeys.has(activeTabKey)) {
        return filtered
      }
      const next = [...filtered.filter((key) => key !== activeTabKey), activeTabKey]
      return next.length > MAX_CACHED_TAB_PANES
        ? next.slice(next.length - MAX_CACHED_TAB_PANES)
        : next
    })
  }, [activeTabKey, workspaceTabs])

  const handleTabEdit = useCallback((targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove' && typeof targetKey === 'string') {
      onCloseTabRef.current(targetKey)
    }
  }, [])

  const commitTabRename = useCallback((tabKey: string, title: string) => {
    const nextTitle = title.trim()
    if (nextTitle) {
      onRenameTabRef.current(tabKey, nextTitle)
    }
    setEditingTabKey(undefined)
  }, [])

  const items = useMemo(() => (
    workspaceTabs.map((tab) => ({
      key: tab.key,
      label: editingTabKey === tab.key
        ? (
          <Input
            size="small"
            value={editingTabTitle}
            autoFocus
            onChange={(event) => setEditingTabTitle(event.currentTarget.value)}
            onBlur={() => commitTabRename(tab.key, editingTabTitle)}
            onPressEnter={() => commitTabRename(tab.key, editingTabTitle)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditingTabKey(undefined)
              }
            }}
          />
        )
        : (
          <span
            data-workspace-tab-key={tab.key}
            onDoubleClick={(event) => {
              event.stopPropagation()
              setEditingTabKey(tab.key)
              setEditingTabTitle(tab.title)
            }}
          >
            {tab.title}
          </span>
        ),
      closable: true,
      children: null
    }))
  ), [activeTabKey, commitTabRename, editingTabKey, editingTabTitle, workspaceTabs])

  const handleTabMiddleClose = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return
    }
    if (target.closest('input, textarea, .ant-tabs-tab-remove')) {
      return
    }
    const tabNode = target.closest('.ant-tabs-tab')
    const tabKey = tabNode?.getAttribute('data-node-key')
      ?? tabNode?.querySelector<HTMLElement>('[data-workspace-tab-key]')?.dataset.workspaceTabKey
    if (tabKey) {
      onCloseTabRef.current(tabKey)
    }
  }, [])

  return (
    <div
      className="workspace-tabs-host"
      onMouseDownCapture={(event) => {
        if (event.button !== 1) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        handleTabMiddleClose(event.target)
      }}
      onAuxClickCapture={(event) => {
        if (event.button !== 1) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <Tabs
        className="workspace-tabs"
        type="editable-card"
        hideAdd
        destroyOnHidden={false}
        animated={false}
        activeKey={activeTabKey}
        onChange={handleTabChange}
        onEdit={handleTabEdit}
        items={items}
      />
      <div className="workspace-tab-panels">
        {workspaceTabs.filter((tab) => mountedTabKeys.includes(tab.key)).map((tab) => (
          <WorkspaceTabPane
            key={tab.key}
            tab={tab}
            active={tab.key === activeTabKey}
            renderWorkspaceTabRef={renderWorkspaceTabRef}
          />
        ))}
      </div>
    </div>
  )
}

const WorkspaceTabsView = memo(WorkspaceTabsViewInner, (prev, next) => (
  prev.workspaceTabs === next.workspaceTabs &&
  prev.activeTabKey === next.activeTabKey
)) as (props: WorkspaceTabsViewProps) => React.ReactElement

export default WorkspaceTabsView
