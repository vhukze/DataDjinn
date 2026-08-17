import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Collapse, Flex, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'

type AIConfig = {
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

const createAIConfigItem = (config?: Partial<AIConfigItem>): AIConfigItem => ({
  id: config?.id ?? crypto.randomUUID(),
  name: config?.name ?? 'AI 配置',
  enabled: config?.enabled ?? false,
  provider: config?.provider ?? 'openai-compatible',
  base_url: config?.base_url ?? '',
  api_key: config?.api_key ?? '',
  model: config?.model ?? '',
  max_context_tokens:
    typeof config?.max_context_tokens === 'number' && config.max_context_tokens > 0
      ? Math.round(config.max_context_tokens)
      : undefined
})

const activeAIConfig = (configs: AIConfigItem[]): AIConfig | null => {
  const active = configs.find((item) => item.enabled)
  return active?.base_url && active.api_key && active.model && active.max_context_tokens
    ? {
        provider: active.provider ?? 'openai-compatible',
        base_url: active.base_url,
        api_key: active.api_key,
        model: active.model,
        max_context_tokens: active.max_context_tokens
      }
    : null
}

type AISettingsPanelProps = {
  installed: boolean
  installing: boolean
  onInstall: () => void
}

export default function AISettingsPanel({
  installed,
  installing,
  onInstall
}: AISettingsPanelProps): React.JSX.Element {
  const [configs, setConfigs] = useState<AIConfigItem[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const loadConfigs = async (): Promise<void> => {
    const [storedConfigs, legacyConfig] = await Promise.all([window.api.getAIConfigs(), window.api.getAIConfig()])
    const nextConfigs =
      storedConfigs.length > 0
        ? storedConfigs.map((item) => createAIConfigItem(item))
        : legacyConfig
          ? [createAIConfigItem({ ...legacyConfig, name: legacyConfig.model || '默认 AI', enabled: true })]
          : []
    setConfigs(nextConfigs)
    if (storedConfigs.length === 0 && nextConfigs.length > 0) {
      await window.api.setAIConfigs(nextConfigs)
    }
  }

  useEffect(() => {
    if (installed) {
      void loadConfigs()
    }
  }, [installed])

  const saveConfigs = async (nextConfigs = configs): Promise<AIConfigItem[]> => {
    const saved = await window.api.setAIConfigs(nextConfigs)
    setConfigs(saved)
    window.dispatchEvent(new CustomEvent('datadjinn-ai-configs-changed'))
    return saved
  }

  const updateConfig = (id: string, patch: Partial<AIConfigItem>): void => {
    setConfigs((current) => current.map((item) => item.id === id ? createAIConfigItem({ ...item, ...patch }) : item))
  }

  const testAI = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const next = activeAIConfig(await saveConfigs())
      if (!next) {
        throw new Error('请先启用一条完整的 AI 配置')
      }
      const result = await window.api.requestJson<{ success: boolean; message: string }>('/ai/ping', {
        method: 'POST',
        body: JSON.stringify({ config: next })
      })
      setTestResult({ success: result.success, message: result.message || (result.success ? 'AI 配置可用' : 'AI 配置不可用') })
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : '测试连接失败' })
    } finally {
      setTesting(false)
    }
  }

  if (!installed) {
    return (
      <Alert
        type="info"
        showIcon
        message="AI 助手模块尚未安装"
        description="AI 配置和历史会话会继续保留在本机。安装模块后会自动恢复，无需重新填写。"
        action={
          <Button type="primary" loading={installing} disabled={installing} onClick={onInstall}>
            {installing ? '安装中' : '安装 AI 助手'}
          </Button>
        }
      />
    )
  }

  return (
    <Space direction="vertical" className="full-width ai-settings-body" size="middle">
      <Flex justify="space-between" align="center" className="ai-settings-toolbar">
        <Typography.Text type="secondary">可添加多个 OpenAI 或 Anthropic 兼容配置，同一时间最多启用一个。</Typography.Text>
        <Button className="ai-panel-ghost-btn ai-settings-add-btn" icon={<PlusOutlined />} onClick={() => setConfigs((current) => [...current, createAIConfigItem({ name: `AI 配置 ${current.length + 1}` })])}>
          添加配置
        </Button>
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
            extra: <Space onClick={(event) => event.stopPropagation()}><Switch className="ai-config-switch" size="small" checked={item.enabled} onChange={(enabled) => setConfigs((current) => current.map((config) => ({ ...config, enabled: enabled && config.id === item.id })))} /><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => setConfigs((current) => current.filter((config) => config.id !== item.id))} /></Space>,
            children: <Form layout="vertical" className="ai-settings-form">
              <Form.Item label="配置名称"><Input value={item.name} placeholder="例如：Claude 中转" onChange={(event) => updateConfig(item.id, { name: event.target.value })} /></Form.Item>
              <Form.Item label="接口类型"><Select popupClassName="ai-settings-select-popup" value={item.provider ?? 'openai-compatible'} options={[{ label: 'OpenAI 兼容接口', value: 'openai-compatible' }, { label: 'Anthropic 兼容接口', value: 'anthropic' }]} onChange={(provider) => updateConfig(item.id, { provider })} /></Form.Item>
              <Form.Item label="Base URL" required><Input value={item.base_url} placeholder="例如：https://api.openai.com/v1" onChange={(event) => updateConfig(item.id, { base_url: event.target.value })} /></Form.Item>
              <Form.Item label="API Key" required><Input.Password className="ai-settings-api-key-input" value={item.api_key} onChange={(event) => updateConfig(item.id, { api_key: event.target.value })} /></Form.Item>
              <Form.Item label="Model" required><Input value={item.model} placeholder="例如：gpt-4o-mini" onChange={(event) => updateConfig(item.id, { model: event.target.value })} /></Form.Item>
              <Form.Item label="最大上下文" required extra="按 k 填写真实最大上下文，例如 200 代表 200k。"><InputNumber min={1} step={1} className="full-width" value={item.max_context_tokens ? item.max_context_tokens / 1000 : undefined} placeholder="例如：200" onChange={(value) => updateConfig(item.id, { max_context_tokens: typeof value === 'number' && value > 0 ? Math.max(1000, Math.round(value) * 1000) : undefined })} /></Form.Item>
            </Form>
          }))}
        />
      )}
      {testResult && <Alert type={testResult.success ? 'success' : 'error'} showIcon message={testResult.message} />}
      <Space className="ai-settings-actions">
        <Button type="primary" className="ai-settings-primary-btn" onClick={() => void saveConfigs()}>保存</Button>
        <Button className="ai-panel-ghost-btn" loading={testing} onClick={() => void testAI()}>测试连接</Button>
      </Space>
    </Space>
  )
}
