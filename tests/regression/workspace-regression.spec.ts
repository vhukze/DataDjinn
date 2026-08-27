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
const threeColumnTableName = 'three_column_items'
const singleColumnTableName = 'single_column_items'
const wideTableName = 'wide_items'
const MAX_STABLE_CHROME_HASHES = 2

function readFixtureUserDataDir() {
  const pointerPath = path.join(regressionRootDir, 'current.json')
  if (!fs.existsSync(pointerPath)) {
    throw new Error(`Regression pointer not found: ${pointerPath}`)
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'))
  if (
    !pointer.current_user_data_dir ||
    !fs.existsSync(path.join(pointer.current_user_data_dir, 'connections.json'))
  ) {
    throw new Error(
      `Regression fixture user data missing: ${pointer.current_user_data_dir ?? 'unknown'}`
    )
  }
  return pointer.current_user_data_dir
}

async function launchRegressionApp(options = {}) {
  const userDataDir = readFixtureUserDataDir()
  const testWindowHeight = options.windowHeight
  const aiStreamEvents = options.aiStreamEvents
  const testRoutineNames = options.testRoutineNames
  const aiModuleEnabled = options.aiModuleEnabled ?? true
  const packagedExecutable = process.env.DATADJINN_REGRESSION_EXECUTABLE
  return electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable } : { args: [electronEntry] }),
    env: {
      ...process.env,
      DATADJINN_TEST_RUN_ROOT: regressionRootDir,
      DATADJINN_TEST_USER_DATA_DIR: userDataDir,
      DATADJINN_SKIP_SPLASH: '1',
      DATADJINN_TEST_ENABLE_AI_MODULE: aiModuleEnabled ? '1' : '0',
      ...(testWindowHeight ? { DATADJINN_TEST_WINDOW_HEIGHT: String(testWindowHeight) } : {}),
      ...(aiStreamEvents ? { DATADJINN_TEST_AI_STREAM_EVENTS: JSON.stringify(aiStreamEvents) } : {}),
      ...(testRoutineNames ? { DATADJINN_TEST_ROUTINE_NAMES: testRoutineNames.join(',') } : {})
    }
  })
}

async function launchRegressionAppWithSplash() {
  const userDataDir = readFixtureUserDataDir()
  return electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      DATADJINN_TEST_RUN_ROOT: regressionRootDir,
      DATADJINN_TEST_USER_DATA_DIR: userDataDir
    }
  })
}

async function launchRegressionAppWithJdbcJavaDisabled() {
  const userDataDir = readFixtureUserDataDir()
  fs.writeFileSync(
    path.join(userDataDir, 'jdbc_runtime.json'),
    JSON.stringify({ enabled: false, java_home: null }),
    'utf-8'
  )
  return launchRegressionApp()
}

async function launchRegressionAppWithJdbcJavaEnabled() {
  const userDataDir = readFixtureUserDataDir()
  fs.writeFileSync(
    path.join(userDataDir, 'jdbc_runtime.json'),
    JSON.stringify({ enabled: true, java_home: path.join(userDataDir, 'configured-jdk') }),
    'utf-8'
  )
  return launchRegressionApp()
}

async function waitForAppReady(page) {
  await page.waitForSelector('.resource-tree-shell', { timeout: 60000 })
  await expect
    .poll(
      async () => {
        return page.evaluate(async () => {
          const status = await window.api.getBackendStatus()
          return status.state
        })
      },
      { timeout: 60000 }
    )
    .toBe('online')
  await page.waitForSelector('.app-shell[data-startup-ready="true"]', { timeout: 60000 })
  await waitForBrowserIdle(page)
}

async function waitForBrowserIdle(page) {
  await page.evaluate(async () => {
    const waitFrame = () =>
      new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
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
  await expect
    .poll(() => page.evaluate(() => window.innerWidth), {
      timeout: 10000,
      message: 'regression viewport width is too small for desktop layout'
    })
    .toBeGreaterThanOrEqual(1400)
  await expect
    .poll(() => page.evaluate(() => window.innerHeight), {
      timeout: 10000,
      message: 'regression viewport height is too small for desktop layout'
    })
    .toBeGreaterThanOrEqual(980)
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
      startX: resizerRect.left + resizerRect.width / 2,
      targetX: panelRect.left + desiredWidth,
      y: resizerRect.top + Math.min(160, Math.max(40, resizerRect.height / 2))
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

  await expect
    .poll(
      async () => {
        return page
          .locator('.resource-panel')
          .evaluate((node) => Math.round(node.getBoundingClientRect().width))
      },
      { timeout: 10000 }
    )
    .toBeGreaterThanOrEqual(targetWidth - 6)
}

function treeNode(page, key) {
  return page.locator(`.resource-tree-node-title[data-tree-node-key="${key}"]`)
}

async function revealTreeNode(page, key) {
  return page.evaluate(async (targetKey) => {
    const findTarget = () =>
      document.querySelector(
        `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
      )
    const waitFrame = () =>
      new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
    const findScrollHost = () => {
      const candidates = [
        document.querySelector('.resource-tree-viewport .ant-tree-list-holder'),
        document.querySelector('.resource-tree-viewport .ant-tree-list'),
        document.querySelector('.resource-tree-viewport')
      ].filter((element) => element instanceof HTMLElement)
      return (
        candidates.find((element) => element.scrollHeight > element.clientHeight + 4) ??
        candidates[0] ??
        null
      )
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
  await expect
    .poll(
      async () => {
        return page.evaluate((targetKey) => {
          const element = document.querySelector(
            `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
          )
          return element instanceof HTMLElement
        }, key)
      },
      { timeout: 15000 }
    )
    .toBe(true)
  await page.evaluate((targetKey) => {
    const element = document.querySelector(
      `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
    )
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Tree node is not clickable: ${targetKey}`)
    }
    element.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        detail: 2
      })
    )
  }, key)
}

