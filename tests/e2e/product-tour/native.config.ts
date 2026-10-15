import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// Windows CI needs ~68-215 s inside the first node:sqlite/NativeAuthority open before the
// first window exists (measured on both Electron 39 and 44), so the whole lane budget is
// tripled in CI while local runs keep the tight numbers.
const ciFactor = process.env.CI ? 3 : 1

/**
 * THE native-lane budgets — one source of truth for both the inner Playwright
 * deadlines below and the outer process deadline `run-native.ts` enforces
 * (`NATIVE_PROCESS_DEADLINE_MS`), so the two can never drift apart by being
 * re-typed.
 *
 * Native runs also execute on developer machines under heavy parallel load
 * (the suite idles at ~140 s); these budgets leave room for a 3-4× slowdown
 * instead of reporting a load spike as a test failure.
 */
export const NATIVE_BUDGETS = {
  /** Per-test budget. */
  perTestMs: Math.max(200_000, 150_000 * ciFactor),
  /** Budget for the whole run; the inner deadline the parent must outlive. */
  globalTimeoutMs: Math.max(450_000, 170_000 * ciFactor),
  actionMs: Math.max(15_000, 15_000 * ciFactor),
  expectMs: Math.max(75_000, 75_000 * ciFactor),
}

/**
 * Slack the Playwright CLI needs *after* `globalTimeoutMs` aborts a run:
 * reporters flush, `native.json` and the per-test attachments are written and
 * Electron is torn down (native-harness bounds its own shutdown at 20 s).
 */
export const NATIVE_REPORT_HEADROOM_MS = 180_000

/**
 * Outer deadline for the whole CLI process, enforced by
 * `scripts/product-tour/run-native.ts` through `runNativeProcess`. It MUST stay
 * strictly greater than the inner `globalTimeoutMs` (it is derived from it
 * here), otherwise the parent SIGKILLs the CLI mid-run and the lane reports an
 * opaque `timedOut` instead of the failure summary the reporters were about to
 * write.
 */
export const NATIVE_PROCESS_DEADLINE_MS = NATIVE_BUDGETS.globalTimeoutMs + NATIVE_REPORT_HEADROOM_MS

export default defineConfig({
  testDir: '.',
  testMatch: '*.native.spec.ts',
  workers: 1,
  retries: 0,
  timeout: NATIVE_BUDGETS.perTestMs,
  globalTimeout: NATIVE_BUDGETS.globalTimeoutMs,
  use: { actionTimeout: NATIVE_BUDGETS.actionMs },
  expect: { timeout: NATIVE_BUDGETS.expectMs },
  outputDir: resolve(import.meta.dirname, '../../../test-results/product-tour/native'),
  reporter: [['list'], ['json', { outputFile: resolve(import.meta.dirname, '../../../test-results/product-tour/native.json') }]],
  projects: [{ name: process.platform === 'darwin' ? 'native-macos' : 'native-windows' }],
})
