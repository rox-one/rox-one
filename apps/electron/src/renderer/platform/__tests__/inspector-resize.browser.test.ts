import { beforeAll, afterAll, describe, test, expect, setDefaultTimeout } from 'bun:test'
import { existsSync } from 'node:fs'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, expect as browserExpect, type Browser, type Page } from 'playwright/test'

setDefaultTimeout(300_000)

const repository = resolve(import.meta.dirname, '../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/inspector-resize')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? chromium.executablePath()
const externalFixtureUrl = process.env.INSPECTOR_RESIZE_FIXTURE_URL?.replace(/\/$/, '')

async function reserveLocalPort(): Promise<number> {
  const configured = Number(process.env.INSPECTOR_RESIZE_FIXTURE_PORT)
  if (configured > 0) return configured
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve inspector fixture port')))
        return
      }
      const port = address.port
      server.close(error => (error ? reject(error) : resolvePort(port)))
    })
  })
}

let fixturePort = 0
let endpoint = ''
const browserMarker = `--rox-inspector-resize-fixture=20261003-root-${process.pid}`
const fixturePanelWidthStorageKey = 'craft-inspector-panel-width'
const playwrightActionTimeoutMs = 300_000
const expectDOM = browserExpect.configure({ timeout: 60_000 })

async function warmInspectorFixtureBundle(baseUrl: string): Promise<void> {
  const deadline = Date.now() + playwrightActionTimeoutMs
  let lastError = 'unknown'
  for (;;) {
    try {
      const entry = await fetch(`${baseUrl}/main.tsx`)
      const body = await entry.text()
      if (entry.ok && body.length > 500 && !body.includes('Pre-transform error') && !body.includes('Internal server error')) {
        return
      }
      lastError = `main.tsx status=${entry.status} bytes=${body.length}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() > deadline) throw Error(`Inspector resize fixture bundle warmup failed: ${lastError}`)
    await Bun.sleep(500)
  }
}
const resetFixturePanelWidth = async (page: Page) => {
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify(320))
  }, fixturePanelWidthStorageKey)
}
const invoke = async (page: Page, action: string, ...args: unknown[]) => {
  await page.waitForFunction(() => Boolean((window as any).__inspectorFixture))
  return page.evaluate(({ action, args }) => (window as any).__inspectorFixture[action](...args), { action, args })
}

describe.skipIf(!existsSync(executablePath))('actual InspectorHost resize lifecycle', () => {
  let ui: ChildProcess | undefined, exited: Promise<unknown> | undefined, browser: Browser | undefined, ownedChromePid: number | undefined
  let sharedPage: Page | undefined
  let fixtureReady = false
  let setupError: string | undefined
  const navigateFixture = async (page: Page) => {
    if (!endpoint) {
      throw Error(`Inspector resize fixture never finished setup${setupError ? `: ${setupError}` : ''}`)
    }
    if (ui && ui.exitCode !== null) {
      throw Error(
        `Inspector fixture vite exited (code ${ui.exitCode}) on port ${fixturePort}. `
        + 'Do not run two inspector-resize suites in parallel; use INSPECTOR_RESIZE_FIXTURE_URL for a shared server.',
      )
    }
    await page.goto(endpoint, { waitUntil: 'commit', timeout: playwrightActionTimeoutMs })
    await page.waitForSelector('[data-inspector-fixture-ready="true"]', { state: 'attached', timeout: playwrightActionTimeoutMs })
    // Ready marker is set before InspectorHost mounts; fixture API appears after a successful render.
    await page.waitForFunction(() => Boolean((window as any).__inspectorFixture), undefined, { timeout: playwrightActionTimeoutMs })
    await expectDOM(page.getByRole('separator')).toBeVisible().catch(async error => {
      console.error('Owned fixture DOM:', (await page.locator('body').innerHTML()).slice(0, 1800))
      throw error
    })
  }
  const stop = async () => {
    await sharedPage?.close().catch(() => {})
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
      if (externalFixtureUrl) {
        endpoint = externalFixtureUrl
        const response = await fetch(endpoint)
        if (!response.ok || !(await response.text()).includes('rox-inspector-resize-fixture')) {
          throw Error(`INSPECTOR_RESIZE_FIXTURE_URL is not serving the inspector fixture (${endpoint})`)
        }
        await warmInspectorFixtureBundle(endpoint)
      } else {
        fixturePort = await reserveLocalPort()
        endpoint = `http://127.0.0.1:${fixturePort}`
        const viteCache = resolve(tmpdir(), `rox-inspector-resize-cache-${process.pid}`)
        ui = spawn(
          'node',
          [resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', String(fixturePort), '--strictPort'],
          {
            cwd: repository,
            stdio: 'ignore',
            detached: true,
            env: { ...process.env, INSPECTOR_RESIZE_VITE_CACHE: viteCache },
          },
        )
        exited = new Promise(resolve => { ui!.once('exit', resolve); ui!.once('error', resolve) })
        const deadline = Date.now() + playwrightActionTimeoutMs
        for (;;) {
          if (ui.exitCode !== null) throw Error(`Inspector resize fixture vite exited during startup (code ${ui.exitCode})`)
          try {
            const response = await fetch(endpoint)
            if (response.ok && (await response.text()).includes('rox-inspector-resize-fixture')) {
              await warmInspectorFixtureBundle(endpoint)
              break
            }
          } catch (error) {
            if (Date.now() > deadline) {
              throw Error(
                `Inspector resize fixture startup timeout: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
          if (Date.now() > deadline) throw Error('Inspector resize fixture startup timeout (waited for HTML + warmed main.tsx)')
          await Bun.sleep(250)
        }
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', browserMarker] })
      try {
        const pids = execFileSync('pgrep', ['-f', browserMarker.slice(2)], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean)
        for (const pid of pids) {
          const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
          if (command.includes(browserMarker)) {
            ownedChromePid = Number(pid)
            break
          }
        }
      } catch { /* browser.close() is enough */ }
      sharedPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      sharedPage.setDefaultTimeout(playwrightActionTimeoutMs)
      sharedPage.setDefaultNavigationTimeout(playwrightActionTimeoutMs)
      sharedPage.on('pageerror', error => console.error('Fixture browser error:', error.message))
      sharedPage.on('console', message => {
        if (message.type() === 'error') console.error('Fixture console error:', message.text())
      })
      await navigateFixture(sharedPage)
      fixtureReady = true
    } catch (error) {
      setupError = error instanceof Error ? error.message : String(error)
      await stop()
      throw error
    }
  }, 600_000)
  afterAll(stop, 120000)

  const load = async () => {
    if (!sharedPage) throw Error(`Inspector resize fixture never finished setup${setupError ? `: ${setupError}` : ''}`)
    await resetFixturePanelWidth(sharedPage)
    await navigateFixture(sharedPage)
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    return sharedPage
  }
  const persisted = (page: Page) => invoke(page, 'width')
  test.serial('actual host keyboard preview is transient, Escape restores and Enter/reload persist', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'); await sash.focus()
      expect(await invoke(page, 'keyPreviewAndCancel', 'escape')).toEqual({ preview: '328', persisted: 320, cancelled: '320', saved: 320 })
      await expectDOM(sash).toHaveAttribute('aria-valuenow', '320')
      await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Enter')
      await expectDOM(page.getByTestId('persisted-width')).toHaveText('352')
      await page.reload({ waitUntil: 'commit' })
      await page.waitForSelector('[data-inspector-fixture-ready="true"]', { state: 'attached', timeout: playwrightActionTimeoutMs })
      await expectDOM(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '352')
      const id = await page.getByRole('separator').getAttribute('aria-controls')
      expect(await page.locator('[data-inspector-panel]').getAttribute('id')).toBe(id)
    } finally { /* keep shared page open */ }
  })
  test.serial('pointer cancellation restores width and body state; completion commits once', async () => {
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
    } finally { /* keep shared page open */ }
  })
  test.serial('keyboard bounds preserve center space and reset the current default', async () => {
    const page = await load()
    try {
      const sash = page.getByRole('separator'); await sash.focus()
      const max = await sash.getAttribute('aria-valuemax')
      await page.keyboard.press('End'); await page.keyboard.press('Enter'); await expectDOM(sash).toHaveAttribute('aria-valuenow', max!)
      await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await expectDOM(sash).toHaveAttribute('aria-valuenow', '280')
      await sash.dblclick(); await expectDOM(page.getByTestId('persisted-width')).toHaveText('320')
      expect(await page.getByRole('textbox').inputValue()).toBe('Unsent draft')
    } finally { /* keep shared page open */ }
  })
  test.serial('unmount and window blur cancel pending capture and never persist preview', async () => {
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
    } finally { /* keep shared page open */ }
  })
  test.serial('a narrower layout cancels capture and keeps saved width for an explicit overlay', async () => {
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
    } finally { /* keep shared page open */ }
  })

})
