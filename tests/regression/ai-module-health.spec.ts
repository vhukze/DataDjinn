import { expect, test } from '@playwright/test'
import { waitForAiModuleHealth } from '../../src/main/ai-module-health'

test('AI module startup should report process failures promptly and preserve timeout diagnostics @bug', async () => {
  const common = {
    checkHealth: async () => false,
    timeoutMs: 5_000,
    intervalMs: 10,
    logPath: 'ai-module.log'
  }

  await expect(
    waitForAiModuleHealth({
      ...common,
      processOutcome: Promise.resolve({ type: 'exit' as const, code: 7, signal: null })
    })
  ).rejects.toThrow(/退出码 7.*ai-module\.log/)

  await expect(
    waitForAiModuleHealth({
      ...common,
      processOutcome: Promise.resolve({ type: 'error' as const, error: new Error('spawn denied') })
    })
  ).rejects.toThrow(/spawn denied.*ai-module\.log/)

  await expect(
    waitForAiModuleHealth({
      ...common,
      checkHealth: async () => true,
      processOutcome: new Promise(() => undefined)
    })
  ).resolves.toBeUndefined()

  await expect(
    waitForAiModuleHealth({
      ...common,
      timeoutMs: 20,
      processOutcome: new Promise(() => undefined)
    })
  ).rejects.toThrow(/启动超时.*ai-module\.log/)
})
