const { test, expect, _electron: electron } = require('@playwright/test')
const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')

const projectRoot = path.resolve(__dirname, '..', '..')
const electronEntry = path.join(projectRoot, 'out', 'main', 'index.js')
const regressionRootDir = path.join(projectRoot, '.tmp', 'regression-user-data')

test('closed connection rows keep normal text and database icon brightness @smoke', () => {
  const styles = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'assets', 'main.css'),
    'utf-8'
  )

  expect(styles).toContain('.connection-tree-title::before')
  expect(styles).toContain('.connection-tree-title.is-open::before')
  expect(styles).not.toContain('.connection-tree-title.is-closed .connection-tree-name')
  expect(styles).not.toContain('.tree-node-closed .ant-tree-title')
})

test('main renderer refuses top-level navigation outside the application @bug', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    const applicationUrl = page.url()

    await page.evaluate(() => window.location.assign('https://example.com'))
    await expect.poll(() => page.url()).toBe(applicationUrl)
  } finally {
    await electronApp.close()
  }
})

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

    // 新建连接选择分组后，重载 renderer，验证持久化副本恢复的是同一分组关系。
    await page.reload()
    await waitForAppReady(page)
    const restoredTreeState = await page.evaluate(
      async ({ targetConnectionName, targetFolderName }) => {
        const response = await window.api.requestJson('/connections')
        const connection = response.connections.find((item) => item.name === targetConnectionName)
        const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
        const folder = folders.find((item) => item.name === targetFolderName)
        const assignments = JSON.parse(
          localStorage.getItem('datadjinn-connection-folder-assignments') ?? '{}'
        )
        return {
          connectionId: connection?.connection_id,
          folderId: folder?.id,
          assignedFolderId: connection ? assignments[connection.connection_id] : undefined
        }
      },
      { targetConnectionName: connectionName, targetFolderName: folderName }
    )
    expect(restoredTreeState.connectionId).toBeTruthy()
    expect(restoredTreeState.assignedFolderId).toBe(restoredTreeState.folderId)
    const restoredFolderTreeItem = page.getByRole('treeitem').filter({ hasText: folderName })
    await expect(restoredFolderTreeItem).toBeVisible({ timeout: 15000 })
    await expect(restoredFolderTreeItem).toContainText('1')
    if (!(await connectionTitle.isVisible())) {
      await restoredFolderTreeItem.dblclick()
    }
    await expect(
      page
        .locator(`.resource-tree-node-title[data-tree-node-key^="connection:"]`)
        .filter({ hasText: connectionName })
    ).toBeVisible({ timeout: 15000 })
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

test('other database picker exposes installable Elasticsearch and JDBC choices @bug', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)

    await page.locator('.resource-header .resource-add').click()
    await clickVisibleDropdownMenuItem(page, '其他')

    const picker = page.locator('.database-extension-picker-modal')
    await expect(picker).toBeVisible()
    await expect(picker.locator('.database-extension-picker-list')).toHaveCSS('display', 'grid')
    const jdbcCardBounds = await picker
      .locator('.database-extension-picker-item')
      .filter({ hasText: '达梦' })
      .evaluate((element) => {
        const card = element.getBoundingClientRect()
        const children = Array.from(element.children).map((child) => child.getBoundingClientRect())
        return { cardBottom: card.bottom, childrenBottom: Math.max(...children.map((child) => child.bottom)) }
      })
    expect(jdbcCardBounds.childrenBottom).toBeLessThanOrEqual(jdbcCardBounds.cardBottom + 1)
    await expect(picker.getByText('Elasticsearch', { exact: true })).toBeVisible()
    await expect(picker.getByText('ClickHouse', { exact: true })).toBeVisible()
    await expect(picker.getByText('达梦', { exact: true })).toBeVisible()
    await expect(picker.getByText('高斯数据库', { exact: true })).toBeVisible()
    await expect(picker.getByText('JDBC', { exact: true })).toHaveCount(2)
    await picker.getByPlaceholder('搜索数据库类型').fill('elastic')
    await expect(picker.getByText('Elasticsearch', { exact: true })).toBeVisible()
    await expect(picker.getByText('ClickHouse', { exact: true })).toBeHidden()

    await picker.getByPlaceholder('搜索数据库类型').fill('jdbc')
    await expect(picker.getByText('达梦', { exact: true })).toBeVisible()
    await expect(picker.getByText('高斯数据库', { exact: true })).toBeVisible()
    await expect(picker.getByText('JDBC', { exact: true })).toHaveCount(2)
    await picker.getByPlaceholder('搜索数据库类型').fill('')
    await picker.getByText('Elasticsearch', { exact: true }).click()
    const installConfirm = page.locator('.ant-modal-confirm')
    await expect(installConfirm.locator('.ant-modal-confirm-title')).toHaveText('需要安装扩展')
    await expect(installConfirm.getByText(/首次使用Elasticsearch需要安装/)).toBeVisible()
    await installConfirm.locator('.ant-modal-confirm-btns .ant-btn').first().click()
    await expect(installConfirm).toBeHidden()
    await picker.locator('.ant-modal-close').click()
    await expect(picker).toBeHidden()
  } finally {
    await electronApp.close()
  }
})

