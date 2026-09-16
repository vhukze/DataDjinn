import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import yaml from 'js-yaml'
import ts from 'typescript'

type BuilderConfig = {
  compression?: string
  files?: string[]
  extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>
  win?: { electronLanguages?: string[] }
}

test('windows package should use a runtime whitelist and maximum compression @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const config = yaml.load(
    fs.readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf-8')
  ) as BuilderConfig

  expect(config.compression).toBe('maximum')
  expect(config.files).toEqual(['out/**/*', 'resources/**/*', 'package.json'])
  expect(config.files).not.toContain('**/*')
  expect(config.win?.electronLanguages).toEqual(['zh-CN', 'en-US'])
  expect(config.extraResources).toContainEqual({
    from: 'backend/dist/datadjinn-backend',
    to: 'backend',
    filter: ['**/*']
  })
})

test('production dependencies should only contain modules loaded by main and preload @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')
  ) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    scripts: Record<string, string>
  }

  expect(Object.keys(packageJson.dependencies).sort()).toEqual([
    '@electron-toolkit/preload',
    '@electron-toolkit/utils',
    'electron-store',
    'electron-updater'
  ])
  for (const bundledDependency of [
    '@ant-design/icons',
    '@monaco-editor/react',
    'antd',
    'dompurify',
    'marked',
    'monaco-editor',
    'motion',
    'sql-formatter',
    'zustand'
  ]) {
    expect(packageJson.devDependencies).toHaveProperty(bundledDependency)
  }
  for (const buildScript of [
    'build:unpack',
    'build:win:installer',
    'build:win:zip',
    'build:win:all'
  ]) {
    expect(packageJson.scripts[buildScript]).toContain('npm run test:package:contents')
  }
})

test('release workflow should publish installer and portable packages after packaged smoke @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const workflow = yaml.load(
    fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'release.yml'), 'utf-8')
  ) as {
    jobs: {
      build: {
        strategy: { matrix: { include: Array<Record<string, string>> } }
        steps: Array<{ name?: string; run?: string }>
      }
    }
  }
  const windowsBuild = workflow.jobs.build.strategy.matrix.include[0]

  expect(windowsBuild.build_command).toBe('npm run build:win:all')
  expect(windowsBuild.artifact_paths).toContain('dist/*.exe')
  expect(windowsBuild.artifact_paths).toContain('dist/*.zip')
  expect(workflow.jobs.build.steps).toContainEqual(
    expect.objectContaining({
      name: 'Run packaged build smoke test',
      run: expect.stringContaining('packaged-build-smoke.spec.ts')
    })
  )
  expect(workflow.jobs.build.steps).toContainEqual(
    expect.objectContaining({ run: 'npm run test:update:installed' })
  )
})

test('main app update feed should ignore extension-only releases @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const atomParserSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'main', 'github-release.ts'),
    'utf-8'
  )

  expect(mainSource).toContain('const GITHUB_RELEASES_ATOM_URL')
  expect(mainSource).toContain('releases.atom')
  expect(mainSource).toContain('extractLatestMainReleaseFromAtom(feed)')
  expect(mainSource).toContain("from './github-release'")
  expect(mainSource).toContain('没有找到主程序正式版本发布')
  expect(mainSource).toContain('configureInstallerUpdateFeed(release)')
  expect(atomParserSource).toContain('MAIN_RELEASE_TAG_PATTERN')
  expect(atomParserSource).toContain("body = extractXmlText(entry, 'content')")
  expect(mainSource).toContain('normalizeUpdateCheckError')
  expect(mainSource).toContain('当前网络无法连接 GitHub')
  expect(mainSource).toContain('const downloadInstallerUpdate')
  expect(mainSource).toContain("latest.yml")
  expect(mainSource).toContain("hash.digest('base64') !== expectedSha512")
  expect(mainSource).toContain('await downloadInstallerUpdate()')
  expect(mainSource).toContain('releaseInfo.releaseNotes')
  expect(mainSource).not.toContain('await autoUpdater.downloadUpdate()')
})

test('installer update uses standard NSIS quit and install without console scripts @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')

  expect(mainSource).toContain("from './installer-update-launcher'")
  expect(mainSource).toContain('autoUpdater.prepareDownloadedInstaller(filePath)')
  expect(mainSource).toContain('const installSilentlyForTest = Boolean(')
  expect(mainSource).toContain("testUserDataDir && process.env.DATADJINN_TEST_SILENT_UPDATE === '1'")
  expect(mainSource).toContain('autoUpdater.quitAndInstall(installSilentlyForTest, true)')
  expect(mainSource).not.toContain('autoUpdater.quitAndInstall(true, true)')
  expect(mainSource).toContain('Keep the standard NSIS wizard visible during an online update.')
  expect(mainSource).toContain('await Promise.all([backendManager.stop(), aiModuleManager.stop()])')
  expect(mainSource).not.toContain('launchInstallerAfterProcessExit')
  expect(mainSource).not.toContain('timeout /t 1 /nobreak')

})

