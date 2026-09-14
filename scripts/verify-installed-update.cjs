const { spawnSync } = require('node:child_process')
const path = require('node:path')

if (process.platform !== 'win32') throw new Error('真实安装升级验证必须在 Windows 执行')
const root = path.resolve(__dirname, '..')
const run = (entry, args, env = process.env) => {
  const result = spawnSync(process.execPath, [require.resolve(entry), ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const baselineDir = path.join(root, '.tmp/update-gate-baseline')
let baseline = process.env.DATADJINN_UPDATE_BASE_INSTALLER
if (!baseline) {
  // Test fixture version only; source and release version numbers are untouched.
  run('electron-builder/cli.js', ['--win', 'nsis', '--publish', 'never', '--config.extraMetadata.version=0.0.0', `--config.directories.output=${baselineDir}`])
  baseline = path.join(baselineDir, 'DataDjinn-0.0.0-setup.exe')
}
run('@playwright/test/cli', ['test', '-c', 'playwright.regression.config.js', 'tests/regression/installed-update.spec.ts'], {
  ...process.env,
  DATADJINN_RUN_INSTALLED_UPDATE: '1',
  DATADJINN_TEST_SILENT_UPDATE: '1',
  DATADJINN_UPDATE_BASE_INSTALLER: baseline
})
