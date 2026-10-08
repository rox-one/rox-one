import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as browserExpect, type Browser, type Page } from 'playwright/test'

const repository = resolve(import.meta.dirname, '../../../../../../..'), fixture = resolve(import.meta.dirname, 'fixtures/product-learning-results')
const endpoint = 'http://127.0.0.1:5246', executablePath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/lib/chromium/chromium'
const check = browserExpect.configure({ timeout: 15000 }), timeout = 60000
const action = (page: Page, code: string) => page.evaluate(code)
const resolveTarget = (page: Page, id: string, override: object = {}) => page.evaluate(({ id, override }) => (window as any).__learningResults.resolve(id, override), { id, override })
const viewport = (page: Page) => page.locator('#panel [data-radix-scroll-area-viewport]').first()

describe.skipIf(!existsSync(executablePath))('production Skills and completed chat result targets', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined, browser: Browser | undefined, log: number | undefined, chrome: { pid: number; profile: string } | undefined
  const processText = async (args: string[]) => { const child = Bun.spawn(['ps', ...args], { stdout: 'pipe', stderr: 'ignore' }); const value = await new Response(child.stdout).text(); await child.exited; return value }
  const stillOwned = async () => { if (!chrome) return false; const command = (await processText(['-p', String(chrome.pid), '-o', 'command='])).trim(); return command.startsWith(executablePath + ' ') && command.includes('--rox-learning-results-fixture') && command.includes(chrome.profile) }
  const stop = async () => {
    server?.kill('SIGTERM')
    if (browser) { await Promise.race([browser.close().catch(() => {}), Bun.sleep(5000)]); if (await stillOwned()) { process.kill(chrome!.pid, 'SIGTERM'); await Bun.sleep(500); if (await stillOwned()) process.kill(chrome!.pid, 'SIGKILL') } }
    if (server) { await Promise.race([server.exited, Bun.sleep(2000)]); if (server.exitCode === null) { server.kill('SIGKILL'); await server.exited } }
    if (log !== undefined) { closeSync(log); log = undefined }
  }
  beforeAll(async () => {
    try {
      log = openSync(process.env.ROX_LEARNING_RESULTS_VITE_LOG ?? '/tmp/rox-learning-results-vite.log', 'w')
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5246'], { cwd: repository, stdout: log, stderr: log })
      const deadline = Date.now() + 30000
      for (;;) {
        if (server.exitCode !== null) throw Error('Learning results fixture exited')
        try { const response = await fetch(endpoint); if (response.ok) { if (!(await response.text()).includes('rox-learning-results-fixture')) throw Error('Foreign fixture port owner'); break } } catch (error) { if (error instanceof Error && error.message.includes('Foreign')) throw error }
        if (Date.now() > deadline) throw Error('Learning results fixture startup timeout')
        await Bun.sleep(100)
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--rox-learning-results-fixture'] })
      const rows = (await processText(['-axo', 'pid=,command='])).split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/)).filter((row): row is RegExpMatchArray => !!row && row[2].startsWith(executablePath + ' ') && row[2].includes('--rox-learning-results-fixture'))
      if (rows.length !== 1) throw Error('Owned Chrome process identity unavailable')
      const profile = rows[0][2].match(/--user-data-dir=\S+/)?.[0]
      if (!profile) throw Error('Owned Chrome profile unavailable')
      chrome = { pid: Number(rows[0][1]), profile }
    } catch (error) { await stop(); throw error }
  }, 45000)
  afterAll(stop, timeout)
  const withPage = async (kind: string, compact: boolean, run: (page: Page) => Promise<void>) => {
    const context = await browser!.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(endpoint, { waitUntil: 'domcontentloaded' })
      await check.poll(() => action(page, '!!window.__learningResults?.controls')).toBe(true)
      await page.evaluate(({ kind, compact }) => (window as any).__learningResults.controls.mount(kind, compact), { kind, compact })
      await check(viewport(page)).toBeVisible()
      if (kind !== 'skills') await check.poll(() => viewport(page).evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2)
      await run(page)
      expect(errors).toEqual([])
    } catch (error) { throw Error('Real component fixture failed; pageErrors=' + JSON.stringify(errors) + '; body=' + (await page.locator('body').innerText()).slice(0, 800), { cause: error }) } finally { await context.close() }
  }

  it('a long native skill catalogue stays inside its EntityPanel viewport and can scroll to the final row', () => withPage('skills', false, async page => {
    const sizes = await viewport(page).evaluate(element => ({ height: element.clientHeight, scroll: element.scrollHeight, panel: document.getElementById('panel')!.clientHeight }))
    expect(sizes.height).toBeGreaterThan(0)
    expect(sizes.height).toBeLessThanOrEqual(sizes.panel)
    expect(sizes.scroll).toBeGreaterThan(sizes.height * 3)
    expect((await resolveTarget(page, 'skills.list')).status).toBe('ready')
    await viewport(page).evaluate(element => { element.scrollTop = element.scrollHeight })
    await check(page.getByText('Native skill 79', { exact: true })).toBeInViewport()
    expect(await action(page, 'window.scrollY')).toBe(0)
  }), timeout)

  for (const compact of [false, true]) it(`${compact ? 'compact' : 'desktop'} huge single-paragraph final/source results use their visible answer intersection and track partial scroll`, () => withPage('result', compact, async page => {
    console.info(JSON.stringify({ compact, final: await resolveTarget(page, 'session.final-result'), source: await resolveTarget(page, 'session.tool-result') }))
    for (const id of ['session.final-result', 'session.tool-result']) {
      const result = await resolveTarget(page, id)
      expect(result.count).toBe(1)
      expect(result.strict).toBeNull()
      expect(result.status).toBe('ready')
      expect(result.response).toBe('response')
    }
    await viewport(page).evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 100); element.dispatchEvent(new Event('scroll')) })
    expect((await resolveTarget(page, 'session.final-result')).status).toBe('ready')
    await action(page, "window.__learningResults.controls.showOverlay('session.final-result')")
    await check(page.locator('[data-product-tour-mask] rect')).toBeVisible()
    const verifyMask = async () => page.evaluate(() => {
      const target = (window as any).__learningResults.target('session.final-result').getBoundingClientRect(), clip = document.querySelector('#panel [data-radix-scroll-area-viewport]')!.getBoundingClientRect(), mask = document.querySelector('[data-product-tour-mask] rect')!
      return { actualTop: Number(mask.getAttribute('y')), expectedTop: Math.max(target.top, clip.top) - 8, actualBottom: Number(mask.getAttribute('y')) + Number(mask.getAttribute('height')), expectedBottom: Math.min(target.bottom, clip.bottom) + 8 }
    })
    await check.poll(async () => { const geometry = await verifyMask(); return Math.max(Math.abs(geometry.actualTop - geometry.expectedTop), Math.abs(geometry.actualBottom - geometry.expectedBottom)) }).toBeLessThanOrEqual(2)
    await viewport(page).evaluate(element => { element.scrollTop += 70; element.dispatchEvent(new Event('scroll')) })
    await check.poll(async () => { const geometry = await verifyMask(); return Math.max(Math.abs(geometry.actualTop - geometry.expectedTop), Math.abs(geometry.actualBottom - geometry.expectedBottom)) }).toBeLessThanOrEqual(2)
    expect(await action(page, 'window.__learningResults.pauses')).toEqual([])
    expect(await action(page, 'window.__learningResults.activeGeometryObservers()')).toBe(1)
    await action(page, 'window.__learningResults.controls.closeOverlay()')
    await check(page.locator('[data-product-tour-mask]')).toHaveCount(0)
    expect(await action(page, 'window.__learningResults.activeGeometryObservers()')).toBe(0)
    await viewport(page).evaluate(element => { element.scrollTop -= 30; element.dispatchEvent(new Event('scroll')) })
    await action(page, 'new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
    expect(await action(page, 'window.__learningResults.pauses')).toEqual([])
  }), timeout)

  it('result intersections still block real obscuration, foreign scope, fully offscreen content and stale DOM', () => withPage('result', true, async page => {
    expect(await action(page, 'window.__learningResults.clippedControl()')).toBe('target-occluded')
    expect((await resolveTarget(page, 'session.final-result', { panelId: 'other-panel' })).reason).toBe('target-missing')
    expect((await resolveTarget(page, 'session.tool-result', { sessionId: 'other-session' })).reason).toBe('target-missing')
    await page.evaluate(() => { const cover = document.createElement('div'); cover.id = 'native-cover'; cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:black'; document.body.append(cover) })
    for (const id of ['session.final-result', 'session.tool-result']) expect((await resolveTarget(page, id)).reason).toBe('target-occluded')
    await action(page, "document.getElementById('native-cover').remove();document.getElementById('panel').style.transform='translateY(1000px)'")
    for (const id of ['session.final-result', 'session.tool-result']) expect((await resolveTarget(page, id)).reason).toBe('target-occluded')
    await action(page, "document.getElementById('panel').style.transform='';window.__learningResults.controls.unmount()")
    for (const id of ['session.final-result', 'session.tool-result']) expect(await resolveTarget(page, id)).toMatchObject({ count: 0, reason: 'target-missing' })
  }), timeout)

  it('promoted intermediate text never becomes a native final-result target', () => withPage('ineligible', true, async page => {
    expect(await resolveTarget(page, 'session.final-result')).toMatchObject({ count: 0, reason: 'target-missing' })
  }), timeout)

  it('a completed source activity without an answer binds its real native activity surface, while a failed tool never registers', () => withPage('source-only', true, async page => {
    expect(await resolveTarget(page, 'session.tool-result')).toMatchObject({ count: 1, status: 'ready', response: null })
    expect(await resolveTarget(page, 'session.final-result')).toMatchObject({ count: 0, reason: 'target-missing' })
    await action(page, "window.__learningResults.controls.replace('tool-error')")
    expect(await resolveTarget(page, 'session.tool-result')).toMatchObject({ count: 0, reason: 'target-missing' })
  }), timeout)
})
