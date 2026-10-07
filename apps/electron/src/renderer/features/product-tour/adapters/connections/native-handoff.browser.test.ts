import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNativeBrowserProcess } from '../work/meetings-automations/native-browser-process'
import type { RuntimeState, CapabilitySnapshot } from '../../contracts'

interface Snapshot { state: RuntimeState; capabilities: CapabilitySnapshot; calls: { microphone: number; stoppedTracks: number; start: number; grant: number; stop: number; cancel: number; list: number; audit: number; writes: number }; nativeModals: number; nativeLayers: number; auditRequests: Array<{ workspaceId: string }> }
declare global { interface Window { nativeHandoff: { controller: { ready: boolean; start(id: 'OBT-06' | 'OBT-24', mode?: 'new' | 'replay'): Promise<void>; pause(): void }; snapshot(): Snapshot; acceptMicrophone(index?: number): void; denyMicrophone(index?: number): void; cancelPrompt(): void; unmountVoice(): void; settleAudit(index: number, outcome?: 'ready' | 'denied'): void; switchWorkspace(id: string): void } } }
const isolatedCase = process.env.ROX_PRODUCT_TOUR_NATIVE_HANDOFF_CASE
let registered = false
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined
beforeAll(async () => {
  if (!isolatedCase) return
  const themes: Record<string, unknown> = {}
  const themesDir = new URL('../../../../../../resources/themes/', import.meta.url)
  for (const name of new Bun.Glob('*.json').scanSync({ cwd: fileURLToPath(themesDir) })) themes[`../../../resources/themes/${name}`] = await Bun.file(new URL(name, themesDir)).json()
  const built = await build({ entryPoints: [fileURLToPath(new URL('./native-handoff.browser.tsx', import.meta.url))], tsconfig: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)), bundle: true, platform: 'browser', format: 'esm', write: false, outdir: 'native-handoff', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' }, plugins: [
    { name: 'production-renderer-node-boundary', setup(builder) { builder.onResolve({ filter: /^node:/ }, () => ({ path: fileURLToPath(new URL('../../../../shims/node-stub.ts', import.meta.url)) })) } },
    { name: 'production-theme-inventory', setup(builder) { builder.onLoad({ filter: /\/context\/ThemeContext\.tsx$/ }, async args => ({ contents: (await Bun.file(args.path).text()).replace(/import\.meta\.glob\([^)]*\)/, JSON.stringify(themes)), loader: 'tsx', resolveDir: dirname(args.path) })) } },
    { name: 'unused-preview-worker-url', setup(builder) { builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'unused-preview' })); builder.onLoad({ filter: /.*/, namespace: 'unused-preview' }, () => ({ contents: "export default 'about:blank'", loader: 'js' })) } },
  ] })
  const script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text
  const stylePath = fileURLToPath(new URL('../../../../index.css', import.meta.url))
  const compiled = await compile(await Bun.file(stylePath).text(), { base: dirname(stylePath), onDependency() {} })
  const css = compiled.build(new Scanner({ sources: compiled.sources }).scan())
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/script.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } })
    if (path === '/renderer.css') return new Response(css, { headers: { 'content-type': 'text/css' } })
    return new Response('<!doctype html><link rel="stylesheet" href="/renderer.css"><div id="root"></div><script type="module" src="/script.js"></script>', { headers: { 'content-type': 'text/html' } })
  } })
  browser = await chromium.launch({ executablePath: process.env.LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
}, 30_000)
afterAll(async () => { if (isolatedCase) { await browser?.close(); server?.stop(true) } })
function browserTest(name: string, operation: () => Promise<void>) {
  if (isolatedCase && isolatedCase !== name) return
  if (isolatedCase) registered = true
  test(name, async () => {
    if (isolatedCase) return operation()
    expect(await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], { label: name, env: { ...process.env, ROX_PRODUCT_TOUR_NATIVE_HANDOFF_CASE: name } })).toBe(0)
  }, isolatedCase ? 30_000 : 45_000)
}
async function pageFor(kind: 'voice' | 'fabric', query = '', height = 1100) {
  const page = await browser!.newPage({ viewport: { width: 1500, height: kind === 'fabric' ? Number(process.env.ROX_PRODUCT_TOUR_AUDIT_RED_VIEWPORT) || height : height } })
  page.setDefaultTimeout(8_000)
  page.on('pageerror', error => console.error('Native handoff fixture:', error.message))
  await page.goto(`${server!.url.href}?kind=${kind}${query}`)
  await page.waitForFunction(() => window.nativeHandoff?.controller?.ready)
  return page
}
async function start(page: Page, kind: 'voice' | 'fabric') {
  await page.evaluate(kind => window.nativeHandoff.controller.start(kind === 'voice' ? 'OBT-06' : 'OBT-24'), kind)
  try { await page.locator(`[data-product-tour-step="${kind === 'voice' ? 'voice.start' : 'connections.services'}"]`).waitFor() }
  catch (error) {
    console.error('Native fixture start:', await page.evaluate(() => ({ phase: window.nativeHandoff.snapshot().state.phase, reason: window.nativeHandoff.snapshot().state.attempt?.reason, capability: window.nativeHandoff.snapshot().capabilities['connection-fabric.available'], rect: document.querySelector('[data-product-tour-target="connections.services"]')?.getBoundingClientRect().toJSON() })))
    throw error
  }
}
async function next(page: Page) { await page.locator('[data-product-tour-popover]').getByRole('button', { name: 'Next', exact: true }).click() }
async function blurHeldPrompt(page: Page) {
  await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.microphone === 1)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const held = await page.evaluate(() => window.nativeHandoff.snapshot())
  expect(held.state.phase).toBe('handed-off')
  expect(held.nativeModals).toBe(1)
  expect(held.nativeLayers).toBe(1)
  expect(held.calls.start).toBe(0)
  return held.state.attempt!.binding.runToken
}
for (const step of ['start', 'review'] as const) browserTest(`T-VOICE-HANDOFF native microphone prompt during voice.${step} preserves one capture across provider render and OS blur`, async () => {
  const page = await pageFor('voice')
  try {
    expect((await page.evaluate(() => window.nativeHandoff.snapshot())).calls.microphone).toBe(0)
    await start(page, 'voice')
    if (step === 'review') {
      await next(page)
      await page.locator('[data-product-tour-step="voice.review"]').waitFor()
      await page.keyboard.press('Control+Shift+D')
    } else await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    const token = await blurHeldPrompt(page)
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.nativeHandoff.acceptMicrophone() })
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).waitFor()
    await page.keyboard.press('Control+Shift+D')
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.stop === 1)
    await page.waitForFunction(() => window.nativeHandoff.snapshot().state.attemptEvidence['voice.review']?.level === 'observed')
    const inserted = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(inserted.state.attempt?.binding.runToken).toBe(token)
    expect(inserted.calls.microphone).toBe(1)
    expect(inserted.calls.start).toBe(1)
    expect(inserted.nativeModals).toBe(0)
    expect(inserted.nativeLayers).toBe(0)
    expect(inserted.state.attemptEvidence['voice.review']?.acknowledgedAt).toBeUndefined()
    expect(JSON.stringify(inserted)).not.toContain('PRIVATE FIXTURE TRANSCRIPT')
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Existing draft PRIVATE FIXTURE TRANSCRIPT')
    if (step === 'start') { await next(page); await page.locator('[data-product-tour-step="voice.review"]').waitFor() }
    await next(page)
    await page.waitForFunction(() => window.nativeHandoff.snapshot().state.phase === 'finished')
  } finally { await page.close() }
})
browserTest('T-VOICE-HANDOFF denied microphone permission cleans its layer, supplies no insertion and preserves ordinary blur fencing', async () => {
  const page = await pageFor('voice')
  try {
    await start(page, 'voice')
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await blurHeldPrompt(page)
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.nativeHandoff.denyMicrophone() })
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    const denied = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(denied.nativeModals).toBe(0)
    expect(denied.nativeLayers).toBe(0)
    expect(denied.calls.start).toBe(0)
    expect(denied.state.attemptEvidence['voice.review']?.level).toBeUndefined()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => window.nativeHandoff.snapshot().state.phase === 'paused')
    expect((await page.evaluate(() => window.nativeHandoff.snapshot())).state.attempt?.reason).toBe('focus-lost')
  } finally { await page.close() }
})
for (const outcome of ['denied', 'granted'] as const) browserTest(`T-VOICE-HANDOFF a ${outcome} permission prompt cannot revive the walkthrough while the window remains unfocused`, async () => {
  const page = await pageFor('voice')
  try {
    await start(page, 'voice')
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await blurHeldPrompt(page)
    await page.evaluate(outcome => outcome === 'denied' ? window.nativeHandoff.denyMicrophone() : window.nativeHandoff.acceptMicrophone(), outcome)
    if (outcome === 'granted') await page.getByRole('button', { name: 'Stop dictation', exact: true }).waitFor()
    await page.waitForFunction(() => window.nativeHandoff.snapshot().nativeModals === 0 && window.nativeHandoff.snapshot().nativeLayers === 0)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const closed = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(['paused', 'blocked']).toContain(closed.state.phase)
    expect(closed.state.attempt?.reason).toBe('focus-lost')
    expect(closed.calls.start).toBe(outcome === 'granted' ? 1 : 0)
    expect(closed.state.attemptEvidence['voice.review']?.level).toBeUndefined()
    if (outcome === 'granted') {
      await page.keyboard.press('Control+Shift+D')
      await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.stop === 1)
      await page.waitForFunction(() => (document.querySelector('[aria-label=Draft]') as HTMLTextAreaElement | null)?.value === 'Existing draft PRIVATE FIXTURE TRANSCRIPT')
      expect((await page.evaluate(() => window.nativeHandoff.snapshot())).state.attemptEvidence['voice.review']?.level).toBeUndefined()
    }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect(['paused', 'blocked']).toContain((await page.evaluate(() => window.nativeHandoff.snapshot())).state.phase)
  } finally { await page.close() }
})
for (const ending of ['cancel', 'unmount'] as const) browserTest(`T-VOICE-HANDOFF ${ending} retires the pending permission layer and rejects its late microphone grant`, async () => {
  const page = await pageFor('voice')
  try {
    await start(page, 'voice')
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.microphone === 1)
    await page.evaluate(ending => ending === 'cancel' ? window.nativeHandoff.cancelPrompt() : window.nativeHandoff.unmountVoice(), ending)
    await page.waitForFunction(() => window.nativeHandoff.snapshot().nativeModals === 0 && window.nativeHandoff.snapshot().nativeLayers === 0)
    await page.evaluate(() => window.nativeHandoff.acceptMicrophone())
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.stoppedTracks === 1)
    const stale = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(stale.calls.start).toBe(0)
    expect(stale.calls.stop).toBe(0)
    expect(stale.state.attemptEvidence['voice.review']?.level).toBeUndefined()
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Existing draft')
  } finally { await page.close() }
})
for (const height of [900, 1100]) browserTest(`T-CONNECTIONS-SERVICES tall native Services retains a visible owned viewport and ordinary scrolling at ${height}px`, async () => {
  const page = await pageFor('fabric', '&tall-services=1', height)
  try {
    await page.getByTestId('connections-row').last().waitFor({ state: 'attached' })
    await start(page, 'fabric')
    const target = page.getByTestId('connections-page').locator('[data-product-tour-target="connections.services"]')
    const bounds = await target.boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height)
    const viewport = target.locator('[data-radix-scroll-area-viewport]')
    expect(await viewport.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.wheel(0, 600)
    await page.waitForFunction(() => (document.querySelector('[data-product-tour-target="connections.services"] [data-radix-scroll-area-viewport]')?.scrollTop ?? 0) > 0)
    expect(['presenting', 'waiting-action']).toContain((await page.evaluate(() => window.nativeHandoff.snapshot())).state.phase)
    expect((await page.evaluate(() => window.nativeHandoff.snapshot())).calls.writes).toBe(0)
  } finally { await page.close() }
})
browserTest('T-CONNECTIONS-AUDIT first native Audit read retains Fabric availability and completes its captured current attempt', async () => {
  const page = await pageFor('fabric')
  try {
    await start(page, 'fabric'); await next(page)
    await page.locator('[data-product-tour-step="connections.audit"]').waitFor()
    const token = (await page.evaluate(() => window.nativeHandoff.snapshot())).state.attempt!.binding.runToken
    await page.getByRole('tab', { name: 'Audit', exact: true }).click()
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.audit === 1)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const pending = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(pending.capabilities['connection-fabric.available']).toEqual({ state: 'ready' })
    expect(['presenting', 'waiting-action']).toContain(pending.state.phase)
    expect(pending.state.attempt?.binding.runToken).toBe(token)
    await page.evaluate(() => window.nativeHandoff.settleAudit(0))
    await page.waitForFunction(() => window.nativeHandoff.snapshot().state.phase === 'finished')
    expect(await page.getByText('public-event-0', { exact: true }).count()).toBe(1)
    expect((await page.evaluate(() => window.nativeHandoff.snapshot())).calls.writes).toBe(0)
  } finally { await page.close() }
})
browserTest('T-CONNECTIONS-AUDIT refusal supplies no visible evidence while a genuine list failure remains unavailable', async () => {
  const page = await pageFor('fabric')
  try {
    await start(page, 'fabric'); await next(page)
    await page.locator('[data-product-tour-step="connections.audit"]').waitFor()
    await page.getByRole('tab', { name: 'Audit', exact: true }).click()
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.audit === 1)
    await page.evaluate(() => window.nativeHandoff.settleAudit(0, 'denied'))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.getByText('No connections yet', { exact: true }).waitFor()
    const denied = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(denied.capabilities['connection-fabric.available']).toEqual({ state: 'ready' })
    expect(denied.state.phase).not.toBe('finished')
    expect(denied.state.attemptEvidence['connections.audit']?.level).toBeUndefined()
    expect(denied.calls.writes).toBe(0)
  } finally { await page.close() }
  const unavailable = await pageFor('fabric', '&list-failure=1')
  try {
    await unavailable.waitForFunction(() => window.nativeHandoff.snapshot().capabilities['connection-fabric.available']?.state === 'unavailable')
    await unavailable.evaluate(() => window.nativeHandoff.controller.start('OBT-24'))
    expect((await unavailable.evaluate(() => window.nativeHandoff.snapshot())).state.phase).not.toBe('finished')
    expect((await unavailable.evaluate(() => window.nativeHandoff.snapshot())).calls.audit).toBe(0)
  } finally { await unavailable.close() }
})
browserTest('T-CONNECTIONS-AUDIT an obsolete workspace Audit response cannot complete a replacement attempt or replace its current rows', async () => {
  const page = await pageFor('fabric')
  try {
    await start(page, 'fabric'); await next(page)
    await page.getByRole('tab', { name: 'Audit', exact: true }).click()
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.audit === 1)
    const oldToken = (await page.evaluate(() => window.nativeHandoff.snapshot())).state.attempt!.binding.runToken
    await page.evaluate(() => window.nativeHandoff.switchWorkspace('workspace-b'))
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.audit === 2)
    await page.evaluate(() => window.nativeHandoff.switchWorkspace('workspace-a'))
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.audit === 3)
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await page.evaluate(() => window.nativeHandoff.controller.start('OBT-24', 'replay'))
    await page.locator('[data-product-tour-step="connections.services"]').waitFor(); await next(page)
    await page.getByRole('tab', { name: 'Audit', exact: true }).click()
    await page.waitForFunction(() => window.nativeHandoff.snapshot().calls.audit === 4)
    expect((await page.evaluate(() => window.nativeHandoff.snapshot())).state.attempt?.binding.runToken).not.toBe(oldToken)
    await page.evaluate(() => { window.nativeHandoff.settleAudit(0); window.nativeHandoff.settleAudit(1); window.nativeHandoff.settleAudit(2) })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const pending = await page.evaluate(() => window.nativeHandoff.snapshot())
    expect(pending.state.phase).not.toBe('finished')
    expect(pending.state.attemptEvidence['connections.audit']?.level).toBeUndefined()
    expect(await page.getByText('public-event-0', { exact: true }).count()).toBe(0)
    await page.evaluate(() => window.nativeHandoff.settleAudit(3))
    await page.waitForFunction(() => window.nativeHandoff.snapshot().state.phase === 'finished')
    expect(await page.getByText('public-event-3', { exact: true }).count()).toBe(1)
  } finally { await page.close() }
})
if (isolatedCase && !registered) test('requested native handoff fixture case exists', () => { throw new Error(`Unknown native handoff case: ${isolatedCase}`) })
