import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

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
  const backendSource = fs.readFileSync(path.join(projectRoot, 'backend', 'app', 'main.py'), 'utf-8')
  const moduleEntrySource = fs.readFileSync(
    path.join(projectRoot, 'backend', 'run_ai_module.py'),
    'utf-8'
  )

  expect(mainSource).toContain("type OptionalModuleId = 'mcp' | 'ai' | 'jdbc'")
  expect(mainSource).toContain("const isAiApiPath = (path: string): boolean")
  expect(mainSource).toContain('await ensureAiModuleForRequest()')
  expect(mainSource).toContain('await aiModuleManager.stop()')
  expect(mainSource).toContain('const MAX_OPTIONAL_MODULE_DOWNLOAD_ATTEMPTS = 3')
  expect(mainSource).toContain('downloadOptionalModuleArchive')
  expect(mainSource).toContain('const MAX_OPTIONAL_MODULE_REPLACE_ATTEMPTS = 8')
  expect(mainSource).toContain('replaceOptionalModuleInstall')
  expect(managerSource).toContain('DATADJINN_AI_MODULE_PORT')
  expect(managerSource).toContain('DATADJINN_DATA_DIR')
  expect(managerSource).toContain('X-DataDjinn-Api-Token')
  expect(backendSource).not.toContain('app.include_router(ai_router')
  expect(moduleEntrySource).toContain('app.include_router(ai_router, prefix="/api")')
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
