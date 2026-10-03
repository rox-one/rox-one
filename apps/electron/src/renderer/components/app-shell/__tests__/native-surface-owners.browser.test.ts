import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser, type Page } from 'playwright/test'
import { launchOwnedFixtureBrowser } from './rox-readiness-ui-001.browser-owner'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/native-surface-owners')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? chromium.executablePath()
const endpoint = 'http://127.0.0.1:5237'
const expectDOM = playwrightExpect.configure({ timeout: 10000 })
const calls = (page: Page) => page.evaluate(() => (window as any).__nativeFixture.calls as Array<{method:string;id?:string;rect?:{x:number;y:number;width:number;height:number}|null;args?:any}>)
const last = async (page: Page, id = 'shared') => (await calls(page)).filter(row => row.method === 'sync' && row.id === id).at(-1)

describe.skipIf(!existsSync(executablePath))('production native surface renderer ownership', () => {
  let ui: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let ownedBrowser: Awaited<ReturnType<typeof launchOwnedFixtureBrowser>> | undefined
  const stop = async () => {
    const ownedUi = ui
    ui = undefined
    try { await ownedBrowser?.close() } finally {
      if (ownedUi && ownedUi.exitCode === null) {
        ownedUi.kill()
        const exited = await Promise.race([ownedUi.exited.then(() => true), Bun.sleep(2000).then(() => false)])
        if (!exited) {
          ownedUi.kill('SIGKILL')
          const reaped = await Promise.race([ownedUi.exited.then(() => true), Bun.sleep(2000).then(() => false)])
          if (!reaped) throw new Error('Owned native renderer fixture did not exit after teardown')
        }
      }
    }
  }
  beforeAll(async () => {
    try {
      ui = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5237'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + 30000
      for (;;) {
        if (ui.exitCode !== null) throw new Error('Owned native ownership fixture exited')
        try { const response = await fetch(endpoint); if (response.ok) { if (!(await response.text()).includes('rox-native-surface-owners-fixture')) throw new Error('Different process owns native fixture port'); break } }
        catch (error) { if (error instanceof Error && error.message.includes('owns native')) throw error }
        if (Date.now() > deadline) throw new Error('Native ownership fixture startup timeout')
        await Bun.sleep(100)
      }
      ownedBrowser = await launchOwnedFixtureBrowser({ executablePath, headless: true, args: ['--no-sandbox'] })
      browser = ownedBrowser.browser
      // A Vite HTML response precedes its first module compilation. Complete
      // that startup inside the fixture hook, before the per-behavior budget.
      const warmup = await browser.newPage()
      try {
        await warmup.goto(endpoint)
        await expectDOM(warmup.getByTestId('first-host')).toBeVisible({ timeout: 60000 })
      } finally { await warmup.close() }
    } catch (error) { await stop(); throw error }
  }, 90000)
  afterAll(stop, 30000)
  const withPage = async (path: string, run: (page: Page) => Promise<void>) => {
    const page = await browser.newPage({viewport:{width:1250,height:800}})
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try { await page.goto(endpoint + path); await expectDOM(page.getByTestId('first-host')).toBeVisible(); await expectDOM.poll(async () => (await last(page))?.rect?.width).toBe(300); await run(page); expect(errors).toEqual([]) }
    catch (error) { throw new Error(`Native renderer fixture ${path} failed; calls=${JSON.stringify(await calls(page))}; body=${await page.locator('body').innerText()}`, { cause: error }) }
    finally { await page.close() }
  }
  it('hidden/released duplicate hosts cannot hide their visible sibling, while clipping hides the selected host', async () => withPage('', async page => {
    const first = (await last(page))!.rect!
    expect(first.x).toBe(20)
    await page.getByRole('button',{name:'Toggle second',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect?.x).toBeGreaterThan(first.x)
    const beforeHide = (await calls(page)).length
    await page.getByRole('button',{name:'Toggle first',exact:true}).click()
    await expectDOM(page.getByTestId('first-host')).not.toBeVisible()
    const secondBox = (await page.getByTestId('second-host').boundingBox())!
    await expectDOM.poll(async () => (await last(page))?.rect?.x).toBe(secondBox.x)
    expect((await calls(page)).slice(beforeHide).some(row => row.method === 'sync' && row.id === 'shared' && row.rect === null)).toBe(false)
    await page.getByRole('button',{name:'Toggle clip',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect).toBeNull()
    await expectDOM(page.getByTestId('second-host')).toContainText('fully into view')
    await page.getByRole('button',{name:'Toggle first',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect?.x).toBe(first.x)
    await page.getByRole('button',{name:'Remove second',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect?.x).toBe(first.x)
  }), 30000)
  it('retains a typed draft through responsive hiding, restores geometry and suppresses overlays', async () => withPage('', async page => {
    await page.getByRole('textbox',{name:'Retained draft'}).fill('Keep my draft')
    await page.getByRole('button',{name:'Toggle retained',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect).toBeNull()
    await expectDOM(page.getByRole('textbox',{name:'Retained draft'})).toHaveCount(0)
    await page.getByRole('button',{name:'Toggle retained',exact:true}).click()
    await expectDOM(page.getByRole('textbox',{name:'Retained draft'})).toHaveValue('Keep my draft')
    await expectDOM.poll(async () => (await last(page))?.rect?.width).toBe(300)
    await page.getByRole('button',{name:'Toggle overlay',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect).toBeNull()
    await page.getByRole('button',{name:'Dismiss overlay',exact:true}).click()
    await expectDOM.poll(async () => (await last(page))?.rect?.width).toBe(300)
  }), 30000)
  it('releases an inspector attachment arriving after close without hiding a sibling surface', async () => withPage('?mode=late', async page => {
    await expectDOM.poll(async () => (await calls(page)).filter(row=>row.method==='create').length).toBeGreaterThan(0)
    await page.getByRole('button',{name:'Close inspector',exact:true}).click()
    await page.evaluate(() => (window as any).__nativeFixture.finishAttachment())
    await expectDOM.poll(async () => (await last(page,'late-inspector'))?.rect).toBeNull()
    expect((await last(page))?.rect?.width).toBe(300)
  }), 30000)
  it('ignores an obsolete attachment failure after a newer open succeeds', async () => withPage('?mode=stale', async page => {
    await expectDOM.poll(async () => (await calls(page)).filter(row=>row.method==='create').length).toBe(2)
    await page.evaluate(() => (window as any).__nativeFixture.openDeferred())
    await expectDOM.poll(async () => (await calls(page)).filter(row=>row.method==='create').length).toBe(3)
    await page.evaluate(() => (window as any).__nativeFixture.openCurrent())
    await expectDOM.poll(async () => (await calls(page)).filter(row=>row.method==='create').length).toBe(4)
    await expectDOM.poll(async () => (await last(page,'fixture-inspector-3'))?.rect?.width).toBe(300)
    await page.evaluate(() => (window as any).__nativeFixture.rejectAttachment())
    await expectDOM(page.getByText('Obsolete attachment failure')).toHaveCount(0)
    await expectDOM(page.getByRole('checkbox')).toBeDisabled()
    expect((await last(page,'fixture-inspector-3'))?.rect?.width).toBe(300)
  }), 30000)
  it('preserves imported-cookie consent controls and routes explicit opt-in to a private instance', async () => withPage('?mode=cookies', async page => {
    const consent = page.getByRole('checkbox')
    await expectDOM(consent).toBeEnabled()
    await consent.check()
    await expectDOM.poll(async () => (await calls(page)).filter(row=>row.method==='create').at(-1)?.args?.useImportedCookies).toBe(true)
    await expectDOM(consent).toBeChecked()
  }), 30000)
})