async function ensureTreeNodeExpanded(page, key) {
  const revealed = await revealTreeNode(page, key)
  if (!revealed) {
    return
  }
  await page.evaluate((targetKey) => {
    const title = document.querySelector(
      `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
    )
    if (!(title instanceof HTMLElement)) {
      throw new Error(`Tree node not found: ${targetKey}`)
    }
    const treeNode = title.closest('.ant-tree-treenode')
    const expanded =
      treeNode?.classList.contains('ant-tree-treenode-switcher-open') ||
      treeNode?.querySelector('.ant-tree-switcher')?.classList.contains('ant-tree-switcher_open')
    if (expanded) {
      return
    }
    const switcher = treeNode?.querySelector('.ant-tree-switcher')
    if (switcher instanceof HTMLElement) {
      switcher.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          detail: 1
        })
      )
      return
    }
    title.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        detail: 2
      })
    )
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
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText(tableName, {
    timeout: 30000
  })
  await expect(
    page.locator('.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead')
  ).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)
}

async function expectCellTextExactly(locator, expectedText) {
  await expect
    .poll(
      async () => {
        return locator.evaluateAll((nodes) => {
          const visibleNode = nodes.find((node) => {
            if (!(node instanceof HTMLElement)) {
              return false
            }
            const rect = node.getBoundingClientRect()
            const style = window.getComputedStyle(node)
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            )
          })
          const targetNode = visibleNode ?? nodes[0]
          return targetNode instanceof HTMLElement ? (targetNode.textContent ?? '') : null
        })
      },
      { timeout: 10000 }
    )
    .toBe(expectedText)
}

async function getVisibleDropdownMenuItemCenter(page, label) {
  return page.evaluate((expectedLabel) => {
    const items = Array.from(
      document.querySelectorAll(
        '.result-cell-context-menu-panel .ant-menu-item, .ant-dropdown .ant-dropdown-menu .ant-dropdown-menu-item'
      )
    ).filter((node): node is HTMLElement => node instanceof HTMLElement)
    const normalizedExpectedLabel = expectedLabel.replace(/\s+/g, '')
    const target = items.find((item) => {
      const text = item.textContent?.replace(/\s+/g, '') ?? ''
      if (text !== normalizedExpectedLabel && !text.includes(normalizedExpectedLabel)) {
        return false
      }
      const rect = item.getBoundingClientRect()
      const style = window.getComputedStyle(item)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      )
    })
    if (!target) {
      return null
    }
    const rect = target.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  }, label)
}

async function clickVisibleDropdownMenuItem(page, label) {
  let center = null
  await expect
    .poll(
      async () => {
        center = await getVisibleDropdownMenuItemCenter(page, label)
        return center !== null
      },
      {
        timeout: 10000
      }
    )
    .toBe(true)
  if (!center) {
    throw new Error(`visible dropdown item should exist: ${label}`)
  }
  await page.mouse.click(center.x, center.y)
}

async function countVisibleDropdowns(page) {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll('.result-cell-context-menu-panel, .ant-dropdown'))
        .filter((node): node is HTMLElement => node instanceof HTMLElement)
        .filter((node) => {
          const rect = node.getBoundingClientRect()
          const style = window.getComputedStyle(node)
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          )
        }).length
  )
}

async function readVisibleResourceCreateDropdownMetrics(page) {
  return page.evaluate(() => {
    const menus = Array.from(
      document.querySelectorAll('.resource-create-dropdown .ant-dropdown-menu')
    ).filter((node): node is HTMLElement => node instanceof HTMLElement)
    const visibleMenu = menus.find((node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      )
    })
    if (!(visibleMenu instanceof HTMLElement)) {
      return null
    }
    const style = window.getComputedStyle(visibleMenu)
    const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
    return {
      backdropFilter: style.backdropFilter,
      webkitBackdropFilter: style.webkitBackdropFilter,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      rgb: match ? match.slice(1, 4).map((value) => Number.parseInt(value, 10)) : null
    }
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
      tableHeader: rect(
        '.workspace-tab-panels .workspace-active-content .result-table .ant-table-header'
      ),
      whereShell: rect('.workspace-tab-panels .workspace-active-content .preview-where-shell'),
      aiHeader: rect('.ai-dock-panel .ai-panel-header')
    }
  })
}

async function sampleClipHashes(page, clips, sampleCount = 6, delayMs = 70) {
  await page.evaluate(() => {
    const id = 'regression-visual-stability-style'
    if (document.getElementById(id)) {
      return
    }
    const style = document.createElement('style')
    style.id = id
    style.textContent = '.preview-where-shell input { caret-color: transparent !important; }'
    document.head.append(style)
  })
  const clipEntries = Object.entries(clips).filter(([, clip]) => clip)
  const hashes = {}
  for (const [name] of clipEntries) {
    hashes[name] = []
  }

  // Let Chromium's compositor settle before measuring a sustained visual change.
  for (let index = 0; index < sampleCount + 2; index += 1) {
    for (const [name, clip] of clipEntries) {
      const buffer = await page.screenshot({ clip })
      if (index >= 2) {
        hashes[name].push(hashScreenshot(buffer))
      }
    }
    if (index < sampleCount + 1) {
      await page.waitForTimeout(delayMs)
    }
  }

  return Object.fromEntries(
    Object.entries(hashes).map(([name, values]) => [
      name,
      {
        unique: [...new Set(values)],
        count: values.length
      }
    ])
  )
}

async function waitForVisualSettle(page) {
  await page.waitForTimeout(250)
  await page.evaluate(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  })
}

async function settlePreviewWhereChrome(page) {
  await page.evaluate(async () => {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLInputElement &&
      activeElement.closest('.preview-where-shell')
    ) {
      activeElement.blur()
    }
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  })
}

async function getVerticalScrollbarDragTarget(activeResult) {
  return activeResult.evaluate((node) => {
    const scrollbar = node.querySelector('.ant-table-tbody-virtual-scrollbar-vertical')
    const thumb = scrollbar?.querySelector('.ant-table-tbody-virtual-scrollbar-thumb')
    if (!(scrollbar instanceof HTMLElement) || !(thumb instanceof HTMLElement)) {
      return null
    }
    const scrollbarRect = scrollbar.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    return {
      x: thumbRect.x + thumbRect.width / 2,
      startY: thumbRect.y + thumbRect.height / 2,
      endY: scrollbarRect.y + scrollbarRect.height - thumbRect.height / 2 - 4
    }
  })
}

async function findVisiblePreviewCellAfterScroll(page, activeResult, scrollTop, pickFromEnd = 3) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const target = await activeResult.evaluate(
      async (node, payload) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const maxScrollTop = Math.max(0, holder.scrollHeight - holder.clientHeight)
        holder.scrollTop = Math.min(payload.scrollTop, maxScrollTop)
        holder.dispatchEvent(new Event('scroll', { bubbles: true }))
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
        )
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .map((cell) => {
            if (!(cell instanceof HTMLElement)) {
              return null
            }
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              text: cell.textContent ?? ''
            }
          })
          .filter(
            (cell) =>
              cell &&
              cell.cellKey &&
              cell.right <= holderRect.right &&
              cell.left >= holderRect.left &&
              cell.top >= holderRect.top &&
              cell.bottom <= holderRect.bottom
          )
        if (cells.length === 0) {
          return null
        }
        return cells[Math.max(0, cells.length - payload.pickFromEnd)] ?? null
      },
      { scrollTop, pickFromEnd }
    )
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
        counters.aiPanelMutations += mutations.reduce(
          (total, mutation) => total + mutation.addedNodes.length + mutation.removedNodes.length,
          0
        )
      })
      aiObserver.observe(aiPanel, { childList: true, subtree: true })
      observers.push(aiObserver)
    }

    if (workspacePane) {
      const workspaceObserver = new MutationObserver((mutations) => {
        counters.workspaceMutations += mutations.reduce(
          (total, mutation) => total + mutation.addedNodes.length + mutation.removedNodes.length,
          0
        )
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
      ].filter(
        (element, index, all) => element instanceof HTMLElement && all.indexOf(element) === index
      )
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
      const visibleRows = activePane.querySelectorAll(
        '.result-table tbody tr, .result-table .ant-table-tbody-virtual-holder .ant-table-row'
      ).length
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
    const bodyScroll = activePane?.querySelector(
      '.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder'
    )
    const header = activePane?.querySelector('.result-table .ant-table-header')
    const firstRow = activePane?.querySelector(
      '.result-table tbody tr, .result-table .ant-table-tbody-virtual-holder .ant-table-row'
    )
    const horizontalScrollbar = activePane?.querySelector(
      '.result-table-native-horizontal-scrollbar'
    )

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

  expect(shellHeight, `${tableName} shell height too small`).toBeGreaterThanOrEqual(
    Math.floor(paneHeight * 0.7)
  )
  expect(contentHeight, `${tableName} content height too small`).toBeGreaterThanOrEqual(
    Math.floor(shellHeight * 0.84)
  )
  expect(bodyHeight, `${tableName} body height too small`).toBeGreaterThanOrEqual(
    Math.floor(contentHeight * 0.82)
  )
  expect(scrollHeight, `${tableName} scroll height too small`).toBeGreaterThanOrEqual(
    Math.floor(bodyHeight * 0.78)
  )

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
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText(title, {
    timeout: 30000
  })
  await expect(page.locator('.app-error-boundary')).toHaveCount(0)
  return Date.now() - startedAt
}

async function openQueryWorkspace(page) {
  const button = page.getByRole('button', { name: '新建查询' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText('查询', {
    timeout: 30000
  })
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

async function readActiveStatementIndex(page) {
  const button = page.locator('.query-execute-dropdown-button').first()
  await expect(button).toBeVisible({ timeout: 10000 })
  const rawValue = await button.getAttribute('data-active-statement-index')
  return Number(rawValue ?? '-1')
}

async function moveCaretToLineEnd(page, lineNumber) {
  const line = page
    .locator('.sql-editor-container .view-lines > div')
    .filter({ hasText: `select ${lineNumber}` })
    .first()
  await expect(line).toBeVisible({ timeout: 30000 })
  const box = await line.boundingBox()
  if (!box) {
    // Monaco may keep a visible line node without a measurable box while its view is reflowing.
    // Keyboard navigation exercises the same caret behavior without depending on that transient DOM state.
    await focusMonacoEditor(page)
    await page.keyboard.press('Control+Home')
    for (let index = 1; index < lineNumber; index += 1) {
      await page.keyboard.press('ArrowDown')
    }
    await page.keyboard.press('End')
    await page.waitForTimeout(80)
    return
  }
  await page.mouse.click(box.x + 18, box.y + box.height / 2)
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

async function measureModalOpenClose(page, { label, open, close, modalSelector, assertOpen }) {
  const modal = page.locator(modalSelector)

  await waitForBrowserIdle(page)
  const openStartedAt = Date.now()
  await open()
  await expect(modal).toBeVisible({ timeout: 10000 })
  await assertOpen?.(modal)
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

async function assertModalCentered(page, modal, expectedMinimumWidth) {
  const metrics = await modal.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height
    }
  })

  expect(Math.abs(metrics.centerX - metrics.viewportWidth / 2), 'modal must be horizontally centered').toBeLessThanOrEqual(4)
  expect(Math.abs(metrics.centerY - metrics.viewportHeight / 2), 'modal must be vertically centered').toBeLessThanOrEqual(4)
  if (expectedMinimumWidth) {
    expect(metrics.width, 'modal width is smaller than its desktop design width').toBeGreaterThanOrEqual(
      expectedMinimumWidth
    )
  }
}

async function measureConnectionCreateFlow(page, itemLabel) {
  const createButton = page.locator('.resource-header .resource-add')
  const modal = page.locator('.connection-editor-modal')

  await waitForBrowserIdle(page)
  const menuOpenStartedAt = Date.now()
  await createButton.click()
  await expect
    .poll(
      async () => {
        return (await getVisibleDropdownMenuItemCenter(page, itemLabel)) !== null
      },
      { timeout: 10000 }
    )
    .toBe(true)
  const menuOpenMs = Date.now() - menuOpenStartedAt

  const modalOpenStartedAt = Date.now()
  await clickVisibleDropdownMenuItem(page, itemLabel)
  await expect(modal).toBeVisible({ timeout: 10000 })
  const modalOpenMs = Date.now() - modalOpenStartedAt

  await page.locator('.connection-editor-modal .ant-modal-close').click()
  await expect(modal).not.toBeVisible({ timeout: 10000 })
  await waitForBrowserIdle(page)

  console.log(
    `[perf][connection-create-flow][${itemLabel}] ${JSON.stringify({ menuOpenMs, modalOpenMs })}`
  )
  return { menuOpenMs, modalOpenMs }
}

test.describe('workspace regression', () => {
  test('application should start normally when JDBC Java is disabled @bug', async () => {
    const electronApp = await launchRegressionAppWithJdbcJavaDisabled()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await expect(page.locator('.app-shell[data-startup-ready="true"]')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('changing JDBC Java settings should restart only the backend service @bug', async () => {
    const electronApp = await launchRegressionAppWithJdbcJavaEnabled()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click()
      const modal = page.locator('.settings-window-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByRole('menuitem', { name: '驱动管理' }).click()

      const jdbcCard = modal.locator('.settings-jdbc-card')
      const javaSwitch = jdbcCard.locator('.ant-switch')
      await expect(javaSwitch).toHaveAttribute('aria-checked', 'true')
      await javaSwitch.click()
      await jdbcCard.evaluate((node) => {
        const content = node.closest<HTMLElement>('.settings-content')
        content?.scrollTo({ left: content.scrollWidth })
      })
      await jdbcCard.locator('.ant-btn-primary').click()

      const restartButton = page.getByRole('button', { name: '确认并重启服务' })
      await expect(restartButton).toBeVisible({ timeout: 10000 })
      await restartButton.click()

      await expect
        .poll(
          () => page.evaluate(() => window.api.getBackendStatus().then((status) => status.state)),
          { timeout: 30000 }
        )
        .toBe('online')
      await expect(modal).toBeVisible()
      await expect(page.locator('.app-shell')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('driver manager selected type should not render an indicator bar @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click()
      const modal = page.locator('.settings-window-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByRole('menuitem', { name: '驱动管理' }).click()

      const selectedType = modal.locator('.driver-manager-nav-item.active')
      await expect(selectedType).toBeVisible({ timeout: 10000 })
      const indicator = await selectedType.evaluate((node) => {
        const before = window.getComputedStyle(node, '::before')
        const title = node.querySelector('.driver-manager-nav-copy .ant-typography')
        return {
          indicatorContent: before.content,
          titleColor: title ? window.getComputedStyle(title).color : null
        }
      })

      expect(
        indicator.indicatorContent,
        'selected driver type should not render an indicator bar'
      ).toBe('none')
      expect(
        indicator.titleColor,
        'selected driver type title should retain an accent color'
      ).not.toBeNull()
    } finally {
      await electronApp.close()
    }
  })

  test('startup splash card should not render an outer rectangular shadow @bug', async () => {
    const electronApp = await launchRegressionAppWithSplash()

    try {
      await expect.poll(() => electronApp.windows().length, { timeout: 5000 }).toBeGreaterThan(1)

      const splashPage = electronApp
        .windows()
        .find((window) => window.url().startsWith('data:text/html'))
      expect(splashPage).toBeDefined()

      const splashCard = splashPage.locator('.card')
      await expect(splashCard).toBeVisible()
      const styles = await splashCard.evaluate((node) => {
        const card = window.getComputedStyle(node)
        const body = window.getComputedStyle(document.body)
        return { boxShadow: card.boxShadow, bodyBackground: body.backgroundColor }
      })

      expect(styles.boxShadow).toBe('none')
      expect(styles.bodyBackground).toBe('rgba(0, 0, 0, 0)')
    } finally {
      await electronApp.close()
    }
  })

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
      await expect(
        treeNode(page, `db-object:${fixtureConnectionId}:::view:active_large_items`)
      ).toBeVisible({ timeout: 30000 })
      expect(openViewsMs, 'tree expand is too slow while workspaces are open').toBeLessThan(700)

      const closeViewsMs = await toggleTreeNode(page, `object-group:${fixtureConnectionId}:::view`)
      console.log(`[perf][tree-toggle][view-close] ${closeViewsMs}`)
      await expect(
        treeNode(page, `db-object:${fixtureConnectionId}:::view:active_large_items`)
      ).toHaveCount(0)
      expect(closeViewsMs, 'tree collapse is too slow while workspaces are open').toBeLessThan(700)
    } finally {
      await electronApp.close()
    }
  })

  test('opening a table should not repeatedly rebuild workspace and ai dock content @bug', async () => {
    test.skip(!process.env.CI, 'pixel sampling repaints a visible local Electron window')
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
      await settlePreviewWhereChrome(page)
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
      expect(
        openTableHashes.tableHeader?.unique.length ?? 0,
        'opening one table should settle the table header without repeated flicker'
      ).toBeLessThanOrEqual(2)
      expect(
        openTableHashes.whereShell?.unique.length ?? 0,
        'opening one table should settle the where row without repeated flicker'
      ).toBeLessThanOrEqual(2)
      expect(
        openTableHashes.aiHeader?.unique.length ?? 0,
        'opening one table should not make the ai dock header flicker after first paint'
      ).toBeLessThanOrEqual(1)
      expect(
        counters.workspaceMutations,
        'opening one table should not repeatedly rebuild the workspace content'
      ).toBeLessThan(220)
      expect(
        counters.aiPanelMutations,
        'opening one table should not repeatedly rebuild the ai dock content'
      ).toBeLessThan(80)
      expect(
        aiCounters.contextStats,
        'opening one table should not repeatedly trigger ai context stats'
      ).toBeLessThanOrEqual(1)
      expect(
        visualSamples.every((sample) => sample.hasTableHeader),
        'opening one table should not lose the table header after it becomes visible'
      ).toBe(true)
      expect(
        visualSamples.every((sample) => !sample.hasLoadingOverlay),
        'opening one table should not flash the loading overlay after the table is visible'
      ).toBe(true)
      expect(
        visualSamples.every((sample) => sample.visibleRows > 0),
        'opening one table should not fall back to an empty content frame'
      ).toBe(true)
      expect(
        Math.max(...visualSamples.map((sample) => sample.shellHeight)) -
          Math.min(...visualSamples.map((sample) => sample.shellHeight)),
        'opening one table should not keep resizing the result shell after first paint'
      ).toBeLessThanOrEqual(1)
      expect(
        Math.max(...visualSamples.map((sample) => sample.shellTop)) -
          Math.min(...visualSamples.map((sample) => sample.shellTop)),
        'opening one table should not visibly shift the result shell vertically after first paint'
      ).toBeLessThanOrEqual(1)
      expect(
        Math.max(...visualSamples.map((sample) => sample.aiPanelWidth)) -
          Math.min(...visualSamples.map((sample) => sample.aiPanelWidth)),
        'opening one table should not visibly resize the ai dock after first paint'
      ).toBeLessThanOrEqual(1)
      expect(
        Math.max(...visualSamples.map((sample) => sample.aiPanelLeft)) -
          Math.min(...visualSamples.map((sample) => sample.aiPanelLeft)),
        'opening one table should not visibly shift the ai dock after first paint'
      ).toBeLessThanOrEqual(1)

      await removeOpenTableRenderCounters(page)
      await removeAiContextStatsCounter(page)
    } finally {
      await electronApp.close()
    }
  })

  test('opening and selecting in table should not cause repeated visual mutations @bug', async () => {
    test.skip(!process.env.CI, 'pixel sampling repaints a visible local Electron window')
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
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
        timeout: 30000
      })

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
          first: { x: firstRect.x + firstRect.width / 2, y: firstRect.y + firstRect.height / 2 },
          second: {
            x: secondRect.x + secondRect.width / 2,
            y: secondRect.y + secondRect.height / 2
          },
          row: { x: rowRect.x + rowRect.width / 2, y: rowRect.y + rowRect.height / 2 },
          column: { x: colRect.x + colRect.width / 2, y: colRect.y + colRect.height / 2 }
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
      await settlePreviewWhereChrome(page)

      const clips = await readStableChromeClips(page)
      const hashes = await sampleClipHashes(page, clips)

      const counters = await readVisualMutationCounters(page)
      const aiCounters = await readAiContextStatsCounter(page)
      console.log(`[perf][visual-mutations] ${JSON.stringify(counters)}`)
      console.log(`[perf][interaction][ai-context-stats] ${JSON.stringify(aiCounters)}`)
      console.log(`[perf][interaction][visual-hashes] ${JSON.stringify(hashes)}`)
      expect(counters).not.toBeNull()
      expect(aiCounters).not.toBeNull()
      expect(
        counters.aiClassMutations + counters.aiStyleMutations,
        'table interactions should not keep restyling the ai dock'
      ).toBeLessThan(8)
      expect(
        counters.tableShellClassMutations + counters.tableShellStyleMutations,
        'table interactions should avoid excessive result shell restyling'
      ).toBeLessThan(40)
      expect(
        aiCounters.contextStats,
        'table interactions should not trigger ai context stats'
      ).toBe(0)
      expect(
        hashes.tableHeader?.unique.length ?? 0,
        'table header should settle quickly during selection interactions'
      ).toBeLessThanOrEqual(2)
      expect(
        hashes.whereShell?.unique.length ?? 0,
        'where row should settle quickly during selection interactions'
      ).toBeLessThanOrEqual(2)
      expect(
        hashes.aiHeader?.unique.length ?? 0,
        'ai header should stay visually stable during selection interactions'
      ).toBeLessThanOrEqual(1)

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
      await expect(activeResult.locator('.result-table .row-number-button').first()).toBeVisible({
        timeout: 30000
      })

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

        const frame = () =>
          new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        const startedAt = performance.now()
        for (const button of buttons) {
          const rect = button.getBoundingClientRect()
          const clientX = rect.x + rect.width / 2
          const clientY = rect.y + rect.height / 2
          button.dispatchEvent(
            new MouseEvent('mousedown', {
              button: 0,
              buttons: 1,
              bubbles: true,
              cancelable: true,
              clientX,
              clientY
            })
          )
          body.dispatchEvent(
            new MouseEvent('mouseup', {
              button: 0,
              buttons: 0,
              bubbles: true,
              cancelable: true,
              clientX,
              clientY
            })
          )
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
      expect(
        metrics.selectedButtons,
        'rapid row selection should leave one visible row button selected'
      ).toBeGreaterThan(0)
      expect(aiCounters).not.toBeNull()
      expect(
        aiCounters.contextStats,
        'rapid row selection should not trigger ai context stats'
      ).toBe(0)
      await removeVisualMutationCounters(page)
      await removeAiContextStatsCounter(page)
      expect(counters).not.toBeNull()
      expect(
        counters.tableShellClassMutations + counters.tableShellStyleMutations,
        'rapid row clicks should not keep restyling the result shell'
      ).toBeLessThan(30)
      expect(
        counters.aiClassMutations + counters.aiStyleMutations,
        'rapid row clicks should not restyle the ai dock'
      ).toBeLessThan(6)

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

      expect(typingMetrics.average, 'sql editor average typing latency is too high').toBeLessThan(
        80
      )
      expect(typingMetrics.max, 'sql editor max typing latency is too high').toBeLessThan(450)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('sql editor typing should stay responsive with many statement execute buttons @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.insertText(
        Array.from({ length: 160 }, (_, index) => `select ${index} as value;`).join('\n')
      )
      await page.waitForTimeout(300)

      const durations = []
      for (const character of ' -- typing') {
        const startedAt = Date.now()
        await page.keyboard.type(character)
        durations.push(Date.now() - startedAt)
      }
      const average = durations.reduce((sum, value) => sum + value, 0) / durations.length
      expect(average, 'statement execute decorations should not delay typing').toBeLessThan(80)
      expect(
        Math.max(...durations),
        'statement execute decorations should not block typing'
      ).toBeLessThan(450)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('canceling a stream request should not surface an AbortError @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)

      const result = await page.evaluate(async () => {
        const streamId = `cancel-regression-${crypto.randomUUID()}`
        const request = window.api.streamRequest(
          streamId,
          '/health',
          { method: 'GET' },
          () => undefined
        )
        await window.api.cancelStreamRequest(streamId)
        try {
          await request
          return { error: null }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      })

      expect(
        result.error,
        'canceling a stream request should resolve without an AbortError'
      ).toBeNull()
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('completed AI stream should persist final tokens across app reload @bug', async () => {
    const electronApp = await launchRegressionApp({
      aiStreamEvents: [
        ...['完整', '回复', '必须', '保留', '最后', '一段'].map((content) => ({
          type: 'token',
          content
        })),
        { type: 'done', finish_reason: 'stop' }
      ]
    })
    let page
    let originalAIState

    try {
      page = await electronApp.firstWindow()
      await waitForAppReady(page)
      originalAIState = await page.evaluate(async () => ({
        configs: await window.api.getAIConfigs(),
        sessions: await window.api.getAISessions()
      }))
      await page.evaluate(async () => {
        await window.api.setAIConfigs([
          {
            id: 'ai-stream-persistence-regression',
            name: 'AI stream persistence regression',
            enabled: true,
            provider: 'openai-compatible',
            base_url: 'https://example.com/v1',
            api_key: 'test-key',
            model: 'test-model',
            max_context_tokens: 200000
          }
        ])
        await window.api.setAISessions([])
      })
      await page.reload()
      await waitForAppReady(page)

      const expectedReply = '完整回复必须保留最后一段'

      const input = page.getByPlaceholder('输入问题')
      await input.fill('测试 AI 回复持久化')
      await input.press('Enter')
      const assistantMessage = page.locator('.ai-message-assistant').last()
      await expect(assistantMessage).toContainText(expectedReply, { timeout: 10000 })
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const sessions = await window.api.getAISessions()
              return sessions[0]?.messages.at(-1)?.content ?? ''
            }),
          { timeout: 10000 }
        )
        .toBe(expectedReply)

      await page.reload()
      await waitForAppReady(page)
      await expect(page.locator('.ai-message-assistant').last()).toContainText(expectedReply, {
        timeout: 10000
      })
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      if (page && originalAIState) {
        await page.evaluate(async (state) => {
          await window.api.setAIConfigs(state.configs)
          await window.api.setAISessions(state.sessions)
        }, originalAIState)
      }
      await electronApp.close()
    }
  })

  test('sql completion should stay near the cursor and exclude statement templates @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, 'small_items')
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select ')
      await page.keyboard.press('Control+Space')

      const suggestWidget = page.locator('.suggest-widget.visible')
      await expect(suggestWidget).toBeVisible({ timeout: 10000 })
      await expect(suggestWidget).not.toContainText('create-table')
      await expect(suggestWidget).not.toContainText('select-limit')
      await expect(page.locator('.monaco-editor .ghost-text')).toHaveCount(0)

      const position = await page.evaluate(() => {
        const cursor = document.querySelector('.sql-editor-container .monaco-editor .cursor')
        const widget = document.querySelector('.suggest-widget.visible')
        if (!(cursor instanceof HTMLElement) || !(widget instanceof HTMLElement)) {
          return null
        }
        const cursorRect = cursor.getBoundingClientRect()
        const widgetRect = widget.getBoundingClientRect()
        return {
          horizontalOffset: Math.abs(widgetRect.left - cursorRect.left),
          verticalOffset: widgetRect.top - cursorRect.bottom
        }
      })
      expect(position, 'sql completion widget should be measurable').not.toBeNull()
      expect(position.horizontalOffset, 'sql completion should align with the cursor').toBeLessThan(
        80
      )
      expect(position.verticalOffset, 'sql completion should open beside the cursor').toBeLessThan(
        80
      )

      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select * from ')
      await page.keyboard.press('Control+Space')
      await expect(suggestWidget).toContainText('extra_items_01')

      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select  from small_items')
      await page.keyboard.press('Control+Home')
      for (let index = 0; index < 7; index += 1) {
        await page.keyboard.press('ArrowRight')
      }
      await page.keyboard.press('Control+Space')
      await expect(suggestWidget).toContainText('id', { timeout: 10000 })
      await expect(suggestWidget).toContainText('name')
      await expect(suggestWidget).not.toContainText('description')

      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select name from small_items where ')
      await expect(suggestWidget).toContainText('id', { timeout: 10000 })
      await expect(suggestWidget).toContainText('name')
      await expect(suggestWidget).not.toContainText('description')
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
      await expect
        .poll(
          async () => {
            return readActiveStatementIndex(page)
          },
          { timeout: 10000 }
        )
        .toBe(0)

      await moveCaretToLineEnd(page, 2)
      await expect
        .poll(
          async () => {
            return readActiveStatementIndex(page)
          },
          { timeout: 10000 }
        )
        .toBe(1)

      await moveCaretToLineEnd(page, 2)
      await expect
        .poll(
          async () => {
            return readActiveStatementIndex(page)
          },
          { timeout: 10000 }
        )
        .toBe(1)

      const switchDurations = []
      for (let index = 0; index < 4; index += 1) {
        const startedAt = Date.now()
        await moveCaretToLineEnd(page, 1)
        await expect
          .poll(
            async () => {
              return readActiveStatementIndex(page)
            },
            { timeout: 10000 }
          )
          .toBe(0)
        switchDurations.push(Date.now() - startedAt)

        const nextStartedAt = Date.now()
        await moveCaretToLineEnd(page, 2)
        await expect
          .poll(
            async () => {
              return readActiveStatementIndex(page)
            },
            { timeout: 10000 }
          )
          .toBe(1)
        switchDurations.push(Date.now() - nextStartedAt)
      }

      const maxSwitchMs = Math.max(...switchDurations, 0)
      const averageSwitchMs =
        switchDurations.reduce((sum, value) => sum + value, 0) / Math.max(switchDurations.length, 1)
      console.log(
        `[perf][sql-editor][active-statement-switch] ${JSON.stringify({ averageSwitchMs, maxSwitchMs, samples: switchDurations.length })}`
      )
      expect(
        averageSwitchMs,
        'sql active statement average switch latency is too high'
      ).toBeLessThan(450)
      expect(maxSwitchMs, 'sql active statement max switch latency is too high').toBeLessThan(1200)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('sql active statement should ignore delimiters inside strings, comments, and procedural blocks @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        "select 'semi; colon';\n# mysql-style comment ;\nDO $$ BEGIN PERFORM 1; END $$;\nselect 2;"
      )

      await moveCaretToLineEnd(page, 2)
      await expect.poll(async () => readActiveStatementIndex(page), { timeout: 10000 }).toBe(2)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('sql statement execute button should execute its own statement @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type("select\n  'first' as value\nselect\n  'second' as value")
      await expect(page.locator('.sql-editor-statement-execute')).toHaveCount(2, { timeout: 10000 })

      const executeButtons = await page
        .locator('.sql-editor-statement-execute')
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const rect = node.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          })
        )
      expect(executeButtons).toHaveLength(2)
      expect(
        executeButtons[1].y,
        'second statement execute button should be on the second statement first line'
      ).toBeGreaterThan(executeButtons[0].y + 5)
      expect(executeButtons[1].y - executeButtons[0].y).toBeLessThan(40)

      const executeButton = executeButtons[1]
      if (executeButton.width <= 0 || executeButton.height <= 0) {
        throw new Error('Second statement execute button is not measurable')
      }
      await page.mouse.click(
        executeButton.x + executeButton.width / 2,
        executeButton.y + executeButton.height / 2
      )

      await expect(page.locator('.query-execute-dropdown .ant-dropdown-menu')).toHaveCount(0)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-tbody')).toContainText('second', {
        timeout: 30000
      })
      await expect(activeResult.locator('.result-table .ant-table-tbody')).not.toContainText(
        'first'
      )
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('executing selected multiple sql statements should report each result in order @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type("select 'first' as value;\nselect 'second' as value;")
      await page.keyboard.press('Control+A')
      await page.locator('.query-execute-button').click()

      const results = page.locator('[data-testid="multi-statement-results"]')
      await expect(results).toBeVisible({ timeout: 30000 })
      await expect(results).toContainText('SQL 1')
      await expect(results).toContainText('SQL 2')
      await expect(results).toContainText('first')
      await expect(results).toContainText('second')
      await expect(results.locator('.query-execution-card')).toHaveCount(2)
      await expect(results.locator('.query-execution-sql')).toHaveCount(2)

      const itemOrder = await results.locator('.query-multi-execution-item').evaluateAll((nodes) =>
        nodes.map((node) => node.textContent ?? '')
      )
      expect(itemOrder).toHaveLength(2)
      expect(itemOrder[0]).toContain('first')
      expect(itemOrder[1]).toContain('second')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('multiple command statements should show compact status without an empty result table @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        'CREATE TABLE multi_statement_probe (id INTEGER);\nINSERT INTO multi_statement_probe VALUES (1);\nDROP TABLE multi_statement_probe;'
      )
      await page.keyboard.press('Control+A')
      await page.locator('.query-execute-button').click()

      const results = page.locator('[data-testid="multi-statement-results"]')
      await expect(results).toBeVisible({ timeout: 30000 })
      await expect(results.locator('.query-multi-execution-item')).toHaveCount(3)
      await expect(results.locator('.query-execution-card')).toHaveCount(3)
      await expect(results.locator('.query-execution-sql')).toHaveCount(3)
      await expect(results).toContainText('影响数据')
      await expect(results.locator('.query-multi-execution-grid')).toHaveCount(0)
      await expect(page.locator('.result-table-content')).toHaveCount(0)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('executing from a closed connection should show the opening phase immediately @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const connectionNode = treeNode(page, `connection:${fixtureConnectionId}`)
      const connectionNodeBox = await connectionNode.boundingBox()
      expect(connectionNodeBox).not.toBeNull()
      await page.mouse.click(
        connectionNodeBox.x + Math.min(connectionNodeBox.width - 12, 120),
        connectionNodeBox.y + connectionNodeBox.height / 2,
        { button: 'right' }
      )
      await page
        .locator('.tree-context-menu-panel .ant-menu-item')
        .filter({ hasText: '关闭连接' })
        .first()
        .click()
      await expect(connectionNode).toHaveClass(/is-closed/, { timeout: 15000 })

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.insertText("select 'opening_phase' as value;")

      await page.evaluate(() => {
        const button = document.querySelector('.query-execute-button')
        if (!(button instanceof HTMLElement)) {
          throw new Error('query execute button not found')
        }
        const phases: string[] = []
        const record = () => {
          const phase = button.getAttribute('data-query-execution-phase')
          if (phase) {
            phases.push(phase)
          }
        }
        record()
        const observer = new MutationObserver(record)
        observer.observe(button, { attributes: true, childList: true, subtree: true })
        ;(window as typeof window & { __queryExecutionPhases?: string[] }).__queryExecutionPhases = phases
        window.setTimeout(() => observer.disconnect(), 10000)
      })

      await page.locator('.query-execute-button').click()
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as typeof window & { __queryExecutionPhases?: string[] })
                  .__queryExecutionPhases ?? []
            ),
          { timeout: 10000 }
        )
        .toContain('opening-connection')
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as typeof window & { __queryExecutionPhases?: string[] })
                  .__queryExecutionPhases ?? []
            ),
          { timeout: 30000 }
        )
        .toContain('executing')
      await expect(page.locator('.result-table .ant-table-tbody')).toContainText('opening_phase', {
        timeout: 30000
      })
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('executed query history should restore sql after app restart @bug', async () => {
    let electronApp
    let reopenedApp

    try {
      electronApp = await launchRegressionApp()
      let page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await page.evaluate(() => localStorage.setItem('datadjinn-query-workspaces', '[]'))
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await openFixtureConnection(page)
      await openQueryWorkspace(page)
      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.insertText('select 123 as persisted_value;')
      await page.locator('.query-execute-button').click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-tbody')).toContainText(
        '123',
        { timeout: 30000 }
      )

      await electronApp.close()
      electronApp = undefined

      reopenedApp = await launchRegressionApp()
      page = await reopenedApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await page.locator('.app-header .toolbar-icon-btn[aria-label="历史查询窗口"]').click()

      const historyItem = page.locator('.query-history-item').filter({ hasText: 'persisted_value' })
      await expect(historyItem).toBeVisible({ timeout: 30000 })
      await historyItem.dblclick()

      const editor = page.locator('.sql-editor-container .view-lines').first()
      await expect(editor).toContainText('select 123 as persisted_value;', { timeout: 30000 })
    } finally {
      if (electronApp) {
        await electronApp.close()
      }
      if (reopenedApp) {
        await reopenedApp.close()
      }
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

      const previewSearchToggle = page
        .locator(
          '.workspace-tab-panels .workspace-active-content .table-data-toolbar .table-toolbar-toggle'
        )
        .first()
      const searchBar = page.locator(
        '.workspace-tab-panels .workspace-active-content .result-table-search-overlay .table-search-bar'
      )
      await expect(previewSearchToggle).toBeVisible({ timeout: 30000 })
      const searchOpenStartedAt = Date.now()
      await previewSearchToggle.click()
      await expect(searchBar).toBeVisible({ timeout: 10000 })
      const searchOpenMs = Date.now() - searchOpenStartedAt
      console.log(`[perf][table-search][button-open] ${searchOpenMs}`)
      expect(searchOpenMs, 'table search bar opens too slowly').toBeLessThan(700)
      const searchPosition = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => {
          const shell = node.querySelector('.result-table-header-shell')
          const toolbar = node.querySelector('.table-data-toolbar')
          const search = node.querySelector('.result-table-search-overlay .table-search-bar')
          if (
            !(shell instanceof HTMLElement) ||
            !(toolbar instanceof HTMLElement) ||
            !(search instanceof HTMLElement)
          ) {
            return null
          }
          const shellRect = shell.getBoundingClientRect()
          const toolbarRect = toolbar.getBoundingClientRect()
          const searchRect = search.getBoundingClientRect()
          return {
            centerDelta: Math.abs(
              searchRect.left + searchRect.width / 2 - (shellRect.left + shellRect.width / 2)
            ),
            topGap: searchRect.top - toolbarRect.bottom
          }
        })
      expect(searchPosition).not.toBeNull()
      expect(
        searchPosition.centerDelta,
        'table search row should stay horizontally centered'
      ).toBeLessThanOrEqual(12)
      expect(
        searchPosition.topGap,
        'table search row should render below the toolbar instead of jumping to the corner'
      ).toBeGreaterThanOrEqual(0)
      const searchCloseStartedAt = Date.now()
      await page.keyboard.press('Escape')
      await expect(searchBar).not.toBeVisible({ timeout: 10000 })
      const searchCloseMs = Date.now() - searchCloseStartedAt
      console.log(`[perf][table-search][button-close] ${searchCloseMs}`)
      expect(searchCloseMs, 'table search bar closes too slowly').toBeLessThan(250)

      await page
        .locator('.workspace-tab-panels .workspace-active-content .result-table-content')
        .click()
      await page.keyboard.press('Control+F')
      await expect(searchBar).toBeVisible({ timeout: 10000 })
      const shortcutCloseStartedAt = Date.now()
      await page.keyboard.press('Escape')
      await expect(searchBar).not.toBeVisible({ timeout: 10000 })
      const shortcutCloseMs = Date.now() - shortcutCloseStartedAt
      console.log(`[perf][table-search][shortcut-close] ${shortcutCloseMs}`)
      expect(shortcutCloseMs, 'table search bar shortcut close is too slow').toBeLessThan(250)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('preview where field should only suggest active column prefixes and preserve Enter query @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      const whereField = page.locator('.preview-where-field input')
      await expect(whereField).toBeVisible({ timeout: 30000 })
      await whereField.focus()
      await expect(page.locator('.preview-where-option')).toHaveCount(0)

      await whereField.fill('WHERE ')
      await expect(page.locator('.preview-where-option')).toHaveCount(0)

      await whereField.fill('name = ')
      await expect(page.locator('.preview-where-option')).toHaveCount(0)
      await whereField.fill('na')
      const nameOption = page.locator('.preview-where-option').filter({ hasText: 'name' }).first()
      await expect(nameOption).toBeVisible()
      const suggestionPosition = await nameOption.boundingBox()
      expect(
        suggestionPosition,
        'where completion option should not be clipped by its toolbar'
      ).not.toBeNull()

      await whereField.fill("name = 'alpha'")
      await expect(page.locator('.preview-where-option')).toHaveCount(0)
      await whereField.press('Enter')
      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-tbody')).toContainText('alpha', {
        timeout: 30000
      })
      await expect(activeResult.locator('.result-table .ant-table-tbody')).not.toContainText('beta')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('filtered preview row deletion should create a pending deletion draft @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const rowNumbers = activeResult.locator('.result-table .row-number-button')
      await expect(rowNumbers.nth(1)).toBeVisible({ timeout: 30000 })
      await rowNumbers.nth(1).click()

      const whereField = activeResult.locator('.preview-where-field input')
      await whereField.fill("name = 'alpha'")
      await whereField.press('Enter')
      await expect(activeResult.locator('.result-table .ant-table-tbody')).toContainText('alpha', {
        timeout: 30000
      })
      await expect(activeResult.locator('.result-table .ant-table-tbody')).not.toContainText('beta')

      const filteredRowNumber = activeResult.locator('.result-table .row-number-button').first()
      await filteredRowNumber.click()
      const deleteButton = activeResult.locator(
        '.table-toolbar-inline-actions [aria-label="删除选中行"]'
      )
      const saveButton = activeResult.locator('.table-toolbar-inline-actions [aria-label="提交"]')
      await expect(deleteButton).toBeEnabled()
      await deleteButton.click()

      await expect(activeResult.locator('.result-table .row-deleted')).toHaveCount(1, {
        timeout: 10000
      })
      await expect(saveButton).toBeEnabled()
      await expect(saveButton).toHaveClass(/is-pending-save/)
      await expect(
        activeResult.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toContainText('未提交')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('sql identifier with an implicit statement keyword prefix should not split a query @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        "select alert_name, merge_id from xuanji_dwd.dwd_dayu_alert_alert_info\nwhere merge_id = 'a2d8ddcd70eb62bc18398a3ac34a8642'"
      )
      await expect(page.locator('.sql-editor-statement-execute')).toHaveCount(1, { timeout: 10000 })
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('sql comments should not create executable statements or break formatted queries @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await expect(page.locator('.sql-editor-statement-execute')).toHaveCount(0, { timeout: 10000 })

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type('-- 只有一行注释')
      await expect(page.locator('.sql-editor-statement-execute')).toHaveCount(0, { timeout: 10000 })

      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        'SELECT\n  id, -- 字段说明\n  name\nFROM small_items\nWHERE id = 1; -- 末尾说明'
      )
      await expect(page.locator('.sql-editor-statement-execute')).toHaveCount(1, { timeout: 10000 })

      const statementPosition = await page
        .locator('.sql-editor-container')
        .evaluate((container) => {
          const selectLine = Array.from(container.querySelectorAll('.view-lines > div')).find(
            (line) => (line.textContent ?? '').trim() === 'SELECT'
          )
          const executeButton = container.querySelector('.sql-editor-statement-execute')
          return {
            selectY: selectLine?.getBoundingClientRect().y,
            executeY: executeButton?.getBoundingClientRect().y
          }
        })
      expect(statementPosition.selectY).toBeDefined()
      expect(statementPosition.executeY).toBeDefined()
      expect(Math.abs(statementPosition.executeY - statementPosition.selectY)).toBeLessThan(3)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.locator('.query-execute-button').first().click()
      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-tbody')).toContainText('alpha', {
        timeout: 30000
      })
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('query toolbar format button should format current SQL and full selection @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const formatButton = page.getByRole('button', { name: '格式化 SQL' })
      const executeButton = page.locator('.query-execute-button').first()
      await expect(formatButton).toBeVisible({ timeout: 30000 })
      const positions = await Promise.all([formatButton.boundingBox(), executeButton.boundingBox()])
      expect(positions[0]).not.toBeNull()
      expect(positions[1]).not.toBeNull()
      expect(positions[0].x + positions[0].width).toBeLessThanOrEqual(positions[1].x + 2)
      const toolbarMetrics = await page.evaluate(() => {
        const queryButton = document.querySelector<HTMLElement>('.toolbar-query-btn')
        const connectionButton = document.querySelector<HTMLElement>('.resource-add')
        const formatButton = document.querySelector<HTMLElement>('.query-format-button')
        const executeSplit = document.querySelector<HTMLElement>('.query-execute-split')
        const executeButton = document.querySelector<HTMLElement>('.query-execute-button')
        if (!queryButton || !connectionButton || !formatButton || !executeSplit || !executeButton) {
          return null
        }
        return {
          queryRadius: getComputedStyle(queryButton).borderTopLeftRadius,
          connectionRadius: getComputedStyle(connectionButton).borderTopLeftRadius,
          formatBorderWidth: getComputedStyle(formatButton).borderTopWidth,
          splitRadius: getComputedStyle(executeSplit).borderTopLeftRadius,
          executeRadius: getComputedStyle(executeButton).borderTopRightRadius
        }
      })
      expect(toolbarMetrics).not.toBeNull()
      expect(toolbarMetrics.queryRadius).toBe(toolbarMetrics.connectionRadius)
      expect(toolbarMetrics.formatBorderWidth).toBe('0px')
      expect(toolbarMetrics.splitRadius).toBe('8px')
      expect(toolbarMetrics.executeRadius).toBe('8px')

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select * from small_items where id=2')
      const statementToggle = page.getByRole('button', { name: '选择执行语句' })
      await expect(statementToggle).toBeVisible({ timeout: 10000 })
      await expect
        .poll(
          () =>
            page
              .locator('.query-execute-button')
              .evaluate((button) =>
                Math.round(Number.parseFloat(getComputedStyle(button).borderTopRightRadius))
              ),
          { timeout: 10000 }
        )
        .toBe(0)
      const splitMetrics = await page.evaluate(() => {
        const split = document.querySelector<HTMLElement>('.query-execute-split.has-statement-menu')
        const executeButton = document.querySelector<HTMLElement>('.query-execute-button')
        const dropdownButton = document.querySelector<HTMLElement>('.query-execute-dropdown-button')
        if (!split || !executeButton || !dropdownButton) {
          return null
        }
        const executeRect = executeButton.getBoundingClientRect()
        const dropdownRect = dropdownButton.getBoundingClientRect()
        return {
          executeRadius: getComputedStyle(executeButton).borderTopRightRadius,
          dropdownRadius: getComputedStyle(dropdownButton).borderTopRightRadius,
          splitGap: dropdownRect.left - executeRect.right
        }
      })
      expect(splitMetrics).not.toBeNull()
      expect(Number.parseFloat(splitMetrics.executeRadius)).toBeLessThan(0.1)
      expect(splitMetrics.dropdownRadius).toBe('8px')
      expect(splitMetrics.splitGap).toBeLessThanOrEqual(1)
      await page.keyboard.press('Control+Home')
      await formatButton.click()
      await expect
        .poll(
          () =>
            page
              .locator('.sql-editor-container .view-lines > div')
              .evaluateAll((nodes) =>
                nodes.map((node) => (node.textContent ?? '').replace(/\u00a0/g, ' '))
              ),
          { timeout: 10000 }
        )
        .toEqual(expect.arrayContaining(['SELECT', '  *', 'FROM', '  small_items', 'WHERE']))
      const currentStatementPosition = await page
        .locator('.sql-editor-container')
        .evaluate((container) => ({
          firstLineY: container.querySelector('.view-lines > div')?.getBoundingClientRect().y,
          executeY: container
            .querySelector('.sql-editor-statement-execute')
            ?.getBoundingClientRect().y
        }))
      expect(currentStatementPosition.firstLineY).toBeDefined()
      expect(currentStatementPosition.executeY).toBeDefined()
      expect(
        Math.abs(currentStatementPosition.executeY - currentStatementPosition.firstLineY),
        'execute button should stay on the current statement first line after formatting'
      ).toBeLessThan(3)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        'select id,name,(select count(*) from small_items where id=1) as total from small_items where id=1; select id,note from small_items where id=2;'
      )
      await page.keyboard.press('Control+A')
      await formatButton.click()

      await expect
        .poll(
          () =>
            page
              .locator('.sql-editor-container .view-lines > div')
              .evaluateAll((nodes) =>
                nodes.map((node) => (node.textContent ?? '').replace(/\u00a0/g, ' '))
              ),
          { timeout: 10000 }
        )
        .toEqual(
          expect.arrayContaining([
            'SELECT',
            '  id,',
            '  (',
            '    SELECT',
            '      count(*)',
            'FROM',
            'WHERE'
          ])
        )

      const statementPositions = await page
        .locator('.sql-editor-container')
        .evaluate((container) => {
          const linePositions = Array.from(container.querySelectorAll('.view-lines > div'))
            .map((node) => ({
              text: (node.textContent ?? '').replace(/\u00a0/g, ' '),
              y: node.getBoundingClientRect().y
            }))
            .filter((line) => line.text.trim() === 'SELECT')
          const executePositions = Array.from(
            container.querySelectorAll('.sql-editor-statement-execute')
          ).map((node) => node.getBoundingClientRect().y)
          return { linePositions, executePositions }
        })
      expect(statementPositions.linePositions).toHaveLength(3)
      expect(statementPositions.executePositions).toHaveLength(2)
      expect(
        Math.abs(statementPositions.executePositions[0] - statementPositions.linePositions[0].y),
        'first execute button should stay on the first statement first line after formatting'
      ).toBeLessThan(3)
      expect(
        Math.abs(statementPositions.executePositions[1] - statementPositions.linePositions[2].y),
        'second execute button should stay on the second statement first line after formatting'
      ).toBeLessThan(3)
      await expect(page.locator('.sql-editor-statement-format')).toHaveCount(0)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('invalid preview WHERE must not restart the backend or close its connection @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      await page.evaluate(() => {
        window.__backendStateEvents = []
        window.__stopBackendStateEvents = window.api.onBackendStatusChanged((status) => {
          window.__backendStateEvents.push(status.state)
        })
      })

      const whereField = page.locator('.preview-where-field input')
      await whereField.fill("name = 'unterminated")
      await whereField.press('Enter')

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-inline-alert')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(500)
      const backendStateEvents = await page.evaluate(() => {
        window.__stopBackendStateEvents?.()
        return window.__backendStateEvents
      })
      expect(
        backendStateEvents,
        'SQL syntax errors must not be mistaken for backend network failures'
      ).not.toContain('starting')
      await expect(
        page.locator(`.connection-tree-title[data-connection-id="${fixtureConnectionId}"]`)
      ).toHaveClass(/is-open/)

      await whereField.fill("name = 'alpha'")
      await whereField.press('Enter')
      await expect(activeResult.locator('.result-table .ant-table-tbody')).toContainText('alpha', {
        timeout: 30000
      })
      await expect(activeResult.locator('.result-table .ant-table-tbody')).not.toContainText('beta')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('CALL should highlight and complete stored procedures @bug', async () => {
    const electronApp = await launchRegressionApp({
      testRoutineNames: ['refresh_reporting_cache']
    })

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await page.locator(`.connection-tree-title[data-connection-id="${fixtureConnectionId}"]`).click()
      await page.waitForTimeout(250)
      await openQueryWorkspace(page)
      await expect(page.locator('.query-toolbar .connection-select')).toContainText('回归测试 SQLite')

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type('call ')
      await page.keyboard.type('refresh')
      const suggestWidget = page.locator('.suggest-widget.visible')
      await expect(suggestWidget).toContainText('refresh_reporting_cache', { timeout: 10000 })
      await expect(suggestWidget.locator('.monaco-list-row').first()).toContainText(
        'refresh_reporting_cache'
      )
      const callKeyword = page.locator('.sql-editor-container .sql-editor-call-keyword')
      await expect(callKeyword).toHaveText('call')
      await expect(callKeyword).toHaveCSS('color', 'rgb(197, 134, 192)')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('long query error should scroll inside the result region @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type(`SELECT * FROM missing_${'table_name_'.repeat(180)}`)
      await page.locator('.query-execute-button').first().click()

      const errorScroll = page.locator('.query-execution-error-scroll')
      await expect(errorScroll).toBeVisible({ timeout: 30000 })
      await expect
        .poll(
          () =>
            errorScroll.evaluate((element) => ({
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              overflowY: getComputedStyle(element).overflowY
            })),
          { timeout: 30000 }
        )
        .toMatchObject({ overflowY: 'auto' })
      const scrollMetrics = await errorScroll.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }))
      expect(scrollMetrics.scrollHeight, 'long error text should overflow its result area').toBeGreaterThan(
        scrollMetrics.clientHeight
      )
      await errorScroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
      await expect
        .poll(() => errorScroll.evaluate((element) => element.scrollTop), { timeout: 10000 })
        .toBeGreaterThan(0)
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
        timeout: 30000
      })

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
      expect(
        closedMetrics.gap,
        'query result pager and table should not leave an extra blank toolbar gap'
      ).toBeLessThanOrEqual(12)
      expect(
        closedMetrics.headerShellCount,
        'query result should not render an empty toolbar shell while search is closed'
      ).toBe(0)

      await activeResult.locator('.result-status-right .table-toolbar-toggle').click()
      const searchBar = activeResult.locator('.result-table-search-overlay .table-search-bar')
      await expect(searchBar).toBeVisible({ timeout: 10000 })

      const searchInput = searchBar.locator('input')
      await expect(searchInput).toBeVisible({ timeout: 10000 })
      await searchInput.fill('category_1')

      await expect
        .poll(
          async () => {
            return activeResult.locator('mark.table-search-highlight').count()
          },
          {
            timeout: 10000,
            message: 'typing into query result search should create visible highlighted matches'
          }
        )
        .toBeGreaterThan(0)

      await expect(searchBar.locator('.table-search-counter')).not.toHaveText('0/0')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('tree search should count and navigate all loaded node names plus connection addresses @bug', async () => {
    const fixtureUserDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(fixtureUserDataDir, 'connections.json')
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const templateConnection = connectionStore.connections.find(
      (item) => item.connection_id === fixtureConnectionId
    )
    if (!templateConnection) {
      throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
    }
    const searchConnections = [
      {
        id: 'regression-tree-search-first',
        name: 'Tree search name match',
        host: '10.88.0.10',
        port: 15432
      },
      {
        id: 'regression-tree-search-second',
        name: 'Tree search address match',
        host: '10.88.0.11',
        port: 25432
      }
    ]
    for (const connection of searchConnections) {
      if (!connectionStore.connections.some((item) => item.connection_id === connection.id)) {
        connectionStore.connections.push({
          ...templateConnection,
          connection_id: connection.id,
          name: connection.name,
          host: connection.host,
          port: connection.port
        })
      }
    }
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)

      await page.getByRole('button', { name: '搜索当前树' }).click()
      const searchControls = page.locator('.tree-search-controls')
      const searchInput = searchControls.locator('input')
      const counter = searchControls.locator('.tree-search-counter')
      const navigationButtons = searchControls.locator('button.tree-search-nav-btn')
      await expect(searchInput).toBeVisible({ timeout: 10000 })

      const expectedTableMatchCount = await page.locator('.table-tree-title').evaluateAll((nodes) =>
        nodes.filter((node) => (node.textContent ?? '').toLowerCase().includes('items')).length
      )
      expect(expectedTableMatchCount).toBeGreaterThan(0)
      const tableGroupKey = `object-group:${fixtureConnectionId}:::table`
      await toggleTreeNode(page, tableGroupKey)
      await expect(page.locator('.table-tree-title')).toHaveCount(0)

      await searchInput.fill('items')
      await expect(
        counter,
        'all loaded table nodes matching the search text should be counted'
      ).toHaveText(`1/${expectedTableMatchCount}`)
      await expect(
        page.locator('.table-tree-title mark.tree-search-highlight').first(),
        'searching a collapsed result must expand its path and scroll to the matched node'
      ).toBeVisible()
      await expect(
        page.locator('.ant-tree-node-content-wrapper.ant-tree-node-selected .table-tree-title')
      ).toContainText('items')

      await searchInput.fill('10.88.0.')
      await expect(counter).toHaveText('1/2')
      await expect(page.locator('.connection-tree-address mark.tree-search-highlight').first()).toBeVisible()

      const selectedConnectionId = async () =>
        page
          .locator('.ant-tree-node-content-wrapper.ant-tree-node-selected .connection-tree-title')
          .getAttribute('data-connection-id')
      const firstConnectionId = await selectedConnectionId()
      expect(searchConnections.map((connection) => connection.id)).toContain(firstConnectionId)
      const selectedConnectionNode = page.locator(
        '.ant-tree-node-content-wrapper.ant-tree-node-selected'
      )
      await expect(selectedConnectionNode).toHaveCSS('outline-style', 'none')
      await expect(selectedConnectionNode).not.toHaveCSS('background-image', 'none')

      const highlights = page.locator('mark.tree-search-highlight')
      await expect(highlights.first()).toHaveCSS('font-weight', '700')
      await expect(highlights.first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

      await navigationButtons.nth(1).click()
      await expect(counter).toHaveText('2/2')
      await expect
        .poll(selectedConnectionId, {
          timeout: 10000,
          message: 'next search result should select the next matching connection'
        })
        .not.toBe(firstConnectionId)

      await navigationButtons.nth(0).click()
      await expect(counter).toHaveText('1/2')
      await expect
        .poll(selectedConnectionId, {
          timeout: 10000,
          message: 'previous search result should restore the prior matching connection'
        })
        .toBe(firstConnectionId)

      await searchInput.fill('Tree search name')
      await expect(counter).toHaveText('1/1')
      await expect(page.locator('.connection-tree-name mark.tree-search-highlight')).toBeVisible()

      await searchInput.fill('15432')
      await expect(counter).toHaveText('1/1')
      await expect(page.locator('.connection-tree-address mark.tree-search-highlight')).toBeVisible()
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('tree search should not scroll back to the current result when tree nodes toggle @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      await page.getByRole('button', { name: '搜索当前树' }).click()
      const searchInput = page.locator('.tree-search-controls input')
      await searchInput.fill('SQLite')
      await expect(page.locator('.tree-search-counter')).toHaveText('1/1')

      await page.evaluate(() => {
        const original = Element.prototype.scrollIntoView
        const calls = []
        Element.prototype.scrollIntoView = function (...args) {
          if (this.classList.contains('tree-search-highlight')) {
            calls.push(args)
          }
          return original.apply(this, args)
        }
        window.__treeSearchScrollSpy = { calls, original }
      })

      const tableGroupKey = `object-group:${fixtureConnectionId}:::table`
      await toggleTreeNode(page, tableGroupKey)
      await page.waitForTimeout(250)
      await toggleTreeNode(page, tableGroupKey)
      await page.waitForTimeout(250)

      const searchScrollCalls = await page.evaluate(() => {
        const spy = window.__treeSearchScrollSpy
        if (spy) {
          Element.prototype.scrollIntoView = spy.original
        }
        delete window.__treeSearchScrollSpy
        return spy?.calls.length ?? 0
      })
      expect(
        searchScrollCalls,
        'expanding or collapsing tree nodes must not relocate the view to the current search result'
      ).toBe(0)
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
        const editableCell = activePane?.querySelector(
          '.result-table .editable-cell[data-cell-column-key="payload"]'
        )
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
      expect(
        overflowMetrics.scrollWidth,
        'cell text should overflow internally for ellipsis'
      ).toBeGreaterThan(overflowMetrics.clientWidth)
      expect(
        overflowMetrics.textWidth,
        'rendered text box should stay within cell width'
      ).toBeLessThanOrEqual(overflowMetrics.cellWidth)
      expect(
        overflowMetrics.cellWidth,
        'default preview column width should not expand for long cell content'
      ).toBeLessThanOrEqual(182)
    } finally {
      await electronApp.close()
    }
  })

  test('single-column sql query should expand the value column while keeping ellipsis for overflow @smoke', async () => {
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
      await page.keyboard.type('select payload from large_items limit 1;')

      const executeButton = page.getByRole('button', { name: /执行/i }).first()
      await executeButton.click()

      const overflowMetrics = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((activePane) => {
          const editableCell = activePane.querySelector(
            '.result-table .editable-cell[data-cell-column-key="payload"]'
          )
          const tableCell = editableCell?.closest<HTMLElement>('[data-column-key="payload"]')
          const tableCellText = editableCell?.querySelector<HTMLElement>('.table-cell-text')
          if (!tableCell || !tableCellText) {
            return null
          }
          return {
            cellWidth: tableCell.getBoundingClientRect().width,
            scrollWidth: tableCellText.scrollWidth,
            clientWidth: tableCellText.clientWidth
          }
        })

      expect(overflowMetrics).not.toBeNull()
      expect(
        overflowMetrics.cellWidth,
        'single-column query value should use the available table width'
      ).toBeGreaterThan(182)
      expect(
        overflowMetrics.scrollWidth,
        'long single-column query value should still overflow internally for ellipsis'
      ).toBeGreaterThan(overflowMetrics.clientWidth)
    } finally {
      await electronApp.close()
    }
  })

  test('connection groups and selected databases should survive renderer storage reset @bug', async () => {
    const electronApp = await launchRegressionApp()
    const folderId = `persistent-folder-${crypto.randomUUID()}`
    const folderName = `安装后保留分组 ${folderId.slice(-8)}`
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids',
      'datadjinn-selected-databases',
      'datadjinn-selected-schemas'
    ]
    let originalPreferences
    let localStorageSnapshot

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      originalPreferences = await page.evaluate(() =>
        window.api.requestJson('/preferences/connection-tree')
      )
      localStorageSnapshot = await page.evaluate((keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
        storageKeys
      )

      await page.evaluate(
        async ({ nextFolderId, nextFolderName, connectionId, keys }) => {
          await window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({
              preferences: {
                connection_folders: [{ id: nextFolderId, name: nextFolderName }],
                connection_folder_assignments: { [connectionId]: nextFolderId },
                connection_folder_order: [nextFolderId],
                root_connection_order: [],
                root_item_order: [`folder:${nextFolderId}`],
                root_item_order_customized: true,
                pinned_root_item_ids: [],
                folder_connection_order: { [nextFolderId]: [connectionId] },
                selected_databases: { [connectionId]: ['default'] },
                selected_schemas: {}
              }
            })
          })
          keys.forEach((key) => localStorage.removeItem(key))
        },
        { nextFolderId: folderId, nextFolderName: folderName, connectionId: fixtureConnectionId, keys: storageKeys }
      )

      await page.reload()
      await waitForAppReady(page)
      const folderTitle = page.locator(
        `.resource-tree-node-title[data-tree-node-key="folder:${folderId}"]`
      )
      await expect(folderTitle).toContainText(folderName, { timeout: 15000 })
      await folderTitle.dblclick()
      await expect(treeNode(page, `connection:${fixtureConnectionId}`)).toBeVisible({ timeout: 15000 })
      await expect
        .poll(() =>
          page.evaluate((connectionId) => {
            const selected = JSON.parse(
              localStorage.getItem('datadjinn-selected-databases') ?? '{}'
            )
            return selected[connectionId]
          }, fixtureConnectionId)
        )
        .toEqual(['default'])
    } finally {
      const page = await electronApp.firstWindow().catch(() => undefined)
      if (page && originalPreferences) {
        await page.evaluate(async (preferences) => {
          await window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({ preferences: preferences.preferences ?? {} })
          })
        }, originalPreferences)
      }
      if (page && localStorageSnapshot) {
        await page.evaluate((snapshot) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, value)
            }
          })
        }, localStorageSnapshot)
      }
      await electronApp.close()
    }
  })

  test('legacy connection tree cache should migrate before an installation upgrade can reset it @bug', async () => {
    const electronApp = await launchRegressionApp()
    const folderId = `upgrade-folder-${crypto.randomUUID()}`
    const folderName = `覆盖安装保留 ${folderId.slice(-8)}`
    let originalPreferences
    let originalMainPreferences
    let localStorageSnapshot
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids',
      'datadjinn-selected-databases',
      'datadjinn-selected-schemas'
    ]
    const legacyPreferences = {
      connection_folders: [{ id: folderId, name: folderName }],
      connection_folder_assignments: { [fixtureConnectionId]: folderId },
      connection_folder_order: [folderId],
      root_connection_order: [],
      root_item_order: [`folder:${folderId}`],
      root_item_order_customized: true,
      pinned_root_item_ids: [],
      folder_connection_order: { [folderId]: [fixtureConnectionId] },
      selected_databases: { [fixtureConnectionId]: ['default'] },
      selected_schemas: {}
    }
    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      originalPreferences = await page.evaluate(() => window.api.requestJson('/preferences/connection-tree'))
      originalMainPreferences = await page.evaluate(() => window.api.getConnectionTreePreferences())
      localStorageSnapshot = await page.evaluate((keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
        storageKeys
      )
      await page.evaluate(
        async ({ preferences, keys }) => {
          await window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({ preferences: {} })
          })
          await window.api.setConnectionTreePreferences({
            connection_folders: [],
            connection_folder_assignments: {},
            connection_folder_order: [],
            root_connection_order: [],
            root_item_order: [],
            root_item_order_customized: false,
            pinned_root_item_ids: [],
            folder_connection_order: {},
            selected_databases: {},
            selected_schemas: {}
          })
          localStorage.setItem('datadjinn-connection-folders', JSON.stringify(preferences.connection_folders))
          localStorage.setItem(
            'datadjinn-connection-folder-assignments',
            JSON.stringify(preferences.connection_folder_assignments)
          )
          localStorage.setItem(
            'datadjinn-connection-folder-order',
            JSON.stringify(preferences.connection_folder_order)
          )
          localStorage.setItem(
            'datadjinn-folder-connection-order',
            JSON.stringify(preferences.folder_connection_order)
          )
          localStorage.setItem('datadjinn-root-connection-order', JSON.stringify(preferences.root_connection_order))
          localStorage.setItem('datadjinn-root-item-order', JSON.stringify(preferences.root_item_order))
          localStorage.setItem(
            'datadjinn-root-item-order-customized',
            String(preferences.root_item_order_customized)
          )
          localStorage.setItem('datadjinn-pinned-root-item-ids', JSON.stringify(preferences.pinned_root_item_ids))
          localStorage.setItem('datadjinn-selected-databases', JSON.stringify(preferences.selected_databases))
          localStorage.setItem('datadjinn-selected-schemas', JSON.stringify(preferences.selected_schemas))
          void keys
        },
        { preferences: legacyPreferences, keys: storageKeys }
      )

      await page.reload()
      await waitForAppReady(page)
      await expect(
        page.locator(`.resource-tree-node-title[data-tree-node-key="folder:${folderId}"]`)
      ).toContainText(folderName, { timeout: 15000 })
      await expect
        .poll(() =>
          page.evaluate(async (connectionId) => {
            const response = await window.api.requestJson('/preferences/connection-tree')
            return response.preferences.connection_folder_assignments?.[connectionId]
          }, fixtureConnectionId)
        )
        .toBe(folderId)
    } finally {
      const page = await electronApp.firstWindow().catch(() => undefined)
      if (page && originalPreferences) {
        await page.evaluate(
          async ({ preferences, mainPreferences }) => {
            await Promise.all([
              window.api.requestJson('/preferences/connection-tree', {
                method: 'PUT',
                body: JSON.stringify({ preferences: preferences.preferences ?? {} })
              }),
              window.api.setConnectionTreePreferences(mainPreferences)
            ])
          },
          { preferences: originalPreferences, mainPreferences: originalMainPreferences ?? {} }
        )
      }
      if (page && localStorageSnapshot) {
        await page.evaluate((snapshot) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) localStorage.removeItem(key)
            else localStorage.setItem(key, value)
          })
        }, localStorageSnapshot)
      }
      await electronApp.close()
    }
  })

  test('wide result table should scroll vertically and horizontally without per-frame full-cell scans @bug', async () => {
    test.setTimeout(60000)
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
      await page.keyboard.type(`select * from ${wideTableName} order by id limit 1000;`)
      await page.getByRole('button', { name: /执行/i }).first().click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const renderedColumnButtons = activeResult.locator('.result-table [data-column-button]')
      await expect(renderedColumnButtons.first()).toBeVisible({ timeout: 30000 })
      const initialRenderedColumnCount = await renderedColumnButtons.count()
      expect(initialRenderedColumnCount).toBeLessThanOrEqual(32)
      await expect(
        activeResult.locator('.result-table .ant-table-tbody-virtual-holder')
      ).toBeVisible({ timeout: 30000 })
      await waitForBrowserIdle(page)

      await activeResult.evaluate(() => {
        const longTasks = []
        const observer = new PerformanceObserver((entries) => {
          entries.getEntries().forEach((entry) => longTasks.push(entry.duration))
        })
        observer.observe({ type: 'longtask' })
        window.__DATADJINN_WIDE_SCROLL_PROBE__ = { longTasks, observer }
      })
      const holder = activeResult.locator('.result-table .ant-table-tbody-virtual-holder')
      const holderBox = await holder.boundingBox()
      expect(holderBox).not.toBeNull()
      await page.mouse.move(holderBox.x + holderBox.width / 2, holderBox.y + holderBox.height / 2)
      for (let index = 0; index < 8; index += 1) {
        await page.mouse.wheel(0, 360)
        await page.waitForTimeout(20)
      }
      const verticalLongestTask = await activeResult.evaluate(() => {
        const probe = window.__DATADJINN_WIDE_SCROLL_PROBE__
        const longestTask = Math.max(0, ...(probe?.longTasks ?? []))
        probe?.observer.disconnect()
        const longTasks: number[] = []
        const observer = new PerformanceObserver((entries) => {
          entries.getEntries().forEach((entry) => longTasks.push(entry.duration))
        })
        observer.observe({ type: 'longtask' })
        window.__DATADJINN_WIDE_SCROLL_PROBE__ = { longTasks, observer }
        return longestTask
      })
      const horizontalScrollbar = activeResult.locator(
        '.result-table .ant-table-tbody-virtual-scrollbar-horizontal'
      )
      await expect(horizontalScrollbar).toBeVisible({ timeout: 10000 })
      const horizontalScrollbarBox = await horizontalScrollbar.boundingBox()
      expect(horizontalScrollbarBox).not.toBeNull()
      await page.mouse.move(horizontalScrollbarBox.x + 4, horizontalScrollbarBox.y + horizontalScrollbarBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        horizontalScrollbarBox.x + horizontalScrollbarBox.width * 0.7,
        horizontalScrollbarBox.y + horizontalScrollbarBox.height / 2,
        { steps: 12 }
      )
      await page.mouse.up()
      await expect(
        activeResult.locator('.result-table [data-column-button="column_090"]')
      ).toBeVisible({ timeout: 10000 })
      const scrollMetrics = await activeResult.evaluate(() => {
        const holder = document.querySelector('.result-table .ant-table-tbody-virtual-holder')
        const header = document.querySelector('.result-table .ant-table-header')
        const inner = document.querySelector('.ant-table-tbody-virtual-holder-inner')
        const probe = window.__DATADJINN_WIDE_SCROLL_PROBE__
        probe?.observer.disconnect()
        if (!(holder instanceof HTMLElement) || !(header instanceof HTMLElement)) {
          return null
        }
        return {
          scrollTop: holder.scrollTop,
          scrollLeft: holder.scrollLeft,
          headerScrollLeft: header.scrollLeft,
          horizontalOffset: Math.max(0, -Number.parseFloat(inner?.style.marginLeft || '0')),
          longestTask: Math.max(0, ...(probe?.longTasks ?? []))
        }
      })
      const visibleCurrentWindowCell = await activeResult.evaluate((node) => {
        const holder = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder'
        )
        if (!holder) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cell = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
        ).find((candidate) => {
          const rect = candidate.getBoundingClientRect()
          return (
            rect.width > 8 &&
            rect.height > 8 &&
            rect.top >= holderRect.top &&
            rect.bottom <= holderRect.bottom &&
            rect.left >= holderRect.left &&
            rect.right <= holderRect.right
          )
        })
        if (!cell) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(visibleCurrentWindowCell).not.toBeNull()
      await activeResult.evaluate((node) => {
        const table = node.querySelector('.result-table')
        if (!table) {
          return
        }
        const rows = Array.from(
          table.querySelectorAll('.ant-table-tbody-virtual-holder .ant-table-row')
        )
        const cells = Array.from(table.querySelectorAll('.editable-cell[data-cell-key]'))
        const mutations = []
        const observer = new MutationObserver((records) => {
          records.forEach((record) => {
            if (record.type === 'childList') {
              mutations.push(record)
            }
          })
        })
        observer.observe(table, { childList: true, subtree: true })
        window.__DATADJINN_WIDE_CLICK_STABILITY__ = { rows, cells, mutations, observer }
      })
      await page.mouse.click(visibleCurrentWindowCell.x, visibleCurrentWindowCell.y)
      const clickFrames = await activeResult.evaluate(async (node) => {
        const snapshot = () => ({
          visibleCells: Array.from(
            node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
          ).filter((cell) => {
            const rect = cell.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }).length,
          rows: node.querySelectorAll('.result-table .ant-table-tbody-virtual-holder .ant-table-row').length
        })
        const frames = [snapshot()]
        for (let index = 0; index < 5; index += 1) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
          frames.push(snapshot())
        }
        return frames
      })
      const clickStability = await activeResult.evaluate((node) => {
        const probe = window.__DATADJINN_WIDE_CLICK_STABILITY__
        probe?.observer.disconnect()
        const table = node.querySelector('.result-table')
        const currentRows = Array.from(
          table?.querySelectorAll('.ant-table-tbody-virtual-holder .ant-table-row') ?? []
        )
        const currentCells = Array.from(table?.querySelectorAll('.editable-cell[data-cell-key]') ?? [])
        const result = {
          childListMutations: probe?.mutations.length ?? -1,
          replacedRows: currentRows.filter((row) => !probe?.rows.includes(row)).length,
          replacedCells: currentCells.filter((cell) => !probe?.cells.includes(cell)).length
        }
        delete window.__DATADJINN_WIDE_CLICK_STABILITY__
        return result
      })
      expect(
        Math.min(...clickFrames.map((frame) => frame.visibleCells)),
        '横向滚动后的左键点击不应出现空白表格帧'
      ).toBeGreaterThan(0)
      expect(
        Math.min(...clickFrames.map((frame) => frame.rows)),
        '横向滚动后的左键点击不应卸载可见行'
      ).toBeGreaterThan(0)
      expect(
        clickStability,
        '横向滚动后的左键点击不应重新挂载可见虚拟行或单元格'
      ).toEqual({ childListMutations: 0, replacedRows: 0, replacedCells: 0 })
      await expect(
        activeResult.locator(
          `.result-table .editable-cell.cell-selected-runtime[data-cell-key="${visibleCurrentWindowCell.cellKey}"]`
        )
      ).toBeVisible()

      await page.mouse.click(visibleCurrentWindowCell.x, visibleCurrentWindowCell.y, { button: 'right' })
      await expect(page.locator('.result-cell-context-menu-panel')).toBeVisible({ timeout: 10000 })
      const contextFrames = await activeResult.evaluate(async (node) => {
        const frames: number[] = []
        for (let index = 0; index < 5; index += 1) {
          frames.push(
            Array.from(node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')).filter(
              (cell) => cell.getBoundingClientRect().width > 0 && cell.getBoundingClientRect().height > 0
            ).length
          )
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
        }
        return frames
      })
      expect(
        Math.min(...contextFrames),
        '横向滚动后的右键点击不应出现空白表格帧'
      ).toBeGreaterThan(0)
      const recordViewStart = Date.now()
      await clickVisibleDropdownMenuItem(page, '记录视图')
      const recordInspector = activeResult.locator('.cell-inspector.is-open')
      await expect(recordInspector).toBeVisible({ timeout: 10000 })
      await expect(recordInspector.locator('.cell-inspector-field-value').first()).toBeVisible({
        timeout: 10000
      })
      const recordViewElapsed = Date.now() - recordViewStart
      expect(
        await recordInspector.locator('.cell-inspector-field-value').count(),
        '宽表记录视图应完整显示当前记录字段'
      ).toBeGreaterThan(100)
      expect(recordViewElapsed, '宽表记录视图应在点击后快速显示').toBeLessThan(1000)

      expect(scrollMetrics).not.toBeNull()
      expect(scrollMetrics.scrollTop).toBeGreaterThan(0)
      expect(scrollMetrics.horizontalOffset).toBeGreaterThan(0)
      console.log(
        `[perf][wide-result-scroll] ${JSON.stringify({ verticalLongestTask, recordViewElapsed, ...scrollMetrics })}`
      )
      expect(verticalLongestTask).toBeLessThan(50)
      expect(scrollMetrics.longestTask).toBeLessThan(50)
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
      await expect(
        page.locator(
          '.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead'
        )
      ).toBeVisible({ timeout: 30000 })
      await expect
        .poll(
          async () => {
            return page
              .locator(
                '.workspace-tab-panels .workspace-active-content .result-table tbody tr, .workspace-tab-panels .workspace-active-content .result-table .ant-table-tbody-virtual-holder .ant-table-row'
              )
              .count()
          },
          { timeout: 30000 }
        )
        .toBeGreaterThan(0)
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const scrollMetrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
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

      const verticalScrollTarget = await getVerticalScrollbarDragTarget(activeResult)
      expect(verticalScrollTarget).not.toBeNull()
      const scrollbarX = verticalScrollTarget.x
      const scrollbarStartY = verticalScrollTarget.startY
      const scrollbarEndY = verticalScrollTarget.endY

      await page.mouse.move(scrollbarX, scrollbarStartY)
      await page.mouse.down()
      await page.mouse.move(scrollbarX, scrollbarEndY, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(250)

      const scrolledTop = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(
        scrolledTop,
        'query result vertical scroll should move after dragging the scrollbar'
      ).toBeGreaterThan(120)

      await page.mouse.click(scrollMetrics.x + 220, scrollMetrics.y + 180)
      await page.mouse.move(scrollMetrics.x + 220, scrollMetrics.y - 48, { steps: 8 })
      await page.waitForTimeout(200)

      const topAfterLeave = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(
        topAfterLeave,
        'moving the mouse outside the query result should not reset vertical scroll'
      ).toBeGreaterThan(120)

      const sampledScrollTops = []
      for (let index = 0; index < 4; index += 1) {
        await page.waitForTimeout(120)
        sampledScrollTops.push(
          await activeResult.evaluate((node) => {
            const holder = node.querySelector(
              '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
            )
            return holder instanceof HTMLElement ? holder.scrollTop : -1
          })
        )
      }
      const minSampledTop = Math.min(...sampledScrollTops)
      console.log(
        `[perf][query-result][scroll-after-leave] ${JSON.stringify({ topAfterLeave, sampledScrollTops })}`
      )
      expect(
        minSampledTop,
        'query result should not continue auto-scrolling upward after the pointer leaves the table'
      ).toBeGreaterThan(120)

      const queryTabTitle = await getActiveWorkspaceTabTitle(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      const switchBackMs = await clickWorkspaceTab(page, queryTabTitle)
      console.log(`[perf][query-result][switch-back] ${switchBackMs}`)

      await expect(resultHeader).toBeVisible({ timeout: 30000 })
      await expect
        .poll(
          async () => {
            return activeResult.evaluate(
              (node) =>
                node.querySelectorAll('.result-table .ant-table-row, .result-table tbody tr').length
            )
          },
          { timeout: 30000 }
        )
        .toBeGreaterThan(0)

      const restoredState = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        return {
          scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
          rowCount: node.querySelectorAll('.result-table .ant-table-row, .result-table tbody tr')
            .length
        }
      })
      expect(
        restoredState.rowCount,
        'query result should still render rows after switching away and back'
      ).toBeGreaterThan(0)
      expect(
        restoredState.scrollTop,
        'query result should keep a valid vertical scroll offset after switching back'
      ).toBeGreaterThan(120)
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const metrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder'
        )
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
          header: headerRect
            ? {
                x: headerRect.x,
                y: headerRect.y,
                width: headerRect.width,
                height: headerRect.height
              }
            : null,
          toolbar: toolbarRect
            ? {
                x: toolbarRect.x,
                y: toolbarRect.y,
                width: toolbarRect.width,
                height: toolbarRect.height
              }
            : null
        }
      })
      expect(metrics).not.toBeNull()

      const verticalScrollTarget = await getVerticalScrollbarDragTarget(activeResult)
      expect(verticalScrollTarget).not.toBeNull()
      const scrollbarX = verticalScrollTarget.x
      const scrollbarStartY = verticalScrollTarget.startY
      const scrollbarEndY = verticalScrollTarget.endY

      await page.mouse.move(scrollbarX, scrollbarStartY)
      await page.mouse.down()
      await page.mouse.move(scrollbarX, scrollbarEndY, { steps: 14 })
      await page.mouse.up()
      await page.waitForTimeout(250)

      const scrolledTop = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder'
        )
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(
        scrolledTop,
        'query result vertical scroll should move after dragging the scrollbar'
      ).toBeGreaterThan(120)

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
        sampledStates.push(
          await activeResult.evaluate((node) => {
            const holder = node.querySelector(
              '.result-table .ant-table-body, .result-table .ant-table-tbody-virtual-holder'
            )
            return {
              scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
              activeElement:
                document.activeElement instanceof HTMLElement
                  ? document.activeElement.className
                  : '',
              nativeSelection: window.getSelection?.()?.toString() ?? ''
            }
          })
        )
      }

      const minTop = Math.min(...sampledStates.map((item) => item.scrollTop))
      console.log(
        `[perf][query-result][header-leave-guard] ${JSON.stringify({ scrolledTop, sampledStates })}`
      )
      expect(
        minTop,
        'moving pointer from selected cell into header or toolbar should not auto scroll upward'
      ).toBeGreaterThan(120)
    } finally {
      await electronApp.close()
    }
  })

  test('query result should keep scroll position after dragging vertical scrollbar and moving outside the table @bug', async () => {
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const metrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
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

      const verticalScrollTarget = await getVerticalScrollbarDragTarget(activeResult)
      expect(verticalScrollTarget).not.toBeNull()
      const scrollbarX = verticalScrollTarget.x
      const dragStartY = verticalScrollTarget.startY
      const dragEndY = verticalScrollTarget.endY
      const releasePoint = { x: metrics.tableBody.x + 120, y: metrics.tableBody.y - 36 }

      await page.mouse.move(scrollbarX, dragStartY)
      await page.mouse.down()
      await page.mouse.move(scrollbarX, dragEndY, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(220)

      const afterDrag = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        return holder instanceof HTMLElement ? holder.scrollTop : -1
      })
      expect(
        afterDrag,
        'releasing the vertical scrollbar should leave the result scrolled'
      ).toBeGreaterThan(120)

      await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 12 })
      await page.waitForTimeout(260)

      const sampledTops = []
      for (let index = 0; index < 5; index += 1) {
        sampledTops.push(
          await activeResult.evaluate((node) => {
            const holder = node.querySelector(
              '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
            )
            return holder instanceof HTMLElement ? holder.scrollTop : -1
          })
        )
        await page.waitForTimeout(120)
      }

      const minTop = Math.min(...sampledTops)
      console.log(
        `[perf][query-result][scrollbar-release-outside] ${JSON.stringify({ afterDrag, sampledTops })}`
      )
      expect(
        minTop,
        'query result should not auto scroll upward after scrollbar drag releases outside the table'
      ).toBeGreaterThan(120)
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const resultHeader = activeResult.locator('.result-table .ant-table-thead')
      await expect(resultHeader).toBeVisible({ timeout: 30000 })

      const metrics = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
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
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
        )
        const visibleCell = cells.find((cell) => {
          const rect = cell.getBoundingClientRect()
          return (
            rect.width > 8 &&
            rect.height > 8 &&
            rect.top >= holderRect.top &&
            rect.bottom <= holderRect.bottom &&
            rect.left >= holderRect.left &&
            rect.right <= holderRect.right
          )
        })
        if (!visibleCell) {
          return null
        }
        const rect = visibleCell.getBoundingClientRect()
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
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
          scrollTop:
            (
              node.querySelector(
                '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
              ) as HTMLElement | null
            )?.scrollTop ?? -1
        }
      })
      expect(initialSelectedState.selectedCount).toBeGreaterThan(0)
      expect(initialSelectedState.scrollTop).toBeGreaterThan(120)

      await page.mouse.move(visibleCellCenter.x, metrics.tableBody.y - 30, { steps: 12 })
      await page.waitForTimeout(260)

      const sampledStates = []
      for (let index = 0; index < 5; index += 1) {
        sampledStates.push(
          await activeResult.evaluate((node) => {
            const holder = node.querySelector(
              '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
            )
            return {
              scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
              selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length
            }
          })
        )
        await page.waitForTimeout(120)
      }

      const minTop = Math.min(...sampledStates.map((item) => item.scrollTop))
      console.log(
        `[perf][query-result][cell-select-move-above] ${JSON.stringify({ initialSelectedState, sampledStates })}`
      )
      expect(
        minTop,
        'moving the pointer above the table after selecting a cell should not auto scroll upward'
      ).toBeGreaterThan(120)
      expect(
        Math.min(...sampledStates.map((item) => item.selectedCount)),
        'selected cell should remain selected while moving pointer above the table'
      ).toBeGreaterThan(0)
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

      const selectionTargets = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => {
          const holder = node.querySelector(
            '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
          )
          if (!(holder instanceof HTMLElement)) {
            return null
          }
          const holderRect = holder.getBoundingClientRect()
          const cells = Array.from(
            node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
          )
            .map((cell) => {
              const rect = cell.getBoundingClientRect()
              return {
                cellKey: cell.dataset.cellKey ?? '',
                rowKey: cell.dataset.rowKey ?? '',
                columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom
              }
            })
            .filter(
              (cell) =>
                cell.cellKey &&
                cell.right > cell.left &&
                cell.bottom > cell.top &&
                cell.right <= holderRect.right &&
                cell.left >= holderRect.left &&
                cell.top >= holderRect.top &&
                cell.bottom <= holderRect.bottom
            )

          const first = cells[0]
          if (!first) {
            return null
          }
          const sameRowNeighbor = cells.find(
            (cell) => cell.rowKey === first.rowKey && cell.columnKey !== first.columnKey
          )
          return sameRowNeighbor ? { first, sameRowNeighbor } : null
        })

      expect(selectionTargets).not.toBeNull()

      const previewBaselineStyle = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => {
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

      const firstCell = page
        .locator(
          `.workspace-tab-panels .workspace-active-content .editable-cell[data-cell-key="${selectionTargets.first.cellKey}"]:visible`
        )
        .first()
      const sameRowNeighborCell = page
        .locator(
          `.workspace-tab-panels .workspace-active-content .editable-cell[data-cell-key="${selectionTargets.sameRowNeighbor.cellKey}"]:visible`
        )
        .first()

      await firstCell.click()
      await page.waitForTimeout(120)

      const singleSelectionState = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => ({
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
      expect(
        singleSelectionState.selectedCount,
        'single click should select one preview cell'
      ).toBeGreaterThan(0)
      expect(
        singleSelectionState.selectedStyle,
        'selected preview cell should expose visible host styles'
      ).not.toBeNull()
      expect(
        singleSelectionState.selectedStyle.backgroundColor,
        'selected preview cell should apply a background color immediately'
      ).not.toBe(previewBaselineStyle.backgroundColor)
      expect(
        singleSelectionState.selectedStyle.boxShadow,
        'selected preview cell should not use a selection border'
      ).toBe(previewBaselineStyle.boxShadow)

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(
        selectionTargets.sameRowNeighbor.x,
        selectionTargets.sameRowNeighbor.y,
        { steps: 6 }
      )
      await page.mouse.up()
      await page.waitForTimeout(120)

      const dragSelectionState = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => ({
          selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length
        }))
      console.log(
        `[perf][preview-table][cell-selection] ${JSON.stringify({ singleSelectionState, dragSelectionState })}`
      )
      expect(
        dragSelectionState.selectedCount,
        'dragging across preview cells should create a range selection'
      ).toBeGreaterThan(1)
    } finally {
      await electronApp.close()
    }
  })

  test('table preview click and context menu should not blank the result table @bug', async () => {
    const electronApp = await launchRegressionApp()
    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const result = page.locator('.workspace-tab-panels .workspace-active-content')
      const cell = result.locator('.editable-cell[data-cell-key]:visible').first()
      await expect(cell).toBeVisible()
      const before = await result.locator('.editable-cell[data-cell-key]:visible').count()

      await cell.click()
      await page.waitForTimeout(80)
      await expect(result.locator('.ant-table-tbody')).toBeVisible()
      await expect.poll(() => result.locator('.editable-cell[data-cell-key]:visible').count()).toBeGreaterThan(0)

      await cell.click({ button: 'right' })
      await page.waitForTimeout(80)
      await expect(result.locator('.ant-table-tbody')).toBeVisible()
      await expect.poll(() => result.locator('.editable-cell[data-cell-key]:visible').count()).toBeGreaterThan(0)
      expect(before).toBeGreaterThan(0)
    } finally {
      await electronApp.close()
    }
  })

  test('preview cells should support Ctrl and Shift selection plus batch editing and Delete @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const targets = await activeResult.evaluate((node) => {
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
        ).filter((cell) => {
          const rect = cell.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        const first = cells[0]
        if (!first) {
          return null
        }
        const sameRow = cells.filter((cell) => cell.dataset.rowKey === first.dataset.rowKey)
        const second = sameRow[1]
        const third = sameRow[2]
        if (!second || !third) {
          return null
        }
        return {
          firstKey: first.dataset.cellKey ?? '',
          secondKey: second.dataset.cellKey ?? '',
          thirdKey: third.dataset.cellKey ?? '',
          rowKey: first.dataset.rowKey ?? '',
          column: second.dataset.cellColumnKey ?? ''
        }
      })
      expect(targets).not.toBeNull()
      if (!targets) {
        throw new Error('preview selection targets are unavailable')
      }

      const cell = (cellKey: string) =>
        activeResult.locator(`.editable-cell[data-cell-key="${cellKey}"]:visible`).first()
      await cell(targets.firstKey).click()
      await cell(targets.secondKey).click({ modifiers: ['Control'] })
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(2)

      await page.keyboard.press('b')
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toHaveValue('b')
      await expect(cell(targets.secondKey)).toHaveText('b')
      await page.keyboard.type('atch-value')
      await page.keyboard.press('Backspace')
      await expect(inlineEditor).toHaveValue('batch-valu')
      await expect(cell(targets.secondKey)).toHaveText('batch-valu')
      await page.keyboard.press('Enter')
      await expect(cell(targets.firstKey)).toHaveText('batch-valu')
      await expect(cell(targets.secondKey)).toHaveText('batch-valu')

      await page.keyboard.type('a')
      await expect(inlineEditor).toBeVisible()
      await inlineEditor.evaluate((input) => {
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        input.value = 'zhong'
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'zhong',
            inputType: 'insertCompositionText',
            isComposing: true
          })
        )
      })
      await expect(inlineEditor).toHaveValue('zhong')
      await expect(cell(targets.secondKey)).toHaveText('batch-valu')
      await inlineEditor.evaluate((input) => {
        input.value = '批量中文'
        input.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, data: '批量中文' })
        )
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: '批量中文',
            inputType: 'insertText'
          })
        )
      })
      await expect(inlineEditor).toHaveValue('批量中文')
      await expect(cell(targets.secondKey)).toHaveText('批量中文')
      await page.keyboard.press('Enter')
      await expect(cell(targets.firstKey)).toHaveText('批量中文')
      await expect(cell(targets.secondKey)).toHaveText('批量中文')

      await cell(targets.thirdKey).click({ modifiers: ['Shift'] })
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(2)

      const rowButton = activeResult
        .locator(`.ant-table-row[data-row-key="${targets.rowKey}"] .row-number-button`)
        .first()
      await rowButton.click()
      await page.waitForTimeout(50)
      await page.keyboard.press('r')
      await expect(inlineEditor).toBeVisible()
      await inlineEditor.fill('整行值')
      await page.keyboard.press('Enter')
      await expect
        .poll(() =>
          activeResult
            .locator(`.ant-table-row[data-row-key="${targets.rowKey}"] .editable-cell`)
            .allTextContents()
        )
        .toEqual(expect.arrayContaining(['整行值']))

      await activeResult.locator(`[data-column-button="${targets.column}"]`).first().click()
      await page.waitForTimeout(50)
      await page.keyboard.press('Delete')
      await expect
        .poll(() =>
          activeResult
            .locator(`.editable-cell[data-cell-column-key="${targets.column}"]`)
            .allTextContents()
        )
        .toEqual(expect.arrayContaining(['']))
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('edited preview cells should retain draft styling and support Backspace plus Delete after blur @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const target = activeResult
        .locator('.editable-cell[data-cell-column-key="name"]:visible')
        .first()
      await expect(target).toBeVisible()
      const targetRow = target.locator('xpath=ancestor::*[contains(@class, "ant-table-row")][1]')
      const rowNumberCell = targetRow.locator('.row-number-cell')
      const originalRowNumberBackground = await rowNumberCell.evaluate(
        (node) => window.getComputedStyle(node).backgroundColor
      )

      await target.dblclick()
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible()
      await expect(inlineEditor).toHaveCSS('height', '31px')
      await inlineEditor.fill('draft-value')
      await inlineEditor.evaluate((input) => input.blur())

      await expect(targetRow).toHaveClass(/row-updated/)
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(0)
      await expect(rowNumberCell).toHaveCSS('border-left-width', '3px')
      await expect(rowNumberCell).toHaveCSS('background-color', originalRowNumberBackground)
      await expect(target).toHaveClass(/editable-cell-draft/)
      const draftHost = target.locator(
        'xpath=ancestor::*[contains(@class, "ant-table-cell")][1]'
      )
      await expect(draftHost).toHaveClass(/editable-cell-draft-host/)
      const draftColors = await target.evaluate((node) => {
        const host = node.closest<HTMLElement>('td, .ant-table-cell')
        return {
          cellBackground: window.getComputedStyle(node).backgroundColor,
          hostBackground: host ? window.getComputedStyle(host).backgroundColor : '',
          hostBorder: host ? window.getComputedStyle(host).borderBottomColor : ''
        }
      })
      expect(draftColors.hostBackground).toBe(draftColors.cellBackground)
      expect(draftColors.hostBorder).not.toBe(draftColors.hostBackground)
      await target.hover()
      await expect(target).toHaveCSS('background-color', draftColors.cellBackground)
      await expect(targetRow.locator('.editable-cell-draft')).toHaveCount(1)

      await target.click()
      await page.keyboard.press('Backspace')
      await expect(inlineEditor).toHaveValue('draft-valu')
      await page.keyboard.press('Enter')
      await expect(target).toHaveText('draft-valu')

      await activeResult.locator('.result-status').click()
      await target.click()
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(1)
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.className ?? ''))
        .toContain('result-table-body')
      await page.keyboard.press('Delete')
      await expect(target).toHaveText('')

      const rowHeights = await activeResult.evaluate((node) =>
        Array.from(node.querySelectorAll<HTMLElement>('.ant-table-row[data-row-key]'))
          .slice(0, 2)
          .map((row) => row.getBoundingClientRect().height)
      )
      expect(rowHeights).toHaveLength(2)
      expect(Math.abs(rowHeights[0] - rowHeights[1])).toBeLessThanOrEqual(1)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('dragging selected cells beyond the table edges should keep scrolling and extending the range @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const dragTarget = await activeResult.evaluate((node) => {
        const holder = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!holder) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const firstCell = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
        ).find((cell) => {
          const rect = cell.getBoundingClientRect()
          return (
            rect.left >= holderRect.left &&
            rect.right <= holderRect.right &&
            rect.top >= holderRect.top &&
            rect.bottom <= holderRect.bottom
          )
        })
        if (!firstCell) {
          return null
        }
        const cellRect = firstCell.getBoundingClientRect()
        return {
          startX: cellRect.left + cellRect.width / 2,
          startY: cellRect.top + cellRect.height / 2,
          outsideX: Math.min(window.innerWidth - 2, holderRect.right + 96),
          outsideY: Math.min(window.innerHeight - 2, holderRect.bottom + 96)
        }
      })
      expect(dragTarget).not.toBeNull()
      if (!dragTarget) {
        throw new Error('drag selection target is unavailable')
      }

      await page.mouse.move(dragTarget.startX, dragTarget.startY)
      await page.mouse.down()
      await page.mouse.move(dragTarget.outsideX, dragTarget.outsideY, { steps: 8 })
      await page.waitForTimeout(380)
      await page.mouse.up()

      const state = await activeResult.evaluate((node) => {
        const holder = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        return {
          scrollTop: holder?.scrollTop ?? 0,
          scrollLeft: holder?.scrollLeft ?? 0,
          selectedCount: node.querySelectorAll(
            '.editable-cell.cell-selected-runtime, .cell-selected-runtime-host'
          ).length
        }
      })
      expect(state.scrollTop, 'dragging below the table should scroll vertically').toBeGreaterThan(0)
      expect(state.scrollLeft, 'dragging past the table side should scroll horizontally').toBeGreaterThan(0)
      expect(state.selectedCount, 'auto-scrolling should continue extending the selected range').toBeGreaterThan(1)
    } finally {
      await electronApp.close()
    }
  })

  test('row number selection should support Ctrl anchor followed by Shift range @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const rowButtons = activeResult.locator('.row-number-button')
      await expect(rowButtons).toHaveCount(4, { timeout: 30000 })
      await rowButtons.nth(0).click()
      await rowButtons.nth(1).click({ modifiers: ['Control'] })
      await rowButtons.nth(3).click({ modifiers: ['Shift'] })
      await expect(activeResult.locator('.row-number-button.selected')).toHaveCount(3)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('row number drag should auto-scroll near the table edge @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const dragTarget = await activeResult.evaluate((node) => {
        const button = node.querySelector<HTMLElement>('.row-number-button')
        const holder = node.querySelector<HTMLElement>(
          '.ant-table-tbody-virtual-holder, .ant-table-body'
        )
        if (!button || !holder) {
          return null
        }
        const buttonRect = button.getBoundingClientRect()
        const holderRect = holder.getBoundingClientRect()
        return {
          startX: buttonRect.left + buttonRect.width / 2,
          startY: buttonRect.top + buttonRect.height / 2,
          endX: holderRect.left + Math.min(24, holderRect.width / 2),
          endY: holderRect.bottom + 12
        }
      })
      expect(dragTarget).not.toBeNull()
      if (!dragTarget) {
        throw new Error('row drag target is not measurable')
      }

      await page.mouse.move(dragTarget.startX, dragTarget.startY)
      await page.mouse.down()
      await page.mouse.move(dragTarget.endX, dragTarget.endY)
      await page.waitForTimeout(500)
      await page.mouse.up()
      await expect
        .poll(
          () =>
            activeResult.evaluate((node) => {
              const holder = node.querySelector<HTMLElement>(
                '.ant-table-tbody-virtual-holder, .ant-table-body'
              )
              return holder?.scrollTop ?? 0
            }),
          { timeout: 10000 }
        )
        .toBeGreaterThan(0)
      await expect
        .poll(() => activeResult.locator('.row-number-button.selected').count(), { timeout: 10000 })
        .toBeGreaterThan(1)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()
      await expect(
        page.locator(
          '.workspace-tab-panels .workspace-active-content .result-table .ant-table-thead'
        )
      ).toBeVisible({ timeout: 30000 })
      await expect(
        page
          .locator(
            '.workspace-tab-panels .workspace-active-content .result-table .editable-cell[data-cell-key]'
          )
          .first()
      ).toBeVisible({ timeout: 30000 })

      const selectionTargets = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => {
          const holder = node.querySelector(
            '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
          )
          if (!(holder instanceof HTMLElement)) {
            return null
          }
          const holderRect = holder.getBoundingClientRect()
          const cells = Array.from(
            node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
          )
            .map((cell) => {
              const rect = cell.getBoundingClientRect()
              return {
                cellKey: cell.dataset.cellKey ?? '',
                rowKey: cell.dataset.rowKey ?? '',
                columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom
              }
            })
            .filter(
              (cell) =>
                cell.cellKey &&
                cell.right <= holderRect.right &&
                cell.left >= holderRect.left &&
                cell.top >= holderRect.top &&
                cell.bottom <= holderRect.bottom
            )

          const first = cells[0]
          if (!first) {
            return null
          }
          const sameRowNeighbor = cells.find(
            (cell) => cell.rowKey === first.rowKey && cell.columnKey !== first.columnKey
          )
          return sameRowNeighbor ? { first, sameRowNeighbor } : null
        })

      expect(selectionTargets).not.toBeNull()

      const queryBaselineStyle = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => {
          const firstCell = node.querySelector(
            '.result-table td[data-cell-key] .editable-cell, .result-table .ant-table-tbody-virtual-holder [data-cell-key] .editable-cell'
          )
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

      const firstCell = page
        .locator(
          `.workspace-tab-panels .workspace-active-content .editable-cell[data-cell-key="${selectionTargets.first.cellKey}"]:visible`
        )
        .first()
      const sameRowNeighborCell = page
        .locator(
          `.workspace-tab-panels .workspace-active-content .editable-cell[data-cell-key="${selectionTargets.sameRowNeighbor.cellKey}"]:visible`
        )
        .first()

      await firstCell.click()
      await page.waitForTimeout(120)

      const singleSelectionState = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => ({
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
      expect(
        singleSelectionState.selectedCount,
        'single click should select one query result cell'
      ).toBeGreaterThan(0)
      expect(
        singleSelectionState.selectedStyle,
        'selected query result cell should expose visible host styles'
      ).not.toBeNull()
      expect(
        singleSelectionState.selectedStyle.backgroundColor,
        'selected query result cell should apply a background color immediately'
      ).not.toBe(queryBaselineStyle.backgroundColor)
      expect(
        singleSelectionState.selectedStyle.boxShadow,
        'selected query result cell should not use a selection border'
      ).toBe(queryBaselineStyle.boxShadow)

      await firstCell.hover()
      await page.mouse.down()
      await sameRowNeighborCell.hover({ force: true })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const dragSelectionState = await page
        .locator('.workspace-tab-panels .workspace-active-content')
        .evaluate((node) => ({
          selectedCount: node.querySelectorAll('.editable-cell.cell-selected-runtime').length
        }))
      console.log(
        `[perf][query-result][cell-selection] ${JSON.stringify({ singleSelectionState, dragSelectionState })}`
      )
      expect(
        dragSelectionState.selectedCount,
        'dragging across query result cells should create a range selection'
      ).toBeGreaterThan(1)
    } finally {
      await electronApp.close()
    }
  })

  test('query results should edit direct source fields and submit the guarded update @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
      await editorTextbox.focus()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select id, name from small_items order by id;')
      await page.locator('.query-execute-button').first().click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const target = activeResult
        .locator('.editable-cell[data-cell-column-key="name"]:visible')
        .first()
      await expect(target).toBeVisible({ timeout: 30000 })
      await target.dblclick()
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible()
      await inlineEditor.fill('query-edit-guarded')
      await inlineEditor.press('Enter')
      await expect(target).toHaveText('query-edit-guarded')

      const submitButton = activeResult.getByRole('button', { name: '提交' })
      await expect(submitButton).toBeVisible()
      await submitButton.click()
      await expect(submitButton).toHaveCount(0, { timeout: 30000 })
      await expect(target).toHaveText('query-edit-guarded')
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('one to five column results should keep fixed row-number and default data widths @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const editorTextbox = await focusMonacoEditor(page)
      const cases = [
        { count: 1, sql: "select 'one-column-value' as c1 from small_items order by id;", last: 'c1' },
        { count: 2, sql: 'select id, name from small_items order by id;', last: 'name' },
        { count: 3, sql: 'select id, name, note from small_items order by id;', last: 'note' },
        {
          count: 4,
          sql: 'select id, category, title, created_at from large_items order by id;',
          last: 'created_at'
        },
        {
          count: 5,
          sql: 'select id, category, title, payload, created_at from large_items order by id;',
          last: 'created_at'
        }
      ]

      for (const resultCase of cases) {
        await editorTextbox.focus()
        await page.keyboard.press('Control+A')
        await page.keyboard.type(resultCase.sql)
        await page.locator('.query-execute-button').first().click()
        await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
          timeout: 30000
        })
        await expect(
          activeResult.locator(
            `.editable-cell[data-cell-column-key="${resultCase.last}"]:visible`
          ).first()
        ).toBeVisible({ timeout: 30000 })

        const layout = await activeResult.evaluate((node, expected) => {
          const headerCells = Array.from(
            node.querySelectorAll<HTMLElement>('.result-table .ant-table-thead > tr > th')
          ).filter((cell) => !cell.classList.contains('ant-table-cell-scrollbar'))
          const firstRow = node.querySelector<HTMLElement>(
            '.result-table .ant-table-tbody > tr, .result-table .ant-table-tbody-virtual-holder .ant-table-row'
          )
          const bodyCells = firstRow
            ? Array.from(firstRow.querySelectorAll<HTMLElement>(':scope > td, :scope > .ant-table-cell'))
            : []
          const lastCell = node.querySelector<HTMLElement>(
            `.result-table .editable-cell[data-cell-column-key="${expected.last}"]`
          )
          return {
            headerWidths: headerCells.map((cell) => cell.getBoundingClientRect().width),
            bodyWidths: bodyCells.map((cell) => cell.getBoundingClientRect().width),
            lastCellText: lastCell?.textContent?.trim() ?? '',
            lastCellWidth: lastCell?.getBoundingClientRect().width ?? 0
          }
        }, resultCase)
        console.log(`[layout][${resultCase.count}-column-result] ${JSON.stringify(layout)}`)
        expect(layout.headerWidths).toHaveLength(resultCase.count + 1)
        expect(layout.bodyWidths).toHaveLength(resultCase.count + 1)
        expect(layout.headerWidths[0]).toBeCloseTo(34, 0)
        expect(layout.bodyWidths[0]).toBeCloseTo(34, 0)
        for (let index = 1; index <= resultCase.count; index += 1) {
          expect(layout.headerWidths[index]).toBeCloseTo(180, 0)
          expect(layout.bodyWidths[index]).toBeCloseTo(180, 0)
        }
        expect(layout.lastCellText).not.toBe('')
        expect(layout.lastCellWidth).toBeGreaterThanOrEqual(170)
        const lastColumnVisibility = await activeResult.evaluate((node, expected) => {
          const holder = node.querySelector<HTMLElement>(
            '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
          )
          const lastCell = node.querySelector<HTMLElement>(
            `.editable-cell[data-cell-column-key="${expected.last}"]`
          )
          const lastHeaderCell = Array.from(
            node.querySelectorAll<HTMLElement>('.result-table .ant-table-thead > tr > th')
          )
            .filter((cell) => !cell.classList.contains('ant-table-cell-scrollbar'))
            .at(-1)
          if (!holder || !lastCell || !lastHeaderCell) {
            return null
          }
          holder.scrollLeft = Math.max(0, holder.scrollWidth - holder.clientWidth)
          holder.dispatchEvent(new Event('scroll', { bubbles: true }))
          const holderRect = holder.getBoundingClientRect()
          const cellRect = lastCell.getBoundingClientRect()
          const headerRect = lastHeaderCell.getBoundingClientRect()
          return {
            scrollLeft: holder.scrollLeft,
            scrollWidth: holder.scrollWidth,
            clientWidth: holder.clientWidth,
            cellLeft: cellRect.left,
            cellRight: cellRect.right,
            headerText: lastHeaderCell.textContent?.trim() ?? '',
            headerLeft: headerRect.left,
            headerRight: headerRect.right,
            holderLeft: holderRect.left,
            holderRight: holderRect.right
          }
        }, resultCase)
        expect(lastColumnVisibility).not.toBeNull()
        if ((lastColumnVisibility?.scrollWidth ?? 0) > (lastColumnVisibility?.clientWidth ?? 0)) {
          expect(lastColumnVisibility?.scrollLeft).toBeGreaterThan(0)
        }
        expect(lastColumnVisibility?.cellLeft ?? 0).toBeGreaterThanOrEqual(
          (lastColumnVisibility?.holderLeft ?? 0) - 1
        )
        expect(lastColumnVisibility?.cellRight ?? 0).toBeLessThanOrEqual(
          (lastColumnVisibility?.holderRight ?? 0) + 1
        )
        expect(lastColumnVisibility?.headerText).toContain(resultCase.last)
        expect(lastColumnVisibility?.headerLeft ?? 0).toBeGreaterThanOrEqual(
          (lastColumnVisibility?.holderLeft ?? 0) - 1
        )
        expect(lastColumnVisibility?.headerRight ?? 0).toBeLessThanOrEqual(
          (lastColumnVisibility?.holderRight ?? 0) + 1
        )
        await activeResult.screenshot({
          path: `test-results/ten-thousand-${resultCase.count}-columns.png`
        })
      }
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('table previews should keep every default column visible and truncate long cells with an ellipsis @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, smallTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.editable-cell[data-cell-column-key="note"]').first()).toBeVisible({
        timeout: 30000
      })
      const previewLayout = await activeResult.evaluate((node) => {
        const holder = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        const headerCells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .ant-table-thead > tr > th')
        ).filter((cell) => !cell.classList.contains('ant-table-cell-scrollbar'))
        const firstRow = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody > tr, .result-table .ant-table-tbody-virtual-holder .ant-table-row'
        )
        const bodyCells = firstRow
          ? Array.from(firstRow.querySelectorAll<HTMLElement>(':scope > td, :scope > .ant-table-cell'))
          : []
        return {
          holderWidth: holder?.clientWidth ?? 0,
          holderScrollWidth: holder?.scrollWidth ?? 0,
          headerWidths: headerCells.map((cell) => cell.getBoundingClientRect().width),
          bodyWidths: bodyCells.map((cell) => cell.getBoundingClientRect().width),
          noteText: node.querySelector<HTMLElement>('.editable-cell[data-cell-column-key="note"]')?.textContent?.trim() ?? ''
        }
      })
      console.log(`[layout][three-column-preview] ${JSON.stringify(previewLayout)}`)
      expect(previewLayout.headerWidths).toEqual([34, 180, 180, 180])
      expect(previewLayout.bodyWidths).toEqual([34, 180, 180, 180])
      expect(previewLayout.holderScrollWidth).toBe(previewLayout.holderWidth)
      expect(previewLayout.noteText).not.toBe('')
      await activeResult.screenshot({ path: 'test-results/table-preview-three-columns.png' })

      await openQueryWorkspace(page)
      const editorTextbox = await focusMonacoEditor(page)
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        "select 'this is a deliberately long one-column value that must be visibly truncated with an ellipsis' as value from small_items order by id;"
      )
      await page.locator('.query-execute-button').first().click()
      const queryResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const longCell = queryResult.locator('.editable-cell[data-cell-column-key="value"]').first()
      await expect(longCell).toBeVisible({ timeout: 30000 })
      await queryResult.screenshot({ path: 'test-results/table-layout-visual-regression.png' })
      const longCellLayout = await longCell.evaluate((cell) => {
        const text = cell.querySelector<HTMLElement>('.table-cell-text') ?? cell
        const style = window.getComputedStyle(text)
        return {
          hostWidth: cell.getBoundingClientRect().width,
          width: text.getBoundingClientRect().width,
          scrollWidth: text.scrollWidth,
          overflow: style.overflow,
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow
        }
      })
      console.log(`[layout][long-single-column] ${JSON.stringify(longCellLayout)}`)
      expect(longCellLayout.hostWidth).toBeCloseTo(180, 0)
      expect(longCellLayout.width).toBeLessThan(longCellLayout.hostWidth)
      expect(longCellLayout.scrollWidth).toBeGreaterThan(longCellLayout.width)
      expect(longCellLayout.overflow).toBe('hidden')
      expect(longCellLayout.whiteSpace).toBe('nowrap')
      expect(longCellLayout.textOverflow).toBe('ellipsis')
    } finally {
      await electronApp.close()
    }
  })

  test('ten-thousand-row previews should keep fixed columns and restore virtual horizontal scroll after refresh @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await page.evaluate(() => localStorage.setItem('datadjinn-theme', 'light'))
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, threeColumnTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const threeColumnLayout = await activeResult.evaluate((node) => {
        const headerCells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .ant-table-thead > tr > th')
        ).filter((cell) => !cell.classList.contains('ant-table-cell-scrollbar'))
        const firstRow = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder .ant-table-row'
        )
        const bodyCells = firstRow
          ? Array.from(firstRow.querySelectorAll<HTMLElement>(':scope > .ant-table-cell'))
          : []
        const lastCell = bodyCells.at(-1)
        return {
          headerWidths: headerCells.map((cell) => Math.round(cell.getBoundingClientRect().width)),
          bodyWidths: bodyCells.map((cell) => Math.round(cell.getBoundingClientRect().width)),
          lastCellText: lastCell?.textContent?.trim() ?? '',
          virtualRowCount: node.querySelectorAll('.result-table .ant-table-tbody-virtual-holder .ant-table-row').length,
          totalRowLabel: node.querySelector<HTMLElement>('.result-status')?.textContent ?? '',
          virtualTable: Boolean(node.querySelector('.result-table .ant-table-tbody-virtual-holder'))
        }
      })
      expect(threeColumnLayout.virtualTable).toBe(true)
      expect(threeColumnLayout.virtualRowCount).toBeGreaterThan(0)
      expect(threeColumnLayout.totalRowLabel).toContain('10000')
      expect(threeColumnLayout.headerWidths).toEqual([34, 180, 180, 180])
      expect(threeColumnLayout.bodyWidths).toEqual([34, 180, 180, 180])
      expect(threeColumnLayout.lastCellText).toMatch(/^2026-08-13 /)
      await activeResult.screenshot({ path: 'test-results/ten-thousand-three-columns.png' })

      await openFixtureTable(page, singleColumnTableName)
      const singleColumnLayout = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>(
          '.result-table .editable-cell[data-cell-column-key="f1"]'
        )
        const text = cell?.querySelector<HTMLElement>('.table-cell-text')
        const hostCell = cell?.closest<HTMLElement>('[data-column-key="f1"]')
        return {
          hostWidth: hostCell ? Math.round(hostCell.getBoundingClientRect().width) : 0,
          textWidth: text ? Math.round(text.getBoundingClientRect().width) : 0,
          textScrollWidth: text?.scrollWidth ?? 0,
          textOverflow: text ? window.getComputedStyle(text).textOverflow : '',
          virtualTable: Boolean(node.querySelector('.result-table .ant-table-tbody-virtual-holder'))
        }
      })
      expect(singleColumnLayout.virtualTable).toBe(true)
      expect(singleColumnLayout.hostWidth).toBe(180)
      expect(singleColumnLayout.textWidth).toBeLessThan(singleColumnLayout.hostWidth)
      expect(singleColumnLayout.textScrollWidth).toBeGreaterThan(singleColumnLayout.textWidth)
      expect(singleColumnLayout.textOverflow).toBe('ellipsis')
      await activeResult.screenshot({ path: 'test-results/ten-thousand-single-column.png' })

      await openFixtureTable(page, largeTableName)
      await expect(activeResult.locator('.result-status')).toContainText('10000')
      const beforeRefresh = await activeResult.evaluate((node) => {
        const holder = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder'
        )
        if (!holder) {
          return null
        }
        holder.scrollLeft = Math.max(80, Math.round((holder.scrollWidth - holder.clientWidth) * 0.65))
        holder.dispatchEvent(new Event('scroll', { bubbles: true }))
        return {
          scrollLeft: holder.scrollLeft,
          clientWidth: holder.clientWidth,
          scrollWidth: holder.scrollWidth
        }
      })
      expect(beforeRefresh).not.toBeNull()
      expect(beforeRefresh?.scrollWidth).toBeGreaterThan(beforeRefresh?.clientWidth ?? 0)
      expect(beforeRefresh?.scrollLeft).toBeGreaterThan(0)
      await activeResult.screenshot({ path: 'test-results/ten-thousand-scroll-before-refresh.png' })
      await activeResult.getByRole('button', { name: '刷新' }).click()
      await expect(activeResult.locator('.result-table-loading-overlay')).toHaveCount(0, {
        timeout: 30000
      })
      await expect.poll(() => activeResult.evaluate((node) => {
        const holder = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-holder'
        )
        return holder?.scrollLeft ?? null
      }), { timeout: 10000 }).toBeCloseTo(beforeRefresh?.scrollLeft ?? 0, 0)
      await activeResult.screenshot({ path: 'test-results/ten-thousand-scroll-after-refresh.png' })
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
      await page.keyboard.type(
        'select id, category, title, payload, created_at from large_items order by id;'
      )

      const executeButton = page.locator('.query-execute-button').first()
      await expect(executeButton).toBeVisible({ timeout: 30000 })
      await executeButton.click()
      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
        timeout: 30000
      })

      const selectionTargets = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
        )
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter(
            (cell) =>
              cell.cellKey &&
              cell.right > cell.left &&
              cell.bottom > cell.top &&
              cell.right <= holderRect.right &&
              cell.left >= holderRect.left &&
              cell.top >= holderRect.top &&
              cell.bottom <= holderRect.bottom
          )

        const first = cells[0]
        if (!first) {
          return null
        }
        const hostCell = node.querySelector(
          `td[data-cell-key="${CSS.escape(first.cellKey)}"], .ant-table-tbody-virtual-holder [data-cell-key="${CSS.escape(first.cellKey)}"]`
        )
        const rowElement = hostCell?.closest('tr, .ant-table-row') as HTMLElement | null
        const rowButton = rowElement?.querySelector<HTMLElement>('.row-number-button')
        const columnButton = node.querySelector<HTMLElement>(
          `.result-table .ant-table-thead [data-column-button="${CSS.escape(first.columnKey)}"]`
        )
        const rowButtonRect = rowButton?.getBoundingClientRect()
        const columnButtonRect = columnButton?.getBoundingClientRect()
        return {
          ...first,
          rowButtonCenter: rowButtonRect
            ? {
                x: rowButtonRect.x + rowButtonRect.width / 2,
                y: rowButtonRect.y + rowButtonRect.height / 2
              }
            : null,
          columnButtonCenter: columnButtonRect
            ? {
                x: columnButtonRect.x + columnButtonRect.width / 2,
                y: columnButtonRect.y + columnButtonRect.height / 2
              }
            : null
        }
      })
      expect(selectionTargets).not.toBeNull()
      expect(selectionTargets.rowButtonCenter).not.toBeNull()
      expect(selectionTargets.columnButtonCenter).not.toBeNull()

      await activeResult
        .locator(`.editable-cell[data-cell-key="${selectionTargets.cellKey}"]:visible`)
        .first()
        .click()
      await page.waitForTimeout(120)

      const readStyle = async (selector, options = {}) =>
        activeResult.evaluate(
          (node, payload) => {
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
          },
          { selector, visibleOnly: options.visibleOnly ?? false }
        )

      const selectedCellRuntimeSelector = `.result-table .editable-cell.cell-selected-runtime[data-cell-key="${selectionTargets.cellKey}"]`
      const selectedRowCellSelector = `.result-table .row-selected .editable-cell[data-cell-key="${selectionTargets.cellKey}"]`
      const selectedColumnCellSelector = `.result-table .editable-cell.column-selected-runtime-inner[data-cell-key="${selectionTargets.cellKey}"]`
      await expect(activeResult.locator(selectedCellRuntimeSelector)).toBeVisible({ timeout: 3000 })
      const baseline = await readStyle(selectedCellRuntimeSelector, { visibleOnly: true })
      expect(baseline).not.toBeNull()

      await page.mouse.click(selectionTargets.rowButtonCenter.x, selectionTargets.rowButtonCenter.y)
      await page.waitForTimeout(120)

      const rowStyle = await readStyle(selectedRowCellSelector, { visibleOnly: true })
      const rowNumberCellStyle = await activeResult.evaluate((node, rowKey) => {
        const selectedButton = Array.from(
          node.querySelectorAll<HTMLElement>(
            `.ant-table-row[data-row-key="${CSS.escape(rowKey)}"] .row-number-button.selected, tr[data-row-key="${CSS.escape(rowKey)}"] .row-number-button.selected`
          )
        ).find((candidate) => {
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

      await page.mouse.click(
        selectionTargets.columnButtonCenter.x,
        selectionTargets.columnButtonCenter.y
      )
      await page.waitForTimeout(120)

      const columnStyle = await readStyle(selectedColumnCellSelector, { visibleOnly: true })

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

      expect(
        colorDistance(rowStyle.backgroundColor, baseline.backgroundColor),
        `row selection should render the same visible selection color as cell selection: ${JSON.stringify({ baseline, rowStyle, rowNumberCellStyle, columnStyle })}`
      ).toBeLessThanOrEqual(1)
      expect(
        colorDistance(columnStyle.backgroundColor, baseline.backgroundColor),
        'column selection should render the same visible selection color as cell selection'
      ).toBeLessThanOrEqual(1)
      expect(
        colorDistance(rowNumberCellStyle.backgroundColor, baseline.backgroundColor),
        'row number cell should use the same selected background'
      ).toBeLessThanOrEqual(1)
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
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
        timeout: 30000
      })

      const resizeTarget = await activeResult.evaluate((node) => {
        const handle =
          node.querySelector<HTMLElement>(
            '.result-table .ant-table-thead [data-column-button="category"] + .column-sort-button + .column-filter-button + .column-resize-handle, .result-table .ant-table-thead [data-column-button="category"] ~ .column-resize-handle'
          ) ??
          node.querySelector<HTMLElement>('.result-table .ant-table-thead .column-resize-handle')
        const headerButton = node.querySelector<HTMLElement>(
          '.result-table .ant-table-thead [data-column-button="category"]'
        )
        const headerCell = headerButton?.closest('th') as HTMLElement | null
        const bodyCell = node.querySelector<HTMLElement>(
          '.result-table .ant-table-body [data-column-key="category"], .result-table .ant-table-tbody-virtual-holder [data-column-key="category"]'
        )
        if (
          !(handle instanceof HTMLElement) ||
          !(headerCell instanceof HTMLElement) ||
          !(bodyCell instanceof HTMLElement)
        ) {
          return null
        }
        const handleRect = handle.getBoundingClientRect()
        return {
          pointerId: 9,
          startX: handleRect.x + handleRect.width / 2,
          startY: handleRect.y + handleRect.height / 2,
          initialHeaderWidth: headerCell.getBoundingClientRect().width,
          initialBodyWidth: bodyCell.getBoundingClientRect().width
        }
      })
      expect(resizeTarget).not.toBeNull()

      const shrinkDistance = Math.min(
        80,
        Math.max(30, Math.floor(resizeTarget.initialHeaderWidth * 0.45))
      )

      const midResize = await activeResult.evaluate(
        async (node, target) => {
          const handle =
            node.querySelector<HTMLElement>(
              '.result-table .ant-table-thead [data-column-button="category"] + .column-sort-button + .column-filter-button + .column-resize-handle, .result-table .ant-table-thead [data-column-button="category"] ~ .column-resize-handle'
            ) ??
            node.querySelector<HTMLElement>('.result-table .ant-table-thead .column-resize-handle')
          const headerButton = node.querySelector<HTMLElement>(
            '.result-table .ant-table-thead [data-column-button="category"]'
          )
          const bodyCell = node.querySelector<HTMLElement>(
            '.result-table .ant-table-body [data-column-key="category"], .result-table .ant-table-tbody-virtual-holder [data-column-key="category"]'
          )
          if (
            !(handle instanceof HTMLElement) ||
            !(headerButton instanceof HTMLElement) ||
            !(bodyCell instanceof HTMLElement)
          ) {
            return null
          }
          handle.dispatchEvent(
            new PointerEvent('pointerdown', {
              pointerId: target.pointerId,
              button: 0,
              buttons: 1,
              clientX: target.startX,
              clientY: target.startY,
              bubbles: true
            })
          )
          window.dispatchEvent(
            new PointerEvent('pointermove', {
              pointerId: target.pointerId,
              button: 0,
              buttons: 1,
              clientX: target.startX - target.shrinkDistance,
              clientY: target.startY,
              bubbles: true
            })
          )
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
          return {
            headerWidth: (headerButton.closest('th') as HTMLElement).getBoundingClientRect().width,
            bodyWidth: bodyCell.getBoundingClientRect().width
          }
        },
        { ...resizeTarget, shrinkDistance }
      )

      expect(midResize).not.toBeNull()
      expect(
        midResize.headerWidth,
        'header width should not grow while dragging'
      ).toBeLessThanOrEqual(resizeTarget.initialHeaderWidth)
      expect(midResize.bodyWidth, 'body width should not grow while dragging').toBeLessThanOrEqual(
        resizeTarget.initialBodyWidth
      )
      expect(
        Math.abs(midResize.headerWidth - midResize.bodyWidth),
        'header and body width should stay aligned while dragging'
      ).toBeLessThan(4)

      const finalResize = await activeResult.evaluate(
        async (node, target) => {
          window.dispatchEvent(
            new PointerEvent('pointerup', {
              pointerId: target.pointerId,
              button: 0,
              buttons: 0,
              clientX: target.startX - target.shrinkDistance,
              clientY: target.startY,
              bubbles: true
            })
          )
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
          const headerButton = node.querySelector<HTMLElement>(
            '.result-table .ant-table-thead [data-column-button="category"]'
          )
          const bodyCell = node.querySelector<HTMLElement>(
            '.result-table .ant-table-body [data-column-key="category"], .result-table .ant-table-tbody-virtual-holder [data-column-key="category"]'
          )
          if (!(headerButton instanceof HTMLElement) || !(bodyCell instanceof HTMLElement)) {
            return null
          }
          return {
            headerWidth: (headerButton.closest('th') as HTMLElement).getBoundingClientRect().width,
            bodyWidth: bodyCell.getBoundingClientRect().width
          }
        },
        { ...resizeTarget, shrinkDistance }
      )

      expect(finalResize).not.toBeNull()
      expect(
        Math.abs(finalResize.headerWidth - finalResize.bodyWidth),
        'header and body width should remain aligned after releasing the resize handle'
      ).toBeLessThan(4)
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
        open: async () =>
          page.locator('.app-header .toolbar-icon-btn[aria-label="历史查询窗口"]').click(),
        close: async () => page.locator('.query-history-window-modal .ant-modal-close').click(),
        modalSelector: '.query-history-window-modal',
        assertOpen: async (modal) => assertModalCentered(page, modal, 920)
      })
      expect(historyMetrics.openMs, 'history modal opens too slowly').toBeLessThan(1000)
      expect(historyMetrics.closeMs, 'history modal closes too slowly').toBeLessThan(850)

      const settingsMetrics = await measureModalOpenClose(page, {
        label: 'settings',
        open: async () => page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click(),
        close: async () => page.locator('.settings-window-modal .ant-modal-close').click(),
        modalSelector: '.settings-window-modal',
        assertOpen: async (modal) => {
          await assertModalCentered(page, modal, 1160)
          const syncMenuItem = modal
            .locator('.settings-sidebar .ant-menu-item')
            .filter({ hasText: '同步与版本' })
          await expect(syncMenuItem).toBeVisible()
          await expect
            .poll(
              () =>
                syncMenuItem.locator('.ant-menu-title-content').evaluate((node) => {
                  const content = node as HTMLElement
                  return content.scrollWidth <= content.clientWidth
                }),
              { message: '同步与版本菜单项不能显示省略号' }
            )
            .toBe(true)
        }
      })
      expect(settingsMetrics.openMs, 'settings modal opens too slowly').toBeLessThan(900)
      expect(settingsMetrics.closeMs, 'settings modal closes too slowly').toBeLessThan(700)

      const updateMetrics = await measureModalOpenClose(page, {
        label: 'update',
        open: async () =>
          page.locator('.app-header .toolbar-icon-btn[aria-label="检查更新"]').click(),
        close: async () => page.locator('.update-window-modal .ant-modal-close').click(),
        modalSelector: '.update-window-modal',
        assertOpen: async (modal) => assertModalCentered(page, modal, 740)
      })
      expect(updateMetrics.openMs, 'update modal opens too slowly').toBeLessThan(900)
      expect(updateMetrics.closeMs, 'update modal closes too slowly').toBeLessThan(700)

      const importMetrics = await measureModalOpenClose(page, {
        label: 'import-connection',
        open: async () => page.locator('.resource-header .resource-import').click(),
        close: async () => page.locator('.import-connection-modal .ant-modal-close').click(),
        modalSelector: '.import-connection-modal',
        assertOpen: async (modal) => assertModalCentered(page, modal, 960)
      })
      expect(importMetrics.openMs, 'import connection modal opens too slowly').toBeLessThan(900)
      expect(importMetrics.closeMs, 'import connection modal closes too slowly').toBeLessThan(900)

      const createButton = page.locator('.resource-header .resource-add')
      const connectionMetrics = await measureModalOpenClose(page, {
        label: 'connection-editor',
        open: async () => {
          await createButton.click()
          await clickVisibleDropdownMenuItem(page, 'SQLite')
        },
        close: async () => page.locator('.connection-editor-modal .ant-modal-close').click(),
        modalSelector: '.connection-editor-modal',
        assertOpen: async (modal) => assertModalCentered(page, modal, 620)
      })
      expect(connectionMetrics.openMs, 'connection editor opens too slowly').toBeLessThan(1100)
      expect(connectionMetrics.closeMs, 'connection editor closes too slowly').toBeLessThan(700)
    } finally {
      await electronApp.close()
    }
  })

  test('manual AI contexts should provide a temporary primary context and collapse cleanly @bug', async () => {
    const userDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(userDataDir, 'connections.json')
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const baseConnection = connectionStore.connections[0]
    const contextConnectionIds = [
      'ai-context-sqlite-1',
      'ai-context-sqlite-2',
      'ai-context-sqlite-3',
      'ai-context-sqlite-4'
    ]
    connectionStore.connections = contextConnectionIds.map((connectionId, index) => ({
      ...baseConnection,
      connection_id: connectionId,
      name: `AI 上下文库 ${index + 1}`
    }))
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp({
      aiStreamEvents: [{ type: 'done', finish_reason: 'stop' }]
    })
    let page
    let originalAIConfigs

    try {
      page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      originalAIConfigs = await page.evaluate(() => window.api.getAIConfigs())
      await page.evaluate(async () => {
        await window.api.setAIConfigs([
          {
            id: 'ai-context-management-regression',
            name: 'AI context management regression',
            enabled: true,
            provider: 'openai-compatible',
            base_url: 'https://example.com/v1',
            api_key: 'test-key',
            model: 'test-model',
            max_context_tokens: 200000
          }
        ])
      })
      await page.reload()
      await waitForAppReady(page)
      for (const connectionId of contextConnectionIds) {
        const connectionNode = treeNode(page, `connection:${connectionId}`)
        await connectionNode.click()
        const addButton = connectionNode.locator('.tree-ai-context-btn')
        await expect(addButton).toBeVisible({ timeout: 10000 })
        await addButton.click()
      }

      const contextPanel = page.locator('.ai-context-sources')
      await expect(contextPanel).toContainText('4 个')
      await expect(contextPanel.locator('.ai-context-source-item')).toHaveCount(3)
      await expect(contextPanel.locator('.ai-context-source-item').first()).toContainText(
        '临时主上下文'
      )
      await expect(contextPanel.locator('.ai-context-source-item').nth(1)).toContainText('补充')
      await expect(page.getByText('未选择上下文', { exact: true })).toHaveCount(0)

      const input = page.getByPlaceholder('输入问题')
      await input.fill('读取当前上下文')
      await input.press('Enter')
      await expect(page.locator('.ai-message-user').last()).toContainText('读取当前上下文', {
        timeout: 10000
      })
      await expect(page.locator('.ant-modal-confirm-error')).toHaveCount(0)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)

      await contextPanel.getByRole('button', { name: '展开全部上下文' }).click()
      await expect(contextPanel.locator('.ai-context-source-item')).toHaveCount(4)

      const duplicateNode = treeNode(page, `connection:${contextConnectionIds[1]}`)
      await duplicateNode.click()
      await duplicateNode.locator('.tree-ai-context-btn').click()
      await expect(contextPanel).toContainText('4 个')
      await expect(contextPanel.locator('.ai-context-source-item')).toHaveCount(4)

      await contextPanel
        .locator('.ai-context-source-item')
        .first()
        .getByRole('button', { name: '从当前 AI 上下文移除' })
        .click()
      await expect(contextPanel).toContainText('3 个')
      await expect(contextPanel.locator('.ai-context-source-item').first()).toContainText(
        '临时主上下文'
      )
    } finally {
      if (page && originalAIConfigs) {
        await page.evaluate((configs) => window.api.setAIConfigs(configs), originalAIConfigs)
      }
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('AI module should stay unavailable until installed while retaining saved settings and sessions @bug', async () => {
    const userDataDir = readFixtureUserDataDir()
    const electronApp = await launchRegressionApp({ aiModuleEnabled: false })
    let page
    let originalConfigs
    let originalSessions

    try {
      page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      originalConfigs = await page.evaluate(() => window.api.getAIConfigs())
      originalSessions = await page.evaluate(() => window.api.getAISessions())

      await expect(page.locator('.ai-dock-panel')).toHaveCount(0)
      await page.locator('.app-header .toolbar-icon-btn[aria-label="安装 AI 助手模块"]').click()
      const modal = page.locator('.settings-window-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByText('AI 助手模块尚未安装')).toBeVisible()
      await expect(modal.getByRole('button', { name: '安装 AI 助手' })).toBeVisible()

      const message = await page.evaluate(async () => {
        try {
          await window.api.requestJson('/ai/ping', { method: 'POST', body: '{}' })
          return ''
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      })
      expect(message).toContain('AI 助手模块未安装')

      const saved = await page.evaluate(async () => {
        const configs = [
          {
            id: 'legacy-ai-config',
            name: '旧配置',
            enabled: true,
            provider: 'openai-compatible',
            base_url: 'https://example.com/v1',
            api_key: 'legacy-key',
            model: 'legacy-model',
            max_context_tokens: 4096
          }
        ]
        const sessions = [
          { id: 'legacy-ai-session', title: '旧会话', createdAt: 1, updatedAt: 1, messages: [] }
        ]
        await window.api.setAIConfigs(configs)
        await window.api.setAISessions(sessions)
        return {
          configs: await window.api.getAIConfigs(),
          sessions: await window.api.getAISessions()
        }
      })
      expect(saved.configs).toHaveLength(1)
      expect(saved.configs[0].api_key).toBe('legacy-key')
      expect(saved.sessions).toHaveLength(1)
      expect(saved.sessions[0].title).toBe('旧会话')

      const staleInstallPath = path.join(userDataDir, 'modules', 'ai', '1.0.0')
      fs.mkdirSync(staleInstallPath, { recursive: true })
      fs.writeFileSync(path.join(staleInstallPath, 'stale-install.txt'), 'stale', 'utf8')

      await modal.getByRole('button', { name: '安装 AI 助手' }).click()
      await expect(modal.locator('.ai-settings-add-btn')).toBeVisible({ timeout: 90000 })
      await expect(modal).toContainText('旧配置')
      await modal.locator('.ai-settings-primary-btn').click()
      await expect(page.locator('.ant-message').filter({ hasText: 'AI 配置已保存' })).toBeVisible()

      const routeProbe = await page.evaluate(() =>
        window.api.requestJson('/ai/ping', { method: 'POST', body: '{}' })
      )
      expect(routeProbe.__datadjinnApiError).toEqual(expect.any(Array))

      await page.evaluate(() => window.api.uninstallOptionalModule('ai'))
    } finally {
      if (page && originalConfigs && originalSessions) {
        await page.evaluate(
          async ({ configs, sessions }) => {
            await window.api.setAIConfigs(configs)
            await window.api.setAISessions(sessions)
          },
          { configs: originalConfigs, sessions: originalSessions }
        )
      }
      await electronApp.close()
    }
  })

  test('AI settings API key field should keep a single border @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click()
      const modal = page.locator('.settings-window-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByRole('menuitem', { name: 'AI' }).click()
      await modal.locator('.ai-settings-add-btn').click()
      await modal.locator('.ai-config-collapse .ant-collapse-header').first().click()

      const apiKeyInput = modal.locator('.ai-settings-api-key-input input[type="password"]').first()
      await expect(apiKeyInput).toBeVisible({ timeout: 10000 })
      await apiKeyInput.focus()
      const borders = await apiKeyInput.evaluate((node) => {
        const wrapper = node.closest('.ant-input-affix-wrapper')
        if (!(wrapper instanceof HTMLElement)) {
          return null
        }
        const inputStyle = window.getComputedStyle(node)
        const wrapperStyle = window.getComputedStyle(wrapper)
        return {
          inputBorderWidth: inputStyle.borderTopWidth,
          inputBackground: inputStyle.backgroundColor,
          wrapperBorderWidth: wrapperStyle.borderTopWidth
        }
      })

      expect(borders, 'API key password input should keep its affix wrapper').not.toBeNull()
      expect(borders?.inputBorderWidth, 'API key input should not draw an inner border').toBe('0px')
      expect(borders?.inputBackground, 'API key input should inherit the wrapper background').toBe(
        'rgba(0, 0, 0, 0)'
      )
      expect(
        borders?.wrapperBorderWidth,
        'API key wrapper should keep the single visible border'
      ).toBe('1px')
    } finally {
      await electronApp.close()
    }
  })

  test('MCP settings should default to disabled and persist connection restrictions @bug', async () => {
    const electronApp = await launchRegressionApp({ aiModuleEnabled: false })

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const originalSettings = await page.evaluate(() => window.api.getMcpSettings())
      const originalModules = await page.evaluate(() => window.api.getOptionalModules())
      try {
        await page.evaluate(async () => {
          await window.api.uninstallOptionalModule('mcp')
          await window.api.setMcpSettings({
            enabled: false,
            allowWrite: false,
            restrictConnections: false,
            allowedConnectionIds: []
          })
        })
        await page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click()
        const modal = page.locator('.settings-window-modal')
        await modal.getByRole('menuitem', { name: '扩展' }).click()
        const aiModuleCard = modal.locator('.settings-section-card').filter({ hasText: 'AI 助手' })
        await expect(aiModuleCard.getByText('未安装')).toBeVisible()
        const moduleCard = modal.locator('.settings-section-card').filter({ hasText: '本机 MCP 服务' })
        await expect(moduleCard.getByText('未安装')).toBeVisible()
        await moduleCard.locator('.optional-module-install-btn').click()
        await expect(moduleCard.locator('.optional-module-status')).toHaveText('安装中')
        await expect(moduleCard.locator('.optional-module-install-btn')).toBeDisabled()
        await expect(moduleCard.getByText('已安装')).toBeVisible({ timeout: 90000 })

        const firstLaunchConfig = await page.evaluate(() => window.api.getOptionalModuleLaunchConfig('mcp'))
        expect(firstLaunchConfig?.command).toMatch(/[\\/]modules[\\/]mcp[\\/]current[\\/]/i)
        await page.evaluate(() => window.api.installOptionalModule('mcp'))
        const secondLaunchConfig = await page.evaluate(() => window.api.getOptionalModuleLaunchConfig('mcp'))
        expect(secondLaunchConfig?.command).toBe(firstLaunchConfig?.command)

        await modal.getByRole('menuitem', { name: 'MCP' }).click()
        const card = modal.locator('.mcp-settings-card')
        await expect(card.locator('.mcp-launch-command')).toHaveValue(/datadjinn-mcp\.exe$/i)
        await expect(card).toContainText('命令参数：无')
        const switches = card.locator('.ant-switch')
        await expect(switches.nth(0)).toHaveAttribute('aria-checked', 'false')
        await expect(switches.nth(1)).toBeDisabled()
        await switches.nth(0).click()
        await switches.nth(2).click()
        await expect(card.locator('.ant-select')).toBeVisible()
        await card.locator('.ant-select').click()
        await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click()
        await expect.poll(() => page.evaluate(() => window.api.getMcpSettings())).toMatchObject({
          enabled: true,
          allowWrite: false,
          restrictConnections: true,
          allowedConnectionIds: [fixtureConnectionId]
        })
      } finally {
        await page.evaluate(
          async ({ settings, modules }) => {
            const mcpWasInstalled = modules.some((module) => module.id === 'mcp' && module.installed)
            if (mcpWasInstalled) {
              await window.api.installOptionalModule('mcp')
            } else {
              await window.api.uninstallOptionalModule('mcp')
            }
            await window.api.setMcpSettings(settings)
          },
          { settings: originalSettings, modules: originalModules }
        )
      }
    } finally {
      await electronApp.close()
    }
  })

  test('Git version management should silently open a closed connection before reading scopes @bug', async () => {
    const fixtureUserDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(fixtureUserDataDir, 'connections.json')
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const fixtureConnection = connectionStore.connections.find(
      (item) => item.connection_id === fixtureConnectionId
    )
    if (!fixtureConnection) {
      throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
    }
    fixtureConnection.git_versioning_enabled = true
    fixtureConnection.git_versioning_scopes = []
    fixtureConnection.is_open = false
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp({ aiModuleEnabled: false })

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const connectionTitle = page.locator(
        `.connection-tree-title[data-connection-id="${fixtureConnectionId}"]`
      )
      const gitButton = connectionTitle.locator('.connection-git-status-icon')
      await expect(gitButton).toBeVisible({ timeout: 10000 })
      await gitButton.click()

      await expect(page.locator('.connection-schema-version-modal')).toBeVisible({ timeout: 30000 })
      await expect
        .poll(async () => {
          const response = await page.evaluate(() => window.api.requestJson('/connections'))
          return response.connections.find((item) => item.connection_id === fixtureConnectionId)?.is_open
        })
        .toBe(true)
      await expect(page.getByRole('dialog', { name: '操作失败' })).toHaveCount(0)
    } finally {
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('JDBC database support should be discoverable as one extension before installation @bug', async () => {
    const electronApp = await launchRegressionApp({ aiModuleEnabled: false })

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.app-header .toolbar-icon-btn[aria-label="设置"]').click()
      const modal = page.locator('.settings-window-modal')
      await modal.getByRole('menuitem', { name: '扩展' }).click()

      const jdbcCard = modal.locator('.settings-section-card').filter({ hasText: 'JDBC 数据库支持' })
      await expect(jdbcCard.getByText('未安装')).toBeVisible()
      await expect(modal.getByText('Java 17 运行时')).toHaveCount(0)

      await modal.getByRole('menuitem', { name: '驱动管理' }).click()
      await expect(modal.locator('.settings-jdbc-card')).toContainText('JDBC 数据库支持尚未安装')
    } finally {
      await electronApp.close()
    }
  })

  test('JDBC database support should install as one extension and provide a usable Java runtime @bug', async () => {
    const electronApp = await launchRegressionApp({ aiModuleEnabled: false })
    let page
    let installedJdbc = false

    try {
      page = await electronApp.firstWindow()
      await waitForAppReady(page)

      await page.evaluate(async () => {
        await window.api.uninstallOptionalModule('jdbc')
        await window.api.installOptionalModule('jdbc')
      })
      installedJdbc = true

      await expect
        .poll(() => page.evaluate(() => window.api.getBackendStatus().then((status) => status.state)), {
          timeout: 60000
        })
        .toBe('online')
      const runtimeState = await page.evaluate(async () => ({
        modules: await window.api.getOptionalModules(),
        java: await window.api.requestJson('/drivers/java')
      }))
      expect(runtimeState.modules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'jdbc', installed: true })
        ])
      )
      expect(runtimeState.modules).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'jdbc-runtime' }),
          expect.objectContaining({ id: 'jre-17' })
        ])
      )
      expect(runtimeState.java.runtimes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            major: expect.any(Number),
            jvm_path: expect.stringMatching(/jvm\.dll$/i)
          })
        ])
      )
    } finally {
      if (page && installedJdbc) {
        await page.evaluate(() => window.api.uninstallOptionalModule('jdbc'))
      }
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
        ;(
          window as typeof window & {
            __connectionModalFrameSamples__?: Array<{
              hasSqlitePath: boolean
              hasHost: boolean
              text: string
              visible: boolean
            }>
          }
        ).__connectionModalFrameSamples__ = []
      })

      const captureFrames = page.evaluate(async () => {
        const frameSamples =
          (
            window as typeof window & {
              __connectionModalFrameSamples__?: Array<{
                hasSqlitePath: boolean
                hasHost: boolean
                text: string
                visible: boolean
              }>
            }
          ).__connectionModalFrameSamples__ ?? []
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

      await clickVisibleDropdownMenuItem(page, 'MySQL')

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.getByLabel(/^主机$/)).toBeVisible({ timeout: 10000 })

      const frameSamples = await captureFrames

      expect(
        frameSamples.firstVisibleSample?.hasHost ?? false,
        `the first visible frame should already show the selected database form: ${JSON.stringify(frameSamples.samples)}`
      ).toBe(true)
      expect(
        frameSamples.sawSqlitePath,
        `opening MySQL connection editor should not flash SQLite fields: ${JSON.stringify(frameSamples.samples)}`
      ).toBe(false)

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
      expect(
        sqliteMetrics.menuOpenMs,
        'create menu should open within the agreed front-end budget on first click'
      ).toBeLessThan(300)
      expect(
        sqliteMetrics.modalOpenMs,
        'opening the SQLite connection editor should stay within a pure front-end budget'
      ).toBeLessThan(300)

      const mysqlMetrics = await measureConnectionCreateFlow(page, 'MySQL')
      expect(
        mysqlMetrics.menuOpenMs,
        'create menu should stay within the agreed front-end budget on repeat opens'
      ).toBeLessThan(300)
      expect(
        mysqlMetrics.modalOpenMs,
        'opening the MySQL connection editor should stay within a pure front-end budget'
      ).toBeLessThan(300)
    } finally {
      await electronApp.close()
    }
  })

  test('SQLite connection editor should keep only the outer form frame @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await clickVisibleDropdownMenuItem(page, 'SQLite')

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      const frames = await modal.evaluate((node) => {
        const form = node.querySelector('.connection-editor-form')
        const main = node.querySelector('.connection-editor-layout-single .connection-editor-main')
        if (!(form instanceof HTMLElement) || !(main instanceof HTMLElement)) {
          return null
        }
        const formStyle = window.getComputedStyle(form)
        const mainStyle = window.getComputedStyle(main)
        return {
          formBorderWidth: formStyle.borderTopWidth,
          mainBorderWidth: mainStyle.borderTopWidth,
          mainBackground: mainStyle.backgroundColor,
          mainBoxShadow: mainStyle.boxShadow
        }
      })

      expect(
        frames,
        'SQLite editor should render both the form and its main content'
      ).not.toBeNull()
      expect(frames?.formBorderWidth, 'SQLite editor should retain the outer form frame').toBe(
        '1px'
      )
      expect(
        frames?.mainBorderWidth,
        'SQLite editor main content should not draw an inner frame'
      ).toBe('0px')
      expect(frames?.mainBackground, 'SQLite editor main content should be transparent').toBe(
        'rgba(0, 0, 0, 0)'
      )
      expect(
        frames?.mainBoxShadow,
        'SQLite editor main content should not draw an inner shadow'
      ).toBe('none')
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
        const transferGroup = node.querySelector('.resource-transfer-group')
        const importButton = node.querySelector('.resource-transfer-segment-import')
        const exportButton = node.querySelector('.resource-transfer-segment-export')
        const divider = node.querySelector('.resource-transfer-divider')
        const addButton = node.querySelector('.resource-add')
        if (
          !(kicker instanceof HTMLElement) ||
          !(title instanceof HTMLElement) ||
          !(transferGroup instanceof HTMLElement) ||
          !(importButton instanceof HTMLElement) ||
          !(exportButton instanceof HTMLElement) ||
          !(divider instanceof HTMLElement) ||
          !(addButton instanceof HTMLElement)
        ) {
          return null
        }

        const headerStyle = window.getComputedStyle(node)
        const titleRect = title.getBoundingClientRect()
        const transferRect = transferGroup.getBoundingClientRect()
        const importRect = importButton.getBoundingClientRect()
        const exportRect = exportButton.getBoundingClientRect()
        const dividerRect = divider.getBoundingClientRect()
        const addRect = addButton.getBoundingClientRect()

        return {
          flexDirection: headerStyle.flexDirection,
          headerClientWidth: node.clientWidth,
          headerScrollWidth: node.scrollWidth,
          headerHeight: node.getBoundingClientRect().height,
          kickerDisplay: window.getComputedStyle(kicker).display,
          titleMid: titleRect.top + titleRect.height / 2,
          importMid: importRect.top + importRect.height / 2,
          titleWidth: titleRect.width,
          titleHeight: titleRect.height,
          transferWidth: transferRect.width,
          importWidth: importRect.width,
          exportWidth: exportRect.width,
          dividerWidth: dividerRect.width,
          dividerLeft: dividerRect.left,
          transferLeft: transferRect.left,
          dividerTop: dividerRect.top,
          dividerBottom: dividerRect.bottom,
          dividerTransform: window.getComputedStyle(divider).transform,
          addWidth: addRect.width
        }
      })

      expect(headerLayout, 'resource header layout metrics should be readable').not.toBeNull()
      if (!headerLayout) {
        return
      }

      expect(
        headerLayout.flexDirection,
        'resource header should keep a single-row layout at minimum width'
      ).toBe('row')
      expect(
        headerLayout.headerScrollWidth,
        'resource header should not overflow horizontally at minimum width'
      ).toBeLessThanOrEqual(headerLayout.headerClientWidth + 1)
      expect(
        headerLayout.titleWidth,
        'resource title should stay horizontal instead of collapsing vertically'
      ).toBeGreaterThan(headerLayout.titleHeight * 2)
      expect(
        headerLayout.headerHeight,
        'resource header should stay compact instead of stacking into multiple rows'
      ).toBeLessThan(76)
      expect(
        headerLayout.kickerDisplay,
        'DATABASE EXPLORER label should hide before it collides with the buttons'
      ).toBe('none')
      expect(
        Math.abs(headerLayout.titleMid - headerLayout.importMid),
        'title and actions should remain visually centered on a single row'
      ).toBeLessThanOrEqual(3)
      expect(
        headerLayout.transferWidth,
        'import/export group should stay narrower than the previous wide version'
      ).toBeLessThan(118)
      expect(
        headerLayout.transferWidth,
        'import/export group should preserve a readable total width budget'
      ).toBeGreaterThan(98)
      expect(headerLayout.importWidth, 'import segment should stay readable').toBeGreaterThan(36)
      expect(headerLayout.exportWidth, 'export segment should stay readable').toBeGreaterThan(36)
      expect(Math.abs(headerLayout.importWidth - headerLayout.exportWidth)).toBeLessThanOrEqual(1)
      expect(
        headerLayout.dividerWidth,
        'import/export divider should stay one physical CSS pixel'
      ).toBe(1)
      expect(
        Math.abs(
          headerLayout.dividerLeft - headerLayout.transferLeft - headerLayout.transferWidth / 2
        )
      ).toBeLessThanOrEqual(0.1)
      expect(headerLayout.dividerBottom - headerLayout.dividerTop).toBeGreaterThan(18)
      expect(headerLayout.dividerTransform, 'import/export divider should not be transformed').toBe(
        'none'
      )
      expect(
        headerLayout.addWidth,
        'create button should stay wide enough to render normally'
      ).toBeGreaterThan(64)
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
        const transferGroup = node.querySelector('.resource-transfer-group')
        const importButton = node.querySelector('.resource-transfer-segment-import')
        const exportButton = node.querySelector('.resource-transfer-segment-export')
        const addButton = node.querySelector('.resource-add')
        if (
          !(kicker instanceof HTMLElement) ||
          !(title instanceof HTMLElement) ||
          !(transferGroup instanceof HTMLElement) ||
          !(importButton instanceof HTMLElement) ||
          !(exportButton instanceof HTMLElement) ||
          !(addButton instanceof HTMLElement)
        ) {
          return null
        }

        const headerStyle = window.getComputedStyle(node)
        const kickerRect = kicker.getBoundingClientRect()
        const titleRect = title.getBoundingClientRect()
        const transferRect = transferGroup.getBoundingClientRect()
        const importRect = importButton.getBoundingClientRect()
        const exportRect = exportButton.getBoundingClientRect()
        const addRect = addButton.getBoundingClientRect()

        return {
          flexDirection: headerStyle.flexDirection,
          kickerDisplay: window.getComputedStyle(kicker).display,
          kickerWidth: kickerRect.width,
          titleMid: titleRect.top + titleRect.height / 2,
          importMid: importRect.top + importRect.height / 2,
          importTop: importRect.top,
          importRight: transferRect.right,
          headerRight: node.getBoundingClientRect().right,
          addTop: addRect.top,
          transferWidth: transferRect.width,
          importWidth: importRect.width,
          exportWidth: exportRect.width,
          addWidth: addRect.width
        }
      })

      expect(
        headerLayout,
        'resource header layout metrics should be readable at medium narrow width'
      ).not.toBeNull()
      if (!headerLayout) {
        return
      }

      expect(
        headerLayout.flexDirection,
        'resource header should stay on one row at medium narrow width'
      ).toBe('row')
      expect(
        headerLayout.kickerDisplay,
        'DATABASE EXPLORER label should stay hidden while the sidebar is still too narrow for both title and actions'
      ).toBe('none')
      expect(
        headerLayout.kickerWidth,
        'hidden english label should not keep occupying horizontal space'
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(headerLayout.titleMid - headerLayout.importMid),
        'title and action row should stay visually centered'
      ).toBeLessThanOrEqual(3)
      expect(
        headerLayout.importRight,
        'buttons should stay within the header bounds at medium narrow width'
      ).toBeLessThanOrEqual(headerLayout.headerRight + 1)
      expect(
        headerLayout.transferWidth,
        'import/export group should keep a narrower but stable total width at medium narrow width'
      ).toBeLessThan(114)
      expect(
        headerLayout.transferWidth,
        'import/export group should keep a stable total width at medium narrow width'
      ).toBeGreaterThan(94)
      expect(
        headerLayout.importWidth,
        'import segment should keep a readable width at medium narrow width'
      ).toBeGreaterThan(34)
      expect(
        headerLayout.exportWidth,
        'export segment should keep a readable width at medium narrow width'
      ).toBeGreaterThan(34)
      expect(
        headerLayout.addWidth,
        'create button should keep a readable width at medium narrow width'
      ).toBeGreaterThan(64)
      expect(
        Math.abs(headerLayout.importTop - headerLayout.addTop),
        'buttons should stay aligned on the same row'
      ).toBeLessThanOrEqual(3)
    } finally {
      await electronApp.close()
    }
  })

  test('connection transfer UI should expose export fields and import DataDjinn bundles @bug', async () => {
    const electronApp = await launchRegressionApp()
    const connectionName = 'UI import export ' + crypto.randomUUID().slice(0, 8)
    const { encryptConnectionTransferBundle } =
      await import('../../src/renderer/src/app/connection-transfer')

    const encryptedBundle = await encryptConnectionTransferBundle(
      {
        version: 1,
        exported_at: new Date().toISOString(),
        source_app_name: 'DataDjinn',
        source_app_version: '0.2.7',
        connections: [
          {
            export_id: 'ui-import-export',
            payload: {
              name: connectionName,
              database_type: 'mysql',
              host: '127.0.0.1',
              port: 3306,
              username: 'root',
              password: 'db-export-secret',
              database: 'demo',
              ssh_enabled: true,
              ssh_host: '127.0.0.2',
              ssh_port: 22,
              ssh_username: 'jump-user',
              ssh_auth_type: 'password',
              ssh_password: 'ssh-export-secret'
            }
          }
        ],
        folders: [],
        connection_folder_assignments: {},
        connection_folder_order: [],
        root_connection_order: ['ui-import-export'],
        root_item_order: ['connection:ui-import-export'],
        folder_connection_order: {}
      },
      'transfer-passphrase'
    )

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-transfer-segment-export').click()
      const exportModal = page.locator('.export-connection-modal')
      await expect(exportModal).toBeVisible({ timeout: 10000 })
      await expect(exportModal.locator('input[type="password"]')).toHaveCount(2)
      await exportModal.locator('.ant-modal-close').click()
      await expect(exportModal).not.toBeVisible({ timeout: 10000 })

      await page.evaluate((content) => {
        window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__ = 'virtual-transfer.ddj'
        window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_CONTENT__ = content
      }, encryptedBundle)

      await page.locator('.resource-import').click()
      const importModal = page.locator('.import-connection-modal')
      await expect(importModal).toBeVisible({ timeout: 10000 })
      await importModal.locator('.ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: 'DataDjinn' })
        .click()
      await importModal.locator('.import-connection-file-row .ant-btn').click()
      await importModal.locator('input[type="password"]').fill('transfer-passphrase')
      await importModal.locator('.ant-modal-footer .ant-btn').nth(1).click()
      await expect(importModal.locator('.ant-table')).toBeVisible({ timeout: 10000 })
      await expect(importModal).toContainText(connectionName)
      await importModal.locator('.ant-modal-footer .ant-btn-primary').click()

      const resultModal = page.locator('.import-connection-result-modal')
      await expect(resultModal).toBeVisible({ timeout: 10000 })
      await expect(resultModal.locator('.ant-alert')).toBeVisible()

      const importedCount = await page.evaluate(async (targetName) => {
        const response = await window.api.requestJson('/connections')
        return Array.isArray(response?.connections)
          ? response.connections.filter((item) => item?.name === targetName).length
          : 0
      }, connectionName)
      expect(importedCount).toBe(1)
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(async (targetName) => {
          try {
            const response = await window.api.requestJson('/connections')
            const targets = Array.isArray(response?.connections)
              ? response.connections.filter((item) => item?.name === targetName)
              : []
            for (const target of targets) {
              await window.api.requestJson('/connections/' + target.connection_id, {
                method: 'DELETE'
              })
            }
          } catch {
            // Ignore cleanup failures in regression teardown.
          }
        }, connectionName)
      }
      await electronApp.close()
    }
  })

  test('DBeaver import should show the default path tip and restore folder structure from data-sources.json @bug', async () => {
    const electronApp = await launchRegressionApp()
    const importedMysqlName = `DBeaver MySQL ${crypto.randomUUID().slice(0, 8)}`
    const importedPgName = `DBeaver PG ${crypto.randomUUID().slice(0, 8)}`
    const dbeaverFilePath = path.join(
      projectRoot,
      '.tmp',
      `dbeaver-import-${crypto.randomUUID().slice(0, 8)}.json`
    )
    const folderNames = ['沈阳信息中心', '空分组', '实验局']

    fs.writeFileSync(
      dbeaverFilePath,
      JSON.stringify(
        {
          folders: {
            [folderNames[0]]: {},
            [folderNames[1]]: {},
            [folderNames[2]]: {}
          },
          connections: {
            'mysql8-1': {
              provider: 'mysql',
              driver: 'mysql8',
              name: importedMysqlName,
              folder: folderNames[0],
              configuration: {
                host: '10.41.26.8',
                port: '3306',
                database: 'analytics',
                url: 'jdbc:mysql://10.41.26.8:3306/analytics',
                user: 'root'
              }
            },
            'postgres-jdbc-1': {
              provider: 'postgresql',
              driver: 'postgres-jdbc',
              name: importedPgName,
              configuration: {
                url: 'jdbc:postgresql://10.41.26.6:15432/reporting',
                user: 'report'
              }
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    let folderStateSnapshot = null

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      folderStateSnapshot = await page.evaluate(() => ({
        folders: localStorage.getItem('datadjinn-connection-folders'),
        assignments: localStorage.getItem('datadjinn-connection-folder-assignments'),
        folderOrder: localStorage.getItem('datadjinn-connection-folder-order'),
        rootConnectionOrder: localStorage.getItem('datadjinn-root-connection-order'),
        rootItemOrder: localStorage.getItem('datadjinn-root-item-order'),
        folderConnectionOrder: localStorage.getItem('datadjinn-folder-connection-order')
      }))

      await page.locator('.resource-import').click()
      const importModal = page.locator('.import-connection-modal')
      await expect(importModal).toBeVisible({ timeout: 10000 })
      await importModal.locator('.ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: 'DBeaver' })
        .click()
      await expect(importModal).toContainText(
        '用户目录\\AppData\\Roaming\\DBeaverData\\workspace6\\General\\.dbeaver\\data-sources.json'
      )
      await page.evaluate((filePath) => {
        window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__ = filePath
      }, dbeaverFilePath)
      await importModal.locator('.import-connection-file-row .ant-btn').click()
      await expect(importModal.locator('.import-connection-file-row input')).toHaveValue(
        dbeaverFilePath
      )
      await importModal.locator('.ant-modal-footer .ant-btn').nth(1).click()
      await expect(importModal.locator('.ant-table')).toBeVisible({ timeout: 10000 })
      await expect(importModal).toContainText(importedMysqlName)
      await expect(importModal).toContainText(folderNames[0])
      await importModal.locator('.ant-modal-footer .ant-btn-primary').click()

      const resultModal = page.locator('.import-connection-result-modal')
      await expect(resultModal).toBeVisible({ timeout: 10000 })

      const importedState = await page.evaluate(
        async ({ mysqlName, pgName }) => {
          const response = await window.api.requestJson('/connections')
          const connections = Array.isArray(response?.connections) ? response.connections : []
          const mysqlConnection = connections.find((item) => item?.name === mysqlName) ?? null
          const pgConnection = connections.find((item) => item?.name === pgName) ?? null
          const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
          const assignments = JSON.parse(
            localStorage.getItem('datadjinn-connection-folder-assignments') ?? '{}'
          )
          const rootItemOrder = JSON.parse(
            localStorage.getItem('datadjinn-root-item-order') ?? '[]'
          )
          const folderConnectionOrder = JSON.parse(
            localStorage.getItem('datadjinn-folder-connection-order') ?? '{}'
          )
          return {
            mysqlConnectionId: mysqlConnection?.connection_id ?? null,
            pgConnectionId: pgConnection?.connection_id ?? null,
            folderNames: Array.isArray(folders) ? folders.map((item) => item?.name) : [],
            assignments,
            rootItemOrder,
            folderConnectionOrder
          }
        },
        {
          mysqlName: importedMysqlName,
          pgName: importedPgName
        }
      )

      expect(importedState.mysqlConnectionId).toBeTruthy()
      expect(importedState.pgConnectionId).toBeTruthy()
      expect(importedState.folderNames).toEqual(expect.arrayContaining(folderNames))

      const importedMysqlFolderId = importedState.assignments[importedState.mysqlConnectionId]
      expect(
        importedMysqlFolderId,
        'imported DBeaver connection should be assigned into its folder'
      ).toBeTruthy()
      expect(
        importedState.rootItemOrder.some(
          (itemId) => typeof itemId === 'string' && itemId.startsWith('folder:')
        ),
        'parsed DBeaver folders should participate in root item order'
      ).toBe(true)
      expect(
        Object.values(importedState.folderConnectionOrder).some(
          (connectionIds) =>
            Array.isArray(connectionIds) && connectionIds.includes(importedState.mysqlConnectionId)
        ),
        'folder connection order should include the imported folder member'
      ).toBe(true)
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(
          async ({ mysqlName, pgName, snapshot }) => {
            try {
              const response = await window.api.requestJson('/connections')
              const targets = Array.isArray(response?.connections)
                ? response.connections.filter(
                    (item) => item?.name === mysqlName || item?.name === pgName
                  )
                : []
              for (const target of targets) {
                await window.api.requestJson('/connections/' + target.connection_id, {
                  method: 'DELETE'
                })
              }
            } catch {
              // Ignore cleanup failures in regression teardown.
            }

            const restoreKey = (key, value) => {
              if (typeof value === 'string') {
                localStorage.setItem(key, value)
                return
              }
              localStorage.removeItem(key)
            }

            restoreKey('datadjinn-connection-folders', snapshot?.folders)
            restoreKey('datadjinn-connection-folder-assignments', snapshot?.assignments)
            restoreKey('datadjinn-connection-folder-order', snapshot?.folderOrder)
            restoreKey('datadjinn-root-connection-order', snapshot?.rootConnectionOrder)
            restoreKey('datadjinn-root-item-order', snapshot?.rootItemOrder)
            restoreKey('datadjinn-folder-connection-order', snapshot?.folderConnectionOrder)
            delete window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__
          },
          {
            mysqlName: importedMysqlName,
            pgName: importedPgName,
            snapshot: folderStateSnapshot
          }
        )
      }
      try {
        fs.rmSync(dbeaverFilePath, { force: true })
      } catch {
        // Ignore cleanup failures for temporary import files.
      }
      await electronApp.close()
    }
  })

  test('DBeaver import should merge into an existing folder with the same name instead of creating a suffixed duplicate @bug', async () => {
    const electronApp = await launchRegressionApp()
    const importedMysqlName = `DBeaver Merge ${crypto.randomUUID().slice(0, 8)}`
    const dbeaverFilePath = path.join(
      projectRoot,
      '.tmp',
      `dbeaver-import-merge-${crypto.randomUUID().slice(0, 8)}.json`
    )
    const existingFolderId = `folder-${crypto.randomUUID().slice(0, 8)}`
    const existingFolderName = 'Shared Import Group'

    fs.writeFileSync(
      dbeaverFilePath,
      JSON.stringify(
        {
          folders: {
            [existingFolderName]: {}
          },
          connections: {
            'mysql8-merge-1': {
              provider: 'mysql',
              driver: 'mysql8',
              name: importedMysqlName,
              folder: existingFolderName,
              configuration: {
                host: '10.41.26.8',
                port: '3306',
                database: 'analytics',
                url: 'jdbc:mysql://10.41.26.8:3306/analytics',
                user: 'root'
              }
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    let folderStateSnapshot = null

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      folderStateSnapshot = await page.evaluate(() => ({
        folders: localStorage.getItem('datadjinn-connection-folders'),
        assignments: localStorage.getItem('datadjinn-connection-folder-assignments'),
        folderOrder: localStorage.getItem('datadjinn-connection-folder-order'),
        rootConnectionOrder: localStorage.getItem('datadjinn-root-connection-order'),
        rootItemOrder: localStorage.getItem('datadjinn-root-item-order'),
        folderConnectionOrder: localStorage.getItem('datadjinn-folder-connection-order')
      }))

      await page.evaluate(
        ({ folderId, folderName }) => {
          localStorage.setItem(
            'datadjinn-connection-folders',
            JSON.stringify([{ id: folderId, name: folderName }])
          )
          localStorage.setItem('datadjinn-connection-folder-assignments', JSON.stringify({}))
          localStorage.setItem('datadjinn-connection-folder-order', JSON.stringify([folderId]))
          localStorage.setItem('datadjinn-root-connection-order', JSON.stringify([]))
          localStorage.setItem('datadjinn-root-item-order', JSON.stringify([`folder:${folderId}`]))
          localStorage.setItem(
            'datadjinn-folder-connection-order',
            JSON.stringify({ [folderId]: [] })
          )
        },
        {
          folderId: existingFolderId,
          folderName: existingFolderName
        }
      )
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-import').click()
      const importModal = page.locator('.import-connection-modal')
      await expect(importModal).toBeVisible({ timeout: 10000 })
      await importModal.locator('.ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: 'DBeaver' })
        .click()
      await page.evaluate((filePath) => {
        window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__ = filePath
      }, dbeaverFilePath)
      await importModal.locator('.import-connection-file-row .ant-btn').click()
      await expect(importModal.locator('.import-connection-file-row input')).toHaveValue(
        dbeaverFilePath
      )
      await importModal.locator('.ant-modal-footer .ant-btn').nth(1).click()
      await expect(importModal.locator('.ant-table')).toBeVisible({ timeout: 10000 })
      await expect(importModal).toContainText(importedMysqlName)
      await importModal.locator('.ant-modal-footer .ant-btn-primary').click()

      const resultModal = page.locator('.import-connection-result-modal')
      await expect(resultModal).toBeVisible({ timeout: 10000 })

      const importedState = await page.evaluate(
        async ({ folderId, folderName, mysqlName }) => {
          const response = await window.api.requestJson('/connections')
          const connections = Array.isArray(response?.connections) ? response.connections : []
          const mysqlConnection = connections.find((item) => item?.name === mysqlName) ?? null
          const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
          const assignments = JSON.parse(
            localStorage.getItem('datadjinn-connection-folder-assignments') ?? '{}'
          )
          const connectionFolderOrder = JSON.parse(
            localStorage.getItem('datadjinn-connection-folder-order') ?? '[]'
          )
          const rootItemOrder = JSON.parse(
            localStorage.getItem('datadjinn-root-item-order') ?? '[]'
          )
          const folderConnectionOrder = JSON.parse(
            localStorage.getItem('datadjinn-folder-connection-order') ?? '{}'
          )
          const normalizedFolderNames = Array.isArray(folders)
            ? folders
                .map((item) => (typeof item?.name === 'string' ? item.name : ''))
                .filter(Boolean)
            : []
          return {
            mysqlConnectionId: mysqlConnection?.connection_id ?? null,
            folderNames: normalizedFolderNames,
            assignments,
            connectionFolderOrder,
            rootItemOrder,
            folderConnectionOrder,
            matchingFolderCount: normalizedFolderNames.filter((name) => name === folderName).length,
            suffixedFolderCount: normalizedFolderNames.filter(
              (name) => name === `${folderName}（1）`
            ).length,
            reusedFolderAssignment: mysqlConnection
              ? assignments[mysqlConnection.connection_id] === folderId
              : false
          }
        },
        {
          folderId: existingFolderId,
          folderName: existingFolderName,
          mysqlName: importedMysqlName
        }
      )

      expect(importedState.mysqlConnectionId).toBeTruthy()
      expect(importedState.matchingFolderCount).toBe(1)
      expect(importedState.suffixedFolderCount).toBe(0)
      expect(
        importedState.reusedFolderAssignment,
        'imported connection should reuse the existing folder id'
      ).toBe(true)
      expect(importedState.connectionFolderOrder).toEqual([existingFolderId])
      expect(
        importedState.rootItemOrder.filter((itemId) => itemId === `folder:${existingFolderId}`)
      ).toHaveLength(1)
      expect(importedState.folderConnectionOrder[existingFolderId]).toContain(
        importedState.mysqlConnectionId
      )
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(
          async ({ mysqlName, snapshot }) => {
            try {
              const response = await window.api.requestJson('/connections')
              const targets = Array.isArray(response?.connections)
                ? response.connections.filter((item) => item?.name === mysqlName)
                : []
              for (const target of targets) {
                await window.api.requestJson('/connections/' + target.connection_id, {
                  method: 'DELETE'
                })
              }
            } catch {
              // Ignore cleanup failures in regression teardown.
            }

            const restoreKey = (key, value) => {
              if (typeof value === 'string') {
                localStorage.setItem(key, value)
                return
              }
              localStorage.removeItem(key)
            }

            restoreKey('datadjinn-connection-folders', snapshot?.folders)
            restoreKey('datadjinn-connection-folder-assignments', snapshot?.assignments)
            restoreKey('datadjinn-connection-folder-order', snapshot?.folderOrder)
            restoreKey('datadjinn-root-connection-order', snapshot?.rootConnectionOrder)
            restoreKey('datadjinn-root-item-order', snapshot?.rootItemOrder)
            restoreKey('datadjinn-folder-connection-order', snapshot?.folderConnectionOrder)
            delete window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__
          },
          {
            mysqlName: importedMysqlName,
            snapshot: folderStateSnapshot
          }
        )
      }
      try {
        fs.rmSync(dbeaverFilePath, { force: true })
      } catch {
        // Ignore cleanup failures for temporary import files.
      }
      await electronApp.close()
    }
  })

  test('connection transfer should roundtrip through a real exported ddj file @bug', async () => {
    const electronApp = await launchRegressionApp()
    const exportedFilePath = path.join(
      projectRoot,
      '.tmp',
      `connection-transfer-roundtrip-${crypto.randomUUID().slice(0, 8)}.ddj`
    )
    const importedConnectionName = `Roundtrip import ${crypto.randomUUID().slice(0, 8)}`
    const { decryptConnectionTransferBundle, encryptConnectionTransferBundle } =
      await import('../../src/renderer/src/app/connection-transfer')

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.evaluate((filePath) => {
        window.__DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_PATH__ = filePath
        delete window.__DATADJINN_TEST_CONNECTION_TRANSFER_EXPORT_HANDLER__
      }, exportedFilePath)

      await page.locator('.resource-transfer-segment-export').click()
      const exportModal = page.locator('.export-connection-modal')
      await expect(exportModal).toBeVisible({ timeout: 10000 })
      await exportModal.locator('input[type="password"]').nth(0).fill('Cafe\u0301 transfer 123')
      await exportModal.locator('input[type="password"]').nth(1).fill('Cafe\u0301 transfer 123')
      await exportModal.locator('.ant-modal-footer .ant-btn-primary').click()
      await expect(exportModal).not.toBeVisible({ timeout: 10000 })
      expect(fs.existsSync(exportedFilePath), 'export should create a real ddj file on disk').toBe(
        true
      )

      const exportedRawText = fs.readFileSync(exportedFilePath, 'utf-8')
      const exportedBundle = await decryptConnectionTransferBundle(
        exportedRawText,
        'Caf\u00e9 transfer 123'
      )
      expect(
        exportedBundle.connections.length,
        'exported ddj file should contain at least one connection'
      ).toBeGreaterThan(0)
      exportedBundle.connections[0]!.payload.name = importedConnectionName
      fs.writeFileSync(
        exportedFilePath,
        await encryptConnectionTransferBundle(exportedBundle, 'Cafe\u0301 transfer 123'),
        'utf-8'
      )

      await page.evaluate((filePath) => {
        window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_FILE_PATH__ = filePath
        delete window.__DATADJINN_TEST_CONNECTION_TRANSFER_IMPORT_CONTENT__
      }, exportedFilePath)

      await page.locator('.resource-import').click()
      const importModal = page.locator('.import-connection-modal')
      await expect(importModal).toBeVisible({ timeout: 10000 })
      await importModal.locator('.ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: 'DataDjinn' })
        .click()
      await importModal.locator('.import-connection-file-row .ant-btn').click()
      await importModal.locator('input[type="password"]').fill('Caf\u00e9 transfer 123')
      await importModal.locator('.ant-modal-footer .ant-btn').nth(1).click()
      await expect(importModal.locator('.ant-table')).toBeVisible({ timeout: 10000 })
      await expect(importModal).toContainText(importedConnectionName)
      await importModal.locator('.ant-modal-footer .ant-btn-primary').click()

      const resultModal = page.locator('.import-connection-result-modal')
      await expect(resultModal).toBeVisible({ timeout: 10000 })

      const importedCount = await page.evaluate(async (targetName) => {
        const response = await window.api.requestJson('/connections')
        return Array.isArray(response?.connections)
          ? response.connections.filter((item) => item?.name === targetName).length
          : 0
      }, importedConnectionName)
      expect(importedCount).toBe(1)
    } finally {
      const page = electronApp.windows().length > 0 ? electronApp.windows()[0] : null
      if (page) {
        await page.evaluate(async (targetName) => {
          try {
            const response = await window.api.requestJson('/connections')
            const targets = Array.isArray(response?.connections)
              ? response.connections.filter((item) => item?.name === targetName)
              : []
            for (const target of targets) {
              await window.api.requestJson('/connections/' + target.connection_id, {
                method: 'DELETE'
              })
            }
          } catch {
            // Ignore cleanup failures in regression teardown.
          }
        }, importedConnectionName)
      }
      try {
        fs.rmSync(exportedFilePath, { force: true })
      } catch {
        // Ignore cleanup failures for temporary export files.
      }
      await electronApp.close()
    }
  })

  test('import connection password field should only keep a single outer border @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-import').click()
      const importModal = page.locator('.import-connection-modal')
      await expect(importModal).toBeVisible({ timeout: 10000 })
      await importModal.locator('.ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: 'DataDjinn' })
        .click()
      await expect(importModal.locator('input[type="password"]')).toBeVisible({ timeout: 10000 })

      const metrics = await importModal
        .locator('input[type="password"]')
        .first()
        .evaluate((node) => {
          const input = node instanceof HTMLInputElement ? node : null
          const wrapper = input?.closest('.ant-input-affix-wrapper')
          if (!(wrapper instanceof HTMLElement) || !(input instanceof HTMLElement)) {
            return null
          }
          const wrapperStyle = window.getComputedStyle(wrapper)
          const inputStyle = window.getComputedStyle(input)
          return {
            wrapperBorderTopWidth: wrapperStyle.borderTopWidth,
            wrapperBorderTopStyle: wrapperStyle.borderTopStyle,
            inputBorderTopWidth: inputStyle.borderTopWidth,
            inputBorderTopStyle: inputStyle.borderTopStyle,
            inputBoxShadow: inputStyle.boxShadow,
            inputBackgroundImage: inputStyle.backgroundImage,
            inputBackgroundColor: inputStyle.backgroundColor
          }
        })

      expect(metrics, 'import password field metrics should be readable').not.toBeNull()
      if (!metrics) {
        return
      }

      expect(
        Number.parseFloat(metrics.wrapperBorderTopWidth),
        'password wrapper should keep the single visible border'
      ).toBeGreaterThan(0)
      expect(
        metrics.wrapperBorderTopStyle,
        'password wrapper should keep the visible outer border'
      ).not.toBe('none')
      expect(
        Number.parseFloat(metrics.inputBorderTopWidth),
        'inner password input should not render its own border'
      ).toBe(0)
      expect(
        metrics.inputBorderTopStyle === 'none' || metrics.inputBorderTopStyle === 'solid',
        'inner password input should not draw a second border line'
      ).toBe(true)
      expect(
        metrics.inputBoxShadow,
        'inner password input should not draw an extra glow ring'
      ).toBe('none')
      expect(
        metrics.inputBackgroundImage,
        'inner password input should not paint a second background layer'
      ).toBe('none')
      expect(
        metrics.inputBackgroundColor === 'rgba(0, 0, 0, 0)' ||
          metrics.inputBackgroundColor === 'transparent',
        'inner password input should stay transparent'
      ).toBe(true)
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
          kickerTop: kicker.getBoundingClientRect().top
        }
      })

      expect(
        headerLayout,
        'resource header english label metrics should be readable at roomy width'
      ).not.toBeNull()
      if (!headerLayout) {
        return
      }

      expect(
        headerLayout.kickerDisplay,
        'DATABASE EXPLORER label should be visible again once the panel is wide enough'
      ).not.toBe('none')
      expect(
        headerLayout.kickerWidth,
        'visible english label should occupy real width'
      ).toBeGreaterThan(40)
      expect(
        headerLayout.kickerTop,
        'english label should remain above the chinese title inside the copy block'
      ).toBeLessThanOrEqual(headerLayout.titleTop)
    } finally {
      await electronApp.close()
    }
  })

  test('resource create dropdown should keep the glass panel styling @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await expect
        .poll(async () => readVisibleResourceCreateDropdownMetrics(page), { timeout: 10000 })
        .not.toBeNull()
      const metrics = await readVisibleResourceCreateDropdownMetrics(page)
      expect(metrics, 'resource create dropdown metrics should be readable').not.toBeNull()
      if (!metrics) {
        return
      }

      expect(
        Number.parseFloat(metrics.borderRadius),
        'create dropdown should keep rounded corners'
      ).toBeGreaterThanOrEqual(16)
      expect(metrics.boxShadow, 'create dropdown should keep a floating glass shadow').not.toBe(
        'none'
      )
      expect(
        metrics.backgroundImage,
        'create dropdown should keep layered gradients instead of a flat fallback background'
      ).toContain('gradient')
      expect(
        metrics.backgroundImage,
        'create dropdown should keep multiple glass highlight layers'
      ).toContain('radial-gradient')
      expect(
        metrics.backdropFilter,
        'create dropdown should avoid live backdrop blur to keep remote sessions stable'
      ).toBe('none')
      expect(
        metrics.webkitBackdropFilter ?? 'none',
        'create dropdown should avoid live backdrop blur to keep remote sessions stable'
      ).toBe('none')
    } finally {
      await electronApp.close()
    }
  })

  test('resource create dropdown should stay bright in light theme @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const currentTheme = await page.evaluate(() => document.body.getAttribute('data-theme'))
      if (currentTheme === 'dark') {
        await page.locator('.theme-toggle-btn').click()
      }
      await expect
        .poll(async () => page.evaluate(() => document.body.getAttribute('data-theme')), {
          timeout: 10000
        })
        .toBe('light')

      await page.locator('.resource-header .resource-add').click()
      await expect
        .poll(async () => readVisibleResourceCreateDropdownMetrics(page), { timeout: 10000 })
        .not.toBeNull()
      const metrics = await readVisibleResourceCreateDropdownMetrics(page)
      expect(metrics, 'light theme dropdown metrics should be readable').not.toBeNull()
      if (!metrics) {
        return
      }

      expect(
        metrics.backgroundImage,
        'light theme create dropdown should still keep layered gradients'
      ).toContain('gradient')
      expect(
        metrics.rgb,
        'light theme create dropdown should keep a bright background tone'
      ).not.toBeNull()
      expect(
        metrics.rgb?.[0] ?? 0,
        'light theme create dropdown should not regress to a dark background'
      ).toBeGreaterThan(220)
      expect(
        metrics.rgb?.[1] ?? 0,
        'light theme create dropdown should not regress to a dark background'
      ).toBeGreaterThan(220)
      expect(
        metrics.rgb?.[2] ?? 0,
        'light theme create dropdown should not regress to a dark background'
      ).toBeGreaterThan(220)
    } finally {
      await electronApp.close()
    }
  })

  test('empty workspace create dropdown should reuse the shared stable glass styling @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.empty-workspace-button-primary').click()
      await expect
        .poll(async () => readVisibleResourceCreateDropdownMetrics(page), { timeout: 10000 })
        .not.toBeNull()
      const metrics = await readVisibleResourceCreateDropdownMetrics(page)
      expect(metrics, 'empty workspace dropdown metrics should be readable').not.toBeNull()
      if (!metrics) {
        return
      }

      expect(
        metrics.backgroundImage,
        'empty workspace create dropdown should reuse the shared gradient styling'
      ).toContain('gradient')
      expect(
        metrics.backgroundImage,
        'empty workspace create dropdown should reuse radial highlight layers'
      ).toContain('radial-gradient')
      expect(
        Number.parseFloat(metrics.borderRadius),
        'empty workspace create dropdown should keep the same rounded panel'
      ).toBeGreaterThanOrEqual(16)
      expect(
        metrics.backdropFilter,
        'empty workspace create dropdown should avoid live backdrop blur for remote stability'
      ).toBe('none')
      expect(
        metrics.webkitBackdropFilter ?? 'none',
        'empty workspace create dropdown should avoid live backdrop blur for remote stability'
      ).toBe('none')
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
      await clickVisibleDropdownMenuItem(page, 'MySQL')

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

      const connectionNode = page
        .locator('.resource-tree-node-title')
        .filter({ hasText: connectionName })
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
              await window.api.requestJson(`/connections/${target.connection_id}`, {
                method: 'DELETE'
              })
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
      await clickVisibleDropdownMenuItem(page, 'MySQL')

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
              await window.api.requestJson(`/connections/${target.connection_id}`, {
                method: 'DELETE'
              })
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
      await clickVisibleDropdownMenuItem(page, 'MySQL')

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
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: '私钥文件' })
        .click()
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
              await window.api.requestJson(`/connections/${target.connection_id}`, {
                method: 'DELETE'
              })
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
      await clickVisibleDropdownMenuItem(page, 'MySQL')

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
              await window.api.requestJson(`/connections/${target.connection_id}`, {
                method: 'DELETE'
              })
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
      await clickVisibleDropdownMenuItem(page, 'MySQL')

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
          '.connection-editor-side-card .ant-form-item-row'
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
      expect(
        cardItemBackgrounds.every((item) => item && item.backgroundColor === 'rgba(0, 0, 0, 0)'),
        `connection editor form item backgrounds should stay transparent: ${JSON.stringify(cardItemBackgrounds)}`
      ).toBe(true)

      await modal.getByRole('switch').click()
      const sshHostInput = modal.getByLabel('SSH 主机')
      await expect(sshHostInput).toBeVisible()
      await expect.poll(async () => sshHostInput.getAttribute('placeholder')).toBeNull()
      await expect(modal.getByPlaceholder('请输入 SSH 用户名')).toBeVisible()
      await expect(modal.getByPlaceholder('请输入 SSH 登录密码')).toBeVisible()
      await expect(modal.getByRole('button', { name: '测试 SSH' })).toBeVisible()
      await expect(modal.locator('.connection-editor-side')).toContainText('密码认证')

      await modal.locator('.connection-editor-side .ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: '私钥文件' })
        .click()
      await expect(
        modal.getByPlaceholder('例如：C:\\Users\\你的用户名\\.ssh\\id_rsa')
      ).toBeVisible()
      await expect(modal.getByPlaceholder('请输入 SSH 登录密码')).not.toBeVisible()

      await modal.locator('.connection-editor-side .ant-select').click()
      await page
        .locator('.ant-select-dropdown .ant-select-item-option')
        .filter({ hasText: '密码认证' })
        .click()
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

  test('closing the connection editor should clear a pending SSH test loading state @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      await page.locator('.resource-header .resource-add').click()
      await clickVisibleDropdownMenuItem(page, 'MySQL')

      const modal = page.locator('.connection-editor-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByRole('switch').click()
      await modal.getByLabel('SSH 主机').fill('203.0.113.1')
      await modal.getByLabel('SSH 用户名').fill('jump-user')
      await modal.getByLabel('SSH 密码').fill('ssh-secret')

      const sshTestButton = modal.locator('.connection-editor-ssh-test-btn')
      await sshTestButton.click()
      await expect(sshTestButton).toHaveClass(/ant-btn-loading/)

      await modal.locator('.ant-modal-close').click()
      await expect(modal).not.toBeVisible({ timeout: 10000 })

      await page.locator('.resource-header .resource-add').click()
      await clickVisibleDropdownMenuItem(page, 'MySQL')
      const reopenedModal = page.locator('.connection-editor-modal')
      await expect(reopenedModal).toBeVisible({ timeout: 10000 })
      await expect(reopenedModal.locator('.connection-editor-ssh-test-btn')).not.toHaveClass(
        /ant-btn-loading/
      )
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

      const activeResult = page.locator(
        '.workspace-tab-panels .workspace-active-content .result-table'
      )

      const readBg = async (selector) =>
        activeResult.evaluate((node, sel) => {
          const el = node.querySelector(sel)
          if (!(el instanceof HTMLElement)) return null
          const style = window.getComputedStyle(el)
          const canvas = document.createElement('canvas')
          canvas.width = 1
          canvas.height = 1
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
      if (!firstCellInfo || !firstCellInfo.rowKey) {
        return
      }

      // First click the cell to get cell selection color
      const cellEl = activeResult.locator(
        '.editable-cell[data-cell-key="' + firstCellInfo.cellKey + '"]'
      )
      await cellEl.first().click()
      await page.waitForTimeout(120)

      const cellBg = await readBg('.editable-cell[data-cell-key="' + firstCellInfo.cellKey + '"]')
      expect(cellBg).not.toBeNull()

      // Then click row button to switch to row selection and compare
      const rowBtn = activeResult.locator(
        '.row-number-button[data-row-key="' + firstCellInfo.rowKey + '"]'
      )
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
          c.width = 1
          c.height = 1
          const ctx = c.getContext('2d', { willReadFrequently: true })
          if (!ctx) return color
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')'
        }
        const host = document.querySelector(
          '.workspace-active-content [data-column-key="category"].column-selected-runtime'
        )
        const cell = document.querySelector(
          '.workspace-active-content .editable-cell[data-cell-column-key="category"]'
        )
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

      await page
        .locator('.editable-cell[data-cell-key="' + info.cellKey + '"]')
        .first()
        .hover()
      await page.waitForTimeout(400)

      const afterInfo = await page.evaluate(() => {
        const readBg = (color) => {
          const c = document.createElement('canvas')
          c.width = 1
          c.height = 1
          const ctx = c.getContext('2d', { willReadFrequently: true })
          if (!ctx) return color
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')'
        }
        const host = document.querySelector(
          '.workspace-active-content [data-column-key="category"].column-selected-runtime'
        )
        const cell = document.querySelector(
          '.workspace-active-content .editable-cell[data-cell-column-key="category"]'
        )
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

  test('row and column selection should replace cell selection and survive virtual scrolling @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const targets = await activeResult.evaluate((node) => {
        const cells = Array.from(node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]'))
        const first = cells[0]
        const neighbor = cells.find(
          (cell) =>
            cell.dataset.rowKey === first?.dataset.rowKey &&
            cell.dataset.cellColumnKey !== first?.dataset.cellColumnKey
        )
        if (!(first instanceof HTMLElement) || !(neighbor instanceof HTMLElement)) {
          return null
        }
        return {
          firstCellKey: first.dataset.cellKey ?? '',
          rowKey: first.dataset.rowKey ?? '',
          column: first.dataset.cellColumnKey ?? '',
          neighborCellKey: neighbor.dataset.cellKey ?? ''
        }
      })
      expect(targets).not.toBeNull()
      if (!targets) {
        throw new Error('selection targets are unavailable')
      }

      const cell = (cellKey: string) =>
        activeResult.locator(`.editable-cell[data-cell-key="${cellKey}"]:visible`).first()
      await cell(targets.firstCellKey).click()
      await cell(targets.neighborCellKey).click({ modifiers: ['Shift'] })
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(2)

      const rowButton = activeResult
        .locator(`.ant-table-row[data-row-key="${targets.rowKey}"] .row-number-button`)
        .first()
      await rowButton.click()
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(0)
      await expect(rowButton).toHaveClass(/selected/)

      const holder = activeResult.locator(
        '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
      )
      await holder.evaluate((element) => {
        element.scrollTop = 420
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
      })
      await page.waitForTimeout(180)
      await holder.evaluate((element) => {
        element.scrollTop = 0
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
      })
      await expect(rowButton).toHaveClass(/selected/)

      await activeResult.locator(`[data-column-button="${targets.column}"]`).first().click()
      await expect(activeResult.locator('.row-number-button.selected')).toHaveCount(0)
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(0)

      await holder.evaluate((element) => {
        element.scrollTop = 420
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
      })
      await expect(
        activeResult.locator(
          `.editable-cell[data-cell-column-key="${targets.column}"].column-selected-runtime-inner`
        ).first()
      ).toBeVisible()
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
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
        )
        const first = cells[0]
        if (!(first instanceof HTMLElement)) {
          return null
        }
        const firstRowKey = first.dataset.rowKey
        const firstColumnKey = first.dataset.cellColumnKey
        const nextRowCell = cells.find(
          (cell) =>
            cell.dataset.rowKey !== firstRowKey && cell.dataset.cellColumnKey === firstColumnKey
        )
        if (!(nextRowCell instanceof HTMLElement)) {
          return null
        }
        const firstRect = first.getBoundingClientRect()
        const nextRect = nextRowCell.getBoundingClientRect()
        return {
          firstCellKey: first.dataset.cellKey,
          nextCellKey: nextRowCell.dataset.cellKey,
          start: { x: firstRect.x + firstRect.width / 2, y: firstRect.y + firstRect.height / 2 },
          end: { x: nextRect.x + nextRect.width / 2, y: nextRect.y + nextRect.height / 2 }
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
      expect(
        selectedColors.next,
        'drag selection should keep the same light background across adjacent rows'
      ).toBe(selectedColors.first)
    } finally {
      await electronApp.close()
    }
  })

  test('cell range selection should stay within the selected cell bounds @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark') {
        await page.locator('.theme-toggle-btn').click()
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe('light')
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
      await expect(editorTextbox).toBeVisible({ timeout: 30000 })
      await editorTextbox.focus()
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        "select case when id % 2 = 0 then '' else null end as left_blank, case when id % 2 = 0 then null else '' end as middle_blank, 'active' as status from large_items order by id limit 5;"
      )
      await page.locator('.query-execute-button').first().click()
      await expect(
        page.locator(
          '.workspace-tab-panels .workspace-active-content .editable-cell[data-cell-column-key="left_blank"]'
        )
      ).toHaveCount(5, { timeout: 30000 })

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const targets = await activeResult.evaluate((node) => {
        const leftCells = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-column-key="left_blank"]')
        ).slice(0, 3)
        const endRowKey = leftCells.at(-1)?.dataset.rowKey
        const middleEndCell = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-column-key="middle_blank"]')
        ).find((cell) => cell.dataset.rowKey === endRowKey)
        if (leftCells.length !== 3 || !(middleEndCell instanceof HTMLElement)) {
          return null
        }
        const rowKeys = leftCells.map((cell) => cell.dataset.rowKey ?? '')
        const selectedCellKeys = rowKeys.flatMap((rowKey) => [
          `${rowKey}:left_blank`,
          `${rowKey}:middle_blank`
        ])
        const toTarget = (cell: HTMLElement) => {
          const rect = cell.getBoundingClientRect()
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          }
        }
        return {
          start: toTarget(leftCells[0]),
          end: toTarget(middleEndCell),
          selectedCellKeys
        }
      })
      expect(targets).not.toBeNull()

      const startCell = activeResult.locator(
        `.editable-cell[data-cell-key="${targets.selectedCellKeys[0]}"]`
      )
      const endCell = activeResult.locator(
        `.editable-cell[data-cell-key="${targets.selectedCellKeys.at(-1)}"]`
      )
      await startCell.click()
      await endCell.click({ modifiers: ['Shift'] })
      await expect(activeResult.locator('.editable-cell.cell-selected-runtime')).toHaveCount(6)

      const selectionGeometry = await activeResult.evaluate((node, cellKeys) => {
        const cells = cellKeys
          .map((cellKey) =>
            node.querySelector<HTMLElement>(
              `.editable-cell.cell-selected-runtime[data-cell-key="${CSS.escape(cellKey)}"]`
            )
          )
          .filter((cell): cell is HTMLElement => cell instanceof HTMLElement)
        if (cells.length !== cellKeys.length) {
          return null
        }
        return cells.map((cell) => {
          const rect = cell.getBoundingClientRect()
          const host = cell.closest<HTMLElement>('td, .ant-table-cell')
          const style = host ? window.getComputedStyle(host) : null
          return {
            top: rect.top,
            bottom: rect.bottom,
            cellBackgroundColor: window.getComputedStyle(cell).backgroundColor,
            hostBackgroundColor: style?.backgroundColor ?? '',
            borderBottomColor: style?.borderBottomColor ?? '',
            selectionTailContent: window.getComputedStyle(cell, '::after').content
          }
        })
      }, targets.selectedCellKeys)
      expect(selectionGeometry).not.toBeNull()
      expect(selectionGeometry).toHaveLength(6)
      expect(
        selectionGeometry[0].borderBottomColor,
        'the selected cell divider should remain visible'
      ).not.toBe(selectionGeometry[0].cellBackgroundColor)
      expect(
        selectionGeometry[2].borderBottomColor,
        'the selected cell divider should remain visible'
      ).not.toBe(selectionGeometry[2].cellBackgroundColor)
      expect(
        selectionGeometry.every((geometry) => geometry.selectionTailContent === 'none'),
        'selected cell background must not extend below the cell with a pseudo-element'
      ).toBe(true)
      expect(
        selectionGeometry.every(
          (geometry) => geometry.hostBackgroundColor === geometry.cellBackgroundColor
        ),
        'selected cell hosts must fill the row with the selection color'
      ).toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('virtual horizontal scrollbar should remain stable while dragging @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const metrics = await activeResult.evaluate((node) => {
        const scrollbar = node.querySelector<HTMLElement>(
          '.ant-table-tbody-virtual-scrollbar-horizontal'
        )
        const verticalScrollbar = node.querySelector<HTMLElement>(
          '.ant-table-tbody-virtual-scrollbar-vertical'
        )
        const virtualBody = node.querySelector<HTMLElement>('.ant-table-tbody-virtual')
        const inner = node.querySelector<HTMLElement>('.ant-table-tbody-virtual-holder-inner')
        if (
          !(scrollbar instanceof HTMLElement) ||
          !(virtualBody instanceof HTMLElement) ||
          !(inner instanceof HTMLElement)
        ) {
          return null
        }
        const rect = scrollbar.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y + rect.height / 2,
          width: rect.width,
          height: rect.height,
          verticalWidth: verticalScrollbar?.getBoundingClientRect().width ?? 0,
          maxScrollLeft: inner.scrollWidth - virtualBody.clientWidth
        }
      })
      expect(metrics).not.toBeNull()
      console.log(`[perf][horizontal-scrollbar][layout] ${JSON.stringify(metrics)}`)
      expect(
        metrics.height,
        'virtual horizontal scrollbar should match the compact vertical scrollbar thickness'
      ).toBeLessThanOrEqual(6)
      expect(
        metrics.verticalWidth,
        'virtual vertical scrollbar should replace the native scrollbar arrows'
      ).toBeGreaterThan(0)
      expect(metrics.verticalWidth).toBeLessThanOrEqual(6)
      expect(metrics.maxScrollLeft, 'fixture table should overflow horizontally').toBeGreaterThan(
        40
      )

      await page.mouse.move(metrics.x + 5, metrics.y)
      await page.mouse.down()
      const samples = []
      for (const ratio of [0.2, 0.4, 0.6, 0.8]) {
        await page.mouse.move(metrics.x + metrics.width * ratio, metrics.y, { steps: 8 })
        await page.waitForTimeout(40)
        samples.push(
          await activeResult.evaluate((node) => {
            const inner = node.querySelector<HTMLElement>('.ant-table-tbody-virtual-holder-inner')
            return {
              offset: Math.max(0, -Number.parseFloat(inner?.style.marginLeft || '0'))
            }
          })
        )
      }
      await page.mouse.up()

      console.log(`[perf][horizontal-scrollbar][drag] ${JSON.stringify(samples)}`)

      expect(
        samples.at(-1).offset,
        'dragging the horizontal scrollbar should reach the dragged position instead of resetting'
      ).toBeGreaterThan(metrics.maxScrollLeft * 0.55)
      for (let index = 1; index < samples.length; index += 1) {
        expect(
          samples[index].offset - samples[index - 1].offset,
          'horizontal scrollbar position should not jump backward while dragging'
        ).toBeGreaterThanOrEqual(-2)
      }
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
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
        )
        const first = cells[0]
        if (!(first instanceof HTMLElement)) {
          return null
        }

        const firstRowKey = first.dataset.rowKey ?? ''
        const firstColumnKey = first.dataset.cellColumnKey ?? ''
        const rowNeighbor = cells.find(
          (cell) =>
            cell.dataset.rowKey === firstRowKey && cell.dataset.cellColumnKey !== firstColumnKey
        )
        const columnNeighbor = cells.find(
          (cell) =>
            cell.dataset.rowKey !== firstRowKey && cell.dataset.cellColumnKey === firstColumnKey
        )
        const visibleColumns = Array.from(
          new Set(cells.map((cell) => cell.dataset.cellColumnKey).filter(Boolean))
        )
        const thirdColumnKey = visibleColumns[2]
        const visibleRowKeys = Array.from(
          new Set(cells.map((cell) => cell.dataset.rowKey).filter(Boolean))
        )
        const thirdColumnDragEnd = cells.find(
          (cell) =>
            cell.dataset.rowKey === visibleRowKeys[Math.min(5, visibleRowKeys.length - 1)] &&
            cell.dataset.cellColumnKey === thirdColumnKey
        )
        const firstHostCell = first.closest<HTMLElement>(
          'td[data-row-key], .ant-table-cell[data-row-key]'
        )
        const firstRowElement = firstHostCell?.closest<HTMLElement>(
          'tr[data-row-key], .ant-table-row[data-row-key]'
        )
        const rowButton = firstRowElement?.querySelector<HTMLElement>('.row-number-button')
        const columnButton = node.querySelector<HTMLElement>(
          `[data-column-button="${CSS.escape(firstColumnKey)}"]`
        )
        const thirdColumnButton = node.querySelector<HTMLElement>(
          `[data-column-button="${CSS.escape(thirdColumnKey ?? '')}"]`
        )
        if (
          !(rowNeighbor instanceof HTMLElement) ||
          !(columnNeighbor instanceof HTMLElement) ||
          !(thirdColumnDragEnd instanceof HTMLElement) ||
          !(rowButton instanceof HTMLElement) ||
          !(columnButton instanceof HTMLElement) ||
          !(thirdColumnButton instanceof HTMLElement)
        ) {
          return null
        }

        const center = (element) => {
          const rect = element.getBoundingClientRect()
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2
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
          thirdColumnDragEnd: center(thirdColumnDragEnd),
          rowButton: center(rowButton),
          columnButton: center(columnButton),
          thirdColumnButton: center(thirdColumnButton),
          tableBody: center(tableBodyHost),
          rowKey: firstRowKey,
          columnKey: firstColumnKey,
          thirdColumnKey,
          expectedDraggedCellCount: (Math.min(5, visibleRowKeys.length - 1) + 1) * 3
        }
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.start.x, selectionTargets.start.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.rowDragEnd.x, selectionTargets.rowDragEnd.y, {
        steps: 10
      })
      await page.mouse.up()
      await page.waitForTimeout(120)

      await page.mouse.move(selectionTargets.rowButton.x, selectionTargets.rowButton.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.tableBody.x, selectionTargets.tableBody.y, {
        steps: 2
      })
      await page.mouse.up()
      await page.waitForTimeout(120)

      const afterRowSelection = await activeResult.evaluate(async (node, rowKey) => {
        const snapshot = () => ({
          runtimeCells: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
          runtimeHosts: node.querySelectorAll(
            'td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host'
          ).length,
          selectedRows: node.querySelectorAll(
            `tr[data-row-key="${CSS.escape(rowKey)}"].row-selected, .ant-table-row[data-row-key="${CSS.escape(rowKey)}"].row-selected`
          ).length,
          selectedRowButtons: Array.from(
            node.querySelectorAll<HTMLElement>('tr[data-row-key], .ant-table-row[data-row-key]')
          ).filter(
            (rowElement) =>
              rowElement.dataset.rowKey === rowKey &&
              rowElement.querySelector('.row-number-button.selected')
          ).length
        })
        const frames = [snapshot()]
        for (let index = 0; index < 4; index += 1) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
          frames.push(snapshot())
        }
        return { final: frames.at(-1)!, frames }
      }, selectionTargets.rowKey)

      expect(
        afterRowSelection.final.runtimeCells,
        'clicking a row number after drag selection should clear previous cell runtime selection immediately'
      ).toBe(0)
      expect(
        afterRowSelection.final.runtimeHosts,
        'clicking a row number after drag selection should clear previous cell host highlight immediately'
      ).toBe(0)
      expect(
        afterRowSelection.final.selectedRows,
        'clicking a row number should still keep the row selection row state visible'
      ).toBeGreaterThan(0)
      expect(
        afterRowSelection.final.selectedRowButtons,
        'clicking a row number should still keep the row selection visible'
      ).toBeGreaterThan(0)
      expect(
        afterRowSelection.frames.every(
          (frame) => frame.runtimeCells === 0 && frame.runtimeHosts === 0
        ),
        'row selection must not restore ordinary cell selection in later animation frames'
      ).toBe(true)

      await page.mouse.move(selectionTargets.start.x, selectionTargets.start.y)
      await page.mouse.down()
      await page.mouse.move(selectionTargets.thirdColumnDragEnd.x, selectionTargets.thirdColumnDragEnd.y, {
        steps: 10
      })
      await page.mouse.up()
      await page.waitForTimeout(120)

      await expect(
        activeResult.locator('.editable-cell.cell-selected-runtime'),
        '拖选后必须先形成横跨三列的普通单元格选区，避免列选择用例在空选区上通过'
      ).toHaveCount(selectionTargets.expectedDraggedCellCount)

      await page.mouse.click(selectionTargets.thirdColumnButton.x, selectionTargets.thirdColumnButton.y)
      await page.waitForTimeout(120)

      const afterColumnSelection = await activeResult.evaluate(async (node, columnKey) => {
        const snapshot = () => ({
          runtimeCells: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
          runtimeHosts: node.querySelectorAll(
            'td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host'
          ).length,
          selectedColumnHosts: node.querySelectorAll(
            `[data-column-key="${CSS.escape(columnKey)}"].column-selected-runtime`
          ).length,
          selectedColumnInners: node.querySelectorAll(
            `.editable-cell[data-cell-column-key="${CSS.escape(columnKey)}"].column-selected-runtime-inner`
          ).length,
          staleCellBackgrounds: Array.from(
            node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
          ).filter((cell) => {
            if (cell.dataset.cellColumnKey === columnKey) {
              return false
            }
            const host = cell.closest<HTMLElement>('td, .ant-table-cell')
            return Boolean(host?.style.background || host?.style.backgroundColor)
          }).length
        })
        const frames = [snapshot()]
        for (let index = 0; index < 4; index += 1) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
          frames.push(snapshot())
        }
        return { final: frames.at(-1)!, frames }
      }, selectionTargets.thirdColumnKey)

      expect(
        afterColumnSelection.final.runtimeCells,
        'clicking a column selector after drag selection should clear previous cell runtime selection immediately'
      ).toBe(0)
      expect(
        afterColumnSelection.final.runtimeHosts,
        'clicking a column selector after drag selection should clear previous cell host highlight immediately'
      ).toBe(0)
      expect(
        afterColumnSelection.final.selectedColumnHosts,
        'clicking a column selector should still keep the column host selection visible'
      ).toBeGreaterThan(0)
      expect(
        afterColumnSelection.final.selectedColumnInners,
        'clicking a column selector should still keep the column inner selection visible'
      ).toBeGreaterThan(0)
      expect(
        afterColumnSelection.final.staleCellBackgrounds,
        'clicking the final column header after a three-column drag must clear inline selection backgrounds from the other columns'
      ).toBe(0)
      expect(
        afterColumnSelection.frames.every(
          (frame) =>
            frame.runtimeCells === 0 &&
            frame.runtimeHosts === 0 &&
            frame.staleCellBackgrounds === 0
        ),
        'column selection must not restore ordinary cell selection in later animation frames'
      ).toBe(true)
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
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.fill(`${editableTarget.originalText}__refresh__`)
      await inlineEditor.press('Enter')
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toContainText('未提交', { timeout: 10000 })

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

      await page
        .locator(
          '.workspace-tab-panels .workspace-active-content .table-toolbar-inline-actions [aria-label="刷新"]'
        )
        .click()
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toHaveCount(0, { timeout: 10000 })
      await expect(
        activeResult.locator(`.editable-cell[data-cell-key="${editableTarget.cellKey}"]`)
      ).toContainText(editableTarget.originalText, { timeout: 10000 })
      await page.waitForTimeout(300)

      const counters = await page.evaluate(() => {
        const payload = window.__datadjinnPreviewRefreshCounter
        payload?.restore?.()
        delete window.__datadjinnPreviewRefreshCounter
        return payload?.counters ?? null
      })

      expect(counters).not.toBeNull()
      expect(
        counters.previewResolvedLogs,
        'clicking the preview table refresh button should trigger a new preview request'
      ).toBeGreaterThan(0)
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
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      const editedText = `${editableTarget.originalText}__edited__`
      await inlineEditor.fill(editedText)
      await inlineEditor.press('Enter')
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toContainText('未提交', { timeout: 10000 })
      const visibleCell = activeResult.locator(
        `.editable-cell[data-cell-key="${editableTarget.cellKey}"]`
      )
      await expectCellTextExactly(visibleCell, editedText)

      await activeResult.locator('.table-toolbar-inline-actions [aria-label="刷新"]').click()
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toHaveCount(0, { timeout: 10000 })

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
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.fill(`${editableTarget.originalText}__draft__`)

      await activeResult.locator('.table-toolbar-inline-actions [aria-label="刷新"]').click()
      await expect(inlineEditor).toHaveCount(0, { timeout: 10000 })
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toHaveCount(0, { timeout: 10000 })

      const visibleCell = activeResult.locator(
        `.editable-cell[data-cell-key="${editableTarget.cellKey}"]`
      )
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
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toContainText('未提交', { timeout: 10000 })
      const visibleCell = activeResult.locator(
        `.editable-cell[data-cell-key="${editableTarget.cellKey}"]`
      )
      await expectCellTextExactly(visibleCell, editedText)

      await activeResult.locator('.table-toolbar-inline-actions [aria-label="刷新"]').click()
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toHaveCount(0, { timeout: 10000 })

      await expectCellTextExactly(visibleCell, editableTarget.text)

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await expect(inlineEditor).toHaveValue(editableTarget.text)
    } finally {
      await electronApp.close()
    }
  })

  test('long cell text should restore ellipsis after blur editing and selection @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const target = await activeResult.evaluate((node) => {
        const cell = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-column-key="payload"]')
        ).find((candidate) => {
          const text = candidate.querySelector<HTMLElement>('.table-cell-text')
          return Boolean(text && text.scrollWidth > text.clientWidth)
        })
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          cellKey: cell.dataset.cellKey ?? '',
          text: cell.textContent ?? '',
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(target).not.toBeNull()
      if (!target) {
        throw new Error('long editable cell target is unavailable')
      }

      const cell = activeResult.locator(`.editable-cell[data-cell-key="${target.cellKey}"]`)
      await cell.dblclick()
      await expect(activeResult.locator('.editable-cell-dom-input')).toBeVisible({ timeout: 10000 })
      await activeResult.locator('.result-status').click()
      await expect(activeResult.locator('.editable-cell-dom-input')).toHaveCount(0, { timeout: 10000 })

      const assertDisplay = async () => {
        const state = await cell.evaluate((node) => {
          const display = node.querySelector<HTMLElement>('.table-cell-text')
          if (!(display instanceof HTMLElement)) {
            return null
          }
          const style = window.getComputedStyle(display)
          return {
            text: display.textContent ?? '',
            textOverflow: style.textOverflow,
            overflow: style.overflow,
            whiteSpace: style.whiteSpace,
            clientWidth: display.clientWidth,
            scrollWidth: display.scrollWidth
          }
        })
        expect(state).not.toBeNull()
        expect(state?.text).toBe(target.text)
        expect(state?.textOverflow).toBe('ellipsis')
        expect(state?.overflow).toBe('hidden')
        expect(state?.whiteSpace).toBe('nowrap')
        expect(state?.scrollWidth).toBeGreaterThan(state?.clientWidth ?? 0)
      }

      await assertDisplay()
      await cell.click()
      await assertDisplay()
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
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toContainText('未提交', { timeout: 10000 })
      const visibleCell = activeResult.locator(
        `.editable-cell[data-cell-key="${editableTarget.cellKey}"]`
      )
      await expectCellTextExactly(visibleCell, editedText)

      await activeResult.locator('.table-toolbar-inline-actions [aria-label="刷新"]').click()
      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toHaveCount(0, { timeout: 10000 })

      await expectCellTextExactly(visibleCell, editableTarget.text)

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await expect(inlineEditor).toHaveValue(editableTarget.text)
    } finally {
      await electronApp.close()
    }
  })

  test('preview table chrome should stay visually stable for drag selection and toolbar actions @bug', async () => {
    test.skip(!process.env.CI, 'pixel sampling repaints a visible local Electron window')
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
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
        timeout: 30000
      })

      const targets = await activeResult.evaluate((node) => {
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
        )
        const first = cells[0]
        const second = cells[1]
        const searchButton = node.querySelector<HTMLElement>('.table-toolbar-toggle')
        const ddlButton = node.querySelector<HTMLElement>('.table-ddl-button')
        if (
          !(first instanceof HTMLElement) ||
          !(second instanceof HTMLElement) ||
          !(searchButton instanceof HTMLElement) ||
          !(ddlButton instanceof HTMLElement)
        ) {
          return null
        }
        const center = (element) => {
          const rect = element.getBoundingClientRect()
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2
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
      await waitForVisualSettle(page)

      let clips = await readStableChromeClips(page)
      const dragHashes = await sampleClipHashes(page, clips)
      console.log(`[perf][preview-chrome][drag-hashes] ${JSON.stringify(dragHashes)}`)
      expect(
        dragHashes.tableHeader?.unique.length ?? 0,
        'drag selection should not make the table header flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
      expect(
        dragHashes.whereShell?.unique.length ?? 0,
        'drag selection should not make the where row flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
      expect(
        dragHashes.aiHeader?.unique.length ?? 0,
        'drag selection should not make the ai header flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)

      await page.mouse.click(targets.search.x, targets.search.y)
      await expect(
        activeResult.locator('.result-table-search-overlay .table-search-bar')
      ).toBeVisible({ timeout: 10000 })
      await waitForVisualSettle(page)
      clips = await readStableChromeClips(page)
      const searchHashes = await sampleClipHashes(page, clips)
      console.log(`[perf][preview-chrome][search-hashes] ${JSON.stringify(searchHashes)}`)
      expect(
        searchHashes.tableHeader?.unique.length ?? 0,
        'opening search should settle the table header quickly instead of flashing repeatedly'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
      expect(
        searchHashes.whereShell?.unique.length ?? 0,
        'opening search should settle the where row quickly instead of flashing repeatedly'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
      expect(
        searchHashes.aiHeader?.unique.length ?? 0,
        'opening search should not make the ai header flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)

      await page.keyboard.press('Escape')
      await expect(
        activeResult.locator('.result-table-search-overlay .table-search-bar')
      ).toHaveCount(0)

      await page.mouse.click(targets.ddl.x, targets.ddl.y)
      await expect(page.locator('.ddl-preview-shell')).toBeVisible({ timeout: 10000 })
      await waitForVisualSettle(page)
      clips = await readStableChromeClips(page)
      const ddlHashes = await sampleClipHashes(page, clips)
      console.log(`[perf][preview-chrome][ddl-hashes] ${JSON.stringify(ddlHashes)}`)
      expect(
        ddlHashes.tableHeader?.unique.length ?? 0,
        'opening ddl should not make the table header flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
      expect(
        ddlHashes.whereShell?.unique.length ?? 0,
        'opening ddl should not make the where row flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
      expect(
        ddlHashes.aiHeader?.unique.length ?? 0,
        'opening ddl should not make the ai header flicker'
      ).toBeLessThanOrEqual(MAX_STABLE_CHROME_HASHES)
    } finally {
      await electronApp.close()
    }
  })

  test('clearing drag cell selection should visually settle in one frame @bug', async () => {
    test.skip(!process.env.CI, 'pixel sampling repaints a visible local Electron window')
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
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell[data-cell-key]')
        )
        const first = cells[0]
        if (!(first instanceof HTMLElement)) {
          return null
        }
        const sameColumnNextRow = cells.find(
          (cell) =>
            cell.dataset.rowKey !== first.dataset.rowKey &&
            cell.dataset.cellColumnKey === first.dataset.cellColumnKey
        )
        const status = node.querySelector<HTMLElement>('.result-status')
        if (!(sameColumnNextRow instanceof HTMLElement) || !(status instanceof HTMLElement)) {
          return null
        }
        const firstRect = first.getBoundingClientRect()
        const nextRect = sameColumnNextRow.getBoundingClientRect()
        const statusRect = status.getBoundingClientRect()
        return {
          start: { x: firstRect.x + firstRect.width / 2, y: firstRect.y + firstRect.height / 2 },
          end: { x: nextRect.x + nextRect.width / 2, y: nextRect.y + nextRect.height / 2 },
          clearTarget: {
            x: statusRect.x + statusRect.width / 2,
            y: statusRect.y + statusRect.height / 2
          },
          clip: {
            x: Math.max(0, Math.min(firstRect.left, nextRect.left) - 8),
            y: Math.max(0, Math.min(firstRect.top, nextRect.top) - 8),
            width:
              Math.max(firstRect.right, nextRect.right) -
              Math.min(firstRect.left, nextRect.left) +
              16,
            height:
              Math.max(firstRect.bottom, nextRect.bottom) -
              Math.min(firstRect.top, nextRect.top) +
              16
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
      expect(
        deselectHashes.selectionArea?.unique.length ?? 0,
        'clearing drag selection should settle within two sampled frames'
      ).toBeLessThanOrEqual(2)

      const clearedState = await activeResult.evaluate((node) => ({
        runtimeCells: node.querySelectorAll('.editable-cell.cell-selected-runtime').length,
        runtimeHosts: node.querySelectorAll(
          'td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host'
        ).length,
        runtimeCellKeys: Array.from(
          node.querySelectorAll<HTMLElement>('.editable-cell.cell-selected-runtime[data-cell-key]')
        ).map((element) => element.dataset.cellKey ?? ''),
        runtimeHostRows: Array.from(
          node.querySelectorAll<HTMLElement>(
            'td.cell-selected-runtime-host, .ant-table-cell.cell-selected-runtime-host'
          )
        ).map((element) => element.getAttribute('data-row-key') ?? '')
      }))
      console.log(`[perf][preview-table][deselect-state] ${JSON.stringify(clearedState)}`)
      expect(
        clearedState.runtimeCells,
        'clearing drag selection should remove all runtime cell highlights'
      ).toBe(0)
      expect(
        clearedState.runtimeHosts,
        'clearing drag selection should remove all runtime host highlights'
      ).toBe(0)
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
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
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
      await expect(
        activeResult.locator(`.editable-cell[data-cell-key="${target.cellKey}"]`)
      ).toContainText(target.originalText, { timeout: 10000 })
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
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
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
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          inspectorTextLength: (
            node.querySelector<HTMLElement>('.cell-inspector-value-area')?.textContent ?? ''
          ).length
        }
      })
      expect(
        beforeClick.selectedCount,
        'opening the cell inspector from a cell context menu should preserve a visible selected cell'
      ).toBeGreaterThan(0)
      expect(beforeClick.selectedCellKeys).toContain(target.cellKey)

      await inspector.locator('.cell-inspector-tabs').click()
      await page.waitForTimeout(120)

      const afterClick = await activeResult.evaluate((node) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          valueAreaExists: node.querySelector('.cell-inspector-value-area') instanceof HTMLElement,
          emptyStateCount: node.querySelectorAll('.cell-inspector-empty').length
        }
      })
      expect(
        afterClick.selectedCount,
        'clicking inside the cell inspector should not clear the selected cell'
      ).toBeGreaterThan(0)
      expect(afterClick.selectedCellKeys).toContain(target.cellKey)
      expect(
        afterClick.valueAreaExists,
        'clicking inside the cell inspector should keep the inspector data view mounted'
      ).toBe(true)
      expect(
        afterClick.emptyStateCount,
        'clicking inside the cell inspector should not fall back to the empty state'
      ).toBe(0)
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
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
        )
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter(
            (cell) =>
              cell.cellKey &&
              cell.right <= holderRect.right &&
              cell.left >= holderRect.left &&
              cell.top >= holderRect.top &&
              cell.bottom <= holderRect.bottom
          )

        const first = cells[0]
        if (!first) {
          return null
        }
        const nextRowSameColumn = cells.find(
          (cell) => cell.rowKey !== first.rowKey && cell.columnKey === first.columnKey
        )
        return nextRowSameColumn ? { first, nextRowSameColumn } : null
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(
        selectionTargets.nextRowSameColumn.x,
        selectionTargets.nextRowSameColumn.y,
        { steps: 10 }
      )
      await page.mouse.up()
      await page.waitForTimeout(120)

      const selectionBeforeMenu = await activeResult.evaluate((node) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element) => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? '')
        }
      })
      expect(
        selectionBeforeMenu.selectedCount,
        'dragging across cells should create a multi-cell selection before opening the context menu'
      ).toBeGreaterThan(1)

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y, {
        button: 'right'
      })
      await expect.poll(async () => countVisibleDropdowns(page), { timeout: 10000 }).toBe(1)

      const anchorCellKey = selectionTargets.first.cellKey
      const selectionWithMenuOpen = await activeResult.evaluate((node, currentAnchorCellKey) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element) => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        const anchor = node.querySelector(
          `.editable-cell[data-cell-key="${CSS.escape(currentAnchorCellKey)}"]`
        )
        const anchorHost =
          anchor instanceof HTMLElement ? anchor.closest('td, .ant-table-cell') : null
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          anchorStillSelected:
            anchor instanceof HTMLElement
              ? anchor.classList.contains('cell-selected-runtime') ||
                (anchorHost instanceof HTMLElement &&
                  anchorHost.classList.contains('cell-selected-runtime-host'))
              : false
        }
      }, anchorCellKey)
      expect(
        selectionWithMenuOpen.selectedCount,
        'opening the context menu itself should keep the multi-cell highlight visible'
      ).toBeGreaterThan(1)
      expect(
        selectionWithMenuOpen.anchorStillSelected,
        'opening the context menu itself should keep the right-clicked cell visibly selected'
      ).toBe(true)

      const sampledSelectionStatePromise = activeResult.evaluate(
        async (node, currentAnchorCellKey) => {
          const frames: Array<{ selectedCount: number; anchorStillSelected: boolean }> = []
          const sampleFrame = async (): Promise<void> => {
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
            const anchor = node.querySelector(
              `.editable-cell[data-cell-key="${CSS.escape(currentAnchorCellKey)}"]`
            )
            const anchorHost =
              anchor instanceof HTMLElement ? anchor.closest('td, .ant-table-cell') : null
            const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
              .filter((element) => element instanceof HTMLElement)
              .filter((element) => {
                const host = element.closest('td, .ant-table-cell')
                return (
                  element.classList.contains('cell-selected-runtime') ||
                  (host instanceof HTMLElement &&
                    host.classList.contains('cell-selected-runtime-host'))
                )
              })
            frames.push({
              selectedCount: selectedCells.length,
              anchorStillSelected:
                anchor instanceof HTMLElement
                  ? anchor.classList.contains('cell-selected-runtime') ||
                    (anchorHost instanceof HTMLElement &&
                      anchorHost.classList.contains('cell-selected-runtime-host'))
                  : false
            })
          }
          await sampleFrame()
          await sampleFrame()
          await sampleFrame()
          await sampleFrame()
          return frames
        },
        anchorCellKey
      )
      await clickVisibleDropdownMenuItem(page, '聚合视图')

      const inspector = activeResult.locator('.cell-inspector.is-open')
      await expect(inspector).toBeVisible({ timeout: 10000 })
      const sampledSelectionState = await sampledSelectionStatePromise

      const selectionAfterMenu = await activeResult.evaluate((node, currentAnchorCellKey) => {
        const selectedCells = Array.from(node.querySelectorAll('.editable-cell[data-cell-key]'))
          .filter((element) => element instanceof HTMLElement)
          .filter((element) => {
            const host = element.closest('td, .ant-table-cell')
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        const anchor = node.querySelector(
          `.editable-cell[data-cell-key="${CSS.escape(currentAnchorCellKey)}"]`
        )
        const anchorHost =
          anchor instanceof HTMLElement ? anchor.closest('td, .ant-table-cell') : null
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          aggregateRows: node.querySelectorAll('.cell-inspector-aggregate-row').length,
          anchorStillSelected:
            anchor instanceof HTMLElement
              ? anchor.classList.contains('cell-selected-runtime') ||
                (anchorHost instanceof HTMLElement &&
                  anchorHost.classList.contains('cell-selected-runtime-host'))
              : false
        }
      }, anchorCellKey)
      expect(
        sampledSelectionState.every((frame) => frame.selectedCount > 1),
        'opening the inspector from the context menu should not drop the multi-cell highlight in any intermediate frame'
      ).toBe(true)
      expect(
        sampledSelectionState.every((frame) => frame.anchorStillSelected),
        'opening the inspector from the context menu should not let the right-clicked cell lose its selected state in any intermediate frame'
      ).toBe(true)
      expect(
        selectionAfterMenu.selectedCount,
        'opening the inspector from a multi-cell context selection should keep the multi-cell highlight'
      ).toBeGreaterThan(1)
      expect(
        selectionAfterMenu.selectedCellKeys.length,
        'opening the inspector from a multi-cell context selection should keep multiple selected cell keys'
      ).toBeGreaterThan(1)
      expect(
        selectionAfterMenu.anchorStillSelected,
        'opening the inspector from a multi-cell context selection should keep the right-clicked cell visibly selected'
      ).toBe(true)
      expect(
        selectionAfterMenu.aggregateRows,
        'aggregate view should render aggregated rows for the preserved multi-cell selection'
      ).toBeGreaterThan(0)
    } finally {
      await electronApp.close()
    }
  })

  test('right-clicking a cell after collapsing a range selection should keep the single-cell selection @bug', async () => {
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
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
        )
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? '',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter(
            (cell) =>
              cell.cellKey &&
              cell.right <= holderRect.right &&
              cell.left >= holderRect.left &&
              cell.top >= holderRect.top &&
              cell.bottom <= holderRect.bottom
          )
        const first = cells[0]
        const nextRowSameColumn = cells.find(
          (cell) => cell.rowKey !== first?.rowKey && cell.columnKey === first?.columnKey
        )
        return first && nextRowSameColumn ? { first, nextRowSameColumn } : null
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(
        selectionTargets.nextRowSameColumn.x,
        selectionTargets.nextRowSameColumn.y,
        {
          steps: 10
        }
      )
      await page.mouse.up()
      await expect
        .poll(async () =>
          activeResult
            .locator('.editable-cell.cell-selected-runtime')
            .count()
        )
        .toBeGreaterThan(1)

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y)
      await expect
        .poll(async () =>
          activeResult
            .locator('.editable-cell.cell-selected-runtime')
            .count()
        )
        .toBe(1)

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y, {
        button: 'right'
      })
      await expect(page.locator('.result-cell-context-menu-panel')).toBeVisible({ timeout: 10000 })
      await expect(
        activeResult.locator('.editable-cell.cell-selected-runtime')
      ).toHaveCount(1)
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
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        const holderRect = holder.getBoundingClientRect()
        const cells = Array.from(
          node.querySelectorAll<HTMLElement>('.result-table .editable-cell[data-cell-key]')
        )
          .map((cell) => {
            const rect = cell.getBoundingClientRect()
            return {
              cellKey: cell.dataset.cellKey ?? '',
              rowKey: cell.dataset.rowKey ?? '',
              columnKey: cell.dataset.cellColumnKey ?? cell.dataset.columnKey ?? '',
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom
            }
          })
          .filter(
            (cell) =>
              cell.cellKey &&
              cell.right <= holderRect.right &&
              cell.left >= holderRect.left &&
              cell.top >= holderRect.top &&
              cell.bottom <= holderRect.bottom
          )

        const first = cells[0]
        if (!first) {
          return null
        }
        const nextRowSameColumn = cells.find(
          (cell) => cell.rowKey !== first.rowKey && cell.columnKey === first.columnKey
        )
        return nextRowSameColumn ? { first, nextRowSameColumn } : null
      })
      expect(selectionTargets).not.toBeNull()

      await page.mouse.move(selectionTargets.first.x, selectionTargets.first.y)
      await page.mouse.down()
      await page.mouse.move(
        selectionTargets.nextRowSameColumn.x,
        selectionTargets.nextRowSameColumn.y,
        { steps: 10 }
      )
      await page.mouse.up()
      await page.waitForTimeout(120)

      await page.mouse.click(selectionTargets.first.x, selectionTargets.first.y, {
        button: 'right'
      })
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
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          anchorStillSelected: selectedCells.some(
            (element) => (element.dataset.cellKey ?? '') === anchorCellKey
          )
        }
      }, selectionTargets.first.cellKey)
      expect(
        selectionAfterValueEdit.selectedCount,
        'editing in the value view should keep the multi-cell highlight visible'
      ).toBeGreaterThan(1)
      expect(
        selectionAfterValueEdit.anchorStillSelected,
        'editing in the value view should keep the anchor cell visibly selected'
      ).toBe(true)

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
            return (
              element.classList.contains('cell-selected-runtime') ||
              (host instanceof HTMLElement && host.classList.contains('cell-selected-runtime-host'))
            )
          })
        return {
          selectedCount: selectedCells.length,
          selectedCellKeys: selectedCells.map((element) => element.dataset.cellKey ?? ''),
          anchorStillSelected: selectedCells.some(
            (element) => (element.dataset.cellKey ?? '') === anchorCellKey
          )
        }
      }, selectionTargets.first.cellKey)
      expect(
        selectionAfterRecordEdit.selectedCount,
        'editing in the record view should keep the multi-cell highlight visible'
      ).toBeGreaterThan(1)
      expect(
        selectionAfterRecordEdit.anchorStillSelected,
        'editing in the record view should keep the anchor cell visibly selected'
      ).toBe(true)
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
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(target).not.toBeNull()

      const openLatency = await page.evaluate(async ({ x, y }) => {
        const start = performance.now()
        document.elementFromPoint(x, y)?.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 2,
            buttons: 2
          })
        )

        while (performance.now() - start < 220) {
          const menus = Array.from(
            document.querySelectorAll('.result-cell-context-menu-panel, .ant-dropdown')
          )
            .filter((node): node is HTMLElement => node instanceof HTMLElement)
            .filter((node) => {
              const rect = node.getBoundingClientRect()
              const style = window.getComputedStyle(node)
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden'
              )
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
      expect(
        openLatency,
        'right-clicking a cell should open the context menu immediately'
      ).not.toBeNull()
      expect(
        openLatency.elapsed,
        'cell context menu should open within a short interaction frame budget'
      ).toBeLessThan(220)
      expect(
        openLatency.visibleMenus,
        'opening the cell context menu once should only render one visible overlay'
      ).toBe(1)

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

  test('dark theme connection delete confirm should not expose a white edge @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      if ((await page.evaluate(() => document.body.dataset.theme)) !== 'dark') {
        await page.locator('.theme-toggle-btn').click()
      }
      await expect
        .poll(() => page.evaluate(() => document.body.dataset.theme), { timeout: 10000 })
        .toBe('dark')

      await openFixtureConnection(page)
      await treeNode(page, `connection:${fixtureConnectionId}`).click()

      const deleteButton = page.locator(
        `.connection-tree-title[data-connection-id="${fixtureConnectionId}"] .connection-tree-icon-btn.ant-btn-dangerous`
      )
      await expect(deleteButton).toBeVisible({ timeout: 15000 })
      await deleteButton.click()

      const confirmModal = page.locator('.connection-delete-confirm-modal.ant-modal')
      await expect(confirmModal).toBeVisible({ timeout: 10000 })
      await assertModalCentered(page, confirmModal)
      const colors = await confirmModal.evaluate((node) => {
        const parseRgb = (value) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? null
        const container = node.querySelector('.ant-modal-container')
        const modalStyle = window.getComputedStyle(node)
        const containerStyle = container ? window.getComputedStyle(container) : null
        return {
          modalBackground: parseRgb(modalStyle.backgroundColor),
          containerBackground: containerStyle ? parseRgb(containerStyle.backgroundColor) : null
        }
      })

      expect(
        colors.modalBackground,
        'delete confirmation outer layer should not be white'
      ).not.toBeNull()
      expect(Math.max(...(colors.modalBackground ?? []))).toBeLessThan(120)
      expect(
        colors.containerBackground,
        'delete confirmation container should be dark'
      ).not.toBeNull()
      expect(Math.max(...(colors.containerBackground ?? []))).toBeLessThan(120)

      await page.keyboard.press('Escape')
      await expect(confirmModal).toHaveCount(0)
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
            if (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            ) {
              return performance.now() - start
            }
          }
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        }
        return null
      })

      await expect(popover).toBeVisible({ timeout: 30000 })
      expect(
        openedInTime,
        'tree selector popover should appear quickly after a single click'
      ).not.toBeNull()
      expect(
        openedInTime,
        'tree selector popover should open within a single short interaction frame budget'
      ).toBeLessThan(220)
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
      expect(
        deltaX,
        'tree context menu should stay near the horizontal click position'
      ).toBeLessThan(40)
      expect(deltaY, 'tree context menu should stay near the vertical click position').toBeLessThan(
        40
      )
    } finally {
      await electronApp.close()
    }
  })

  test('connection folders should stay before root connections while each section supports pinning, double-click, and creation cancellation @bug', async () => {
    const electronApp = await launchRegressionApp()
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids'
    ]
    let page
    let storageSnapshot

    try {
      page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      storageSnapshot = await page.evaluate((keys) => {
        return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]))
      }, storageKeys)

      const folderName = `Regression group ${crypto.randomUUID().slice(0, 8)}`
      await page.locator('.resource-add').click()
      await page.getByText('新建分组', { exact: true }).click()
      const folderModal = page.locator('.folder-editor-modal')
      await expect(folderModal).toBeVisible({ timeout: 10000 })
      await expect(folderModal.locator('input')).toBeFocused()
      await folderModal.locator('input').fill(folderName)
      await page.locator('.ant-modal-footer .ant-btn-primary').last().click()
      await expect(folderModal).toBeHidden()

      const readFolderId = () =>
        page.evaluate((name) => {
          const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
          return folders.find((folder) => folder?.name === name)?.id ?? null
        }, folderName)
      await expect.poll(readFolderId, { timeout: 10000 }).not.toBeNull()
      const folderId = await readFolderId()
      expect(folderId).not.toBeNull()
      const folderKey = `folder:${folderId}`
      const connectionKey = `connection:${fixtureConnectionId}`
      const rootNodeKeys = () =>
        page.evaluate(() => {
          return Array.from(
            document.querySelectorAll('.resource-tree-node-title[data-tree-node-key]')
          )
            .map((node) => node.getAttribute('data-tree-node-key'))
            .filter((key) => key?.startsWith('connection:') || key?.startsWith('folder:'))
        })

      await expect(treeNode(page, folderKey)).toBeVisible({ timeout: 10000 })
      const folderNode = treeNode(page, folderKey)
      const folderBox = await folderNode.boundingBox()
      expect(folderBox).not.toBeNull()
      await page.mouse.click(folderBox.x + 48, folderBox.y + folderBox.height / 2, {
        button: 'right'
      })
      const menu = page.locator('.tree-context-menu-panel')
      await menu.getByText('添加子分组', { exact: true }).click()
      await expect(folderModal).toBeVisible({ timeout: 10000 })
      const childFolderName = `Regression child group ${crypto.randomUUID().slice(0, 8)}`
      await folderModal.locator('input').fill(childFolderName)
      await page.locator('.ant-modal-footer .ant-btn-primary').last().click()
      const readChildFolderId = () =>
        page.evaluate((name) => {
          const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
          return folders.find((folder) => folder?.name === name)?.id ?? null
        }, childFolderName)
      await expect.poll(readChildFolderId, { timeout: 10000 }).not.toBeNull()
      const childFolderId = await readChildFolderId()
      const childFolderKey = `folder:${childFolderId}`
      const childFolderNode = treeNode(page, childFolderKey)
      await expect(childFolderNode).toBeVisible({ timeout: 10000 })
      expect(await childFolderNode.evaluate((node) => node.closest('.tree-folder-row') !== null)).toBe(true)
      const childFolderMetrics = await childFolderNode.evaluate((node) => {
        const treeNode = node.closest('.ant-tree-treenode')
        const contentWrapper = treeNode?.querySelector(':scope > .ant-tree-node-content-wrapper')
        return {
          className: treeNode?.className ?? '',
          contentLeft: contentWrapper?.getBoundingClientRect().left ?? null
        }
      })
      expect(childFolderMetrics.className).toContain('tree-folder-child-row')
      expect(childFolderMetrics.contentLeft).not.toBeNull()
      await expect(folderNode.locator('.folder-title-icon.is-expanded')).toBeVisible()
      await folderNode.dblclick()
      await expect(folderNode.locator('.folder-title-icon.is-expanded')).toHaveCount(0)
      await folderNode.dblclick()
      await expect(folderNode.locator('.folder-title-icon.is-expanded')).toBeVisible()
      await expect.poll(rootNodeKeys).toEqual(expect.arrayContaining([connectionKey, folderKey]))
      expect((await rootNodeKeys()).indexOf(folderKey)).toBeLessThan(
        (await rootNodeKeys()).indexOf(connectionKey)
      )

      await page.evaluate(({ nextConnectionKey, nextFolderKey }) => {
        localStorage.setItem('datadjinn-root-item-order-customized', 'true')
        localStorage.setItem(
          'datadjinn-root-item-order',
          JSON.stringify([nextConnectionKey, nextFolderKey])
        )
      }, { nextConnectionKey: connectionKey, nextFolderKey: folderKey })
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await expect(treeNode(page, folderKey)).toBeVisible({ timeout: 10000 })
      expect(
        (await rootNodeKeys()).indexOf(folderKey),
        'a legacy mixed root order must still render every folder before root connections'
      ).toBeLessThan((await rootNodeKeys()).indexOf(connectionKey))

      const pinnedFolderBoxAfterReload = await folderNode.boundingBox()
      expect(pinnedFolderBoxAfterReload).not.toBeNull()
      await page.mouse.click(
        pinnedFolderBoxAfterReload.x + 48,
        pinnedFolderBoxAfterReload.y + pinnedFolderBoxAfterReload.height / 2,
        { button: 'right' }
      )
      await expect(menu.getByText('置顶', { exact: true })).toBeVisible({ timeout: 10000 })
      await menu.getByText('置顶', { exact: true }).click()
      await expect.poll(rootNodeKeys).toEqual(expect.arrayContaining([folderKey, connectionKey]))
      await expect(folderNode.locator('.tree-root-pin-icon')).toBeVisible()
      expect((await rootNodeKeys()).indexOf(folderKey)).toBeLessThan(
        (await rootNodeKeys()).indexOf(connectionKey)
      )

      const pinnedFolderBox = await folderNode.boundingBox()
      expect(pinnedFolderBox).not.toBeNull()
      await page.mouse.click(pinnedFolderBox.x + 48, pinnedFolderBox.y + pinnedFolderBox.height / 2, {
        button: 'right'
      })
      await expect(menu.getByText('取消置顶', { exact: true })).toBeVisible({ timeout: 10000 })
      await page.keyboard.press('Escape')

      const connectionNode = treeNode(page, connectionKey)
      const connectionBox = await connectionNode.boundingBox()
      expect(connectionBox).not.toBeNull()
      await page.mouse.click(connectionBox.x + 80, connectionBox.y + connectionBox.height / 2, {
        button: 'right'
      })
      await expect(menu.getByText('置顶', { exact: true })).toBeVisible({ timeout: 10000 })
      await menu.getByText('置顶', { exact: true }).click()
      await expect.poll(rootNodeKeys).toEqual(expect.arrayContaining([folderKey, connectionKey]))
      await expect(connectionNode.locator('.tree-root-pin-icon')).toBeVisible()
      expect(
        (await rootNodeKeys()).indexOf(folderKey),
        'pinning a root connection must not move it before the folder section'
      ).toBeLessThan((await rootNodeKeys()).indexOf(connectionKey))

      await folderNode.dragTo(connectionNode)
      await expect.poll(rootNodeKeys).toEqual(expect.arrayContaining([folderKey, connectionKey]))
      expect(
        (await rootNodeKeys()).indexOf(folderKey),
        'dropping a folder onto a root connection must not cross the section boundary'
      ).toBeLessThan((await rootNodeKeys()).indexOf(connectionKey))

      await connectionNode.dragTo(folderNode)
      await expect.poll(rootNodeKeys).toEqual(expect.arrayContaining([folderKey, connectionKey]))
      expect(
        (await rootNodeKeys()).indexOf(folderKey),
        'dropping a root connection onto a folder must not cross the section boundary'
      ).toBeLessThan((await rootNodeKeys()).indexOf(connectionKey))
      await page.keyboard.press('Escape')

      const folderMetrics = await folderNode.evaluate((node) => {
        const treeNode = node.closest('.ant-tree-treenode')
        const switcher = treeNode?.querySelector(':scope > .ant-tree-switcher')
        const contentWrapper = treeNode?.querySelector(':scope > .ant-tree-node-content-wrapper')
        return {
          hasSwitcherGlyph: Boolean(treeNode?.querySelector('.tree-switcher-glyph')),
          switcherDisplay: switcher ? window.getComputedStyle(switcher).display : null,
          switcherWidth: switcher?.getBoundingClientRect().width ?? null,
          contentLeft: contentWrapper?.getBoundingClientRect().left ?? null,
          expanded: treeNode?.classList.contains('ant-tree-treenode-switcher-open') ?? false
        }
      })
      expect(folderMetrics.hasSwitcherGlyph).toBe(false)
      expect(folderMetrics.switcherDisplay).toBe('none')
      expect(folderMetrics.switcherWidth).toBe(0)
      const connectionContentLeft = await connectionNode.evaluate((node) =>
        node.closest('.ant-tree-treenode')
          ?.querySelector(':scope > .ant-tree-node-content-wrapper')
          ?.getBoundingClientRect().left ?? null
      )
      expect(folderMetrics.contentLeft).toBe(connectionContentLeft)
      expect(childFolderMetrics.contentLeft - folderMetrics.contentLeft).toBeGreaterThanOrEqual(8)
      expect(childFolderMetrics.contentLeft - folderMetrics.contentLeft).toBeLessThanOrEqual(14)

      const connectionBoxBeforeMoveMenu = await connectionNode.boundingBox()
      expect(connectionBoxBeforeMoveMenu).not.toBeNull()
      await page.mouse.click(
        connectionBoxBeforeMoveMenu.x + 80,
        connectionBoxBeforeMoveMenu.y + connectionBoxBeforeMoveMenu.height / 2,
        { button: 'right' }
      )
      const moveToFolderMenu = page.locator('.tree-context-menu-panel')
      await moveToFolderMenu.locator('.ant-menu-submenu').filter({ hasText: '添加到分组' }).hover()
      const folderPopup = page.locator('.ant-menu-submenu-popup:visible').last()
      await expect(folderPopup.getByText(folderName, { exact: true })).toBeVisible({ timeout: 10000 })
      await folderPopup.locator('.ant-menu-submenu').filter({ hasText: folderName }).hover()
      const childFolderPopup = page.locator('.ant-menu-submenu-popup:visible').last()
      await expect(childFolderPopup.getByText(childFolderName, { exact: true })).toBeVisible({ timeout: 10000 })
      await page.keyboard.press('Escape')
      await folderNode.dblclick()
      await expect
        .poll(
          () =>
            folderNode.evaluate(
              (node) =>
                node.closest('.ant-tree-treenode')?.classList.contains('ant-tree-treenode-switcher-open') ??
                false
            ),
          { timeout: 10000 }
        )
        .toBe(!folderMetrics.expanded)

      await page.locator('.resource-add').click()
      await page
        .locator('.resource-create-dropdown .ant-dropdown-menu-item:visible')
        .filter({ hasText: 'SQLite' })
        .click()
      const connectionModal = page.locator('.connection-editor-modal')
      await expect(connectionModal).toBeVisible({ timeout: 10000 })
      await connectionModal.getByRole('button', { name: '新建分组' }).click()
      const inlineFolderInput = connectionModal.locator('.connection-folder-create-row input')
      await expect(inlineFolderInput).toBeVisible({ timeout: 10000 })
      await connectionModal.getByRole('button', { name: '取消新建分组' }).click()
      await expect(inlineFolderInput).toBeHidden()

      await page.evaluate(
        ({ connectionId, targetFolderId }) => {
          localStorage.setItem(
            'datadjinn-connection-folder-assignments',
            JSON.stringify({ [connectionId]: targetFolderId })
          )
          localStorage.setItem(
            'datadjinn-folder-connection-order',
            JSON.stringify({ [targetFolderId]: [connectionId] })
          )
        },
        { connectionId: fixtureConnectionId, targetFolderId: folderId }
      )
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await doubleClickTreeNode(page, folderKey)
      await expect(treeNode(page, connectionKey)).toBeVisible({ timeout: 10000 })

      const groupedConnectionMetrics = await treeNode(page, connectionKey).evaluate((node) => {
        const treeNode = node.closest('.ant-tree-treenode')
        const contentWrapper = treeNode?.querySelector(':scope > .ant-tree-node-content-wrapper')
        return {
          className: treeNode?.className ?? '',
          contentLeft: contentWrapper?.getBoundingClientRect().left ?? null
        }
      })
      expect(groupedConnectionMetrics.className).toContain('tree-folder-connection-row')
      expect(groupedConnectionMetrics.contentLeft).not.toBeNull()
      expect(folderMetrics.contentLeft).not.toBeNull()
      expect(groupedConnectionMetrics.contentLeft - folderMetrics.contentLeft).toBeGreaterThanOrEqual(8)
      expect(groupedConnectionMetrics.contentLeft - folderMetrics.contentLeft).toBeLessThanOrEqual(14)

      await openFixtureConnection(page)
      await expect
        .poll(
          () =>
            folderNode.evaluate(
              (node) =>
                node.closest('.ant-tree-treenode')?.classList.contains(
                  'ant-tree-treenode-switcher-open'
                ) ?? false
            ),
          { timeout: 15000 }
        )
        .toBe(true)

      const tableGroupKey = `object-group:${fixtureConnectionId}:::table`
      await expect(treeNode(page, tableGroupKey)).toBeVisible({ timeout: 10000 })
      const groupedTableGroupMetrics = await treeNode(page, tableGroupKey).evaluate((node) => {
        const treeNode = node.closest('.ant-tree-treenode')
        const contentWrapper = treeNode?.querySelector(':scope > .ant-tree-node-content-wrapper')
        return {
          className: treeNode?.className ?? '',
          contentLeft: contentWrapper?.getBoundingClientRect().left ?? null
        }
      })
      expect(groupedTableGroupMetrics.className).toContain('tree-folder-connection-descendant')
      expect(groupedTableGroupMetrics.contentLeft - groupedConnectionMetrics.contentLeft).toBeGreaterThanOrEqual(31)
      expect(groupedTableGroupMetrics.contentLeft - groupedConnectionMetrics.contentLeft).toBeLessThanOrEqual(35)

      await ensureTreeNodeExpanded(page, tableGroupKey)
      const tableKey = `table:${fixtureConnectionId}:::table:${smallTableName}`
      await expect.poll(async () => revealTreeNode(page, tableKey), { timeout: 15000 }).toBe(true)
      const groupedTableMetrics = await treeNode(page, tableKey).evaluate((node) => {
        const treeNode = node.closest('.ant-tree-treenode')
        const contentWrapper = treeNode?.querySelector(':scope > .ant-tree-node-content-wrapper')
        return {
          className: treeNode?.className ?? '',
          contentLeft: contentWrapper?.getBoundingClientRect().left ?? null
        }
      })
      expect(groupedTableMetrics.className).toContain('tree-folder-connection-descendant')
      expect(groupedTableMetrics.contentLeft - groupedTableGroupMetrics.contentLeft).toBeGreaterThanOrEqual(22)
      expect(groupedTableMetrics.contentLeft - groupedTableGroupMetrics.contentLeft).toBeLessThanOrEqual(26)
    } finally {
      if (page && storageSnapshot) {
        await page.evaluate(({ snapshot }) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, value)
            }
          })
        }, { snapshot: storageSnapshot })
      }
      await electronApp.close()
    }
  })

  test('dragging a connection within a folder should update its visible and persisted order @bug', async () => {
    const fixtureUserDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(fixtureUserDataDir, 'connections.json')
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const sourceConnection = connectionStore.connections.find(
      (item) => item.connection_id === fixtureConnectionId
    )
    if (!sourceConnection) {
      throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
    }

    const folderId = `regression-folder-drag-${crypto.randomUUID()}`
    const firstConnectionId = fixtureConnectionId
    const secondConnectionId = `regression-folder-drag-connection-${crypto.randomUUID()}`
    const thirdConnectionId = `regression-folder-drag-connection-${crypto.randomUUID()}`
    connectionStore.connections = connectionStore.connections.filter(
      (item) => item.connection_id !== secondConnectionId && item.connection_id !== thirdConnectionId
    )
    connectionStore.connections.push({
      ...sourceConnection,
      connection_id: secondConnectionId,
      name: 'Regression folder drag target'
    })
    connectionStore.connections.push({
      ...sourceConnection,
      connection_id: thirdConnectionId,
      name: 'Regression folder drag third target'
    })
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp()
    let page
    let storageSnapshot
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids'
    ]

    try {
      page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      storageSnapshot = await page.evaluate((keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), storageKeys)
      await page.evaluate(
        ({ nextFolderId, firstId, secondId, thirdId }) => {
          localStorage.setItem(
            'datadjinn-connection-folders',
            JSON.stringify([{ id: nextFolderId, name: 'Regression folder drag' }])
          )
          localStorage.setItem(
            'datadjinn-connection-folder-assignments',
            JSON.stringify({
              [firstId]: nextFolderId,
              [secondId]: nextFolderId,
              [thirdId]: nextFolderId
            })
          )
          localStorage.setItem('datadjinn-connection-folder-order', JSON.stringify([nextFolderId]))
          localStorage.setItem(
            'datadjinn-folder-connection-order',
            JSON.stringify({ [nextFolderId]: [firstId, secondId, thirdId] })
          )
          localStorage.setItem('datadjinn-root-item-order', JSON.stringify([`folder:${nextFolderId}`]))
          localStorage.setItem('datadjinn-root-item-order-customized', 'true')
          localStorage.setItem('datadjinn-pinned-root-item-ids', JSON.stringify([]))
        },
        {
          nextFolderId: folderId,
          firstId: firstConnectionId,
          secondId: secondConnectionId,
          thirdId: thirdConnectionId
        }
      )
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const folderKey = `folder:${folderId}`
      const firstKey = `connection:${firstConnectionId}`
      const secondKey = `connection:${secondConnectionId}`
      const thirdKey = `connection:${thirdConnectionId}`
      await doubleClickTreeNode(page, folderKey)
      const firstNode = treeNode(page, firstKey)
      const secondNode = treeNode(page, secondKey)
      const thirdNode = treeNode(page, thirdKey)
      await expect(firstNode).toBeVisible({ timeout: 10000 })
      await expect(secondNode).toBeVisible({ timeout: 10000 })
      await expect(thirdNode).toBeVisible({ timeout: 10000 })

      const readFolderOrder = () =>
        page.evaluate((nextFolderId) => {
          const order = JSON.parse(localStorage.getItem('datadjinn-folder-connection-order') ?? '{}')
          return order[nextFolderId] ?? []
        }, folderId)
      const moveBefore = async (movingNode, targetNode, expectedOrder) => {
        await movingNode.dragTo(targetNode, { targetPosition: { x: 24, y: 3 } })
        await expect.poll(readFolderOrder, { timeout: 10000 }).toEqual(expectedOrder)
      }
      const moveAfter = async (movingNode, targetNode, expectedOrder) => {
        const targetBox = await targetNode.boundingBox()
        expect(targetBox).not.toBeNull()
        await movingNode.dragTo(targetNode, {
          targetPosition: { x: 24, y: Math.max(3, Math.floor(targetBox.height - 3)) }
        })
        await expect.poll(readFolderOrder, { timeout: 10000 }).toEqual(expectedOrder)
      }

      await moveBefore(thirdNode, firstNode, [thirdConnectionId, firstConnectionId, secondConnectionId])
      await moveBefore(secondNode, thirdNode, [secondConnectionId, thirdConnectionId, firstConnectionId])
      await moveBefore(firstNode, secondNode, [firstConnectionId, secondConnectionId, thirdConnectionId])
      await moveAfter(firstNode, thirdNode, [secondConnectionId, thirdConnectionId, firstConnectionId])
      await moveBefore(firstNode, secondNode, [firstConnectionId, secondConnectionId, thirdConnectionId])

      const visibleFolderOrder = () =>
        page.evaluate((nextFolderId) =>
          Array.from(document.querySelectorAll('.connection-tree-title[data-connection-id]'))
            .filter(
              (node) =>
                node.getAttribute('data-connection-id') &&
                node.closest('.tree-folder-connection-row')
            )
            .map((node) => node.getAttribute('data-connection-id'))
            .filter(Boolean))
      await expect.poll(visibleFolderOrder, { timeout: 10000 }).toEqual([
        firstConnectionId,
        secondConnectionId,
        thirdConnectionId
      ])
    } finally {
      if (page && storageSnapshot) {
        await page.evaluate(({ snapshot }) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, value)
            }
          })
        }, { snapshot: storageSnapshot })
      }
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('moving a connection to a group should retain the resource tree scroll position @bug', async () => {
    const fixtureUserDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(fixtureUserDataDir, 'connections.json')
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const sourceConnection = connectionStore.connections.find(
      (item) => item.connection_id === fixtureConnectionId
    )
    if (!sourceConnection) {
      throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
    }
    const extraConnections = Array.from({ length: 180 }, (_, index) => ({
      ...sourceConnection,
      connection_id: `regression-tree-scroll-${String(index + 1).padStart(2, '0')}`,
      name: `Regression tree scroll ${String(index + 1).padStart(2, '0')}`
    }))
    connectionStore.connections = connectionStore.connections.filter(
      (item) => !item.connection_id.startsWith('regression-tree-scroll-')
    )
    connectionStore.connections.push(...extraConnections)
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp()
    let page
    let storageSnapshot
    let originalMainPreferences
    let originalServerPreferences
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids'
    ]
    const folderId = `regression-tree-scroll-folder-${crypto.randomUUID()}`

    try {
      page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      storageSnapshot = await page.evaluate((keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), storageKeys)
      originalMainPreferences = await page.evaluate(() => window.api.getConnectionTreePreferences())
      originalServerPreferences = await page.evaluate(() =>
        window.api.requestJson('/preferences/connection-tree')
      )
      await page.evaluate((nextFolderId) => {
        localStorage.setItem(
          'datadjinn-connection-folders',
          JSON.stringify([{ id: nextFolderId, name: 'Regression tree scroll folder' }])
        )
        localStorage.setItem('datadjinn-connection-folder-assignments', JSON.stringify({}))
        localStorage.setItem('datadjinn-connection-folder-order', JSON.stringify([nextFolderId]))
        localStorage.setItem('datadjinn-folder-connection-order', JSON.stringify({ [nextFolderId]: [] }))
      }, folderId)
      await page.evaluate(async (nextFolderId) => {
        const preferences = {
          connection_folders: [{ id: nextFolderId, name: 'Regression tree scroll folder' }],
          connection_folder_assignments: {},
          connection_folder_order: [nextFolderId],
          folder_connection_order: { [nextFolderId]: [] }
        }
        await Promise.all([
          window.api.setConnectionTreePreferences(preferences),
          window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({ preferences })
          })
        ])
      }, folderId)
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const targetConnectionId = extraConnections.at(-1).connection_id
      const targetKey = `connection:${targetConnectionId}`
      await expect.poll(async () => revealTreeNode(page, targetKey), { timeout: 15000 }).toBe(true)
      const viewport = page.locator('.resource-tree-viewport')
      const scrollBefore = await viewport.evaluate((node) => {
        const holder = node.querySelector('.ant-tree-list-holder')
        if (!(holder instanceof HTMLElement)) {
          return null
        }
        holder.scrollTop = Math.max(30, holder.scrollHeight - holder.clientHeight - 12)
        return holder.scrollTop
      })
      expect(scrollBefore).toBeGreaterThan(0)
      const targetNode = treeNode(page, targetKey)
      await expect(targetNode).toBeVisible({ timeout: 10000 })
      const targetBox = await targetNode.boundingBox()
      expect(targetBox).not.toBeNull()
      await page.mouse.click(targetBox.x + 80, targetBox.y + targetBox.height / 2, {
        button: 'right'
      })
      const submenu = page.locator('.tree-context-menu-panel')
      await submenu.getByText('添加到分组', { exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Regression tree scroll folder', exact: true }).click()
      await expect.poll(() => viewport.evaluate((node) => {
        const holder = node.querySelector('.ant-tree-list-holder')
        return holder instanceof HTMLElement ? holder.scrollTop : null
      })).toBeGreaterThanOrEqual(scrollBefore - 2)
    } finally {
      if (page && originalMainPreferences && originalServerPreferences) {
        await page.evaluate(async ({ mainPreferences, serverPreferences }) => {
          await Promise.all([
            window.api.setConnectionTreePreferences(mainPreferences),
            window.api.requestJson('/preferences/connection-tree', {
              method: 'PUT',
              body: JSON.stringify({ preferences: serverPreferences.preferences ?? {} })
            })
          ])
        }, { mainPreferences: originalMainPreferences, serverPreferences: originalServerPreferences })
      }
      if (page && storageSnapshot) {
        await page.evaluate(({ snapshot }) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, value)
            }
          })
        }, { snapshot: storageSnapshot })
      }
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('connection groups should survive renderer cache loss across an application restart @bug', async () => {
    const electronApp = await launchRegressionApp()
    let page
    let localStorageSnapshot
    let originalMainPreferences
    let originalServerPreferences
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids'
    ]

    try {
      page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      localStorageSnapshot = await page.evaluate((keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), storageKeys)
      originalMainPreferences = await page.evaluate(() => window.api.getConnectionTreePreferences())
      originalServerPreferences = await page.evaluate(() =>
        window.api.requestJson('/preferences/connection-tree')
      )
      await page.evaluate(async (keys) => {
        keys.forEach((key) => localStorage.removeItem(key))
        await Promise.all([
          window.api.setConnectionTreePreferences({}),
          window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({ preferences: {} })
          })
        ])
      }, storageKeys)
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const folderName = `Regression durable group ${crypto.randomUUID().slice(0, 8)}`
      await page.locator('.resource-add').click()
      await page.getByText('新建分组', { exact: true }).click()
      const folderModal = page.locator('.folder-editor-modal')
      await folderModal.locator('input').fill(folderName)
      await page.locator('.ant-modal-footer .ant-btn-primary').last().click()
      await expect(folderModal).toBeHidden()

      await expect
        .poll(
          () =>
            page.evaluate((name) => {
              const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
              return folders.find((folder) => folder?.name === name)?.id ?? null
            }, folderName),
          { timeout: 10000 }
        )
        .not.toBeNull()
      const resolvedFolderId = await page.evaluate((name) => {
        const folders = JSON.parse(localStorage.getItem('datadjinn-connection-folders') ?? '[]')
        return folders.find((folder) => folder?.name === name)?.id ?? null
      }, folderName)
      expect(resolvedFolderId).not.toBeNull()

      const connectionKey = `connection:${fixtureConnectionId}`
      await expect.poll(async () => revealTreeNode(page, connectionKey), { timeout: 15000 }).toBe(true)
      const connectionNode = treeNode(page, connectionKey)
      const connectionBox = await connectionNode.boundingBox()
      expect(connectionBox).not.toBeNull()
      await page.mouse.click(connectionBox.x + 80, connectionBox.y + connectionBox.height / 2, {
        button: 'right'
      })
      await page.locator('.tree-context-menu-panel').getByText('添加到分组', { exact: true }).hover()
      await page.getByRole('menuitem', { name: folderName, exact: true }).click()

      await expect
        .poll(
          () =>
            page.evaluate(async ({ connectionId, folderId }) => {
              const [mainPreferences, response] = await Promise.all([
                window.api.getConnectionTreePreferences(),
                window.api.requestJson('/preferences/connection-tree')
              ])
              const localAssignments = JSON.parse(
                localStorage.getItem('datadjinn-connection-folder-assignments') ?? '{}'
              )
              return (
                mainPreferences.connection_folder_assignments?.[connectionId] === folderId &&
                response.preferences.connection_folder_assignments?.[connectionId] === folderId &&
                localAssignments[connectionId] === folderId
              )
            }, { connectionId: fixtureConnectionId, folderId: resolvedFolderId }),
          { timeout: 10000 }
        )
        .toBe(true)

      await page.evaluate((keys) => keys.forEach((key) => localStorage.removeItem(key)), storageKeys)
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await doubleClickTreeNode(page, `folder:${resolvedFolderId}`)
      await expect(treeNode(page, connectionKey)).toBeVisible({ timeout: 10000 })
      await expect
        .poll(
          () =>
            page.evaluate((key) => {
              const node = document.querySelector(
                `.resource-tree-node-title[data-tree-node-key="${CSS.escape(key)}"]`
              )
              return node?.closest('.tree-folder-connection-row') !== null
            }, connectionKey),
          { timeout: 10000 }
        )
        .toBe(true)
    } finally {
      if (page && originalMainPreferences && originalServerPreferences) {
        await page.evaluate(async ({ mainPreferences, serverPreferences }) => {
          await Promise.all([
            window.api.setConnectionTreePreferences(mainPreferences),
            window.api.requestJson('/preferences/connection-tree', {
              method: 'PUT',
              body: JSON.stringify({ preferences: serverPreferences.preferences ?? {} })
            })
          ])
        }, { mainPreferences: originalMainPreferences, serverPreferences: originalServerPreferences })
      }
      if (page && localStorageSnapshot) {
        await page.evaluate(({ snapshot }) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, value)
            }
          })
        }, { snapshot: localStorageSnapshot })
      }
      await electronApp.close()
    }
  })

  test('double-clicking a table group should retain the resource tree scroll position @bug', async () => {
    const fixtureUserDataDir = readFixtureUserDataDir()
    const connectionsPath = path.join(fixtureUserDataDir, 'connections.json')
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const sourceConnection = connectionStore.connections.find(
      (item) => item.connection_id === fixtureConnectionId
    )
    if (!sourceConnection) {
      throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
    }
    connectionStore.connections = connectionStore.connections.filter(
      (item) => !item.connection_id.startsWith('regression-table-scroll-')
    )
    connectionStore.connections.push(
      ...Array.from({ length: 160 }, (_, index) => ({
        ...sourceConnection,
        connection_id: `regression-table-scroll-${String(index + 1).padStart(3, '0')}`,
        name: `Regression table scroll ${String(index + 1).padStart(3, '0')}`
      }))
    )
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp()
    let page
    let localStorageSnapshot
    let originalMainPreferences
    let originalServerPreferences
    const storageKeys = [
      'datadjinn-connection-folders',
      'datadjinn-connection-folder-assignments',
      'datadjinn-connection-folder-order',
      'datadjinn-folder-connection-order',
      'datadjinn-root-connection-order',
      'datadjinn-root-item-order',
      'datadjinn-root-item-order-customized',
      'datadjinn-pinned-root-item-ids'
    ]

    try {
      page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      localStorageSnapshot = await page.evaluate((keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), storageKeys)
      originalMainPreferences = await page.evaluate(() => window.api.getConnectionTreePreferences())
      originalServerPreferences = await page.evaluate(() =>
        window.api.requestJson('/preferences/connection-tree')
      )
      await page.evaluate(async (keys) => {
        keys.forEach((key) => localStorage.removeItem(key))
        await Promise.all([
          window.api.setConnectionTreePreferences({}),
          window.api.requestJson('/preferences/connection-tree', {
            method: 'PUT',
            body: JSON.stringify({ preferences: {} })
          })
        ])
      }, storageKeys)
      await page.reload()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)

      const tableGroupKey = `object-group:${fixtureConnectionId}:::table`
      await expect.poll(async () => revealTreeNode(page, tableGroupKey), { timeout: 15000 }).toBe(true)
      const viewport = page.locator('.resource-tree-viewport')
      const scrollBefore = await viewport.evaluate((node) => {
        const holder = node.querySelector('.ant-tree-list-holder')
        if (!(holder instanceof HTMLElement)) {
          return -1
        }
        holder.scrollTop = 48
        return holder.scrollTop
      })
      expect(scrollBefore).toBeGreaterThan(0)
      const tableGroup = treeNode(page, tableGroupKey)
      await expect(tableGroup).toBeVisible({ timeout: 10000 })
      await tableGroup.evaluate((element) => {
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
      })
      await expect
        .poll(() =>
          page.locator(
            `.resource-tree-node-title[data-tree-node-key^="table:${fixtureConnectionId}:::table:"]`
          ).count()
        )
        .toBeGreaterThan(0)
      await expect
        .poll(() =>
          viewport.evaluate((node) => {
            const holder = node.querySelector('.ant-tree-list-holder')
            return holder instanceof HTMLElement ? holder.scrollTop : -1
          })
        )
        .toBeGreaterThanOrEqual(scrollBefore - 2)
    } finally {
      if (page && originalMainPreferences && originalServerPreferences) {
        await page.evaluate(async ({ mainPreferences, serverPreferences }) => {
          await Promise.all([
            window.api.setConnectionTreePreferences(mainPreferences),
            window.api.requestJson('/preferences/connection-tree', {
              method: 'PUT',
              body: JSON.stringify({ preferences: serverPreferences.preferences ?? {} })
            })
          ])
        }, { mainPreferences: originalMainPreferences, serverPreferences: originalServerPreferences })
      }
      if (page && localStorageSnapshot) {
        await page.evaluate(({ snapshot }) => {
          Object.entries(snapshot).forEach(([key, value]) => {
            if (value === null) {
              localStorage.removeItem(key)
            } else {
              localStorage.setItem(key, value)
            }
          })
        }, { snapshot: localStorageSnapshot })
      }
      await electronApp.close()
      fs.writeFileSync(connectionsPath, originalConnectionsRaw, 'utf-8')
    }
  })

  test('refreshing a preview should preserve its horizontal table position @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const initialScrollPosition = await activeResult.evaluate((node) => {
        const scrollElements = Array.from(
          node.querySelectorAll<HTMLElement>(
            '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body, .result-table .ant-table-tbody-virtual-scrollbar-horizontal'
          )
        )
        const holder = scrollElements.find((element) => element.scrollWidth > element.clientWidth + 1)
        if (!holder) {
          return {
            holder: null,
            scrollbarTransform: null,
            elements: scrollElements.map((element) => ({
              className: element.className,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              scrollLeft: element.scrollLeft
            }))
          }
        }
        holder.scrollLeft = Math.max(80, (holder.scrollWidth - holder.clientWidth) * 0.65)
        const horizontalScrollbarThumb = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-scrollbar-horizontal'
            + ' .ant-table-tbody-virtual-scrollbar-thumb'
        )
        const header = node.querySelector<HTMLElement>('.result-table .ant-table-thead')
        const headerScroller = node.querySelector<HTMLElement>('.result-table .ant-table-header')
        return {
          horizontalOffset: headerScroller?.scrollLeft || holder.scrollLeft,
          scrollbarTransform: horizontalScrollbarThumb
            ? window.getComputedStyle(horizontalScrollbarThumb).transform
            : null,
          headerTransform: header ? window.getComputedStyle(header).transform : null,
          elements: scrollElements.map((element) => ({
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            scrollLeft: element.scrollLeft
          }))
        }
      })
      console.log(`[scroll][preview-before-refresh] ${JSON.stringify(initialScrollPosition)}`)
      expect(initialScrollPosition?.horizontalOffset).toBeGreaterThan(0)
      expect(initialScrollPosition?.scrollbarTransform).not.toBe('')
      await activeResult.screenshot({ path: 'test-results/preview-scroll-before-refresh.png' })
      await activeResult.getByRole('button', { name: '刷新' }).click()
      await expect(activeResult.locator('.result-table-loading-overlay')).toHaveCount(0, {
        timeout: 30000
      })
      await page.waitForTimeout(160)
      await expect.poll(() => activeResult.evaluate((node) => {
        const holder = Array.from(
          node.querySelectorAll<HTMLElement>(
            '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body, .result-table .ant-table-tbody-virtual-scrollbar-horizontal'
          )
        ).find((element) => element.scrollWidth > element.clientWidth + 1)
        const horizontalScrollbarThumb = node.querySelector<HTMLElement>(
          '.result-table .ant-table-tbody-virtual-scrollbar-horizontal'
            + ' .ant-table-tbody-virtual-scrollbar-thumb'
        )
        const header = node.querySelector<HTMLElement>('.result-table .ant-table-thead')
        const headerScroller = node.querySelector<HTMLElement>('.result-table .ant-table-header')
        const headerTransform = header ? window.getComputedStyle(header).transform : null
        return {
          horizontalOffset: headerScroller?.scrollLeft || holder?.scrollLeft || null,
          scrollbarTransform: horizontalScrollbarThumb
            ? window.getComputedStyle(horizontalScrollbarThumb).transform
            : null,
          headerTransform
        }
      }), { timeout: 10000 }).toEqual({
        horizontalOffset: expect.closeTo(initialScrollPosition.horizontalOffset, 2),
        scrollbarTransform: initialScrollPosition.scrollbarTransform,
        headerTransform: initialScrollPosition.headerTransform
      })
      await activeResult.screenshot({ path: 'test-results/preview-scroll-after-refresh.png' })
    } finally {
      await electronApp.close()
    }
  })

  test('refreshing a preview should preserve the horizontal position reached with Shift plus mouse wheel @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, wideTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const holder = activeResult.locator('.result-table .ant-table-tbody-virtual-holder')
      await expect(holder).toBeVisible({ timeout: 30000 })
      const holderBox = await holder.boundingBox()
      expect(holderBox).not.toBeNull()

      await page.keyboard.down('Shift')
      await page.mouse.move(holderBox.x + holderBox.width / 2, holderBox.y + holderBox.height / 2)
      await page.mouse.wheel(0, 1200)
      await page.keyboard.up('Shift')

      const readHorizontalOffset = () =>
        activeResult.evaluate((node) => {
          const currentHolder = node.querySelector<HTMLElement>('.ant-table-tbody-virtual-holder')
          const header = node.querySelector<HTMLElement>('.ant-table-header')
          return {
            headerScrollLeft: header?.scrollLeft ?? 0,
            scrollWidth: currentHolder?.scrollWidth ?? 0,
            clientWidth: currentHolder?.clientWidth ?? 0
          }
        })
      const afterShiftWheel = await readHorizontalOffset()
      expect(afterShiftWheel.scrollWidth).toBeGreaterThan(afterShiftWheel.clientWidth)
      expect(afterShiftWheel.headerScrollLeft).toBeGreaterThan(0)

      await activeResult.screenshot({ path: 'test-results/shift-wheel-before-refresh.png' })
      await activeResult.getByRole('button', { name: '刷新' }).click()
      await expect(activeResult.locator('.result-table-loading-overlay')).toHaveCount(0, {
        timeout: 30000
      })
      await expect
        .poll(
          async () => (await readHorizontalOffset()).headerScrollLeft,
          { timeout: 10000 }
        )
        .toBeCloseTo(afterShiftWheel.headerScrollLeft, 0)
      await activeResult.screenshot({ path: 'test-results/shift-wheel-after-refresh.png' })
    } finally {
      await electronApp.close()
    }
  })

  test('virtual table headers should stay aligned after Shift wheel and drag auto-scroll @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openFixtureTable(page, largeTableName)

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      const readColumnAlignment = () =>
        activeResult.evaluate((node) => {
          const holder = node.querySelector<HTMLElement>('.ant-table-tbody-virtual-holder')
          const header = node.querySelector<HTMLElement>('.ant-table-header')
          const headerButton = Array.from(
            node.querySelectorAll<HTMLElement>('.ant-table-header [data-column-button]')
          ).at(-1)
          const column = headerButton?.dataset.columnButton
          const headerCell = headerButton?.closest<HTMLElement>('th')
          const bodyCell = column
            ? node.querySelector<HTMLElement>(
                `.ant-table-tbody-virtual .editable-cell[data-cell-column-key="${CSS.escape(column)}"]`
              )
            : null
          if (!holder || !header || !headerCell || !bodyCell) {
            return null
          }
          return {
            holderScrollLeft: holder.scrollLeft,
            headerScrollLeft: header.scrollLeft,
            headerLeft: headerCell.getBoundingClientRect().left,
            bodyLeft: bodyCell.getBoundingClientRect().left
          }
        })

      const holder = activeResult.locator('.result-table .ant-table-tbody-virtual-holder')
      await expect(holder).toBeVisible({ timeout: 30000 })
      const holderBox = await holder.boundingBox()
      expect(holderBox).not.toBeNull()

      await page.keyboard.down('Shift')
      await page.mouse.move(holderBox.x + holderBox.width / 2, holderBox.y + holderBox.height / 2)
      await page.mouse.wheel(0, 1200)
      await page.keyboard.up('Shift')
      await expect.poll(readColumnAlignment, { timeout: 10000 }).toEqual({
        holderScrollLeft: expect.any(Number),
        headerScrollLeft: expect.any(Number),
        headerLeft: expect.any(Number),
        bodyLeft: expect.any(Number)
      })
      const shiftWheelAlignment = await readColumnAlignment()
      expect(shiftWheelAlignment.headerScrollLeft).toBeGreaterThan(0)
      expect(Math.abs(shiftWheelAlignment.headerLeft - shiftWheelAlignment.bodyLeft)).toBeLessThanOrEqual(2)

      await holder.evaluate((element) => {
        element.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaX: -10000
          })
        )
      })
      const firstCell = activeResult.locator('.result-table .editable-cell[data-cell-key]').first()
      const firstCellBox = await firstCell.boundingBox()
      expect(firstCellBox).not.toBeNull()
      await page.mouse.move(firstCellBox.x + firstCellBox.width / 2, firstCellBox.y + firstCellBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(holderBox.x + holderBox.width + 100, firstCellBox.y + firstCellBox.height / 2, {
        steps: 8
      })
      await page.waitForTimeout(450)
      await page.mouse.up()

      const dragAlignment = await readColumnAlignment()
      expect(dragAlignment.headerScrollLeft).toBeGreaterThan(0)
      expect(Math.abs(dragAlignment.headerLeft - dragAlignment.bodyLeft)).toBeLessThanOrEqual(2)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('tree context menu should flip upward when there is not enough space below @bug', async () => {
    const electronApp = await launchRegressionApp({ windowHeight: 520 })

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)

      const targetKey = `table:${fixtureConnectionId}:::table:${largeTableName}`
      await expect.poll(async () => revealTreeNode(page, targetKey), { timeout: 15000 }).toBe(true)
      await page.evaluate((nodeKey) => {
        const target = document.querySelector(
          `.resource-tree-node-title[data-tree-node-key="${CSS.escape(nodeKey)}"]`
        )
        if (!(target instanceof HTMLElement)) {
          throw new Error(`Tree node not found: ${nodeKey}`)
        }
        target.scrollIntoView({ block: 'end' })
      }, targetKey)

      const targetNode = treeNode(page, targetKey)
      await expect(targetNode).toBeVisible({ timeout: 15000 })
      const nodeBox = await targetNode.boundingBox()
      expect(nodeBox).not.toBeNull()

      const clickX = nodeBox.x + Math.min(nodeBox.width - 12, 140)
      const clickY = nodeBox.y + nodeBox.height / 2
      await page.mouse.click(clickX, clickY, { button: 'right' })

      const menu = page.locator('.tree-context-menu-panel')
      await expect(menu).toBeVisible({ timeout: 10000 })
      const menuMetrics = await menu.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewportHeight: window.innerHeight
        }
      })

      expect(
        menuMetrics.bottom,
        'tree context menu should stay within the app viewport'
      ).toBeLessThanOrEqual(menuMetrics.viewportHeight - 6)
      expect(
        menuMetrics.top,
        'tree context menu should flip above the click when the lower space is insufficient'
      ).toBeLessThan(clickY - Math.min(20, menuMetrics.height / 5))
      expect(
        clickY - menuMetrics.bottom,
        'flipped tree context menu should stay visually close to the clicked node'
      ).toBeLessThanOrEqual(20)
    } finally {
      await electronApp.close()
    }
  })

  test('resource tree should not expose a horizontal scrollbar when the panel is narrow @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await resizeResourcePanel(page, 280)

      const overflowMetrics = await page.evaluate(() => {
        return [
          '.resource-tree-viewport',
          '.resource-tree-viewport .ant-tree-list',
          '.resource-tree-viewport .ant-tree-list-holder',
          '.resource-tree-viewport .ant-tree-list-holder-inner'
        ]
          .map((selector) => {
            const node = document.querySelector(selector)
            if (!(node instanceof HTMLElement)) {
              return null
            }
            return {
              selector,
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              overflowX: window.getComputedStyle(node).overflowX
            }
          })
          .filter(Boolean)
      })

      for (const metric of overflowMetrics) {
        expect(
          metric.scrollWidth - metric.clientWidth,
          `${metric.selector} should not overflow horizontally`
        ).toBeLessThanOrEqual(1)
      }
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
      await page.mouse.click(
        nodeBox.x + Math.min(nodeBox.width - 12, 120),
        nodeBox.y + nodeBox.height / 2,
        { button: 'right' }
      )

      const closeMenuItem = page
        .locator('.tree-context-menu-panel .ant-menu-item')
        .filter({ hasText: '关闭连接' })
        .first()
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
    const originalConnectionsRaw = fs.readFileSync(connectionsPath, 'utf-8')
    const connectionStore = JSON.parse(originalConnectionsRaw)
    const templateConnection = connectionStore.connections.find(
      (item) => item.connection_id === fixtureConnectionId
    )
    if (!templateConnection) {
      throw new Error(`Fixture connection not found: ${fixtureConnectionId}`)
    }
    const performanceConnections = Array.from({ length: 180 }, (_, index) => ({
      ...templateConnection,
      connection_id: `regression-selection-load-${String(index + 1).padStart(3, '0')}`,
      name: `回归选择性能 SQLite ${String(index + 1).padStart(3, '0')}`
    }))
    connectionStore.connections = connectionStore.connections.filter(
      (connection) => !connection.connection_id.startsWith('regression-selection-load-')
    )
    connectionStore.connections.push(...performanceConnections)
    fs.writeFileSync(connectionsPath, JSON.stringify(connectionStore, null, 2), 'utf-8')

    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)

      const firstKey = `connection:${fixtureConnectionId}`
      const secondKey = `connection:${performanceConnections[0].connection_id}`
      await expect.poll(async () => revealTreeNode(page, firstKey), { timeout: 15000 }).toBe(true)
      await expect.poll(async () => revealTreeNode(page, secondKey), { timeout: 15000 }).toBe(true)

      const firstNode = treeNode(page, firstKey)
      const secondNode = treeNode(page, secondKey)
      await expect(firstNode).toBeVisible({ timeout: 15000 })
      await expect(secondNode).toBeVisible({ timeout: 15000 })

      await firstNode.click()
      await expect(firstNode).toHaveClass(/is-selected/, { timeout: 5000 })

      const secondNodeBox = await secondNode.boundingBox()
      expect(secondNodeBox).not.toBeNull()
      const cdpSession = await page.context().newCDPSession(page)
      const tracingCompleted = new Promise<{ stream: string }>((resolve) => {
        cdpSession.once('Tracing.tracingComplete', resolve)
      })
      await cdpSession.send('Tracing.start', {
        categories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'disabled-by-default-devtools.timeline.picture',
          'blink.user_timing'
        ].join(','),
        transferMode: 'ReturnAsStream'
      })
      await page.evaluate((targetKey) => {
        const target = document.querySelector(
          `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
        )
        if (!(target instanceof HTMLElement)) {
          return
        }
        window.__treeSelectionTiming = {
          start: 0,
          classAppliedAt: null,
          paintedAt: null
        }
        const observer = new MutationObserver(() => {
          const timing = window.__treeSelectionTiming
          if (!timing || timing.classAppliedAt !== null || !target.classList.contains('is-selected')) {
            return
          }
          timing.classAppliedAt = performance.now()
          window.requestAnimationFrame(() => {
            timing.paintedAt = performance.now()
            observer.disconnect()
          })
        })
        observer.observe(target, { attributes: true, attributeFilter: ['class'] })
      }, secondKey)
      await page.evaluate(() => {
        performance.mark('tree-selection-click-start')
        window.__treeSelectionTiming.start = performance.now()
      })
      await page.mouse.click(secondNodeBox.x + secondNodeBox.width / 2, secondNodeBox.y + secondNodeBox.height / 2)

      const selectionTiming = await page.evaluate(async (targetKey) => {
        const timing = window.__treeSelectionTiming
        const target = document.querySelector(
          `.resource-tree-node-title[data-tree-node-key="${CSS.escape(targetKey)}"]`
        )
        if (!timing || !(target instanceof HTMLElement)) {
          return null
        }
        while (performance.now() - timing.start < 500) {
          if (target.classList.contains('is-selected')) {
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
            return {
              classAppliedMs: timing.classAppliedAt === null ? null : timing.classAppliedAt - timing.start,
              paintedMs: timing.paintedAt === null ? null : timing.paintedAt - timing.start
            }
          }
          await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        }
        return null
      }, secondKey)

      await page.waitForTimeout(120)
      await cdpSession.send('Tracing.end')
      const { stream } = await tracingCompleted
      let traceJson = ''
      for (;;) {
        const chunk = await cdpSession.send('IO.read', { handle: stream })
        traceJson += chunk.data
        if (chunk.eof) {
          break
        }
      }
      await cdpSession.send('IO.close', { handle: stream })
      const traceEvents = JSON.parse(traceJson).traceEvents as Array<{
        name: string
        ts?: number
        dur?: number
      }>
      const clickTraceEvent = traceEvents.find(
        (event) => event.name === 'tree-selection-click-start' && typeof event.ts === 'number'
      )
      const traceWindowEnd = (clickTraceEvent?.ts ?? 0) + 160_000
      const renderEvents = traceEvents
        .filter(
          (event) =>
            typeof event.ts === 'number' &&
            event.ts >= (clickTraceEvent?.ts ?? Number.POSITIVE_INFINITY) &&
            event.ts <= traceWindowEnd &&
            ['Paint', 'RasterTask', 'CompositeLayers', 'DrawFrame'].includes(event.name)
        )
        .map((event) => ({
          name: event.name,
          startMs: Number(((event.ts! - clickTraceEvent!.ts!) / 1_000).toFixed(2)),
          durationMs: Number(((event.dur ?? 0) / 1_000).toFixed(2))
        }))

      expect(
        selectionTiming,
        'clicking another connection row should switch selection without a noticeable delay'
      ).not.toBeNull()
      expect(
        selectionTiming.classAppliedMs,
        'connection row selection should update within a short interaction frame budget'
      ).toBeLessThan(160)
      console.log(
        `[perf][tree-selection][180-connections] ${JSON.stringify(selectionTiming)}`
      )
      console.log(
        `[perf][tree-selection-render][180-connections] ${JSON.stringify(renderEvents)}`
      )
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

      const alignment = await page
        .locator('.workspace-tab-panels .workspace-active-content .result-status')
        .evaluate((node) => {
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
      expect(
        alignment.gapRight,
        'preview pager should stay visually attached to the right edge'
      ).toBeLessThanOrEqual(24)
      expect(
        alignment.leftRatio,
        'preview pager should stay in the right half of the status bar'
      ).toBeGreaterThan(0.5)
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
      const deleteButton = activeResult.locator(
        '.table-toolbar-inline-actions [aria-label="删除选中行"]'
      )
      const saveButton = activeResult.locator('.table-toolbar-inline-actions [aria-label="提交"]')
      await expect(deleteButton).toBeDisabled()
      await expect(saveButton).toBeDisabled()
      await expect
        .poll(async () =>
          deleteButton.evaluate((node) => {
            const style = getComputedStyle(node)
            return { cursor: style.cursor, opacity: Number(style.opacity) }
          })
        )
        .toEqual({ cursor: 'not-allowed', opacity: 0.46 })

      const editableTarget = await activeResult.evaluate((node) => {
        const cell = node.querySelector<HTMLElement>('.editable-cell[data-cell-key]')
        if (!(cell instanceof HTMLElement)) {
          return null
        }
        const rect = cell.getBoundingClientRect()
        return {
          originalText: cell.textContent ?? '',
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }
      })
      expect(editableTarget).not.toBeNull()

      await page.mouse.dblclick(editableTarget.x, editableTarget.y)
      const inlineEditor = activeResult.locator('.editable-cell-dom-input')
      await expect(inlineEditor).toBeVisible({ timeout: 10000 })
      await inlineEditor.fill(`${editableTarget.originalText}__pending__`)
      await activeResult.locator('.result-status').click()

      await expect(
        page.locator('.result-status-warning-pill').filter({ hasText: '未提交' })
      ).toContainText('未提交', { timeout: 10000 })
      await expect(saveButton).toHaveClass(/is-pending-save/, { timeout: 10000 })
      await expect
        .poll(async () =>
          saveButton.evaluate((node) => {
            const icon = node.querySelector('.anticon')
            const buttonStyle = getComputedStyle(node)
            const iconStyle = icon ? getComputedStyle(icon) : null
            return {
              backgroundImage: buttonStyle.backgroundImage,
              iconFilter: iconStyle?.filter ?? '',
              iconTransform: iconStyle?.transform ?? ''
            }
          })
        )
        .toEqual({
          backgroundImage: 'none',
          iconFilter: expect.stringContaining('drop-shadow'),
          iconTransform: expect.not.stringMatching(/^none$/)
        })
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
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        const lastInsertedRow = node.querySelector(
          '.result-table tr[data-row-key^="new:"], .result-table .ant-table-row[data-row-key^="new:"]'
        )
        return {
          scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
          hasInsertedRow: Boolean(lastInsertedRow)
        }
      })
      expect(beforeState.hasInsertedRow).toBe(false)

      await activeResult.locator('.table-toolbar-inline-actions [aria-label="新增行"]').click()
      await page.waitForTimeout(600)

      const afterState = await activeResult.evaluate((node) => {
        const holder = node.querySelector(
          '.result-table .ant-table-tbody-virtual-holder, .result-table .ant-table-body'
        )
        const insertedRow = node.querySelector<HTMLElement>(
          '.result-table tr[data-row-key^="new:"], .result-table .ant-table-row[data-row-key^="new:"]'
        )
        const holderRect = holder instanceof HTMLElement ? holder.getBoundingClientRect() : null
        const rowRect =
          insertedRow instanceof HTMLElement ? insertedRow.getBoundingClientRect() : null
        return {
          scrollTop: holder instanceof HTMLElement ? holder.scrollTop : -1,
          insertedVisible: Boolean(
            holderRect &&
            rowRect &&
            rowRect.bottom <= holderRect.bottom &&
            rowRect.top >= holderRect.top
          ),
          insertedRowKey: insertedRow?.dataset.rowKey ?? null
        }
      })

      expect(
        afterState.insertedRowKey,
        'adding a preview row should render the inserted row'
      ).not.toBeNull()
      expect(
        afterState.scrollTop,
        'adding a preview row should move the table scroll downward'
      ).toBeGreaterThan(beforeState.scrollTop)
      expect(
        afterState.insertedVisible,
        'adding a preview row should scroll the inserted row into the visible area'
      ).toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('query pager should resolve and navigate to the last page with a visible disabled state @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
      await editorTextbox.focus()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select id, title from large_items order by id;')
      await page.locator('.query-execute-button').first().click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-table .ant-table-thead')).toBeVisible({
        timeout: 30000
      })
      await activeResult.locator('.result-limit-select').click()
      await page.getByText('300 条/页', { exact: true }).last().click()
      const firstPage = activeResult.getByRole('button', { name: '首页' })
      const lastPage = activeResult.getByRole('button', { name: '末页' })
      await expect(firstPage).toBeDisabled()
      await expect(lastPage).toBeEnabled()

      const disabledStyle = await firstPage.evaluate((node) => {
        const style = window.getComputedStyle(node)
        return {
          opacity: Number.parseFloat(style.opacity),
          transform: style.transform,
          transitionDuration: style.transitionDuration
        }
      })
      expect(disabledStyle.opacity).toBeLessThan(0.7)
      expect(disabledStyle.transform).toBe('none')
      expect(disabledStyle.transitionDuration).toBe('0s')

      await lastPage.click()
      await expect
        .poll(
          () =>
            activeResult
              .getByLabel('页码')
              .inputValue()
              .then((value) => Number(value)),
          { timeout: 30000 }
        )
        .toBeGreaterThan(1)
      await expect(lastPage).toBeDisabled({ timeout: 30000 })
      await expect(activeResult.getByRole('button', { name: '下一页' })).toBeDisabled()
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('query and table results should expose source-aware export options @smoke', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await openQueryWorkspace(page)

      const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
      await editorTextbox.focus()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('select id, name from small_items order by id;')
      await page.locator('.query-execute-button').first().click()

      const activeResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await expect(activeResult.locator('.result-export-button')).toBeVisible({ timeout: 30000 })
      await expect(activeResult.locator('.table-data-toolbar')).toHaveCount(0)
      await expect(
        activeResult.locator(
          '.result-pager .ant-space-item:has(button[aria-label="页内搜索"]) + .ant-space-item button.result-export-button'
        )
      ).toHaveCount(1)
      await activeResult.locator('.result-export-button').click()

      const exportModal = page.locator('.data-export-modal')
      await expect(exportModal).toBeVisible({ timeout: 10000 })
      await expect(exportModal.locator('.ant-modal-container')).toHaveCSS(
        'backdrop-filter',
        'blur(20px)'
      )
      await expect(exportModal.getByText('当前页', { exact: true })).toBeVisible()
      await expect(exportModal.getByText('全部数据', { exact: true })).toBeVisible()
      await expect(exportModal.getByText('id', { exact: true }).first()).toBeVisible()
      await exportModal.locator('.ant-select').last().click()
      await expect(page.getByText('Markdown', { exact: true }).last()).toBeVisible()
      await expect(page.getByText('SQL', { exact: true })).toHaveCount(0)
      await exportModal.locator('.ant-modal-close').click()
      await expect(exportModal).toBeHidden()

      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await openFixtureTable(page, smallTableName)
      const previewResult = page.locator('.workspace-tab-panels .workspace-active-content')
      await previewResult.locator('.result-export-button').click()
      await expect(exportModal).toBeVisible({ timeout: 10000 })
      await exportModal.locator('.ant-select').nth(1).click()
      await expect(page.getByText('SQL', { exact: true }).last()).toBeVisible()
      await expect(page.getByText('Markdown', { exact: true }).last()).toBeVisible()
      await exportModal.locator('.ant-modal-close').click()
      await expect(exportModal).toBeHidden()

      const tableKey = `table:${fixtureConnectionId}:::table:${smallTableName}`
      const tableNode = treeNode(page, tableKey)
      const tableNodeBox = await tableNode.boundingBox()
      expect(tableNodeBox).not.toBeNull()
      await page.mouse.click(
        tableNodeBox.x + Math.min(tableNodeBox.width - 12, 120),
        tableNodeBox.y + tableNodeBox.height / 2,
        { button: 'right' }
      )
      const treeExportItem = page
        .locator('.tree-context-menu-panel .ant-menu-item')
        .filter({ hasText: '导出' })
        .first()
      await expect(treeExportItem).toBeVisible({ timeout: 10000 })
      await treeExportItem.click()
      await expect(exportModal).toBeVisible({ timeout: 10000 })
      await expect(exportModal.getByText('导出列', { exact: true })).toBeVisible()
      await expect(exportModal.getByText('当前页', { exact: true })).toHaveCount(0)
      await exportModal.locator('.ant-select').nth(1).click()
      await expect(page.getByText('SQL', { exact: true }).last()).toBeVisible()
      await expect(page.getByText('Markdown', { exact: true }).last()).toBeVisible()
      await page.keyboard.press('Escape')
      await exportModal.locator('.ant-select').last().click()
      await expect(page.getByText('仅结构', { exact: true }).last()).toBeVisible()
      await expect(page.getByText('仅数据', { exact: true })).toHaveCount(0)
      await exportModal.locator('.ant-modal-close').click()
      await expect(exportModal).toBeHidden()
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('tree DDL action should use the structured unavailable code to silently reopen a closed connection @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)

      const tableKey = `table:${fixtureConnectionId}:::table:${smallTableName}`
      await expect.poll(async () => revealTreeNode(page, tableKey), { timeout: 10000 }).toBe(true)
      const tableNode = treeNode(page, tableKey)
      await expect(tableNode).toBeVisible({ timeout: 10000 })
      const tableNodeBox = await tableNode.boundingBox()
      expect(tableNodeBox).not.toBeNull()
      await page.mouse.click(
        tableNodeBox.x + Math.min(tableNodeBox.width - 12, 120),
        tableNodeBox.y + tableNodeBox.height / 2,
        { button: 'right' }
      )

      const menu = page.locator('.tree-context-menu-panel')
      await expect(menu).toBeVisible({ timeout: 10000 })
      const importItem = menu.locator('.ant-menu-item').filter({ hasText: '导入' }).first()
      await expect(importItem).toBeVisible({ timeout: 10000 })
      await expect(importItem.locator('.anticon-import')).toHaveCount(1)
      await page.evaluate(async (connectionId) => {
        await window.api.requestJson(`/connections/${connectionId}/close`, { method: 'POST' })
      }, fixtureConnectionId)
      await menu.locator('.ant-menu-item').filter({ hasText: '查看 DDL' }).first().click()

      const ddlDialog = page.getByRole('dialog')
      await expect(ddlDialog).toContainText(`${smallTableName} DDL`, { timeout: 15000 })
      await expect(ddlDialog.locator('.ddl-preview-shell .monaco-editor')).toBeVisible({
        timeout: 15000
      })
      await expect(ddlDialog).toHaveClass(/ddl-preview-modal/)
      await expect(ddlDialog.locator('.ant-modal-container')).toHaveCSS(
        'backdrop-filter',
        'blur(20px)'
      )
      await expect(ddlDialog.locator('.ddl-preview-shell .vs-whitespace')).toHaveCount(0)
      await expect(treeNode(page, `connection:${fixtureConnectionId}`)).toHaveClass(/is-open/)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('Dameng table designer should expose safe table and column rename support @bug', async () => {
    const sharedSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'app-shared.tsx'),
      'utf-8'
    )
    const panelSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'table-designer-panel.tsx'),
      'utf-8'
    )
    const appSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'),
      'utf-8'
    )

    expect(sharedSource).toContain("databaseType === 'dm'")
    expect(panelSource).toContain("const canRename = isCreateMode || connection?.database_type === 'dm'")
    expect(panelSource).toContain('disabled={!canRename}')
    expect(appSource).toContain('encodeURIComponent(editingOriginalTableName)')
    expect(appSource).toContain('table_name: updatedTableName')
    expect(appSource).toContain('source_name: column.key')
  })

  test('Dameng table designer should keep comments editable and preserve the loaded table group on non-rename saves @bug', async () => {
    const sharedSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'app-shared.tsx'),
      'utf-8'
    )
    const appSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'),
      'utf-8'
    )

    expect(sharedSource).toContain("databaseType === 'dm'")
    expect(appSource).toContain('const updatedTableName = editingTableName.trim()')
    expect(appSource).toContain('if (editingOriginalTableName !== updatedTableName) {\n        if (editingPgDatabaseName)')
    expect(appSource).toContain('table_comment: editingTableComment.trim()')
    expect(appSource).toContain('comment: column.comment.trim()')
  })

  test('refreshing a grouped connection should retain the latest folder expansion @bug', async () => {
    const refreshSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'tree-refresh.ts'),
      'utf-8'
    )

    expect(refreshSource).toContain('expandedKeysRef: MutableRefObject<React.Key[]>')
    expect(refreshSource).toContain('setExpandedKeys((current) => {')
    expect(refreshSource).toContain('return true')
    expect(refreshSource).toContain('expandedKeysRef.current = next')
  })

  test('tree loading indicators should rotate continuously @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)
      const animation = await page.evaluate(() => {
        const tree = document.querySelector('.resource-tree-shell')
        if (!(tree instanceof HTMLElement)) {
          return null
        }
        const icon = document.createElement('span')
        icon.className = 'anticon anticon-spin tree-node-loading-icon'
        tree.append(icon)
        const style = window.getComputedStyle(icon)
        const result = {
          name: style.animationName,
          duration: style.animationDuration,
          iterationCount: style.animationIterationCount
        }
        icon.remove()
        return result
      })

      expect(animation).toEqual({
        name: 'dj-tree-loading-spin',
        duration: '0.78s',
        iterationCount: 'infinite'
      })
    } finally {
      await electronApp.close()
    }
  })

  test('table tree should show names before deferred size statistics are requested @bug', async () => {
    const runtimeSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'tree-runtime.ts'),
      'utf-8'
    )
    const appSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'),
      'utf-8'
    )

    expect(runtimeSource).toContain('include_stats=true')
    expect(runtimeSource).toContain("sizeLoading: resolvedType === 'table' && shouldLoadTableStats")
    expect(runtimeSource).toContain('children.some((child) => child.sizeLoading)')
    expect(appSource).toContain('node.sizeLoading ? (')
    expect(appSource).toContain('tree-size-loading-icon')

    const electronApp = await launchRegressionApp()
    try {
      const page = await electronApp.firstWindow()
      await waitForAppReady(page)

      await openFixtureConnection(page)
      await ensureTreeNodeExpanded(page, `object-group:${fixtureConnectionId}:::table`)
      await expect(treeNode(page, `table:${fixtureConnectionId}:::table:${smallTableName}`)).toBeVisible()

      const objectNames = await page.evaluate(async (connectionId) => {
        const response = await window.api.requestJson(`/connections/${connectionId}/objects?type=table`)
        return response.objects.map((item) => item.name)
      }, fixtureConnectionId)
      expect(objectNames).toContain(smallTableName)
    } finally {
      await electronApp.close()
    }
  })

  test('SQL editor should not render whitespace markers @bug', async () => {
    const electronApp = await launchRegressionApp()

    try {
      const page = await electronApp.firstWindow()
      attachPageConsole(page)
      await waitForAppReady(page)
      await ensureWindowSize(page)
      await openQueryWorkspace(page)

      const editorTextbox = page.getByRole('textbox', { name: 'Editor content' }).first()
      await editorTextbox.focus()
      await page.keyboard.type('SELECT  id FROM small_items')
      await expect(
        page.locator(
          '.sql-editor-container .mtkw, .sql-editor-container .mtkz, .sql-editor-container .mwh'
        )
      ).toHaveCount(0)
      await expect(page.locator('.app-error-boundary')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
