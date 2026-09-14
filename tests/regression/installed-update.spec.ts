const { test, expect, _electron: electron } = require('@playwright/test')
const { createServer } = require('node:http')
const { createReadStream, existsSync } = require('node:fs')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const asar = require('@electron/asar')
const exec = promisify(execFile)

// This is deliberately separate from unpacked-app smoke: it runs a real NSIS
// baseline install, the unmodified app's three update IPCs and the real target EXE.
test('installed application downloads, installs, relaunches and preserves settings @installed-update', async () => {
  test.skip(process.env.DATADJINN_RUN_INSTALLED_UPDATE !== '1')
  test.setTimeout(240000)
  const root = path.resolve(__dirname, '../..')
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
  const dir = path.join(root, '.tmp', 'installed-update')
  const installDir = path.join(dir, 'DataDjinn')
  const exe = path.join(installDir, 'DataDjinn.exe')
  const profile = path.join(dir, '用户设置 space')
  const baseline = process.env.DATADJINN_UPDATE_BASE_INSTALLER
  const target = path.join(root, 'dist', `DataDjinn-${version}-setup.exe`)
  expect(existsSync(baseline || '')).toBe(true)
  expect(existsSync(target)).toBe(true)
  await mkdir(profile, { recursive: true })

  // Never replace an unrelated installation when this gate runs on a developer PC.
  const registered = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*','HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq 'DataDjinn' | ForEach-Object { $_.DisplayIcon -replace ',0$', '' }"], { windowsHide: true })
  for (const location of registered.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    expect(path.dirname(path.resolve(location)).toLowerCase()).toBe(installDir.toLowerCase())
  }
  await new Promise((resolve, reject) => {
    const child = spawn(baseline, ['/S', `/D=${installDir}`], { windowsHide: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`基线安装失败：${code}`)))
  })
  const getInstalledVersion = () => {
    const archive = path.join(installDir, 'resources/app.asar')
    asar.uncache(archive)
    return JSON.parse(asar.extractFile(archive, 'package.json').toString()).version
  }
  const baselineVersion = getInstalledVersion()
  expect(baselineVersion).not.toBe(version)
  const metadata = await readFile(path.join(root, 'dist/latest.yml'), 'utf8')
  const requested = []
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    requested.push(pathname)
    if (pathname.endsWith('/releases.atom')) {
      res.end(`<feed><entry><title>DataDjinn v${version}</title><link href="https://github.com/vhukze/DataDjinn/releases/tag/v${version}"/><content type="html">安装更新通用验证</content></entry></feed>`)
    } else if (pathname.endsWith('/latest.yml')) {
      res.end(metadata)
    } else if (pathname.endsWith(`/DataDjinn-${version}-setup.exe`)) {
      res.setHeader('content-type', 'application/octet-stream')
      createReadStream(target).pipe(res)
    } else { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const app = await electron.launch({ executablePath: exe, env: {
    ...process.env, DATADJINN_TEST_USER_DATA_DIR: profile, DATADJINN_SKIP_SPLASH: '1'
  } })
  const oldProcess = app.process()
  let appExited = false
  oldProcess.once('exit', () => { appExited = true })
  try {
    // Only network responses are redirected; download, checksum, cache, shutdown
    // and installation all execute the packaged application code without mocks.
    await app.evaluate(({ session }, origin) => {
      const original = global.fetch
      global.fetch = (input, options) => {
        const url = new URL(String(input))
        return original(url.hostname === 'github.com' ? origin + url.pathname + url.search : input, options)
      }
      session.fromPartition('electron-updater').webRequest.onBeforeRequest({ urls: ['https://github.com/*'] }, (details, callback) => {
        const url = new URL(details.url)
        callback({ redirectURL: origin + url.pathname + url.search })
      })
    }, origin)
    const page = await app.firstWindow()
    await page.waitForSelector('.app-shell[data-startup-ready="true"]', { timeout: 60000 })
    await page.evaluate(() => window.api.setAutoCheckUpdates(false))
    const checked = await page.evaluate(() => window.api.checkForUpdates())
    expect(checked.available).toBe(true)
    expect(checked.latestVersion).toBe(version)
    await page.evaluate(() => window.api.downloadUpdate())
    const settingsBefore = JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8'))
    await page.evaluate(() => window.api.installUpdate()).catch(error => {
      if (!/closed|destroyed/i.test(error.message)) throw error
    })
    await expect.poll(() => appExited, { timeout: 30000 }).toBe(true)
    await expect.poll(() => { try { return getInstalledVersion() } catch { return '' } }, { timeout: 90000 }).toBe(version)
    const escapedExe = exe.replace(/'/g, "''")
    let newPid = 0
    await expect.poll(async () => {
      const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escapedExe}' -and $_.CommandLine -notmatch '--type=' } | Select-Object -ExpandProperty ProcessId`], { windowsHide: true })
      newPid = Number(result.stdout.trim().split(/\s+/)[0])
      return newPid > 0 && newPid !== oldProcess.pid
    }, { timeout: 60000 }).toBe(true)
    expect(JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8'))).toEqual(settingsBefore)
    expect(requested.some(url => url.endsWith('.exe'))).toBe(true)
    // Only stop the new main process from this test's validated install path.
    await exec('taskkill', ['/PID', String(newPid), '/T', '/F'], { windowsHide: true })
    const reopened = await electron.launch({ executablePath: exe, env: {
      ...process.env, DATADJINN_TEST_USER_DATA_DIR: profile, DATADJINN_SKIP_SPLASH: '1'
    } })
    try {
      const page = await reopened.firstWindow()
      await page.waitForSelector('.app-shell[data-startup-ready="true"]', { timeout: 60000 })
      expect((await page.evaluate(() => window.api.getUpdateSettings())).autoCheckUpdates).toBe(false)
      expect(await reopened.evaluate(({ app }) => app.getVersion())).toBe(version)
      expect((await page.evaluate(() => window.api.getBackendStatus())).state).toBe('online')
      await page.screenshot({ path: path.join(dir, 'updated-app.png') })
    } finally { await reopened.close() }
    await writeFile(path.join(dir, 'passed.json'), JSON.stringify({ baselineVersion, version, oldPid: oldProcess.pid, newPid, settingsPreserved: true, backendOnline: true, requested, verifiedAt: new Date().toISOString() }, null, 2), 'utf8')
    console.log(`真实安装升级通过：${baselineVersion} -> ${version}，重启 PID ${newPid}，配置保留，后端正常`)
  } finally {
    if (!appExited) await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})
