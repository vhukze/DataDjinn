import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import { memo } from 'react'
import type { FormInstance } from 'antd'
import type { DatabaseType } from './data-sources'
import type { ConnectionFormValues, DriverInfo } from './app-shared'
import { DRIVER_DATABASE_META, JDBC_COMPATIBLE_DATABASE_TYPES } from './app-shared'

const FAST_MODAL_PROPS = {
  destroyOnHidden: true,
  transitionName: '',
  maskTransitionName: ''
} as const

type ConnectionEditorModalProps = {
  form: FormInstance<ConnectionFormValues>
  open: boolean
  mode: 'create' | 'edit'
  databaseType: DatabaseType
  loading: boolean
  testingConnection: boolean
  driversLoading: boolean
  manualDriverOptions: Array<{ label: string; value: string; disabled?: boolean }>
  selectedManualDriver?: DriverInfo
  driverLabel: string
  onOk: () => void
  onCancel: () => void
  onTestConnection: () => void
  onSelectSqliteFile: () => void
  onOpenDriverManager: () => void
  onDriverChange: (value: string) => void
}

export const ConnectionEditorModal = memo(function ConnectionEditorModal({
  form,
  open,
  mode,
  databaseType,
  loading,
  testingConnection,
  driversLoading,
  manualDriverOptions,
  selectedManualDriver,
  driverLabel,
  onOk,
  onCancel,
  onTestConnection,
  onSelectSqliteFile,
  onOpenDriverManager,
  onDriverChange
}: ConnectionEditorModalProps) {
  const driverDatabaseMeta = DRIVER_DATABASE_META[(databaseType === 'dm' || databaseType === 'gaussdb') ? databaseType : 'dm']

  return (
    <Modal
      title={mode === 'edit' ? '编辑数据库连接' : '保存数据库连接'}
      open={open}
      className="connection-editor-modal"
      okText={mode === 'edit' ? '保存修改' : '保存连接'}
      cancelText="取消"
      confirmLoading={loading}
      onOk={onOk}
      onCancel={onCancel}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space className="connection-editor-footer-actions">
          <Button loading={testingConnection} onClick={onTestConnection}>测试连接</Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
      maskClosable={false}
      {...FAST_MODAL_PROPS}
    >
      {open ? (
        <Form form={form} layout="vertical" className="connection-editor-form" preserve={false}>
          <Form.Item
            name="name"
            label="连接名称"
            rules={[{ required: true, message: '请输入连接名称' }]}
          >
            <Input placeholder="例如：本地 SQLite" />
          </Form.Item>
          <Form.Item name="database_type" style={{ display: 'none' }}><Input /></Form.Item>
          {databaseType === 'sqlite' ? (
            <Form.Item label="SQLite 文件路径" required>
              <div className="connection-file-picker">
                <Form.Item name="sqlite_path" noStyle rules={[{ required: true, message: '请输入 SQLite 文件路径' }]}>
                  <Input placeholder="请选择 SQLite 数据库文件" />
                </Form.Item>
                <Button className="connection-file-picker-action" type="text" onClick={onSelectSqliteFile}>
                  选择文件
                </Button>
              </div>
            </Form.Item>
          ) : (
            <>
              <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机' }]}>
                <Input placeholder="127.0.0.1" />
              </Form.Item>
              <Form.Item
                name="port"
                label="端口"
                rules={[
                  { required: true, message: '请输入端口' },
                  ...(databaseType === 'clickhouse'
                    ? [{
                      validator: async (_rule: unknown, value: unknown) => {
                        const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
                        if (!normalized) {
                          return
                        }
                        const segments = normalized.split(',').map((item) => item.trim()).filter(Boolean)
                        if (segments.length === 0 || segments.some((item) => !/^\d+$/.test(item) || Number(item) < 1 || Number(item) > 65535)) {
                          throw new Error('ClickHouse 端口支持单个端口或逗号分隔的多个端口')
                        }
                      }
                    }]
                    : [])
                ]}
              >
                {databaseType === 'clickhouse' ? (
                  <Input className="full-width" placeholder="例如：8123 或 8123,8124" />
                ) : (
                  <InputNumber
                    min={1}
                    max={65535}
                    className="full-width"
                    placeholder={databaseType === 'postgresql' ? '5432' : databaseType === 'gaussdb' ? '8000' : databaseType === 'oracle' ? '1521' : databaseType === 'dm' ? '5236' : databaseType === 'mongodb' ? '27017' : databaseType === 'redis' ? '6379' : '3306'}
                  />
                )}
              </Form.Item>
              <Form.Item name="username" label="用户名" rules={databaseType === 'mongodb' || databaseType === 'redis' ? undefined : [{ required: true, message: '请输入用户名' }]}>
                <Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'gaussdb' ? 'gaussdb' : databaseType === 'oracle' ? 'system' : databaseType === 'dm' ? 'SYSDBA' : databaseType === 'redis' ? 'Redis ACL 用户名，可选' : databaseType === 'clickhouse' ? 'default' : undefined} />
              </Form.Item>
              <Form.Item name="password" label="密码"><Input.Password /></Form.Item>
              <Form.Item
                name="database"
                label={databaseType === 'postgresql' || databaseType === 'gaussdb' ? '数据库名' : databaseType === 'oracle' ? '服务名' : databaseType === 'dm' ? '默认 Schema（可选）' : databaseType === 'mongodb' ? '认证库/默认库（可选）' : databaseType === 'redis' ? '默认 DB 序号（可选）' : databaseType === 'clickhouse' ? '默认数据库' : '默认数据库（可选）'}
                rules={databaseType === 'postgresql' || databaseType === 'gaussdb' || databaseType === 'oracle' ? [{ required: true, message: databaseType === 'oracle' ? '请输入服务名' : '请输入数据库名' }] : undefined}
              >
                <Input placeholder={databaseType === 'postgresql' ? 'postgres' : databaseType === 'gaussdb' ? 'postgres' : databaseType === 'oracle' ? '例如：orclpdb1' : databaseType === 'dm' ? '不填则使用默认 Schema' : databaseType === 'mongodb' ? '默认 admin，也可填业务库名' : databaseType === 'redis' ? '默认 0，例如 0、1、2' : databaseType === 'clickhouse' ? '默认 default' : '不填则连接服务器并加载全部数据库'} />
              </Form.Item>
              {JDBC_COMPATIBLE_DATABASE_TYPES.includes(databaseType) && (
                <>
                  <Form.Item name="driver_id" label={`${driverDatabaseMeta.shortLabel}驱动`} rules={[{ required: true, message: '请选择驱动' }]}>
                    <Select
                      loading={driversLoading}
                      placeholder={`请选择已添加的${driverDatabaseMeta.shortLabel}驱动`}
                      options={manualDriverOptions}
                      notFoundContent={`暂无可用${driverDatabaseMeta.shortLabel}驱动`}
                      onChange={onDriverChange}
                    />
                  </Form.Item>
                  <Alert
                    type={selectedManualDriver ? 'info' : 'warning'}
                    showIcon
                    message={selectedManualDriver ? `当前选择：${driverLabel} - ${selectedManualDriver.name}` : '未选择驱动，请先在驱动管理中添加并选择兼容驱动'}
                    action={<Button size="small" onClick={onOpenDriverManager}>驱动管理</Button>}
                  />
                </>
              )}
            </>
          )}
        </Form>
      ) : null}
    </Modal>
  )
})
