import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Flex,
  Input,
  InputNumber,
  Space,
  Table,
  Tabs,
  Tag,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type React from 'react'
import {
  COMMON_TYPES,
  isIntegerLikeType,
  isNumericLikeType,
  tableDesignerSupportsAutoIncrement,
  tableDesignerSupportsAutoIncrementStep,
  tableDesignerSupportsComments,
  tableDesignerSupportsMinMax,
  tableDesignerSupportsUnique,
  type ColumnDef,
  type TableDesignerMode
} from './app-shared'
import type { ConnectionInfo } from './connection-model'

type TableDesignerPanelProps = {
  mode: TableDesignerMode
  connection?: ConnectionInfo
  databaseName?: string
  pgDatabaseName?: string
  tableName: string
  setTableName?: (value: string) => void
  tableComment: string
  setTableComment?: (value: string) => void
  columns: ColumnDef[]
  loading: boolean
  isSchemaScopedType: (databaseType?: ConnectionInfo['database_type']) => boolean
  onUpdateColumn: (key: string, patch: Partial<ColumnDef>) => void
  onAddColumn: () => void
  onRemoveColumn: (key: string) => void
}

export default function TableDesignerPanel({
  mode,
  connection,
  databaseName,
  pgDatabaseName,
  tableName,
  setTableName,
  tableComment,
  setTableComment,
  columns,
  loading,
  isSchemaScopedType,
  onUpdateColumn,
  onAddColumn,
  onRemoveColumn
}: TableDesignerPanelProps): React.ReactNode {
  const isCreateMode = mode === 'create'
  const isMongo = connection?.database_type === 'mongodb'
  const canRename = isCreateMode || connection?.database_type === 'dm'
  const supportsComments = tableDesignerSupportsComments(connection?.database_type)
  const supportsUnique = tableDesignerSupportsUnique(connection?.database_type)
  const supportsAutoIncrement = tableDesignerSupportsAutoIncrement(connection?.database_type)
  const supportsAutoIncrementStep = tableDesignerSupportsAutoIncrementStep(
    connection?.database_type
  )
  const supportsMinMax = tableDesignerSupportsMinMax(connection?.database_type)
  const scopeLabel = isSchemaScopedType(connection?.database_type)
    ? databaseName
      ? `${pgDatabaseName ?? '-'} / ${databaseName}`
      : (pgDatabaseName ?? '-')
    : databaseName || '默认'
  const validColumns = columns.filter((column) => column.name.trim())
  const primaryKeyColumns = validColumns
    .filter((column) => column.primaryKey)
    .map((column) => column.name.trim())
  const typeOptions = COMMON_TYPES.map((type) => ({ label: type, value: type }))
  const canAddRemoveColumns = isCreateMode && !isMongo
  const canUseAutoIncrement = (column: ColumnDef): boolean =>
    supportsAutoIncrement && isIntegerLikeType(column.type)
  const canUseAutoIncrementStep = (column: ColumnDef): boolean =>
    supportsAutoIncrementStep && canUseAutoIncrement(column) && column.autoIncrement
  const canUseMinMax = (column: ColumnDef): boolean =>
    supportsMinMax && isNumericLikeType(column.type)

  const commitColumnPatch = (column: ColumnDef, patch: Partial<ColumnDef>): void => {
    const next: ColumnDef = { ...column, ...patch }
    if (next.primaryKey) {
      next.nullable = false
      next.unique = false
    }
    if (!supportsComments) {
      next.comment = ''
    }
    if (!supportsUnique) {
      next.unique = false
    }
    if (!supportsAutoIncrement || !isIntegerLikeType(next.type)) {
      next.autoIncrement = false
      next.autoIncrementStep = undefined
    }
    if (next.autoIncrement) {
      next.nullable = false
      if (!supportsAutoIncrementStep) {
        next.autoIncrementStep = undefined
      } else if (!next.autoIncrementStep || next.autoIncrementStep < 1) {
        next.autoIncrementStep = 1
      }
    }
    if (!supportsMinMax || !isNumericLikeType(next.type)) {
      next.minimum = ''
      next.maximum = ''
    }
    onUpdateColumn(column.key, next)
  }

  const renderColumnOptions = (column: ColumnDef): React.ReactNode => (
    <div className="table-designer-expanded-card">
      <div className="table-designer-expanded-grid">
        <div className="table-designer-section-card">
          <Flex align="center" justify="space-between" className="table-designer-section-head">
            <Typography.Text strong>字段约束</Typography.Text>
            <Tag color="blue">{column.name.trim() || '未命名字段'}</Tag>
          </Flex>
          <div className="table-designer-option-list">
            <div className="table-designer-option-row">
              <Typography.Text className="table-designer-option-label">设为主键</Typography.Text>
              <Checkbox
                checked={column.primaryKey}
                onChange={(event) =>
                  commitColumnPatch(column, {
                    primaryKey: event.target.checked,
                    nullable: event.target.checked ? false : column.nullable
                  })
                }
              />
            </div>
            <div className="table-designer-option-row">
              <Typography.Text className="table-designer-option-label">不允许为空</Typography.Text>
              <Checkbox
                checked={!column.nullable}
                disabled={column.primaryKey || column.autoIncrement}
                onChange={(event) => commitColumnPatch(column, { nullable: !event.target.checked })}
              />
            </div>
            {supportsUnique && (
              <div className="table-designer-option-row">
                <Typography.Text className="table-designer-option-label">
                  值必须唯一
                </Typography.Text>
                <Checkbox
                  checked={column.unique}
                  disabled={column.primaryKey}
                  onChange={(event) => commitColumnPatch(column, { unique: event.target.checked })}
                />
              </div>
            )}
            {canUseAutoIncrement(column) && (
              <div className="table-designer-option-row">
                <Typography.Text className="table-designer-option-label">自动递增</Typography.Text>
                <Checkbox
                  checked={column.autoIncrement}
                  onChange={(event) =>
                    commitColumnPatch(column, { autoIncrement: event.target.checked })
                  }
                />
              </div>
            )}
          </div>
        </div>
        <div className="table-designer-section-card">
          <Flex align="center" justify="space-between" className="table-designer-section-head">
            <Typography.Text strong>类型规则</Typography.Text>
            <Typography.Text type="secondary">{column.type || '未填写类型'}</Typography.Text>
          </Flex>
          <div className="table-designer-option-list">
            <div className="table-designer-hint-card">
              <Typography.Text type="secondary">
                {canUseAutoIncrement(column)
                  ? '当前字段是整数类型，可设置自增。'
                  : canUseMinMax(column)
                    ? '当前字段是数值类型，可设置最小值和最大值。'
                    : '当前字段按数据库原始类型创建，没有额外数值规则。'}
              </Typography.Text>
            </div>
            {canUseAutoIncrementStep(column) && (
              <div className="table-designer-option-row">
                <Typography.Text className="table-designer-option-label">自增步长</Typography.Text>
                <InputNumber
                  size="small"
                  min={1}
                  className="table-designer-option-control"
                  value={column.autoIncrementStep ?? undefined}
                  onChange={(nextValue) =>
                    commitColumnPatch(column, {
                      autoIncrementStep: typeof nextValue === 'number' ? nextValue : undefined
                    })
                  }
                />
              </div>
            )}
            {canUseMinMax(column) && (
              <>
                <div className="table-designer-option-row">
                  <Typography.Text className="table-designer-option-label">最小值</Typography.Text>
                  <Input
                    size="small"
                    className="table-designer-option-control"
                    value={column.minimum}
                    onChange={(event) => commitColumnPatch(column, { minimum: event.target.value })}
                  />
                </div>
                <div className="table-designer-option-row">
                  <Typography.Text className="table-designer-option-label">最大值</Typography.Text>
                  <Input
                    size="small"
                    className="table-designer-option-control"
                    value={column.maximum}
                    onChange={(event) => commitColumnPatch(column, { maximum: event.target.value })}
                  />
                </div>
              </>
            )}
            {!canUseAutoIncrementStep(column) && !canUseMinMax(column) && (
              <div className="table-designer-option-empty">
                <Typography.Text type="secondary">
                  这个字段类型当前没有更多可设置的数值规则。
                </Typography.Text>
              </div>
            )}
          </div>
        </div>
      </div>
      {canAddRemoveColumns && (
        <Flex justify="end">
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => onRemoveColumn(column.key)}
          >
            删除字段
          </Button>
        </Flex>
      )}
    </div>
  )

  const columnDefs: ColumnsType<ColumnDef> = [
    {
      title: '字段名',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      render: (value: string, column: ColumnDef) => (
        <Input
          size="small"
          value={value}
          placeholder="字段名"
          disabled={!canRename}
          onChange={(event) => commitColumnPatch(column, { name: event.target.value })}
        />
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 260,
      render: (value: string, column: ColumnDef) => (
        <AutoComplete
          value={value}
          options={typeOptions}
          onChange={(nextValue) => commitColumnPatch(column, { type: nextValue })}
          filterOption={(inputValue, option) =>
            String(option?.value ?? '')
              .toLowerCase()
              .includes(inputValue.toLowerCase())
          }
        >
          <Input size="small" placeholder="例如 VARCHAR(100)" />
        </AutoComplete>
      )
    },
    {
      title: '字段注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 300,
      render: (value: string, column: ColumnDef) => (
        <Input
          size="small"
          value={value}
          disabled={!supportsComments}
          placeholder={supportsComments ? '例如：用户昵称、创建时间' : '当前数据库暂不支持字段注释'}
          onChange={(event) => commitColumnPatch(column, { comment: event.target.value })}
        />
      )
    }
  ]

  const tabs = isMongo
    ? []
    : [
        {
          key: 'columns',
          label: '字段',
          children: (
            <Space direction="vertical" className="full-width" size="middle">
              <Flex align="center" justify="space-between" className="table-designer-toolbar">
                <Space size={8}>
                  <Typography.Text strong>字段</Typography.Text>
                  <Tag>{validColumns.length} 列</Tag>
                  {!isCreateMode && (
                    <Typography.Text type="secondary">
                      当前只支持修改已有字段属性，不支持新增、删除或重命名字段。
                    </Typography.Text>
                  )}
                </Space>
                {canAddRemoveColumns && (
                  <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={onAddColumn}>
                    新增字段
                  </Button>
                )}
              </Flex>
              <Table<ColumnDef>
                className="table-designer-grid"
                size="small"
                rowKey="key"
                loading={loading}
                pagination={false}
                tableLayout="fixed"
                scroll={{ x: 860, y: 360 }}
                dataSource={columns}
                columns={columnDefs}
                expandable={{
                  expandedRowRender: (column) => renderColumnOptions(column),
                  rowExpandable: () => true
                }}
                locale={{ emptyText: '暂无字段' }}
              />
            </Space>
          )
        },
        {
          key: 'indexes',
          label: '约束摘要',
          children: (
            <Space direction="vertical" className="full-width" size="middle">
              <Alert
                type="info"
                showIcon
                message="当前先展示主键摘要，索引、外键和其他约束后续再补。"
              />
              <div className="table-designer-index-card">
                <Flex align="center" justify="space-between">
                  <Space size={8}>
                    <Tag color="blue">PRIMARY</Tag>
                    <Typography.Text strong>主键</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary">
                    {primaryKeyColumns.length > 0 ? `${primaryKeyColumns.length} 列` : '未设置'}
                  </Typography.Text>
                </Flex>
                <Typography.Text type="secondary">
                  {primaryKeyColumns.length > 0 ? primaryKeyColumns.join(', ') : '当前没有主键字段'}
                </Typography.Text>
              </div>
            </Space>
          )
        }
      ]

  return (
    <Space direction="vertical" className="full-width" size="middle">
      <div className="table-designer-header">
        <div className="table-designer-header-main">
          <Typography.Text type="secondary">
            {isCreateMode ? '新建结构' : '编辑结构'}
          </Typography.Text>
          <Input
            size="large"
            value={tableName}
            placeholder={isMongo ? '请输入集合名' : '请输入表名'}
            disabled={!canRename}
            onChange={(event) => setTableName?.(event.target.value)}
          />
          {!isMongo && (
            <Input
              value={tableComment}
              placeholder="表注释"
              disabled={!supportsComments}
              onChange={(event) => setTableComment?.(event.target.value)}
            />
          )}
        </div>
        <div className="table-designer-meta">
          <div className="table-designer-meta-card">
            <Typography.Text type="secondary">连接</Typography.Text>
            <Typography.Text strong>{connection?.name ?? '-'}</Typography.Text>
          </div>
          <div className="table-designer-meta-card">
            <Typography.Text type="secondary">
              {isSchemaScopedType(connection?.database_type) ? '数据库 / Schema' : '数据库'}
            </Typography.Text>
            <Typography.Text strong>{scopeLabel}</Typography.Text>
          </div>
          <div className="table-designer-meta-card">
            <Typography.Text type="secondary">类型</Typography.Text>
            <Typography.Text strong>{isMongo ? '集合' : '数据表'}</Typography.Text>
          </div>
        </div>
      </div>
      {tabs.length > 0 ? (
        <Tabs className="table-designer-tabs" items={tabs} />
      ) : (
        <Alert
          type="info"
          showIcon
          message="MongoDB 只需要填写集合名，字段结构会在写入文档后逐步推断。"
        />
      )}
    </Space>
  )
}
