/**
 * Documented Playwright pin for I029 / #385. Do not use @latest.
 * Install exact: bun add -d @playwright/test@1.49.1
 *
 * Gate G1: product E3 is not the default. This suite opts into fixture U1 via
 * ROX_MEETING_E2E_FIXTURE=1 (set by `bun run test:meetings:e2e`). Without that
 * (or ROX_MEETING_USE_PACKAGED_APP=1) exit blocked — never green-skip, never
 * pretend fixture is product Electron→RPC→storage.
 */
import { defineConfig } from '@playwright/test'

export const PLAYWRIGHT_VERSION_PIN = '1.49.1'

const wantProduct = process.env.ROX_MEETING_USE_PACKAGED_APP === '1'
const wantFixture = process.env.ROX_MEETING_E2E_FIXTURE === '1'
if (!wantProduct && !wantFixture) {
  console.error(
    JSON.stringify({
      caseId: 'E29',
      result: 'blocked',
      level: 'E3',
      blocker:
        'no product Electron→RPC→storage path; set ROX_MEETING_E2E_FIXTURE=1 for U1 fixture (never E3) or ROX_MEETING_USE_PACKAGED_APP=1 for product',
    }),
  )
  process.exit(1)
}

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
