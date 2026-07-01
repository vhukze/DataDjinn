import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CloseOutlined, DatabaseOutlined, DeleteOutlined, DownOutlined, ExclamationCircleOutlined, LoadingOutlined, PlusOutlined, RightOutlined, SendOutlined, SettingOutlined, StopOutlined, ToolOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Collapse, Dropdown, Flex, Form, Input, InputNumber, List, Modal, Progress, Select, Space, Steps, Switch, Tag, Typography, message } from 'antd'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'

export type AIConfig = {
  provider?: 'openai-compatible' | 'anthropic'
  base_url: string
  api_key: string
  model: string
  max_context_tokens?: number
}

type AIConfigItem = AIConfig & {
  id: string
  name: string
  enabled: boolean
}

export type AIConnectionContext = {
  connectionId?: string
  dbType?: string
  dbName?: string
  database?: string
  pgDatabase?: string
  connectionName?: string
  serverVersion?: string | null
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  segments?: ChatMessageSegment[]
  toolCalls?: ToolCallView[]
  plan?: AgentPlanView
  steps?: AgentStepView[]
  confirmation?: AgentConfirmationView
  thinking?: {
    summary: string
    content: string
    preview?: string
    expanded?: boolean
    done?: boolean
  }
}

type ChatMessageSegment = {
  id: string
  type: 'thinking' | 'content' | 'tool'
  content: string
  summary?: string
  preview?: string
  expanded?: boolean
  done?: boolean
  toolCallId?: string
}

type AISession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  compactedAt?: number
  compressedSummary?: string
}

type AIContextStats = {
  used_tokens: number
  max_tokens: number
  usage_ratio: number
}

type ToolCallView = {
  id: string
  name: string
  status: 'running' | 'waiting_confirm' | 'completed' | 'failed'
  arguments?: unknown
  result?: unknown
}

type AgentStepView = {
  id: string
  title: string
  description?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  risk_level?: 'safe' | 'review' | 'dangerous'
  result?: unknown
}

type AgentPlanView = {
  goal: string
  summary: string
  steps: AgentStepView[]
  requires_confirmation?: boolean
  risk_level?: 'safe' | 'review' | 'dangerous'
}

type AgentConfirmationView = {
  id: string
  title: string
  risk_level: 'review' | 'dangerous'
  sql?: string
  explanation: string
  estimated_impact?: unknown
}

export type AIContextSource = {
  id: string
  type: 'database' | 'schema'
  connectionId: string
  connectionName: string
  dbType: string
  database?: string
  schema?: string
  pgDatabase?: string
  sizeDisplay?: string | null
  sizeBytes?: number | null
  storageSizeDisplay?: string | null
  storageSizeBytes?: number | null
}

type AgentConnectionSummary = {
  connectionId: string
  name: string
  dbType: string
  database?: string
  isOpen: boolean
  serverVersion?: string | null
}

type AgentFocusedResource = {
  kind: string
  connectionId?: string
  connectionName?: string
  dbType?: string
  database?: string
  schema?: string
  pgDatabase?: string
  table?: string
  objectType?: string
  name?: string
  sizeDisplay?: string | null
  rowCount?: number | null
}

type AgentWorkspaceAction = {
  type: 'append_query_sql'
  sql: string
  title?: string
}

type AgentWorkspace = {
  active_sql?: string
  active_tab_kind?: string
  selected_table?: string
  current_connection_name?: string
  current_db_type?: string
  current_server_version?: string | null
  current_database?: string
  current_pg_database?: string
  focused_resource?: AgentFocusedResource
  connections?: AgentConnectionSummary[]
  recent_queries?: string[]
  visible_result_columns?: string[]
  visible_result_sample?: Record<string, unknown>[]
  context_sources?: AIContextSource[]
}

type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'plan'; plan: AgentPlanView }
  | { type: 'step_start'; step_id: string }
  | { type: 'step_result'; step_id: string; result: unknown }
  | { type: 'confirmation_required'; confirmation: AgentConfirmationView }
  | { type: 'tool_start'; tool_call_id: string; name: string; arguments: unknown }
  | { type: 'tool_result'; tool_call_id: string; name: string; result: unknown }
  | { type: 'workspace_action'; action: AgentWorkspaceAction }
  | { type: 'tool_done' }
  | { type: 'done'; finish_reason: string }
  | { type: 'error'; message: string }

type QueuedStreamUpdate = {
  assistantId: string
  event: StreamEvent
}

interface AIPanelProps {
  requestJson: <T>(path: string, options?: RequestInit) => Promise<T>
  hasDatabaseContext: boolean
  getConnectionContext?: () => AIConnectionContext | undefined
  getWorkspaceSnapshot?: () => AgentWorkspace | undefined
  contextSources?: AIContextSource[]
  primaryContextSourceId?: string
  onRemoveContextSource?: (sourceId: string) => void
  onWorkspaceAction?: (action: AgentWorkspaceAction) => void
  onAgentDataChanged?: () => void
  shortcuts?: {
    send?: string
    newline?: string
    stop?: string
  }
}

const createAIConfigItem = (config?: Partial<AIConfigItem>): AIConfigItem => ({
  id: config?.id ?? crypto.randomUUID(),
  name: config?.name ?? 'AI 配置',
  enabled: config?.enabled ?? false,
  provider: config?.provider ?? 'openai-compatible',
  base_url: config?.base_url ?? '',
  api_key: config?.api_key ?? '',
  model: config?.model ?? '',
  max_context_tokens: typeof config?.max_context_tokens === 'number' && Number.isFinite(config.max_context_tokens) && config.max_context_tokens > 0
    ? Math.round(config.max_context_tokens)
    : undefined
})

const activeAIConfig = (configs: AIConfigItem[]): AIConfig | null => {
  const active = configs.find((item) => item.enabled)
  if (!active || !active.base_url || !active.api_key || !active.model || !active.max_context_tokens) {
    return null
  }

  return {
    provider: active.provider ?? 'openai-compatible',
    base_url: active.base_url,
    api_key: active.api_key,
    model: active.model,
    max_context_tokens: active.max_context_tokens
  }
}

const AUTO_COMPACT_USAGE_RATIO = 0.8
const MIN_MESSAGES_TO_COMPACT = 6
const STREAM_EVENTS_PER_FRAME = 1

const normalizeShortcut = (shortcut?: string): string => shortcut?.replace(/\s+/g, '').toLowerCase() ?? ''

const buildShortcutFromKeyboardEvent = (event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string }): string => {
  const normalizedKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  return [
    event.ctrlKey || event.metaKey ? 'ctrl' : '',
    event.altKey ? 'alt' : '',
    event.shiftKey ? 'shift' : '',
    normalizedKey
  ].filter(Boolean).join('+')
}

