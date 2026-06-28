const { test, expect, _electron: electron } = require('@playwright/test')
const path = require('node:path')
const fs = require('node:fs')

const projectRoot = path.resolve(__dirname, '..', '..')
const electronEntry = path.join(projectRoot, 'out', 'main', 'index.js')
const regressionRootDir = path.join(projectRoot, '.tmp', 'regression-user-data')
const fixtureConnectionId = 'regression-sqlite-fixture'
const smallTableName = 'small_items'
const mediumTableName = 'medium_items'
const largeTableName = 'large_items'

function readFixtureUserDataDir() {
  const pointerPath = path.join(regressionRootDir, 'current.json')
  if (!fs.existsSync(pointerPath)) {
    throw new Error(`Regression pointer not found: ${pointerPath}`)
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'))
  if (!pointer.current_user_data_dir || !fs.existsSync(path.join(pointer.current_user_data_dir, 'connections.json'))) {
    throw new Error(`Regression fixture user data missing: ${pointer.current_user_data_dir ?? 'unknown'}`)
  }
  return pointer.current_user_data_dir
}

async function launchRegressionApp() {
  const userDataDir = readFixtureUserDataDir()
  return electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      DATADJINN_TEST_USER_DATA_DIR: userDataDir,
      DATADJINN_SKIP_SPLASH: '1'
    }
  })
}

async function waitForAppReady(page) {
  await page.waitForSelector('.resource-tree-shell', { timeout: 60000 })
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const status = await window.api.getBackendStatus()
      return status.state
    })
  }, { timeout: 60000 }).toBe('online')
}

function attachPageConsole(page) {
  page.on('console', (message) => {
    console.log(`[page:${message.type()}] ${message.text()}`)
  })
}

async function ensureWindowSize(page) {
  await page.evaluate(() => {
    window.moveTo(0, 0)
    window.resizeTo(1440, 980)
  })
}

function treeNode(page, key) {
  return page.locator(`.resource-tree-node-title[data-tree-node-key="${key}"]`)
}

async function doubleClickTreeNode(page, key) {
  const locator = treeNode(page, key)
  await expect(locator).toBeVisible()
  await locator.dblclick()
}

async function openFixtureConnection(page) {
  await doubleClickTreeNode(page, `connection:${fixtureConnectionId}`)
  await expect(treeNode(page, `object-group:${fixtureConnectionId}:::table`)).toBeVisible({ timeout: 30000 })
}

async function openFixtureTable(page, tableName) {
  await doubleClickTreeNode(page, `table:${fixtureConnectionId}:::table:${tableName}`)
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText(tableName, { timeout: 30000 })
  await expect(page.locator('.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)
}

async function collectLayoutMetrics(page) {
  return page.evaluate(() => {
    const activePane = document.querySelector('.workspace-tab-panels .workspace-active-content')
    const tableShell = activePane?.querySelector('.result-table-shell')
    const tableContent = activePane?.querySelector('.result-table-content')
    const tableBody = activePane?.querySelector('.result-table-body')
    const tableWrapper = activePane?.querySelector('.result-table .ant-table-wrapper')
    const bodyScroll = activePane?.querySelector('.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder')
    const header = activePane?.querySelector('.result-table .ant-table-header')
    const firstRow = activePane?.querySelector('.result-table tbody tr, .result-table .ant-table-tbody-virtual-holder .ant-table-row')
    const horizontalScrollbar = activePane?.querySelector('.result-table-native-horizontal-scrollbar')

    const rect = (element) => {
      if (!element) {
        return null
      }
      const r = element.getBoundingClientRect()
      return {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right
      }
    }

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      activePane: rect(activePane),
      tableShell: rect(tableShell),
      tableContent: rect(tableContent),
      tableBody: rect(tableBody),
      tableWrapper: rect(tableWrapper),
      bodyScroll: rect(bodyScroll),
      header: rect(header),
      firstRow: rect(firstRow),
      horizontalScrollbar: rect(horizontalScrollbar)
    }
  })
}

async function expectTableFillsPane(page, tableName) {
  const metrics = await collectLayoutMetrics(page)
  console.log(`[layout][${tableName}] ${JSON.stringify(metrics)}`)
  expect(metrics.activePane).not.toBeNull()
  expect(metrics.tableShell).not.toBeNull()
  expect(metrics.tableContent).not.toBeNull()
  expect(metrics.tableBody).not.toBeNull()
  expect(metrics.bodyScroll).not.toBeNull()
  expect(metrics.header).not.toBeNull()
  expect(metrics.firstRow).not.toBeNull()

  const paneHeight = metrics.activePane.height
  const shellHeight = metrics.tableShell.height
  const contentHeight = metrics.tableContent.height
  const bodyHeight = metrics.tableBody.height
  const scrollHeight = metrics.bodyScroll.height

  expect(shellHeight, `${tableName} shell height too small`).toBeGreaterThanOrEqual(Math.floor(paneHeight * 0.7))
  expect(contentHeight, `${tableName} content height too small`).toBeGreaterThanOrEqual(Math.floor(shellHeight * 0.84))
  expect(bodyHeight, `${tableName} body height too small`).toBeGreaterThanOrEqual(Math.floor(contentHeight * 0.82))
  expect(scrollHeight, `${tableName} scroll height too small`).toBeGreaterThanOrEqual(Math.floor(bodyHeight * 0.78))

  const emptyTopGap = metrics.firstRow.top - metrics.header.bottom
  expect(emptyTopGap, `${tableName} top gap too large`).toBeLessThan(36)

  const emptyBottomGap = metrics.tableBody.bottom - metrics.bodyScroll.bottom
  expect(emptyBottomGap, `${tableName} bottom gap too large`).toBeLessThan(28)
}

async function clickWorkspaceTab(page, title) {
  const tab = page.locator('.workspace-tabs .ant-tabs-tab').filter({ hasText: title }).first()
  await expect(tab).toBeVisible()
  const startedAt = Date.now()
  await tab.click()
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText(title, { timeout: 30000 })
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)
  return Date.now() - startedAt
}

