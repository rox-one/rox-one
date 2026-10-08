import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

/**
 * Resolve a Chromium executable for the renderer browser suites.
 *
 * Resolution order:
 * 1. `LEARNING_CHROMIUM_PATH`
 * 2. `CHROMIUM_EXECUTABLE`
 * 3. `ROX_BROWSER_PATH`
 * 4. `/usr/bin/chromium` when it exists on disk
 * 5. Playwright's bundled Chromium when that file exists
 *
 * Throws a descriptive error when no usable executable is available instead of
 * silently handing Playwright a path that cannot launch.
 */
export async function resolveChromiumExecutable(): Promise<string> {
  for (const configured of [process.env.LEARNING_CHROMIUM_PATH, process.env.CHROMIUM_EXECUTABLE, process.env.ROX_BROWSER_PATH]) {
    if (configured) return configured
  }
  if (existsSync('/usr/bin/chromium')) return '/usr/bin/chromium'
  let bundled = ''
  try { bundled = chromium.executablePath() } catch { /* unsupported platform or missing registry entry */ }
  if (bundled && existsSync(bundled)) return bundled
  throw new Error(
    'No Chromium executable found for browser tests. Set LEARNING_CHROMIUM_PATH, CHROMIUM_EXECUTABLE or '
    + 'ROX_BROWSER_PATH, install Chromium at /usr/bin/chromium, or run "bunx playwright install chromium" '
    + `(Playwright expected "${bundled}").`,
  )
}