import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

type InstallerUpdateLauncherOptions = {
  installerPath: string
  installerArgs?: string[]
  targetPid: number
  launcherPath: string
}

export const createInstallerExitWaitScript = ({
  installerPath,
  installerArgs,
  targetPid
}: Omit<InstallerUpdateLauncherOptions, 'launcherPath'>): string => {
  const escapedInstallerPath = installerPath.replace(/'/g, "''")
  const escapedInstallerArgs = installerArgs?.map((argument) => `'${argument.replace(/'/g, "''")}'`)
  const startInstallerCommand =
    escapedInstallerArgs?.length
      ? `Start-Process -FilePath '${escapedInstallerPath}' -ArgumentList @(${escapedInstallerArgs.join(', ')})`
      : `Start-Process -FilePath '${escapedInstallerPath}'`

  return [
    `while ($null -ne (Get-Process -Id ${targetPid} -ErrorAction SilentlyContinue)) {`,
    '  Start-Sleep -Milliseconds 250',
    '}',
    startInstallerCommand,
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue'
  ].join('\r\n')
}

export const launchInstallerAfterProcessExit = async ({
  installerPath,
  installerArgs,
  targetPid,
  launcherPath
}: InstallerUpdateLauncherOptions): Promise<void> => {
  await writeFile(
    launcherPath,
    createInstallerExitWaitScript({ installerPath, installerArgs, targetPid }),
    'utf8'
  )

  const launcherProcess = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      launcherPath
    ],
    {
      stdio: 'ignore',
      windowsHide: true
    }
  )

  if (launcherProcess.pid !== undefined) {
    launcherProcess.unref()
    return
  }

  await new Promise<void>((resolve, reject) => {
    launcherProcess.once('error', reject)
    launcherProcess.once('spawn', () => {
      launcherProcess.unref()
      resolve()
    })
  })
}
