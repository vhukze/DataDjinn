const { test, expect, _electron: electron } = require('@playwright/test')
const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')

const projectRoot = path.resolve(__dirname, '..', '..')
const electronEntry = path.join(projectRoot, 'out', 'main', 'index.js')
const regressionRootDir = path.join(projectRoot, '.tmp', 'regression-user-data')

function readFixtureUserDataDir() {
  const pointerPath = path.join(regressionRootDir, 'current.json')
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'))
  return pointer.current_user_data_dir
}

async function launchRegressionApp() {
  return electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      DATADJINN_TEST_RUN_ROOT: regressionRootDir,
      DATADJINN_TEST_USER_DATA_DIR: readFixtureUserDataDir(),
      DATADJINN_SKIP_SPLASH: '1'
    }
  })
}

async function waitForAppReady(page) {
  await page.waitForSelector('.resource-tree-shell', { timeout: 60000 })
  await expect
    .poll(() => page.evaluate(async () => (await window.api.getBackendStatus()).state), {
      timeout: 60000
    })
    .toBe('online')
  await page.waitForSelector('.app-shell[data-startup-ready="true"]', { timeout: 60000 })
}

async function clickVisibleDropdownMenuItem(page, label) {
  const center = await page.evaluate((expectedLabel) => {
    const normalizedLabel = expectedLabel.replace(/\s+/g, '')
    const items = Array.from(
      document.querySelectorAll(
        '.ant-dropdown .ant-dropdown-menu-item, .tree-context-menu-panel .ant-menu-item'
      )
    ).filter((node) => node instanceof HTMLElement)
    const target = items.find((item) => {
      const rect = item.getBoundingClientRect()
      const style = window.getComputedStyle(item)
      return (
        (item.textContent ?? '').replace(/\s+/g, '').includes(normalizedLabel) &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      )
    })
    if (!target) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, label)
  expect(center, `visible menu item should exist: ${label}`).not.toBeNull()
  await page.mouse.click(center.x, center.y)
}

test('new connections can create a group and copy connection details @smoke', async () => {
  const electronApp = await launchRegressionApp()
  const suffix = crypto.randomUUID().slice(0, 8)
  const connectionName = `需求连接 ${suffix}`
  const folderName = `需求分组 ${suffix}`

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)

    await page.locator('.resource-header .resource-add').click()
    await clickVisibleDropdownMenuItem(page, 'MySQL')

    const modal = page.locator('.connection-editor-modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
        )
    )
    await modal.getByLabel(/^连接名称$/).fill(connectionName)
    await modal.getByLabel(/^主机$/).fill('10.41.27.166')
    await modal.getByLabel(/^端口$/).fill('5432')
    await modal.getByLabel(/^用户名$/).fill('admin')
    await modal.getByLabel(/^密码$/).fill('123')
    await modal.getByLabel(/^默认数据库（可选）$/).fill('aidb')

    await modal.getByRole('button', { name: '新建分组' }).click()
    await modal.getByLabel('新分组名称').fill(folderName)
    await modal.getByRole('button', { name: '添加分组' }).click()
    await expect(modal.getByText(folderName, { exact: true })).toBeVisible()

    await modal.getByRole('button', { name: '保存连接' }).click()
    await expect(modal).not.toBeVisible({ timeout: 10000 })

    const folderTreeItem = page.getByRole('treeitem').filter({ hasText: folderName })
    await expect(folderTreeItem).toBeVisible({ timeout: 10000 })
    await expect(folderTreeItem).toContainText('1')

    const connectionTitle = page
      .locator(`.resource-tree-node-title[data-tree-node-key^="connection:"]`)
      .filter({ hasText: connectionName })
    await expect(connectionTitle).toBeVisible({ timeout: 10000 })
    await expect
      .poll(() =>
        page.evaluate(
          async ({ targetConnectionName, targetFolderName }) => {
            const response = await window.api.requestJson('/connections')
            const connection = response.connections.find(
              (item) => item.name === targetConnectionName
            )
            const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
            const folder = folders.find((item) => item.name === targetFolderName)
            const assignments = JSON.parse(
              localStorage.getItem('datadjinn-connection-folder-assignments') ?? '{}'
            )
            return connection && folder
              ? assignments[connection.connection_id] === folder.id
              : false
          },
          { targetConnectionName: connectionName, targetFolderName: folderName }
        )
      )
      .toBe(true)

    await connectionTitle.click({ button: 'right' })
    await clickVisibleDropdownMenuItem(page, '复制连接信息')

    await expect
      .poll(
        () =>
          page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')),
        { timeout: 10000 }
      )
      .toBe('主机：10.41.27.166\n端口：5432\n用户名：admin\n密码：123\n数据库：aidb')

    await connectionTitle.click({ button: 'right' })
    await clickVisibleDropdownMenuItem(page, '复制为 JDBC URL')
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10000 })
      .toBe('jdbc:mysql://10.41.27.166:5432/aidb')
  } finally {
    const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
    if (page) {
      await page.evaluate(
        async ({ targetName, targetFolderName }) => {
          const response = await window.api.requestJson('/connections')
          const target = Array.isArray(response?.connections)
            ? response.connections.find((item) => item?.name === targetName)
            : null
          if (target?.connection_id) {
            await window.api.requestJson(`/connections/${target.connection_id}`, {
              method: 'DELETE'
            })
          }

          const readJson = (key, fallback) => {
            try {
              return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback))
            } catch {
              return fallback
            }
          }
          const folders = readJson('datadjinn-connection-folders', [])
          const folder = folders.find((item) => item?.name === targetFolderName)
          if (!folder) return

          const folderId = folder.id
          const connectionId = target?.connection_id
          localStorage.setItem(
            'datadjinn-connection-folders',
            JSON.stringify(folders.filter((item) => item?.id !== folderId))
          )
          localStorage.setItem(
            'datadjinn-connection-folder-order',
            JSON.stringify(
              readJson('datadjinn-connection-folder-order', []).filter((id) => id !== folderId)
            )
          )
          const assignments = readJson('datadjinn-connection-folder-assignments', {})
          localStorage.setItem(
            'datadjinn-connection-folder-assignments',
            JSON.stringify(
              Object.fromEntries(
                Object.entries(assignments).filter(
                  ([id, assignedFolderId]) => id !== connectionId && assignedFolderId !== folderId
                )
              )
            )
          )
          const folderConnectionOrder = readJson('datadjinn-folder-connection-order', {})
          delete folderConnectionOrder[folderId]
          localStorage.setItem(
            'datadjinn-folder-connection-order',
            JSON.stringify(folderConnectionOrder)
          )
          localStorage.setItem(
            'datadjinn-root-item-order',
            JSON.stringify(
              readJson('datadjinn-root-item-order', []).filter(
                (id) => id !== `folder:${folderId}` && id !== `connection:${connectionId}`
              )
            )
          )
          localStorage.setItem(
            'datadjinn-root-connection-order',
            JSON.stringify(
              readJson('datadjinn-root-connection-order', []).filter((id) => id !== connectionId)
            )
          )
        },
        { targetName: connectionName, targetFolderName: folderName }
      )
    }
    await electronApp.close()
  }
})
