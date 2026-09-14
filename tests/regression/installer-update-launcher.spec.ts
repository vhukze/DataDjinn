const { expect, test, _electron: electron } = require('@playwright/test')
const { createHash } = require('node:crypto')
const { readFile, writeFile, mkdir, mkdtemp } = require('node:fs/promises')
const { createServer } = require('node:http')
const { join, resolve } = require('node:path')
const ts = require('typescript')

test('downloaded installer enters the standard updater cache and NSIS lifecycle @smoke', async () => {
  test.skip(process.platform !== 'win32')
  const root = resolve(__dirname, '../..')
  await mkdir(join(root, '.tmp'), { recursive: true })
  const dir = await mkdtemp(join(root, '.tmp', '更新验证 space-'))
  const payload = Buffer.from('installer cache contract test')
  const sha512 = createHash('sha512').update(payload).digest('base64')
  const server = createServer((req, res) => {
    if (req.url.startsWith('/latest.yml')) {
      res.end(`version: 0.3.15\nfiles:\n  - url: DataDjinn-0.3.15-setup.exe\n    sha512: ${sha512}\n    size: ${payload.length}\npath: DataDjinn-0.3.15-setup.exe\nsha512: ${sha512}\nreleaseDate: '2026-09-14T00:00:00Z'\n`)
    } else { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const feed = `http://127.0.0.1:${server.address().port}`
  const source = await readFile(join(root, 'src/main/installer-update-launcher.ts'), 'utf8')
  await writeFile(join(dir, 'updater.cjs'), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, 'utf8')
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'update-regression', version: '0.3.13', main: 'main.cjs' }), 'utf8')
  await writeFile(join(dir, 'app-update.yml'), `provider: generic\nurl: ${feed}\nupdaterCacheDirName: update-cache\n`, 'utf8')
  await writeFile(join(dir, 'main.cjs'), `
    const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(dir)});
    const { InstallerUpdater } = require('./updater.cjs');
    global.updater = new InstallerUpdater();
    global.updater.forceDevUpdateConfig = true;
    global.updater.updateConfigPath = ${JSON.stringify(join(dir, 'app-update.yml'))};
    global.updater.autoDownload = false;
    global.updater.autoInstallOnAppQuit = false;
    global.updater.setFeedURL(${JSON.stringify(feed)});
    global.events = [];
    global.updater.on('update-downloaded', info => global.events.push(info));
    // Inspect the real inherited NSIS installation dispatch without executing test bytes.
    global.spawnCalls = [];
    global.updater.spawnLog = async (command, args) => { global.spawnCalls.push({command, args}); return true; };
    app.whenReady().then(() => { global.ready = true; });
  `, 'utf8')
  const app = await electron.launch({ args: [dir], env: { ...process.env, LOCALAPPDATA: dir } })
  const installer = join(dir, "下载 O'Brien 安装包.exe")
  try {
    await writeFile(installer, Buffer.from('corrupted'), 'utf8')
    await expect(app.evaluate(async (_, file) => global.updater.prepareDownloadedInstaller(file), installer)).rejects.toThrow('请先检查更新')
    await app.evaluate(async () => global.updater.checkForUpdates())
    await expect(app.evaluate(async (_, file) => global.updater.prepareDownloadedInstaller(file), installer)).rejects.toThrow('安装包校验失败')
    expect(await app.evaluate(() => global.events.length)).toBe(0)
    await writeFile(installer, payload)
    await app.evaluate(async (_, file) => global.updater.prepareDownloadedInstaller(file), installer)
    const downloaded = await app.evaluate(() => global.events[0])
    expect(downloaded.version).toBe('0.3.15')
    expect(await readFile(downloaded.downloadedFile)).toEqual(payload)
    expect(await app.evaluate(() => global.updater.install(true, true))).toBe(true)
    const calls = await app.evaluate(() => global.spawnCalls)
    expect(calls).toEqual([{ command: downloaded.downloadedFile, args: ['--updated', '/S', '--force-run'] }])
    expect(await app.evaluate(() => global.updater.install(true, true))).toBe(false)
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})
