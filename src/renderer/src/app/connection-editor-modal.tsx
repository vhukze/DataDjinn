import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Typography
} from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { memo, useEffect, useState } from 'react'
import type { FormInstance } from 'antd'
import type { DatabaseType } from './data-sources'
import type { ConnectionFormValues, DriverInfo } from './app-shared'
import { DRIVER_DATABASE_META, JDBC_COMPATIBLE_DATABASE_TYPES } from './app-shared'

const FAST_MODAL_PROPS = {
  destroyOnHidden: false,
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
  testingSshConnection: boolean
  driversLoading: boolean
  manualDriverOptions: Array<{ label: string; value: string; disabled?: boolean }>
  selectedManualDriver?: DriverInfo
  driverLabel: string
  folderOptions: Array<{ label: string; value: string }>
  selectedFolderId?: string
  onOk: () => void
  onCancel: () => void
  onTestConnection: () => void
  onTestSshConnection: () => void
  onSelectSqliteFile: () => void
  onOpenDriverManager: () => void
  onDriverChange: (value: string) => void
  onFolderChange: (value?: string) => void
  onCreateFolder: (name: string) => string | undefined
}

export const ConnectionEditorModal = memo(function ConnectionEditorModal({
  form,
  open,
  mode,
  databaseType,
  loading,
  testingConnection,
  testingSshConnection,
  driversLoading,
  manualDriverOptions,
  selectedManualDriver,
  driverLabel,
  folderOptions,
  selectedFolderId,
  onOk,
  onCancel,
  onTestConnection,
  onTestSshConnection,
  onSelectSqliteFile,
  onOpenDriverManager,
  onDriverChange,
  onFolderChange,
  onCreateFolder
}: ConnectionEditorModalProps) {
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const driverDatabaseMeta =
    DRIVER_DATABASE_META[databaseType === 'dm' || databaseType === 'gaussdb' ? databaseType : 'dm']
  const sshEnabled = Form.useWatch('ssh_enabled', form) ?? false
  const sshPort = Form.useWatch('ssh_port', form)
  const sshAuthType = Form.useWatch('ssh_auth_type', form) ?? 'password'
  const splitLayout = databaseType !== 'sqlite'
  const handleSshEnabledChange = (checked: boolean): void => {
    if (!checked) {
      return
    }
    window.requestAnimationFrame(() => {
      const nextValues: Partial<{ ssh_port: number; ssh_auth_type: 'password' | 'private_key' }> =
        {}
      const currentPort = form.getFieldValue('ssh_port')
      if (typeof currentPort !== 'number' || !Number.isFinite(currentPort)) {
        nextValues.ssh_port = 22
      }
      const currentAuthType = form.getFieldValue('ssh_auth_type')
      if (currentAuthType !== 'password' && currentAuthType !== 'private_key') {
        nextValues.ssh_auth_type = 'password'
      }
      if (Object.keys(nextValues).length > 0) {
        form.setFieldsValue(nextValues)
      }
    })
  }

  useEffect(() => {
    if (!open || !sshEnabled) {
      return
    }
    const nextValues: Partial<{ ssh_port: number; ssh_auth_type: 'password' | 'private_key' }> = {}
    const currentPort = form.getFieldValue('ssh_port')
    if (typeof currentPort !== 'number' || !Number.isFinite(currentPort)) {
      nextValues.ssh_port = 22
    }
    const currentAuthType = form.getFieldValue('ssh_auth_type')
    if (currentAuthType !== 'password' && currentAuthType !== 'private_key') {
      nextValues.ssh_auth_type = 'password'
    }
    if (Object.keys(nextValues).length > 0) {
      form.setFieldsValue(nextValues)
    }
  }, [form, open, sshEnabled, sshPort])

  useEffect(() => {
    if (!open) {
      setCreatingFolder(false)
      setNewFolderName('')
    }
  }, [open])

  const addFolder = (): void => {
    const folderId = onCreateFolder(newFolderName)
    if (!folderId) {
      return
    }
    onFolderChange(folderId)
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const cancelFolderCreation = (): void => {
    setCreatingFolder(false)
    setNewFolderName('')
  }

  return (
    <Modal
      title={mode === 'edit' ? '编辑数据库连接' : '保存数据库连接'}
      open={open}
      className="connection-editor-modal"
      width={splitLayout ? 980 : 640}
      okText={mode === 'edit' ? '保存修改' : '保存连接'}
      cancelText="取消"
      confirmLoading={loading}
      onOk={onOk}
      onCancel={onCancel}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space className="connection-editor-footer-actions">
          <Button loading={testingConnection} onClick={onTestConnection}>
            测试连接
          </Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
      maskClosable={false}
      {...FAST_MODAL_PROPS}
    >
      <Form
        form={form}
        layout="vertical"
        className={`connection-editor-form${splitLayout ? ' connection-editor-form-split' : ''}`}
      >
        <Form.Item name="database_type" style={{ display: 'none' }}>
          <Input />
        </Form.Item>
        <div
          className={`connection-editor-layout${splitLayout ? '' : ' connection-editor-layout-single'}`}
        >
          <div className="connection-editor-main">
            <Form.Item
              name="name"
              label="连接名称"
              rules={[{ required: true, message: '请输入连接名称' }]}
            >
              <Input placeholder="例如：本地 SQLite" />
            </Form.Item>
            {mode === 'create' && (
              <Form.Item label="分组（可选）">
                <div className="connection-folder-picker">
                  <Select
                    aria-label="连接分组"
                    allowClear
                    value={selectedFolderId}
                    placeholder="不分组"
                    options={folderOptions}
                    onChange={onFolderChange}
                  />
                  <Button
                    icon={<PlusOutlined />}
                    aria-label="新建分组"
                    onClick={() => setCreatingFolder((current) => !current)}
                  >
                    新建分组
                  </Button>
                </div>
                {creatingFolder && (
                  <div className="connection-folder-create-row">
                    <Input
                      aria-label="新分组名称"
                      value={newFolderName}
                      maxLength={80}
                      placeholder="请输入分组名称"
                      onChange={(event) => setNewFolderName(event.target.value)}
                      onPressEnter={(event) => {
                        event.preventDefault()
                        addFolder()
                      }}
                    />
                    <Button
                      type="primary"
                      aria-label="添加分组"
                      disabled={!newFolderName.trim()}
                      onClick={addFolder}
                    >
                      添加
                    </Button>
                    <Button
                      type="text"
                      icon={<CloseOutlined />}
                      aria-label="取消新建分组"
                      title="取消新建分组"
                      onClick={cancelFolderCreation}
                    />
                  </div>
                )}
              </Form.Item>
            )}
            {databaseType === 'sqlite' ? (
              <Form.Item label="SQLite 文件路径" required>
                <div className="connection-file-picker">
                  <Form.Item
                    name="sqlite_path"
                    noStyle
                    rules={[{ required: true, message: '请输入 SQLite 文件路径' }]}
                  >
                    <Input placeholder="请选择 SQLite 数据库文件" />
                  </Form.Item>
                  <Button
                    className="connection-file-picker-action"
                    type="text"
                    onClick={onSelectSqliteFile}
                  >
                    选择文件
                  </Button>
                </div>
              </Form.Item>
            ) : (
              <>
                <Form.Item
                  name="host"
                  label="主机"
                  rules={[{ required: true, message: '请输入主机' }]}
                >
                  <Input placeholder="127.0.0.1" />
                </Form.Item>
                <Form.Item
                  name="port"
                  label="端口"
                  rules={[
                    { required: true, message: '请输入端口' },
                    ...(databaseType === 'clickhouse'
                      ? [
                          {
                            validator: async (_rule: unknown, value: unknown) => {
                              const normalized =
                                typeof value === 'number'
                                  ? String(value)
                                  : typeof value === 'string'
                                    ? value.trim()
                                    : ''
                              if (!normalized) {
                                return
                              }
                              const segments = normalized
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean)
                              if (
                                segments.length === 0 ||
                                segments.some(
                                  (item) =>
                                    !/^\d+$/.test(item) || Number(item) < 1 || Number(item) > 65535
                                )
                              ) {
                                throw new Error('ClickHouse 端口支持单个端口或逗号分隔的多个端口')
                              }
                            }
                          }
                        ]
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
                      placeholder={
                        databaseType === 'postgresql'
                          ? '5432'
                          : databaseType === 'gaussdb'
                            ? '8000'
                            : databaseType === 'oracle'
                              ? '1521'
                              : databaseType === 'dm'
                                ? '5236'
                                : databaseType === 'mongodb'
                                  ? '27017'
                                  : databaseType === 'redis'
                                    ? '6379'
                                    : '3306'
                      }
                    />
                  )}
                </Form.Item>
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={
                    databaseType === 'mongodb' || databaseType === 'redis'
                      ? undefined
                      : [{ required: true, message: '请输入用户名' }]
                  }
                >
                  <Input
                    placeholder={
                      databaseType === 'postgresql'
                        ? 'postgres'
                        : databaseType === 'gaussdb'
                          ? 'gaussdb'
                          : databaseType === 'oracle'
                            ? 'system'
                            : databaseType === 'dm'
                              ? 'SYSDBA'
                              : databaseType === 'redis'
                                ? 'Redis ACL 用户名，可选'
                                : databaseType === 'clickhouse'
                                  ? 'default'
                                  : undefined
                    }
                  />
                </Form.Item>
                <Form.Item name="password" label="密码">
                  <Input.Password />
                </Form.Item>
                <Form.Item
                  name="database"
                  label={
                    databaseType === 'postgresql' || databaseType === 'gaussdb'
                      ? '数据库名'
                      : databaseType === 'oracle'
                        ? '服务名'
                        : databaseType === 'dm'
                          ? '默认 Schema（可选）'
                          : databaseType === 'mongodb'
                            ? '认证库/默认库（可选）'
                            : databaseType === 'redis'
                              ? '默认 DB 序号（可选）'
                              : databaseType === 'clickhouse'
                                ? '默认数据库'
                                : '默认数据库（可选）'
                  }
                  rules={
                    databaseType === 'postgresql' ||
                    databaseType === 'gaussdb' ||
                    databaseType === 'oracle'
                      ? [
                          {
                            required: true,
                            message: databaseType === 'oracle' ? '请输入服务名' : '请输入数据库名'
                          }
                        ]
                      : undefined
                  }
                >
                  <Input
                    placeholder={
                      databaseType === 'postgresql'
                        ? 'postgres'
                        : databaseType === 'gaussdb'
                          ? 'postgres'
                          : databaseType === 'oracle'
                            ? '例如：orclpdb1'
                            : databaseType === 'dm'
                              ? '不填则使用默认 Schema'
                              : databaseType === 'mongodb'
                                ? '默认 admin，也可填业务库名'
                                : databaseType === 'redis'
                                  ? '默认 0，例如 0、1、2'
                                  : databaseType === 'clickhouse'
                                    ? '默认 default'
                                    : '不填则连接服务器并加载全部数据库'
                    }
                  />
                </Form.Item>
                {JDBC_COMPATIBLE_DATABASE_TYPES.includes(databaseType) && (
                  <>
                    <Form.Item
                      name="driver_id"
                      label={`${driverDatabaseMeta.shortLabel}驱动`}
                      rules={[{ required: true, message: '请选择驱动' }]}
                    >
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
                      message={
                        selectedManualDriver
                          ? `当前选择：${driverLabel} - ${selectedManualDriver.name}`
                          : '未选择驱动，请先在驱动管理中添加并选择兼容驱动'
                      }
                      action={
                        <Button size="small" onClick={onOpenDriverManager}>
                          驱动管理
                        </Button>
                      }
                    />
                  </>
                )}
              </>
            )}
          </div>
          {splitLayout && (
            <div className="connection-editor-side">
              <div className="connection-editor-side-card">
                <div className="connection-editor-section-head">
                  <Typography.Title level={5} className="connection-editor-section-title">
                    SSH 隧道
                  </Typography.Title>
                  <Typography.Paragraph className="connection-editor-section-desc">
                    通过跳板机把当前数据库连接转发到本地端口。
                  </Typography.Paragraph>
                </div>
                <Form.Item name="ssh_enabled" label="启用 SSH 隧道" valuePropName="checked">
                  <Switch
                    checkedChildren="已启用"
                    unCheckedChildren="已关闭"
                    onChange={handleSshEnabledChange}
                  />
                </Form.Item>
                <div className={`connection-editor-ssh-fields${sshEnabled ? '' : ' is-hidden'}`}>
                  <div className="connection-editor-inline-fields">
                    <Form.Item
                      name="ssh_host"
                      label="SSH 主机"
                      rules={[{ required: sshEnabled, message: '请输入 SSH 主机' }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="ssh_port"
                      label="SSH 端口"
                      initialValue={22}
                      rules={[{ required: sshEnabled, message: '请输入 SSH 端口' }]}
                    >
                      <InputNumber min={1} max={65535} className="full-width" placeholder="22" />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name="ssh_username"
                    label="SSH 用户名"
                    rules={[{ required: sshEnabled, message: '请输入 SSH 用户名' }]}
                  >
                    <Input placeholder="请输入 SSH 用户名" />
                  </Form.Item>
                  <Form.Item
                    name="ssh_auth_type"
                    label="认证方式"
                    initialValue="password"
                    rules={[{ required: sshEnabled, message: '请选择 SSH 认证方式' }]}
                  >
                    <Select
                      options={[
                        { label: '密码认证', value: 'password' },
                        { label: '私钥文件', value: 'private_key' }
                      ]}
                    />
                  </Form.Item>
                  <div
                    className={
                      sshAuthType === 'private_key' ? '' : 'connection-editor-ssh-auth-hidden'
                    }
                  >
                    <Form.Item
                      name="ssh_private_key_path"
                      label="私钥路径"
                      rules={[
                        {
                          required: sshEnabled && sshAuthType === 'private_key',
                          message: '请输入私钥路径'
                        }
                      ]}
                    >
                      <Input placeholder={'例如：C:\\Users\\你的用户名\\.ssh\\id_rsa'} />
                    </Form.Item>
                    <Form.Item name="ssh_passphrase" label="私钥口令">
                      <Input.Password placeholder="私钥未加密可留空" />
                    </Form.Item>
                  </div>
                  <div
                    className={
                      sshAuthType === 'private_key' ? 'connection-editor-ssh-auth-hidden' : ''
                    }
                  >
                    <Form.Item
                      name="ssh_password"
                      label="SSH 密码"
                      rules={[
                        {
                          required: sshEnabled && sshAuthType === 'password',
                          message: '请输入 SSH 登录密码'
                        }
                      ]}
                    >
                      <Input.Password placeholder="请输入 SSH 登录密码" />
                    </Form.Item>
                  </div>
                  <div className="connection-editor-side-actions">
                    <Button
                      className="connection-editor-ssh-test-btn"
                      loading={testingSshConnection}
                      onClick={onTestSshConnection}
                    >
                      测试 SSH
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Form>
    </Modal>
  )
})
