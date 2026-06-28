import { Button, Flex, Space, Typography } from 'antd'
import { memo } from 'react'

const normalizeShortcutText = (shortcut?: string): string => shortcut?.replace(/\s+/g, '').toLowerCase() ?? ''

const formatShortcutFromEvent = (event: React.KeyboardEvent<HTMLElement>): string => {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) {
    parts.push('Ctrl')
  }
  if (event.altKey) {
    parts.push('Alt')
  }
  if (event.shiftKey) {
    parts.push('Shift')
  }

  let key = event.key
  if (key === ' ') {
    key = 'Space'
  } else if (key.length === 1) {
    key = key.toUpperCase()
  }

  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key)
  }

  return parts.join('+')
}

const isModifierOnlyKey = (key: string): boolean => ['Control', 'Shift', 'Alt', 'Meta'].includes(key)

const ShortcutRecorder = memo(function ShortcutRecorder({
  label,
  value,
  defaultValue,
  recording,
  onStartRecord,
  onChange,
  onCancel,
  onReset
}: {
  label: string
  value: string
  defaultValue: string
  recording: boolean
  onStartRecord: () => void
  onChange: (value: string) => void
  onCancel: () => void
  onReset: () => void
}) {
  return (
    <Flex align="center" justify="space-between" gap={12} className="shortcut-setting-item">
      <Space direction="vertical" size={2} className="shortcut-setting-meta">
        <Typography.Text strong>{label}</Typography.Text>
        <Typography.Text type="secondary">默认：{defaultValue}</Typography.Text>
      </Space>
      <Space size={8}>
        <button
          type="button"
          className={`shortcut-capture-button${recording ? ' is-recording' : ''}`}
          onClick={() => {
            if (!recording) {
              onStartRecord()
            }
          }}
          onKeyDown={(event) => {
            if (!recording) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape') {
              onCancel()
              return
            }
            if (isModifierOnlyKey(event.key)) {
              return
            }
            const nextShortcut = formatShortcutFromEvent(event)
            if (normalizeShortcutText(nextShortcut)) {
              onChange(nextShortcut)
            }
          }}
        >
          {recording ? '请按快捷键' : value || '未设置'}
        </button>
        <Button size="small" onClick={recording ? onCancel : onStartRecord}>
          {recording ? '取消' : '修改'}
        </Button>
        <Button size="small" onClick={onReset}>恢复默认</Button>
      </Space>
    </Flex>
  )
})

export default ShortcutRecorder
