import { HistoryOutlined, LinkOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Flex, Modal, Progress, Select, Space, Tag, Typography } from 'antd'
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
  onRestoreDatabaseVersion: (connectionId: string, version: SchemaVersionInfo) => void
  onRetrySnapshotSync: (connectionId: string, version: SchemaVersionInfo) => void
  versioningScopeConfig?: VersioningScopeConfig
  versioningScopesLoading: boolean
  versioningScopesSaving: boolean
  versioningScopeDraft: string[]
  versioningSnapshotIntervalDraft: number
  versioningScopeLabel: string
  hasConfiguredVersioningScope: boolean
  onVersioningScopeDraftChange: (scopes: string[]) => void
  onVersioningSnapshotIntervalDraftChange: (hours: number) => void
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
  onRestoreDatabaseVersion,
  onRetrySnapshotSync,
  versioningScopeConfig,
  versioningScopesLoading,
  versioningScopesSaving,
  versioningScopeDraft,
  versioningSnapshotIntervalDraft,
  versioningScopeLabel,
  hasConfiguredVersioningScope,
  onVersioningScopeDraftChange,
  onVersioningSnapshotIntervalDraftChange,
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
              disabled={!connectionId}
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
        ) : versioningScopeConfig ? (
          <div className="settings-section-card">
            <Flex justify="space-between" align="center" gap="middle" wrap>
              <Space direction="vertical" size={0}>
                <Typography.Text strong>版本管理设置</Typography.Text>
                <Typography.Text type="secondary">
                  {versioningScopeConfig.scope_kind === 'single'
                    ? '当前连接为单库类型，版本管理会覆盖该数据库的全部对象。'
                    : `仅已选${versioningScopeLabel}会进入快照，系统${versioningScopeLabel}不会显示。`}
                </Typography.Text>
              </Space>
              <Button
                type="primary"
                loading={versioningScopesSaving}
                disabled={versioningScopeConfig.scope_kind !== 'single' && versioningScopeDraft.length === 0}
                onClick={() => connectionId && onSaveVersioningScopes(connectionId)}
              >
                保存设置
              </Button>
            </Flex>
            {versioningScopeConfig.scope_kind !== 'single' ? (
              <>
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
                    message={`请至少选择一个${versioningScopeLabel}并保存，之后才能创建快照或自动记录变更。`}
                  />
                ) : null}
              </>
            ) : null}
            <Flex align="center" gap="middle" wrap>
              <Typography.Text strong>全库检查点间隔</Typography.Text>
              <Select
                aria-label="全库检查点间隔"
                value={versioningSnapshotIntervalDraft}
                disabled={versioningScopesSaving}
                style={{ minWidth: 180 }}
                options={[
                  { value: 0, label: '关闭定时检查点' },
                  { value: 1, label: '每小时' },
                  { value: 6, label: '每 6 小时' },
                  { value: 12, label: '每 12 小时' },
                  { value: 24, label: '每天' },
                  { value: 168, label: '每周' }
                ]}
                onChange={(value: number) => onVersioningSnapshotIntervalDraftChange(value)}
              />
              <Typography.Text type="secondary">
                定时检查点支持整库恢复；需应用运行且连接保持打开。已知单表写入只保存受影响表。
              </Typography.Text>
            </Flex>
          </div>
        ) : connectionId ? (
          <Typography.Text type="secondary">连接未打开。双击打开连接后，可在这里查看和调整纳管范围。</Typography.Text>
        ) : null}
        {schemaVersions.find((version) => version.status === 'remote_error') ? (
          <Alert
            type="warning"
            showIcon
            message="远端版本历史暂不可用"
            description={schemaVersions.find((version) => version.status === 'remote_error')?.error}
          />
        ) : null}
        {!authorized && schemaVersions.length === 0 ? (
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
                  <Space size={6} wrap>
                    <Typography.Text strong>{version.message}</Typography.Text>
                    {version.status === 'pending' || version.status === 'prepared' ? <Tag color="processing">本机已保护 | 正在同步</Tag> : null}
                    {version.status === 'synced' ? <Tag color="success">已同步</Tag> : null}
                    {version.status === 'error' ? <Tag color="error">同步失败 | 本机保留</Tag> : null}
                    {version.status === 'local_only' ? <Tag color="warning">仅本机</Tag> : null}
                  </Space>
                  <Typography.Text type="secondary">
                    {version.id.slice(0, 7)}{version.committed_at ? ` · ${new Date(version.committed_at).toLocaleString()}` : ''}
                  </Typography.Text>
                </Space>
                <Space size={4}>
                  {version.status === 'error' || version.status === 'local_only' ? (
                    <Button
                      size="small"
                      disabled={!connectionId || !authorized}
                      onClick={() => connectionId && onRetrySnapshotSync(connectionId, version)}
                    >
                      重试同步
                    </Button>
                  ) : null}
                  {version.status === 'synced' || (!version.status && authorized) ? (
                    <Button
                      size="small"
                      onClick={() => connectionId && onViewSchemaVersion(
                        connectionId,
                        version.remote_commit_id ? { ...version, id: version.remote_commit_id } : version
                      )}
                    >
                      查看 DDL
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    danger
                    disabled={!connectionId || (!version.status && !authorized) || (!authorized && version.status === 'synced')}
                    onClick={() => connectionId && onRestoreDatabaseVersion(connectionId, version)}
                  >
                    恢复整库数据
                  </Button>
                </Space>
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
