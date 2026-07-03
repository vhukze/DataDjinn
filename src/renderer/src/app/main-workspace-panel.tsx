import { FileAddOutlined, LoginOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons'
import { Button, Dropdown, Space } from 'antd'
import type { MenuProps } from 'antd'
import { memo, useCallback, useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import WorkspaceTabsView from './workspace-tabs'
import { useWorkspaceStore } from './workspace-store'

const FAST_DROPDOWN_PROPS = {
  destroyOnHidden: true,
  transitionName: ''
} as const

const FAST_PRELOADED_DROPDOWN_PROPS = {
  ...FAST_DROPDOWN_PROPS,
  forceRender: true
} as const

type MainWorkspacePanelProps = {
  mainPanelRef: RefObject<HTMLDivElement | null>
  aiDockPanelRef: RefObject<HTMLDivElement | null>
  theme: string
  aiPanelOpen: boolean
  aiPanelSize: number
  resizingAiPanel: boolean
  resizingResourcePanel: boolean
  renderWorkspaceTab: (tab: import('./workspace-model').WorkspaceTab, active: boolean) => ReactNode
  workspaceRenderVersionToken: unknown
  onActiveTabChange: (key: string) => void
  onCloseTab: (key: string) => void
  onRenameTab: (key: string, title: string) => void
  openImportConnectionModal: () => void
  connectionCreateMenuItems: NonNullable<MenuProps['items']>
  onConnectionCreateMenuClick: (info: { key: string }) => void
  onAiPanelResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  aiPanelContent: ReactNode
}

type WorkspaceCenterAreaProps = {
  renderWorkspaceTab: (tab: import('./workspace-model').WorkspaceTab, active: boolean) => ReactNode
  workspaceRenderVersionToken: unknown
  onActiveTabChange: (key: string) => void
  onCloseTab: (key: string) => void
  onRenameTab: (key: string, title: string) => void
  openImportConnectionModal: () => void
  connectionCreateMenuItems: NonNullable<MenuProps['items']>
  onConnectionCreateMenuClick: (info: { key: string }) => void
}

const WorkspaceCenterArea = memo(function WorkspaceCenterArea({
  renderWorkspaceTab,
  workspaceRenderVersionToken,
  onActiveTabChange,
  onCloseTab,
  onRenameTab,
  openImportConnectionModal,
  connectionCreateMenuItems,
  onConnectionCreateMenuClick
}: WorkspaceCenterAreaProps) {
  const workspaceTabs = useWorkspaceStore((state) => state.tabSummaries)
  const activeTabKey = useWorkspaceStore((state) => state.activeTabKey)
  const renderStartRef = useRef(0)

  renderStartRef.current = performance.now()

  useEffect(() => {
    const duration = performance.now() - renderStartRef.current
    if (duration >= 12) {
      console.info('[perf][workspace-panel] render', {
        activeTabKey,
        tabCount: workspaceTabs.length,
        duration: Number(duration.toFixed(2))
      })
    }
  })

  const onActiveTabChangeRef = useRef(onActiveTabChange)
  const onCloseTabRef = useRef(onCloseTab)
  const onRenameTabRef = useRef(onRenameTab)
  const openImportConnectionModalRef = useRef(openImportConnectionModal)
  const onConnectionCreateMenuClickRef = useRef(onConnectionCreateMenuClick)

  onActiveTabChangeRef.current = onActiveTabChange
  onCloseTabRef.current = onCloseTab
  onRenameTabRef.current = onRenameTab
  openImportConnectionModalRef.current = openImportConnectionModal
  onConnectionCreateMenuClickRef.current = onConnectionCreateMenuClick

  const handleActiveTabChange = (key: string) => {
    console.info('[perf][workspace-tab] switch-request', {
      from: activeTabKey,
      to: key,
      at: Number(performance.now().toFixed(2))
    })
    onActiveTabChangeRef.current(key)
  }

  const handleCloseTab = (key: string) => {
    onCloseTabRef.current(key)
  }

  const handleRenameTab = (key: string, title: string) => {
    onRenameTabRef.current(key, title)
  }

  const handleOpenImport = () => {
    openImportConnectionModalRef.current()
  }

  const handleConnectionCreateMenuClick = ({ key }: { key: string }) => {
    onConnectionCreateMenuClickRef.current({ key })
  }

  return (
    <div className="editor-placeholder">
      {workspaceTabs.length === 0 ? (
        <div className="empty-workspace">
          <div className="empty-workspace-orb" />
          <div className="empty-workspace-grid" />
          <div className="empty-workspace-panel">
            <div className="empty-workspace-badge">
              <RobotOutlined />
              <span>DataDjinn Workspace</span>
            </div>
            <div className="empty-workspace-icon">
              <FileAddOutlined />
            </div>
            <div className="empty-workspace-title empty-workspace-title-shimmer">连接数据库，开始查询和 AI 协作</div>
            <div className="empty-workspace-pills">
              <span className="empty-workspace-pill">连接树</span>
              <span className="empty-workspace-pill">SQL 工作页</span>
              <span className="empty-workspace-pill">AI 协作</span>
            </div>
            <Space size={12} className="empty-workspace-actions">
              <Button
                className="empty-workspace-button empty-workspace-button-secondary"
                icon={<LoginOutlined />}
                onClick={handleOpenImport}
              >
                导入连接
              </Button>
              <Dropdown
                menu={{
                  items: connectionCreateMenuItems,
                  onClick: handleConnectionCreateMenuClick
                }}
                trigger={['click']}
                overlayClassName="resource-create-dropdown"
                {...FAST_PRELOADED_DROPDOWN_PROPS}
              >
                <Button
                  className="empty-workspace-button empty-workspace-button-primary"
                  type="primary"
                  icon={<PlusOutlined />}
                >
                  创建连接
                </Button>
              </Dropdown>
            </Space>
          </div>
        </div>
      ) : (
        <WorkspaceTabsView
          workspaceTabs={workspaceTabs}
          activeTabKey={activeTabKey}
          onActiveTabChange={handleActiveTabChange}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
          renderWorkspaceTab={renderWorkspaceTab}
          renderVersionToken={workspaceRenderVersionToken}
        />
      )}
    </div>
  )
}, (prev, next) => (
  prev.renderWorkspaceTab === next.renderWorkspaceTab
  && prev.workspaceRenderVersionToken === next.workspaceRenderVersionToken
  && prev.onActiveTabChange === next.onActiveTabChange
  && prev.onCloseTab === next.onCloseTab
  && prev.onRenameTab === next.onRenameTab
  && prev.openImportConnectionModal === next.openImportConnectionModal
  && prev.connectionCreateMenuItems === next.connectionCreateMenuItems
  && prev.onConnectionCreateMenuClick === next.onConnectionCreateMenuClick
))

type WorkspaceAiDockProps = {
  aiDockPanelRef: RefObject<HTMLDivElement | null>
  aiPanelOpen: boolean
  aiPanelSize: number
  resizingAiPanel: boolean
  onAiPanelResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  aiPanelContent: ReactNode
}

const WorkspaceAiDock = memo(function WorkspaceAiDock({
  aiDockPanelRef,
  aiPanelOpen,
  aiPanelSize,
  resizingAiPanel,
  onAiPanelResizeMouseDown,
  aiPanelContent
}: WorkspaceAiDockProps) {
  const handleAiPanelResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    onAiPanelResizeMouseDown(event)
  }, [onAiPanelResizeMouseDown])

  if (!aiPanelOpen) {
    return null
  }

  return (
    <>
      <div
        className={`ai-panel-resizer${resizingAiPanel ? ' active' : ''}`}
        onMouseDown={handleAiPanelResizeMouseDown}
      />
      <div ref={aiDockPanelRef} className="ai-dock-panel" style={{ width: aiPanelSize, flex: `0 0 ${aiPanelSize}px` }}>
        {aiPanelContent}
      </div>
    </>
  )
}, (prev, next) => (
  prev.aiPanelOpen === next.aiPanelOpen
  && prev.aiPanelSize === next.aiPanelSize
  && prev.resizingAiPanel === next.resizingAiPanel
  && prev.onAiPanelResizeMouseDown === next.onAiPanelResizeMouseDown
  && prev.aiPanelContent === next.aiPanelContent
))

