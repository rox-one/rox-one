/**
 * I029 Playwright Electron factory. Imported only from tests/e2e.
 * Production esbuild of apps/electron/src/main/index.ts does not include this file.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MeetingElectronFactory, MeetingPageHandle } from './harness.ts'
import { PLAYWRIGHT_VERSION_PIN, repoRoot } from './harness.ts'

const require = createRequire(import.meta.url)

export function electronMainPath(root = repoRoot()): string {
  return join(root, 'apps/electron/dist/main.cjs')
}

export function isElectronAppBuilt(root = repoRoot()): boolean {
  return existsSync(electronMainPath(root))
    && existsSync(join(root, 'apps/electron/dist/renderer/index.html'))
}

export function createPlaywrightElectronFactory(): MeetingElectronFactory {
  return {
    async launch({ env }) {
      const playwright = await import('@playwright/test')
      const electronPath = require('electron') as string
      const app = await playwright._electron.launch({
        executablePath: electronPath,
        args: [join(repoRoot(), 'apps/electron')],
        env,
        timeout: 90_000,
      })
      const window = await app.firstWindow({ timeout: 90_000 })
      const page: MeetingPageHandle = {
        getByTestId(testId: string) {
          const locator = window.getByTestId(testId)
          return {
            click: () => locator.click(),
            count: () => locator.count(),
            text: () => locator.innerText(),
          }
        },
      }
      return {
        page,
        async close() {
          await app.close()
        },
      }
    },
  }
}

export function playwrightPinMatchesPackage(): boolean {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/@playwright/test/package.json')
    if (!existsSync(pkgPath)) return false
    const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version === PLAYWRIGHT_VERSION_PIN
  } catch {
    return false
  }
}
