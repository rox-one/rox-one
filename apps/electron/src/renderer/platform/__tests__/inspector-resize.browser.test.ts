import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium, expect as browserExpect, type Browser, type Page } from 'playwright/test'

const repository = resolve(import.meta.dirname, '../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/inspector-resize')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? chromium.executablePath()
const endpoint = 'http://127.0.0.1:5264'
const browserMarker = `--rox-inspector-resize-fixture=20261003-root-${process.pid}`
const expectDOM = browserExpect.configure({ timeout: 60000 })
const invoke = async (page: Page, action: string, ...args: unknown[]) => {
  await page.waitForFunction(() => Boolean((window as any).__inspectorFixture))
  return page.evaluate(({ action, args }) => (window as any).__inspectorFixture[action](...args), { action, args })
}

describe.skipIf(!existsSync(executablePath))('actual InspectorHost resize lifecycle', () => {
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
        if (command.trimStart().startsWith(executablePath + ' ') && command.includes(browserMarker)) process.kill(ownedChromePid, 'SIGKILL')
      } catch {}
    }
  }
  beforeAll(async () => {
    try {
      ui = spawn('node', [resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5264'], { cwd: repository, stdio: 'ignore', detached: true })
      exited = new Promise(resolve => { ui!.once('exit', resolve); ui!.once('error', resolve) })
      const deadline = Date.now() + 55000
      for (;;) {
        if (ui.exitCode !== null) throw Error('Owned surface tabs fixture exited during startup')
        try {
          const response = await fetch(endpoint)
          if (response.ok) {
            if (!(await response.text()).includes('rox-inspector-resize-fixture')) throw Error('Different process owns inspector fixture port')
            const listener = execFileSync('lsof', ['-nP', '-iTCP:5264', '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' }).trim()
            const pids = listener.split('\n').filter(field => field.startsWith('p')).map(field => field.slice(1))
            if (!pids.length || pids.some(pid => Number(execFileSync('ps', ['-p', pid, '-o', 'pgid='], { encoding: 'utf8' }).trim()) !== ui!.pid)) throw Error('Different process owns inspector fixture port')
            break
          }
        } catch (error) { if (error instanceof Error && error.message.includes('owns inspector')) throw error }
        if (Date.now() > deadline) throw Error('Surface tabs fixture startup timeout')
        await Bun.sleep(100)
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', browserMarker] })
      // Reap only this owned temporary Chrome if its close handshake stalls.
      const pids = execFileSync('pgrep', ['-f', browserMarker.slice(2)], { encoding: 'utf8' }).trim().split(/\s+/)
      for (const pid of pids) {
        const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
        if (command.trimStart().startsWith(executablePath + ' ') && command.includes(browserMarker)) ownedChromePid = Number(pid)
      }
      if (!ownedChromePid) throw Error('Owned temporary Chrome PID could not be verified')
    } catch (error) { await stop(); throw error }
  }, 60000)
  afterAll(stop, 30000)

  const load = async () => {
    if (ui?.exitCode !== null) throw Error(`Inspector fixture vite exited (code ${ui?.exitCode ?? 'unknown'})`)
    const page = await browser!.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', error => console.error('Fixture browser error:', error.message))
    await page.goto(endpoint, { waitUntil: 'networkidle', timeout: 120000 })
    await page.waitForFunction(() => Boolean((window as any).__inspectorFixture), undefined, { timeout: 120000 })
    await page.waitForSelector('[data-session-inspector="true"]', { timeout: 120000 })
    await expectDOM(page.getByRole('separator')).toBeVisible().catch(async error => {
      console.error('Owned fixture DOM:', (await page.locator('body').innerHTML()).slice(0, 1800))
      throw error
    })
    return page
  }
  const persisted = (page: Page) => invoke(page, 'width')
  test('actual host keyboard preview is transient, Escape restores and Enter/reload persist', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'); await sash.focus()
      expect(await invoke(page, 'keyPreviewAndCancel', 'escape')).toEqual({ preview: '328', persisted: 320, cancelled: '320', saved: 320 })
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '320')
      await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Enter')
      await expectDOM(page.getByTestId('persisted-width')).toHaveText('352')
      await page.reload(); await expectDOM(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '352')
      const id = await page.getByRole('separator').getAttribute('aria-controls')
      expect(await page.locator('[data-inspector-panel]').getAttribute('id')).toBe(id)
    } finally { await page.close() }
  }, 120000)
  test('pointer cancellation restores width and body state; completion commits once', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'), box = (await sash.boundingBox())!
      await page.mouse.move(box.x + 2, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x - 40, box.y + 80)
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '362')
      expect(await persisted(page)).toBe(320)
      await sash.dispatchEvent('pointercancel'); await page.mouse.up()
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '320')
      expect(await page.evaluate(() => [document.body.style.cursor, document.body.style.userSelect])).toEqual(['', ''])
      await page.mouse.move(box.x + 2, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x - 40, box.y + 80); await page.mouse.up()
      await expectDOM(page.getByTestId('persisted-width')).toHaveText('362')
    } finally { await page.close() }
  }, 120000)
  test('keyboard bounds preserve center space and reset the current default', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'); await sash.focus()
      const max = await sash.getAttribute('aria-valuemax')
      await page.keyboard.press('End'); await page.keyboard.press('Enter'); await expectDOM(sash).toHaveAttribute('aria-valuenow', max!)
      await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await expectDOM(sash).toHaveAttribute('aria-valuenow', '280')
      await sash.dblclick(); await expectDOM(page.getByTestId('persisted-width')).toHaveText('320')
      expect(await page.getByRole('textbox').inputValue()).toBe('Unsent draft')
    } finally { await page.close() }
  }, 120000)
  test('unmount and window blur cancel pending capture and never persist preview', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'), box = (await sash.boundingBox())!
      await page.mouse.move(box.x + 2, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x - 20, box.y + 50)
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '342')
      await invoke(page, 'mount', false); await page.mouse.up(); expect(await persisted(page)).toBe(320)
      expect(await page.evaluate(() => [document.body.style.cursor, document.body.style.userSelect])).toEqual(['', ''])
      await invoke(page, 'mount', true); await expectDOM(sash).toHaveAttribute('aria-valuenow', '320')
      await sash.focus(); expect(await invoke(page, 'keyPreviewAndCancel', 'blur')).toEqual({ preview: '328', persisted: 320, cancelled: '320', saved: 320 })
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '320'); expect(await persisted(page)).toBe(320)
    } finally { await page.close() }
  }, 120000)
  test('a narrower layout cancels capture and keeps saved width for an explicit overlay', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'), box = (await sash.boundingBox())!
      await page.mouse.move(box.x + 2, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x - 20, box.y + 50)
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '342')
      await page.setViewportSize({ width: 600, height: 720 }); await page.mouse.up()
      await expectDOM(page.locator('[data-inspector-collapsed-reason="squeezed"]')).toBeVisible()
      expect(await persisted(page)).toBe(320)
      expect(await page.evaluate(() => [document.body.style.cursor, document.body.style.userSelect])).toEqual(['', ''])
      await page.locator('button[aria-pressed]').first().click()
      await expectDOM(page.locator('[data-inspector-panel="overlay"]')).toBeVisible()
      await expectDOM(page.getByRole('separator')).toHaveAttribute('aria-valuemax', '432')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      if (process.env.INSPECTOR_SCREENSHOT) await page.screenshot({ path: process.env.INSPECTOR_SCREENSHOT })
    } finally { await page.close() }
  }, 120000)

})


[You have received this identical output 4 times. Re-reading '/Users/t/Projects/rox-one/apps/electron/src/renderer/platform/__tests__/inspector-resize.browser.test.ts:raw' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]