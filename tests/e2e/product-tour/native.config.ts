import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: '*.native.spec.ts',
  workers: 1,
  retries: 0,
  // Native runs also execute on developer machines under heavy parallel load
  // (the suite idles at ~140 s); these budgets leave room for a 3-4× slowdown
  // instead of reporting a load spike as a test failure.
  timeout: 200_000,
  globalTimeout: 450_000,
  use: { actionTimeout: 15_000 },
  expect: { timeout: 75_000 },
  outputDir: resolve(import.meta.dirname, '../../../test-results/product-tour/native'),
  reporter: [['list'], ['json', { outputFile: resolve(import.meta.dirname, '../../../test-results/product-tour/native.json') }]],
  projects: [{ name: process.platform === 'darwin' ? 'native-macos' : 'native-windows' }],
})
