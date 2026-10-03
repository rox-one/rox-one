import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import ru from '../../../../../../packages/shared/src/i18n/locales/ru.json'

const repository = resolve(import.meta.dirname, '../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/session-menu-sharing')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const url = 'http://127.0.0.1:5318'
const proofDirectory = process.env.SHARING_BUSY_PROOF_DIR
const timeout = 30000

describe.skipIf(!existsSync(executablePath))('production session sharing hook busy errors in Russian Chromium', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let page: Page
  const errors: string[] = []
  const stop = async () => { const owned = server; server = undefined; owned?.kill(); try { await browser?.close() } finally { await owned?.exited } }
  beforeAll(async () => {
    try {
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5318'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + timeout
      for (;;) {
        if (server.exitCode !== null) throw new Error('Owned session sharing fixture exited')
        try { if ((await fetch(url)).ok) break } catch {}
        if (Date.now() > deadline) throw new Error('Session sharing fixture startup timeout')
        await Bun.sleep(100)
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) { await stop(); throw error }
  }, 60000)
  beforeEach(async () => {
    errors.length = 0; page = await browser.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url); await expectDOM(page.getByTestId('ready')).toBeVisible({ timeout })
  }, timeout)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, timeout)
  afterAll(stop, timeout)

  for (const [action, command, title] of [
    ['update', 'updateShare', ru['chat.failedToUpdateShare']],
    ['revoke', 'revokeShare', ru['chat.failedToStopSharing']],
    ['share', 'shareToViewer', ru['toast.failedToShare']],
  ]) {
    it(`translates concurrent ${action} SHARE_BUSY while another hook action remains pending`, async () => {
      await page.getByRole('button', { name: 'Hold first update', exact: true }).click()
      await page.getByRole('button', { name: `Concurrent ${action}`, exact: true }).click()
      const toast = page.locator('[data-sonner-toast][data-type="error"]')
      await expectDOM(toast).toContainText(title!)
      await expectDOM(toast).toContainText(ru['sessionSharing.error.busy'])
      await expectDOM(page.getByText('Share operation already in progress', { exact: true })).toHaveCount(0)
      const calls = await page.evaluate(() => (window as any).__sharingFixture.calls)
      expect(calls).toEqual([{ sessionId: 'synthetic-session', type: 'updateShare' }, { sessionId: 'synthetic-session', type: command }])
      if (proofDirectory) {
        await page.screenshot({ path: resolve(proofDirectory, `russian-busy-${action}.png`) })
        writeFileSync(resolve(proofDirectory, `russian-busy-${action}.json`), JSON.stringify({ action, text: await toast.innerText(), calls, pageErrors: errors }, null, 2))
      }
      await page.evaluate(() => (window as any).__sharingFixture.release())
      await expectDOM(page.locator('[data-sonner-toast][data-type="success"]')).toContainText(ru['chat.shareUpdated'])
    }, timeout)
  }
})
