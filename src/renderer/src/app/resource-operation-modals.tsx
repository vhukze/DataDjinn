import { Alert, Form, Input, Modal, Space, Typography } from 'antd'
import type { InputRef } from 'antd'
import type { ReactNode, RefObject } from 'react'
import { FAST_MODAL_PROPS } from './app-runtime-support'

type FolderEditorModalProps = {
  open: boolean
  mode: 'create' | 'rename'
  name: string
  inputRef: RefObject<InputRef | null>
  onNameChange: (name: string) => void
  onSave: () => void
  onCancel: () => void
}

export function FolderEditorModal({ open, mode, name, inputRef, onNameChange, onSave, onCancel }: FolderEditorModalProps): React.JSX.Element {
  return (
    <Modal
      title={mode === 'rename' ? '重命名分组' : '新建分组'}
      open={open}
      className="folder-editor-modal"
      okText={mode === 'rename' ? '保存' : '创建'}
      cancelText="取消"
      onOk={onSave}
      onCancel={onCancel}
      okButtonProps={{ disabled: !name.trim() }}
      maskClosable={false}
      afterOpenChange={(nextOpen) => nextOpen && window.requestAnimationFrame(() => inputRef.current?.focus())}
      {...FAST_MODAL_PROPS}
    >
      <Form layout="vertical" className="folder-editor-form">
        <Form.Item label="分组名称" required>
          <Input ref={inputRef} value={name} placeholder="例如：生产环境 / 测试环境 / 客户项目" onChange={(event) => onNameChange(event.target.value)} onPressEnter={(event) => { event.preventDefault(); onSave() }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

type BackupModalProps = {
  open: boolean
  loading: boolean
  connectionName?: string
  databaseName?: string
  onRun: () => void
  onClose: () => void
}

export function BackupModal({ open, loading, connectionName, databaseName, onRun, onClose }: BackupModalProps): React.JSX.Element {
  return (
    <Modal title="备份" open={open} okText="选择路径并备份" cancelText="取消" confirmLoading={loading} onOk={onRun} onCancel={onClose} maskClosable={false} {...FAST_MODAL_PROPS}>
      <Space direction="vertical" className="full-width">
        <Typography.Text><Typography.Text strong>连接：</Typography.Text>{connectionName}</Typography.Text>
        <Typography.Text><Typography.Text strong>数据库：</Typography.Text>{databaseName || '默认'}</Typography.Text>
        <Alert type="info" message="备份会生成 SQL 脚本，包含建表语句和数据，可随时通过导入功能恢复。" showIcon />
      </Space>
    </Modal>
  )
}

type CreateTableModalProps = {
  open: boolean
  title: string
  loading: boolean
  disabled: boolean
  children: ReactNode
  onCreate: () => void
  onClose: () => void
}

export function CreateTableModal({ open, title, loading, disabled, children, onCreate, onClose }: CreateTableModalProps): React.JSX.Element {
  return <Modal title={title} open={open} okText="创建" cancelText="取消" confirmLoading={loading} onOk={onCreate} onCancel={onClose} width={980} okButtonProps={{ disabled }} maskClosable={false} {...FAST_MODAL_PROPS}>{children}</Modal>
}
