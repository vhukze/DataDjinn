import { HistoryOutlined, LinkOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Flex, Modal, Progress, Space, Typography } from 'antd'
import type { GitHubAuthStatus } from './app-model'
import type { SchemaVersionInfo, VersioningScopeConfig } from './app-runtime-support'
import { FAST_MODAL_PROPS } from './app-runtime-support'

type ConnectionVersionManagementModalProps = {
  open: boolean
  connectionName: string
  connectionId?: string
  onClose: () => void
  gitHubAuthStatus: GitHubAuthStatus
  onOpenSyncSettings: () => void
  onOpenRepository: () => void
  schemaVersions: SchemaVersionInfo[]
  databaseBaselineExists: boolean
  schemaVersionsLoading: boolean
  schemaSnapshotCreating: boolean
  onLoadSchemaVersions: (connectionId: string) => void
  onCreateSchemaSnapshot: (connectionId: string) => void
  snapshotTask?: {
    status: 'running' | 'success' | 'error' | 'cancelled'
    percent: number
    detail: string
    error?: string | null
  }
  onViewSchemaVersion: (connectionId: string, version: SchemaVersionInfo) => void
  versioningScopeConfig?: VersioningScopeConfig
  versioningScopesLoading: boolean
  versioningScopesSaving: boolean
  versioningScopeDraft: string[]
  versioningScopeLabel: string
  hasConfiguredVersioningScope: boolean
  onVersioningScopeDraftChange: (scopes: string[]) => void
  onSaveVersioningScopes: (connectionId: string) => void
}