async function openQueryWorkspace(page) {
  const button = page.getByRole('button', { name: '新建查询' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText('查询', { timeout: 30000 })
  await expect(page.locator('.sql-editor-container .monaco-editor')).toBeVisible({ timeout: 30000 })
}

async function measureSqlTypingLatency(page, text) {
  const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
  await expect(editorTextbox).toBeVisible({ timeout: 30000 })
  await editorTextbox.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')

  const durations = []
  for (const char of text) {
    const startedAt = Date.now()
    await page.keyboard.type(char)
    durations.push(Date.now() - startedAt)
  }

  const total = durations.reduce((sum, value) => sum + value, 0)
  return {
    average: total / Math.max(durations.length, 1),
    max: Math.max(...durations, 0),
    count: durations.length
  }
}

async function toggleTreeNode(page, key) {
  const locator = treeNode(page, key)
  await expect(locator).toBeVisible()
  const startedAt = Date.now()
  await locator.dblclick()
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)
  return Date.now() - startedAt
}

async function measureModalOpenClose(page, { label, open, close, modalSelector }) {
  const modal = page.locator(modalSelector)

  const openStartedAt = Date.now()
  await open()
  await expect(modal).toBeVisible({ timeout: 10000 })
  const openMs = Date.now() - openStartedAt

  const closeStartedAt = Date.now()
  await close()
  await expect(modal).toHaveCount(0, { timeout: 10000 })
  const closeMs = Date.now() - closeStartedAt

  console.log(`[perf][modal][${label}] ${JSON.stringify({ openMs, closeMs })}`)
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)

  return { openMs, closeMs }
}

