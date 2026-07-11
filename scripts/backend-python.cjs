const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const rootDir = resolve(__dirname, '..')
const backendDir = join(rootDir, 'backend')

const candidates = [
  join(backendDir, '.venv', 'Scripts', 'python.exe'),
  join(backendDir, '.venv', 'bin', 'python'),
  process.env.PYTHON || '',
  process.platform === 'win32' ? 'python.exe' : 'python3',
  'python'
].filter(Boolean)

const command =
  candidates.find((candidate) => {
    if (candidate.includes('\\') || candidate.includes('/')) {
      return existsSync(candidate)
    }
    return true
  }) ?? candidates[0]

if (!command) {
  console.error('No Python executable available for backend build.')
  process.exit(1)
}

const result = spawnSync(command, process.argv.slice(2), {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