export function ConnectionVersionManagementModal({
  open,
  connectionName,
  connectionId,
  onClose,
  gitHubAuthStatus,
  onOpenSyncSettings,
  onOpenRepository,
  schemaVersions,
  databaseBaselineExists,
  schemaVersionsLoading,
  schemaSnapshotCreating,
  onLoadSchemaVersions,
  onCreateSchemaSnapshot,
  snapshotTask,
  onViewSchemaVersion,
  versioningScopeConfig,
  versioningScopesLoading,
  versioningScopesSaving,
  versioningScopeDraft,
  versioningScopeLabel,
  hasConfiguredVersioningScope,
  onVersioningScopeDraftChange,
  onSaveVersioningScopes,
}: ConnectionVersionManagementModalProps): React.JSX.Element {
  const authorized = gitHubAuthStatus.authorized
  return (
    <Modal
      title={`${connectionName} · Git 版本管理`}
      open={open}
      width={940}
      className="connection-schema-version-modal"
      footer={null}
      onCancel={onClose}
      maskClosable={false}
      {...FAST_MODAL_PROPS}
    >
      <Space direction="vertical" className="full-width" size="middle">
        <Flex justify="space-between" align="center" gap="middle" wrap>
          <Typography.Text type="secondary">
            选择要纳管的库或模式后，首次创建会将全部表结构和数据压缩后作为一个 Git 提交上传；后续变更会在后台自动提交。
          </Typography.Text>
          <Space>
            {gitHubAuthStatus.repository_url ? (
              <Button icon={<LinkOutlined />} onClick={onOpenRepository}>
                打开 Git 仓库
              </Button>
            ) : null}
            <Button
              icon={<HistoryOutlined />}
              loading={schemaVersionsLoading}
              disabled={!authorized || !connectionId}
              onClick={() => connectionId && onLoadSchemaVersions(connectionId)}
            >
              刷新历史
            </Button>
            {!databaseBaselineExists ? (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={schemaSnapshotCreating}
                disabled={!authorized || !connectionId || !hasConfiguredVersioningScope}
                onClick={() => connectionId && onCreateSchemaSnapshot(connectionId)}
              >
                创建初始快照
              </Button>
            ) : (
              <Typography.Text type="secondary">已建立基线，后续变更自动提交</Typography.Text>
            )}
          </Space>
        </Flex>
        {snapshotTask ? (
          <div className="git-snapshot-progress-card">
            <Flex justify="space-between" align="center">
              <Typography.Text strong>{snapshotTask.detail}</Typography.Text>
              <Typography.Text type="secondary">{snapshotTask.status === 'running' ? '后台提交中' : snapshotTask.status === 'success' ? '已完成' : snapshotTask.status === 'cancelled' ? '已停止' : '失败'}</Typography.Text>
            </Flex>
            <Progress percent={snapshotTask.percent} status={snapshotTask.status === 'error' ? 'exception' : snapshotTask.status === 'success' ? 'success' : 'active'} />
            {snapshotTask.error ? <Typography.Text type="danger">{snapshotTask.error}</Typography.Text> : null}
          </div>
        ) : null}
        {versioningScopesLoading ? (
          <Typography.Text type="secondary">正在读取可纳管范围...</Typography.Text>
        ) : versioningScopeConfig?.scope_kind === 'single' ? (
          <Typography.Text type="secondary">当前连接为单库类型，结构版本会管理该数据库的全部对象。</Typography.Text>
        ) : versioningScopeConfig ? (
          <div className="settings-section-card">
            <Flex justify="space-between" align="center" gap="middle" wrap>
              <Space direction="vertical" size={0}>
                <Typography.Text strong>结构纳管范围</Typography.Text>
                <Typography.Text type="secondary">
                  仅已选{versioningScopeLabel}会进入结构快照，系统{versioningScopeLabel}不会显示。
                </Typography.Text>
              </Space>
              <Button
                type="primary"
                loading={versioningScopesSaving}
                disabled={versioningScopeDraft.length === 0}
                onClick={() => connectionId && onSaveVersioningScopes(connectionId)}
              >
                保存范围
              </Button>
            </Flex>
            <Checkbox.Group
              aria-label={`选择需要 Git 管理的${versioningScopeLabel}`}
              value={versioningScopeDraft}
              disabled={versioningScopesSaving}
              options={versioningScopeConfig.available_scopes.map((scope) => ({ label: scope, value: scope }))}
              onChange={(values) => onVersioningScopeDraftChange(values.map(String))}
            />
            {versioningScopeConfig.available_scopes.length === 0 ? (
              <Typography.Text type="secondary">当前连接没有可纳管的{versioningScopeLabel}。</Typography.Text>
            ) : !hasConfiguredVersioningScope ? (
              <Alert
                type="info"
                showIcon
                message={`请至少选择一个${versioningScopeLabel}并保存，之后才能创建结构快照或自动记录变更。`}
              />
            ) : null}
          </div>
        ) : connectionId ? (
          <Typography.Text type="secondary">连接未打开。双击打开连接后，可在这里查看和调整纳管范围。</Typography.Text>
        ) : null}
        {!authorized ? (
          <Alert
            type="warning"
            showIcon
            message="请先完成 GitHub 授权，才能读取或创建该连接的版本记录。"
            action={<Button size="small" onClick={onOpenSyncSettings}>前往同步设置</Button>}
          />
        ) : (
          <div className="connection-schema-version-list">
            {schemaVersions.map((version) => (
              <Flex key={version.id} className="schema-versioning-entry" justify="space-between" align="center" gap="middle">
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{version.message}</Typography.Text>
                  <Typography.Text type="secondary">
                    {version.id.slice(0, 7)}{version.committed_at ? ` · ${new Date(version.committed_at).toLocaleString()}` : ''}
                  </Typography.Text>
                </Space>
                <Button size="small" onClick={() => connectionId && onViewSchemaVersion(connectionId, version)}>查看 DDL</Button>
              </Flex>
            ))}
            {!schemaVersionsLoading && !databaseBaselineExists && (
              <Typography.Text type="secondary">还没有数据库快照提交。选择纳管范围后点击“创建初始快照”即可建立基线。</Typography.Text>
            )}
          </div>
        )}
      </Space>
    </Modal>
  )
}