const MainWorkspacePanel = memo(function MainWorkspacePanel({
  mainPanelRef,
  aiDockPanelRef,
  theme,
  aiPanelOpen,
  aiPanelSize,
  resizingAiPanel,
  resizingResourcePanel,
  renderWorkspaceTab,
  workspaceRenderVersionToken,
  onActiveTabChange,
  onCloseTab,
  onRenameTab,
  openImportConnectionModal,
  connectionCreateMenuItems,
  onConnectionCreateMenuClick,
  onAiPanelResizeMouseDown,
  aiPanelContent
}: MainWorkspacePanelProps) {
  void theme

  return (
    <div ref={mainPanelRef} className="main-panel">
      <div className={`studio-shell${resizingResourcePanel || resizingAiPanel ? ' studio-shell-suspended' : ''}`}>
        <WorkspaceCenterArea
          renderWorkspaceTab={renderWorkspaceTab}
          workspaceRenderVersionToken={workspaceRenderVersionToken}
          onActiveTabChange={onActiveTabChange}
          onCloseTab={onCloseTab}
          onRenameTab={onRenameTab}
          openImportConnectionModal={openImportConnectionModal}
          connectionCreateMenuItems={connectionCreateMenuItems}
          onConnectionCreateMenuClick={onConnectionCreateMenuClick}
        />
        <WorkspaceAiDock
          aiDockPanelRef={aiDockPanelRef}
          aiPanelOpen={aiPanelOpen}
          aiPanelSize={aiPanelSize}
          resizingAiPanel={resizingAiPanel}
          onAiPanelResizeMouseDown={onAiPanelResizeMouseDown}
          aiPanelContent={aiPanelContent}
        />
      </div>
    </div>
  )
}, (prev, next) => (
  prev.theme === next.theme
  && prev.aiPanelOpen === next.aiPanelOpen
  && prev.aiPanelSize === next.aiPanelSize
  && prev.resizingAiPanel === next.resizingAiPanel
  && prev.resizingResourcePanel === next.resizingResourcePanel
  && prev.renderWorkspaceTab === next.renderWorkspaceTab
  && prev.workspaceRenderVersionToken === next.workspaceRenderVersionToken
  && prev.onActiveTabChange === next.onActiveTabChange
  && prev.onCloseTab === next.onCloseTab
  && prev.onRenameTab === next.onRenameTab
  && prev.openImportConnectionModal === next.openImportConnectionModal
  && prev.connectionCreateMenuItems === next.connectionCreateMenuItems
  && prev.onConnectionCreateMenuClick === next.onConnectionCreateMenuClick
  && prev.onAiPanelResizeMouseDown === next.onAiPanelResizeMouseDown
  && prev.aiPanelContent === next.aiPanelContent
))

export default MainWorkspacePanel
