import { expect, test } from '@playwright/test'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { launchInstallerAfterProcessExit } from '../../src/main/installer-update-launcher'

test('installer launcher starts the installer only after the target process exits @smoke', async () => {
  test.skip(process.platform !== 'win32', '仅在 Windows 安装器环境运行')

  const tempDir = await mkdtemp(join(tmpdir(), 'datadjinn-update-launcher-'))
  const installerPath = process.execPath
  const installerScriptPath = join(tempDir, 'fake-installer.js')
  const launcherPath = join(tempDir, 'wait-for-exit.ps1')
  const markerPath = join(tempDir, 'installer-started.txt')
  const heldProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    windowsHide: true
  })

  try {
    expect(heldProcess.pid).toBeDefined()
    await writeFile(
      installerScriptPath,
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'started')`,
      'utf8'
    )

    await launchInstallerAfterProcessExit({
      installerPath,
      installerArgs: [installerScriptPath],
      targetPid: heldProcess.pid!,
      launcherPath
    })

    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(existsSync(markerPath)).toBe(false)

    const heldProcessExited = once(heldProcess, 'exit')
    const stopProcess = spawn('taskkill', ['/pid', String(heldProcess.pid), '/t', '/f'], {
      windowsHide: true
    })
    await once(stopProcess, 'close')
    await heldProcessExited
    await expect.poll(() => existsSync(markerPath), { timeout: 10000 }).toBe(true)
  } finally {
    if (heldProcess.exitCode === null && !heldProcess.killed) {
      heldProcess.kill()
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})
