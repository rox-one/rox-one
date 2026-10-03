import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const backendRoot = join(tmpdir(), 'opencode', `qa-skills-browser-${process.pid}`)
const cwd = fileURLToPath(new URL('../../../', import.meta.url))
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1, fullyParallel: false, timeout: 60_000,
  expect: { timeout: 20_000 },
  outputDir: join(tmpdir(), 'opencode', 'qa-observations-playwright'),
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:5188', viewport: { width: 1386, height: 893 }, screenshot: 'only-on-failure' },
  webServer: [
    { command: 'bun tests/e2e/qa-observations/backend-server.ts', cwd,
      env: { HOME: join(backendRoot, 'home'), USERPROFILE: join(backendRoot, 'home'),
        ROX_CONFIG_DIR: join(backendRoot, 'config'), CRAFT_CONFIG_DIR: join(backendRoot, 'config') },
      url: 'http://127.0.0.1:5189/health', reuseExistingServer: false, timeout: 120_000 },
    { command: 'bun node_modules/vite/bin/vite.js --config tests/e2e/qa-observations/vite.config.ts',
      cwd, url: 'http://127.0.0.1:5188', reuseExistingServer: false, timeout: 120_000 },
  ],
})