test.describe('workspace regression', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(electronEntry)) {
      throw new Error(`Electron entry missing: ${electronEntry}`)
    }
    readFixtureUserDataDir()
  })

  test('table preview should fill pane for small and large tables', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      await expectTableFillsPane(page, smallTableName)

      await openFixtureTable(page, largeTableName)
      await expectTableFillsPane(page, largeTableName)
    } finally {
      await electronApp.close()
    }
  })

  test('switching workspaces should stay responsive and tree nodes should still toggle', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      await openFixtureTable(page, mediumTableName)
      await openFixtureTable(page, largeTableName)

      const switchToSmallMs = await clickWorkspaceTab(page, smallTableName)
      console.log(`[perf][switch-tab][${smallTableName}] ${switchToSmallMs}`)
      await expectTableFillsPane(page, smallTableName)
      expect(switchToSmallMs, 'switch to small table tab is too slow').toBeLessThan(1500)

      const switchToLargeMs = await clickWorkspaceTab(page, largeTableName)
      console.log(`[perf][switch-tab][${largeTableName}] ${switchToLargeMs}`)
      await expectTableFillsPane(page, largeTableName)
      expect(switchToLargeMs, 'switch to large table tab is too slow').toBeLessThan(1800)

      const openViewsMs = await toggleTreeNode(page, `object-group:${fixtureConnectionId}:::view`)
      console.log(`[perf][tree-toggle][view-open] ${openViewsMs}`)
      await expect(treeNode(page, `db-object:${fixtureConnectionId}:::view:active_large_items`)).toBeVisible({ timeout: 30000 })
      expect(openViewsMs, 'tree expand is too slow while workspaces are open').toBeLessThan(1200)

      const closeViewsMs = await toggleTreeNode(page, `object-group:${fixtureConnectionId}:::view`)
      console.log(`[perf][tree-toggle][view-close] ${closeViewsMs}`)
      await expect(treeNode(page, `db-object:${fixtureConnectionId}:::view:active_large_items`)).toHaveCount(0)
      expect(closeViewsMs, 'tree collapse is too slow while workspaces are open').toBeLessThan(1200)
    } finally {
      await electronApp.close()
    }
  })

  test('sql editor typing should stay responsive', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const typingMetrics = await measureSqlTypingLatency(
        page,
        'select id, name from large_items where status = 1 order by created_at desc;'
      )
      console.log(`[perf][sql-editor][typing] ${JSON.stringify(typingMetrics)}`)

      expect(typingMetrics.average, 'sql editor average typing latency is too high').toBeLessThan(20)
      expect(typingMetrics.max, 'sql editor max typing latency is too high').toBeLessThan(80)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('table search button and shortcut should open search row', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)

      const previewSearchToggle = page.locator('.workspace-tab-panels .workspace-active-content .table-data-toolbar .table-toolbar-toggle').first()
      const searchBar = page.locator('.workspace-tab-panels .workspace-active-content .table-search-bar')
      await expect(previewSearchToggle).toBeVisible({ timeout: 30000 })
      const searchOpenStartedAt = Date.now()
      await previewSearchToggle.click()
      await expect(searchBar).toBeVisible({ timeout: 10000 })
      const searchOpenMs = Date.now() - searchOpenStartedAt
      console.log(`[perf][table-search][button-open] ${searchOpenMs}`)
      expect(searchOpenMs, 'table search bar opens too slowly').toBeLessThan(350)
      await previewSearchToggle.click()
      await expect(searchBar).toHaveCount(0)

      await page.locator('.workspace-tab-panels .workspace-active-content .result-table-content').click()
      await page.keyboard.press('Control+F')
      await expect(searchBar).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('executing sql should show result without hook render crash', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
      await expect(editorTextbox).toBeVisible({ timeout: 30000 })
      await editorTextbox.focus()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select id, name from small_items order by id;')

      const executeButton = page.getByRole('button', { name: /执行/i }).first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
      await expect(page.locator('.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })
      await expect.poll(async () => {
        return page.locator('.workspace-tab-panels .workspace-active-content .result-table tbody tr').count()
      }, { timeout: 30000 }).toBeGreaterThan(0)
      await expect(page.locator('.query-result-empty')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('major modals should open and close quickly', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const historyMetrics = await measureModalOpenClose(page, {
        label: 'history',
        open: async () => page.locator('.app-header .toolbar-icon-btn[aria-label="历史查询窗口"]').click(),
        close: async () => page.locator('.query-history-window-modal .ant-modal-close').click(),
        modalSelector: '.query-history-window-modal'
      })
      expect(historyMetrics.openMs, 'history modal opens too slowly').toBeLessThan(800)
      expect(historyMetrics.closeMs, 'history modal closes too slowly').toBeLessThan(700)

      const settingsMetrics = await measureModalOpenClose(page, {
        label: 'settings',
        open: async () => page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click(),
        close: async () => page.locator('.settings-window-modal .ant-modal-close').click(),
        modalSelector: '.settings-window-modal'
      })
      expect(settingsMetrics.openMs, 'settings modal opens too slowly').toBeLessThan(900)
      expect(settingsMetrics.closeMs, 'settings modal closes too slowly').toBeLessThan(700)

      const updateMetrics = await measureModalOpenClose(page, {
        label: 'update',
        open: async () => page.locator('.app-header .toolbar-icon-btn[aria-label="检查更新"]').click(),
        close: async () => page.locator('.update-window-modal .ant-modal-close').click(),
        modalSelector: '.update-window-modal'
      })
      expect(updateMetrics.openMs, 'update modal opens too slowly').toBeLessThan(900)
      expect(updateMetrics.closeMs, 'update modal closes too slowly').toBeLessThan(700)

      const importMetrics = await measureModalOpenClose(page, {
        label: 'import-connection',
        open: async () => page.locator('.resource-header .resource-import').click(),
        close: async () => page.locator('.import-connection-modal .ant-modal-close').click(),
        modalSelector: '.import-connection-modal'
      })
      expect(importMetrics.openMs, 'import connection modal opens too slowly').toBeLessThan(900)
      expect(importMetrics.closeMs, 'import connection modal closes too slowly').toBeLessThan(700)

      const createButton = page.locator('.resource-header .resource-add')
      const connectionMetrics = await measureModalOpenClose(page, {
        label: 'connection-editor',
        open: async () => {
          await createButton.click()
          await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'SQLite' }).click()
        },
        close: async () => page.locator('.connection-editor-modal .ant-modal-close').click(),
        modalSelector: '.connection-editor-modal'
      })
      expect(connectionMetrics.openMs, 'connection editor opens too slowly').toBeLessThan(1100)
      expect(connectionMetrics.closeMs, 'connection editor closes too slowly').toBeLessThan(700)
    } finally {
      await electronApp.close()
    }
  })
})
