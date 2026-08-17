const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const electronEntry = path.join(projectRoot, 'out', 'main', 'index.js')
const regressionRootDir = path.join(projectRoot, '.tmp', 'regression-user-data')
const outputDir = path.join(projectRoot, 'docs', 'images')
const fixtureConnectionId = 'regression-sqlite-fixture'

function readFixtureUserDataDir() {
  const pointerPath = path.join(regressionRootDir, 'current.json')
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'))
  return pointer.current_user_data_dir
}

async function waitForAppReady(page) {
  await page.waitForSelector('.resource-tree-shell', { timeout: 60000 })
  await page.waitForFunction(
    () => document.querySelector('.app-shell[data-startup-ready="true"]') !== null,
    undefined,
    { timeout: 60000 }
  )
  await page.waitForFunction(
    async () => (await window.api.getBackendStatus()).state === 'online',
    undefined,
    { timeout: 60000 }
  )
}

async function clickVisibleMenuItem(page, text) {
  const target = page.locator('.ant-dropdown:visible .ant-dropdown-menu-item').filter({ hasText: text })
  await target.first().click({ timeout: 10000 })
}

async function doubleClickTreeNode(page, key) {
  await page.evaluate((targetKey) => {
    const title = document.querySelector(
      `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
    )
    if (!(title instanceof HTMLElement)) {
      throw new Error(`Tree node not found: ${targetKey}`)
    }
    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
  }, key)
}

async function openFixtureTable(page) {
  const connectionKey = `connection:${fixtureConnectionId}`
  const tableGroupKey = `object-group:${fixtureConnectionId}:::table`
  const tableKey = `table:${fixtureConnectionId}:::table:small_items`
  await doubleClickTreeNode(page, connectionKey)
  await page.locator(`.resource-tree-node-title[data-tree-node-key="${tableGroupKey}"]`).waitFor({
    state: 'visible',
    timeout: 30000
  })
  await doubleClickTreeNode(page, tableGroupKey)
  await page.locator(`.resource-tree-node-title[data-tree-node-key="${tableKey}"]`).waitFor({
    state: 'visible',
    timeout: 30000
  })
  await doubleClickTreeNode(page, tableKey)
  await page.locator('.workspace-active-content .result-table .ant-table-thead').waitFor({
    state: 'visible',
    timeout: 30000
  })
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  const app = await electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      DATADJINN_TEST_RUN_ROOT: regressionRootDir,
      DATADJINN_TEST_USER_DATA_DIR: readFixtureUserDataDir(),
      DATADJINN_SKIP_SPLASH: '1'
    }
  })

  try {
    const page = await app.firstWindow()
    await waitForAppReady(page)
    await page.screenshot({ path: path.join(outputDir, 'v0.3.0-workspace.png') })

    await openFixtureTable(page)
    await page.screenshot({ path: path.join(outputDir, 'v0.3.0-table-preview.png') })

    await page.locator('.resource-header .resource-add').click()
    await clickVisibleMenuItem(page, 'MySQL')
    await page.locator('.connection-editor-modal').waitFor({ state: 'visible', timeout: 10000 })
    await page.screenshot({ path: path.join(outputDir, 'v0.3.0-connection-editor.png') })
    await page.locator('.connection-editor-modal .ant-modal-close').click()

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await settingsModal.waitFor({ state: 'visible', timeout: 10000 })
    await settingsModal.getByRole('menuitem', { name: '扩展' }).click()
    await page.screenshot({ path: path.join(outputDir, 'v0.3.0-extensions.png') })
    await settingsModal.getByRole('menuitem', { name: '同步与版本' }).click()
    await page.screenshot({ path: path.join(outputDir, 'v0.3.0-sync.png') })
  } finally {
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
