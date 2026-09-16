import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  replaceOptionalModuleDirectory,
  movePendingOptionalModuleDirectory,
  withOptionalModuleReplacementLock
} from '../../src/main/optional-module-replacement'
import { isOptionalModuleUpdateAvailable } from '../../src/main/optional-module-version'

test('待替换版本已等于线上版本时不应继续提示 MCP 更新 @bug', () => {
  expect(isOptionalModuleUpdateAvailable('1.0.4', '1.0.6', '1.0.6')).toBe(false)
  expect(isOptionalModuleUpdateAvailable('1.0.4', '1.0.5', '1.0.6')).toBe(true)
})

test('MCP 待替换目录不存在时必须保留旧 current 目录 @bug', async () => {
  const moduleRoot = await mkdtemp(join(tmpdir(), 'datadjinn-module-replacement-'))
  const currentPath = join(moduleRoot, 'current')
  try {
    await mkdir(currentPath)
    await writeFile(join(currentPath, 'datadjinn-mcp.exe'), 'old-module', 'utf-8')

    await expect(
      replaceOptionalModuleDirectory(join(moduleRoot, '.pending-missing'), currentPath)
    ).rejects.toThrow('待替换的扩展目录不存在')

    await expect(readFile(join(currentPath, 'datadjinn-mcp.exe'), 'utf-8')).resolves.toBe('old-module')
  } finally {
    await rm(moduleRoot, { recursive: true, force: true })
  }
})

test('同一 MCP 模块的后台重试和立即替换必须串行执行 @bug', async () => {
  const executionOrder: string[] = []
  let allowFirstReplacement: (() => void) | undefined
  const firstReplacementBlocked = new Promise<void>((resolvePromise) => {
    allowFirstReplacement = resolvePromise
  })
  let firstReplacementStarted: (() => void) | undefined
  const firstReplacementRunning = new Promise<void>((resolvePromise) => {
    firstReplacementStarted = resolvePromise
  })

  const backgroundRetry = withOptionalModuleReplacementLock('mcp', async () => {
    executionOrder.push('background-start')
    firstReplacementStarted?.()
    await firstReplacementBlocked
    executionOrder.push('background-end')
  })
  await firstReplacementRunning
  const forceReplacement = withOptionalModuleReplacementLock('mcp', async () => {
    executionOrder.push('force')
  })

  await Promise.resolve()
  expect(executionOrder).toEqual(['background-start'])
  allowFirstReplacement?.()
  await Promise.all([backgroundRetry, forceReplacement])
  expect(executionOrder).toEqual(['background-start', 'background-end', 'force'])
})

test('MCP 成功替换后仅保留稳定 current 目录 @bug', async () => {
  const moduleRoot = await mkdtemp(join(tmpdir(), 'datadjinn-module-replacement-'))
  const currentPath = join(moduleRoot, 'current')
  const pendingPath = join(moduleRoot, '.pending-1.0.3')
  try {
    await mkdir(currentPath)
    await mkdir(pendingPath)
    await writeFile(join(currentPath, 'datadjinn-mcp.exe'), 'old-module', 'utf-8')
    await writeFile(join(pendingPath, 'datadjinn-mcp.exe'), 'new-module', 'utf-8')

    await replaceOptionalModuleDirectory(pendingPath, currentPath)

    await expect(readFile(join(currentPath, 'datadjinn-mcp.exe'), 'utf-8')).resolves.toBe('new-module')
    expect(existsSync(pendingPath)).toBe(false)
  } finally {
    await rm(moduleRoot, { recursive: true, force: true })
  }
})

test('MCP 暂存目录移动使用可重试的安全移动 @bug', async () => {
  const moduleRoot = await mkdtemp(join(tmpdir(), 'datadjinn-module-pending-'))
  const sourcePath = join(moduleRoot, '.install')
  const pendingPath = join(moduleRoot, '.pending-1.0.4')
  try {
    await mkdir(sourcePath)
    await writeFile(join(sourcePath, 'module.json'), '{}', 'utf-8')
    await movePendingOptionalModuleDirectory(sourcePath, pendingPath)
    expect(existsSync(sourcePath)).toBe(false)
    await expect(readFile(join(pendingPath, 'module.json'), 'utf-8')).resolves.toBe('{}')
  } finally {
    await rm(moduleRoot, { recursive: true, force: true })
  }
})
