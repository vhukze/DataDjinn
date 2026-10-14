import { app } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { AddressInfo, createServer } from 'net'
import { dirname, join } from 'path'
import { waitForAiModuleHealth, type AiModuleProcessOutcome } from './ai-module-health'

type AiModuleLaunchConfig = {
  command: string
  args: string[]
}

const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_INTERVAL_MS = 250

const getFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })

export class AiModuleManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private apiBaseUrl: string | null = null
  private startPromise: Promise<string> | null = null
  private readonly apiToken = randomBytes(32).toString('base64url')

  getRequestHeaders(): Record<string, string> {
    return { 'X-DataDjinn-Api-Token': this.apiToken }
  }

  async ensureOnline(config: AiModuleLaunchConfig): Promise<string> {
    if (this.process && this.apiBaseUrl && (await this.isHealthy(this.apiBaseUrl))) {
      return this.apiBaseUrl
    }

    if (!this.startPromise) {
      this.startPromise = this.start(config).finally(() => {
        this.startPromise = null
      })
    }
    return this.startPromise
  }

  async stop(): Promise<void> {
    const current = this.process
    this.process = null
    this.apiBaseUrl = null
    if (!current) {
      return
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (current.pid) {
          spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { windowsHide: true })
        } else {
          current.kill()
        }
        resolve()
      }, 3_000)
      current.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      if (process.platform === 'win32' && current.pid) {
        spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { windowsHide: true })
      } else {
        current.kill()
      }
    })
  }

  async recover(): Promise<void> {
    await this.stop()
  }

  private async start(config: AiModuleLaunchConfig): Promise<string> {
    await this.stop()
    if (!existsSync(config.command)) {
      throw new Error(`AI 模块启动文件不存在：${config.command}`)
    }

    const port = await getFreePort()
    const apiBaseUrl = `http://127.0.0.1:${port}/api`
    const logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, 'ai-module.log')
    const logStream = createWriteStream(logPath, { flags: 'a' })
    const child = spawn(config.command, config.args, {
      cwd: dirname(config.command),
      windowsHide: true,
      env: {
        ...process.env,
        DATADJINN_AI_MODULE_PORT: String(port),
        DATADJINN_DATA_DIR: app.getPath('userData'),
        DATADJINN_API_TOKEN: this.apiToken,
        DATADJINN_PARENT_PID: String(process.pid),
        PYTHONIOENCODING: 'utf-8'
      }
    })
    const processOutcome = new Promise<AiModuleProcessOutcome>((resolve) => {
      child.once('error', (error) => {
        if (this.process === child) {
          this.process = null
          this.apiBaseUrl = null
        }
        resolve({ type: 'error', error })
      })
      child.once('exit', (code, signal) => resolve({ type: 'exit', code, signal }))
    })
    this.process = child
    this.apiBaseUrl = apiBaseUrl
    child.stdout.pipe(logStream)
    child.stderr.pipe(logStream)
    child.once('close', () => logStream.end())
    child.once('exit', () => {
      if (this.process === child) {
        this.process = null
        this.apiBaseUrl = null
      }
    })

    try {
      await waitForAiModuleHealth({
        checkHealth: () => this.isHealthy(apiBaseUrl),
        processOutcome,
        timeoutMs: HEALTH_TIMEOUT_MS,
        intervalMs: HEALTH_INTERVAL_MS,
        logPath
      })
    } catch (error) {
      await this.stop()
      throw error
    }
    return apiBaseUrl
  }

  private async isHealthy(apiBaseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${apiBaseUrl}/health`, {
        signal: AbortSignal.timeout(1_000)
      })
      return response.ok
    } catch {
      return false
    }
  }
}
