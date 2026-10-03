import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium, expect as browserExpect, type Browser, type Page } from 'playwright/test'

const repository = resolve(import.meta.dirname, '../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/surface-tabs')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? chromium.executablePath()
const endpoint = 'http://127.0.0.1:5263'
const expectDOM = browserExpect.configure({ timeout: 30000 })
const invoke = async (page: Page, action: string, ...args: unknown[]) => {
  await page.waitForFunction(() => Boolean((window as any).__tabsFixture))
  return page.evaluate(({ action, args }) => (window as any).__tabsFixture[action](...args), { action, args })
}

describe.skipIf(!existsSync(executablePath))('actual SurfaceTabs keyboard and title lifecycle', () => {
  let ui: ChildProcess | undefined, exited: Promise<unknown> | undefined, browser: Browser | undefined, ownedChromePid: number | undefined
  const stop = async () => {
    if (ui?.pid && ui.exitCode === null) {
      try { process.kill(-ui.pid, 'SIGTERM') } catch {}
      await Promise.race([exited, Bun.sleep(2000)])
      if (ui.exitCode === null) { try { process.kill(-ui.pid, 'SIGKILL') } catch {} }
      await Promise.race([exited, Bun.sleep(2000)])
    }
    await Promise.race([browser?.close(), Bun.sleep(5000)])
    if (ownedChromePid) {
      try { process.kill(ownedChromePid, 'SIGTERM') } catch {}
      await Bun.sleep(500)
      try {
        const command = execFileSync('ps', ['-p', String(ownedChromePid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        if (command.trimStart().startsWith(executablePath + ' ') && command.includes('--rox-surface-tabs-fixture=20261003-root')) process.kill(ownedChromePid, 'SIGKILL')
      } catch {}
    }
  }
  beforeAll(async () => {
    try {
      ui = spawn('node', [resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5263'], { cwd: repository, stdio: 'ignore', detached: true })
      exited = new Promise(resolve => { ui!.once('exit', resolve); ui!.once('error', resolve) })
      const deadline = Date.now() + 55000
      for (;;) {
        if (ui.exitCode !== null) throw Error('Owned surface tabs fixture exited during startup')
        try {
          const response = await fetch(endpoint)
          if (response.ok) {
            if (!(await response.text()).includes('rox-surface-tabs-fixture')) throw Error('Different process owns surface tab fixture port')
            break
          }
        } catch (error) { if (error instanceof Error && error.message.includes('owns surface')) throw error }
        if (Date.now() > deadline) throw Error('Surface tabs fixture startup timeout')
        await Bun.sleep(100)
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--rox-surface-tabs-fixture=20261003-root'] })
      // Reap only this owned temporary Chrome if its close handshake stalls.
      const pids = execFileSync('pgrep', ['-f', 'rox-surface-tabs-fixture=20261003-root'], { encoding: 'utf8' }).trim().split(/\s+/)
      for (const pid of pids) {
        const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
        if (command.trimStart().startsWith(executablePath + ' ') && command.includes('--rox-surface-tabs-fixture=20261003-root')) ownedChromePid = Number(pid)
      }
      if (!ownedChromePid) throw Error('Owned temporary Chrome PID could not be verified')
    } catch (error) { await stop(); throw error }
  }, 60000)
  afterAll(stop, 30000)

  test('arrows, Home/End, wrapping and Delete preserve the actual focused tab', async () => {
    const page = await browser!.newPage()
    try {
      await page.goto(endpoint)
      const first = page.locator('[data-surface-tab="one"]'), second = page.locator('[data-surface-tab="two"]'), third = page.locator('[data-surface-tab="three"]')
      await expectDOM(first).toHaveAttribute('tabindex', '0')
      await expectDOM(second).toHaveAttribute('tabindex', '-1')
      await first.focus(); await page.keyboard.press('ArrowRight'); await expectDOM(second).toBeFocused()
      await expectDOM(second).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('End'); await expectDOM(third).toBeFocused()
      await page.keyboard.press('ArrowRight'); await expectDOM(first).toBeFocused()
      await page.keyboard.press('ArrowLeft'); await expectDOM(third).toBeFocused()
      await page.keyboard.press('Home'); await expectDOM(first).toBeFocused()
      await page.keyboard.press('Delete'); await expectDOM(first).toHaveCount(0); await expectDOM(second).toBeFocused()
    } finally { await page.close() }
  }, 120000)
  test('hidden browser focus leaves a visible tab stop; closing a background tab preserves browser activation', async () => {
    const page = await browser!.newPage()
    try {
      await page.goto(endpoint); await invoke(page, 'hiddenBrowser')
      const first = page.locator('[data-surface-tab="one"]')
      await expectDOM(first).toHaveAttribute('tabindex', '0'); await expectDOM(page.getByRole('tab')).toHaveCount(3)
      await first.focus(); await page.keyboard.press('Delete')
      await expectDOM(page.locator('[data-surface-tab="two"]')).toBeFocused()
      await expectDOM(page.getByTestId('focused')).toHaveText('browser')
    } finally { await page.close() }
  }, 120000)
  test('middle-click from an editor retains its DOM focus and draft, including a portalled strip', async () => {
    const page = await browser!.newPage()
    try {
      await page.goto(endpoint); await invoke(page, 'portal', true)
      await expectDOM(page.locator('#topbar [role="tablist"]')).toBeVisible()
      const editor = page.getByRole('textbox', { name: 'Editor' }); await editor.fill('Continued typing'); await editor.focus()
      await page.locator('[data-surface-tab-item="two"]').evaluate(element => element.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true })))
      await expectDOM(page.locator('[data-surface-tab="two"]')).toHaveCount(0)
      await expectDOM(editor).toBeFocused(); await expectDOM(editor).toHaveValue('Continued typing')
    } finally { await page.close() }
  }, 120000)
  test('failed title read retries on navigation and renders its successful current title', async () => {
    const page = await browser!.newPage()
    try {
      await page.goto(endpoint + '?mode=fail')
      await expectDOM(page.getByRole('tab').nth(2)).toBeVisible()
      await expectDOM.poll(() => page.evaluate(() => (window as any).__tabsFixture.reads.length)).toBe(1)
      await invoke(page, 'refresh')
      await expectDOM(page.getByRole('tab').nth(2)).toHaveText('Resolved note')
      expect(await page.evaluate(() => (window as any).__tabsFixture.reads.length)).toBe(2)
    } finally { await page.close() }
  }, 120000)
  test('tab-stack replacement shares pending read and receives a title after old render cleanup', async () => {
    const page = await browser!.newPage()
    try {
      await page.goto(endpoint + '?mode=pending')
      await expectDOM.poll(() => page.evaluate(() => (window as any).__tabsFixture.reads.length)).toBe(1)
      await invoke(page, 'refresh'); await invoke(page, 'resolve', 0, 'Late current title')
      await expectDOM(page.getByRole('tab').nth(2)).toHaveText('Late current title')
      expect(await page.evaluate(() => (window as any).__tabsFixture.reads.length)).toBe(1)
    } finally { await page.close() }
  }, 120000)
  test('old workspace title cannot replace current workspace; compact mobile retains keyboard controls', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(endpoint + '?mode=pending')
      await expectDOM.poll(() => page.evaluate(() => (window as any).__tabsFixture.reads.length)).toBe(1)
      await invoke(page, 'workspace', 'b')
      await expectDOM.poll(() => page.evaluate(() => (window as any).__tabsFixture.reads.length)).toBe(2)
      await invoke(page, 'resolve', 1, 'Current workspace title')
      await expectDOM(page.getByRole('tab').nth(2)).toHaveText('Current workspace title')
      await invoke(page, 'resolve', 0, 'Obsolete foreign title')
      await expectDOM(page.getByRole('tab').nth(2)).toHaveText('Current workspace title')
      const first = page.locator('[data-surface-tab="one"]'); await first.focus(); await page.keyboard.press('ArrowRight')
      await expectDOM(page.locator('[data-surface-tab="two"]')).toBeFocused()
      if (process.env.ROX_SURFACE_TAB_SCREENSHOTS) {
        mkdirSync(process.env.ROX_SURFACE_TAB_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: resolve(process.env.ROX_SURFACE_TAB_SCREENSHOTS, 'surface-tabs-mobile.png') })
      }
      expect(errors).toEqual([])
    } finally { await page.close() }
  }, 120000)
})
