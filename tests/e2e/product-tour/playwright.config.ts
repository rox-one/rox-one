import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const repository = resolve(import.meta.dirname, '../../..')
export default defineConfig({
  testDir: '.',
  testMatch: ['*.application.spec.ts', '*.ui.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: resolve(repository, 'test-results/product-tour/application'),
  reporter: [['list'], ['json', { outputFile: resolve(repository, 'test-results/product-tour/application.json') }]],
  use: {
    baseURL: 'http://127.0.0.1:5269',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] },
  },
  webServer: {
    command: 'bun scripts/product-tour/serve-application.ts',
    cwd: repository,
    url: 'http://127.0.0.1:5269',
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'real-app-isolated-native-store', testMatch: '*.application.spec.ts', timeout: 90_000 },
    { name: 'production-components', testMatch: '*.ui.spec.ts' },
  ],
})
