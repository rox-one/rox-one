import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../test-utils/chromium-executable'

const repository = resolve(import.meta.dirname, '../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/startup-optional-effects')
const executablePath = await resolveChromiumExecutable()
const url = 'http://127.0.0.1:5323'
const proofDirectory = process.env.STARTUP_OPTIONAL_EFFECTS_PROOF_DIR
type Fixture = {
  calls: string[]
  resolveDebug(index: number, value: boolean): void
  resolveTheme(index: number, value: boolean): void
  notifyTheme(value: boolean): void
  notifyCapturedTheme(index: number, value: boolean): void
  themeCleanups(): number
  toggleMenus(): void
  toggleTheme(): void
}

describe.skipIf(!existsSync(executablePath))('production optional menu and theme startup effects in Chromium', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5323'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30000
    for (;;) {
      if (server.exitCode !== null) throw new Error('Owned startup effects fixture exited')
      try { if ((await fetch(url)).ok) break } catch {}
      if (Date.now() > deadline) throw new Error('Startup effects fixture startup timeout')
      await Bun.sleep(100)
    }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
    if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
  }, 40000)
  beforeEach(async () => {
    errors.length = 0
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
    page.on('pageerror', error => errors.push(error.message))
  })
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } })
  afterAll(async () => { server?.kill(); await browser?.close(); await server?.exited })
  const open = async (mode: string) => { await page.goto(`${url}/?mode=${mode}`); await expectDOM(page.getByTestId('ready')).toBeVisible() }
  const count = (method: string) => page.evaluate(method => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.calls.filter(call => call === method).length, method)
  const mobileSheet = () => page.getByTestId('mobile-sheet-root').locator(':scope > div')

  it('both real menus tolerate a denied RPC object and keep debug hidden while theme uses the browser preference', async () => {
    await open('deny')
    await expectDOM.poll(() => count('isDebugMode')).toBe(2)
    await expectDOM.poll(() => count('getSystemTheme')).toBe(1)
    await expectDOM(page.getByTestId('theme-state')).toHaveText('light/light')
    await page.getByTestId('desktop-menu').getByRole('button', { name: 'Rox menu', exact: true }).click()
    await expectDOM(page.getByRole('menu')).toBeVisible()
    await expectDOM(page.getByRole('menuitem', { name: 'Debug', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByTestId('mobile-menu').getByRole('button', { name: 'Rox menu', exact: true }).click()
    await expectDOM(mobileSheet()).toBeVisible()
    await expectDOM(mobileSheet().getByRole('button', { name: 'Debug', exact: true })).toHaveCount(0)
    await mobileSheet().getByRole('button', { name: 'Close', exact: true }).click()
    await expectDOM(mobileSheet()).toHaveCount(0)
    if (proofDirectory) writeFileSync(resolve(proofDirectory, 'denied-startup.json'), JSON.stringify({ calls: await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.calls), pageErrors: errors }, null, 2))
  }, 20000)

  it('a newer Electron theme event wins over the held initial response', async () => {
    await open('desktop-hold'); await expectDOM.poll(() => count('getSystemTheme')).toBe(1)
    await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.notifyTheme(true))
    await expectDOM(page.getByTestId('theme-state')).toHaveText('dark/dark')
    await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.resolveTheme(0, false))
    await page.waitForTimeout(80)
    await expectDOM(page.getByTestId('theme-state')).toHaveText('dark/dark')
    expect(await page.locator('html').getAttribute('class')).toContain('dark')
  }, 15000)

  it('a newer real matchMedia change wins over the held Electron startup response', async () => {
    await open('desktop-hold'); await expectDOM.poll(() => count('getSystemTheme')).toBe(1)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectDOM(page.getByTestId('theme-state')).toHaveText('dark/dark')
    await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.resolveTheme(0, false))
    await page.waitForTimeout(80)
    await expectDOM(page.getByTestId('theme-state')).toHaveText('dark/dark')
  }, 15000)

  it('theme unmount removes the subscription and fences both its old reply and captured listener after remount', async () => {
    await open('desktop-hold'); await expectDOM.poll(() => count('getSystemTheme')).toBe(1)
    await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.toggleTheme())
    await expectDOM(page.getByTestId('theme-state')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.themeCleanups())).toBe(1)
    await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.toggleTheme())
    await expectDOM.poll(() => count('getSystemTheme')).toBe(2)
    await page.evaluate(() => {
      const fixture = (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture
      fixture.resolveTheme(1, false); fixture.resolveTheme(0, true); fixture.notifyCapturedTheme(0, true)
    })
    await page.waitForTimeout(80)
    await expectDOM(page.getByTestId('theme-state')).toHaveText('light/light')
    expect(await page.locator('html').getAttribute('class')).toContain('light')
  }, 15000)

  for (const shape of ['desktop', 'mobile'] as const) {
    it(`${shape} menu renders its real debug row after an authorized positive result`, async () => {
      await open(`${shape}-hold`); await expectDOM.poll(() => count('isDebugMode')).toBe(1)
      await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.resolveDebug(0, true))
      await page.getByTestId(`${shape}-menu`).getByRole('button', { name: 'Rox menu', exact: true }).click()
      await expectDOM(shape === 'desktop' ? page.getByRole('menuitem', { name: 'Debug', exact: true }) : mobileSheet().getByRole('button', { name: 'Debug', exact: true })).toBeVisible()
    }, 15000)

    it(`${shape} menu stays closed after unmount and its stale debug result cannot enable the remounted menu`, async () => {
      await open(`${shape}-hold`); await expectDOM.poll(() => count('isDebugMode')).toBe(1)
      await page.getByTestId(`${shape}-menu`).getByRole('button', { name: 'Rox menu', exact: true }).click()
      await expectDOM(shape === 'desktop' ? page.getByRole('menu') : mobileSheet()).toBeVisible()
      await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.toggleMenus())
      await expectDOM(shape === 'desktop' ? page.getByRole('menu') : mobileSheet()).toHaveCount(0)
      await page.evaluate(() => {
        const fixture = (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture
        fixture.resolveDebug(0, true); fixture.toggleMenus()
      })
      await expectDOM.poll(() => count('isDebugMode')).toBe(2)
      await page.evaluate(() => (window as unknown as { __startupEffectsFixture: Fixture }).__startupEffectsFixture.resolveDebug(1, false))
      await expectDOM(shape === 'desktop' ? page.getByRole('menu') : mobileSheet()).toHaveCount(0)
      await page.getByTestId(`${shape}-menu`).getByRole('button', { name: 'Rox menu', exact: true }).click()
      await expectDOM(shape === 'desktop' ? page.getByRole('menuitem', { name: 'Debug', exact: true }) : mobileSheet().getByRole('button', { name: 'Debug', exact: true })).toHaveCount(0)
      await page.waitForTimeout(80)
    }, 20000)
  }
})
