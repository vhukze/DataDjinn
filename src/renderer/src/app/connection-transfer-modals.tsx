import { Alert, Button, Form, Input, Modal, Select, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DATABASE_TYPE_LABELS, IMPORT_CONNECTION_SOURCE_OPTIONS } from './app-shared'
import { FAST_MODAL_PROPS } from './app-runtime-support'
import type {
  ImportConnectionCandidate,
  ImportConnectionResult,
  ImportConnectionSource
} from './app-shared'
import type { DatabaseType } from './data-sources'

type ConnectionExportModalProps = {
  open: boolean
  secret: string
  secretConfirm: string
  exporting: boolean
  onClose: () => void
  onSecretChange: (value: string) => void
  onSecretConfirmChange: (value: string) => void
  onExport: () => void
}

export function ConnectionExportModal({
  open,
  secret,
  secretConfirm,
  exporting,
  onClose,
  onSecretChange,
  onSecretConfirmChange,
  onExport
}: ConnectionExportModalProps): React.JSX.Element {
  return (
    <Modal
      title="导出连接"
      open={open}
      width={760}
      className="export-connection-modal"
      onCancel={onClose}
      maskClosable={false}
      {...FAST_MODAL_PROPS}
      footer={<Space><Button onClick={onClose}>关闭</Button><Button type="primary" loading={exporting} onClick={onExport}>导出</Button></Space>}
    >
      <Space direction="vertical" className="full-width import-connection-layout" size={18}>
        <div className="import-connection-hero">
          <div className="import-connection-hero-badge">Connection Export</div>
          <Typography.Title level={4}>导出当前所有连接、密码与分组结构</Typography.Title>
          <Typography.Text type="secondary">导出文件会使用你设置的口令进行整体加密，可在另一台设备通过 DataDjinn 导入。</Typography.Text>
        </div>
        <Form layout="vertical" className="import-connection-form">
          <Form.Item label="导出口令" className="import-connection-field" extra="请妥善保管此口令，另一台设备导入时需要使用同一个口令解密。">
            <Input.Password value={secret} placeholder="请输入导出口令" onChange={(event) => onSecretChange(event.target.value)} />
          </Form.Item>
          <Form.Item label="确认导出口令" className="import-connection-field">
            <Input.Password value={secretConfirm} placeholder="请再次输入导出口令" onChange={(event) => onSecretConfirmChange(event.target.value)} />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  )
}

type ConnectionImportModalProps = {
  open: boolean
  source: ImportConnectionSource
  rawText: string
  filePath: string
  secret: string
  parsing: boolean
  importing: boolean
  candidates: ImportConnectionCandidate[]
  previewColumns: ColumnsType<ImportConnectionCandidate>
  onClose: () => void
  onSourceChange: (source: ImportConnectionSource) => void
  onRawTextChange: (value: string) => void
  onSecretChange: (value: string) => void
  onChooseFile: () => void
  onParse: () => void
  onImport: () => void
}

export function ConnectionImportModal({
  open,
  source,
  rawText,
  filePath,
  secret,
  parsing,
  importing,
  candidates,
  previewColumns,
  onClose,
  onSourceChange,
  onRawTextChange,
  onSecretChange,
  onChooseFile,
  onParse,
  onImport
}: ConnectionImportModalProps): React.JSX.Element {
  const importableCount = candidates.filter((candidate) => candidate.payload && candidate.status !== 'error').length
  return (
    <Modal
      title="导入连接"
      open={open}
      width={980}
      className="import-connection-modal"
      onCancel={onClose}
      maskClosable={false}
      {...FAST_MODAL_PROPS}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button loading={parsing} onClick={onParse}>解析</Button>
          <Button type="primary" loading={importing} disabled={importableCount === 0} onClick={onImport}>导入</Button>
        </Space>
      }
    >
      <Space direction="vertical" className="full-width import-connection-layout" size={18}>
        <div className="import-connection-hero">
          <div className="import-connection-hero-badge">Data Source Import</div>
          <Typography.Title level={4}>
            {source === 'datadjinn'
              ? '导入 DataDjinn 连接文件，恢复连接、密码与分组结构'
              : source === 'dbeaver'
                ? '上传 DBeaver 的 data-sources.json，批量导入连接和分组'
                : '粘贴 DataGrip / IDEA 数据源配置，批量导入到 DataDjinn'}
          </Typography.Title>
          <Typography.Text type="secondary">
            {source === 'datadjinn'
              ? '先选择加密导出文件并输入口令，再解析确认导入。'
              : source === 'dbeaver'
                ? '请上传 DBeaver 的 data-sources.json。默认位置通常在：用户目录\\AppData\\Roaming\\DBeaverData\\workspace6\\General\\.dbeaver\\data-sources.json'
                : '先解析，再确认导入。解析结果会提前展示可导入状态和失败原因。'}
          </Typography.Text>
        </div>
        <Form layout="vertical" className="import-connection-form">
          <Form.Item label="来源" className="import-connection-field">
            <Select value={source} options={IMPORT_CONNECTION_SOURCE_OPTIONS} onChange={(value) => onSourceChange(value as ImportConnectionSource)} />
          </Form.Item>
          {source === 'datadjinn' ? (
            <>
              <Form.Item label="连接文件" className="import-connection-field" extra="选择通过 DataDjinn 导出的 .ddj 加密连接文件。">
                <div className="import-connection-file-row"><Input value={filePath} readOnly placeholder="请选择 .ddj 文件" /><Button onClick={onChooseFile}>选择文件</Button></div>
              </Form.Item>
              <Form.Item label="导入口令" className="import-connection-field" extra="请输入导出时设置的口令，用于解密连接文件。">
                <Input.Password value={secret} placeholder="请输入导入口令" onChange={(event) => onSecretChange(event.target.value)} />
              </Form.Item>
            </>
          ) : source === 'dbeaver' ? (
            <Form.Item label="DBeaver 连接文件" className="import-connection-field" extra="请选择 DBeaver 导出的 data-sources.json，分组信息也会一并解析。">
              <div className="import-connection-file-row"><Input value={filePath} readOnly placeholder="请选择 data-sources.json 文件" /><Button onClick={onChooseFile}>选择文件</Button></div>
            </Form.Item>
          ) : (
            <Form.Item label="连接配置文本" className="import-connection-field import-connection-field-textarea" extra="选中复制 DataGrip / IDEA 中的数据源并复制粘贴到上方。">
              <Input.TextArea value={rawText} autoSize={{ minRows: 10, maxRows: 18 }} placeholder="#DataSourceSettings# ..." onChange={(event) => onRawTextChange(event.target.value)} />
            </Form.Item>
          )}
        </Form>
        {candidates.length > 0 && (
          <Space direction="vertical" className="full-width import-connection-preview" size={12}>
            <Space className="import-connection-preview-header" direction="horizontal">
              <Typography.Text strong>解析结果</Typography.Text>
              <Typography.Text type="secondary">共 {candidates.length} 个，{importableCount} 个可导入</Typography.Text>
            </Space>
            <Table rowKey="key" size="small" pagination={false} scroll={{ y: 280 }} columns={previewColumns} dataSource={candidates} />
          </Space>
        )}
      </Space>
    </Modal>
  )
}

