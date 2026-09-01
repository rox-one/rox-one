import { defineConfig } from '@playwright/test'

const playgroundPort = 5192

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/playwright',
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${playgroundPort}`,
    // Chrome makes local reviews match the installed desktop browser. CI uses
    // Playwright's pinned Chromium instead, which is installed by the workflow.
    channel: process.env.CI ? undefined : 'chrome',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'bun run scripts/playground-dev.ts --no-open',
    env: {
      CRAFT_VITE_PORT: String(playgroundPort),
    },
    url: `http://127.0.0.1:${playgroundPort}/playground.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-light',
      use: {
        colorScheme: 'light',
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'desktop-dark',
      use: {
        colorScheme: 'dark',
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'tablet-light',
      use: {
        colorScheme: 'light',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'tablet-dark',
      use: {
        colorScheme: 'dark',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'mobile-light',
      use: {
        colorScheme: 'light',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-dark',
      use: {
        colorScheme: 'dark',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
