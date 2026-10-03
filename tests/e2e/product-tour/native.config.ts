import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: '*.native.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: resolve(import.meta.dirname, '../../../test-results/product-tour/native'),
  reporter: [['list'], ['json', { outputFile: resolve(import.meta.dirname, '../../../test-results/product-tour/native.json') }]],
  projects: [{ name: process.platform === 'darwin' ? 'native-macos' : 'native-windows' }],
})
