/** Renderer + persistent-journal fixture, never an installed-app/live-provider claim. */
import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const bun = process.env.ROX_TEST_BUN ?? process.execPath
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 10_000 },
  outputDir: '../../../docs/evidence/runtime-map/browser-artifacts',
  reporter: [['list'], ['json', { outputFile: resolve(repoRoot, 'docs/evidence/runtime-map/browser-results.json') }]],
  use: { baseURL: 'http://127.0.0.1:4176', viewport: { width: 1440, height: 900 },
    headless: true, video: 'on', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE } },
  webServer: [
    { command: `${quote(bun)} run tests/e2e/runtime-map/server.ts`, cwd: repoRoot, url: 'http://127.0.0.1:4177/health', timeout: 30_000,
      env: { ROX_RUNTIME_MAP_E2E: '1' }, reuseExistingServer: false },
    { command: `${quote(bun)} run tests/e2e/runtime-map/start-renderer.ts`,
      cwd: repoRoot, url: 'http://127.0.0.1:4176', timeout: 120_000, reuseExistingServer: false },
  ],
})
