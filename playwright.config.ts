import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['./scripts/playwright-reporter.mjs']]
    : './scripts/playwright-reporter.mjs',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
