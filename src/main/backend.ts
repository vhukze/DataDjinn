import { BrowserWindow, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { get } from 'http'
import { join } from 'path'
import { AddressInfo, createServer } from 'net'

export type BackendState = 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'

export type BackendStatus = {
  state: BackendState
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
}

const HEALTH_TIMEOUT_MS = 15000
const HEALTH_INTERVAL_MS = 500

export class BackendManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private status: BackendStatus = { state: 'stopped' }
  private port = 8000
  private stopping = false

  getStatus(): BackendStatus {
    return { ...this.status }
  }

  async start(): Promise<BackendStatus> {
    if (this.process || this.status.state === 'starting' || this.status.state === 'online') {
      return this.getStatus()
    }

    this.stopping = false
    this.port = await getFreePort()
    const apiBaseUrl = `http://127.0.0.1:${this.port}/api`
    const logPath = this.getLogPath()
    const command = this.getBackendCommand()

    if (!existsSync(command.command)) {
      this.setStatus({ state: 'failed', apiBaseUrl, message: `后端启动文件不存在：${command.command}`, logPath })
      return this.getStatus()
    }

    mkdirSync(join(app.getPath('userData'), 'logs'), { recursive: true })
    this.setStatus({ state: 'starting', apiBaseUrl, message: '后端启动中', logPath })

    const logStream = createWriteStream(logPath, { flags: 'a' })
    this.process = spawn(command.command, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        DATADJINN_BACKEND_PORT: String(this.port),
        DATADJINN_BACKEND_RELOAD: is.dev ? '1' : '0',
        DATADJINN_DATA_DIR: app.getPath('userData'),
        PYTHONIOENCODING: 'utf-8'
      }
    })

    this.process.stdout.pipe(logStream)
    this.process.stderr.pipe(logStream)

    this.process.on('exit', (code) => {
      logStream.end()
      this.process = null

      if (this.stopping) {
        this.setStatus({ state: 'stopped', apiBaseUrl, message: '后端已停止', logPath })
        return
      }

      this.setStatus({ state: 'crashed', apiBaseUrl, message: `后端异常退出，退出码：${code ?? 'unknown'}`, logPath })
    })

    const healthy = await this.waitForHealth(apiBaseUrl)
    if (!healthy) {
      this.setStatus({ state: 'failed', apiBaseUrl, pid: this.process?.pid, message: '后端启动超时，请查看日志', logPath })
      return this.getStatus()
    }

    this.setStatus({ state: 'online', apiBaseUrl, pid: this.process?.pid, message: '后端已就绪', logPath })
    return this.getStatus()
  }

  async restart(): Promise<BackendStatus> {
    await this.stop()
    return this.start()
  }

  async stop(): Promise<void> {
    const current = this.process
    if (!current) {
      this.setStatus({ ...this.status, state: 'stopped', message: '后端已停止' })
      return
    }

    this.stopping = true
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (current.pid) {
          spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { windowsHide: true })
        } else {
          current.kill()
        }
        resolve()
      }, 3000)

      current.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })

      current.kill()
    })
  }

  private getBackendCommand(): { command: string; args: string[]; cwd: string } {
    if (is.dev) {
      const backendDir = join(process.cwd(), 'backend')
      return {
        command: join(backendDir, '.venv', 'Scripts', 'python.exe'),
        args: [join(backendDir, 'run.py')],
        cwd: backendDir
      }
    }

    const backendDir = join(process.resourcesPath, 'backend')
    return {
      command: join(backendDir, 'datadjinn-backend.exe'),
      args: [],
      cwd: backendDir
    }
  }

  private getLogPath(): string {
    return join(app.getPath('userData'), 'logs', 'backend.log')
  }

  private async waitForHealth(apiBaseUrl: string): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (await checkHealth(`${apiBaseUrl}/health`)) {
        return true
      }

      await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS))
    }

    return false
  }

  private setStatus(status: BackendStatus): void {
    this.status = status
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('backend-status-changed', this.getStatus())
    }
  }
}

const checkHealth = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    })

    request.on('error', () => resolve(false))
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(false)
    })
  })

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      const port = address.port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })

export const backendManager = new BackendManager()
