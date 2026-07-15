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