test('Elasticsearch auth mode controls credential fields and validation @bug', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const editorSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'connection-editor-modal.tsx'),
    'utf-8'
  )
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')
  const connectionManagerSource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'app', 'db', 'connection_manager.py'),
    'utf-8'
  )

  expect(editorSource).toContain("databaseType !== 'elasticsearch' || esAuthType === 'basic'")
  expect(editorSource).toContain("message: '请输入用户名'")
  expect(editorSource).toContain("message: '请输入密码'")
  expect(editorSource).toContain("esAuthType === 'api_key'")
  expect(editorSource).toContain("value: 'none'")
  expect(appSource).toContain("currentConnection.database_type === 'elasticsearch' && currentConnection.es_auth_type !== 'basic'")
  expect(connectionManagerSource).toContain('es_auth_type=stored.es_auth_type')
  const treeRuntimeSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'tree-runtime.ts'),
    'utf-8'
  )
  expect(treeRuntimeSource).toContain("connection.database_type === 'elasticsearch'")
  expect(treeRuntimeSource).toContain('preloadObjectGroupNodes')
})

test('Git sync must not overwrite the local interface theme @bug', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')
  const payloadBuilder = appSource.slice(
    appSource.indexOf('const buildLocalGitSyncPayload'),
    appSource.indexOf('const applyGitSyncPayload')
  )
  const payloadApplier = appSource.slice(
    appSource.indexOf('const applyGitSyncPayload'),
    appSource.indexOf('const finishGitSync')
  )

  expect(payloadBuilder).not.toContain('theme,')
  expect(payloadApplier).not.toContain('setTheme(preferences.theme)')
  expect(payloadApplier).toContain('主题属于本机界面偏好')
})

test('JDBC database requests allow JVM startup time without slowing common databases @bug', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const runtimeSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'app-runtime-support.tsx'),
    'utf-8'
  )
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')

  expect(runtimeSource).toContain('JDBC_DATABASE_CONNECTION_REQUEST_TIMEOUT_MS = 30_000')
  expect(runtimeSource).toContain("databaseType === 'dm' || databaseType === 'gaussdb'")
  expect(appSource).toContain('getDatabaseConnectionRequestTimeoutMs(values.database_type)')
  expect(appSource).toContain('getDatabaseConnectionRequestTimeoutMs(currentConnection?.database_type')
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
  expect(appSource).toContain('getDatabaseConnectionRequestTimeoutMs(currentConnection?.database_type')
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
    await expect(
      versionModal.getByText('连接未打开。双击打开连接后，可在这里查看和调整纳管范围。')
    ).toBeVisible()
    await expect(versionModal.getByText('请先完成 GitHub 授权，才能读取或创建该连接的版本记录。')).toBeVisible()
    await expect(versionModal.getByRole('button', { name: '创建初始快照' })).toBeDisabled()
    await expect(page.locator('.ant-modal-confirm')).toHaveCount(0)
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
    await expect(settingsModal.locator('.optional-module-property')).toHaveCount(7)
    await expect(settingsModal.locator('.optional-module-description')).toHaveCount(7)
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

