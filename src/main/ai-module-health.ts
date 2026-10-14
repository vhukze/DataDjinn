export type AiModuleProcessOutcome =
  | { type: 'error'; error: Error }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }

type WaitForAiModuleHealthOptions = {
  checkHealth: () => Promise<boolean>
  processOutcome: Promise<AiModuleProcessOutcome>
  timeoutMs: number
  intervalMs: number
  logPath: string
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export const waitForAiModuleHealth = async ({
  checkHealth,
  processOutcome,
  timeoutMs,
  intervalMs,
  logPath
}: WaitForAiModuleHealthOptions): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  const throwProcessFailure = (outcome: AiModuleProcessOutcome): never => {
    if (outcome.type === 'error') {
      throw new Error(`AI 模块进程启动失败：${outcome.error.message}；日志：${logPath}`)
    }
    const signal = outcome.signal ? `，信号 ${outcome.signal}` : ''
    throw new Error(
      `AI 模块在健康检查通过前退出（退出码 ${outcome.code ?? '未知'}${signal}）；日志：${logPath}`
    )
  }

  while (Date.now() < deadline) {
    const result = await Promise.race([
      checkHealth().then((healthy) => ({ type: 'health' as const, healthy })),
      processOutcome.then((outcome) => ({ type: 'process' as const, outcome }))
    ])

    if (result.type === 'health' && result.healthy) {
      return
    }
    if (result.type === 'process') {
      throwProcessFailure(result.outcome)
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs > 0) {
      const next = await Promise.race([
        processOutcome.then((outcome) => ({ type: 'process' as const, outcome })),
        delay(Math.min(intervalMs, remainingMs)).then(() => ({ type: 'retry' as const }))
      ])
      if (next.type === 'process') {
        throwProcessFailure(next.outcome)
      }
    }
  }

  throw new Error(
    `AI 模块启动超时（${Math.ceil(timeoutMs / 1000)} 秒内未通过健康检查），请检查设置 -> 扩展或日志：${logPath}`
  )
}
