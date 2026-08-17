import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Divider, Flex, Modal, Select, Space, Typography } from 'antd'
import type { GitHubAuthStatus } from './app-model'
import type { TableInfo } from './connection-model'
import type { SchemaVersionInfo, VersioningScopeConfig } from './app-runtime-support'
import { FAST_MODAL_PROPS } from './app-runtime-support'

type ConnectionVersionManagementModalProps = {
  open: boolean
  connectionName: string
  connectionId?: string
  onClose: () => void
  gitHubAuthStatus: GitHubAuthStatus
  onOpenSyncSettings: () => void
  schemaVersions: SchemaVersionInfo[]
  schemaVersionsLoading: boolean
  schemaSnapshotCreating: boolean
  onLoadSchemaVersions: (connectionId: string) => void
  onCreateSchemaSnapshot: (connectionId: string) => void
  onViewSchemaVersion: (connectionId: string, version: SchemaVersionInfo) => void
  versioningScopeConfig?: VersioningScopeConfig
  versioningScopesLoading: boolean
  versioningScopesSaving: boolean
  versioningScopeDraft: string[]
  versioningScopeLabel: string
  hasConfiguredVersioningScope: boolean
  onVersioningScopeDraftChange: (scopes: string[]) => void
  onSaveVersioningScopes: (connectionId: string) => void
  dataVersioningModuleInstalled: boolean
  installingDataVersioningModule: boolean
  onInstallDataVersioningModule: () => void
  dataVersionTables: TableInfo[]
  dataVersionTableName?: string
  dataVersions: SchemaVersionInfo[]
  dataVersionsLoading: boolean
  dataSnapshotCreating: boolean
  onDataVersionTableNameChange: (tableName?: string) => void
  onLoadDataVersions: (connectionId: string, tableName: string) => void
  onCreateDataSnapshot: (connectionId: string, tableName: string) => void
  onViewDataVersion: (connectionId: string, tableName: string, version: SchemaVersionInfo) => void
  onViewDataVersionDiff: (connectionId: string, tableName: string, version: SchemaVersionInfo) => void
}

export function ConnectionVersionManagementModal({
  open,
  connectionName,
  connectionId,
  onClose,
  gitHubAuthStatus,
  onOpenSyncSettings,
  schemaVersions,
  schemaVersionsLoading,
  schemaSnapshotCreating,
  onLoadSchemaVersions,
  onCreateSchemaSnapshot,
  onViewSchemaVersion,
  versioningScopeConfig,
  versioningScopesLoading,
  versioningScopesSaving,
  versioningScopeDraft,
  versioningScopeLabel,
  hasConfiguredVersioningScope,
  onVersioningScopeDraftChange,
  onSaveVersioningScopes,
  dataVersioningModuleInstalled,
  installingDataVersioningModule,
  onInstallDataVersioningModule,
  dataVersionTables,
  dataVersionTableName,
  dataVersions,
  dataVersionsLoading,
  dataSnapshotCreating,
  onDataVersionTableNameChange,
  onLoadDataVersions,
  onCreateDataSnapshot,
  onViewDataVersion,
  onViewDataVersionDiff
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
            结构和表数据使用同一连接级 Git 历史；先选择要纳管的库或模式，结构变更才会自动记录。
          </Typography.Text>
          <Space>
            <Button
              icon={<HistoryOutlined />}
              loading={schemaVersionsLoading}
              disabled={!authorized || !connectionId}
              onClick={() => connectionId && onLoadSchemaVersions(connectionId)}
            >
              刷新历史
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={schemaSnapshotCreating}
              disabled={!authorized || !connectionId || !hasConfiguredVersioningScope}
              onClick={() => connectionId && onCreateSchemaSnapshot(connectionId)}
            >
              创建快照
            </Button>
          </Space>
        </Flex>
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
            {!schemaVersionsLoading && schemaVersions.length === 0 && (
              <Typography.Text type="secondary">还没有结构版本。首次打开连接会自动建立基线，也可以手动创建快照。</Typography.Text>
            )}
          </div>
        )}
        <Divider className="connection-versioning-divider" />
        <Flex justify="space-between" align="center" gap="middle" wrap>
          <Space direction="vertical" size={0}>
            <Typography.Text strong>表数据版本</Typography.Text>
            <Typography.Text type="secondary">
              安装 Git 表数据版本管理扩展后，可将小表快照写入同一 Git 仓库，并基于主键或唯一键查看行级差异。
            </Typography.Text>
          </Space>
          <Space>
            <Select
              aria-label="选择需要版本管理的数据表"
              className="connection-data-version-table-select"
              placeholder="选择数据表"
              value={dataVersionTableName}
              loading={dataVersionsLoading && dataVersionTables.length === 0}
              disabled={!dataVersioningModuleInstalled || !authorized || dataVersionTables.length === 0}
              options={dataVersionTables.map((table) => ({ label: table.name, value: table.name }))}
              onChange={onDataVersionTableNameChange}
            />
            <Button
              icon={<HistoryOutlined />}
              loading={dataVersionsLoading}
              disabled={!dataVersioningModuleInstalled || !authorized || !connectionId || !dataVersionTableName}
              onClick={() => connectionId && dataVersionTableName && onLoadDataVersions(connectionId, dataVersionTableName)}
            >
              刷新历史
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={dataSnapshotCreating}
              disabled={!dataVersioningModuleInstalled || !authorized || !connectionId || !dataVersionTableName}
              onClick={() => connectionId && dataVersionTableName && onCreateDataSnapshot(connectionId, dataVersionTableName)}
            >
              创建数据快照
            </Button>
          </Space>
        </Flex>
        {!dataVersioningModuleInstalled ? (
          <Alert
            type="info"
            showIcon
            message="Git 表数据版本管理扩展尚未安装"
            description="基础版本仅管理连接结构和同步配置；安装扩展后可创建表数据快照、查看提交历史和行级差异。"
            action={
              <Button
                type="primary"
                size="small"
                loading={installingDataVersioningModule}
                disabled={installingDataVersioningModule}
                onClick={onInstallDataVersioningModule}
              >
                {installingDataVersioningModule ? '安装中' : '安装扩展'}
              </Button>
            }
          />
        ) : authorized ? (
          <div className="connection-schema-version-list">
            {dataVersions.map((version) => (
              <Flex key={version.id} className="schema-versioning-entry" justify="space-between" align="center" gap="middle">
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{version.message}</Typography.Text>
                  <Typography.Text type="secondary">
                    {version.id.slice(0, 7)}{version.committed_at ? ` · ${new Date(version.committed_at).toLocaleString()}` : ''}
                  </Typography.Text>
                </Space>
                <Space size={6}>
                  <Button size="small" disabled={!dataVersionTableName || !connectionId} onClick={() => connectionId && dataVersionTableName && onViewDataVersion(connectionId, dataVersionTableName, version)}>查看快照</Button>
                  <Button size="small" disabled={!dataVersionTableName || !connectionId} onClick={() => connectionId && dataVersionTableName && onViewDataVersionDiff(connectionId, dataVersionTableName, version)}>查看差异</Button>
                </Space>
              </Flex>
            ))}
            {!dataVersionsLoading && dataVersionTableName && dataVersions.length === 0 && (
              <Typography.Text type="secondary">该表还没有数据版本。创建首个快照后，后续可基于它查看数据差异。</Typography.Text>
            )}
          </div>
        ) : null}
      </Space>
    </Modal>
  )
}
