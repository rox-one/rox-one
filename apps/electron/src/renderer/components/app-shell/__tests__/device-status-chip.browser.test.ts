import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser } from 'playwright/test'

const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/device-diagnostics')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? chromium.executablePath()
const endpoint = 'http://127.0.0.1:5227'
const expectDOM = playwrightExpect.configure({ timeout: 10000 })

describe.skipIf(!existsSync(executablePath))('real diagnostic chip lifecycle with a native bridge fixture', () => {
  let ui: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  const stop = async () => { ui?.kill(); await browser?.close(); await ui?.exited }
  beforeAll(async () => {
    try {
      ui = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5227'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + 30000
      for (;;) {
        if (ui.exitCode !== null) throw new Error('Owned diagnostics fixture exited during startup')
        try {
          const response = await fetch(endpoint)
          if (response.ok) {
            if (!(await response.text()).includes('rox-device-diagnostics-fixture')) throw new Error('Different process owns diagnostics fixture port')
            break
          }
        } catch (error) { if (error instanceof Error && error.message.includes('owns diagnostics')) throw error }
        if (Date.now() > deadline) throw new Error('Diagnostics fixture startup timeout')
        await Bun.sleep(100)
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
    } catch (error) { await stop(); throw error }
  }, 45000)
  afterAll(stop, 30000)

  it('does no closed diagnostic reads, loads on opening, switches tabs and stops after closing', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    const errors: string[] = []
    const requestedModules: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => requestedModules.push(request.url()))
    const reads = () => page.evaluate(() => (window as any).__diagnosticsFixture.reads as Array<{ kind: string }>)
    try {
      await page.goto(endpoint)
      const chip = page.getByTestId('device-status-chip')
      await expectDOM(chip).toBeVisible()
      expect(await reads()).toHaveLength(0)
      expect(requestedModules.some(url => url.includes('/diagnostics/LazyDiagnostics'))).toBe(false)
      await chip.click()
      await expectDOM(page.getByTestId('device-diagnostics')).toBeVisible()
      await expectDOM(page.getByRole('tabpanel')).toContainText('did not permit')
      expect((await reads()).map(value => value.kind)).toEqual(['overview'])
      expect(requestedModules.some(url => url.includes('/diagnostics/LazyDiagnostics'))).toBe(true)
      await page.getByRole('tab', { name: 'Network', exact: true }).click()
      await expectDOM(page.getByRole('tabpanel')).toContainText('did not permit')
      await expectDOM(page.getByRole('tab', { name: 'Network', exact: true })).toHaveAttribute('aria-selected', 'true')
      expect((await reads()).at(-1)?.kind).toBe('network')
      await page.keyboard.press('Escape')
      await expectDOM(page.getByTestId('device-diagnostics')).toHaveCount(0)
      const closedCount = (await reads()).length
      await page.waitForTimeout(5200)
      expect(await reads()).toHaveLength(closedCount)
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 45000)
})
