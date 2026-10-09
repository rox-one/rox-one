import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// Windows CI needs ~68-215 s inside the first node:sqlite/NativeAuthority open before the
// first window exists (measured on both Electron 39 and 44), so the whole lane budget is
// tripled in CI while local runs keep the tight numbers.
const ciFactor = process.env.CI ? 3 : 1
export default defineConfig({
  testDir: '.',
  testMatch: '*.native.spec.ts',
  workers: 1,
  retries: 0,
  // Native runs also execute on developer machines under heavy parallel load
  // (the suite idles at ~140 s); these budgets leave room for a 3-4× slowdown
  // instead of reporting a load spike as a test failure.
  timeout: Math.max(200_000, 150_000 * ciFactor),
  globalTimeout: Math.max(450_000, 170_000 * ciFactor),
  use: { actionTimeout: Math.max(15_000, 15_000 * ciFactor) },
  expect: { timeout: Math.max(75_000, 75_000 * ciFactor) },
  outputDir: resolve(import.meta.dirname, '../../../test-results/product-tour/native'),
  reporter: [['list'], ['json', { outputFile: resolve(import.meta.dirname, '../../../test-results/product-tour/native.json') }]],
  projects: [{ name: process.platform === 'darwin' ? 'native-macos' : 'native-windows' }],
})
