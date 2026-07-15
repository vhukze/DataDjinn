const { test, expect, _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..', '..')
const packagedExecutable = path.join(projectRoot, 'dist', 'win-unpacked', 'DataDjinn.exe')
const regressionRootDir = path.join(projectRoot, '.tmp', 'regression-user-data')

test('packaged build should start with the bundled offline backend @smoke', async () => {
  test.skip(!fs.existsSync(packagedExecutable), '需要先生成 Windows 解包产物')

  const pointer = JSON.parse(fs.readFileSync(path.join(regressionRootDir, 'current.json'), 'utf-8'))
  const electronApp = await electron.launch({
    executablePath: packagedExecutable,
    env: {
      ...process.env,
      DATADJINN_TEST_RUN_ROOT: regressionRootDir,
      DATADJINN_TEST_USER_DATA_DIR: pointer.current_user_data_dir,
      DATADJINN_SKIP_SPLASH: '1'
    }
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForSelector('.resource-tree-shell', { timeout: 60000 })
    await expect
      .poll(() => page.evaluate(async () => (await window.api.getBackendStatus()).state), {
        timeout: 60000
      })
      .toBe('online')
    await page.waitForSelector('.app-shell[data-startup-ready="true"]', { timeout: 60000 })
  } finally {
    await electronApp.close()
  }
})