test('sync status errors stay visible and do not offer repository creation @bug', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    await page.evaluate(() => {
      window.__DATADJINN_TEST_GITHUB_AUTH_STATUS__ = {
        authorized: true,
        login: 'test-user'
      }
      window.__DATADJINN_TEST_GIT_SYNC_STATUS_ERROR__ = 'GitHub 网络暂时不可用'
    })

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await settingsModal.getByText('同步与版本', { exact: true }).click()

    await expect(settingsModal.getByText('无法确认 GitHub 远端同步状态')).toBeVisible()
    await expect(settingsModal.getByRole('button', { name: '无法确认远端状态' })).toBeVisible()
    await expect(settingsModal.getByRole('button', { name: '初始化私有同步仓库' })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('GitHub authorization request errors show an unknown status @bug', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    await page.evaluate(() => {
      window.__DATADJINN_TEST_GITHUB_AUTH_STATUS_ERROR__ = 'GitHub 授权状态请求超时'
    })

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await settingsModal.getByText('同步与版本', { exact: true }).click()

    await expect(settingsModal.getByText('状态未知')).toBeVisible()
    await expect(settingsModal.getByText('无法确认 GitHub 授权状态')).toBeVisible()
    await expect(settingsModal.getByText('未授权', { exact: true })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('changing sync passphrase warns about decryptable Git history @bug', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    await page.evaluate(() =>
      window.api.setSyncLocalState({
        passphrase: 'sync-passphrase-for-warning',
        lastSyncedAt: Date.now(),
        lastSyncAttemptAt: 1_700_000_000_100,
        lastSyncError: 'GitHub 网络暂时不可用'
      })
    )
    await page.reload()
    await waitForAppReady(page)

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await settingsModal.getByText('同步与版本', { exact: true }).click()

    await expect(settingsModal.getByText(/Git 历史中的旧提交仍可能使用旧口令解密/)).toBeVisible()
    await expect(settingsModal.getByText('最近一次同步未完成')).toBeVisible()
    await expect(settingsModal.getByText(/GitHub 网络暂时不可用/)).toBeVisible()
    await settingsModal.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: '同步与版本' }).click()
    await expect(page.getByRole('menuitem').filter({ hasText: '同步未完成' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('signing out clears the in-memory automatic sync state @bug', async () => {
  const electronApp = await launchRegressionApp()

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)
    await page.evaluate(async () => {
      await window.api.setSyncLocalState({
        passphrase: 'sync-passphrase-for-sign-out',
        autoSyncEnabled: true,
        lastSyncedAt: Date.now(),
        basePayload: {
          format: 'datadjinn-sync',
          version: 1,
          generated_at: new Date().toISOString(),
          device_id: 'test-device',
          connections: {},
          settings: {},
          preferences: {}
        }
      })
    })
    await page.reload()
    await waitForAppReady(page)
    await page.evaluate(() => {
      window.__DATADJINN_TEST_GITHUB_AUTH_STATUS__ = {
        authorized: true,
        login: 'test-user'
      }
    })

    await page.getByRole('button', { name: '设置' }).click()
    const settingsModal = page.locator('.settings-window-modal')
    await settingsModal.getByText('同步与版本', { exact: true }).click()
    await expect(settingsModal.getByLabel('自动同步')).toBeChecked()
    await settingsModal.getByRole('button', { name: '退出授权' }).click()

    await expect(settingsModal.getByLabel('自动同步')).not.toBeChecked()
    await expect(settingsModal.getByLabel('自动同步')).toBeDisabled()
    await expect(settingsModal.getByText('尚未同步')).toBeVisible()
  } finally {
    const page = electronApp.windows()[0]
    if (page) {
      await page.evaluate(() => window.api.clearSyncLocalState()).catch(() => undefined)
    }
    await electronApp.close()
  }
})

test('sync restores connections inside their remote groups @bug', async () => {
  const electronApp = await launchRegressionApp()
  let page
  let originalTreePreferences: { preferences: Record<string, unknown>; updatedAt: number } | undefined
  let originalSyncLocalState: Awaited<ReturnType<typeof window.api.getSyncLocalState>> | undefined

  try {
    page = await electronApp.firstWindow()
    await waitForAppReady(page)
    originalTreePreferences = await page.evaluate(() => window.api.getConnectionTreePreferencesMeta())
    originalSyncLocalState = await page.evaluate(() => window.api.getSyncLocalState())

    const connectionId = await page.evaluate(async () => {
      const result = await window.api.requestJson('/connections')
      return result.connections[0]?.connection_id
    })
    expect(connectionId).toBeTruthy()
    await page.evaluate(async (sourceConnectionId) => {
      const syncedFolderId = 'synced-folder-from-remote'
      const secondFolderId = 'second-synced-folder-from-remote'
      const timestamp = Date.now()
      const preferences = {
        connection_folders: [
          { id: syncedFolderId, name: '远端同步分组' },
          { id: secondFolderId, name: '第二个同步分组' }
        ],
        connection_folder_assignments: {},
        connection_folder_order: [secondFolderId, syncedFolderId],
        root_connection_order: [],
        root_item_order: [`folder:${secondFolderId}`, `folder:${syncedFolderId}`],
        root_item_order_customized: true,
        pinned_root_item_ids: [],
        folder_connection_order: {}
      }
      await window.api.setConnectionTreePreferences(preferences, timestamp)
      await window.api.requestJson('/preferences/connection-tree', {
        method: 'PUT',
        body: JSON.stringify({ preferences, updated_at: timestamp })
      })
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
      await page
        .evaluate(async ({ preferences, syncState }) => {
          if (!preferences) {
            return
          }
          const timestamp = Date.now()
          await window.api.setConnectionTreePreferences(preferences, timestamp)
          await window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({ preferences, updated_at: timestamp })
          })
          await window.api.clearSyncLocalState()
          if (syncState) {
            await window.api.setSyncLocalState(syncState)
          }
        }, { preferences: originalTreePreferences?.preferences, syncState: originalSyncLocalState })
        .catch(() => undefined)
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
  const aiSessionText = `ai-session-${crypto.randomUUID()}`

  try {
    const page = await electronApp.firstWindow()
    await waitForAppReady(page)

    const restored = await page.evaluate(
      async ({ passphrase, databasePassword, aiKey }) => {
        await window.api.setSyncLocalState({
          passphrase,
          remoteSha: 'test-sha',
          lastSyncedAt: 1_700_000_000_000,
          lastSyncAttemptAt: 1_700_000_000_100,
          lastSyncError: '上次同步失败回归信息',
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
    expect(restored.lastSyncAttemptAt).toBe(1_700_000_000_100)
    expect(restored.lastSyncError).toBe('上次同步失败回归信息')

    const clearedSyncError = await page.evaluate(async () => {
      await window.api.setSyncLocalState({ lastSyncError: null })
      return window.api.getSyncLocalState()
    })
    expect(clearedSyncError.lastSyncError).toBeUndefined()

    const aiState = await page.evaluate(
      async ({ aiKey, aiSessionText }) => {
        await window.api.setAIConfigs([
          {
            id: 'encrypted-ai-config-regression',
            name: 'Encrypted AI config regression',
            enabled: true,
            provider: 'openai-compatible',
            base_url: 'https://example.com/v1',
            api_key: aiKey,
            model: 'test-model'
          }
        ])
        await window.api.setAISessions([
          {
            id: 'encrypted-ai-session-regression',
            title: 'Encrypted AI session regression',
            createdAt: 1,
            updatedAt: 1,
            messages: [{ role: 'user', content: aiSessionText }]
          }
        ])
        return {
          configs: await window.api.getAIConfigs(),
          sessions: await window.api.getAISessions()
        }
      },
      { aiKey, aiSessionText }
    )
    expect(aiState.configs[0].api_key).toBe(aiKey)
    expect(aiState.sessions[0].messages[0].content).toBe(aiSessionText)

    const configText = fs.readFileSync(path.join(readFixtureUserDataDir(), 'config.json'), 'utf-8')
    expect(configText).not.toContain(passphrase)
    expect(configText).not.toContain(databasePassword)
    expect(configText).not.toContain(aiKey)
    expect(configText).not.toContain(aiSessionText)
  } finally {
    const windows = electronApp.windows()
    if (windows[0]) {
      await windows[0].evaluate(() => window.api.clearSyncLocalState()).catch(() => undefined)
    }
    await electronApp.close()
  }
})
