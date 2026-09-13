/**
 * Documented Playwright pin for I029. Do not use latest.
 * `@playwright/test` is not in this workspace lockfile; bun tests in
 * harness.test.ts boot Electron via the real binary + CDP instead of
 * `_electron.launch`. Installing Playwright is a separate lockfile change.
 */
export const PLAYWRIGHT_VERSION_PIN = '1.49.1'
export default {
  testDir: './',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
}