const formatTokenK = (value: number): string => {
  if (value >= 1000) {
    const scaled = value / 1000
    if (scaled >= 1000) {
      const mega = scaled / 1000
      return `${mega >= 100 ? mega.toFixed(0) : mega >= 10 ? mega.toFixed(1) : mega.toFixed(2)}M`
    }
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}k`
  }
  return String(value)
}

const isStreamingTextEvent = (event: StreamEvent): boolean => event.type === 'token' || event.type === 'reasoning'

const isDraftSession = (session: AISession): boolean => session.messages.length === 0

const sanitizeThinkingForPersistence = (thinking: ChatMessage['thinking']): ChatMessage['thinking'] => {
  if (!thinking) {
    return undefined
  }

  const content = thinking.content ?? ''
  const preview = (thinking.preview || thinking.summary || content).replace(/\s+/g, ' ').trim()

  return {
    ...thinking,
    preview: preview || thinking.summary,
    expanded: false,
    done: true
  }
}

const sanitizeSegmentForPersistence = (segment: ChatMessageSegment): ChatMessageSegment | null => {
  if (segment.type === 'content') {
    return segment.content ? segment : null
  }

  if (segment.type === 'thinking') {
    const content = segment.content ?? ''
    const preview = (segment.preview || segment.summary || content).replace(/\s+/g, ' ').trim()
    if (!content.trim() && !preview) {
      return null
    }
    return {
      ...segment,
      preview: preview || segment.summary,
      expanded: false,
      done: true
    }
  }

  return {
    ...segment,
    expanded: false,
    done: true,
    preview: segment.preview || segment.summary || segment.content
  }
}

const sanitizeToolCallForPersistence = (tool: ToolCallView): ToolCallView => ({
  ...tool,
  status: tool.status === 'running'
    ? (tool.result !== undefined ? toolResultStatus(tool.result) : 'completed')
    : tool.status
})

const sanitizeMessageForPersistence = (message: ChatMessage): ChatMessage | null => {
  const normalizedContent = message.content.trim()
  const segments = (message.segments ?? [])
    .map(sanitizeSegmentForPersistence)
    .filter((segment): segment is ChatMessageSegment => Boolean(segment))
  const nonContentSegments = segments.filter((segment) => segment.type !== 'content')
  if (normalizedContent) {
    nonContentSegments.push({
      id: crypto.randomUUID(),
      type: 'content',
      content: message.content
    })
  }
  const toolCalls = (message.toolCalls ?? []).map(sanitizeToolCallForPersistence)
  const thinking = sanitizeThinkingForPersistence(message.thinking)
  const hasVisibleContent = Boolean(
    normalizedContent
    || nonContentSegments.length > 0
    || toolCalls.length > 0
    || thinking?.content?.trim()
    || message.plan
    || message.confirmation
  )

  if (message.role === 'assistant' && !hasVisibleContent) {
    return null
  }

  return {
    ...message,
    segments: nonContentSegments.length > 0 ? nonContentSegments : undefined,
    toolCalls,
    thinking
  }
}

const sanitizeSessionForPersistence = (session: AISession): AISession => ({
  ...session,
  messages: session.messages
    .map(sanitizeMessageForPersistence)
    .filter((message): message is ChatMessage => Boolean(message))
})

const normalizeSessions = (sessions: AISession[]): AISession[] => {
  let hasDraft = false
  return sessions.filter((session) => {
    if (!isDraftSession(session)) {
      return true
    }
    if (hasDraft) {
      return false
    }
    hasDraft = true
    return true
  })
}

const normalizePersistedSessions = (sessions: AISession[]): AISession[] =>
  normalizeSessions(sessions.map(sanitizeSessionForPersistence))

const persistedSessions = (sessions: AISession[]): AISession[] =>
  normalizePersistedSessions(sessions).filter((session) => session.messages.length > 0)

const createSession = (): AISession => {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}

const sessionTitle = (content: string): string => content.replace(/\s+/g, ' ').slice(0, 24) || '新会话'

const contextSourceTitle = (source: AIContextSource): string => {
  if (source.type === 'schema') {
    return [source.database ?? source.pgDatabase, source.schema].filter(Boolean).join('.')
  }

  return source.database ?? source.pgDatabase ?? source.connectionName
}

const contextSourceTypeLabel: Record<AIContextSource['type'], string> = {
  database: '库',
  schema: '模式'
}

const isToolResultWaitingConfirm = (result: unknown): boolean => {
  if (!result || typeof result !== 'object') {
    return false
  }

  const record = result as Record<string, unknown>
  return record.confirmation_required === true
}

const toolResultStatus = (result: unknown): ToolCallView['status'] => {
  if (isToolResultWaitingConfirm(result)) {
    return 'waiting_confirm'
  }
  if (!result || typeof result !== 'object') {
    return 'completed'
  }

  const record = result as Record<string, unknown>
  return record.error || record.success === false ? 'failed' : 'completed'
}

const applySendButtonMagnet = (button: HTMLButtonElement | null, clientX: number, clientY: number): void => {
  if (!button) {
    return
  }
  const rect = button.getBoundingClientRect()
  const offsetX = clientX - rect.left - rect.width / 2
  const offsetY = clientY - rect.top - rect.height / 2
  button.style.setProperty('--dj-send-offset-x', `${Math.max(-6, Math.min(6, offsetX * 0.16))}px`)
  button.style.setProperty('--dj-send-offset-y', `${Math.max(-6, Math.min(6, offsetY * 0.16))}px`)
}

const resetSendButtonMagnet = (button: HTMLButtonElement | null): void => {
  if (!button) {
    return
  }
  button.style.setProperty('--dj-send-offset-x', '0px')
  button.style.setProperty('--dj-send-offset-y', '0px')
}

const isMutatingToolResult = (name: string | undefined, result: unknown): boolean => {
  if (!name || !['execute_query', 'restore_database_backup'].includes(name) || !result || typeof result !== 'object') {
    return false
  }

  const record = result as Record<string, unknown>
  return record.readonly !== true
}

const parseSseLines = (buffer: string): { events: StreamEvent[]; rest: string } => {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  const events = parts
    .map((part) => part.split('\n').find((line) => line.startsWith('data: '))?.slice(6))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line) as StreamEvent)
  return { events, rest }
}

export default function AIPanel({ requestJson, hasDatabaseContext, getConnectionContext, getWorkspaceSnapshot, contextSources = [], primaryContextSourceId, onRemoveContextSource, onWorkspaceAction, onAgentDataChanged, shortcuts }: AIPanelProps): React.JSX.Element {
  const [messageApi, contextHolder] = message.useMessage()
  const showError = (error: unknown, fallback = '操作失败'): void => {
    const content = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
    Modal.error({
      title: '操作失败',
      centered: true,
      okText: '确认',
      width: 720,
      content: (
        <Space direction="vertical" className="full-width">
          <Input.TextArea value={content} autoSize={{ minRows: 4, maxRows: 12 }} readOnly />
        </Space>
      )
    })
  }
  const [configs, setConfigs] = useState<AIConfigItem[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sessions, setSessions] = useState<AISession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [selectedConfigId, setSelectedConfigId] = useState<string>('')
  const [contextStats, setContextStats] = useState<AIContextStats | null>(null)
  const streamIdRef = useRef<string | null>(null)
  const sendButtonRef = useRef<HTMLButtonElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const persistTimerRef = useRef<number | null>(null)
  const queuedStreamEventsRef = useRef<QueuedStreamUpdate[]>([])
  const streamFlushFrameRef = useRef<number | null>(null)
  const suppressAutoScrollRef = useRef(false)
  const autoCompactRunningRef = useRef(false)
  const contextStatsRequestKeyRef = useRef('')
  const getConnectionContextRef = useRef(getConnectionContext)
  const getWorkspaceSnapshotRef = useRef(getWorkspaceSnapshot)

  getConnectionContextRef.current = getConnectionContext
  getWorkspaceSnapshotRef.current = getWorkspaceSnapshot

  const readConnectionContext = (): AIConnectionContext => getConnectionContextRef.current?.() ?? {}

  const activeConfigItem = useMemo(() => {
    if (selectedConfigId) {
      return configs.find((item) => item.id === selectedConfigId) ?? configs.find((item) => item.enabled)
    }
    return configs.find((item) => item.enabled)
  }, [configs, selectedConfigId])
  const config = activeConfigItem && activeConfigItem.base_url && activeConfigItem.api_key && activeConfigItem.model && activeConfigItem.max_context_tokens
    ? {
        provider: activeConfigItem.provider ?? 'openai-compatible',
        base_url: activeConfigItem.base_url,
        api_key: activeConfigItem.api_key,
        model: activeConfigItem.model,
        max_context_tokens: activeConfigItem.max_context_tokens
      }
    : null
  const ready = Boolean(config)
  const canChat = ready
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const messages = activeSession?.messages ?? []
  const effectiveContextStats = contextStats

  const apiMessages = useMemo(
    () => messages.map((item) => ({ role: item.role, content: item.content })),
    [messages]
  )
  const buildConversationMessages = (session?: AISession): Array<{ role: string; content: string }> => {
    if (!session) {
      return []
    }
    const nextMessages = session.messages.map((item) => ({ role: item.role, content: item.content }))
    if (session.compressedSummary) {
      nextMessages.unshift({
        role: 'assistant',
        content: `以下是当前会话已压缩的上下文摘要：\n\n${session.compressedSummary}`
      })
    }
    return nextMessages
  }
  const maxContextTokens = effectiveContextStats?.max_tokens ?? config?.max_context_tokens ?? 0
  const contextUsagePercent = maxContextTokens > 0 ? Math.round(((effectiveContextStats?.used_tokens ?? 0) / maxContextTokens) * 100) : 0
  const contextProgressPercent = contextUsagePercent > 0 ? Math.max(contextUsagePercent, 4) : 0
  const contextLevel = contextUsagePercent >= 80 ? 'full' : contextUsagePercent >= 60 ? 'warning' : 'ok'

  useEffect(() => {
    void Promise.all([window.api.getAIConfigs(), window.api.getAIConfig()]).then(([storedConfigs, legacyConfig]) => {
      const nextConfigs = storedConfigs.length > 0
        ? storedConfigs.map((item) => createAIConfigItem(item))
        : legacyConfig
          ? [createAIConfigItem({ ...legacyConfig, name: legacyConfig.model || '默认 AI', enabled: true })]
          : []
      setConfigs(nextConfigs)
      if (storedConfigs.length === 0 && nextConfigs.length > 0) {
        void window.api.setAIConfigs(nextConfigs)
      }
      const initialActive = nextConfigs.find((item) => item.enabled) ?? nextConfigs[0]
      setSelectedConfigId(initialActive?.id ?? '')
    })
    void window.api.getAISessions().then((stored) => {
      const restoredSessions = normalizePersistedSessions(stored as AISession[])
      const restored = restoredSessions.length > 0 ? restoredSessions : [createSession()]
      setSessions(restored)
      setActiveSessionId(restored[0].id)
    })
  }, [])

  useEffect(() => {
    if (!activeConfigItem && configs.length > 0) {
      setSelectedConfigId(configs[0].id)
    }
  }, [activeConfigItem, configs])

  useEffect(() => {
    if (!config) {
      contextStatsRequestKeyRef.current = ''
      setContextStats(null)
      return
    }
    if (!config.max_context_tokens || config.max_context_tokens <= 0) {
      contextStatsRequestKeyRef.current = ''
      setContextStats(null)
      return
    }
    const sessionMessages = buildConversationMessages(activeSession)
    const workspace = getWorkspaceSnapshotRef.current?.()
    const requestKey = JSON.stringify({
      messages: sessionMessages,
      config,
      workspace
    })
    if (contextStatsRequestKeyRef.current === requestKey) {
      return
    }
    contextStatsRequestKeyRef.current = requestKey
    void requestJson<AIContextStats>('/ai/context-stats', {
      method: 'POST',
      body: requestKey
    }).then(setContextStats).catch(() => setContextStats(null))
  }, [activeSession?.compressedSummary, activeSession?.messages, config, requestJson, getWorkspaceSnapshot])

  useEffect(() => {
    if (suppressAutoScrollRef.current) {
      suppressAutoScrollRef.current = false
      return
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, sending])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
      }
      if (streamFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFlushFrameRef.current)
      }
    }
  }, [])

  const writeSessions = (nextSessions: AISession[]): void => {
    void window.api.setAISessions(persistedSessions(nextSessions))
  }

  const schedulePersistSessions = (nextSessions: AISession[], delay = 240): void => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      writeSessions(nextSessions)
    }, delay)
  }

  const persistSessions = (nextSessions: AISession[]): void => {
    const normalized = normalizeSessions(nextSessions)
    setSessions(normalized)
    writeSessions(normalized)
  }

  const updateActiveSession = (updater: (session: AISession) => AISession, options?: { persist?: boolean; persistDelay?: number }): void => {
    setSessions((current) => {
      const next = normalizeSessions(current.map((session) => session.id === activeSessionId ? updater(session) : session))
      if (options?.persist === false) {
        if (options.persistDelay !== undefined) {
          schedulePersistSessions(next, options.persistDelay)
        }
      } else {
        writeSessions(next)
      }
      return next
    })
  }

  const applyStreamEventToMessage = (item: ChatMessage, event: StreamEvent): ChatMessage => {
    const finishLastThinkingSegment = (message: ChatMessage): ChatMessage => {
      const segments = [...(message.segments ?? [])]
      const last = segments[segments.length - 1]
      if (!last || last.type !== 'thinking' || last.done) {
        return message
      }
      segments[segments.length - 1] = { ...last, done: true, expanded: false }
      return { ...message, segments }
    }

    const appendSegment = (message: ChatMessage, nextSegment: ChatMessageSegment): ChatMessage => {
      const segments = [...(message.segments ?? [])]
      const last = segments[segments.length - 1]
      if (last && last.type === nextSegment.type && !(last.type === 'thinking' && last.done)) {
        const mergedContent = `${last.content}${nextSegment.content}`
        segments[segments.length - 1] = {
          ...last,
          content: mergedContent,
          preview: mergedContent.replace(/\s+/g, ' ').trim(),
          expanded: nextSegment.expanded ?? last.expanded,
          done: nextSegment.done ?? last.done,
          summary: nextSegment.summary ?? last.summary
        }
        return { ...message, segments }
      }
      return { ...message, segments: [...segments, nextSegment] }
    }

    const appendThinking = (message: ChatMessage, summary: string, detail?: string, done = false): ChatMessage => {
      const currentContent = message.thinking?.content ?? ''
      const currentPreview = message.thinking?.preview ?? ''
      const nextContent = detail
        ? `${currentContent}${detail}`
        : currentContent
      const previewSource = nextContent || currentContent || detail || currentPreview || summary
      const normalizedPreview = previewSource.replace(/\s+/g, ' ').trim()
      return {
        ...message,
        thinking: {
          summary,
          content: nextContent,
          preview: normalizedPreview || currentPreview || summary,
          expanded: done ? false : true,
          done
        }
      }
    }

    void finishLastThinkingSegment
    void appendSegment

    if (event.type === 'token') {
      if (item.thinking && !item.thinking.done) {
        const finishedThinking = appendThinking(item, '思考完成', undefined, true)
        return { ...finishedThinking, content: finishedThinking.content + event.content }
      }
      return { ...item, content: item.content + event.content }
    }
    if (event.type === 'reasoning') {
      return appendThinking(item, '正在思考', event.content)
    }
    if (event.type === 'plan') {
      return appendThinking({ ...item, plan: event.plan, steps: event.plan.steps }, '正在思考执行步骤', `计划：${event.plan.summary || event.plan.goal}`)
    }
    if (event.type === 'step_start') {
      const nextItem = { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'running' as const } : step) }
      const step = nextItem.steps?.find((candidate) => candidate.id === event.step_id)
      return appendThinking(nextItem, '正在执行步骤', step ? `步骤：${step.title}` : '开始执行步骤')
    }
    if (event.type === 'step_result') {
      const nextItem = { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'completed' as const, result: event.result } : step) }
      const step = nextItem.steps?.find((candidate) => candidate.id === event.step_id)
      return appendThinking(nextItem, '正在整理结果', step ? `完成：${step.title}` : '步骤执行完成')
    }
    if (event.type === 'confirmation_required') {
      return { ...item, confirmation: event.confirmation }
    }
    if (event.type === 'tool_start') {
      return appendThinking(
        { ...item, toolCalls: [...(item.toolCalls ?? []), { id: event.tool_call_id, name: event.name, status: 'running' as const, arguments: event.arguments }] },
        '正在调用工具',
        `工具：${event.name}`
      )
    }
    if (event.type === 'tool_result') {
      const status = toolResultStatus(event.result)
      return appendThinking(
        { ...item, toolCalls: (item.toolCalls ?? []).map((tool) => tool.id === event.tool_call_id ? { ...tool, status, result: event.result } : tool) },
        status === 'waiting_confirm' ? '等待确认' : '正在继续处理',
        `${event.name}：${status === 'waiting_confirm' ? '等待确认' : status === 'completed' ? '已完成' : '已失败'}`
      )
    }
    if (event.type === 'tool_done') {
      return appendThinking(item, '正在继续处理')
    }
    if (event.type === 'done') {
      return appendThinking(item, '思考完成', undefined, true)
    }
    return item
  }

  void applyStreamEventToMessage

  const applyStreamEventToMessageV2 = (item: ChatMessage, event: StreamEvent): ChatMessage => {
    const appendSegment = (message: ChatMessage, nextSegment: ChatMessageSegment): ChatMessage => {
      const segments = [...(message.segments ?? [])]
      const last = segments[segments.length - 1]

      if (last && last.type === nextSegment.type && !(last.type === 'thinking' && last.done)) {
        const mergedContent = `${last.content}${nextSegment.content}`
        segments[segments.length - 1] = {
          ...last,
          content: mergedContent,
          preview: mergedContent.replace(/\s+/g, ' ').trim(),
          expanded: nextSegment.expanded ?? last.expanded,
          done: nextSegment.done ?? last.done,
          summary: nextSegment.summary ?? last.summary
        }
        return { ...message, segments }
      }

      return { ...message, segments: [...segments, nextSegment] }
    }

    const finishLastThinking = (message: ChatMessage): ChatMessage => {
      const segments = [...(message.segments ?? [])]
      const last = segments[segments.length - 1]
      if (!last || last.type !== 'thinking' || last.done) {
        return message
      }
      segments[segments.length - 1] = { ...last, done: true, expanded: false }
      return { ...message, segments }
    }

    if (event.type === 'token') {
      return appendSegment(
        finishLastThinking({ ...item, content: `${item.content}${event.content}` }),
        { id: crypto.randomUUID(), type: 'content', content: event.content }
      )
    }

    if (event.type === 'reasoning') {
      return appendSegment(item, {
        id: crypto.randomUUID(),
        type: 'thinking',
        content: event.content,
        summary: '思考',
        preview: event.content.replace(/\s+/g, ' ').trim(),
        expanded: true,
        done: false
      })
    }

    if (event.type === 'plan') {
      return { ...item, plan: event.plan, steps: event.plan.steps }
    }

    if (event.type === 'step_start') {
      return { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'running' as const } : step) }
    }

    if (event.type === 'step_result') {
      return { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'completed' as const, result: event.result } : step) }
    }

    /*
    if (event.type === 'plan') {
      return appendSegment({ ...item, plan: event.plan, steps: event.plan.steps }, {
        id: crypto.randomUUID(),
        type: 'thinking',
        content: `计划：${event.plan.summary || event.plan.goal}`,
        summary: '思考',
        preview: `计划：${event.plan.summary || event.plan.goal}`,
        expanded: true,
        done: false
      })
    }

    if (event.type === 'step_start') {
      const nextItem = { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'running' as const } : step) }
      const step = nextItem.steps?.find((candidate) => candidate.id === event.step_id)
      return appendSegment(nextItem, {
        id: crypto.randomUUID(),
        type: 'thinking',
        content: step ? `步骤：${step.title}` : '开始执行步骤',
        summary: '思考',
        preview: step ? `步骤：${step.title}` : '开始执行步骤',
        expanded: true,
        done: false
      })
    }

    if (event.type === 'step_result') {
      const nextItem = { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'completed' as const, result: event.result } : step) }
      const step = nextItem.steps?.find((candidate) => candidate.id === event.step_id)
      return appendSegment(nextItem, {
        id: crypto.randomUUID(),
        type: 'thinking',
        content: step ? `完成：${step.title}` : '步骤执行完成',
        summary: '思考',
        preview: step ? `完成：${step.title}` : '步骤执行完成',
        expanded: true,
        done: false
      })
    }
    */

    if (event.type === 'confirmation_required') {
      return { ...item, confirmation: event.confirmation }
    }

    if (event.type === 'tool_start') {
      return appendSegment(
        { ...item, toolCalls: [...(item.toolCalls ?? []), { id: event.tool_call_id, name: event.name, status: 'running' as const, arguments: event.arguments }] },
        {
          id: crypto.randomUUID(),
          type: 'tool',
          content: event.name,
          summary: event.name,
          preview: event.name,
          expanded: true,
          done: false,
          toolCallId: event.tool_call_id
        }
      )
    }

    if (event.type === 'tool_result') {
      const status = toolResultStatus(event.result)
      const nextMessage = {
        ...item,
        toolCalls: (item.toolCalls ?? []).map((tool) => tool.id === event.tool_call_id ? { ...tool, status, result: event.result } : tool)
      }
      const nextSegments = (nextMessage.segments ?? []).map((segment) => (
        segment.type === 'tool' && segment.toolCallId === event.tool_call_id
          ? {
              ...segment,
              expanded: false,
              done: true,
              preview: `${event.name} ${status === 'waiting_confirm' ? '等待确认' : status === 'completed' ? '已完成' : '失败'}`
            }
          : segment
      ))
      return { ...nextMessage, segments: nextSegments }
    }

    if (event.type === 'tool_done') {
      return item
    }

    if (event.type === 'done') {
      return finishLastThinking(item)
    }

    return item
  }

  const flushQueuedStreamEvents = (): void => {
    if (streamFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFlushFrameRef.current)
      streamFlushFrameRef.current = null
    }
    const pendingEvents = queuedStreamEventsRef.current
    if (pendingEvents.length === 0) {
      return
    }

    const processedEvents: QueuedStreamUpdate[] = []
    const remainingEvents: QueuedStreamUpdate[] = []
    let streamedEventCount = 0

    for (let index = 0; index < pendingEvents.length; index += 1) {
      const update = pendingEvents[index]
      const streamingTextEvent = isStreamingTextEvent(update.event)

      if (streamingTextEvent) {
        if (streamedEventCount >= STREAM_EVENTS_PER_FRAME) {
          remainingEvents.push(...pendingEvents.slice(index))
          break
        }
        streamedEventCount += 1
        processedEvents.push(update)
        continue
      }

      if (streamedEventCount > 0) {
        remainingEvents.push(...pendingEvents.slice(index))
        break
      }

      processedEvents.push(update)
    }

    queuedStreamEventsRef.current = remainingEvents

    const groupedEvents = new Map<string, StreamEvent[]>()
    for (const { assistantId, event } of processedEvents) {
      const current = groupedEvents.get(assistantId)
      if (current) {
        current.push(event)
      } else {
        groupedEvents.set(assistantId, [event])
      }
      if (event.type === 'tool_result') {
        const status = toolResultStatus(event.result)
        if (status === 'completed' && isMutatingToolResult(event.name, event.result)) {
          onAgentDataChanged?.()
        }
      }
      if (event.type === 'workspace_action') {
        onWorkspaceAction?.(event.action)
      }
    }

    setSessions((current) => current.map((session) => {
      if (session.id !== activeSessionId) {
        return session
      }

      return {
        ...session,
        updatedAt: Date.now(),
        messages: session.messages.map((item) => {
          const itemEvents = groupedEvents.get(item.id)
          if (!itemEvents || itemEvents.length === 0) {
            return item
          }
          return itemEvents.reduce((message, event) => applyStreamEventToMessageV2(message, event), item)
        })
      }
    }))

    if (queuedStreamEventsRef.current.length > 0) {
      streamFlushFrameRef.current = window.requestAnimationFrame(() => {
        streamFlushFrameRef.current = null
        flushQueuedStreamEvents()
      })
    }
  }

  const queueStreamEvent = (assistantId: string, event: StreamEvent): void => {
    if (event.type === 'error') {
      throw new Error(event.message)
    }
    queuedStreamEventsRef.current.push({ assistantId, event })
    if (streamFlushFrameRef.current !== null) {
      return
    }
    streamFlushFrameRef.current = window.requestAnimationFrame(() => {
      streamFlushFrameRef.current = null
      flushQueuedStreamEvents()
    })
  }

  const newSession = (): void => {
    const existingDraft = sessions.find(isDraftSession)
    if (existingDraft) {
      setActiveSessionId(existingDraft.id)
      return
    }
    const nextSession = createSession()
    persistSessions([nextSession, ...sessions])
    setActiveSessionId(nextSession.id)
  }

  const deleteSession = (sessionId: string): void => {
    const sessionIndex = sessions.findIndex((session) => session.id === sessionId)
    if (sessionIndex < 0) {
      return
    }

    const remaining = normalizeSessions(sessions.filter((session) => session.id !== sessionId))
    if (remaining.length === 0) {
      const nextSession = createSession()
      setSessions([nextSession])
      setActiveSessionId(nextSession.id)
      void window.api.setAISessions([])
      return
    }

    const nextActiveSessionId = activeSessionId === sessionId
      ? (remaining[sessionIndex] ?? remaining[sessionIndex - 1] ?? remaining[0]).id
      : activeSessionId

    setSessions(remaining)
    setActiveSessionId(nextActiveSessionId)
    void window.api.setAISessions(persistedSessions(remaining))
  }

  const compactActiveSession = async (): Promise<boolean> => {
    const session = sessions.find((item) => item.id === activeSessionId)
    if (!session || session.messages.length <= MIN_MESSAGES_TO_COMPACT || compacting) {
      return false
    }

    if (!ready) {
      messageApi.warning('请先配置 AI 模型后再压缩上下文')
      return false
    }

    setCompacting(true)
    try {
      const compactingMessageId = crypto.randomUUID()
      updateActiveSession((currentSession) => ({
        ...currentSession,
        updatedAt: Date.now(),
        messages: [
          ...currentSession.messages,
          { id: compactingMessageId, role: 'assistant', content: '自动压缩上下文中…' }
        ]
      }), { persist: true })
      const result = await requestJson<{ summary: string }>('/ai/compact', {
        method: 'POST',
        body: JSON.stringify({
          messages: session.messages.map((item) => ({ role: item.role, content: item.content })),
          config: config!,
          workspace: getWorkspaceSnapshotRef.current?.()
        })
      })
      updateActiveSession((currentSession) => ({
        ...currentSession,
        updatedAt: Date.now(),
        compactedAt: Date.now(),
        compressedSummary: result.summary,
        messages: currentSession.messages
          .filter((item) => item.id === compactingMessageId || item.role === 'user' || item.role === 'assistant')
          .slice(-2)
          .map((item) => item.id === compactingMessageId ? { ...item, content: '已自动压缩上下文。' } : item)
      }), { persist: true })
      return true
    } catch (err) {
      showError(err instanceof Error ? err.message : '上下文压缩失败')
      return false
    } finally {
      setCompacting(false)
    }
  }

  const saveConfigs = async (nextConfigs: AIConfigItem[] = configs): Promise<AIConfigItem[]> => {
    const saved = await window.api.setAIConfigs(nextConfigs)
    setConfigs(saved)
    return saved
  }

  const addConfig = (): void => {
    setConfigs((current) => [...current, createAIConfigItem({ name: `AI 配置 ${current.length + 1}` })])
  }

  const updateConfig = (id: string, patch: Partial<AIConfigItem>): void => {
    setConfigs((current) => current.map((item) => item.id === id ? createAIConfigItem({ ...item, ...patch }) : item))
  }

  const removeConfig = (id: string): void => {
    setConfigs((current) => current.filter((item) => item.id !== id))
  }

  const toggleConfig = (id: string, enabled: boolean): void => {
    setConfigs((current) => current.map((item) => ({ ...item, enabled: enabled && item.id === id })))
  }

  const testAI = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const saved = await saveConfigs()
      const next = activeAIConfig(saved)
      if (!next) {
        throw new Error('请先启用一条完整的 AI 配置')
      }
      const result = await requestJson<{ success: boolean; message: string }>('/ai/ping', {
        method: 'POST',
        body: JSON.stringify({ config: next })
      })
      const nextResult = { success: result.success, message: result.message || (result.success ? 'AI 配置可用' : 'AI 配置不可用') }
      setTestResult(nextResult)
      if (result.success) {
        messageApi.success(nextResult.message)
      } else {
        showError(nextResult.message)
      }
    } catch (err) {
      const nextResult = { success: false, message: err instanceof Error ? err.message : '测试连接失败' }
      setTestResult(nextResult)
      showError(nextResult.message)
    } finally {
      setTesting(false)
    }
  }

  const sendMessage = async (): Promise<void> => {
    const content = input.trim()
    if (!content || sending) {
      return
    }

    if (content === '/compact') {
      setInput('')
      const compacted = await compactActiveSession()
      if (compacted) {
        messageApi.success('上下文已压缩，并已开启新会话')
      } else {
        messageApi.info('当前会话内容较少，暂不需要压缩')
      }
      return
    }

    if (!canChat) {
      return
    }

    let nextApiMessages = buildConversationMessages(activeSession)
    if ((effectiveContextStats?.usage_ratio ?? 0) >= AUTO_COMPACT_USAGE_RATIO && !autoCompactRunningRef.current) {
      autoCompactRunningRef.current = true
      try {
        await compactActiveSession()
      } finally {
        autoCompactRunningRef.current = false
      }
      nextApiMessages = buildConversationMessages(sessions.find((item) => item.id === activeSessionId))
    }

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content }
    const assistantId = crypto.randomUUID()
    updateActiveSession((session) => {
      const wasEmpty = session.messages.length === 0
      return {
        ...session,
        title: wasEmpty ? sessionTitle(content) : session.title,
        updatedAt: Date.now(),
        messages: [...session.messages, userMessage, { id: assistantId, role: 'assistant', content: '', toolCalls: [] }]
      }
    })
    setInput('')
    setSending(true)
    streamIdRef.current = crypto.randomUUID()
    try {
      await streamChat([...nextApiMessages, { role: 'user', content }], assistantId)
    } catch (err) {
      const error = err instanceof Error ? err.message : 'AI 请求失败'
      updateActiveSession((session) => ({ ...session, updatedAt: Date.now(), messages: session.messages.map((item) => (item.id === assistantId ? { ...item, content: item.content || error } : item)) }))
      showError(error)
    } finally {
      streamIdRef.current = null
      setSending(false)
    }
  }

  const stopMessage = (): void => {
    if (streamIdRef.current) {
      void window.api.cancelStreamRequest(streamIdRef.current)
    }
  }

  const streamChat = async (nextMessages: { role: string; content: string }[], assistantId: string): Promise<void> => {
    let buffer = ''

    const streamId = streamIdRef.current ?? crypto.randomUUID()
    streamIdRef.current = streamId
    const connectionContext = readConnectionContext()

    try {
      await window.api.streamRequest(
        streamId,
        '/ai/chat/stream',
        {
          method: 'POST',
          body: JSON.stringify({
            messages: nextMessages,
            config: config!,
            connection_id: connectionContext.connectionId,
            database: connectionContext.database,
            pg_database: connectionContext.pgDatabase,
            workspace: getWorkspaceSnapshotRef.current?.()
          })
        },
        (chunk) => {
          buffer += chunk
          const parsed = parseSseLines(buffer)
          buffer = parsed.rest
          for (const event of parsed.events) {
            applyStreamEvent(assistantId, event)
          }
        }
      )
    } finally {
      const remaining = buffer.trim()
      if (remaining) {
        try {
          const line = remaining
            .split('\n')
            .find((item) => item.startsWith('data: '))
          if (line) {
            applyStreamEvent(assistantId, JSON.parse(line.slice(6)) as StreamEvent)
          }
        } catch {
          // Ignore trailing partial chunks; completed events are already applied above.
        }
      }
      flushQueuedStreamEvents()
      updateActiveSession((session) => ({ ...session, updatedAt: Date.now() }), { persist: true })
    }
  }

  const applyStreamEvent = (assistantId: string, event: StreamEvent): void => {
    queueStreamEvent(assistantId, event)
    return
    /*
    if (event.type === 'workspace_action') {
      onWorkspaceAction?.(event.action)
      return
    }

    updateActiveSession((session) => {
      const messages = session.messages.map((item) => {
        if (item.id !== assistantId) {
          return item
        }

        const appendThinking = (message: ChatMessage, summary: string, detail?: string, done = false): ChatMessage => {
          const currentContent = message.thinking?.content ?? ''
          const nextContent = detail
            ? (summary === '正在思考'
              ? `${currentContent}${detail}`
              : currentContent.includes(detail)
                ? currentContent
                : `${currentContent}${currentContent ? '\n' : ''}${detail}`)
            : currentContent
          return {
            ...message,
            thinking: {
              summary,
              content: nextContent,
              expanded: message.thinking?.expanded ?? !done,
              done
            }
          }
        }

        if (event.type === 'token') {
          return { ...item, content: item.content + event.content }
        }
        if (event.type === 'reasoning') {
          return appendThinking(item, '正在思考', event.content)
        }
        if (event.type === 'plan') {
          return appendThinking({ ...item, plan: event.plan, steps: event.plan.steps }, '正在思考执行步骤', `计划：${event.plan.summary || event.plan.goal}`)
        }
        if (event.type === 'step_start') {
          const nextItem = { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'running' as const } : step) }
          const step = nextItem.steps?.find((candidate) => candidate.id === event.step_id)
          return appendThinking(nextItem, '正在执行步骤', step ? `步骤：${step.title}` : '开始执行步骤')
        }
        if (event.type === 'step_result') {
          const nextItem = { ...item, steps: (item.steps ?? []).map((step) => step.id === event.step_id ? { ...step, status: 'completed' as const, result: event.result } : step) }
          const step = nextItem.steps?.find((candidate) => candidate.id === event.step_id)
          return appendThinking(nextItem, '正在整理结果', step ? `完成：${step.title}` : '步骤执行完成')
        }
        if (event.type === 'confirmation_required') {
          return { ...item, confirmation: event.confirmation }
        }
        if (event.type === 'tool_start') {
          return appendThinking(
            { ...item, toolCalls: [...(item.toolCalls ?? []), { id: event.tool_call_id, name: event.name, status: 'running' as const, arguments: event.arguments }] },
            '正在调用工具',
            `工具：${event.name}`
          )
        }
        if (event.type === 'tool_result') {
          const status = toolResultStatus(event.result)
          if (status === 'completed' && isMutatingToolResult(event.name, event.result)) {
            onAgentDataChanged?.()
          }
          return appendThinking(
            { ...item, toolCalls: (item.toolCalls ?? []).map((tool) => tool.id === event.tool_call_id ? { ...tool, status, result: event.result } : tool) },
            status === 'waiting_confirm' ? '等待确认' : '正在继续处理',
            `${event.name}：${status === 'waiting_confirm' ? '等待确认' : status === 'completed' ? '已完成' : '已失败'}`
          )
        }
        if (event.type === 'tool_done' || event.type === 'done') {
          return appendThinking(item, '思考完成', undefined, true)
        }
        return item
      })
      return { ...session, updatedAt: Date.now(), messages }
    })
    */
  }
  const confirmAction = async (confirmation: AgentConfirmationView, approved: boolean): Promise<void> => {
    const connectionContext = readConnectionContext()
    if (!connectionContext.connectionId) {
      showError('请先选择已打开的数据库连接')
      return
    }
    setConfirmingId(confirmation.id)
    try {
      const result = await requestJson<{ message: string; executed?: boolean; sql?: string; result?: unknown; action?: string; backup?: unknown }>('/ai/confirm', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: connectionContext.connectionId,
          confirmation_id: confirmation.id,
          approved,
          database: connectionContext.database,
          pg_database: connectionContext.pgDatabase
        })
      })
      if (approved && result.executed === true) {
        onAgentDataChanged?.()
      }

      const resultPayload = result.action === 'restore_backup' ? result.backup : result.result
      const resultContent = approved ? `确认执行结果：${result.message}\n\n\`\`\`json\n${JSON.stringify(resultPayload ?? {}, null, 2)}\n\`\`\`` : result.message
      const resultMessage: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: resultContent }

      if (!approved) {
        updateActiveSession((session) => ({
          ...session,
          updatedAt: Date.now(),
          messages: [
            ...session.messages.map((item) => item.confirmation?.id === confirmation.id ? { ...item, confirmation: undefined } : item),
            resultMessage
          ]
        }))
        messageApi.success(result.message)
        return
      }

      const assistantId = crypto.randomUUID()
      const continuationContent = result.action === 'restore_backup'
        ? `用户已确认并恢复备份，后端返回 executed=${result.executed === true ? 'true' : 'false'}，备份恢复结果如下。只有 executed=true 才能认为恢复成功；请基于该结果继续完成原计划的后续步骤，不要重复恢复已完成备份。\n\nBackup:\n${JSON.stringify(result.backup ?? {}, null, 2)}`
        : `用户已确认并执行 SQL，后端返回 executed=${result.executed === true ? 'true' : 'false'}，SQL 和执行结果如下。只有 executed=true 才能认为该 SQL 执行成功；请基于该结果继续完成原计划的后续步骤，不要重复执行已完成 SQL。如果还需要创建其他表，必须继续逐条调用 execute_query(readonly=false) 并等待用户确认。\n\nSQL:\n${result.sql ?? confirmation.sql ?? ''}\n\nResult:\n${JSON.stringify(result.result ?? {}, null, 2)}`
      updateActiveSession((session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: [
          ...session.messages.map((item) => item.confirmation?.id === confirmation.id ? { ...item, confirmation: undefined } : item),
          resultMessage,
          { id: assistantId, role: 'assistant', content: '', toolCalls: [] }
        ]
      }))
      messageApi.success(result.message)
      setSending(true)
      streamIdRef.current = crypto.randomUUID()
      try {
        await streamChat([
          ...apiMessages,
          { role: 'assistant', content: resultContent },
          { role: 'user', content: continuationContent }
        ], assistantId)
      } catch (err) {
        const error = err instanceof Error ? err.message : 'AI 继续执行失败'
        updateActiveSession((session) => ({
          ...session,
          updatedAt: Date.now(),
          messages: session.messages.map((item) => item.id === assistantId ? { ...item, content: item.content || error } : item)
        }))
        showError(error)
      } finally {
        streamIdRef.current = null
        setSending(false)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '确认操作失败')
    } finally {
      setConfirmingId(null)
    }
  }

  const renderMarkdown = (content: string): { __html: string } => ({
    __html: DOMPurify.sanitize(marked.parse(content || '...', { gfm: true, breaks: true }) as string)
  })

  const riskColor = (risk?: string): 'success' | 'warning' | 'error' | 'default' => {
    if (risk === 'dangerous') {
      return 'error'
    }
    if (risk === 'review') {
      return 'warning'
    }
    if (risk === 'safe') {
      return 'success'
    }
    return 'default'
  }

  const stepStatus = (status: AgentStepView['status']): 'wait' | 'process' | 'finish' | 'error' => {
    if (status === 'running') {
      return 'process'
    }
    if (status === 'completed') {
      return 'finish'
    }
    if (status === 'failed') {
      return 'error'
    }
    return 'wait'
  }

  const renderAgentPlan = (item: ChatMessage): React.JSX.Element | null => {
    if (!item.plan) {
      return null
    }
    return (
      <Card size="small" className="ai-agent-card" title={<Space><ClockCircleOutlined />Agent 计划<Tag color={riskColor(item.plan.risk_level)}>{item.plan.risk_level ?? 'safe'}</Tag></Space>}>
        <Space direction="vertical" className="full-width" size={8}>
          <Typography.Text strong>{item.plan.goal}</Typography.Text>
          <Typography.Text type="secondary">{item.plan.summary}</Typography.Text>
          <Steps
            direction="vertical"
            size="small"
            items={(item.steps ?? item.plan.steps).map((step) => ({
              title: <Space>{step.title}<Tag color={riskColor(step.risk_level)}>{step.risk_level ?? 'safe'}</Tag></Space>,
              description: step.description,
              status: stepStatus(step.status),
              icon: step.status === 'completed' ? <CheckCircleOutlined /> : step.status === 'failed' ? <ExclamationCircleOutlined /> : undefined
            }))}
          />
        </Space>
      </Card>
    )
  }

  const renderConfirmation = (confirmation?: AgentConfirmationView): React.JSX.Element | null => {
    if (!confirmation) {
      return null
    }

    return (
      <Alert
        className="ai-confirmation-card"
        type={confirmation.risk_level === 'dangerous' ? 'error' : 'warning'}
        showIcon
        message={<Space>{confirmation.title}<Tag color={riskColor(confirmation.risk_level)}>{confirmation.risk_level}</Tag></Space>}
        description={(
          <Space direction="vertical" className="full-width">
            <Typography.Text>{confirmation.explanation}</Typography.Text>
            {confirmation.sql && <pre>{confirmation.sql}</pre>}
            {confirmation.estimated_impact !== undefined && <pre>{String(JSON.stringify(confirmation.estimated_impact, null, 2))}</pre>}
            <Space>
              <Button size="small" onClick={() => void confirmAction(confirmation, false)} loading={confirmingId === confirmation.id}>取消</Button>
              <Button size="small" danger type="primary" onClick={() => void confirmAction(confirmation, true)} loading={confirmingId === confirmation.id}>确认执行</Button>
            </Space>
          </Space>
        )}
      />
    )
  }

  const renderThinking = (item: ChatMessage): React.JSX.Element | null => {
    if (!item.thinking) {
      return null
    }

    const expanded = item.thinking.expanded ?? !item.thinking.done
    const thinkingLabel = '\u601D\u8003\uff1A'
    const expandedText = (item.thinking.content || item.thinking.preview || item.thinking.summary || '')
      .replace(/\r\n/g, '\n')
      .trim()
    const collapsedText = expandedText.replace(/\s+/g, ' ').trim() || (item.thinking.summary || '').replace(/\s+/g, ' ').trim()

    if (!collapsedText) {
      return null
    }

    return (
      <div className="ai-thinking-block">
        <div
          className={`ai-thinking-summary${item.thinking.done ? ' done' : ''}`}
          onClick={() => {
            suppressAutoScrollRef.current = true
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === item.id && message.thinking
                  ? { ...message, thinking: { ...message.thinking, expanded: !(message.thinking.expanded ?? !message.thinking.done) } }
                  : message
              ))
            }))
          }}
        >
          <span className={`ai-thinking-toggle${item.thinking.done ? '' : ' is-loading'}`} aria-hidden="true">
            {item.thinking.done ? (expanded ? <DownOutlined /> : <RightOutlined />) : <LoadingOutlined spin />}
          </span>
          <span className={`ai-thinking-content${expanded ? ' expanded' : ''}`}>
            <span className="ai-thinking-inline-title">{thinkingLabel}</span>
            <span className={`ai-thinking-summary-text${expanded ? ' expanded' : ''}`}>
              {expanded ? expandedText : collapsedText}
            </span>
          </span>
        </div>
      </div>
    )
  }

  const renderThinkingSegment = (item: ChatMessage, segment: ChatMessageSegment): React.JSX.Element | null => {
    const expanded = segment.expanded ?? !segment.done
    const thinkingLabel = '\u601D\u8003\uff1A'
    const fullContent = (segment.content || segment.preview || segment.summary || '').replace(/\r\n/g, '\n').trim()
    const compactContent = fullContent.replace(/\s+/g, ' ').trim() || (segment.summary || '').replace(/\s+/g, ' ').trim()

    if (!compactContent) {
      return null
    }

    return (
      <div className="ai-thinking-block" key={segment.id}>
        <div
          className={`ai-thinking-summary${segment.done ? ' done' : ''}`}
          onClick={() => {
            suppressAutoScrollRef.current = true
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === item.id && message.segments
                  ? {
                      ...message,
                      segments: message.segments.map((current) => current.id === segment.id
                        ? { ...current, expanded: !(current.expanded ?? !current.done) }
                        : current)
                    }
                  : message
              ))
            }))
          }}
        >
          <span className={`ai-thinking-toggle${segment.done ? '' : ' is-loading'}`} aria-hidden="true">
            {segment.done ? (expanded ? <DownOutlined /> : <RightOutlined />) : <LoadingOutlined spin />}
          </span>
          <span className={`ai-thinking-content${expanded ? ' expanded' : ''}`}>
            <span className="ai-thinking-inline-title">{thinkingLabel}</span>
            <span className={`ai-thinking-summary-text${expanded ? ' expanded' : ''}`}>
              {expanded ? fullContent : compactContent}
            </span>
          </span>
        </div>
      </div>
    )
  }

  const renderAssistantContent = (item: ChatMessage): React.JSX.Element => {
    if (item.segments && item.segments.length > 0) {
      const hasThinkingSegment = item.segments.some((segment) => segment.type === 'thinking')
      const hasContentSegment = item.segments.some((segment) => segment.type === 'content' && segment.content.trim())
      return (
        <>
          {!hasThinkingSegment && renderThinking(item)}
          {item.segments.map((segment) => (
            segment.type === 'thinking'
              ? renderThinkingSegment(item, segment)
              : segment.type === 'tool'
                ? (
                    <Collapse
                      key={segment.id}
                      size="small"
                      className="ai-tool-calls ai-tool-calls-inline"
                      items={[{
                        key: segment.id,
                        label: (
                          <Space>
                            {(() => {
                              const tool = (item.toolCalls ?? []).find((current) => current.id === segment.toolCallId)
                              return tool?.status === 'running'
                                ? <LoadingOutlined spin />
                                : tool?.status === 'waiting_confirm'
                                  ? <ClockCircleOutlined style={{ color: '#faad14' }} />
                                  : tool?.status === 'completed'
                                    ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                    : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                            })()}
                            <ToolOutlined />
                            {segment.preview || `工具：${segment.summary || segment.content}`}
                          </Space>
                        ),
                        children: (
                          <pre>{JSON.stringify((item.toolCalls ?? []).find((current) => current.id === segment.toolCallId) ?? {}, null, 2)}</pre>
                        )
                      }]}
                    />
                  )
                : <div key={segment.id} className="ai-markdown" dangerouslySetInnerHTML={renderMarkdown(segment.content)} />
          ))}
          {!hasContentSegment && item.content.trim() && (
            <div className="ai-markdown" dangerouslySetInnerHTML={renderMarkdown(item.content)} />
          )}
        </>
      )
    }

    return (
      <>
        {renderThinking(item)}
        <div className="ai-markdown" dangerouslySetInnerHTML={renderMarkdown(item.content)} />
      </>
    )
  }

  const renderContextSources = (): React.ReactNode => {
    if (contextSources.length === 0) {
      return null
    }

    return (
      <div className="ai-context-sources">
        <Flex justify="space-between" align="center" className="ai-context-sources-header">
          <Space size={6}>
            <DatabaseOutlined />
            <Typography.Text strong>当前 AI 上下文</Typography.Text>
          </Space>
          <Tag>{contextSources.length}</Tag>
        </Flex>
        <Space direction="vertical" size={6} className="full-width">
          {contextSources.map((source) => {
            const isPrimary = source.id === primaryContextSourceId
            return (
              <Flex key={source.id} align="center" justify="space-between" className="ai-context-source-item" gap={8}>
                <Space size={6} className="ai-context-source-main">
                  <DatabaseOutlined />
                  <div className="ai-context-source-text">
                    <Typography.Text ellipsis title={contextSourceTitle(source)}>{contextSourceTitle(source)}</Typography.Text>
                    <Typography.Text type="secondary">{source.connectionName} · {source.dbType} · {contextSourceTypeLabel[source.type]}{source.sizeDisplay ? ` · ${source.sizeDisplay}` : ''}</Typography.Text>
                  </div>
                </Space>
                {isPrimary ? (
                  <Tag color="blue">当前</Tag>
                ) : (
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    title="从当前 AI 上下文移除"
                    aria-label="从当前 AI 上下文移除"
                    onClick={() => onRemoveContextSource?.(source.id)}
                  />
                )}
              </Flex>
            )
          })}
        </Space>
      </div>
    )
  }

  return (
    <div className="ai-panel-inline">
      {contextHolder}
      <Flex align="center" className="ai-panel-header">
        <Space className="ai-panel-actions">
          <div className="ai-panel-session-shell">
            <Select
              size="small"
              value={activeSessionId || undefined}
              placeholder="选择会话"
              className="ai-session-select"
              popupClassName="ai-session-select-popup"
              onChange={setActiveSessionId}
              popupMatchSelectWidth={false}
              options={sessions.map((session) => ({ label: session.title, value: session.id, title: session.title }))}
              optionRender={(option) => {
                const session = sessions.find((item) => item.id === option.value)
                if (!session) {
                  return option.label
                }
                return (
                  <Flex align="center" justify="space-between" gap={8} className="full-width">
                    <Typography.Text ellipsis title={session.title}>{session.title}</Typography.Text>
                    <Button
                      type="text"
                      size="small"
                      className="ai-session-delete-btn"
                      icon={<CloseOutlined />}
                      aria-label={`删除会话 ${session.title}`}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        deleteSession(session.id)
                      }}
                    />
                  </Flex>
                )
              }}
            />
          </div>
          <div className="ai-panel-action-buttons">
            <Button size="small" className="ai-panel-ghost-btn" icon={<PlusOutlined />} onClick={newSession}>新建</Button>
            <Button size="small" className="ai-panel-ghost-btn" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>设置</Button>
          </div>
        </Space>
      </Flex>
      <Space direction="vertical" className="full-width ai-panel" size="middle">
        {!ready && <Alert type="warning" showIcon message="请先配置并启用 AI 接口" />}
        {ready && !hasDatabaseContext && <Alert type="info" showIcon message="未选择上下文" description="当前仅支持 AI 问答、整理连接信息和生成 SQL 到查询窗口，不能执行数据库查询或结构读取任务。" />}
        {renderContextSources()}
        <div ref={scrollRef} className="ai-message-list">
          <List
            dataSource={messages}
            locale={{ emptyText: '可以问我：列出当前库的表、分析某张表结构、生成查询 SQL。' }}
            renderItem={(item) => (
              <List.Item className={`ai-message ai-message-${item.role}`}>
                <Card size="small" className={`full-width ai-message-card ai-message-card-${item.role}`} title={item.role === 'user' ? '你' : 'AI'}>
                  {item.role === 'assistant' ? renderAssistantContent(item) : null}
                  {renderAgentPlan(item)}
                  {renderConfirmation(item.confirmation)}
                  {item.role === 'user' ? <div className="ai-markdown" dangerouslySetInnerHTML={renderMarkdown(item.content)} /> : null}
                </Card>
              </List.Item>
            )}
          />
        </div>
        <div className="ai-input-shell">
          <div className="ai-input-shell-glow" />
          <Input.TextArea
            value={input}
            className="ai-input-box"
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={(event) => {
              const pressed = normalizeShortcut(buildShortcutFromKeyboardEvent({
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                key: 'Enter'
              }))
              const sendShortcut = normalizeShortcut(shortcuts?.send || 'Enter')
              const newlineShortcut = normalizeShortcut(shortcuts?.newline || 'Shift+Enter')

              if (pressed === sendShortcut) {
                event.preventDefault()
                void sendMessage()
                return
              }

              if (pressed !== newlineShortcut) {
                event.preventDefault()
              }
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              const stopShortcut = normalizeShortcut(shortcuts?.stop || 'Ctrl+C')
              const pressed = normalizeShortcut(buildShortcutFromKeyboardEvent(event))
              if (sending && pressed === stopShortcut) {
                event.preventDefault()
                stopMessage()
              }
            }}
            placeholder="输入问题"
            autoSize={{ minRows: 5, maxRows: 10 }}
          />
          <div className="ai-input-footer">
            <Dropdown
              trigger={['click']}
              placement="topLeft"
              menu={{
                selectable: true,
                selectedKeys: selectedConfigId ? [selectedConfigId] : [],
                items: configs
                  .filter((item) => item.base_url && item.api_key && item.model && item.max_context_tokens)
                  .map((item) => ({
                    key: item.id,
                    label: `${item.name} · ${item.model}`
                  })),
                onClick: ({ key }) => setSelectedConfigId(String(key))
              }}
            >
              <button type="button" className="ai-model-trigger">
                <span className="ai-model-trigger-name">{activeConfigItem?.model ?? '未连接 AI'}</span>
                <DownOutlined />
              </button>
            </Dropdown>
            <div className="ai-context-meter">
              <Progress
                percent={contextProgressPercent}
                size={['100%', 6]}
                status={contextLevel === 'full' ? 'exception' : 'normal'}
                showInfo={false}
                trailColor="rgba(255,255,255,0.08)"
                strokeColor={contextLevel === 'full' ? '#ff6b6b' : contextLevel === 'warning' ? '#f7c45c' : '#79d7ff'}
              />
              <Typography.Text type="secondary" className="ai-context-meter-text">
                {!config?.max_context_tokens || config.max_context_tokens <= 0
                  ? '未设置上下文'
                  : effectiveContextStats
                  ? maxContextTokens > 0
                    ? `上下文 ${formatTokenK(effectiveContextStats.used_tokens)} / ${formatTokenK(maxContextTokens)}`
                    : `上下文 ${formatTokenK(effectiveContextStats.used_tokens)} / 未配置`
                  : '上下文统计中…'}
              </Typography.Text>
            </div>
            {sending ? (
              <Button
                ref={sendButtonRef}
                danger
                className="ai-send-button"
                icon={<StopOutlined />}
                onClick={stopMessage}
                onPointerMove={(event) => applySendButtonMagnet(sendButtonRef.current, event.clientX, event.clientY)}
                onPointerLeave={() => resetSendButtonMagnet(sendButtonRef.current)}
                onBlur={() => resetSendButtonMagnet(sendButtonRef.current)}
              />
            ) : (
              <Button
                ref={sendButtonRef}
                type="primary"
                className="ai-send-button"
                icon={<SendOutlined />}
                disabled={!ready || !input.trim() || !activeSessionId}
                onClick={() => void sendMessage()}
                onPointerMove={(event) => applySendButtonMagnet(sendButtonRef.current, event.clientX, event.clientY)}
                onPointerLeave={() => resetSendButtonMagnet(sendButtonRef.current)}
                onBlur={() => resetSendButtonMagnet(sendButtonRef.current)}
              />
            )}
          </div>
        </div>
      </Space>
      <Modal
        title={(
          <Space className="ai-settings-title" size={10}>
            <span className="ai-settings-title-orb"><SettingOutlined /></span>
            <span className="ai-settings-title-copy">
              <Typography.Text strong>AI 设置</Typography.Text>
              <Typography.Text type="secondary">配置模型、上下文与连接测试</Typography.Text>
            </span>
          </Space>
        )}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={640}
        className="ai-settings-modal"
      >
        <Space direction="vertical" className="full-width ai-settings-body" size="middle">
          <Flex justify="space-between" align="center" className="ai-settings-toolbar">
            <Typography.Text type="secondary">可添加多个 OpenAI 兼容接口配置；同一时间最多启用一个，也可以全部关闭。</Typography.Text>
            <Button className="ai-panel-ghost-btn ai-settings-add-btn" icon={<PlusOutlined />} onClick={addConfig}>添加配置</Button>
          </Flex>
          {configs.length === 0 ? (
            <Alert type="info" showIcon message="暂无 AI 配置" description="添加配置并启用后，Djinn Agent 才会连接 AI。" />
          ) : (
            <Collapse
              accordion={false}
              className="ai-config-collapse"
              items={configs.map((item, index) => ({
                key: item.id,
                className: item.enabled ? 'ai-config-panel-enabled' : undefined,
                label: <Space><Typography.Text strong>{item.name || `AI 配置 ${index + 1}`}</Typography.Text><Tag>{item.provider === 'anthropic' ? 'Anthropic 兼容接口' : 'OpenAI 兼容接口'}</Tag>{item.enabled && <Tag color="success">已启用</Tag>}</Space>,
                extra: (
                  <Space onClick={(event) => event.stopPropagation()}>
                    <Switch className="ai-config-switch" size="small" checked={item.enabled} onChange={(checked) => toggleConfig(item.id, checked)} />
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeConfig(item.id)} />
                  </Space>
                ),
                children: (
                  <Form layout="vertical" className="ai-settings-form">
                    <Form.Item label="配置名称">
                      <Input value={item.name} placeholder="例如：Claude 中转" onChange={(event) => updateConfig(item.id, { name: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="接口类型">
                      <Select popupClassName="ai-settings-select-popup" value={item.provider ?? 'openai-compatible'} options={[{ label: 'OpenAI 兼容接口', value: 'openai-compatible' }, { label: 'Anthropic 兼容接口', value: 'anthropic' }]} onChange={(value) => updateConfig(item.id, { provider: value })} />
                    </Form.Item>
                    <Form.Item label="Base URL" required>
                      <Input value={item.base_url} placeholder="例如：https://api.openai.com/v1" onChange={(event) => updateConfig(item.id, { base_url: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="API Key" required>
                      <Input.Password value={item.api_key} onChange={(event) => updateConfig(item.id, { api_key: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="Model" required>
                      <Input value={item.model} placeholder="例如：claude-sonnet-4-6 或 gpt-4o-mini" onChange={(event) => updateConfig(item.id, { model: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="最大上下文" required extra="这里按 k 单位填写真实最大上下文，例如填 200 表示 200k，填 1000 表示 1M。">
                      <InputNumber
                        min={1}
                        step={1}
                        className="full-width"
                        value={typeof item.max_context_tokens === 'number' && item.max_context_tokens > 0 ? item.max_context_tokens / 1000 : undefined}
                        placeholder="例如：200"
                        formatter={(value) => value === undefined || value === null ? '' : `${value}`}
                        parser={(value) => {
                          const normalized = String(value ?? '').replace(/[^\d.]/g, '')
                          return normalized ? Number(normalized) : 0
                        }}
                        onChange={(value) => {
                          updateConfig(item.id, {
                            max_context_tokens: typeof value === 'number' && Number.isFinite(value) && value > 0
                              ? Math.max(1000, Math.round(value) * 1000)
                              : undefined
                          })
                        }}
                      />
                    </Form.Item>
                  </Form>
                )
              }))}
            />
          )}
          {testResult && <Alert type={testResult.success ? 'success' : 'error'} showIcon message={testResult.message} />}
          <Space className="ai-settings-actions">
            <Button type="primary" className="ai-settings-primary-btn" onClick={() => void saveConfigs().then(() => setSettingsOpen(false))}>保存</Button>
            <Button className="ai-panel-ghost-btn" loading={testing} onClick={() => void testAI()}>测试连接</Button>
          </Space>
        </Space>
      </Modal>
    </div>
  )
}
