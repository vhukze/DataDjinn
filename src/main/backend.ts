import { BrowserWindow, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'fs'
import { randomBytes } from 'crypto'
import { get } from 'http'
import { dirname, join } from 'path'
import { AddressInfo, createServer } from 'net'

export type BackendState = 'starting' | 'online' | 'failed' | 'stopped' | 'crashed'

export type BackendStatus = {
  state: BackendState
  apiBaseUrl?: string
  pid?: number
  message?: string
  logPath?: string
  restartAttempt?: number
  maxRestartAttempts?: number
}

const HEALTH_TIMEOUT_MS = 15000
const PACKAGED_HEALTH_TIMEOUT_MS = 60000
const HEALTH_INTERVAL_MS = 500
const REQUEST_RECOVERY_HEALTH_TIMEOUT_MS = 8000
const PACKAGED_REQUEST_RECOVERY_HEALTH_TIMEOUT_MS = 15000
const MAX_RESTART_ATTEMPTS = 5
const RESTART_BASE_DELAY_MS = 1000
const RESTART_MAX_DELAY_MS = 10000

type BackendCommand = {
  command: string
  args: string[]
  cwd: string
  checkedPaths?: string[]
  env?: Record<string, string>
}

export class BackendManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private status: BackendStatus = { state: 'stopped' }
  private port = 8000
  private stopping = false
  private suppressStopStatus = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartAttempts = 0
  private startPromise: Promise<BackendStatus> | null = null
  private launchId = 0
  private readonly apiToken = randomBytes(32).toString('base64url')

  getRequestHeaders(): Record<string, string> {
    return { 'X-DataDjinn-Api-Token': this.apiToken }
  }

  private shouldEnableBackendReload(): boolean {
    return is.dev && !process.env.DATADJINN_TEST_USER_DATA_DIR
  }

  private getTestBackendRegistryPath(): string | null {
    const testRunRoot = process.env.DATADJINN_TEST_RUN_ROOT?.trim()
    if (!testRunRoot) {
      return null
    }

    return join(testRunRoot, 'active-backend-pids.json')
  }

  private readRecordedTestBackendPids(): number[] {
    const registryPath = this.getTestBackendRegistryPath()
    if (!registryPath || !existsSync(registryPath)) {
      return []
    }

    try {
      const payload = JSON.parse(readFileSync(registryPath, 'utf-8')) as { pids?: unknown }
      if (!Array.isArray(payload.pids)) {
        return []
      }
      return payload.pids
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    } catch {
      return []
    }
  }

  private writeRecordedTestBackendPids(pids: number[]): void {
    const registryPath = this.getTestBackendRegistryPath()
    if (!registryPath) {
      return
    }

    mkdirSync(dirname(registryPath), { recursive: true })
    writeFileSync(registryPath, JSON.stringify({ pids }, null, 2), 'utf-8')
  }

  private cleanupRecordedTestBackends(): void {
    const recordedPids = this.readRecordedTestBackendPids()
    if (recordedPids.length === 0) {
      return
    }

    for (const pid of recordedPids) {
      if (pid === process.pid) {
        continue
      }
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    }

    this.writeRecordedTestBackendPids([])
  }

  private recordTestBackendPid(pid?: number): void {
    if (!pid) {
      return
    }
    this.writeRecordedTestBackendPids([pid])
  }

  private clearRecordedTestBackendPid(pid?: number): void {
    if (!pid) {
      return
    }

    const remainingPids = this.readRecordedTestBackendPids().filter((item) => item !== pid)
    this.writeRecordedTestBackendPids(remainingPids)
  }

  getStatus(): BackendStatus {
    return { ...this.status }
  }

  async start(): Promise<BackendStatus> {
    if (this.startPromise) {
      return this.startPromise
    }

    const startPromise = this.startInternal()
    this.startPromise = startPromise

    try {
      return await startPromise
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null
      }
    }
  }

  async ensureOnline(): Promise<BackendStatus> {
    let status = this.getStatus()

    if (status.state === 'online' && status.apiBaseUrl) {
      return status
    }

    if (status.state === 'starting' && status.apiBaseUrl && this.process) {
      const healthy = await this.waitForHealth(
        status.apiBaseUrl,
        is.dev ? REQUEST_RECOVERY_HEALTH_TIMEOUT_MS : PACKAGED_REQUEST_RECOVERY_HEALTH_TIMEOUT_MS
      )
      if (healthy && this.process) {
        this.restartAttempts = 0
        this.setStatus({ ...status, state: 'online', pid: this.process.pid, message: '后端已就绪' })
        return this.getStatus()
      }
    }

    status = this.getStatus()
    if (status.state === 'starting') {
      throw new Error(status.message ?? '后端正在启动，请稍候')
    }

    const nextStatus = await this.start()
    if (nextStatus.state === 'online' && nextStatus.apiBaseUrl) {
      return nextStatus
    }

    throw new Error(nextStatus.message ?? '后端服务未就绪')
  }

  recover(reason = '后端请求失败，正在自动重启'): void {
    if (this.stopping || this.status.state === 'starting') {
      return
    }

    this.clearScheduledRestart()
    void this.restart(reason).catch((error) => {
      this.setStatus({
        ...this.getStatus(),
        state: 'failed',
        message: error instanceof Error ? error.message : '后端自动重启失败'
      })
    })
  }

  async restart(reason = '后端重启中'): Promise<BackendStatus> {
    this.clearScheduledRestart()
    this.restartAttempts = 0
    this.setStatus({ ...this.status, state: 'starting', message: reason })
    await this.stop(false)
    return this.start()
  }

  async stop(updateStatus = true): Promise<void> {
    this.clearScheduledRestart()
    const current = this.process
    if (!current) {
      if (updateStatus) {
        this.setStatus({ ...this.status, state: 'stopped', message: '后端已停止' })
      }
      return
    }

    this.stopping = true
    this.suppressStopStatus = !updateStatus
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

      if (process.platform === 'win32' && current.pid) {
        spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { windowsHide: true })
      } else {
        current.kill()
      }
    })
    this.suppressStopStatus = false
  }

  private async startInternal(): Promise<BackendStatus> {
    if (this.process || this.status.state === 'online') {
      return this.getStatus()
    }

    this.clearScheduledRestart()
    this.stopping = false
    this.cleanupRecordedTestBackends()
    this.port = await getFreePort()
    const apiBaseUrl = `http://127.0.0.1:${this.port}/api`
    const logPath = this.getLogPath()
    const command = this.getBackendCommand()

    if (!existsSync(command.command)) {
      this.setStatus({
        state: 'failed',
        apiBaseUrl,
        message: `后端启动文件不存在：${command.command}。${describeBackendLookup(command.checkedPaths ?? [command.command])}`,
        logPath
      })
      return this.getStatus()
    }

    mkdirSync(join(app.getPath('userData'), 'logs'), { recursive: true })
    const launchId = this.launchId + 1
    this.launchId = launchId
    this.setStatus({ state: 'starting', apiBaseUrl, message: '后端启动中', logPath })

    const logStream = createWriteStream(logPath, { flags: 'a' })
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        ...command.env,
        DATADJINN_BACKEND_PORT: String(this.port),
        DATADJINN_BACKEND_RELOAD: this.shouldEnableBackendReload() ? '1' : '0',
        DATADJINN_DATA_DIR: app.getPath('userData'),
        DATADJINN_PARENT_PID: String(process.pid),
        DATADJINN_API_TOKEN: this.apiToken,
        PYTHONIOENCODING: 'utf-8'
      }
    })
    this.process = child
    this.recordTestBackendPid(child.pid)

    child.stdout.pipe(logStream)
    child.stderr.pipe(logStream)

    child.on('exit', (code) => {
      logStream.end()

      if (this.process !== child) {
        return
      }

      this.process = null
      this.clearRecordedTestBackendPid(child.pid)

      if (this.stopping) {
        if (!this.suppressStopStatus) {
          this.setStatus({ state: 'stopped', apiBaseUrl, message: '后端已停止', logPath })
        }
        return
      }

      this.scheduleRestart(`后端异常退出，退出码：${code ?? 'unknown'}`, apiBaseUrl, logPath, code)
    })

    const healthy = await this.waitForHealth(
      apiBaseUrl,
      is.dev ? HEALTH_TIMEOUT_MS : PACKAGED_HEALTH_TIMEOUT_MS
    )
    if (launchId !== this.launchId || !this.process) {
      return this.getStatus()
    }

    if (!healthy) {
      this.setStatus({
        state: 'failed',
        apiBaseUrl,
        pid: this.process.pid,
        message: '后端启动超时，请检查后端日志后手动重试',
        logPath
      })
      // A startup timeout is usually configuration or packaging related. Stop the
      // child completely instead of repeatedly spawning backends in the background.
      await this.stop(false)
      return this.getStatus()
    }

    this.restartAttempts = 0
    this.setStatus({
      state: 'online',
      apiBaseUrl,
      pid: this.process.pid,
      message: '后端已就绪',
      logPath
    })
    return this.getStatus()
  }

  private scheduleRestart(
    reason: string,
    apiBaseUrl?: string,
    logPath?: string,
    exitCode?: number | null
  ): void {
    if (this.stopping || this.restartTimer) {
      return
    }

    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.setStatus({
        state: 'crashed',
        apiBaseUrl,
        message: `${reason}，自动重启次数已达上限`,
        logPath,
        restartAttempt: this.restartAttempts,
        maxRestartAttempts: MAX_RESTART_ATTEMPTS
      })
      return
    }

    const restartAttempt = this.restartAttempts + 1
    const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** this.restartAttempts, RESTART_MAX_DELAY_MS)
    this.restartAttempts = restartAttempt
    this.setStatus({
      state: 'starting',
      apiBaseUrl,
      message: `${reason}，${Math.round(delay / 1000)} 秒后自动重启（第 ${restartAttempt}/${MAX_RESTART_ATTEMPTS} 次）`,
      logPath,
      restartAttempt,
      maxRestartAttempts: MAX_RESTART_ATTEMPTS
    })

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.start().catch((error) => {
        this.setStatus({
          state: 'failed',
          apiBaseUrl,
          message: error instanceof Error ? error.message : '后端自动重启失败',
          logPath,
          restartAttempt,
          maxRestartAttempts: MAX_RESTART_ATTEMPTS
        })
      })
    }, delay)

    void exitCode
  }

  private clearScheduledRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private getBackendCommand(): BackendCommand {
    if (is.dev) {
      const backendDir = join(process.cwd(), 'backend')
      const venvPython =
        process.platform === 'win32'
          ? join(backendDir, '.venv', 'Scripts', 'python.exe')
          : join(backendDir, '.venv', 'bin', 'python')
      const sitePackages = this.resolveVenvSitePackages(backendDir)
      const venvBinDir =
        process.platform === 'win32'
          ? join(backendDir, '.venv', 'Scripts')
          : join(backendDir, '.venv', 'bin')
      const pyvenvCfg = join(backendDir, '.venv', 'pyvenv.cfg')
      const fallbackPython = this.resolveSystemPythonFromVenv(pyvenvCfg)
      const preferFallbackPython = process.platform === 'win32' && Boolean(fallbackPython)
      const command = preferFallbackPython
        ? (fallbackPython ?? venvPython)
        : existsSync(venvPython)
          ? venvPython
          : (fallbackPython ?? venvPython)
      const pathParts = [venvBinDir, process.env.PATH ?? ''].filter(Boolean)
      const pythonEnv = {
        ...(sitePackages ? { PYTHONPATH: sitePackages } : {}),
        ...(existsSync(join(backendDir, '.venv'))
          ? { VIRTUAL_ENV: join(backendDir, '.venv') }
          : {}),
        PATH: pathParts.join(process.platform === 'win32' ? ';' : ':')
      }

      return {
        command,
        args: [join(backendDir, 'run.py')],
        cwd: backendDir,
        checkedPaths: [venvPython, ...(fallbackPython ? [fallbackPython] : [])],
        env: pythonEnv
      }
    }

    const candidates = this.getPackagedBackendCandidates()
    const command = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    return {
      command,
      args: [],
      cwd: dirname(command),
      checkedPaths: candidates
    }
  }

  private getPackagedBackendCandidates(): string[] {
    const backendDir = join(process.resourcesPath, 'backend')
    return [
      join(backendDir, 'datadjinn-backend'),
      join(backendDir, 'datadjinn-backend.exe'),
      join(backendDir, 'datadjinn-backend', 'datadjinn-backend'),
      join(backendDir, 'datadjinn-backend', 'datadjinn-backend.exe'),
      join(backendDir, 'DataDjinnBackend', 'datadjinn-backend'),
      join(backendDir, 'DataDjinnBackend', 'datadjinn-backend.exe'),
      join(process.resourcesPath, 'DataDjinnBackend', 'datadjinn-backend'),
      join(process.resourcesPath, 'DataDjinnBackend', 'datadjinn-backend.exe')
    ]
  }

  private getLogPath(): string {
    return join(app.getPath('userData'), 'logs', 'backend.log')
  }

  private resolveSystemPythonFromVenv(pyvenvCfg: string): string | undefined {
    if (!existsSync(pyvenvCfg)) {
      return undefined
    }

    try {
      const content = readFileSync(pyvenvCfg, 'utf-8')
      const executableLine = content.split(/\r?\n/).find((line) => line.startsWith('executable = '))

      if (!executableLine) {
        return undefined
      }

      const executable = executableLine.slice('executable = '.length).trim()
      return executable || undefined
    } catch {
      return undefined
    }
  }

  private resolveVenvSitePackages(backendDir: string): string | undefined {
    const windowsSitePackages = join(backendDir, '.venv', 'Lib', 'site-packages')
    if (existsSync(windowsSitePackages)) {
      return windowsSitePackages
    }

    const libDir = join(backendDir, '.venv', 'lib')
    if (!existsSync(libDir)) {
      return undefined
    }

    try {
      const versionDir = readdirSync(libDir).find((entry) => entry.startsWith('python'))
      if (!versionDir) {
        return undefined
      }
      const sitePackages = join(libDir, versionDir, 'site-packages')
      return existsSync(sitePackages) ? sitePackages : undefined
    } catch {
      return undefined
    }
  }

  private async waitForHealth(apiBaseUrl: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs

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

const describeBackendLookup = (paths: string[]): string => {
  const checkedPaths = Array.from(new Set(paths))
  return `已检查候选路径：${checkedPaths.join('；')}`
}

export const backendManager = new BackendManager()
