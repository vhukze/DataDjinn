import { LoadingOutlined } from '@ant-design/icons'
import { Button, Flex, Modal, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { type ReactElement, useMemo } from 'react'
import {
  buildDataVersionDiffChangedRows,
  collectDataVersionDiffColumns,
  formatDataVersionIdentity,
  formatDataVersionValue,
  type DataVersionRowChange,
  type TableDataSnapshotDiff
} from './data-versioning-diff'

type DataVersionDiffTab = 'added' | 'deleted' | 'updated'

type DataVersionDiffModalProps = {
  open: boolean
  title: string
  loading: boolean
  diff?: TableDataSnapshotDiff
  tab: DataVersionDiffTab
  onTabChange: (tab: DataVersionDiffTab) => void
  onClose: () => void
}

export const DataVersionDiffModal = ({
  open,
  title,
  loading,
  diff,
  tab,
  onTabChange,
  onClose
}: DataVersionDiffModalProps): ReactElement => {
  const changes = diff ? diff[tab] : []
  const changedRows = useMemo(() => (diff ? buildDataVersionDiffChangedRows(diff.updated) : []), [diff])
  const recordColumns = useMemo<ColumnsType<DataVersionRowChange>>(() => {
    const side = tab === 'deleted' ? 'before' : 'after'
    const columns = diff ? collectDataVersionDiffColumns(changes, diff.identity_columns, side) : []
    return [
      {
        title: '行标识',
        key: 'identity',
        width: 180,
        render: (_value, change) => <ValueCell value={formatDataVersionIdentity(change.identity)} />
      },
      ...columns.map((column) => ({
        title: column,
        key: column,
        render: (_value: unknown, change: DataVersionRowChange) => (
          <ValueCell value={formatDataVersionValue(change[side]?.[column])} />
        )
      }))
    ]
  }, [changes, diff, tab])

  return (
    <Modal
      title={title}
      open={open}
      width={1100}
      className="data-version-diff-modal"
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
      maskClosable={false}
      destroyOnHidden
      centered
      transitionName=""
      maskTransitionName=""
    >
      {loading ? (
        <Flex className="data-version-diff-loading" align="center" justify="center" gap={8}>
          <LoadingOutlined spin />
          <Typography.Text type="secondary">正在比对当前数据与历史快照...</Typography.Text>
        </Flex>
      ) : diff ? (
        <Space direction="vertical" className="full-width" size="middle">
          <Flex className="data-version-diff-summary" justify="space-between" align="center" gap="middle" wrap>
            <Space size={8} wrap>
              <Tag color="green">新增 {diff.added.length}</Tag>
              <Tag color="red">删除 {diff.deleted.length}</Tag>
              <Tag color="gold">修改 {diff.updated.length}</Tag>
            </Space>
            <Typography.Text type="secondary">行标识：{diff.identity_columns.join('、') || '-'}</Typography.Text>
          </Flex>
          <Segmented
            block
            aria-label="选择数据版本差异类型"
            value={tab}
            options={[
              { label: `新增 ${diff.added.length}`, value: 'added' },
              { label: `删除 ${diff.deleted.length}`, value: 'deleted' },
              { label: `修改 ${diff.updated.length}`, value: 'updated' }
            ]}
            onChange={(value) => onTabChange(value as DataVersionDiffTab)}
          />
          {tab === 'updated' ? (
            <Table
              className="data-version-diff-table"
              size="small"
              rowKey="key"
              pagination={false}
              scroll={{ x: 'max-content', y: 460 }}
              dataSource={changedRows}
              columns={[
                { title: '行标识', dataIndex: 'identity', key: 'identity', width: 180, render: (value) => <ValueCell value={formatDataVersionIdentity(value)} /> },
                { title: '字段', dataIndex: 'column', key: 'column', width: 160 },
                { title: '修改前', dataIndex: 'before', key: 'before', render: (value) => <ValueCell value={formatDataVersionValue(value)} /> },
                { title: '修改后', dataIndex: 'after', key: 'after', render: (value) => <ValueCell value={formatDataVersionValue(value)} /> }
              ]}
              locale={{ emptyText: '该历史版本与当前数据没有修改项。' }}
            />
          ) : (
            <Table<DataVersionRowChange>
              className="data-version-diff-table"
              size="small"
              rowKey={(change, index) => `${formatDataVersionIdentity(change.identity)}:${index}`}
              pagination={false}
              scroll={{ x: 'max-content', y: 460 }}
              dataSource={changes}
              columns={recordColumns}
              locale={{ emptyText: tab === 'added' ? '该历史版本与当前数据没有新增行。' : '该历史版本与当前数据没有删除行。' }}
            />
          )}
        </Space>
      ) : null}
    </Modal>
  )
}

const ValueCell = ({ value }: { value: string }): ReactElement => (
  <span className="data-version-diff-cell" title={value}>
    {value}
  </span>
)
