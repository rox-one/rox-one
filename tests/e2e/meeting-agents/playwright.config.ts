import { defineConfig } from '@playwright/test'
import { PLAYWRIGHT_VERSION_PIN } from './harness.ts'

export { PLAYWRIGHT_VERSION_PIN }

/** Documented Playwright pin for I029. Do not use latest. */
export default defineConfig({
  testDir: './',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'off',
  },
})