test('guided installer stops the running application process tree before replacing files @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const config = fs.readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf-8')
  const installerScript = fs.readFileSync(path.join(projectRoot, 'build', 'installer.nsh'), 'utf-8')

  expect(config).toContain('include: build/installer.nsh')
  expect(installerScript).toContain('!macro customCheckAppRunning')
  expect(installerScript).toContain('taskkill.exe')
  expect(installerScript).toContain('/F /T /IM "${APP_EXECUTABLE_FILENAME}"')
  expect(installerScript).toContain('$(appCannotBeClosed)')
})

test('installer update shows an immediate handoff state before the app exits @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const appSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'),
    'utf-8'
  )

  expect(appSource).toContain("const [installingUpdate, setInstallingUpdate] = useState(false)")
  expect(appSource).toContain('setInstallingUpdate(true)')
  expect(appSource).toContain("'正在退出并启动安装…'")
  expect(appSource).toContain('disabled={installingUpdate}')
})

test('GitHub release atom parser keeps main release notes and skips module releases @smoke', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'github-release.ts'), 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const parserModule = new Module(path.join(__dirname, '..', '..', 'src', 'main', 'github-release.ts'))
  parserModule.filename = path.join(__dirname, '..', '..', 'src', 'main', 'github-release.ts')
  parserModule.paths = Module['_nodeModulePaths'](path.dirname(parserModule.filename))
  parserModule._compile(compiled, parserModule.filename)
  const { extractLatestMainReleaseFromAtom } = parserModule.exports as typeof import('../../src/main/github-release')
  const feed = `<?xml version="1.0"?><feed>
    <entry><title>DataDjinn modules v1.3.0</title><link href="https://github.com/vhukze/DataDjinn/releases/tag/modules-v1.3.0"/><content type="html">&lt;h1&gt;Modules&lt;/h1&gt;</content></entry>
    <entry><title>DataDjinn v0.3.12</title><link href="https://github.com/vhukze/DataDjinn/releases/tag/v0.3.12"/><content type="html">&lt;h1&gt;DataDjinn v0.3.12&lt;/h1&gt;\n&lt;ul&gt;\n&lt;li&gt;修复在线更新&lt;/li&gt;\n&lt;/ul&gt;</content></entry>
  </feed>`

  expect(extractLatestMainReleaseFromAtom(feed)).toEqual({
    tagName: 'v0.3.12',
    name: 'DataDjinn v0.3.12',
    body: '<h1>DataDjinn v0.3.12</h1>\n<ul>\n<li>修复在线更新</li>\n</ul>'
  })
})

test('a transient API fetch failure should not restart a healthy backend @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const backendSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'backend.ts'), 'utf-8')

  expect(mainSource).toContain('await backendManager.recoverIfUnhealthy')
  expect(backendSource).toContain('async recoverIfUnhealthy')
  expect(backendSource).toContain('await checkHealth(`${apiBaseUrl}/health`)')
})

test('a transient local API read failure should retry once without replaying writes @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')

  expect(mainSource).toContain('const canRetryTransientApiRequest')
  expect(mainSource).toContain("['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)")
  expect(mainSource).toContain(".has('open_attempt_id')")
  expect(mainSource).toContain('await waitForTransientApiRetry()')
  expect(mainSource).toContain('retrying once')
})

test('renderer should defer heavy workspaces and editor surfaces until they are opened @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const appSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'),
    'utf-8'
  )
  const workspaceSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'workspace-content.tsx'),
    'utf-8'
  )
  const modalSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'modal-region.tsx'),
    'utf-8'
  )
  const aiHostSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'ai-dock-panel-host.tsx'),
    'utf-8'
  )

  expect(appSource).toContain("lazy(() => import('./app/table-designer-panel'))")
  expect(appSource).toContain("lazy(() => import('./app/result-table-panel'))")
  expect(workspaceSource).toContain("lazy(() => import('./query-workspace-panel'))")
  expect(workspaceSource).toContain('<Suspense')
  expect(modalSource).toContain("lazy(() => import('../components/SqlEditor'))")
  expect(modalSource).toContain('<Suspense')
  expect(aiHostSource).toContain("lazy(() => import('../components/AIPanel'))")
  expect(aiHostSource).toContain('<Suspense')
})

