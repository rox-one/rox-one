import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const repository = resolve(import.meta.dirname, '../..')

/**
 * DOM performance gate (W3.4c). Runs a single Chromium against the dev-server
 * `perf-dom.html` fixture, so timings are comparable across machines and CI.
 * One worker, no retries: a retried perf sample would hide real jitter.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  outputDir: resolve(repository, 'test-results/perf-dom'),
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5193',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'bun run scripts/playground-dev.ts --no-open',
    cwd: repository,
    env: { CRAFT_VITE_PORT: '5193', ROX_VITE_PORT: '5193' },
    url: 'http://127.0.0.1:5193/perf-dom.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})