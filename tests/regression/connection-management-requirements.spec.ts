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
    await expect(
      modal.getByText('为此连接保留结构和表数据版本；表数据按需创建快照并共享同一 Git 历史。')
    ).toBeVisible()

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

test('missing password prompt should save the password and reconnect after closing @bug', async () => {
  const electronApp = await launchRegressionApp()
  const connectionName = `无密码重连 ${crypto.randomUUID().slice(0, 8)}`
  let connectionId

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    connectionId = await page.evaluate(async (name) => {
      const created = await window.api.requestJson('/connections', {
        method: 'POST',
        body: JSON.stringify({
          name,
          database_type: 'mysql',
          host: '127.0.0.1',
          port: 1,
          username: 'root',
          database: 'test'
        })
      })
      return created.connection_id
    }, connectionName)

    await page.reload()
    await waitForAppReady(page)
    const connectionTitle = page.locator(
      `.resource-tree-node-title[data-tree-node-key="connection:${connectionId}"]`
    )
    await expect(connectionTitle).toBeVisible({ timeout: 10000 })
    await connectionTitle.dblclick()

    const passwordPrompt = page.getByRole('dialog').filter({ hasText: '输入连接密码' })
    await expect(passwordPrompt).toBeVisible({ timeout: 10000 })
    await expect(passwordPrompt.getByRole('button', { name: '保存并重新连接' })).toBeVisible()
    await passwordPrompt.getByPlaceholder('请输入密码').fill('saved-password')
    await passwordPrompt.getByRole('button', { name: '保存并重新连接' }).click()
    await expect(passwordPrompt).toBeHidden({ timeout: 3000 })
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const result = await window.api.requestJson(`/connections/${id}/password`)
            return result.password
          }, connectionId),
        { timeout: 10000 }
      )
      .toBe('saved-password')
  } finally {
    const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
    if (page && connectionId) {
      await page.evaluate(async (id) => {
        await window.api.requestJson(`/connections/${id}`, { method: 'DELETE' })
      }, connectionId)
    }
    await electronApp.close()
  }
})

test('database selector should use the same current selection as tree rendering and connection requests stay bounded @bug', async () => {
  const appSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'),
    'utf-8'
  )
  const runtimeSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'app-runtime-support.tsx'),
    'utf-8'
  )

  expect(appSource).toContain(
    'selectedDatabasesRef.current[connectionId] ?? selectedDatabases[connectionId] ?? dbList'
  )
  expect(appSource).toContain('timeoutMs: DATABASE_CONNECTION_REQUEST_TIMEOUT_MS')
  expect(runtimeSource).toContain('export const DATABASE_CONNECTION_REQUEST_TIMEOUT_MS = 10_000')
})