test('AI should be an optional local module and the core backend should not mount AI routes @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const managerSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'ai-module.ts'), 'utf-8')
  const replacementSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'main', 'optional-module-replacement.ts'),
    'utf-8'
  )
  const backendSource = fs.readFileSync(path.join(projectRoot, 'backend', 'app', 'main.py'), 'utf-8')
  const moduleEntrySource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'run_ai_module.py'),
    'utf-8'
  )

  expect(mainSource).toMatch(/type OptionalModuleId =\s*\n\s*\| 'mcp'/)
  expect(mainSource).toContain("const isAiApiPath = (path: string): boolean")
  expect(mainSource).toContain('await ensureAiModuleForRequest()')
  expect(mainSource).toContain('await aiModuleManager.stop()')
  expect(mainSource).toContain('const MAX_OPTIONAL_MODULE_DOWNLOAD_ATTEMPTS = 3')
  expect(mainSource).toContain('downloadOptionalModuleArchive')
  expect(replacementSource).toContain('const MAX_REPLACE_ATTEMPTS = 8')
  expect(replacementSource).toContain('movePendingOptionalModuleDirectory')
  expect(mainSource).toContain('replaceOptionalModuleDirectory')
  expect(mainSource).toContain('Get-CimInstance Win32_Process')
  expect(mainSource).toContain('terminateMcpProcesses')
  expect(mainSource).toContain("optional-modules:install-force")
  expect(managerSource).toContain('DATADJINN_AI_MODULE_PORT')
  expect(managerSource).toContain('DATADJINN_DATA_DIR')
  expect(managerSource).toContain('X-DataDjinn-Api-Token')
  expect(backendSource).not.toContain('app.include_router(ai_router')
  expect(moduleEntrySource).toContain('app.include_router(ai_router, prefix="/api")')
})

test('optional modules should expose independent update status and action @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')
  const catalog = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'module-catalog.json'), 'utf-8')
  ) as { modules: Array<{ id: string; version: string; sha256: string }> }

  expect(mainSource).toContain("version: '1.0.2'")
  expect(mainSource).toContain('OPTIONAL_MODULE_CATALOG_URL')
  expect(mainSource).toContain('getOptionalModuleArtifacts')
  expect(mainSource).toContain('OPTIONAL_MODULE_CATALOG_CACHE_MS')
  expect(catalog.modules.find((module) => module.id === 'mcp')).toMatchObject({ version: '1.0.6' })
  expect(catalog.modules.every((module) => /^[a-f0-9]{64}$/i.test(module.sha256))).toBe(true)
  expect(catalog.modules.find((module) => module.id === 'clickhouse')).toMatchObject({ version: '1.0.0' })
  expect(catalog.modules.find((module) => module.id === 'elasticsearch')).toMatchObject({ version: '1.0.0' })
  expect(mainSource).toContain("id: 'clickhouse'")
  expect(mainSource).toContain("id: 'elasticsearch'")
  expect(appSource).toContain('module.updateAvailable')
  expect(appSource).toContain('module.pendingRestartRequired')
  expect(appSource).toContain('重启 MCP 调用方后生效')
  expect(appSource).toContain('MCP 正在被占用')
  expect(appSource).toContain('forceInstallOptionalModule')
  expect(appSource).toContain("'es_auth_type'")
  expect(appSource).toContain('connection_folder_assignments: nextConnectionFolderAssignments')
  expect(appSource).toContain('git-background-task-menu')
  expect(appSource).toContain('/git-versioning/tasks/${taskId}/cancel')
  expect(appSource).toContain("? '有更新'")
  expect(appSource).toContain(": '已安装'")
  expect(appSource).toContain(": '更新'}")
  expect(appSource).toContain(": '安装'}")
  expect(appSource).toContain("? '待重启生效'")
})

test('MCP artifact metadata should match the published module version @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const catalog = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'module-catalog.json'), 'utf-8')
  ) as { modules: Array<{ id: string; version: string; url: string; sha256: string }> }
  const mcp = catalog.modules.find((module) => module.id === 'mcp')

  expect(mcp).toMatchObject({
    version: '1.0.6',
    url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.0.6/datadjinn-mcp-1.0.6-win-x64.zip'
  })
  expect(mcp?.sha256).toBe('ee8a8fd25e49f2a80c64c4955507abd1cca5e58a0209aa4649c69cce93da6987')
  expect(mainSource).toContain('OPTIONAL_MODULE_ARTIFACT_CATALOG')
})

test('AI artifact metadata should match the published module version @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const catalog = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'module-catalog.json'), 'utf-8')
  ) as { modules: Array<{ id: string; version: string; url: string }> }
  const ai = catalog.modules.find((module) => module.id === 'ai')

  expect(ai).toMatchObject({
    version: '1.0.0',
    url: 'https://github.com/vhukze/DataDjinn/releases/download/modules-v1.0.0/datadjinn-ai-1.0.0-win-x64.zip'
  })
  expect(mainSource).toContain('OPTIONAL_MODULE_ARTIFACT_CATALOG')
})