type ConnectionImportResultModalProps = {
  open: boolean
  result: ImportConnectionResult | null
  onClose: () => void
}

export function ConnectionImportResultModal({ open, result, onClose }: ConnectionImportResultModalProps): React.JSX.Element {
  const columns = (messageTitle: string) => [
    { title: '名称', dataIndex: 'name', key: 'name', width: 220, ellipsis: true },
    { title: '类型', dataIndex: 'database_type', key: 'database_type', width: 100, render: (value?: DatabaseType) => value ? DATABASE_TYPE_LABELS[value] : '-' },
    { title: messageTitle, dataIndex: 'message', key: 'message', ellipsis: true, render: (value?: string) => value || '-' }
  ]
  return (
    <Modal title="导入结果" open={open} width={880} className="import-connection-result-modal" onCancel={onClose} footer={<Button type="primary" onClick={onClose}>关闭</Button>} maskClosable={false} {...FAST_MODAL_PROPS}>
      {result && (
        <Space direction="vertical" className="full-width import-connection-result-layout" size={14}>
          <Alert type={result.failed.length > 0 ? 'warning' : 'success'} showIcon message={`成功 ${result.success.length} 个，失败 ${result.failed.length} 个`} />
          {result.success.length > 0 && <Space direction="vertical" className="full-width import-connection-result-section" size={8}><Typography.Text strong>导入成功</Typography.Text><Table rowKey={(record) => `${record.name}-${record.database_type ?? 'unknown'}-success`} size="small" pagination={false} columns={columns('说明')} dataSource={result.success} /></Space>}
          {result.failed.length > 0 && <Space direction="vertical" className="full-width import-connection-result-section import-connection-result-section-danger" size={8}><Typography.Text strong>导入失败</Typography.Text><Table rowKey={(record) => `${record.name}-${record.database_type ?? 'unknown'}-failed`} size="small" pagination={false} columns={columns('失败原因')} dataSource={result.failed} /></Space>}
        </Space>
      )}
    </Modal>
  )
}

type ConnectionPasswordPromptModalProps = {
  open: boolean
  connectionName: string
  reason?: string
  password: string
  onClose: () => void
  onPasswordChange: (password: string) => void
  onRetry: () => void
}

export function ConnectionPasswordPromptModal({ open, connectionName, reason, password, onClose, onPasswordChange, onRetry }: ConnectionPasswordPromptModalProps): React.JSX.Element {
  return (
    <Modal title="输入连接密码" open={open} onCancel={onClose} onOk={onRetry} okText="保存并重新连接" cancelText="取消" maskClosable={false} {...FAST_MODAL_PROPS}>
      <Space direction="vertical" className="full-width" size={12}>
        <Typography.Text><Typography.Text strong>连接：</Typography.Text>{connectionName}</Typography.Text>
        <Alert type="warning" showIcon message={reason || '请输入密码后保存并重新连接'} />
        <Input.Password autoFocus value={password} placeholder="请输入密码" onChange={(event) => onPasswordChange(event.target.value)} onPressEnter={onRetry} />
      </Space>
    </Modal>
  )
}
