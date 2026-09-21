/**
 * Documented Playwright pin for I029 / #385. Do not use @latest.
 * Install exact: bun add -d @playwright/test@1.49.1
 */
import { defineConfig } from '@playwright/test'

export const PLAYWRIGHT_VERSION_PIN = '1.49.1'

export default defineConfig({
  testDir: './',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  // Electron boot is headedness-agnostic; no browser projects.
  projects: [{ name: 'meeting-agents-electron', testMatch: '**/*.spec.ts' }],
})