test('optional module installs should preserve the stable MCP path @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const replacementSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'main', 'optional-module-replacement.ts'),
    'utf-8'
  )

  expect(mainSource).toContain("join(app.getPath('userData'), 'modules', moduleId, 'current')")
  expect(mainSource).toContain('const installPath = getStableOptionalModuleInstallPath(moduleId)')
  expect(mainSource).toContain('const pendingPath = join(moduleRoot, `.pending-')
  expect(mainSource).toContain('retryPendingOptionalModuleInstalls')
  expect(mainSource).toContain('withOptionalModuleReplacementLock')
  expect(mainSource).toContain('isCurrentPendingOptionalModule')
  expect(replacementSource).toContain('const replacementLocks')
  expect(replacementSource).toContain('待替换的扩展目录不存在')
  expect(replacementSource).toContain('movedCurrentToBackup && !existsSync(installPath)')
  expect(replacementSource).toContain('const backupPath = `${installPath}.old-')
  expect(mainSource).toContain('await migrateInstalledOptionalModulePaths()')
  expect(mainSource).toContain('const currentModules = installedModules.filter')
  expect(mainSource).not.toContain('legacyInstallPaths')
})

test('JDBC bridge should be optional and excluded from the core backend package @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf-8')
  const backendBuildSource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'scripts', 'build_backend.py'),
    'utf-8'
  )
  const runtimeBuildSource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'scripts', 'build_jdbc_runtime_module.py'),
    'utf-8'
  )
  const launcherSource = fs.readFileSync(path.join(projectRoot, 'backend', 'run.py'), 'utf-8')

  expect(mainSource).toContain("id: 'jdbc'")
  expect(mainSource).toContain('detectUsableLocalJavaRuntime')
  expect(mainSource).toContain("'jdbc-runtime'")
  expect(mainSource).toContain("'jre-17'")
  expect(mainSource).toContain('DATADJINN_JDBC_RUNTIME_PATH')
  expect(mainSource).toContain('DATADJINN_JRE_MODULE_HOME')
  expect(backendBuildSource).not.toContain('"--hidden-import",\n        "jaydebeapi"')
  expect(backendBuildSource).not.toContain('"--hidden-import",\n        "jpype"')
  expect(runtimeBuildSource).toContain('jaydebeapi==1.2.3')
  expect(runtimeBuildSource).toContain('"id": "jdbc-runtime"')
  expect(launcherSource).toContain('_configure_optional_jdbc_runtime')
})

test('database client extensions should stay outside the core backend package @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const backendBuildSource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'scripts', 'build_backend.py'),
    'utf-8'
  )
  const runtimeBuildSource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'scripts', 'build_database_runtime_module.py'),
    'utf-8'
  )
  const packageValidationSource = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'validate-package-contents.cjs'),
    'utf-8'
  )
  const launcherSource = fs.readFileSync(path.join(projectRoot, 'backend', 'run.py'), 'utf-8')

  expect(backendBuildSource).toMatch(/"--exclude-module",\s*"clickhouse_connect"/)
  expect(backendBuildSource).toMatch(/"--exclude-module",\s*"elasticsearch"/)
  expect(backendBuildSource).toMatch(/"--exclude-module",\s*"oracledb"/)
  expect(runtimeBuildSource).toContain('"clickhouse-connect==0.10.0"')
  expect(runtimeBuildSource).toContain('"elasticsearch==8.18.1"')
  expect(runtimeBuildSource).not.toContain('target.glob("*.dist-info")')
  expect(packageValidationSource).toContain("'backend/_internal/clickhouse_connect'")
  expect(packageValidationSource).toContain("'backend/_internal/elasticsearch'")
  expect(packageValidationSource).toContain("'backend/_internal/oracledb'")
  expect(launcherSource).toContain('_configure_optional_database_runtimes')
})

test('renderer production config should keep only the SQL editor worker and remove perf info logs @smoke', () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const workerSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'monaco-workers.ts'),
    'utf-8'
  )
  const viteSource = fs.readFileSync(
    path.join(projectRoot, 'electron.vite.config.ts'),
    'utf-8'
  )
  const tableSource = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'src', 'app', 'result-table-panel.tsx'),
    'utf-8'
  )

  expect(workerSource).toContain("monaco-editor/esm/vs/editor/editor.worker?worker")
  expect(workerSource).not.toContain('/language/json.worker')
  expect(workerSource).not.toContain('/language/css.worker')
  expect(workerSource).not.toContain('/language/html.worker')
  expect(workerSource).not.toContain('/language/typescript/ts.worker')
  expect(viteSource).toContain("pure: ['console.info']")
  expect(tableSource).toContain('window.requestAnimationFrame')
  expect(tableSource).toContain('window.cancelAnimationFrame(measureFrame)')
})
