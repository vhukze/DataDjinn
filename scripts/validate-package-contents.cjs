const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const projectRoot = path.resolve(__dirname, '..')
const packagePath = path.resolve(
  projectRoot,
  process.argv[2] ?? path.join('dist', 'win-unpacked', 'resources', 'app.asar')
)

if (!fs.existsSync(packagePath)) {
  throw new Error(`安装目录中的 app.asar 不存在：${packagePath}`)
}

const entries = asar.listPackage(packagePath).map((entry) => entry.replaceAll('\\', '/'))
const resourcesDirectory = path.dirname(packagePath)
const requiredEntries = [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
  '/resources/icon.ico',
  '/package.json'
]
const forbiddenPrefixes = [
  '/.git/',
  '/.tmp/',
  '/backend/',
  '/docs/',
  '/src/',
  '/tests/',
  '/test-results/',
  '/scripts/'
]

for (const requiredEntry of requiredEntries) {
  if (!entries.includes(requiredEntry)) {
    throw new Error(`app.asar 缺少运行文件：${requiredEntry}`)
  }
}

const requiredBackendEntries = [
  'backend/datadjinn-backend.exe',
  'backend/_internal/org.jpype.jar',
  'backend/_internal/clickhouse_connect',
  'backend/_internal/oracledb',
  'backend/_internal/pymongo',
  'backend/_internal/psycopg_binary'
]
for (const requiredEntry of requiredBackendEntries) {
  if (!fs.existsSync(path.join(resourcesDirectory, requiredEntry))) {
    throw new Error(`安装目录缺少离线后端依赖：${requiredEntry}`)
  }
}

const forbiddenEntry = entries.find((entry) =>
  forbiddenPrefixes.some((prefix) => entry === prefix.slice(0, -1) || entry.startsWith(prefix))
)
if (forbiddenEntry) {
  throw new Error(`app.asar 包含不应发布的项目文件：${forbiddenEntry}`)
}

const packageSizeMb = fs.statSync(packagePath).size / 1024 / 1024
if (packageSizeMb > 100) {
  throw new Error(`app.asar 体积异常：${packageSizeMb.toFixed(2)} MB，预期不超过 100 MB`)
}

console.log(`app.asar 内容校验通过：${packageSizeMb.toFixed(2)} MB，${entries.length} 个条目`)
