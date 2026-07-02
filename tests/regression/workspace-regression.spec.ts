const { test, expect, _electron: electron } = require('@playwright/test')
const crypto = require('node:crypto')
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
  await page.waitForSelector('.app-shell[data-startup-ready="true"]', { timeout: 60000 })
  await waitForBrowserIdle(page)
}

async function waitForBrowserIdle(page) {
  await page.evaluate(async () => {
    const waitFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    if (typeof window.requestIdleCallback === 'function') {
      await new Promise<void>((resolve) => {
        window.requestIdleCallback(() => resolve(), { timeout: 1000 })
      })
    } else {
      await waitFrame()
      await waitFrame()
    }
    await waitFrame()
  })
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

async function resizeResourcePanel(page, targetWidth) {
  const metrics = await page.evaluate((desiredWidth) => {
    const panel = document.querySelector('.resource-panel')
    const resizer = document.querySelector('.workspace-side-resizer')
    if (!(panel instanceof HTMLElement) || !(resizer instanceof HTMLElement)) {
      return null
    }

    const panelRect = panel.getBoundingClientRect()
    const resizerRect = resizer.getBoundingClientRect()
    return {
      currentWidth: panelRect.width,
      startX: resizerRect.left + (resizerRect.width / 2),
      targetX: panelRect.left + desiredWidth,
      y: resizerRect.top + Math.min(160, Math.max(40, resizerRect.height / 2)),
    }
  }, targetWidth)

  expect(metrics, 'resource panel resize handle should exist').not.toBeNull()
  if (!metrics) {
    return
  }

  await page.mouse.move(metrics.startX, metrics.y)
  await page.mouse.down()
  await page.mouse.move(metrics.targetX, metrics.y, { steps: 12 })
  await page.mouse.up()

  await expect.poll(async () => {
    return page.locator('.resource-panel').evaluate((node) => Math.round(node.getBoundingClientRect().width))
  }, { timeout: 10000 }).toBeGreaterThanOrEqual(targetWidth - 6)
}

function treeNode(page, key) {
  return page.locator(`.resource-tree-node-title[data-tree-node-key="${key}"]`)
}

async function revealTreeNode(page, key) {
  return page.evaluate(async (targetKey) => {
    const findTarget = () => document.querySelector(`.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`)
    const waitFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
    const findScrollHost = () => {
      const candidates = [
        document.querySelector('.resource-tree-viewport .ant-tree-list-holder'),
        document.querySelector('.resource-tree-viewport .ant-tree-list'),
        document.querySelector('.resource-tree-viewport'),
      ].filter((element) => element instanceof HTMLElement)
      return candidates.find((element) => element.scrollHeight > element.clientHeight + 4) ?? candidates[0] ?? null
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const immediateTarget = findTarget()
      if (immediateTarget instanceof HTMLElement) {
        immediateTarget.scrollIntoView({ block: 'center' })
        return true
      }

      const scrollHost = findScrollHost()
      if (!(scrollHost instanceof HTMLElement)) {
        await waitFrame()
        continue
      }

      scrollHost.scrollTop = 0
      await waitFrame()
      await waitFrame()
      const stepSize = Math.max(120, scrollHost.clientHeight - 32)
      const maxSteps = Math.max(12, Math.ceil(scrollHost.scrollHeight / stepSize) + 2)

      for (let step = 0; step < maxSteps; step += 1) {
        const currentTarget = findTarget()
        if (currentTarget instanceof HTMLElement) {
          currentTarget.scrollIntoView({ block: 'center' })
          return true
        }
        scrollHost.scrollTop = Math.min(scrollHost.scrollTop + stepSize, scrollHost.scrollHeight)
        await waitFrame()
        await waitFrame()
      }
    }

    const finalTarget = findTarget()
    if (finalTarget instanceof HTMLElement) {
      finalTarget.scrollIntoView({ block: 'center' })
      return true
    }
    return false
  }, key)
}

async function doubleClickTreeNode(page, key) {
  await expect.poll(async () => revealTreeNode(page, key), { timeout: 15000 }).toBe(true)
  await expect.poll(async () => {
    return page.evaluate((targetKey) => {
      const element = document.querySelector(`.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`)
      return element instanceof HTMLElement
    }, key)
  }, { timeout: 15000 }).toBe(true)
  await page.evaluate((targetKey) => {
    const element = document.querySelector(`.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`)
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Tree node is not clickable: ${targetKey}`)
    }
    element.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      detail: 2
    }))
  }, key)
}

async function ensureTreeNodeExpanded(page, key) {
  const revealed = await revealTreeNode(page, key)
  if (!revealed) {
    return
  }
  await page.evaluate((targetKey) => {
    const title = document.querySelector(`.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`)
    if (!(title instanceof HTMLElement)) {
      throw new Error(`Tree node not found: ${targetKey}`)
    }
    const treeNode = title.closest('.ant-tree-treenode')
    const expanded = treeNode?.classList.contains('ant-tree-treenode-switcher-open')
      || treeNode?.querySelector('.ant-tree-switcher')?.classList.contains('ant-tree-switcher_open')
    if (expanded) {
      return
    }
    const switcher = treeNode?.querySelector('.ant-tree-switcher')
    if (switcher instanceof HTMLElement) {
      switcher.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1
      }))
      return
    }
    title.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      detail: 2
    }))
  }, key)
}

async function openFixtureConnection(page) {
  const tableGroupKey = `object-group:${fixtureConnectionId}:::table`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await revealTreeNode(page, tableGroupKey)) {
      return
    }
    await doubleClickTreeNode(page, `connection:${fixtureConnectionId}`)
    await page.waitForTimeout(250)
  }
  await expect.poll(async () => revealTreeNode(page, tableGroupKey), { timeout: 30000 }).toBe(true)
}

async function openFixtureTable(page, tableName) {
  const targetKey = `table:${fixtureConnectionId}:::table:${tableName}`
  await openFixtureConnection(page)
  let revealed = await revealTreeNode(page, targetKey)
  if (!revealed) {
    await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
    await page.waitForTimeout(250)
    revealed = await revealTreeNode(page, targetKey)
  }
  if (!revealed) {
    await ensureTreeNodeExpanded(page, `connection:${fixtureConnectionId}`)
    await expect.poll(async () => revealTreeNode(page, targetKey), { timeout: 15000 }).toBe(true)
  }
  await doubleClickTreeNode(page, targetKey)
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText(tableName, { timeout: 30000 })
  await expect(page.locator('.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)
}

async function expectCellTextExactly(locator, expectedText) {
  await expect.poll(async () => {
    return locator.evaluateAll((nodes) => {
      const visibleNode = nodes.find((node) => {
        if (!(node instanceof HTMLElement)) {
          return false
        }
        const rect = node.getBoundingClientRect()
        const style = window.getComputedStyle(node)
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none'
      })
      const targetNode = visibleNode ?? nodes[0]
      return targetNode instanceof HTMLElement ? (targetNode.textContent ?? '') : null
    })
  }, { timeout: 10000 }).toBe(expectedText)
}

async function getVisibleDropdownMenuItemCenter(page, label) {
  return page.evaluate((expectedLabel) => {
    const items = Array.from(document.querySelectorAll('.result-cell-context-menu-panel .ant-menu-item, .ant-dropdown .ant-dropdown-menu .ant-dropdown-menu-item'))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
    const normalizedExpectedLabel = expectedLabel.replace(/\s+/g, '')
    const target = items.find((item) => {
      const text = item.textContent?.replace(/\s+/g, '') ?? ''
      if (text !== normalizedExpectedLabel && !text.includes(normalizedExpectedLabel)) {
        return false
      }
      const rect = item.getBoundingClientRect()
      const style = window.getComputedStyle(item)
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
    })
    if (!target) {
      return null
    }
    const rect = target.getBoundingClientRect()
    return {
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2)
    }
  }, label)
}

async function clickVisibleDropdownMenuItem(page, label) {
  let center = null
  await expect.poll(async () => {
    center = await getVisibleDropdownMenuItemCenter(page, label)
    return center !== null
  }, {
    timeout: 10000
  }).toBe(true)
  if (!center) {
    throw new Error(`visible dropdown item should exist: ${label}`)
  }
  await page.mouse.click(center.x, center.y)
}

async function countVisibleDropdowns(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.result-cell-context-menu-panel, .ant-dropdown'))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }).length)
}

function countSelectedCellsInNode(node) {
  return Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
    .filter((element) => element instanceof HTMLElement)
    .filter((element) => {
      const host = element.closest('td, .ant-table-cell')
      return element.classList.contains('cell-selected-runtime')
        || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
    })
}

function collectVisibleSelectedCells(node) {
  return Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter((element) => {
      const host = element.closest('td, .ant-table-cell')
      return element.classList.contains('cell-selected-runtime')
        || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
    })
}

function hashScreenshot(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex')
}

async function readStableChromeClips(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) {
        return null
      }
      const bounds = element.getBoundingClientRect()
      if (bounds.width < 4 || bounds.height < 4) {
        return null
      }
      return {
        x: Math.max(0, Math.floor(bounds.x)),
        y: Math.max(0, Math.floor(bounds.y)),
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(1, Math.floor(bounds.height))
      }
    }

    return {
      tableHeader: rect('.workspace-tab-panels .workspace-active-content .result-table .ant-table-header'),
      whereShell: rect('.workspace-tab-panels .workspace-active-content .preview-where-shell'),
      aiHeader: rect('.ai-dock-panel .ai-panel-header')
    }
  })
}

async function sampleClipHashes(page, clips, sampleCount = 6, delayMs = 70) {
  const clipEntries = Object.entries(clips).filter(([, clip]) => clip)
  const hashes = {}
  for (const [name] of clipEntries) {
    hashes[name] = []
  }

  for (let index = 0; index < sampleCount; index += 1) {
    for (const [name, clip] of clipEntries) {
      const buffer = await page.screenshot({ clip })
      hashes[name].push(hashScreenshot(buffer))
    }
    if (index < sampleCount - 1) {
      await page.waitForTimeout(delayMs)
    }
  }

  return Object.fromEntries(Object.entries(hashes).map(([name, values]) => ([
    name,
    {
      unique: [...new Set(values)],
      count: values.length
    }
  ])))
}

async function findVisiblePreviewCellAfterScroll(page, activeResult, scrollTop, pickFromEnd = 3) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const target = await activeResult.evaluate(async (node, payload) => {
      const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
      if (!(holder instanceof HTMLElement)) {
        return null
      }
      const maxScrollTop = Math.max(0, holder.scrollHeight - holder.clientHeight)
      holder.scrollTop = Math.min(payload.scrollTop, maxScrollTop)
      holder.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))
      const holderRect = holder.getBoundingClientRect()
      const cells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
        .map((cell) => {
          if (!(cell instanceof HTMLElement)) {
            return null
          }
          const rect = cell.getBoundingClientRect()
          return {
            cellKey: cell.dataset.cellKey ?? '',
            x: rect.x + (rect.width / 2),
            y: rect.y + (rect.height / 2),
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            text: cell.textContent ?? ''
          }
        })
        .filter((cell) => cell
          && cell.cellKey
          && cell.right <= holderRect.right
          && cell.left >= holderRect.left
          && cell.top >= holderRect.top
          && cell.bottom <= holderRect.bottom)
      if (cells.length === 0) {
        return null
      }
      return cells[Math.max(0, cells.length - payload.pickFromEnd)] ?? null
    }, { scrollTop, pickFromEnd })
    if (target) {
      return target
    }
    await page.waitForTimeout(80)
  }
  return null
}

async function installOpenTableRenderCounters(page) {
  await page.evaluate(() => {
    const counters = {
      aiPanelMutations: 0,
      workspaceMutations: 0
    }
    const aiPanel = document.querySelector('.ai-dock-panel')
    const workspacePane = document.querySelector('.workspace-tab-panels')
    const observers = []

    if (aiPanel) {
      const aiObserver = new MutationObserver((mutations) => {
        counters.aiPanelMutations += mutations.reduce((total, mutation) => (
          total + mutation.addedNodes.length + mutation.removedNodes.length
        ), 0)
      })
      aiObserver.observe(aiPanel, { childList: true, subtree: true })
      observers.push(aiObserver)
    }

    if (workspacePane) {
      const workspaceObserver = new MutationObserver((mutations) => {
        counters.workspaceMutations += mutations.reduce((total, mutation) => (
          total + mutation.addedNodes.length + mutation.removedNodes.length
        ), 0)
      })
      workspaceObserver.observe(workspacePane, { childList: true, subtree: true })
      observers.push(workspaceObserver)
    }

    window.__datadjinnOpenTableCounters = {
      counters,
      dispose: () => observers.forEach((observer) => observer.disconnect())
    }
  })
}

async function readOpenTableRenderCounters(page) {
  return page.evaluate(() => {
    const payload = window.__datadjinnOpenTableCounters
    if (!payload) {
      return null
    }
    return payload.counters
  })
}

async function removeOpenTableRenderCounters(page) {
  await page.evaluate(() => {
    const payload = window.__datadjinnOpenTableCounters
    payload?.dispose?.()
    delete window.__datadjinnOpenTableCounters
  })
}

async function installVisualMutationCounters(page) {
  await page.evaluate(() => {
    const counters = {
      aiClassMutations: 0,
      aiStyleMutations: 0,
      tableShellClassMutations: 0,
      tableShellStyleMutations: 0
    }
    const aiPanel = document.querySelector('.ai-dock-panel')
    const observers = []
    const observe = (element, area) => {
      if (!(element instanceof HTMLElement)) {
        return
      }
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== 'attributes') {
            continue
          }
          if (mutation.attributeName === 'class') {
            counters[`${area}ClassMutations`] += 1
          }
          if (mutation.attributeName === 'style') {
            counters[`${area}StyleMutations`] += 1
          }
        }
      })
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style']
      })
      observers.push(observer)
    }

    observe(aiPanel, 'ai')
    const activePane = document.querySelector('.workspace-tab-panels .workspace-active-content')
    if (activePane instanceof HTMLElement) {
      const shellNodes = [
        activePane.querySelector('.result-table-shell'),
        activePane.querySelector('.result-table-content'),
        activePane.querySelector('.result-table-loading-overlay'),
        activePane.querySelector('.result-table-native-horizontal-scrollbar')
      ].filter((element, index, all) => element instanceof HTMLElement && all.indexOf(element) === index)
      shellNodes.forEach((element) => observe(element, 'tableShell'))
    }

    window.__datadjinnVisualMutationCounters = {
      counters,
      dispose: () => observers.forEach((observer) => observer.disconnect())
    }
  })
}

async function readVisualMutationCounters(page) {
  return page.evaluate(() => window.__datadjinnVisualMutationCounters?.counters ?? null)
}

async function removeVisualMutationCounters(page) {
  await page.evaluate(() => {
    const payload = window.__datadjinnVisualMutationCounters
    payload?.dispose?.()
    delete window.__datadjinnVisualMutationCounters
  })
}

async function installAiContextStatsCounter(page) {
  await page.evaluate(() => {
    const originalRequestJson = window.api.requestJson.bind(window.api)
    const counters = {
      total: 0,
      contextStats: 0,
      paths: []
    }

    window.api.requestJson = async (path, options) => {
      counters.total += 1
      counters.paths.push(String(path))
      if (path === '/ai/context-stats') {
        counters.contextStats += 1
      }
      return originalRequestJson(path, options)
    }

    window.__datadjinnAiContextStatsCounter = {
      counters,
      restore: () => {
        window.api.requestJson = originalRequestJson
      }
    }
  })
}

async function readAiContextStatsCounter(page) {
  return page.evaluate(() => window.__datadjinnAiContextStatsCounter?.counters ?? null)
}

async function removeAiContextStatsCounter(page) {
  await page.evaluate(() => {
    const payload = window.__datadjinnAiContextStatsCounter
    payload?.restore?.()
    delete window.__datadjinnAiContextStatsCounter
  })
}

async function collectOpenTableVisualStability(page) {
  return page.evaluate(async () => {
    const activePane = document.querySelector('.workspace-tab-panels .workspace-active-content')
    if (!(activePane instanceof HTMLElement)) {
      return null
    }

    const samples = []
    for (let index = 0; index < 8; index += 1) {
      const loadingOverlay = activePane.querySelector('.result-table-loading-overlay')
      const tableHeader = activePane.querySelector('.result-table .ant-table-thead')
      const visibleRows = activePane.querySelectorAll('.result-table tbody tr, .result-table .ant-table-tbody-virtual-holder .ant-table-row').length
      const shell = activePane.querySelector('.result-table-shell')
      const shellRect = shell instanceof HTMLElement ? shell.getBoundingClientRect() : null
      const aiPanel = document.querySelector('.ai-dock-panel')
      const aiPanelRect = aiPanel instanceof HTMLElement ? aiPanel.getBoundingClientRect() : null
      const resultContent = activePane.querySelector('.result-table-content')
      const resultBody = activePane.querySelector('.result-table-body')
      samples.push({
        hasLoadingOverlay: Boolean(loadingOverlay),
        hasTableHeader: Boolean(tableHeader),
        visibleRows,
        shellHeight: shellRect?.height ?? 0,
        shellTop: shellRect?.top ?? 0,
        aiPanelWidth: aiPanelRect?.width ?? 0,
        aiPanelLeft: aiPanelRect?.left ?? 0,
        resultContentChildren: resultContent?.childElementCount ?? 0,
        resultBodyChildren: resultBody?.childElementCount ?? 0
      })
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
    }

    return samples
  })
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

async function getActiveWorkspaceTabTitle(page) {
  const activeTab = page.locator('.workspace-tabs .ant-tabs-tab-active')
  await expect(activeTab).toBeVisible({ timeout: 30000 })
  return ((await activeTab.textContent()) ?? '').trim()
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

async function focusMonacoEditor(page) {
  const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
  await expect(editorTextbox).toBeVisible({ timeout: 30000 })
  await editorTextbox.focus()
  return editorTextbox
}

async function readActiveStatementMenu(page) {
  const dropdown = page.locator('.query-execute-dropdown').last()
  await expect(dropdown).toBeVisible({ timeout: 10000 })
  return dropdown.locator('.query-statement-menu-item.is-active .query-statement-menu-title').last().textContent()
}

async function readActiveStatementIndex(page) {
  const button = page.locator('.query-execute-dropdown-button').first()
  await expect(button).toBeVisible({ timeout: 10000 })
  const rawValue = await button.getAttribute('data-active-statement-index')
  return Number(rawValue ?? '-1')
}

async function clickSqlLineNearEnd(page, text) {
  const line = page.locator('.sql-editor-container .view-lines > div').filter({ hasText: text }).first()
  await expect(line).toBeVisible({ timeout: 30000 })
  const box = await line.boundingBox()
  if (!box) {
    throw new Error(`Monaco line not measurable: ${text}`)
  }
  await page.mouse.click(box.x + Math.max(8, box.width - 6), box.y + (box.height / 2))
}

async function moveCaretToLineEnd(page, lineNumber) {
  const line = page.locator('.sql-editor-container .view-lines > div').filter({ hasText: `select ${lineNumber}` }).first()
  await expect(line).toBeVisible({ timeout: 30000 })
  const box = await line.boundingBox()
  if (!box) {
    throw new Error(`Monaco line not measurable: ${lineNumber}`)
  }
  await page.mouse.click(box.x + 18, box.y + (box.height / 2))
  await page.keyboard.press('End')
  await page.waitForTimeout(80)
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

  await waitForBrowserIdle(page)
  const openStartedAt = Date.now()
  await open()
  await expect(modal).toBeVisible({ timeout: 10000 })
  const openMs = Date.now() - openStartedAt

  const closeStartedAt = Date.now()
  await close()
  await expect(modal).not.toBeVisible({ timeout: 10000 })
  const closeMs = Date.now() - closeStartedAt
  await waitForBrowserIdle(page)

  console.log(`[perf][modal][${label}] ${JSON.stringify({ openMs, closeMs })}`)
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)

  return { openMs, closeMs }
}

async function measureConnectionCreateFlow(page, itemLabel) {
  const createButton = page.locator('.resource-header .resource-add')
  const menuItem = page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: itemLabel })
  const modal = page.locator('.connection-editor-modal')

  await waitForBrowserIdle(page)
  const menuOpenStartedAt = Date.now()
  await createButton.click()
  await expect(menuItem).toBeVisible({ timeout: 10000 })
  const menuOpenMs = Date.now() - menuOpenStartedAt

  const modalOpenStartedAt = Date.now()
  await menuItem.click()
  await expect(modal).toBeVisible({ timeout: 10000 })
  const modalOpenMs = Date.now() - modalOpenStartedAt

  await page.locator('.connection-editor-modal .ant-modal-close').click()
  await expect(modal).not.toBeVisible({ timeout: 10000 })
  await waitForBrowserIdle(page)

  console.log(`[perf][connection-create-flow][${itemLabel}] ${JSON.stringify({ menuOpenMs, modalOpenMs })}`)
  return { menuOpenMs, modalOpenMs }
}

test.describe('workspace regression', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(electronEntry)) {
      throw new Error(`Electron entry missing: ${electronEntry}`)
    }
    readFixtureUserDataDir()
  })

  test('table preview should fill pane for small and large tables @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      await expectTableFillsPane(page, smallTableName)

      await openFixtureTable(page, largeTableName)
      await expectTableFillsPane(page, largeTableName)
    } finally {
      await electronApp.close()
    }
  })

  test('switching workspaces should stay responsive and tree nodes should still toggle @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      await openFixtureTable(page, mediumTableName)
      await openFixtureTable(page, largeTableName)

      const switchToSmallMs = await clickWorkspaceTab(page, smallTableName)
      console.log(`[perf][switch-tab][${smallTableName}] ${switchToSmallMs}`)
      await expectTableFillsPane(page, smallTableName)
      expect(switchToSmallMs, 'switch to small table tab is too slow').toBeLessThan(800)

      const switchToLargeMs = await clickWorkspaceTab(page, largeTableName)
      console.log(`[perf][switch-tab][${largeTableName}] ${switchToLargeMs}`)
      await expectTableFillsPane(page, largeTableName)
      expect(switchToLargeMs, 'switch to large table tab is too slow').toBeLessThan(1000)

      const openViewsMs = await toggleTreeNode(page, `object-group:${fixtureConnectionId}:::view`)
      console.log(`[perf][tree-toggle][view-open] ${openViewsMs}`)
      await expect(treeNode(page, `db-object:${fixtureConnectionId}:::view:active_large_items`)).toBeVisible({ timeout: 30000 })
      expect(openViewsMs, 'tree expand is too slow while workspaces are open').toBeLessThan(700)

      const closeViewsMs = await toggleTreeNode(page, `object-group:${fixtureConnectionId}:::view`)
      console.log(`[perf][tree-toggle][view-close] ${closeViewsMs}`)
      await expect(treeNode(page, `db-object:${fixtureConnectionId}:::view:active_large_items`)).toHaveCount(0)
      expect(closeViewsMs, 'tree collapse is too slow while workspaces are open').toBeLessThan(700)
    } finally {
      await electronApp.close()
    }
  })

  test('opening a table should not repeatedly rebuild workspace and ai dock content @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await installOpenTableRenderCounters(page)
      await installAiContextStatsCounter(page)

      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)
      const chromeClips = await readStableChromeClips(page)
      const openTableHashes = await sampleClipHashes(page, chromeClips)
      await page.waitForTimeout(500)

      const counters = await readOpenTableRenderCounters(page)
      const aiCounters = await readAiContextStatsCounter(page)
      const visualSamples = await collectOpenTableVisualStability(page)
      console.log(`[perf][open-table][mutations] ${JSON.stringify(counters)}`)
      console.log(`[perf][open-table][ai-context-stats] ${JSON.stringify(aiCounters)}`)
      console.log(`[perf][open-table][visual-samples] ${JSON.stringify(visualSamples)}`)
      console.log(`[perf][open-table][chrome-hashes] ${JSON.stringify(openTableHashes)}`)
      expect(counters).not.toBeNull()
      expect(aiCounters).not.toBeNull()
      expect(visualSamples).not.toBeNull()
      expect(openTableHashes.tableHeader?.unique.length ?? 0, 'opening one table should not make the table header flicker after first paint').toBeLessThanOrEqual(1)
      expect(openTableHashes.whereShell?.unique.length ?? 0, 'opening one table should not make the where row flicker after first paint').toBeLessThanOrEqual(1)
      expect(openTableHashes.aiHeader?.unique.length ?? 0, 'opening one table should not make the ai dock header flicker after first paint').toBeLessThanOrEqual(1)
      expect(counters.workspaceMutations, 'opening one table should not repeatedly rebuild the workspace content').toBeLessThan(220)
      expect(counters.aiPanelMutations, 'opening one table should not repeatedly rebuild the ai dock content').toBeLessThan(80)
      expect(aiCounters.contextStats, 'opening one table should not repeatedly trigger ai context stats').toBeLessThanOrEqual(1)
      expect(visualSamples.every((sample) => sample.hasTableHeader), 'opening one table should not lose the table header after it becomes visible').toBe(true)
      expect(visualSamples.every((sample) => !sample.hasLoadingOverlay), 'opening one table should not flash the loading overlay after the table is visible').toBe(true)
      expect(visualSamples.every((sample) => sample.visibleRows > 0), 'opening one table should not fall back to an empty content frame').toBe(true)
      expect(Math.max(...visualSamples.map((sample) => sample.shellHeight)) - Math.min(...visualSamples.map((sample) => sample.shellHeight)), 'opening one table should not keep resizing the result shell after first paint').toBeLessThanOrEqual(1)
      expect(Math.max(...visualSamples.map((sample) => sample.shellTop)) - Math.min(...visualSamples.map((sample) => sample.shellTop)), 'opening one table should not visibly shift the result shell vertically after first paint').toBeLessThanOrEqual(1)
      expect(Math.max(...visualSamples.map((sample) => sample.aiPanelWidth)) - Math.min(...visualSamples.map((sample) => sample.aiPanelWidth)), 'opening one table should not visibly resize the ai dock after first paint').toBeLessThanOrEqual(1)
      expect(Math.max(...visualSamples.map((sample) => sample.aiPanelLeft)) - Math.min(...visualSamples.map((sample) => sample.aiPanelLeft)), 'opening one table should not visibly shift the ai dock after first paint').toBeLessThanOrEqual(1)

      await removeOpenTableRenderCounters(page)
      await removeAiContextStatsCounter(page)
    } finally {
      await electronApp.close()
    }
  })

  test('opening and selecting in table should not cause repeated visual mutations @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)
      await installAiContextStatsCounter(page)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })

      const targets = await activeResult.evaluate((node) => {
        const cells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
        const first = cells[0]
        const second = cells[1]
        const firstRect = first?.getBoundingClientRect()
        const secondRect = second?.getBoundingClientRect()
        const firstRowButton = node.querySelector('.row-number-button')
        const firstColumnButton = node.querySelector('.column-select-button')
        const rowRect = firstRowButton?.getBoundingClientRect()
        const colRect = firstColumnButton?.getBoundingClientRect()
        if (!firstRect || !secondRect || !rowRect || !colRect) {
          return null
        }
        return {
          first: { x: firstRect.x + (firstRect.width / 2), y: firstRect.y + (firstRect.height / 2) },
          second: { x: secondRect.x + (secondRect.width / 2), y: secondRect.y + (secondRect.height / 2) },
          row: { x: rowRect.x + (rowRect.width / 2), y: rowRect.y + (rowRect.height / 2) },
          column: { x: colRect.x + (colRect.width / 2), y: colRect.y + (colRect.height / 2) }
        }
      })
      expect(targets).not.toBeNull()

      await installVisualMutationCounters(page)

      await page.mouse.move(targets.first.x, targets.first.y)
      await page.mouse.down()
      await page.mouse.move(targets.second.x, targets.second.y, { steps: 8 })
      await page.mouse.up()
      await page.mouse.click(targets.row.x, targets.row.y)
      await page.mouse.click(targets.column.x, targets.column.y)
      await page.waitForTimeout(160)

      const clips = await readStableChromeClips(page)
      const hashes = await sampleClipHashes(page, clips)

      const counters = await readVisualMutationCounters(page)
      const aiCounters = await readAiContextStatsCounter(page)
      console.log(`[perf][visual-mutations] ${JSON.stringify(counters)}`)
      console.log(`[perf][interaction][ai-context-stats] ${JSON.stringify(aiCounters)}`)
      console.log(`[perf][interaction][visual-hashes] ${JSON.stringify(hashes)}`)
      expect(counters).not.toBeNull()
      expect(aiCounters).not.toBeNull()
      expect(counters.aiClassMutations + counters.aiStyleMutations, 'table interactions should not keep restyling the ai dock').toBeLessThan(8)
      expect(counters.tableShellClassMutations + counters.tableShellStyleMutations, 'table interactions should avoid excessive result shell restyling').toBeLessThan(40)
      expect(aiCounters.contextStats, 'table interactions should not trigger ai context stats').toBe(0)
      expect(hashes.tableHeader?.unique.length ?? 0, 'table header should stay visually stable during selection interactions').toBeLessThanOrEqual(1)
      expect(hashes.whereShell?.unique.length ?? 0, 'where row should stay visually stable during selection interactions').toBeLessThanOrEqual(1)
      expect(hashes.aiHeader?.unique.length ?? 0, 'ai header should stay visually stable during selection interactions').toBeLessThanOrEqual(1)

      await removeVisualMutationCounters(page)
      await removeAiContextStatsCounter(page)
    } finally {
      await electronApp.close()
    }
  })

  test('rapid row number clicks should stay responsive without restyling the result shell repeatedly @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .row-number-button').first()).toBeVisible({ timeout: 30000 })

      await installVisualMutationCounters(page)
      await installAiContextStatsCounter(page)
      const metrics = await activeResult.evaluate(async (node) => {
        const body = node.querySelector('.result-table-body')
        if (!(body instanceof HTMLElement)) {
          return null
        }
        const buttons = Array.from(node.querySelectorAll('.row-number-button'))
          .filter((button): button is HTMLElement => button instanceof HTMLElement)
          .slice(0, 6)
        if (buttons.length < 4) {
          return null
        }

        const frame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        const startedAt = performance.now()
        for (const button of buttons) {
          const rect = button.getBoundingClientRect()
          const clientX = rect.x + (rect.width / 2)
          const clientY = rect.y + (rect.height / 2)
          button.dispatchEvent(new MouseEvent('mousedown', {
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
          }))
          body.dispatchEvent(new MouseEvent('mouseup', {
            button: 0,
            buttons: 0,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
          }))
          await frame()
        }
        await frame()
        return {
          elapsed: performance.now() - startedAt,
          selectedButtons: buttons.filter((button) => button.classList.contains('selected')).length
        }
      })
      expect(metrics).not.toBeNull()
      await page.waitForTimeout(160)

      const counters = await readVisualMutationCounters(page)
      const aiCounters = await readAiContextStatsCounter(page)
      console.log(`[perf][rapid-row-clicks] ${JSON.stringify({ metrics, counters, aiCounters })}`)
      expect(metrics.elapsed, 'rapid row selection clicks should stay responsive').toBeLessThan(300)
      expect(metrics.selectedButtons, 'rapid row selection should leave one visible row button selected').toBeGreaterThan(0)
      expect(aiCounters).not.toBeNull()
      expect(aiCounters.contextStats, 'rapid row selection should not trigger ai context stats').toBe(0)
      await removeVisualMutationCounters(page)
      await removeAiContextStatsCounter(page)
      expect(counters).not.toBeNull()
      expect(counters.tableShellClassMutations + counters.tableShellStyleMutations, 'rapid row clicks should not keep restyling the result shell').toBeLessThan(30)
      expect(counters.aiClassMutations + counters.aiStyleMutations, 'rapid row clicks should not restyle the ai dock').toBeLessThan(6)

      await removeVisualMutationCounters(page)
    } finally {
      await electronApp.close()
    }
  })

  test('sql editor typing should stay responsive @smoke', async () => {
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

      expect(typingMetrics.average, 'sql editor average typing latency is too high').toBeLessThan(80)
      expect(typingMetrics.max, 'sql editor max typing latency is too high').toBeLessThan(450)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('sql active statement should include trailing semicolon caret and switch quickly @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('select 1;\nselect 2;')

      const statementToggle = page.getByRole('button', { name: '选择执行语句' })
      await expect(statementToggle).toBeVisible({ timeout: 30000 })

      await moveCaretToLineEnd(page, 1)
      await expect.poll(async () => {
        return readActiveStatementIndex(page)
      }, { timeout: 10000 }).toBe(0)

      await moveCaretToLineEnd(page, 2)
      await expect.poll(async () => {
        return readActiveStatementIndex(page)
      }, { timeout: 10000 }).toBe(1)

      await moveCaretToLineEnd(page, 2)
      await expect.poll(async () => {
        return readActiveStatementIndex(page)
      }, { timeout: 10000 }).toBe(1)

      const switchDurations = []
      for (let index = 0; index < 4; index += 1) {
        const startedAt = Date.now()
        await moveCaretToLineEnd(page, 1)
        await expect.poll(async () => {
          return readActiveStatementIndex(page)
        }, { timeout: 10000 }).toBe(0)
        switchDurations.push(Date.now() - startedAt)

        const nextStartedAt = Date.now()
        await moveCaretToLineEnd(page, 2)
        await expect.poll(async () => {
          return readActiveStatementIndex(page)
        }, { timeout: 10000 }).toBe(1)
        switchDurations.push(Date.now() - nextStartedAt)
      }

      const maxSwitchMs = Math.max(...switchDurations, 0)
      const averageSwitchMs = switchDurations.reduce((sum, value) => sum + value, 0) / Math.max(switchDurations.length, 1)
      console.log(`[perf][sql-editor][active-statement-switch] ${JSON.stringify({ averageSwitchMs, maxSwitchMs, samples: switchDurations.length })}`)
      expect(averageSwitchMs, 'sql active statement average switch latency is too high').toBeLessThan(450)
      expect(maxSwitchMs, 'sql active statement max switch latency is too high').toBeLessThan(1200)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('table search button and shortcut should open search row @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)

      const previewSearchToggle = page.locator('.workspace-tab-panels .workspace-active-content .table-data-toolbar .table-toolbar-toggle').first()
      const searchBar = page.locator('.workspace-tab-panels .workspace-active-content .result-table-search-overlay .table-search-bar')
      await expect(previewSearchToggle).toBeVisible({ timeout: 30000 })
      const searchOpenStartedAt = Date.now()
      await previewSearchToggle.click()
      await expect(searchBar).toBeVisible({ timeout: 10000 })
      const searchOpenMs = Date.now() - searchOpenStartedAt
      console.log(`[perf][table-search][button-open] ${searchOpenMs}`)
      expect(searchOpenMs, 'table search bar opens too slowly').toBeLessThan(700)
      const searchPosition = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => {
        const shell = node.querySelector('.result-table-header-shell')
        const toolbar = node.querySelector('.table-data-toolbar')
        const search = node.querySelector('.result-table-search-overlay .table-search-bar')
        if (!(shell instanceof HTMLElement) || !(toolbar instanceof HTMLElement) || !(search instanceof HTMLElement)) {
          return null
        }
        const shellRect = shell.getBoundingClientRect()
        const toolbarRect = toolbar.getBoundingClientRect()
        const searchRect = search.getBoundingClientRect()
        return {
          centerDelta: Math.abs((searchRect.left + (searchRect.width / 2)) - (shellRect.left + (shellRect.width / 2))),
          topGap: searchRect.top - toolbarRect.bottom
        }
      })
      expect(searchPosition).not.toBeNull()
      expect(searchPosition.centerDelta, 'table search row should stay horizontally centered').toBeLessThanOrEqual(12)
      expect(searchPosition.topGap, 'table search row should render below the toolbar instead of jumping to the corner').toBeGreaterThanOrEqual(0)
      const searchCloseStartedAt = Date.now()
      await page.keyboard.press('Escape')
      await expect(searchBar).toHaveCount(0)
      const searchCloseMs = Date.now() - searchCloseStartedAt
      console.log(`[perf][table-search][button-close] ${searchCloseMs}`)
      expect(searchCloseMs, 'table search bar closes too slowly').toBeLessThan(250)

      await page.locator('.workspace-tab-panels .workspace-active-content .result-table-content').click()
      await page.keyboard.press('Control+F')
      await expect(searchBar).toBeVisible({ timeout: 10000 })
      const shortcutCloseStartedAt = Date.now()
      await page.keyboard.press('Escape')
      await expect(searchBar).toHaveCount(0)
      const shortcutCloseMs = Date.now() - shortcutCloseStartedAt
      console.log(`[perf][table-search][shortcut-close] ${shortcutCloseMs}`)
      expect(shortcutCloseMs, 'table search bar shortcut close is too slow').toBeLessThan(250)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('query result search should highlight matches without leaving an empty toolbar gap @bug', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })

      const closedMetrics = await activeResult.evaluate((node) => {
        const status = node.querySelector('.result-status')
        const content = node.querySelector('.result-table-content')
        const headerShell = node.querySelector('.result-table-header-shell')
        if (!(status instanceof HTMLElement) || !(content instanceof HTMLElement)) {
          return null
        }
        const statusRect = status.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        return {
          gap: contentRect.top - statusRect.bottom,
          headerShellCount: headerShell ? 1 : 0
        }
      })
      expect(closedMetrics).not.toBeNull()
      expect(closedMetrics.gap, 'query result pager and table should not leave an extra blank toolbar gap').toBeLessThanOrEqual(12)
      expect(closedMetrics.headerShellCount, 'query result should not render an empty toolbar shell while search is closed').toBe(0)

      await activeResult.locator('.result-status-right .table-toolbar-toggle').click()
      const searchBar = activeResult.locator('.result-table-search-overlay .table-search-bar')
      await expect(searchBar).toBeVisible({ timeout: 10000 })

      const searchInput = searchBar.locator('input')
      await expect(searchInput).toBeVisible({ timeout: 10000 })
      await searchInput.fill('category_1')

      await expect.poll(async () => {
        return activeResult.locator('mark.table-search-highlight').count()
      }, {
        timeout: 10000,
        message: 'typing into query result search should create visible highlighted matches'
      }).toBeGreaterThan(0)

      await expect(searchBar.locator('.table-search-counter')).not.toHaveText('0/0')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('table preview long cell content should stay ellipsized within fixed column width @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      const overflowMetrics = await page.evaluate(() => {
        const activePane = document.querySelector('.workspace-tab-panels .workspace-active-content')
        const editableCell = activePane?.querySelector('.result-table .editable-cell[data-cell-column-key="payload"]')
        const tableCell = editableCell?.closest('[data-column-key="payload"]')
        const tableCellText = editableCell?.querySelector('.table-cell-text')
        if (!tableCellText || !tableCell) {
          return null
        }
        return {
          cellWidth: tableCell.getBoundingClientRect().width,
          textWidth: tableCellText.getBoundingClientRect().width,
          scrollWidth: (tableCellText as HTMLElement).scrollWidth,
          clientWidth: (tableCellText as HTMLElement).clientWidth
        }
      })

      expect(overflowMetrics).not.toBeNull()
      expect(overflowMetrics.scrollWidth, 'cell text should overflow internally for ellipsis').toBeGreaterThan(overflowMetrics.clientWidth)
      expect(overflowMetrics.textWidth, 'rendered text box should stay within cell width').toBeLessThanOrEqual(overflowMetrics.cellWidth)
    } finally {
      await electronApp.close()
    }
  })

  test('executing sql should show result without hook render crash @smoke', async () => {
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

  test('query result should preserve scroll state after cell selection and workspace switching @smoke', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const scrollMetrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const rect = holder.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          clientHeight: holder.clientHeight,
          scrollHeight: holder.scrollHeight
        }
      })
      expect(scrollMetrics).not.toBeNull()

      const scrollbarX = scrollMetrics.x + scrollMetrics.width - 6
      const scrollbarStartY = scrollMetrics.y + 120
      const scrollbarEndY = scrollMetrics.y + scrollMetrics.height - 80

      await page.mouse.move(scrollbarX, scrollbarStartY)
      await page.mouse.down()
      await page.mouse.move(scrollbarX, scrollbarEndY, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(250)

      const scrolledTop = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(scrolledTop, 'query result vertical scroll should move after dragging the scrollbar').toBeGreaterThan(120)

      await page.mouse.click(scrollMetrics.x + 220, scrollMetrics.y + 180)
      await page.mouse.move(scrollMetrics.x + 220, scrollMetrics.y - 48, { steps: 8 })
      await page.waitForTimeout(200)

      const topAfterLeave = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(topAfterLeave, 'moving the mouse outside the query result should not reset vertical scroll').toBeGreaterThan(120)

      const sampledScrollTops = []
      for (let index = 0; index < 4; index += 1) {
        await page.waitForTimeout(120)
        sampledScrollTops.push(await activeResult.evaluate((node) => {
          const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
          return holder instanceof HTMLElement ? holder.scrollTop : -1
        }))
      }
      const minSampledTop = Math.min(...sampledScrollTops)
      console.log(`[perf][query-result][scroll-after-leave] ${JSON.stringify({ topAfterLeave, sampledScrollTops })}`)
      expect(minSampledTop, 'query result should not continue auto-scrolling upward after the pointer leaves the table').toBeGreaterThan(120)

      const queryTabTitle = await getActiveWorkspaceTabTitle(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      const switchBackMs = await clickWorkspaceTab(page, queryTabTitle)
      console.log(`[perf][query-result][switch-back] ${switchBackMs}`)

      await expect(resultHeader).toBeVisible({ timeout: 30000 })
      await expect.poll(async () => {
        return activeResult.evaluate((node) => node.querySelectorAll('.result-table .ant-table-row, .result-table tbody tr').length)
      }, { timeout: 30000 }).toBeGreaterThan(0)

      const restoredState = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        return {
          scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
          rowCount: node.querySelectorAll('.result-table .ant-table-row, .result-table tbody tr').length
        }
      })
      expect(restoredState.rowCount, 'query result should still render rows after switching away and back').toBeGreaterThan(0)
      expect(restoredState.scrollTop, 'query result should keep a valid vertical scroll offset after switching back').toBeGreaterThan(120)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('query result should not auto scroll upward after dragging vertical scrollbar and moving into header areas @bug', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const metrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder')
        const tableBody = node.querySelector('.result-table-body')
        const header = node.querySelector('.result-table .ant-table-header')
        const toolbar = node.querySelector('.result-status, .table-toolbar')
        if (!(holder instanceof HTMLElement) || !(tableBody instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const tableBodyRect = tableBody.getBoundingClientRect()
        const headerRect = header instanceof HTMLElement ? header.getBoundingClientRect() : null
        const toolbarRect = toolbar instanceof HTMLElement ? toolbar.getBoundingClientRect() : null
        return {
          holder: {
            x: holderRect.x,
            y: holderRect.y,
            width: holderRect.width,
            height: holderRect.height
          },
          tableBody: {
            x: tableBodyRect.x,
            y: tableBodyRect.y,
            width: tableBodyRect.width,
            height: tableBodyRect.height
          },
          header: headerRect ? {
            x: headerRect.x,
            y: headerRect.y,
            width: headerRect.width,
            height: headerRect.height
          } : null,
          toolbar: toolbarRect ? {
            x: toolbarRect.x,
            y: toolbarRect.y,
            width: toolbarRect.width,
            height: toolbarRect.height
          } : null
        }
      })
      expect(metrics).not.toBeNull()

      const scrollbarX = metrics.holder.x + metrics.holder.width - 6
      const scrollbarStartY = metrics.holder.y + 120
      const scrollbarEndY = metrics.holder.y + metrics.holder.height - 80

      await page.mouse.move(scrollbarX, scrollbarStartY)
      await page.mouse.down()
      await page.mouse.move(scrollbarX, scrollbarEndY, { steps: 14 })
      await page.mouse.up()
      await page.waitForTimeout(250)

      const scrolledTop = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder')
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(scrolledTop, 'query result vertical scroll should move after dragging the scrollbar').toBeGreaterThan(120)

      await page.mouse.click(metrics.holder.x + 220, metrics.holder.y + 180)
      await page.waitForTimeout(120)

      const moveTargets = [
        { x: metrics.holder.x + 220, y: metrics.tableBody.y + 8 },
        metrics.header ? { x: metrics.header.x + 240, y: metrics.header.y + 10 } : null,
        metrics.toolbar ? { x: metrics.toolbar.x + 180, y: metrics.toolbar.y + 12 } : null,
        { x: metrics.tableBody.x + 220, y: metrics.tableBody.y - 20 }
      ].filter(Boolean)

      const sampledStates = []
      for (const target of moveTargets) {
        await page.mouse.move(target.x, target.y, { steps: 10 })
        await page.waitForTimeout(140)
        sampledStates.push(await activeResult.evaluate((node) => {
          const holder = node.querySelector('.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder')
          return {
            scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
            activeElement: document.activeElement instanceof HTMLElement ? document.activeElement.className : '',
            nativeSelection: window.getSelection?.()?.toString() ?? ''
          }
        }))
      }

      const minTop = Math.min(...sampledStates.map((item) => item.scrollTop))
      console.log(`[perf][query-result][header-leave-guard] ${JSON.stringify({ scrolledTop, sampledStates })}`)
      expect(minTop, 'moving pointer from selected cell into header or toolbar should not auto scroll upward').toBeGreaterThan(120)
    } finally {
      await electronApp.close()
    }
  })

  test('query result should keep scroll position when releasing vertical scrollbar outside the table @bug', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const metrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        const tableBody = node.querySelector('.result-table-body')
        if (!(holder instanceof HTMLElement) || !(tableBody instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const tableBodyRect = tableBody.getBoundingClientRect()
        return {
          holder: {
            x: holderRect.x,
            y: holderRect.y,
            width: holderRect.width,
            height: holderRect.height
          },
          tableBody: {
            x: tableBodyRect.x,
            y: tableBodyRect.y
          }
        }
      })
      expect(metrics).not.toBeNull()

      const scrollbarX = metrics.holder.x + metrics.holder.width - 6
      const dragStartY = metrics.holder.y + 120
      const dragEndY = metrics.holder.y + metrics.holder.height - 60
      const releasePoint = { x: metrics.tableBody.x + 120, y: metrics.tableBody.y - 36 }

      await page.mouse.move(scrollbarX, dragStartY)
      await page.mouse.down()
      await page.mouse.move(scrollbarX, dragEndY, { steps: 12 })
      await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(220)

      const afterDrag = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(afterDrag, 'releasing the scrollbar outside the table should still leave the result scrolled').toBeGreaterThan(120)

      await page.mouse.click(metrics.holder.x + 220, metrics.holder.y + 180)
      await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 12 })
      await page.waitForTimeout(260)

      const sampledTops = []
      for (let index = 0; index < 5; index += 1) {
        sampledTops.push(await activeResult.evaluate((node) => {
          const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
          return holder instanceof HTMLElement ? holder.scrollTop : -1
        }))
        await page.waitForTimeout(120)
      }

      const minTop = Math.min(...sampledTops)
      console.log(`[perf][query-result][scrollbar-release-outside] ${JSON.stringify({ afterDrag, sampledTops })}`)
      expect(minTop, 'query result should not auto scroll upward after scrollbar drag releases outside the table').toBeGreaterThan(120)
    } finally {
      await electronApp.close()
    }
  })

  test('query result should not auto scroll when moving pointer above table after selecting a cell @bug', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const metrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        const tableBody = node.querySelector('.result-table-body')
        if (!(holder instanceof HTMLElement) || !(tableBody instanceof HTMLElement)) {
          return null
        }
        holder.scrollTop = 380
        holder.dispatchEvent(new Event('scroll', { bubbles: true }))
        const holderRect = holder.getBoundingClientRect()
        const tableBodyRect = tableBody.getBoundingClientRect()
        return {
          holder: {
            x: holderRect.x,
            y: holderRect.y,
            width: holderRect.width,
            height: holderRect.height
          },
          tableBody: {
            x: tableBodyRect.x,
            y: tableBodyRect.y
          },
          scrolledTop: holder.scrollTop
        }
      })
      expect(metrics).not.toBeNull()
      expect(metrics.scrolledTop).toBeGreaterThan(120)
      await page.waitForTimeout(120)

      const visibleCellCenter = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]'))
        const visibleCell = cells.find((cell) => {
          const rect = cell.getBoundingClientRect()
          return rect.width > 8
            && rect.height > 8
            && rect.top >= holderRect.top
            && rect.bottom <= holderRect.bottom
            && rect.left >= holderRect.left
            && rect.right <= holderRect.right
        })
        if (!visibleCell) {
          return null
        }
        const rect = visibleCell.getBoundingClientRect()
        return {
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2),
          cellKey: visibleCell.dataset.cellKey ?? ''
        }
      })
      expect(visibleCellCenter).not.toBeNull()

      await page.mouse.click(visibleCellCenter.x, visibleCellCenter.y)
      await page.waitForTimeout(120)

      const initialSelectedState = await activeResult.evaluate((node) => {
        const selected = node.querySelector('.editable-cell.cell-selected-runtime')
        return {
          selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
          selectedTag: selected?.parentElement?.tagName ?? null,
          scrollTop: (node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body') as HTMLElement | null)?.scrollTop ?? -1
        }
      })
      expect(initialSelectedState.selectedCount).toBeGreaterThan(0)
      expect(initialSelectedState.scrollTop).toBeGreaterThan(120)

      await page.mouse.move(visibleCellCenter.x, metrics.tableBody.y - 30, { steps: 12 })
      await page.waitForTimeout(260)

      const sampledStates = []
      for (let index = 0; index < 5; index += 1) {
        sampledStates.push(await activeResult.evaluate((node) => {
          const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
          return {
            scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
            selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length
          }
        }))
        await page.waitForTimeout(120)
      }

      const minTop = Math.min(...sampledStates.map((item) => item.scrollTop))
      console.log(`[perf][query-result][cell-select-move-above] ${JSON.stringify({ initialSelectedState, sampledStates })}`)
      expect(minTop, 'moving the pointer above the table after selecting a cell should not auto scroll upward').toBeGreaterThan(120)
      expect(Math.min(...sampledStates.map((item) => item.selectedCount)), 'selected cell should remain selected while moving pointer above the table').toBeGreaterThan(0)
    } finally {
      await electronApp.close()
    }
  })

  test('table preview cell selection should support click and drag range selection @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      const selectionTargets = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]'))
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + (rect.width / 2),
              y: rect.y + (rect.height / 2),
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter((cell) => cell.cellKey
            && cell.right <= holderRect.right
            && cell.left >= holderRect.left
            && cell.top >= holderRect.top
            && cell.bottom <= holderRect.bottom)

        const first = cells[0]
        if (!first) {
          return null
        }
        const sameRowNeighbor = cells.find((cell) => cell.rowKey === first.rowKey && cell.columnKey !== first.columnKey)
        return sameRowNeighbor ? { first, sameRowNeighbor } : null
      })

      expect(selectionTargets).not.toBeNull()

      const previewBaselineStyle = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => {
        const firstCell = node.querySelector('.result-table .editable-cell[data-cell-key]')
        if (!(firstCell instanceof HTMLElement)) {
          return null
        }
        const style = window.getComputedStyle(firstCell)
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow
        }
      })
      expect(previewBaselineStyle).not.toBeNull()

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y)
      await page.waitForTimeout(120)

      const singleSelectionState = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => ({
        selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
        selectedStyle: (() => {
          const cell = node.querySelector('.editable-cell.cell-selected-runtime')
          if (!(cell instanceof HTMLElement)) {
            return null
          }
          const style = window.getComputedStyle(cell)
          return {
            backgroundColor: style.backgroundColor,
            boxShadow: style.boxShadow
          }
        })()
      }))
      expect(singleSelectionState.selectedCount, 'single click should select one preview cell').toBeGreaterThan(0)
      expect(singleSelectionState.selectedStyle, 'selected preview cell should expose visible host styles').not.toBeNull()
      expect(singleSelectionState.selectedStyle.backgroundColor, 'selected preview cell should apply a background color immediately').not.toBe(previewBaselineStyle.backgroundColor)
      expect(singleSelectionState.selectedStyle.boxShadow, 'selected preview cell should not use a selection border').toBe(previewBaselineStyle.boxShadow)

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.sameRowNeighbor.x, selectionTargets.sameRowNeighbor.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const dragSelectionState = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => ({
        selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length
      }))
      console.log(`[perf][preview-table][cell-selection] ${JSON.stringify({ singleSelectionState, dragSelectionState })}`)
      expect(dragSelectionState.selectedCount, 'dragging across preview cells should create a range selection').toBeGreaterThan(1)
    } finally {
      await electronApp.close()
    }
  })

  test('query result cell selection should support click and drag range selection @smoke', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()
      await expect(page.locator('.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })
      await expect(page.locator('.workspace-tab-panels .workspace-active-content .result-table .editable-cell[data-cell-key]').first()).toBeVisible({ timeout: 30000 })

      const selectionTargets = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]'))
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + (rect.width / 2),
              y: rect.y + (rect.height / 2),
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter((cell) => cell.cellKey
            && cell.right <= holderRect.right
            && cell.left >= holderRect.left
            && cell.top >= holderRect.top
            && cell.bottom <= holderRect.bottom)

        const first = cells[0]
        if (!first) {
          return null
        }
        const sameRowNeighbor = cells.find((cell) => cell.rowKey === first.rowKey && cell.columnKey !== first.columnKey)
        return sameRowNeighbor ? { first, sameRowNeighbor } : null
      })

      expect(selectionTargets).not.toBeNull()

      const queryBaselineStyle = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => {
        const firstCell = node.querySelector('.result-table td[data-cell-key] .editable-cell, .result-table .ant-table-tbody-virtual-holder [data-cell-key] .editable-cell')
        if (!(firstCell instanceof HTMLElement)) {
          return null
        }
        const style = window.getComputedStyle(firstCell)
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow
        }
      })
      expect(queryBaselineStyle).not.toBeNull()

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y)
      await page.waitForTimeout(120)

      const singleSelectionState = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => ({
        selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
        selectedStyle: (() => {
          const cell = node.querySelector('.editable-cell.cell-selected-runtime')
          if (!(cell instanceof HTMLElement)) {
            return null
          }
          const style = window.getComputedStyle(cell)
          return {
            backgroundColor: style.backgroundColor,
            boxShadow: style.boxShadow
          }
        })()
      }))
      expect(singleSelectionState.selectedCount, 'single click should select one query result cell').toBeGreaterThan(0)
      expect(singleSelectionState.selectedStyle, 'selected query result cell should expose visible host styles').not.toBeNull()
      expect(singleSelectionState.selectedStyle.backgroundColor, 'selected query result cell should apply a background color immediately').not.toBe(queryBaselineStyle.backgroundColor)
      expect(singleSelectionState.selectedStyle.boxShadow, 'selected query result cell should not use a selection border').toBe(queryBaselineStyle.boxShadow)

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.sameRowNeighbor.x, selectionTargets.sameRowNeighbor.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const dragSelectionState = await page.locator('.workspace-tab-panels .workspace-active-content').evaluate((node) => ({
        selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length
      }))
      console.log(`[perf][query-result][cell-selection] ${JSON.stringify({ singleSelectionState, dragSelectionState })}`)
      expect(dragSelectionState.selectedCount, 'dragging across query result cells should create a range selection').toBeGreaterThan(1)
    } finally {
      await electronApp.close()
    }
  })

  test('query result row and column selection should use the same visible selection color as cell selection @bug', async () => {
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
      await page.keyboard.type('select id, category, title, payload, created_at from large_items order by id;')

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()
      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })

      const selectionTargets = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]'))
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + (rect.width / 2),
              y: rect.y + (rect.height / 2),
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter((cell) => cell.cellKey
            && cell.right <= holderRect.right
            && cell.left >= holderRect.left
            && cell.top >= holderRect.top
            && cell.bottom <= holderRect.bottom)

        const first = cells[0]
        if (!first) {
          return null
        }
        const hostCell = node.querySelector(`td[data-cell-key="${CSS.escape(first.cellKey)}"], .ant-table-tbody-virtual-holder [data-cell-key="${CSS.escape(first.cellKey)}"]`)
        const rowElement = hostCell?.closest('tr, .ant-table-row') as HTMLElement | null
        const rowButton = rowElement?.querySelector<HTMLElement>('.row-number-button')
        const columnButton = node.querySelector<HTMLElement>(`.result-table .ant-table-thead [data-column-button="${CSS.escape(first.columnKey)}"]`)
        const rowButtonRect = rowButton?.getBoundingClientRect()
        const columnButtonRect = columnButton?.getBoundingClientRect()
        return {
          ...first,
          rowButtonCenter: rowButtonRect
            ? { x: rowButtonRect.x + (rowButtonRect.width / 2), y: rowButtonRect.y + (rowButtonRect.height / 2) }
            : null,
          columnButtonCenter: columnButtonRect
            ? { x: columnButtonRect.x + (columnButtonRect.width / 2), y: columnButtonRect.y + (columnButtonRect.height / 2) }
            : null
        }
      })
      expect(selectionTargets).not.toBeNull()
      expect(selectionTargets.rowButtonCenter).not.toBeNull()
      expect(selectionTargets.columnButtonCenter).not.toBeNull()

      await page.mouse.click(selectionTargets.x, selectionTargets.y)
      await page.waitForTimeout(120)

      const readStyle = async (selector, options = {}) => activeResult.evaluate((node, payload) => {
        const elements = Array.from(node.querySelectorAll(payload.selector))
        const element = elements.find((candidate) => {
          if (!(candidate instanceof HTMLElement)) {
            return false
          }
          const rect = candidate.getBoundingClientRect()
          if (!payload.visibleOnly) {
            return true
          }
          return rect.width > 0 && rect.height > 0
        })
        if (!(element instanceof HTMLElement)) {
          return null
        }
        const style = window.getComputedStyle(element)
        const normalizeColor = (color: string): string => {
          const canvas = document.createElement('canvas')
          canvas.width = 1
          canvas.height = 1
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (!ctx) {
            return color
          }
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
          return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (a / 255).toFixed(4) + ')'
        }
        return {
          backgroundColor: normalizeColor(style.backgroundColor),
          boxShadow: style.boxShadow
        }
      }, { selector, visibleOnly: options.visibleOnly ?? false })

      const baseline = await readStyle(`.editable-cell[data-cell-key="${selectionTargets.cellKey}"]`)
      expect(baseline).not.toBeNull()

      await page.mouse.click(selectionTargets.rowButtonCenter.x, selectionTargets.rowButtonCenter.y)
      await page.waitForTimeout(120)

      const rowStyle = await readStyle(`.editable-cell[data-cell-key="${selectionTargets.cellKey}"]`)
      const rowNumberCellStyle = await activeResult.evaluate((node, rowKey) => {
        const selectedButton = Array.from(node.querySelectorAll<HTMLElement>(`.ant-table-row[data-row-key="${CSS.escape(rowKey)}"] .row-number-button.selected, tr[data-row-key="${CSS.escape(rowKey)}"] .row-number-button.selected`))
          .find((candidate) => {
            const rect = candidate.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
        const element = selectedButton?.closest<HTMLElement>('.row-number-cell')
        if (!(element instanceof HTMLElement)) {
          return null
        }
        const style = window.getComputedStyle(element)
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          return {
            backgroundColor: style.backgroundColor,
            boxShadow: style.boxShadow
          }
        }
        ctx.fillStyle = style.backgroundColor
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return {
          backgroundColor: 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (a / 255).toFixed(4) + ')',
          boxShadow: style.boxShadow
        }
      }, selectionTargets.rowKey)

      await page.mouse.click(selectionTargets.columnButtonCenter.x, selectionTargets.columnButtonCenter.y)
      await page.waitForTimeout(120)

      const columnStyle = await readStyle(`.editable-cell[data-cell-key="${selectionTargets.cellKey}"]`)

      expect(rowStyle).not.toBeNull()
      expect(rowNumberCellStyle).not.toBeNull()
      expect(columnStyle).not.toBeNull()
      const parseColor = (value) => {
        const match = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+),? ?([\d.]*)\)/.exec(value ?? '')
        if (!match) {
          return null
        }
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] ? Number(match[4]) : 1
        }
      }
      const colorDistance = (left, right) => {
        const leftColor = parseColor(left)
        const rightColor = parseColor(right)
        if (!leftColor || !rightColor) {
          return Number.POSITIVE_INFINITY
        }
        return Math.max(
          Math.abs(leftColor.r - rightColor.r),
          Math.abs(leftColor.g - rightColor.g),
          Math.abs(leftColor.b - rightColor.b),
          Math.abs(leftColor.a - rightColor.a)
        )
      }

      expect(colorDistance(rowStyle.backgroundColor, baseline.backgroundColor), 'row selection should render the same visible selection color as cell selection').toBeLessThanOrEqual(1)
      expect(colorDistance(columnStyle.backgroundColor, baseline.backgroundColor), 'column selection should render the same visible selection color as cell selection').toBeLessThanOrEqual(1)
      expect(colorDistance(rowNumberCellStyle.backgroundColor, baseline.backgroundColor), 'row number cell should use the same selected background').toBeLessThanOrEqual(1)
    } finally {
      await electronApp.close()
    }
  })

  test('table preview column resize should keep header and body widths in sync while shrinking @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)
      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })

      const resizeTarget = await activeResult.evaluate((node) => {
        const handle = node.querySelector<HTMLElement>('.result-table .ant-table-thead [data-column-button="category"] + .column-sort-button + .column-filter-button + .column-resize-handle, .result-table .ant-table-thead [data-column-button="category"] ~ .column-resize-handle')
          ?? node.querySelector<HTMLElement>('.result-table .ant-table-thead .column-resize-handle')
        const headerButton = node.querySelector<HTMLElement>('.result-table .ant-table-thead [data-column-button="category"]')
        const headerCell = headerButton?.closest('th') as HTMLElement | null
        const bodyCell = node.querySelector<HTMLElement>('.result-table .ant-table-body [data-column-key="category"], .result-table .ant-table-tbody-virtual-holder [data-column-key="category"]')
        if (!(handle instanceof HTMLElement) || !(headerCell instanceof HTMLElement) || !(bodyCell instanceof HTMLElement)) {
          return null
        }
        const handleRect = handle.getBoundingClientRect()
        return {
          pointerId: 9,
          startX: handleRect.x + (handleRect.width / 2),
          startY: handleRect.y + (handleRect.height / 2),
          initialHeaderWidth: headerCell.getBoundingClientRect().width,
          initialBodyWidth: bodyCell.getBoundingClientRect().width
        }
      })
      expect(resizeTarget).not.toBeNull()

      const shrinkDistance = Math.min(80, Math.max(30, Math.floor(resizeTarget.initialHeaderWidth * 0.45)))

      const midResize = await activeResult.evaluate(async (node, target) => {
        const handle = node.querySelector<HTMLElement>('.result-table .ant-table-thead [data-column-button="category"] + .column-sort-button + .column-filter-button + .column-resize-handle, .result-table .ant-table-thead [data-column-button="category"] ~ .column-resize-handle')
          ?? node.querySelector<HTMLElement>('.result-table .ant-table-thead .column-resize-handle')
        const headerButton = node.querySelector<HTMLElement>('.result-table .ant-table-thead [data-column-button="category"]')
        const bodyCell = node.querySelector<HTMLElement>('.result-table .ant-table-body [data-column-key="category"], .result-table .ant-table-tbody-virtual-holder [data-column-key="category"]')
        if (!(handle instanceof HTMLElement) || !(headerButton instanceof HTMLElement) || !(bodyCell instanceof HTMLElement)) {
          return null
        }
        handle.dispatchEvent(new PointerEvent('pointerdown', {
          pointerId: target.pointerId,
          button: 0,
          buttons: 1,
          clientX: target.startX,
          clientY: target.startY,
          bubbles: true
        }))
        window.dispatchEvent(new PointerEvent('pointermove', {
          pointerId: target.pointerId,
          button: 0,
          buttons: 1,
          clientX: target.startX - target.shrinkDistance,
          clientY: target.startY,
          bubbles: true
        }))
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        return {
          headerWidth: (headerButton.closest('th') as HTMLElement).getBoundingClientRect().width,
          bodyWidth: bodyCell.getBoundingClientRect().width
        }
      }, { ...resizeTarget, shrinkDistance })

      expect(midResize).not.toBeNull()
      expect(midResize.headerWidth, 'header width should not grow while dragging').toBeLessThanOrEqual(resizeTarget.initialHeaderWidth)
      expect(midResize.bodyWidth, 'body width should not grow while dragging').toBeLessThanOrEqual(resizeTarget.initialBodyWidth)
      expect(Math.abs(midResize.headerWidth - midResize.bodyWidth), 'header and body width should stay aligned while dragging').toBeLessThan(4)

      const finalResize = await activeResult.evaluate(async (node, target) => {
        window.dispatchEvent(new PointerEvent('pointerup', {
          pointerId: target.pointerId,
          button: 0,
          buttons: 0,
          clientX: target.startX - target.shrinkDistance,
          clientY: target.startY,
          bubbles: true
        }))
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        const headerButton = node.querySelector<HTMLElement>('.result-table .ant-table-thead [data-column-button="category"]')
        const bodyCell = node.querySelector<HTMLElement>('.result-table .ant-table-body [data-column-key="category"], .result-table .ant-table-tbody-virtual-holder [data-column-key="category"]')
        if (!(headerButton instanceof HTMLElement) || !(bodyCell instanceof HTMLElement)) {
          return null
        }
        return {
          headerWidth: (headerButton.closest('th') as HTMLElement).getBoundingClientRect().width,
          bodyWidth: bodyCell.getBoundingClientRect().width
        }
      }, { ...resizeTarget, shrinkDistance })

      expect(finalResize).not.toBeNull()
      expect(Math.abs(finalResize.headerWidth - finalResize.bodyWidth), 'header and body width should remain aligned after releasing the resize handle').toBeLessThan(4)
    } finally {
      await electronApp.close()
    }
  })

  test('major modals should open and close quickly @smoke', async () => {
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
      expect(historyMetrics.openMs, 'history modal opens too slowly').toBeLessThan(1000)
      expect(historyMetrics.closeMs, 'history modal closes too slowly').toBeLessThan(850)

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
      expect(importMetrics.closeMs, 'import connection modal closes too slowly').toBeLessThan(900)

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

  test('connection editor should open directly with the selected database form without flashing sqlite fields @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const createButton = page.locator('.resource-header .resource-add')
      await createButton.click()
      await page.evaluate(() => {
        ;(window as typeof window & { __connectionModalFrameSamples__?: Array<{ hasSqlitePath: boolean; hasHost: boolean; text: string; visible: boolean }> }).__connectionModalFrameSamples__ = []
      })

      const captureFrames = page.evaluate(async () => {
        const frameSamples = (window as typeof window & { __connectionModalFrameSamples__?: Array<{ hasSqlitePath: boolean; hasHost: boolean; text: string; visible: boolean }> }).__connectionModalFrameSamples__ ?? []
        const record = () => {
          const modalElement = document.querySelector('.connection-editor-modal')
          const text = modalElement?.textContent ?? ''
          frameSamples.push({
            hasSqlitePath: text.includes('SQLite 文件路径'),
            hasHost: text.includes('主机'),
            text,
            visible: modalElement instanceof HTMLElement && modalElement.offsetParent !== null
          })
        }

        record()
        for (let index = 0; index < 48; index += 1) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
          record()
        }

        return {
          sawSqlitePath: frameSamples.some((sample) => sample.visible && sample.hasSqlitePath),
          sawHost: frameSamples.some((sample) => sample.visible && sample.hasHost),
          firstVisibleSample: frameSamples.find((sample) => sample.visible) ?? null,
          samples: frameSamples
        }
      })

      await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'MySQL' }).click()

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByLabel('主机')).toBeVisible({ timeout: 10000 })

      const frameSamples = await captureFrames

      expect(frameSamples.firstVisibleSample?.hasHost ?? false, `the first visible frame should already show the selected database form: ${JSON.stringify(frameSamples.samples)}`).toBe(true)
      expect(frameSamples.sawSqlitePath, `opening MySQL connection editor should not flash SQLite fields: ${JSON.stringify(frameSamples.samples)}`).toBe(false)

      await page.locator('.connection-editor-modal .ant-modal-close').click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })
    } finally {
      await electronApp.close()
    }
  })

  test('connection create menu and modal should open within a tight front-end budget @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const sqliteMetrics = await measureConnectionCreateFlow(page, 'SQLite')
      expect(sqliteMetrics.menuOpenMs, 'create menu should open within the agreed front-end budget on first click').toBeLessThan(300)
      expect(sqliteMetrics.modalOpenMs, 'opening the SQLite connection editor should stay within a pure front-end budget').toBeLessThan(300)

      const mysqlMetrics = await measureConnectionCreateFlow(page, 'MySQL')
      expect(mysqlMetrics.menuOpenMs, 'create menu should stay within the agreed front-end budget on repeat opens').toBeLessThan(300)
      expect(mysqlMetrics.modalOpenMs, 'opening the MySQL connection editor should stay within a pure front-end budget').toBeLessThan(300)
    } finally {
      await electronApp.close()
    }
  })

  test('resource sidebar header should stay single-line and keep primary actions readable at minimum width @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await resizeResourcePanel(page, 304)
      await waitForBrowserIdle(page)

      const headerLayout = await page.locator('.resource-header').evaluate((node) => {
        const kicker = node.querySelector('.panel-kicker')
        const title = node.querySelector('.panel-title')
        const importButton = node.querySelector('.resource-import')
        const addButton = node.querySelector('.resource-add')
        if (!(kicker instanceof HTMLElement) || !(title instanceof HTMLElement) || !(importButton instanceof HTMLElement) || !(addButton instanceof HTMLElement)) {
          return null
        }

        const headerStyle = window.getComputedStyle(node)
        const kickerRect = kicker.getBoundingClientRect()
        const titleRect = title.getBoundingClientRect()
        const importRect = importButton.getBoundingClientRect()
        const addRect = addButton.getBoundingClientRect()

        return {
          flexDirection: headerStyle.flexDirection,
          headerClientWidth: node.clientWidth,
          headerScrollWidth: node.scrollWidth,
          headerHeight: node.getBoundingClientRect().height,
          kickerDisplay: window.getComputedStyle(kicker).display,
          titleMid: titleRect.top + (titleRect.height / 2),
          importMid: importRect.top + (importRect.height / 2),
          titleWidth: titleRect.width,
          titleHeight: titleRect.height,
          importWidth: importRect.width,
          addWidth: addRect.width,
        }
      })

      expect(headerLayout, 'resource header layout metrics should be readable').not.toBeNull()
      if (!headerLayout) {
        return
      }

      expect(headerLayout.flexDirection, 'resource header should keep a single-row layout at minimum width').toBe('row')
      expect(headerLayout.headerScrollWidth, 'resource header should not overflow horizontally at minimum width').toBeLessThanOrEqual(headerLayout.headerClientWidth + 1)
      expect(headerLayout.titleWidth, '数据资产标题 should stay horizontal instead of collapsing vertically').toBeGreaterThan(headerLayout.titleHeight * 2)
      expect(headerLayout.headerHeight, 'resource header should stay compact instead of stacking into multiple rows').toBeLessThan(76)
      expect(headerLayout.kickerDisplay, 'DATABASE EXPLORER label should hide before it collides with the buttons').toBe('none')
      expect(Math.abs(headerLayout.titleMid - headerLayout.importMid), 'title and actions should remain visually centered on a single row').toBeLessThanOrEqual(3)
      expect(headerLayout.importWidth, '导入连接按钮 should stay wide enough to render normally').toBeGreaterThan(92)
      expect(headerLayout.addWidth, '新建按钮 should stay wide enough to render normally').toBeGreaterThan(64)
    } finally {
      await electronApp.close()
    }
  })

  test('resource sidebar header should avoid button overlap at medium narrow width @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await resizeResourcePanel(page, 312)
      await waitForBrowserIdle(page)

      const headerLayout = await page.locator('.resource-header').evaluate((node) => {
        const kicker = node.querySelector('.panel-kicker')
        const title = node.querySelector('.panel-title')
        const importButton = node.querySelector('.resource-import')
        const addButton = node.querySelector('.resource-add')
        if (!(kicker instanceof HTMLElement) || !(title instanceof HTMLElement) || !(importButton instanceof HTMLElement) || !(addButton instanceof HTMLElement)) {
          return null
        }

        const headerStyle = window.getComputedStyle(node)
        const kickerRect = kicker.getBoundingClientRect()
        const titleRect = title.getBoundingClientRect()
        const importRect = importButton.getBoundingClientRect()
        const addRect = addButton.getBoundingClientRect()

        return {
          flexDirection: headerStyle.flexDirection,
          kickerDisplay: window.getComputedStyle(kicker).display,
          kickerWidth: kickerRect.width,
          titleMid: titleRect.top + (titleRect.height / 2),
          importMid: importRect.top + (importRect.height / 2),
          importTop: importRect.top,
          importRight: importRect.right,
          headerRight: node.getBoundingClientRect().right,
          addTop: addRect.top,
          importWidth: importRect.width,
          addWidth: addRect.width
        }
      })

      expect(headerLayout, 'resource header layout metrics should be readable at medium narrow width').not.toBeNull()
      if (!headerLayout) {
        return
      }

      expect(headerLayout.flexDirection, 'resource header should stay on one row at medium narrow width').toBe('row')
      expect(headerLayout.kickerDisplay, 'DATABASE EXPLORER label should stay hidden while the sidebar is still too narrow for both title and actions').toBe('none')
      expect(headerLayout.kickerWidth, 'hidden english label should not keep occupying horizontal space').toBeLessThanOrEqual(1)
      expect(Math.abs(headerLayout.titleMid - headerLayout.importMid), 'title and action row should stay visually centered').toBeLessThanOrEqual(3)
      expect(headerLayout.importRight, 'buttons should stay within the header bounds at medium narrow width').toBeLessThanOrEqual(headerLayout.headerRight + 1)
      expect(headerLayout.importWidth, '导入连接按钮 should keep a readable width at medium narrow width').toBeGreaterThan(92)
      expect(headerLayout.addWidth, '新建按钮 should keep a readable width at medium narrow width').toBeGreaterThan(64)
      expect(Math.abs(headerLayout.importTop - headerLayout.addTop), 'buttons should stay aligned on the same row').toBeLessThanOrEqual(2)
    } finally {
      await electronApp.close()
    }
  })

  test('resource sidebar header should reveal the english label again when width is sufficient @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await resizeResourcePanel(page, 340)
      await waitForBrowserIdle(page)

      const headerLayout = await page.locator('.resource-header').evaluate((node) => {
        const kicker = node.querySelector('.panel-kicker')
        const title = node.querySelector('.panel-title')
        if (!(kicker instanceof HTMLElement) || !(title instanceof HTMLElement)) {
          return null
        }

        return {
          kickerDisplay: window.getComputedStyle(kicker).display,
          kickerWidth: kicker.getBoundingClientRect().width,
          titleTop: title.getBoundingClientRect().top,
          kickerTop: kicker.getBoundingClientRect().top,
        }
      })

      expect(headerLayout, 'resource header english label metrics should be readable at roomy width').not.toBeNull()
      if (!headerLayout) {
        return
      }

      expect(headerLayout.kickerDisplay, 'DATABASE EXPLORER label should be visible again once the panel is wide enough').not.toBe('none')
      expect(headerLayout.kickerWidth, 'visible english label should occupy real width').toBeGreaterThan(40)
      expect(headerLayout.kickerTop, 'english label should remain above the chinese title inside the copy block').toBeLessThanOrEqual(headerLayout.titleTop)
    } finally {
      await electronApp.close()
    }
  })

  test('editing a connection should hydrate ssh tunnel fields back into the form @bug', async () => {
    const electronApp = await launchRegressionApp()
    const connectionName = `SSH 编辑回显 ${crypto.randomUUID().slice(0, 8)}`

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'MySQL' }).click()

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByLabel(/^连接名称$/).fill(connectionName)
      await modal.getByLabel(/^主机$/).fill('192.168.108.10')
      await modal.getByLabel(/^端口$/).fill('3306')
      await modal.getByLabel(/^用户名$/).fill('root')
      await modal.getByLabel(/^密码$/).fill('db-secret')

      await modal.getByRole('switch').click()
      await modal.getByLabel('SSH 主机').fill('192.168.108.1')
      await modal.getByLabel('SSH 端口').fill('22')
      await modal.getByLabel('SSH 用户名').fill('jump-user')
      await modal.getByLabel('SSH 密码').fill('ssh-secret')

      await modal.getByRole('button', { name: '保存连接' }).click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })

      const connectionNode = page.locator('.resource-tree-node-title').filter({ hasText: connectionName })
      await expect(connectionNode).toBeVisible({ timeout: 10000 })
      await connectionNode.click()

      const connectionTreeItem = page.getByRole('treeitem').filter({ hasText: connectionName })
      const editButton = connectionTreeItem.getByRole('button', { name: 'edit' })
      await expect(editButton).toBeVisible({ timeout: 10000 })
      await editButton.click()

      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      await expect(modal.getByLabel(/^SSH 主机$/)).toHaveValue('192.168.108.1')
      await expect(modal.getByLabel(/^SSH 端口$/)).toHaveValue('22')
      await expect(modal.getByLabel(/^SSH 用户名$/)).toHaveValue('jump-user')
      await expect(modal.locator('.connection-editor-side')).toContainText('密码认证')
      await expect(modal.getByLabel(/^SSH 密码$/)).toHaveValue('ssh-secret')
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(async (targetName) => {
          try {
            const response = await window.api.requestJson('/connections')
            const target = Array.isArray(response?.connections)
              ? response.connections.find((item) => item?.name === targetName)
              : null
            if (target?.connection_id) {
              await window.api.requestJson(`/connections/${target.connection_id}`, { method: 'DELETE' })
            }
          } catch {
            // Ignore cleanup failures in regression teardown.
          }
        }, connectionName)
      }
      await electronApp.close()
    }
  })

  test('editing a connection repeatedly should keep the form hydrated across reopen @bug', async () => {
    const electronApp = await launchRegressionApp()
    const connectionName = `SSH 重复打开回显 ${crypto.randomUUID().slice(0, 8)}`

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'MySQL' }).click()

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByLabel(/^连接名称$/).fill(connectionName)
      await modal.getByLabel(/^主机$/).fill('192.168.108.10')
      await modal.getByLabel(/^端口$/).fill('3306')
      await modal.getByLabel(/^用户名$/).fill('root')
      await modal.getByLabel(/^密码$/).fill('db-secret')

      await modal.getByRole('switch').click()
      await modal.getByLabel('SSH 主机').fill('192.168.108.1')
      await modal.getByLabel('SSH 端口').fill('22')
      await modal.getByLabel('SSH 用户名').fill('jump-user')
      await modal.getByLabel('SSH 密码').fill('ssh-secret')

      await modal.getByRole('button', { name: '保存连接' }).click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })

      const connectionTreeItem = page.getByRole('treeitem').filter({ hasText: connectionName })
      await expect(connectionTreeItem).toBeVisible({ timeout: 10000 })
      await connectionTreeItem.click()
      const editButton = connectionTreeItem.getByRole('button', { name: 'edit' })
      await expect(editButton).toBeVisible({ timeout: 10000 })

      await editButton.click()
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByLabel(/^连接名称$/)).toHaveValue(connectionName)
      await expect(modal.getByLabel(/^主机$/)).toHaveValue('192.168.108.10')
      await expect(modal.getByLabel(/^端口$/)).toHaveValue('3306')
      await expect(modal.getByLabel(/^用户名$/)).toHaveValue('root')
      await expect(modal.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      await expect(modal.getByLabel(/^SSH 主机$/)).toHaveValue('192.168.108.1')
      await expect(modal.getByLabel(/^SSH 端口$/)).toHaveValue('22')
      await expect(modal.getByLabel(/^SSH 用户名$/)).toHaveValue('jump-user')
      await expect(modal.getByLabel(/^SSH 密码$/)).toHaveValue('ssh-secret')

      await page.locator('.connection-editor-modal .ant-modal-close').click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })

      await editButton.click()
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByLabel(/^连接名称$/)).toHaveValue(connectionName)
      await expect(modal.getByLabel(/^主机$/)).toHaveValue('192.168.108.10')
      await expect(modal.getByLabel(/^端口$/)).toHaveValue('3306')
      await expect(modal.getByLabel(/^用户名$/)).toHaveValue('root')
      await expect(modal.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      await expect(modal.getByLabel(/^SSH 主机$/)).toHaveValue('192.168.108.1')
      await expect(modal.getByLabel(/^SSH 端口$/)).toHaveValue('22')
      await expect(modal.getByLabel(/^SSH 用户名$/)).toHaveValue('jump-user')
      await expect(modal.getByLabel(/^SSH 密码$/)).toHaveValue('ssh-secret')
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(async (targetName) => {
          try {
            const response = await window.api.requestJson('/connections')
            const target = Array.isArray(response?.connections)
              ? response.connections.find((item) => item?.name === targetName)
              : null
            if (target?.connection_id) {
              await window.api.requestJson(`/connections/${target.connection_id}`, { method: 'DELETE' })
            }
          } catch {
            // Ignore cleanup failures in regression teardown.
          }
        }, connectionName)
      }
      await electronApp.close()
    }
  })

  test('editing a connection should preserve private key ssh settings @bug', async () => {
    const electronApp = await launchRegressionApp()
    const connectionName = `SSH 私钥回显 ${crypto.randomUUID().slice(0, 8)}`
    const privateKeyPath = 'C:\\Users\\vhukze\\.ssh\\id_rsa'

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'MySQL' }).click()

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByLabel(/^连接名称$/).fill(connectionName)
      await modal.getByLabel(/^主机$/).fill('192.168.108.10')
      await modal.getByLabel(/^端口$/).fill('3306')
      await modal.getByLabel(/^用户名$/).fill('root')
      await modal.getByLabel(/^密码$/).fill('db-secret')

      await modal.getByRole('switch').click()
      await modal.getByLabel('SSH 主机').fill('192.168.108.1')
      await modal.getByLabel('SSH 端口').fill('22')
      await modal.getByLabel('SSH 用户名').fill('jump-user')
      await modal.locator('.connection-editor-side .ant-select').click()
      await page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: '私钥文件' }).click()
      await modal.getByLabel('私钥路径').fill(privateKeyPath)
      await modal.getByLabel('私钥口令').fill('phrase-1')

      await modal.getByRole('button', { name: '保存连接' }).click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })

      const connectionTreeItem = page.getByRole('treeitem').filter({ hasText: connectionName })
      await expect(connectionTreeItem).toBeVisible({ timeout: 10000 })
      await connectionTreeItem.click()
      const editButton = connectionTreeItem.getByRole('button', { name: 'edit' })
      await expect(editButton).toBeVisible({ timeout: 10000 })
      await editButton.click()

      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      await expect(modal.locator('.connection-editor-side')).toContainText('私钥文件')
      await expect(modal.getByLabel(/^SSH 主机$/)).toHaveValue('192.168.108.1')
      await expect(modal.getByLabel(/^SSH 端口$/)).toHaveValue('22')
      await expect(modal.getByLabel(/^SSH 用户名$/)).toHaveValue('jump-user')
      await expect(modal.getByLabel('私钥路径')).toHaveValue(privateKeyPath)
      await expect(modal.getByLabel('私钥口令')).toHaveValue('phrase-1')
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(async (targetName) => {
          try {
            const response = await window.api.requestJson('/connections')
            const target = Array.isArray(response?.connections)
              ? response.connections.find((item) => item?.name === targetName)
              : null
            if (target?.connection_id) {
              await window.api.requestJson(`/connections/${target.connection_id}`, { method: 'DELETE' })
            }
          } catch {
            // Ignore cleanup failures in regression teardown.
          }
        }, connectionName)
      }
      await electronApp.close()
    }
  })

  test('editing a connection without ssh enabled should keep ssh disabled and default auth type ready @bug', async () => {
    const electronApp = await launchRegressionApp()
    const connectionName = `SSH 默认值 ${crypto.randomUUID().slice(0, 8)}`

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'MySQL' }).click()

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByLabel(/^连接名称$/).fill(connectionName)
      await modal.getByLabel(/^主机$/).fill('192.168.108.10')
      await modal.getByLabel(/^端口$/).fill('3306')
      await modal.getByLabel(/^用户名$/).fill('root')
      await modal.getByLabel(/^密码$/).fill('db-secret')

      await modal.getByRole('button', { name: '保存连接' }).click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })

      const connectionTreeItem = page.getByRole('treeitem').filter({ hasText: connectionName })
      await expect(connectionTreeItem).toBeVisible({ timeout: 10000 })
      await connectionTreeItem.click()
      const editButton = connectionTreeItem.getByRole('button', { name: 'edit' })
      await expect(editButton).toBeVisible({ timeout: 10000 })
      await editButton.click()

      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
      await modal.getByRole('switch').click()
      await expect(modal.locator('.connection-editor-side')).toContainText('密码认证')
      await expect(modal.getByLabel(/^SSH 端口$/)).toHaveValue('22')
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(async (targetName) => {
          try {
            const response = await window.api.requestJson('/connections')
            const target = Array.isArray(response?.connections)
              ? response.connections.find((item) => item?.name === targetName)
              : null
            if (target?.connection_id) {
              await window.api.requestJson(`/connections/${target.connection_id}`, { method: 'DELETE' })
            }
          } catch {
            // Ignore cleanup failures in regression teardown.
          }
        }, connectionName)
      }
      await electronApp.close()
    }
  })

  test('connection editor should expose ssh tunnel settings in the split layout', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await page.locator('.resource-create-dropdown .ant-dropdown-menu-item').filter({ hasText: 'MySQL' }).click()

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.locator('.connection-editor-layout')).toBeVisible()
      await expect(modal.locator('.connection-editor-main')).toBeVisible()
      await expect(modal.locator('.connection-editor-side-card')).toBeVisible()
      await expect(modal.getByRole('heading', { name: 'SSH 隧道' })).toBeVisible()

      const cardItemBackgrounds = await modal.evaluate((node) => {
        const sampleSelectors = [
          '.connection-editor-main .ant-form-item',
          '.connection-editor-main .ant-form-item-row',
          '.connection-editor-side-card .ant-form-item',
          '.connection-editor-side-card .ant-form-item-row',
        ]
        return sampleSelectors.map((selector) => {
          const element = node.querySelector(selector)
          if (!(element instanceof HTMLElement)) {
            return null
          }
          const style = window.getComputedStyle(element)
          return {
            selector,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage
          }
        })
      })
      expect(cardItemBackgrounds.every((item) => item && item.backgroundColor === 'rgba(0, 0, 0, 0)'), `connection editor form item backgrounds should stay transparent: ${JSON.stringify(cardItemBackgrounds)}`).toBe(true)

      await modal.getByRole('switch').click()
      const sshHostInput = modal.getByLabel('SSH 主机')
      await expect(sshHostInput).toBeVisible()
      await expect.poll(async () => sshHostInput.getAttribute('placeholder')).toBeNull()
      await expect(modal.getByPlaceholder('请输入 SSH 用户名')).toBeVisible()
      await expect(modal.getByPlaceholder('请输入 SSH 登录密码')).toBeVisible()
      await expect(modal.getByRole('button', { name: '测试 SSH' })).toBeVisible()
      await expect(modal.locator('.connection-editor-side')).toContainText('密码认证')

      await modal.locator('.connection-editor-side .ant-select').click()
      await page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: '私钥文件' }).click()
      await expect(modal.getByPlaceholder('例如：C:\\Users\\你的用户名\\.ssh\\id_rsa')).toBeVisible()
      await expect(modal.getByPlaceholder('请输入 SSH 登录密码')).toHaveCount(0)

      await modal.locator('.connection-editor-side .ant-select').click()
      await page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: '密码认证' }).click()
      await expect(modal.getByPlaceholder('请输入 SSH 登录密码')).toBeVisible()
      await sshHostInput.fill('jump.example.com')
      await modal.getByPlaceholder('请输入 SSH 用户名').fill('ubuntu')
      await modal.getByPlaceholder('请输入 SSH 登录密码').fill('ssh-secret')
      await modal.getByRole('button', { name: '测试 SSH' }).click()
      const sshFailureDialog = page.getByRole('dialog', { name: '操作失败' })
      await expect(sshFailureDialog).toBeVisible()
      await expect(sshFailureDialog.locator('textarea')).not.toHaveValue('')
      await sshFailureDialog.getByRole('button', { name: '确 认' }).click()
      await expect(sshFailureDialog).not.toBeVisible()

      await page.locator('.connection-editor-modal .ant-modal-close').click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })
    } finally {
      await electronApp.close()
    }
  })

  test('row selection background should match cell selection background @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content .result-table')

      const readBg = async (selector) => activeResult.evaluate((node, sel) => {
        const el = node.querySelector(sel)
        if (!(el instanceof HTMLElement)) return null
        const style = window.getComputedStyle(el)
        const canvas = document.createElement('canvas')
        canvas.width = 1; canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return style.backgroundColor
        ctx.fillStyle = style.backgroundColor
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (a / 255).toFixed(3) + ')'
      }, selector)

      const firstCellInfo = await activeResult.evaluate((node) => {
        const cell = node.querySelector('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) return null
        const rowBtn = node.querySelector('.row-number-button[data-row-key]')
        return {
          cellKey: cell.dataset.cellKey,
          rowKey: rowBtn instanceof HTMLElement ? rowBtn.dataset.rowKey : null
        }
      })
      if (!firstCellInfo || !firstCellInfo.rowKey) { return }

      // First click the cell to get cell selection color
      const cellEl = activeResult.locator('.editable-cell[data-cell-key="' + firstCellInfo.cellKey + '"]')
      await cellEl.first().click()
      await page.waitForTimeout(120)

      const cellBg = await readBg('.editable-cell[data-cell-key="' + firstCellInfo.cellKey + '"]')
      expect(cellBg).not.toBeNull()

      // Then click row button to switch to row selection and compare
      const rowBtn = activeResult.locator('.row-number-button[data-row-key="' + firstCellInfo.rowKey + '"]')
      await rowBtn.first().click()
      await page.waitForTimeout(120)

      const rowCellBg = await readBg('td[data-row-key="' + firstCellInfo.rowKey + '"]')
      expect(rowCellBg).not.toBeNull()
      expect(rowCellBg, 'row selection color should match cell selection color').toBe(cellBg)
    } finally {
      await electronApp.close()
    }
  })

  test('column selection should keep background on hover @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await doubleClickTreeNode(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      await page.locator('.workspace-active-content [data-column-button="category"]').click()
      await page.waitForTimeout(200)

      const info = await page.evaluate(() => {
        const readBg = (color) => {
          const c = document.createElement('canvas')
          c.width = 1; c.height = 1
          const ctx = c.getContext('2d', { willReadFrequently: true })
          if (!ctx) return color
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')'
        }
        const host = document.querySelector('.workspace-active-content [data-column-key="category"].column-selected-runtime')
        const cell = document.querySelector('.workspace-active-content .editable-cell[data-cell-column-key="category"]')
        if (!(host instanceof HTMLElement) || !(cell instanceof HTMLElement)) return null
        const tdStyle = window.getComputedStyle(host)
        const cellStyle = window.getComputedStyle(cell)
        return {
          cellKey: cell.dataset.cellKey,
          tdBg: readBg(tdStyle.backgroundColor),
          cellBg: readBg(cellStyle.backgroundColor)
        }
      })
      expect(info).not.toBeNull()
      console.log('[perf][column-hover] before:', JSON.stringify(info))

      await page.locator('.editable-cell[data-cell-key="' + info.cellKey + '"]').first().hover()
      await page.waitForTimeout(400)

      const afterInfo = await page.evaluate(() => {
        const readBg = (color) => {
          const c = document.createElement('canvas')
          c.width = 1; c.height = 1
          const ctx = c.getContext('2d', { willReadFrequently: true })
          if (!ctx) return color
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')'
        }
        const host = document.querySelector('.workspace-active-content [data-column-key="category"].column-selected-runtime')
        const cell = document.querySelector('.workspace-active-content .editable-cell[data-cell-column-key="category"]')
        if (!(host instanceof HTMLElement) || !(cell instanceof HTMLElement)) return null
        const tdStyle = window.getComputedStyle(host)
        const cellStyle = window.getComputedStyle(cell)
        return {
          tdBg: readBg(tdStyle.backgroundColor),
          cellBg: readBg(cellStyle.backgroundColor)
        }
      })
      expect(afterInfo).not.toBeNull()
      console.log('[perf][column-hover] after:', JSON.stringify(afterInfo))

      expect(afterInfo.cellBg, 'cell background should not change on hover').toBe(info.cellBg)
    } finally {
      await electronApp.close()
    }
  })

  test('drag selection should keep the same light background across adjacent rows @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const dragTargets = await activeResult.evaluate((node) => {
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]'))
        const first = cells[0]
        if (!(first instanceof HTMLElement)) {
          return null
        }
        const firstRowKey = first.dataset.rowKey
        const firstColumnKey = first.dataset.cellColumnKey
        const nextRowCell = cells.find((cell) => cell.dataset.rowKey !== firstRowKey && cell.dataset.cellColumnKey === firstColumnKey)
        if (!(nextRowCell instanceof HTMLElement)) {
          return null
        }
        const firstRect = first.getBoundingClientRect()
        const nextRect = nextRowCell.getBoundingClientRect()
        return {
          firstCellKey: first.dataset.cellKey,
          nextCellKey: nextRowCell.dataset.cellKey,
          start: { x: firstRect.x + (firstRect.width / 2), y: firstRect.y + (firstRect.height / 2) },
          end: { x: nextRect.x + (nextRect.width / 2), y: nextRect.y + (nextRect.height / 2) }
        }
      })
      expect(dragTargets).not.toBeNull()

      await page.mouse.move(dragTargets.start.x, dragTargets.start.y)
      await page.mouse.down()
      await page.mouse.move(dragTargets.end.x, dragTargets.end.y, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const selectedColors = await activeResult.evaluate((node, payload) => {
        const readBg = (selector) => {
          const el = node.querySelector(selector)
          if (!(el instanceof HTMLElement)) {
            return null
          }
          return window.getComputedStyle(el).backgroundColor
        }
        return {
          first: readBg(`.editable-cell[data-cell-key="${payload.firstCellKey}"]`),
          next: readBg(`.editable-cell[data-cell-key="${payload.nextCellKey}"]`)
        }
      }, dragTargets)

      expect(selectedColors.first).not.toBeNull()
      expect(selectedColors.next).not.toBeNull()
      expect(selectedColors.next, 'drag selection should keep the same light background across adjacent rows').toBe(selectedColors.first)
    } finally {
      await electronApp.close()
    }
  })

  test('switching from drag cell selection to row or column selection should clear prior cell highlights immediately @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const selectionTargets = await activeResult.evaluate((node) => {
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]'))
        const first = cells[0]
        if (!(first instanceof HTMLElement)) {
          return null
        }

        const firstRowKey = first.dataset.rowKey ?? ''
        const firstColumnKey = first.dataset.cellColumnKey ?? ''
        const rowNeighbor = cells.find((cell) => (
          cell.dataset.rowKey === firstRowKey
          && cell.dataset.cellColumnKey !== firstColumnKey
        ))
        const columnNeighbor = cells.find((cell) => (
          cell.dataset.rowKey !== firstRowKey
          && cell.dataset.cellColumnKey === firstColumnKey
        ))
        const firstHostCell = first.closest<HTMLElement>('td[data-row-key], .ant-table-cell[data-row-key]')
        const firstRowElement = firstHostCell?.closest<HTMLElement>('tr[data-row-key], .ant-table-row[data-row-key]')
        const rowButton = firstRowElement?.querySelector<HTMLElement>('.row-number-button')
        const columnButton = node.querySelector<HTMLElement>(`[data-column-button="${CSS.escape(firstColumnKey)}"]`)
        if (!(rowNeighbor instanceof HTMLElement) || !(columnNeighbor instanceof HTMLElement) || !(rowButton instanceof HTMLElement) || !(columnButton instanceof HTMLElement)) {
          return null
        }

        const center = (element) => {
          const rect = element.getBoundingClientRect()
          return {
            x: rect.x + (rect.width / 2),
            y: rect.y + (rect.height / 2)
          }
        }

        const tableBodyHost = node.querySelector<HTMLElement>('.result-table-content')
        if (!(tableBodyHost instanceof HTMLElement)) {
          return null
        }

        return {
          start: center(first),
          rowDragEnd: center(rowNeighbor),
          columnDragEnd: center(columnNeighbor),
          rowButton: center(rowButton),
          columnButton: center(columnButton),
          tableBody: center(tableBodyHost),
          rowKey: firstRowKey,
          columnKey: firstColumnKey
        }
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.start.x, selectionTargets.start.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.rowDragEnd.x, selectionTargets.rowDragEnd.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      await page.mouse.move(selectionTargets.rowButton.x, selectionTargets.rowButton.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.tableBody.x, selectionTargets.tableBody.y, { steps: 2 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const afterRowSelection = await activeResult.evaluate((node, rowKey) => ({
        runtimeCells: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
        runtimeHosts: node.querySelectorAll('td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host').length,
        selectedRows: node.querySelectorAll(`tr[data-row-key="${CSS.escape(rowKey)}"].row-selected, .ant-table-row[data-row-key="${CSS.escape(rowKey)}"].row-selected`).length,
        selectedRowButtons: Array.from(node.querySelectorAll<HTMLElement>('tr[data-row-key], .ant-table-row[data-row-key]'))
          .filter((rowElement) => rowElement.dataset.rowKey === rowKey && rowElement.querySelector('.row-number-button.selected'))
          .length
      }), selectionTargets.rowKey)

      expect(afterRowSelection.runtimeCells, 'clicking a row number after drag selection should clear previous cell runtime selection immediately').toBe(0)
      expect(afterRowSelection.runtimeHosts, 'clicking a row number after drag selection should clear previous cell host highlight immediately').toBe(0)
      expect(afterRowSelection.selectedRows, 'clicking a row number should still keep the row selection row state visible').toBeGreaterThan(0)
      expect(afterRowSelection.selectedRowButtons, 'clicking a row number should still keep the row selection visible').toBeGreaterThan(0)

      await page.mouse.move(selectionTargets.start.x, selectionTargets.start.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.columnDragEnd.x, selectionTargets.columnDragEnd.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      await page.mouse.click(selectionTargets.columnButton.x, selectionTargets.columnButton.y)
      await page.waitForTimeout(120)

      const afterColumnSelection = await activeResult.evaluate((node, columnKey) => ({
        runtimeCells: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
        runtimeHosts: node.querySelectorAll('td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host').length,
        selectedColumnHosts: node.querySelectorAll(`[data-column-key="${CSS.escape(columnKey)}"].column-selected-runtime`).length,
        selectedColumnInners: node.querySelectorAll(`.editable-cell[data-cell-column-key="${CSS.escape(columnKey)}"].column-selected-runtime-inner`).length
      }), selectionTargets.columnKey)

      expect(afterColumnSelection.runtimeCells, 'clicking a column selector after drag selection should clear previous cell runtime selection immediately').toBe(0)
      expect(afterColumnSelection.runtimeHosts, 'clicking a column selector after drag selection should clear previous cell host highlight immediately').toBe(0)
      expect(afterColumnSelection.selectedColumnHosts, 'clicking a column selector should still keep the column host selection visible').toBeGreaterThan(0)
      expect(afterColumnSelection.selectedColumnInners, 'clicking a column selector should still keep the column inner selection visible').toBeGreaterThan(0)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table refresh button should trigger a new preview request @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editableTarget = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          originalText: cell.textContent ?? '',
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.fill(`${editableTarget.originalText}__refresh__`)
      await inlineEditor.press('Enter')
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toContainText('未提交', { timeout: 10000 })

      await page.evaluate(() => {
        const counters = {
          previewResolvedLogs: 0
        }
        const originalInfo = console.info.bind(console)
        console.info = (...args) => {
          if (args[0] === '[perf][preview-table] resolved') {
            counters.previewResolvedLogs += 1
          }
          return originalInfo(...args)
        }
        window.__datadjinnPreviewRefreshCounter = {
          counters,
          restore: () => {
            console.info = originalInfo
          }
        }
      })

      await page.locator('.workspace-tab-panels .workspace-active-content .table-data-actions [aria-label="刷新"]').click()
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toHaveCount(0, { timeout: 10000 })
      await expect(activeResult.locator(`.editable-cell[data-cell-key="${editableTarget.cellKey}"]`)).toContainText(editableTarget.originalText, { timeout: 10000 })
      await page.waitForTimeout(300)

      const counters = await page.evaluate(() => {
        const payload = window.__datadjinnPreviewRefreshCounter
        payload?.restore?.()
        delete window.__datadjinnPreviewRefreshCounter
        return payload?.counters ?? null
      })

      expect(counters).not.toBeNull()
      expect(counters.previewResolvedLogs, 'clicking the preview table refresh button should trigger a new preview request').toBeGreaterThan(0)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table refresh should restore the visible cell text immediately after editing @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editableTarget = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          originalText: cell.textContent ?? '',
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      const editedText = `${editableTarget.originalText}__edited__`
      await inlineEditor.fill(editedText)
      await inlineEditor.press('Enter')
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toContainText('未提交', { timeout: 10000 })
      const visibleCell = activeResult.locator(`.editable-cell[data-cell-key="${editableTarget.cellKey}"]`)
      await expectCellTextExactly(visibleCell, editedText)

      await activeResult.locator('.table-data-actions [aria-label="刷新"]').click()
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toHaveCount(0, { timeout: 10000 })

      await expectCellTextExactly(visibleCell, editableTarget.originalText)

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await expect(inlineEditor).toHaveValue(editableTarget.originalText)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table refresh should discard an inline editing draft immediately @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editableTarget = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          originalText: cell.textContent ?? '',
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.fill(`${editableTarget.originalText}__draft__`)

      await activeResult.locator('.table-data-actions [aria-label="刷新"]').click()
      await expect(inlineEditor).toHaveCount(0, { timeout: 10000 })
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toHaveCount(0, { timeout: 10000 })

      const visibleCell = activeResult.locator(`.editable-cell[data-cell-key="${editableTarget.cellKey}"]`)
      await expectCellTextExactly(visibleCell, editableTarget.originalText)

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const reopenedEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(reopenedEditor).toBeVisible({ timeout: 10000 })
      await expect(reopenedEditor).toHaveValue(editableTarget.originalText)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table refresh should restore a scrolled cell immediately after blur editing @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editableTarget = await findVisiblePreviewCellAfterScroll(page, activeResult, 420, 3)
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      const editedText = `${editableTarget.text}__blur_refresh__`
      await inlineEditor.fill(editedText)
      await activeResult.locator('.result-status').click()
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toContainText('未提交', { timeout: 10000 })
      const visibleCell = activeResult.locator(`.editable-cell[data-cell-key="${editableTarget.cellKey}"]`)
      await expectCellTextExactly(visibleCell, editedText)

      await activeResult.locator('.table-data-actions [aria-label="刷新"]').click()
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toHaveCount(0, { timeout: 10000 })

      await expectCellTextExactly(visibleCell, editableTarget.text)

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await expect(inlineEditor).toHaveValue(editableTarget.text)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table refresh should restore a scrolled cell immediately after enter editing @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editableTarget = await findVisiblePreviewCellAfterScroll(page, activeResult, 560, 4)
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      const editedText = `${editableTarget.text}__enter_refresh__`
      await inlineEditor.fill(editedText)
      await inlineEditor.press('Enter')
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toContainText('未提交', { timeout: 10000 })
      const visibleCell = activeResult.locator(`.editable-cell[data-cell-key="${editableTarget.cellKey}"]`)
      await expectCellTextExactly(visibleCell, editedText)

      await activeResult.locator('.table-data-actions [aria-label="刷新"]').click()
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toHaveCount(0, { timeout: 10000 })

      await expectCellTextExactly(visibleCell, editableTarget.text)

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await expect(inlineEditor).toHaveValue(editableTarget.text)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table chrome should stay visually stable for drag selection and toolbar actions @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({ timeout: 30000 })

      const targets = await activeResult.evaluate((node) => {
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]'))
        const first = cells[0]
        const second = cells[1]
        const searchButton = node.querySelector<HTMLElement>('.table-toolbar-toggle')
        const ddlButton = node.querySelector<HTMLElement>('.table-ddl-button')
        if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement) || !(searchButton instanceof HTMLElement) || !(ddlButton instanceof HTMLElement)) {
          return null
        }
        const center = (element) => {
          const rect = element.getBoundingClientRect()
          return {
            x: rect.x + (rect.width / 2),
            y: rect.y + (rect.height / 2)
          }
        }
        return {
          first: center(first),
          second: center(second),
          search: center(searchButton),
          ddl: center(ddlButton)
        }
      })
      expect(targets).not.toBeNull()

      await page.mouse.move(targets.first.x, targets.first.y)
      await page.mouse.down()
      await page.mouse.move(targets.second.x, targets.second.y, { steps: 8 })
      await page.mouse.up()
      await activeResult.evaluate(async () => {
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
      })

      let clips = await readStableChromeClips(page)
      const dragHashes = await sampleClipHashes(page, clips)
      console.log(`[perf][preview-chrome][drag-hashes] ${JSON.stringify(dragHashes)}`)
      expect(dragHashes.tableHeader?.unique.length ?? 0, 'drag selection should not make the table header flicker').toBeLessThanOrEqual(1)
      expect(dragHashes.whereShell?.unique.length ?? 0, 'drag selection should not make the where row flicker').toBeLessThanOrEqual(1)
      expect(dragHashes.aiHeader?.unique.length ?? 0, 'drag selection should not make the ai header flicker').toBeLessThanOrEqual(1)

      await page.mouse.click(targets.search.x, targets.search.y)
      await expect(activeResult.locator('.result-table-search-overlay .table-search-bar')).toBeVisible({ timeout: 10000 })
      clips = await readStableChromeClips(page)
      const searchHashes = await sampleClipHashes(page, clips)
      console.log(`[perf][preview-chrome][search-hashes] ${JSON.stringify(searchHashes)}`)
      expect(searchHashes.tableHeader?.unique.length ?? 0, 'opening search should settle the table header quickly instead of flashing repeatedly').toBeLessThanOrEqual(2)
      expect(searchHashes.whereShell?.unique.length ?? 0, 'opening search should settle the where row quickly instead of flashing repeatedly').toBeLessThanOrEqual(2)
      expect(searchHashes.aiHeader?.unique.length ?? 0, 'opening search should not make the ai header flicker').toBeLessThanOrEqual(1)

      await page.keyboard.press('Escape')
      await expect(activeResult.locator('.result-table-search-overlay .table-search-bar')).toHaveCount(0)

      await page.mouse.click(targets.ddl.x, targets.ddl.y)
      await expect(page.locator('.ddl-preview-shell')).toBeVisible({ timeout: 10000 })
      clips = await readStableChromeClips(page)
      const ddlHashes = await sampleClipHashes(page, clips)
      console.log(`[perf][preview-chrome][ddl-hashes] ${JSON.stringify(ddlHashes)}`)
      expect(ddlHashes.tableHeader?.unique.length ?? 0, 'opening ddl should not make the table header flicker').toBeLessThanOrEqual(1)
      expect(ddlHashes.whereShell?.unique.length ?? 0, 'opening ddl should not make the where row flicker').toBeLessThanOrEqual(1)
      expect(ddlHashes.aiHeader?.unique.length ?? 0, 'opening ddl should not make the ai header flicker').toBeLessThanOrEqual(1)
    } finally {
      await electronApp.close()
    }
  })

  test('clearing drag cell selection should visually settle in one frame @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const dragTargets = await activeResult.evaluate((node) => {
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]'))
        const first = cells[0]
        if (!(first instanceof HTMLElement)) {
          return null
        }
        const sameColumnNextRow = cells.find((cell) => (
          cell.dataset.rowKey !== first.dataset.rowKey
          && cell.dataset.cellColumnKey === first.dataset.cellColumnKey
        ))
        const status = node.querySelector<HTMLElement>('.result-status')
        if (!(sameColumnNextRow instanceof HTMLElement) || !(status instanceof HTMLElement)) {
          return null
        }
        const firstRect = first.getBoundingClientRect()
        const nextRect = sameColumnNextRow.getBoundingClientRect()
        const statusRect = status.getBoundingClientRect()
        return {
          start: { x: firstRect.x + (firstRect.width / 2), y: firstRect.y + (firstRect.height / 2) },
          end: { x: nextRect.x + (nextRect.width / 2), y: nextRect.y + (nextRect.height / 2) },
          clearTarget: { x: statusRect.x + (statusRect.width / 2), y: statusRect.y + (statusRect.height / 2) },
          clip: {
            x: Math.max(0, Math.min(firstRect.left, nextRect.left) - 8),
            y: Math.max(0, Math.min(firstRect.top, nextRect.top) - 8),
            width: Math.max(firstRect.right, nextRect.right) - Math.min(firstRect.left, nextRect.left) + 16,
            height: Math.max(firstRect.bottom, nextRect.bottom) - Math.min(firstRect.top, nextRect.top) + 16
          }
        }
      })
      expect(dragTargets).not.toBeNull()

      await page.mouse.move(dragTargets.start.x, dragTargets.start.y)
      await page.mouse.down()
      await page.mouse.move(dragTargets.end.x, dragTargets.end.y, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      await page.mouse.click(dragTargets.clearTarget.x, dragTargets.clearTarget.y)
      const deselectHashes = await sampleClipHashes(page, { selectionArea: dragTargets.clip })
      console.log(`[perf][preview-table][deselect-hashes] ${JSON.stringify(deselectHashes)}`)
      expect(deselectHashes.selectionArea?.unique.length ?? 0, 'clearing drag selection should settle visually in a single frame').toBeLessThanOrEqual(1)

      const clearedState = await activeResult.evaluate((node) => ({
        runtimeCells: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
        runtimeHosts: node.querySelectorAll('td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host').length,
        runtimeCellKeys: Array.from(node.querySelectorAll<HTMLElement>('.editable-cell.cell-selected-runtime[data-cell-key]')).map((element) => element.dataset.cellKey ?? ''),
        runtimeHostRows: Array.from(node.querySelectorAll<HTMLElement>('td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host')).map((element) => element.getAttribute('data-row-key') ?? '')
      }))
      console.log(`[perf][preview-table][deselect-state] ${JSON.stringify(clearedState)}`)
      expect(clearedState.runtimeCells, 'clearing drag selection should remove all runtime cell highlights').toBe(0)
      expect(clearedState.runtimeHosts, 'clearing drag selection should remove all runtime host highlights').toBe(0)
    } finally {
      await electronApp.close()
    }
  })

  test('double click editing should keep working after placing the caret inside the cell @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const target = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          originalText: cell.textContent ?? '',
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(target).not.toBeNull()

      await page.mouse.dblclick(target.x, target.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.click()
      await inlineEditor.press('End')
      await inlineEditor.type('Z')
      await expect(inlineEditor).toHaveValue(`${target.originalText}Z`)
      await inlineEditor.press('Escape')
      await expect(activeResult.locator(`.editable-cell[data-cell-key="${target.cellKey}"]`)).toContainText(target.originalText, { timeout: 10000 })
    } finally {
      await electronApp.close()
    }
  })

  test('cell inspector sidebar should keep cell selection and data when clicking inside the sidebar @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const target = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(target).not.toBeNull()

      await page.mouse.click(target.x, target.y, { button: 'right' })
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 10000 }).toBe(1)
      await clickVisibleDropdownMenuItem(page, '值视图')

      const inspector = activeResult.locator('.cell-inspector.is-open')
      await expect(inspector).toBeVisible({ timeout: 10000 })
      await expect(inspector.locator('.cell-inspector-value-area')).toBeVisible({ timeout: 10000 })

      const beforeClick = await activeResult.evaluate((node) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          inspectorTextLength: (node.querySelector<HTMLElement>('.cell-inspector-value-area')?.textContent ?? '').length
        }
      })
      expect(beforeClick.selectedCount, 'opening the cell inspector from a cell context menu should preserve a visible selected cell').toBeGreaterThan(0)
      expect(beforeClick.selectedCellKeys).toContain(target.cellKey)

      await inspector.locator('.cell-inspector-tabs').click()
      await page.waitForTimeout(120)

      const afterClick = await activeResult.evaluate((node) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          valueAreaExists: node.querySelector('.cell-inspector-value-area') instanceof HTMLElement,
          emptyStateCount: node.querySelectorAll('.cell-inspector-empty').length
        }
      })
      expect(afterClick.selectedCount, 'clicking inside the cell inspector should not clear the selected cell').toBeGreaterThan(0)
      expect(afterClick.selectedCellKeys).toContain(target.cellKey)
      expect(afterClick.valueAreaExists, 'clicking inside the cell inspector should keep the inspector data view mounted').toBe(true)
      expect(afterClick.emptyStateCount, 'clicking inside the cell inspector should not fall back to the empty state').toBe(0)
    } finally {
      await electronApp.close()
    }
  })

  test('cell inspector should preserve a multi-cell selection when opened from the context menu @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const selectionTargets = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]'))
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + (rect.width / 2),
              y: rect.y + (rect.height / 2),
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter((cell) => cell.cellKey
            && cell.right <= holderRect.right
            && cell.left >= holderRect.left
            && cell.top >= holderRect.top
            && cell.bottom <= holderRect.bottom)

        const first = cells[0]
        if (!first) {
          return null
        }
        const nextRowSameColumn = cells.find((cell) => cell.rowKey !== first.rowKey && cell.columnKey === first.columnKey)
        return nextRowSameColumn ? { first, nextRowSameColumn } : null
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.nextRowSameColumn.x, selectionTargets.nextRowSameColumn.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const selectionBeforeMenu = await activeResult.evaluate((node) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element) => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? '')
        }
      })
      expect(selectionBeforeMenu.selectedCount, 'dragging across cells should create a multi-cell selection before opening the context menu').toBeGreaterThan(1)

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y, { button: 'right' })
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 10000 }).toBe(1)

      const anchorCellKey = selectionTargets.first.cellKey
      const selectionWithMenuOpen = await activeResult.evaluate((node, currentAnchorCellKey) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element) => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        const anchor = node.querySelector(`.editable-cell[data-cell-key="${CSS.escape(currentAnchorCellKey)}"]`)
        const anchorHost = anchor instanceof HTMLElement ? anchor.closest('td, .ant-table-cell') : null
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          anchorStillSelected: anchor instanceof HTMLElement
            ? anchor.classList.contains('cell-selected-runtime')
              || (anchorHost instanceof HTMLElement && anchorHost.classList.contains('cell-selected-runtime-host'))
            : false
        }
      }, anchorCellKey)
      expect(selectionWithMenuOpen.selectedCount, 'opening the context menu itself should keep the multi-cell highlight visible').toBeGreaterThan(1)
      expect(selectionWithMenuOpen.anchorStillSelected, 'opening the context menu itself should keep the right-clicked cell visibly selected').toBe(true)

      const sampledSelectionStatePromise = activeResult.evaluate(async (node, currentAnchorCellKey) => {
        const frames: Array<{ selectedCount: number; anchorStillSelected: boolean }> = []
        const sampleFrame = async (): Promise<void> => {
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
          const anchor = node.querySelector(`.editable-cell[data-cell-key="${CSS.escape(currentAnchorCellKey)}"]`)
          const anchorHost = anchor instanceof HTMLElement ? anchor.closest('td, .ant-table-cell') : null
          const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
            .filter((element) => element instanceof HTMLElement)
            .filter((element) => {
              const host = element.closest('td, .ant-table-cell')
              return element.classList.contains('cell-selected-runtime')
                || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            })
          frames.push({
            selectedCount: selectedCells.length,
            anchorStillSelected: anchor instanceof HTMLElement
              ? anchor.classList.contains('cell-selected-runtime')
                || (anchorHost instanceof HTMLElement && anchorHost.classList.contains('cell-selected-runtime-host'))
              : false
          })
        }
        await sampleFrame()
        await sampleFrame()
        await sampleFrame()
        await sampleFrame()
        return frames
      }, anchorCellKey)
      await clickVisibleDropdownMenuItem(page, '聚合视图')

      const inspector = activeResult.locator('.cell-inspector.is-open')
      await expect(inspector).toBeVisible({ timeout: 10000 })
      const sampledSelectionState = await sampledSelectionStatePromise

      const selectionAfterMenu = await activeResult.evaluate((node, currentAnchorCellKey) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element) => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        const anchor = node.querySelector(`.editable-cell[data-cell-key="${CSS.escape(currentAnchorCellKey)}"]`)
        const anchorHost = anchor instanceof HTMLElement ? anchor.closest('td, .ant-table-cell') : null
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          aggregateRows: node.querySelectorAll('.cell-inspector-aggregate-row').length,
          anchorStillSelected: anchor instanceof HTMLElement
            ? anchor.classList.contains('cell-selected-runtime')
              || (anchorHost instanceof HTMLElement && anchorHost.classList.contains('cell-selected-runtime-host'))
            : false
        }
      }, anchorCellKey)
      expect(sampledSelectionState.every((frame) => frame.selectedCount > 1), 'opening the inspector from the context menu should not drop the multi-cell highlight in any intermediate frame').toBe(true)
      expect(sampledSelectionState.every((frame) => frame.anchorStillSelected), 'opening the inspector from the context menu should not let the right-clicked cell lose its selected state in any intermediate frame').toBe(true)
      expect(selectionAfterMenu.selectedCount, 'opening the inspector from a multi-cell context selection should keep the multi-cell highlight').toBeGreaterThan(1)
      expect(selectionAfterMenu.selectedCellKeys.length, 'opening the inspector from a multi-cell context selection should keep multiple selected cell keys').toBeGreaterThan(1)
      expect(selectionAfterMenu.anchorStillSelected, 'opening the inspector from a multi-cell context selection should keep the right-clicked cell visibly selected').toBe(true)
      expect(selectionAfterMenu.aggregateRows, 'aggregate view should render aggregated rows for the preserved multi-cell selection').toBeGreaterThan(0)
    } finally {
      await electronApp.close()
    }
  })

  test('editing inside cell inspector views should keep selected cell highlights visible @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const selectionTargets = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]'))
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + (rect.width / 2),
              y: rect.y + (rect.height / 2),
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter((cell) => cell.cellKey
            && cell.right <= holderRect.right
            && cell.left >= holderRect.left
            && cell.top >= holderRect.top
            && cell.bottom <= holderRect.bottom)

        const first = cells[0]
        if (!first) {
          return null
        }
        const nextRowSameColumn = cells.find((cell) => cell.rowKey !== first.rowKey && cell.columnKey === first.columnKey)
        return nextRowSameColumn ? { first, nextRowSameColumn } : null
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.nextRowSameColumn.x, selectionTargets.nextRowSameColumn.y, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(120)

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y, { button: 'right' })
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 10000 }).toBe(1)
      await clickVisibleDropdownMenuItem(page, '值视图')

      const inspector = activeResult.locator('.cell-inspector.is-open')
      const valueArea = inspector.locator('.cell-inspector-value-area')
      await expect(inspector).toBeVisible({ timeout: 10000 })
      await expect(valueArea).toBeVisible({ timeout: 10000 })

      await valueArea.fill('inspector-value-edit')
      await page.waitForTimeout(120)

      const selectionAfterValueEdit = await activeResult.evaluate((node, anchorCellKey) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          anchorStillSelected: selectedCells.some((element) => (element.dataset.cellKey ?? '') === anchorCellKey)
        }
      }, selectionTargets.first.cellKey)
      expect(selectionAfterValueEdit.selectedCount, 'editing in the value view should keep the multi-cell highlight visible').toBeGreaterThan(1)
      expect(selectionAfterValueEdit.anchorStillSelected, 'editing in the value view should keep the anchor cell visibly selected').toBe(true)

      await inspector.locator('.cell-inspector-tab').filter({ hasText: '记录' }).click()
      const firstRecordField = inspector.locator('.cell-inspector-field-value').first()
      await expect(firstRecordField).toBeVisible({ timeout: 10000 })
      await firstRecordField.fill('inspector-record-edit')
      await page.waitForTimeout(120)

      const selectionAfterRecordEdit = await activeResult.evaluate((node, anchorCellKey) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return element.classList.contains('cell-selected-runtime')
              || (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          anchorStillSelected: selectedCells.some((element) => (element.dataset.cellKey ?? '') === anchorCellKey)
        }
      }, selectionTargets.first.cellKey)
      expect(selectionAfterRecordEdit.selectedCount, 'editing in the record view should keep the multi-cell highlight visible').toBeGreaterThan(1)
      expect(selectionAfterRecordEdit.anchorStillSelected, 'editing in the record view should keep the anchor cell visibly selected').toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('cell context menu should open immediately, close on blank click, and avoid stacked overlays @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const target = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(target).not.toBeNull()

      const openLatency = await page.evaluate(async ({ x, y }) => {
        const start = performance.now()
        document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 2,
          buttons: 2
        }))

        while (performance.now() - start < 220) {
          const menus = Array.from(document.querySelectorAll('.result-cell-context-menu-panel, .ant-dropdown'))
            .filter((node): node is HTMLElement => node instanceof HTMLElement)
            .filter((node) => {
              const rect = node.getBoundingClientRect()
              const style = window.getComputedStyle(node)
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
            })
          if (menus.length > 0) {
            return {
              elapsed: performance.now() - start,
              visibleMenus: menus.length
            }
          }
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        }

      return null
      }, target)
      expect(openLatency, 'right-clicking a cell should open the context menu immediately').not.toBeNull()
      expect(openLatency.elapsed, 'cell context menu should open within a short interaction frame budget').toBeLessThan(220)
      expect(openLatency.visibleMenus, 'opening the cell context menu once should only render one visible overlay').toBe(1)

      await page.mouse.click(target.x + 180, target.y + 120)
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 5000 }).toBe(0)

      for (let index = 0; index < 3; index += 1) {
        await page.mouse.click(target.x, target.y, { button: 'right' })
        await expect.poll(async () => countVisibleDropdowns(page), { timeout: 5000 }).toBe(1)
        await page.mouse.click(target.x + 220, target.y + 120)
        await expect.poll(async () => countVisibleDropdowns(page), { timeout: 5000 }).toBe(0)
      }

      await page.mouse.click(target.x, target.y, { button: 'right' })
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 5000 }).toBe(1)
      await page.mouse.click(target.x, target.y, { button: 'right' })
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 5000 }).toBe(1)
    } finally {
      await electronApp.close()
    }
  })

  test('tree selector popover should open on single click @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await treeNode(page, `connection:${fixtureConnectionId}`).click()

      const selectorBadge = page.locator('.connection-tree-actions .selector-badge').first()
      await expect(selectorBadge).toBeVisible({ timeout: 30000 })

      await selectorBadge.click()
      await expect(page.locator('.tree-selector-popover')).toBeVisible({ timeout: 30000 })

      await page.locator('.tree-selector-popover .tree-selector-checkbox').first().click()
      await expect(page.locator('.tree-selector-popover')).toBeVisible({ timeout: 30000 })
    } finally {
      await electronApp.close()
    }
  })

  test('tree selector popover should appear without a noticeable delay after single click @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await treeNode(page, `connection:${fixtureConnectionId}`).click()

      const selectorBadge = page.locator('.connection-tree-actions .selector-badge').first()
      const popover = page.locator('.tree-selector-popover')
      await expect(selectorBadge).toBeVisible({ timeout: 30000 })

      const openedInTime = await page.evaluate(async () => {
        const badge = document.querySelector('.connection-tree-actions .selector-badge')
        if (!(badge instanceof HTMLElement)) {
          return null
        }
        const start = performance.now()
        badge.click()
        while (performance.now() - start < 220) {
          const popoverNode = document.querySelector('.tree-selector-popover')
          if (popoverNode instanceof HTMLElement) {
            const style = window.getComputedStyle(popoverNode)
            const rect = popoverNode.getBoundingClientRect()
            if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
              return performance.now() - start
            }
          }
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        }
        return null
      })

      await expect(popover).toBeVisible({ timeout: 30000 })
      expect(openedInTime, 'tree selector popover should appear quickly after a single click').not.toBeNull()
      expect(openedInTime, 'tree selector popover should open within a single short interaction frame budget').toBeLessThan(220)
    } finally {
      await electronApp.close()
    }
  })

  test('tree context menu should open near the right-clicked node @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      const targetKey = `connection:${fixtureConnectionId}`
      await expect.poll(async () => revealTreeNode(page, targetKey), { timeout: 15000 }).toBe(true)

      const targetNode = treeNode(page, targetKey)
      await expect(targetNode).toBeVisible({ timeout: 15000 })
      const nodeBox = await targetNode.boundingBox()
      expect(nodeBox).not.toBeNull()

      const clickX = nodeBox.x + Math.min(nodeBox.width - 12, 120)
      const clickY = nodeBox.y + nodeBox.height / 2
      await page.mouse.click(clickX, clickY, { button: 'right' })

      const menu = page.locator('.tree-context-menu-panel')
      await expect(menu).toBeVisible({ timeout: 10000 })
      const menuBox = await menu.boundingBox()
      expect(menuBox).not.toBeNull()

      const deltaX = Math.abs(menuBox.x - clickX)
      const deltaY = Math.abs(menuBox.y - clickY)
      expect(deltaX, 'tree context menu should stay near the horizontal click position').toBeLessThan(40)
      expect(deltaY, 'tree context menu should stay near the vertical click position').toBeLessThan(40)
    } finally {
      await electronApp.close()
    }
  })

  test('closing a connection should hide the tree selector badge and keep the selector popover closed @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      const connectionKey = `connection:${fixtureConnectionId}`
      const connectionNode = treeNode(page, connectionKey)
      await expect(connectionNode).toBeVisible({ timeout: 15000 })
      await connectionNode.click()

      const selectorBadge = page.locator('.connection-tree-actions .selector-badge').first()
      await expect(selectorBadge).toBeVisible({ timeout: 15000 })

      const nodeBox = await connectionNode.boundingBox()
      expect(nodeBox).not.toBeNull()
      await page.mouse.click(nodeBox.x + Math.min(nodeBox.width - 12, 120), nodeBox.y + nodeBox.height / 2, { button: 'right' })

      const closeMenuItem = page.locator('.tree-context-menu-panel .ant-menu-item').filter({ hasText: '关闭连接' }).first()
      await expect(closeMenuItem).toBeVisible({ timeout: 10000 })
      await closeMenuItem.click()

      await expect(selectorBadge).toHaveCount(0)
      await expect(page.locator('.tree-selector-popover')).toHaveCount(0)
      await expect(connectionNode).toHaveClass(/is-closed/, { timeout: 15000 })
    } finally {
      await electronApp.close()
    }
  })

  test('switching selected connection rows should update immediately on single click @smoke @bug', async () => {
    const fixtureUserDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(fixtureUserDataDir, 'connections.json')
    const secondSqlitePath = path.join(fixtureUserDataDir, 'regression-second-selection.sqlite')
    if (!fs.existsSync(secondSqlitePath)) {
      fs.copyFileSync(path.join(fixtureUserDataDir, 'regression-fixture.sqlite'), secondSqlitePath)
    }

    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const secondConnectionId = 'regression-sqlite-fixture-second'
    const alreadyExists = connectionStore.connections.some((item) => item.connection_id === secondConnectionId)
    if (!alreadyExists) {
      const templateConnection = connectionStore.connections.find((item) => item.connection_id === fixtureConnectionId)
      if (!templateConnection) {
        throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
      }
      connectionStore.connections.push({
        ...templateConnection,
        connection_id: secondConnectionId,
        name: '回归选择切换 SQLite 2',
        database: secondSqlitePath,
        sqlite_path: secondSqlitePath
      })
      fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')
    }

    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const firstKey = `connection:${fixtureConnectionId}`
      const secondKey = `connection:${secondConnectionId}`
      await expect.poll(async () => revealTreeNode(page, firstKey), { timeout: 15000 }).toBe(true)
      await expect.poll(async () => revealTreeNode(page, secondKey), { timeout: 15000 }).toBe(true)

      const firstNode = treeNode(page, firstKey)
      const secondNode = treeNode(page, secondKey)
      await expect(firstNode).toBeVisible({ timeout: 15000 })
      await expect(secondNode).toBeVisible({ timeout: 15000 })

      await firstNode.click()
      await expect(firstNode).toHaveClass(/is-selected/, { timeout: 5000 })

      const switchedInTime = await page.evaluate(async (targetKey) => {
        const target = document.querySelector(`.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`)
        if (!(target instanceof HTMLElement)) {
          return null
        }
        const start = performance.now()
        target.click()
        while (performance.now() - start < 160) {
          if (target.classList.contains('is-selected')) {
            return performance.now() - start
          }
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        }
        return null
      }, secondKey)

      expect(switchedInTime, 'clicking another connection row should switch selection without a noticeable delay').not.toBeNull()
      expect(switchedInTime, 'connection row selection should update within a short interaction frame budget').toBeLessThan(160)
      await expect(secondNode).toHaveClass(/is-selected/, { timeout: 5000 })
    } finally {
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('preview pager should stay pinned to the right side of the status bar @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      const alignment = await page.locator('.workspace-tab-panels .workspace-active-content .result-status').evaluate((node) => {
        const status = node instanceof HTMLElement ? node : null
        const pager = status?.querySelector('.result-status-pager-shell')
        if (!(status instanceof HTMLElement) || !(pager instanceof HTMLElement)) {
          return null
        }
        const statusRect = status.getBoundingClientRect()
        const pagerRect = pager.getBoundingClientRect()
        return {
          gapRight: statusRect.right - pagerRect.right,
          leftRatio: (pagerRect.left - statusRect.left) / statusRect.width
        }
      })

      expect(alignment, 'preview status bar should render a pager shell').not.toBeNull()
      expect(alignment.gapRight, 'preview pager should stay visually attached to the right edge').toBeLessThanOrEqual(24)
      expect(alignment.leftRatio, 'preview pager should stay in the right half of the status bar').toBeGreaterThan(0.5)
    } finally {
      await electronApp.close()
    }
  })

  test('preview save button should turn highlighted after blur commits an edit @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editableTarget = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          originalText: cell.textContent ?? '',
          x: rect.x + (rect.width / 2),
          y: rect.y + (rect.height / 2)
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.fill(`${editableTarget.originalText}__pending__`)
      await activeResult.locator('.result-status').click()

      const saveButton = activeResult.locator('.table-data-actions [aria-label="提交"]')
      await expect(page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })).toContainText('未提交', { timeout: 10000 })
      await expect(saveButton).toHaveClass(/is-pending-save/, { timeout: 10000 })
    } finally {
      await electronApp.close()
    }
  })

  test('adding a preview row should scroll the new row into view automatically @smoke @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const beforeState = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        const lastInsertedRow = node.querySelector('.result-table tr[data-row-key^="new:"], .result-table .ant-table-row[data-row-key^="new:"]')
        return {
          scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
          hasInsertedRow: Boolean(lastInsertedRow)
        }
      })
      expect(beforeState.hasInsertedRow).toBe(false)

      await activeResult.locator('.table-data-actions .table-toolbar-icon-btn').nth(1).click()
      await page.waitForTimeout(600)

      const afterState = await activeResult.evaluate((node) => {
        const holder = node.querySelector('.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body')
        const insertedRow = node.querySelector<HTMLElement>('.result-table tr[data-row-key^="new:"], .result-table .ant-table-row[data-row-key^="new:"]')
        const holderRect = holder instanceof HTMLElement ? holder.getBoundingClientRect() : null
        const rowRect = insertedRow instanceof HTMLElement ? insertedRow.getBoundingClientRect() : null
        return {
          scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
          insertedVisible: Boolean(holderRect && rowRect && rowRect.bottom <= holderRect.bottom && rowRect.top >= holderRect.top),
          insertedRowKey: insertedRow?.dataset.rowKey ?? null
        }
      })

      expect(afterState.insertedRowKey, 'adding a preview row should render the inserted row').not.toBeNull()
      expect(afterState.scrollTop, 'adding a preview row should move the table scroll downward').toBeGreaterThan(beforeState.scrollTop)
      expect(afterState.insertedVisible, 'adding a preview row should scroll the inserted row into the visible area').toBe(true)
    } finally {
      await electronApp.close()
    }
  })
})