test('connection Git versioning preference persists and is visible in the tree @smoke', async () => {
  const electronApp = await launchRegressionApp()
  const connectionName = `Git Versioned SQLite ${crypto.randomUUID().slice(0, 8)}`

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)

    await page.locator('.resource-header .resource-add').click()
    await clickVisibleDropdownMenuItem(page, 'SQLite')

    const modal = page.locator('.connection-editor-modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await page.evaluate(
      () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
    )
    await modal.locator('#name').fill(connectionName)
    await modal.locator('#sqlite_path').fill('C:\\DataDjinn\\git-versioned.db')
    await modal.getByRole('switch', { name: '启用 Git 版本管理' }).click()
    await expect(modal.getByRole('switch', { name: '启用 Git 版本管理' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await modal.getByRole('button', { name: '保存连接' }).click()
    await expect(modal).not.toBeVisible({ timeout: 10000 })

    const connectionTitle = page
      .locator(`.resource-tree-node-title[data-tree-node-key^="connection:"]`)
      .filter({ hasText: connectionName })
    await expect(connectionTitle).toBeVisible({ timeout: 10000 })
    await page.evaluate(async (targetConnectionName) => {
      const response = await window.api.requestJson('/connections')
      const connection = response.connections.find((item) => item.name === targetConnectionName)
      if (connection?.connection_id) {
        await window.api.requestJson(`/connections/${connection.connection_id}/open`, { method: 'POST' })
      }
    }, connectionName)
    const versionEntry = connectionTitle.getByRole('button', {
      name: `打开 ${connectionName} 的 Git 版本管理`
    })
    await expect(versionEntry).toBeVisible()
    const connectionLayout = await connectionTitle.locator('.connection-tree-name').evaluate((nameNode) => {
      const style = window.getComputedStyle(nameNode)
      const gitNode = nameNode.parentElement?.querySelector('.connection-git-status-icon')
      return {
        nameFlexGrow: style.flexGrow,
        nameVisibleWidth: nameNode.getBoundingClientRect().width,
        gitVisibleWidth: gitNode instanceof HTMLElement ? gitNode.getBoundingClientRect().width : 0
      }
    })
    expect(connectionLayout.nameFlexGrow).toBe('1')
    expect(connectionLayout.nameVisibleWidth).toBeGreaterThan(0)
    expect(connectionLayout.gitVisibleWidth).toBeGreaterThan(0)
    await versionEntry.click()
    const versionModal = page.locator('.connection-schema-version-modal')
    await expect(versionModal).toBeVisible({ timeout: 10000 })
    await expect(versionModal.getByText('Git Versioned SQLite', { exact: false })).toBeVisible()
    await expect(versionModal.getByText('当前连接为单库类型，结构版本会管理该数据库的全部对象。')).toBeVisible()
    await expect(versionModal.getByText('请先完成 GitHub 授权，才能读取或创建该连接的版本记录。')).toBeVisible()
    await expect(versionModal.getByRole('button', { name: '创建初始快照' })).toBeDisabled()
    await versionModal.locator('.ant-modal-close').click()

    await connectionTitle.click({ button: 'right' })
    const contextMenu = page.locator('.tree-context-menu-panel')
    await expect(contextMenu.getByText('版本管理', { exact: true })).toBeVisible()
    await contextMenu.getByText('版本管理', { exact: true }).click()
    await expect(versionModal).toBeVisible({ timeout: 10000 })
    await versionModal.locator('.ant-modal-close').click()
    await expect
      .poll(() =>
        page.evaluate(async (targetConnectionName) => {
          const response = await window.api.requestJson('/connections')
          return response.connections.find((item) => item.name === targetConnectionName)
            ?.git_versioning_enabled
        }, connectionName)
      )
      .toBe(true)
  } finally {
    const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
    if (page) {
      await page.evaluate(async (targetConnectionName) => {
        const response = await window.api.requestJson('/connections')
        const connection = response.connections.find((item) => item.name === targetConnectionName)
        if (connection?.connection_id) {
          await window.api.requestJson(`/connections/${connection.connection_id}`, { method: 'DELETE' })
        }
      }, connectionName)
    }
    await electronApp.close()
  }
})

test('sync settings expose GitHub authorization and encrypted sync controls @smoke', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)

    await page.evaluate(() => window.api.setSyncLocalState({ autoSyncEnabled: false }))

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await expect(settingsModal).toBeVisible()

    await expect
      .poll(() => settingsModal.locator('.settings-sidebar .ant-menu-item').allTextContents())
      .toEqual(['应用', 'SQL', '快捷键', '同步与版本', '扩展', 'AI', 'MCP', '驱动管理'])
    await settingsModal.getByText('同步与版本', { exact: true }).click()

    await expect(settingsModal.getByText('GitHub 授权', { exact: true })).toBeVisible()
    await expect(settingsModal.getByRole('button', { name: '登录 GitHub' })).toBeVisible()
    await expect(settingsModal.getByText('加密同步', { exact: true })).toBeVisible()
    await expect(settingsModal.getByPlaceholder('同步口令，至少 8 个字符')).toBeVisible()
    await expect(settingsModal.getByPlaceholder('再次输入同步口令')).toBeVisible()
    await expect(settingsModal.getByRole('button', { name: '立即同步' })).toBeDisabled()
    await expect(settingsModal.getByText('数据库结构版本', { exact: true })).not.toBeVisible()
    await expect(settingsModal.getByLabel('自动同步')).toBeDisabled()

    const passphraseInput = settingsModal.getByPlaceholder('同步口令，至少 8 个字符')
    const passphraseConfirmInput = settingsModal.getByPlaceholder('再次输入同步口令')
    await passphraseInput.focus()
    await page.keyboard.press('Tab')
    await expect(passphraseConfirmInput).toBeFocused()

    await settingsModal.getByRole('menuitem', { name: '扩展' }).click()
    await expect(settingsModal.locator('.optional-module-property')).toHaveCount(4)
    await expect(settingsModal.locator('.optional-module-description')).toHaveCount(4)
    await expect(
      settingsModal.locator('.settings-section-card').filter({ hasText: 'Git 表数据版本管理' })
    ).toBeVisible()

    const settingsHeight = (await settingsModal.boundingBox())?.height
    await settingsModal.getByRole('menuitem', { name: '快捷键' }).click()
    await expect(settingsModal.getByRole('menuitem', { name: '快捷键' })).toHaveClass(/ant-menu-item-selected/)
    const shortcutsHeight = (await settingsModal.boundingBox())?.height
    expect(settingsHeight).toBeDefined()
    expect(shortcutsHeight).toBeDefined()
    expect(Math.abs((settingsHeight ?? 0) - (shortcutsHeight ?? 0))).toBeLessThanOrEqual(2)

    await expect(page.getByRole('button', { name: '同步与版本' })).toBeVisible()
    await expect(page.getByRole('button', { name: '检查后端服务状态' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('sync restores connections inside their remote groups @bug', async () => {
  const electronApp = await launchRegressionApp()
  let page

  try {
    page = await electronApp.firstWindow()
    await waitForAppReady(page)

    const connectionId = await page.evaluate(async () => {
      const result = await window.api.requestJson('/connections')
      return result.connections[0]?.connection_id
    })
    expect(connectionId).toBeTruthy()
    await page.evaluate(async (sourceConnectionId) => {
      const syncedFolderId = 'synced-folder-from-remote'
      const secondFolderId = 'second-synced-folder-from-remote'
      localStorage.setItem(
        'datadjinn-connection-folders',
        JSON.stringify([
          { id: syncedFolderId, name: '远端同步分组' },
          { id: secondFolderId, name: '第二个同步分组' }
        ])
      )
      localStorage.setItem(
        'datadjinn-connection-folder-assignments',
        JSON.stringify({})
      )
      localStorage.setItem(
        'datadjinn-connection-folder-order',
        JSON.stringify([secondFolderId, syncedFolderId])
      )
      localStorage.setItem(
        'datadjinn-root-item-order',
        JSON.stringify([`folder:${secondFolderId}`, `folder:${syncedFolderId}`])
      )
      localStorage.setItem(
        'datadjinn-folder-connection-order',
        JSON.stringify({})
      )
      await window.api.setSyncLocalState({
        passphrase: 'remote-passphrase',
        lastSyncedAt: Date.now(),
        basePayload: {
          format: 'datadjinn-sync',
          version: 1,
          generated_at: new Date().toISOString(),
          device_id: 'remote-device',
          connections: {},
          settings: {},
          preferences: {
            connection_folders: [
              { id: syncedFolderId, name: '远端同步分组' },
              { id: secondFolderId, name: '第二个同步分组' }
            ],
            connection_folder_assignments: { [sourceConnectionId]: syncedFolderId },
            connection_folder_order: [secondFolderId, syncedFolderId],
            root_item_order: [`folder:${secondFolderId}`, `folder:${syncedFolderId}`],
            root_item_order_customized: true,
            folder_connection_order: { [syncedFolderId]: [sourceConnectionId] }
          }
        }
      })
    }, connectionId)
    await page.reload()
    await waitForAppReady(page)

    await expect
      .poll(() =>
        page
          .locator('.tree-folder-row .resource-tree-node-title:visible')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tree-node-key')))
      )
      .toEqual(['folder:second-synced-folder-from-remote', 'folder:synced-folder-from-remote'])
    const folderTitle = page.locator(
      '.resource-tree-node-title[data-tree-node-key="folder:synced-folder-from-remote"]'
    )
    await expect(folderTitle).toBeVisible({ timeout: 10000 })
    await folderTitle.dblclick()
    await expect(
      page.locator(
        `.resource-tree-node-title[data-tree-node-key="connection:${connectionId}"]`
      )
    ).toBeVisible({ timeout: 10000 })
  } finally {
    if (page) {
      await page.evaluate(() => {
        ;[
          'datadjinn-connection-folders',
          'datadjinn-connection-folder-assignments',
          'datadjinn-connection-folder-order',
          'datadjinn-root-item-order',
          'datadjinn-folder-connection-order'
        ].forEach((key) => localStorage.removeItem(key))
      })
    }
    await electronApp.close()
  }
})

test('GitHub device authorization keeps the verification code visible while pending @smoke', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    await page.evaluate(() => {
      window.__DATADJINN_TEST_GITHUB_DEVICE_AUTHORIZATION__ = {
        session_id: 'test-session',
        verification_uri: 'https://github.com/login/device',
        user_code: 'ABCD-EFGH',
        expires_at: Math.floor(Date.now() / 1000) + 900,
        interval_seconds: 60
      }
      window.__DATADJINN_TEST_GITHUB_DEVICE_POLL__ = {
        status: 'pending',
        interval_seconds: 60
      }
      window.api.openExternalUrl = async () => undefined
    })

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await expect(settingsModal).toBeVisible()
    await settingsModal.getByText('同步与版本', { exact: true }).click()
    await settingsModal.getByRole('button', { name: '登录 GitHub' }).click()

    const authorizationAlert = settingsModal.getByText('正在等待 GitHub 浏览器授权')
    await expect(authorizationAlert).toBeVisible()
    await expect(settingsModal.getByText('ABCD-EFGH', { exact: true })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('sync passphrase and baseline stay encrypted in electron store @smoke', async () => {
  const electronApp = await launchRegressionApp()
  const passphrase = `sync-passphrase-${crypto.randomUUID()}`
  const databasePassword = `database-password-${crypto.randomUUID()}`
  const aiKey = `ai-key-${crypto.randomUUID()}`

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)

    const restored = await page.evaluate(
      async ({ passphrase, databasePassword, aiKey }) => {
        await window.api.setSyncLocalState({
          passphrase,
          remoteSha: 'test-sha',
          lastSyncedAt: 1_700_000_000_000,
          autoSyncEnabled: true,
          basePayload: {
            connections: { test: { password: databasePassword } },
            settings: { aiConfigs: [{ api_key: aiKey }] }
          }
        })
        return await window.api.getSyncLocalState()
      },
      { passphrase, databasePassword, aiKey }
    )

    expect(restored.passphrase).toBe(passphrase)
    expect(restored.basePayload.connections.test.password).toBe(databasePassword)
    expect(restored.basePayload.settings.aiConfigs[0].api_key).toBe(aiKey)
    expect(restored.autoSyncEnabled).toBe(true)

    const configText = fs.readFileSync(path.join(readFixtureUserDataDir(), 'config.json'), 'utf-8')
    expect(configText).not.toContain(passphrase)
    expect(configText).not.toContain(databasePassword)
    expect(configText).not.toContain(aiKey)
  } finally {
    const windows = electronApp.windows()
    if (windows[0]) {
      await windows[0].evaluate(() => window.api.clearSyncLocalState()).catch(() => undefined)
    }
    await electronApp.close()
  }
})
