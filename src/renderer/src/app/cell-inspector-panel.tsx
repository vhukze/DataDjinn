import { CloseOutlined } from '@ant-design/icons'
import { Button, Flex, Input, Typography } from 'antd'
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

type EditableRowLike = Record<string, unknown> & {
  __rowKey: string
}

type DefaultValueMarker = {
  __datadjinn_action__: 'default'
}

const isDefaultValueMarker = (value: unknown): value is DefaultValueMarker =>
  value !== null &&
  typeof value === 'object' &&
  '__datadjinn_action__' in value &&
  (value as DefaultValueMarker).__datadjinn_action__ === 'default'

const tryFormatJsonText = (value: unknown): string | null => {
  if (value === null || value === undefined || isDefaultValueMarker(value)) {
    return null
  }
  const raw = typeof value === 'string' ? value.trim() : JSON.stringify(value)
  if (!raw) {
    return null
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return null
  }
}

export type CellInspectorPanelHandle = {
  open: (view: 'record' | 'value' | 'aggregate', selection: string[]) => void
  close: () => void
  setSelection: (selection: string[]) => void
}

const CellInspectorPanel = memo(
  forwardRef<
    CellInspectorPanelHandle,
    {
      tabKey: string
      orderedColumns: string[]
      rowByKey: Map<string, EditableRowLike>
      columnInfoMap?: Record<string, { type: string }>
      editable: boolean
      onUpdateValue: (rowKey: string, column: string, rawValue: string) => void
    }
  >(function CellInspectorPanel(
    { tabKey, orderedColumns, rowByKey, columnInfoMap, editable, onUpdateValue },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [view, setView] = useState<'record' | 'value' | 'aggregate'>('record')
    const [selection, setSelection] = useState<string[]>([])
    const [valueDisplayMode, setValueDisplayMode] = useState<'raw' | 'json'>('raw')
    const openRef = useRef(open)

    useEffect(() => {
      openRef.current = open
    }, [open])

    useImperativeHandle(
      ref,
      () => ({
        open: (nextView, nextSelection) => {
          setSelection((current) =>
            current.length === nextSelection.length &&
            current.every((item, index) => item === nextSelection[index])
              ? current
              : [...nextSelection]
          )
          setView(nextView)
          setOpen(true)
        },
        close: () => {
          setOpen(false)
        },
        setSelection: (nextSelection) => {
          if (!openRef.current) {
            return
          }
          setSelection((current) =>
            current.length === nextSelection.length &&
            current.every((item, index) => item === nextSelection[index])
              ? current
              : [...nextSelection]
          )
        }
      }),
      []
    )

    const orderedRowKeys = useMemo(() => Array.from(rowByKey.keys()), [rowByKey])
    const orderedRowKeysByLength = useMemo(
      () => [...orderedRowKeys].sort((left, right) => right.length - left.length),
      [orderedRowKeys]
    )
    const orderedColumnIndexMap = useMemo(
      () => Object.fromEntries(orderedColumns.map((column, index) => [column, index] as const)),
      [orderedColumns]
    )

    const bounds = useMemo(() => {
      const parseCellKey = (cellKey: string): { rowKey: string; column: string } | null => {
        for (const rowKey of orderedRowKeysByLength) {
          const prefix = `${rowKey}:`
          if (cellKey.startsWith(prefix)) {
            return { rowKey, column: cellKey.slice(prefix.length) }
          }
        }
        return null
      }

      const entries = selection
        .map((cellKey) => {
          const parsed = parseCellKey(cellKey)
          if (!parsed) {
            return null
          }
          const rowIndex = orderedRowKeys.indexOf(parsed.rowKey)
          const columnIndex = orderedColumnIndexMap[parsed.column]
          if (rowIndex < 0 || columnIndex === undefined) {
            return null
          }
          return {
            rowKey: parsed.rowKey,
            column: parsed.column,
            rowIndex,
            columnIndex
          }
        })
        .filter(
          (
            entry
          ): entry is {
            rowKey: string
            column: string
            rowIndex: number
            columnIndex: number
          } => entry !== null
        )

      if (entries.length === 0) {
        return null
      }

      const rowIndexes = entries.map((entry) => entry.rowIndex)
      const columnIndexes = entries.map((entry) => entry.columnIndex)
      const rowStart = Math.min(...rowIndexes)
      const rowEnd = Math.max(...rowIndexes)
      const columnStart = Math.min(...columnIndexes)
      const columnEnd = Math.max(...columnIndexes)

      return {
        rowKeys: orderedRowKeys.slice(rowStart, rowEnd + 1),
        columns: orderedColumns.slice(columnStart, columnEnd + 1)
      }
    }, [orderedColumnIndexMap, orderedColumns, orderedRowKeys, orderedRowKeysByLength, selection])

    const columnTypeOf = (column: string): string | undefined =>
      columnInfoMap?.[column]?.type ?? undefined
    const anchorSelection = useMemo(() => {
      if (!bounds) {
        return null
      }
      const rowKey = bounds.rowKeys[0]
      const column = bounds.columns[0]
      return {
        rowKey,
        column,
        value: rowByKey.get(rowKey)?.[column]
      }
    }, [bounds, rowByKey])
    const formattedJsonValue = useMemo(
      () => tryFormatJsonText(anchorSelection?.value),
      [anchorSelection?.value]
    )

    useEffect(() => {
      setValueDisplayMode('raw')
    }, [anchorSelection?.rowKey, anchorSelection?.column, anchorSelection?.value])

    const renderRecordView = (): React.ReactNode => {
      if (!bounds) {
        return (
          <div className="cell-inspector-empty">
            <Typography.Text type="secondary">请选择单元格后查看记录</Typography.Text>
          </div>
        )
      }
      return (
        <div className="cell-inspector-records">
          {bounds.rowKeys.map((rowKey) => {
            const row = rowByKey.get(rowKey)
            return (
              <div className="cell-inspector-record" key={rowKey}>
                {orderedColumns.map((column) => (
                  <div className="cell-inspector-field" key={column}>
                    <div className="cell-inspector-field-label">
                      <Typography.Text type="secondary" ellipsis title={column}>
                        {column}
                      </Typography.Text>
                      {columnTypeOf(column) && (
                        <span className="cell-inspector-field-type">{columnTypeOf(column)}</span>
                      )}
                    </div>
                    <Input.TextArea
                      className="cell-inspector-field-value"
                      readOnly={!editable}
                      rows={3}
                      value={
                        row?.[column] === null ||
                        row?.[column] === undefined ||
                        isDefaultValueMarker(row?.[column])
                          ? ''
                          : String(row?.[column])
                      }
                      placeholder={
                        row?.[column] === null || row?.[column] === undefined
                          ? 'NULL'
                          : isDefaultValueMarker(row?.[column])
                            ? 'DEFAULT'
                            : undefined
                      }
                      onChange={(event) => {
                        if (!editable) {
                          return
                        }
                        onUpdateValue(rowKey, column, event.currentTarget.value)
                      }}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )
    }

    const renderValueView = (): React.ReactNode => {
      if (!bounds || !anchorSelection) {
        return (
          <div className="cell-inspector-empty">
            <Typography.Text type="secondary">请选择单元格后查看值</Typography.Text>
          </div>
        )
      }
      const anchorRowKey = anchorSelection.rowKey
      const anchorColumn = anchorSelection.column
      const anchorValue = anchorSelection.value
      const readonlyJsonMode = valueDisplayMode === 'json' && Boolean(formattedJsonValue)
      return (
        <div className="cell-inspector-value-wrap">
          <Flex
            align="center"
            justify="space-between"
            gap={8}
            className="cell-inspector-value-toolbar"
          >
            <Typography.Text type="secondary" className="cell-inspector-value-meta">
              {anchorColumn}
              {columnTypeOf(anchorColumn) ? ` · ${columnTypeOf(anchorColumn)}` : ''}
            </Typography.Text>
            {formattedJsonValue && (
              <Button
                type="text"
                size="small"
                onClick={() =>
                  setValueDisplayMode((current) => (current === 'json' ? 'raw' : 'json'))
                }
              >
                {readonlyJsonMode ? '原始编辑' : 'JSON 格式化'}
              </Button>
            )}
          </Flex>
          <Input.TextArea
            className="cell-inspector-value-area"
            readOnly={!editable || readonlyJsonMode}
            value={
              readonlyJsonMode
                ? (formattedJsonValue ?? '')
                : anchorValue === null ||
                    anchorValue === undefined ||
                    isDefaultValueMarker(anchorValue)
                  ? ''
                  : String(anchorValue)
            }
            placeholder={
              anchorValue === null || anchorValue === undefined
                ? 'NULL'
                : isDefaultValueMarker(anchorValue)
                  ? 'DEFAULT'
                  : undefined
            }
            onChange={(event) => {
              if (!editable || readonlyJsonMode) {
                return
              }
              onUpdateValue(anchorRowKey, anchorColumn, event.currentTarget.value)
            }}
          />
        </div>
      )
    }

    const renderAggregateView = (): React.ReactNode => {
      if (!bounds) {
        return (
          <div className="cell-inspector-empty">
            <Typography.Text type="secondary">请选择单元格后查看聚合</Typography.Text>
          </div>
        )
      }
      const flatValues = bounds.rowKeys.flatMap((rowKey) =>
        bounds.columns.map((column) => rowByKey.get(rowKey)?.[column])
      )
      const nonEmpty = flatValues.filter(
        (value) => value !== null && value !== undefined && !isDefaultValueMarker(value)
      )
      const numbers = nonEmpty
        .map((value) => (typeof value === 'number' ? value : Number(String(value))))
        .filter((value) => Number.isFinite(value)) as number[]
      const rowsCount = bounds.rowKeys.length
      const colsCount = bounds.columns.length
      const formatNumber = (value: number): string =>
        Number.isFinite(value) ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : '-'
      const stats: Array<{ order: number; label: string; value: string }> = [
        { order: 1, label: '非空值数量', value: String(nonEmpty.length) },
        { order: 2, label: '数值数量', value: String(numbers.length) },
        { order: 3, label: '选中行数', value: String(rowsCount) },
        { order: 4, label: '选中列数', value: String(colsCount) }
      ]
      if (numbers.length > 0) {
        const sum = numbers.reduce((total, value) => total + value, 0)
        const avg = sum / numbers.length
        const sorted = [...numbers].sort((left, right) => left - right)
        const middle = Math.floor(sorted.length / 2)
        const median =
          sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
        stats.push(
          { order: 5, label: '求和', value: formatNumber(sum) },
          { order: 6, label: '平均值', value: formatNumber(avg) },
          { order: 7, label: '最小值', value: formatNumber(sorted[0]) },
          { order: 8, label: '最大值', value: formatNumber(sorted[sorted.length - 1]) },
          { order: 9, label: '中位数', value: formatNumber(median) }
        )
      }
      return (
        <div className="cell-inspector-aggregate">
          {stats
            .sort((left, right) => left.order - right.order)
            .map((stat) => (
              <div className="cell-inspector-aggregate-row" key={stat.label}>
                <span className="cell-inspector-aggregate-label" title={stat.label}>
                  {stat.label}
                </span>
                <span className="cell-inspector-aggregate-value">{stat.value}</span>
              </div>
            ))}
        </div>
      )
    }

    return (
      <div className={`cell-inspector${open ? ' is-open' : ''}`} data-tab-key={tabKey}>
        <div className="cell-inspector-header">
          <div className="cell-inspector-tabs">
            <button
              type="button"
              className={`cell-inspector-tab${view === 'record' ? ' active' : ''}`}
              onClick={() => setView('record')}
            >
              记录
            </button>
            <button
              type="button"
              className={`cell-inspector-tab${view === 'value' ? ' active' : ''}`}
              onClick={() => setView('value')}
            >
              值
            </button>
            <button
              type="button"
              className={`cell-inspector-tab${view === 'aggregate' ? ' active' : ''}`}
              onClick={() => setView('aggregate')}
            >
              聚合
            </button>
          </div>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => setOpen(false)}
            aria-label="关闭"
          />
        </div>
        <div className="cell-inspector-body">
          {view === 'record'
            ? renderRecordView()
            : view === 'value'
              ? renderValueView()
              : renderAggregateView()}
        </div>
      </div>
    )
  }),
  (prev, next) =>
    prev.tabKey === next.tabKey &&
    prev.orderedColumns === next.orderedColumns &&
    prev.rowByKey === next.rowByKey &&
    prev.columnInfoMap === next.columnInfoMap &&
    prev.editable === next.editable &&
    prev.onUpdateValue === next.onUpdateValue
)

export default CellInspectorPanel
