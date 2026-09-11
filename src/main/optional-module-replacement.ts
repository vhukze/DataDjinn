import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { rename, rm } from 'fs/promises'

const MAX_REPLACE_ATTEMPTS = 8

const replacementLocks = new Map<string, Promise<void>>()

export const withOptionalModuleReplacementLock = async <T>(
  moduleId: string,
  operation: () => Promise<T>
): Promise<T> => {
  const previous = replacementLocks.get(moduleId) ?? Promise.resolve()
  let release: (() => void) | undefined
  const completed = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  const queued = previous.catch(() => undefined).then(() => completed)
  replacementLocks.set(moduleId, queued)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release?.()
    if (replacementLocks.get(moduleId) === queued) {
      replacementLocks.delete(moduleId)
    }
  }
}

export const replaceOptionalModuleDirectory = async (
  temporaryPath: string,
  installPath: string
): Promise<void> => {
  if (!existsSync(temporaryPath)) {
    throw new Error(`替换扩展模块文件失败，待替换的扩展目录不存在：${temporaryPath}`)
  }
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_REPLACE_ATTEMPTS; attempt += 1) {
    const backupPath = `${installPath}.old-${randomBytes(6).toString('hex')}`
    let movedCurrentToBackup = false
    try {
      if (existsSync(installPath)) {
        await rename(installPath, backupPath)
        movedCurrentToBackup = true
      }
      await rename(temporaryPath, installPath)
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
      return
    } catch (error) {
      lastError = error
      // Keep the prior current path runnable if moving the new directory fails.
      if (movedCurrentToBackup && !existsSync(installPath) && existsSync(backupPath)) {
        try {
          await rename(backupPath, installPath)
        } catch (rollbackError) {
          lastError = rollbackError
        }
      }
      if (!existsSync(temporaryPath)) {
        break
      }
      if (attempt < MAX_REPLACE_ATTEMPTS) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 250))
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(`替换扩展模块文件失败，请关闭占用该模块的程序后重试：${detail}`)
}

/** Windows can briefly deny a rename immediately after archive extraction. */
export const movePendingOptionalModuleDirectory = async (
  temporaryPath: string,
  pendingPath: string
): Promise<void> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_REPLACE_ATTEMPTS; attempt += 1) {
    try {
      await rename(temporaryPath, pendingPath)
      return
    } catch (error) {
      lastError = error
      if (attempt < MAX_REPLACE_ATTEMPTS) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 300))
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(`MCP 更新文件暂存失败，请稍后重试：${detail}`)
}
