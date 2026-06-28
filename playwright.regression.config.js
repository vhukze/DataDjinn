const { defineConfig } = require('@playwright/test')
const path = require('node:path')

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests', 'regression'),
  timeout: 120000,
  expect: {
    timeout: 15000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
})
