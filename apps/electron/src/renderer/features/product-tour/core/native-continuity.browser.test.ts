import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { RequestContext } from '@rox/server-core/transport'
import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'
import type { RuntimeState, StepId, TourSignal, TourProgress } from '../contracts'
import { noteNativeBrowserStage as stage, runNativeBrowserProcess } from '../adapters/work/meetings-automations/native-browser-process'

interface NativeContinuitySnapshot { phase: RuntimeState['phase']; stepId?: StepId; evidence: RuntimeState['attemptEvidence']; progress: TourProgress | null; signals: TourSignal[]; calls: { getUserMedia: number; startVoiceCapture: number; grantVoicePermission: number; stopVoiceCapture: number; cancelVoiceCapture: number; copyVoiceText: number; getSources: number } }
declare global { interface Window { nativeContinuity: { start(kind: 'voice' | 'source', emptyTranscript?: boolean, delivery?: 'draft' | 'clipboard', trailingSpace?: boolean, paired?: boolean, deferredStart?: boolean): void; show(): void; acknowledge(): void; snapshot(): NativeContinuitySnapshot; clipboard(): string; focusPeer(): void; hotkey(payload: { command: HotkeyCommand; recordingId?: string }): void; resolveStart(): void } } }
const isolatedCase = process.env.ROX_PRODUCT_TOUR_NATIVE_CONTINUITY_CASE
let registeredCase = false
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined
beforeAll(async () => {
  if (!isolatedCase) return
  stage('continuity:themes:start')
  const themesDirectory = new URL('../../../../../resources/themes/', import.meta.url)
  const themeModules: Record<string, unknown> = {}
  for (const name of new Bun.Glob('*.json').scanSync({ cwd: fileURLToPath(themesDirectory) })) themeModules[`../../../resources/themes/${name}`] = await Bun.file(new URL(name, themesDirectory)).json()
  stage('continuity:bundle:start')
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./native-continuity.browser.tsx', import.meta.url))], tsconfig: fileURLToPath(new URL('../../../../../tsconfig.json', import.meta.url)), bundle: true, platform: 'browser', format: 'esm', write: false, outdir: 'native-continuity-browser', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' }, plugins: [
    // Use the renderer's actual production shim, matching electron/vite.config.ts.
    { name: 'production-renderer-node-boundary', setup(build) { build.onResolve({ filter: /^node:/ }, () => ({ path: fileURLToPath(new URL('../../../shims/node-stub.ts', import.meta.url)) })) } },
    // Expand the same real eager JSON theme inventory that Vite expands in production.
    { name: 'production-theme-inventory', setup(build) { build.onLoad({ filter: /\/context\/ThemeContext\.tsx$/ }, async args => ({ contents: (await Bun.file(args.path).text()).replace(/import\.meta\.glob\([^)]*\)/, JSON.stringify(themeModules)), loader: 'tsx', resolveDir: dirname(args.path) })) } },
    { name: 'unused-preview-worker-url', setup(build) { build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'unused-preview-worker' })); build.onLoad({ filter: /.*/, namespace: 'unused-preview-worker' }, () => ({ contents: "export default 'about:blank'", loader: 'js' })) } },
  ] })
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text
  stage('continuity:bundle:ready')
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return new URL(request.url).pathname === '/script.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<!doctype html><div id="root"></div><script type="module" src="/script.js"></script>', { headers: { 'content-type': 'text/html' } }) } })
  stage('continuity:browser:launch')
  browser = await chromium.launch({ executablePath: process.env.LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  stage('continuity:browser:ready')
}, 30_000)
afterAll(async () => {
  if (!isolatedCase) return
  stage('continuity:browser:close')
  await browser?.close()
  server?.stop(true)
  stage('continuity:browser:closed')
})

function browserTest(name: string, operation: () => Promise<void>) {
  if (isolatedCase && isolatedCase !== name) return
  if (isolatedCase) registeredCase = true
  test(name, async () => {
    if (isolatedCase === name) {
      stage('continuity:case:start')
      await operation()
      stage('continuity:case:passed')
      return
    }
    const exitCode = await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], {
      label: name, env: { ...process.env, ROX_PRODUCT_TOUR_NATIVE_CONTINUITY_CASE: name },
    })
    expect(exitCode).toBe(0)
  }, isolatedCase ? 30_000 : 45_000)
}

for (const early of [true, false]) browserTest(`T-VOICE-REVIEW production dictation response ${early ? 'before' : 'after'} the start acknowledgement needs one capture and a visible review`, async () => {
  const page = await browser!.newPage()
  const errors: string[] = []
  page.setDefaultTimeout(10_000)
  page.on('pageerror', error => { errors.push(error.message); console.error('Native continuity browser error:', error.message) })
  try {
    await page.goto(server!.url.href)
    await page.waitForFunction(() => !!window.nativeContinuity)
    await page.evaluate(() => window.nativeContinuity.start('voice'))
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    await page.evaluate(() => window.nativeContinuity.show())
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).waitFor()
    if (!early) await page.evaluate(() => { window.nativeContinuity.acknowledge(); window.nativeContinuity.show() })
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
    await page.waitForFunction(() => window.nativeContinuity.snapshot().signals.length === 1)
    const inserted = await page.evaluate(() => window.nativeContinuity.snapshot())
    expect(inserted.stepId).toBe(early ? 'voice.start' : 'voice.review')
    expect(inserted.evidence['voice.review']?.level).toBe('observed')
    expect(inserted.evidence['voice.review']?.acknowledgedAt).toBeUndefined()
    expect(inserted.calls.startVoiceCapture).toBe(1)
    expect(inserted.calls.stopVoiceCapture).toBe(1)
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Existing draft Private fixture transcript')
    expect(JSON.stringify(inserted)).not.toContain('Private fixture transcript')
    if (early) await page.evaluate(() => { window.nativeContinuity.acknowledge(); window.nativeContinuity.show() })
    expect(await page.evaluate(() => window.nativeContinuity.snapshot().phase)).toBe('presenting')
    await page.evaluate(() => window.nativeContinuity.acknowledge())
    expect(await page.evaluate(() => window.nativeContinuity.snapshot().phase)).toBe('finished')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

browserTest('T-VOICE-REVIEW an empty native transcription cannot supply insertion evidence or a review acknowledgement', async () => {
  const page = await browser!.newPage()
  try {
    await page.goto(server!.url.href)
    await page.waitForFunction(() => !!window.nativeContinuity)
    await page.evaluate(() => window.nativeContinuity.start('voice', true))
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    await page.evaluate(() => window.nativeContinuity.show())
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
    await page.waitForFunction(() => window.nativeContinuity.snapshot().calls.stopVoiceCapture === 1)
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    await page.evaluate(() => { window.nativeContinuity.acknowledge(); window.nativeContinuity.show(); window.nativeContinuity.acknowledge() })
    const result = await page.evaluate(() => window.nativeContinuity.snapshot())
    expect(result.signals).toEqual([])
    expect(result.evidence['voice.review']?.level).toBeUndefined()
    expect(result.phase).toBe('waiting-action')
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Existing draft')
  } finally { await page.close() }
})

for (const trailingSpace of [false, true]) browserTest(`T-VOICE-REVIEW clipboard delivery ${trailingSpace ? 'with' : 'without'} a trailing space cannot supply composer insertion evidence`, async () => {
  const page = await browser!.newPage()
  try {
    await page.goto(server!.url.href)
    await page.waitForFunction(() => !!window.nativeContinuity)
    await page.evaluate(value => window.nativeContinuity.start('voice', false, 'clipboard', value), trailingSpace)
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    await page.evaluate(() => window.nativeContinuity.show())
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
    await page.waitForFunction(() => window.nativeContinuity.snapshot().calls.copyVoiceText === 1)
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    expect(await page.evaluate(() => window.nativeContinuity.clipboard())).toBe(`Private fixture transcript${trailingSpace ? ' ' : ''}`)
    await page.evaluate(() => { window.nativeContinuity.acknowledge(); window.nativeContinuity.show(); window.nativeContinuity.acknowledge() })
    const result = await page.evaluate(() => window.nativeContinuity.snapshot())
    expect(result.calls.startVoiceCapture).toBe(1)
    expect(result.calls.stopVoiceCapture).toBe(1)
    expect(result.calls.copyVoiceText).toBe(1)
    expect(result.signals).toEqual([])
    expect(result.evidence['voice.review']?.level).toBeUndefined()
    expect(result.phase).toBe('waiting-action')
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Existing draft')
    expect(JSON.stringify(result)).not.toContain('Private fixture transcript')
  } finally { await page.close() }
})

browserTest('T-VOICE-REVIEW draft delivery preserves the requested trailing space and still needs a visible review acknowledgement', async () => {
  const page = await browser!.newPage()
  try {
    await page.goto(server!.url.href)
    await page.waitForFunction(() => !!window.nativeContinuity)
    await page.evaluate(() => window.nativeContinuity.start('voice', false, 'draft', true))
    await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    await page.evaluate(() => window.nativeContinuity.show())
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
    await page.waitForFunction(() => window.nativeContinuity.snapshot().signals.length === 1)
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Existing draft Private fixture transcript ')
    const inserted = await page.evaluate(() => window.nativeContinuity.snapshot())
    expect(inserted.calls.startVoiceCapture).toBe(1)
    expect(inserted.calls.stopVoiceCapture).toBe(1)
    expect(inserted.calls.copyVoiceText).toBe(0)
    expect(inserted.evidence['voice.review']?.level).toBe('observed')
    expect(inserted.evidence['voice.review']?.acknowledgedAt).toBeUndefined()
    expect(JSON.stringify(inserted)).not.toContain('Private fixture transcript')
    await page.evaluate(() => { window.nativeContinuity.acknowledge(); window.nativeContinuity.show() })
    expect(await page.evaluate(() => window.nativeContinuity.snapshot().phase)).toBe('presenting')
    await page.evaluate(() => window.nativeContinuity.acknowledge())
    expect(await page.evaluate(() => window.nativeContinuity.snapshot().phase)).toBe('finished')
  } finally { await page.close() }
})

browserTest('T-SOURCES-DETAILS one production source page load advances status and presents the current details for acknowledgement', async () => {
  const page = await browser!.newPage()
  const errors: string[] = []
  page.setDefaultTimeout(10_000)
  page.on('pageerror', error => { errors.push(error.message); console.error('Native continuity browser error:', error.message) })
  try {
    await page.goto(server!.url.href)
    await page.waitForFunction(() => !!window.nativeContinuity)
    await page.evaluate(() => window.nativeContinuity.start('source'))
    await page.getByRole('button', { name: 'Open source details' }).waitFor()
    await page.evaluate(() => window.nativeContinuity.show())
    await page.getByRole('button', { name: 'Open source details' }).click()
    await page.waitForFunction(() => window.nativeContinuity.snapshot().stepId === 'sources.details')
    expect(await page.evaluate(() => window.nativeContinuity.snapshot().signals.length)).toBe(1)
    await page.locator('[data-product-tour-target="source.status"]').waitFor()
    await page.evaluate(() => window.nativeContinuity.show())
    const details = await page.evaluate(() => window.nativeContinuity.snapshot())
    expect(details.phase).toBe('presenting')
    expect(details.evidence['sources.details']?.level).toBe('observed')
    expect(details.calls.getSources).toBe(1)
    await page.evaluate(() => window.nativeContinuity.acknowledge())
    expect(await page.evaluate(() => window.nativeContinuity.snapshot().phase)).toBe('finished')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

for (const action of ['stop', 'cancel'] as const) for (const deferred of [false, true]) browserTest(`T-VOICE-OWNER authenticated overlay ${action} ${deferred ? 'before' : 'after'} START returns reaches its unfocused composer without starting the idle peer`, async () => {
  const handlers = new Map<string, (event: { sender: unknown }, action: string, recordingId: string) => unknown>()
  const children: FixtureWindow[] = []
  class FixtureWindow extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), { isDestroyed: () => this.destroyed, send() {}, setWindowOpenHandler() {} })
    constructor(config: { parent?: unknown } = {}) { super(); if (config.parent) children.push(this) }
    isDestroyed() { return this.destroyed }
    isFocused() { return true }
    getBounds() { return { x: 0, y: 0, width: 1000, height: 800 } }
    showInactive() {}
    hide() {}
    destroy() { this.destroyed = true; this.emit('closed') }
    async loadURL() {}
  }
  // Only the OS Electron surface is replaced. Command authorization and delivery
  // below run through the actual overlay owner and authenticated hotkey router.
  mock.module('electron', () => ({ app: { isPackaged: true }, BrowserWindow: FixtureWindow,
    ipcMain: { handle: (id: string, callback: (event: { sender: unknown }, action: string, recordingId: string) => unknown) => handlers.set(id, callback), removeHandler: (id: string) => handlers.delete(id) },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
  }))
  const { createNativeVoiceOverlayHost, VOICE_OVERLAY_COMMAND } = await import('../../../../main/voice/overlay-owner')
  const { sendVoiceHotkeyToClient } = await import('../../../../main/voice/command-input')
  const owner = new FixtureWindow()
  const context: RequestContext = { clientId: 'native-client', workspaceId: 'native-workspace', webContentsId: 17 }
  const commands: Array<{ command: HotkeyCommand; recordingId?: string }> = []
  const overlay = createNativeVoiceOverlayHost({
    resolveOwner: incoming => incoming === context ? owner as never : null,
    sendCommand: (incoming, command, recordingId) => sendVoiceHotkeyToClient({ webContentsId: incoming.webContentsId!, isManagedWindow: id => id === 17, resolveClient: () => context.clientId, channel: 'voice:hotkey', push: (_channel, _target, payload) => { commands.push(payload) } }, command, recordingId),
  })
  const page = await browser!.newPage()
  try {
    await page.goto(server!.url.href)
    await page.waitForFunction(() => !!window.nativeContinuity)
    await page.evaluate(deferred => window.nativeContinuity.start('voice', false, 'draft', false, true, deferred), deferred)
    const ownerComposer = page.getByRole('group', { name: 'Owner composer' })
    await ownerComposer.getByRole('button', { name: 'Dictate', exact: true }).click()
    if (deferred) await page.waitForFunction(() => window.nativeContinuity.snapshot().calls.startVoiceCapture === 1)
    else await ownerComposer.getByRole('button', { name: 'Stop dictation', exact: true }).waitFor()
    await page.evaluate(() => window.nativeContinuity.focusPeer())
    overlay.publish({ context, position: 'bottom', state: { recordingId: 'fixture-recording', phase: action === 'cancel' && deferred ? 'permission' : 'recording', elapsedMs: 1, rms: 0, streaming: false }, assertCurrent() {} })
    expect(handlers.get(VOICE_OVERLAY_COMMAND)!({ sender: children[0]!.webContents }, action, 'fixture-recording')).toEqual({ ok: true })
    expect(commands).toHaveLength(1)
    expect(commands[0]?.recordingId).toBe('fixture-recording')
    await page.evaluate(payload => window.nativeContinuity.hotkey(payload), commands[0]!)
    // A stale packet arriving later cannot replace the pending owner's command.
    await page.evaluate(() => window.nativeContinuity.hotkey({ command: 'cancel', recordingId: 'retired-recording' }))
    if (deferred) {
      expect(await page.evaluate(() => window.nativeContinuity.snapshot().calls.getUserMedia)).toBe(1)
      expect(await page.evaluate(() => window.nativeContinuity.snapshot().calls.stopVoiceCapture)).toBe(0)
      expect(await page.evaluate(() => window.nativeContinuity.snapshot().calls.cancelVoiceCapture)).toBe(0)
      await page.evaluate(() => window.nativeContinuity.resolveStart())
    }
    await page.waitForFunction(action => window.nativeContinuity.snapshot().calls[action === 'stop' ? 'stopVoiceCapture' : 'cancelVoiceCapture'] === 1, action)
    await ownerComposer.getByRole('button', { name: 'Dictate', exact: true }).waitFor()
    const result = await page.evaluate(() => window.nativeContinuity.snapshot())
    expect(result.calls.getUserMedia).toBe(1)
    expect(result.calls.startVoiceCapture).toBe(1)
    expect(result.calls.stopVoiceCapture).toBe(action === 'stop' ? 1 : 0)
    expect(result.calls.cancelVoiceCapture).toBe(action === 'cancel' ? 1 : 0)
    expect(result.calls.grantVoicePermission).toBe(action === 'cancel' && deferred ? 0 : 1)
    expect(await page.getByRole('textbox', { name: 'Owner draft' }).inputValue()).toBe(action === 'stop' ? 'Owner draft Private fixture transcript' : 'Owner draft')
    expect(await page.getByRole('textbox', { name: 'Peer draft' }).inputValue()).toBe('Peer draft')
    if (action === 'cancel') expect(result.signals).toEqual([])
    // A delayed command for the finished recording cannot stop its replacement.
    if (action === 'stop' && !deferred) {
      await ownerComposer.getByRole('button', { name: 'Dictate', exact: true }).click()
      await ownerComposer.getByRole('button', { name: 'Stop dictation', exact: true }).waitFor()
      await page.evaluate(() => window.nativeContinuity.hotkey({ command: 'toggle', recordingId: 'fixture-recording' }))
      expect(await ownerComposer.getByRole('button', { name: 'Stop dictation', exact: true }).isVisible()).toBe(true)
      expect(await page.evaluate(() => window.nativeContinuity.snapshot().calls.stopVoiceCapture)).toBe(1)
      overlay.publish({ context, position: 'bottom', state: { recordingId: 'fixture-recording-2', phase: 'recording', elapsedMs: 1, rms: 0, streaming: false }, assertCurrent() {} })
      expect(handlers.get(VOICE_OVERLAY_COMMAND)!({ sender: children[0]!.webContents }, 'cancel', 'fixture-recording-2')).toEqual({ ok: true })
      await page.evaluate(payload => window.nativeContinuity.hotkey(payload), commands[1]!)
      await page.waitForFunction(() => window.nativeContinuity.snapshot().calls.cancelVoiceCapture === 1)
      expect(await page.evaluate(() => window.nativeContinuity.snapshot().calls.getUserMedia)).toBe(2)
      expect(await page.evaluate(() => window.nativeContinuity.snapshot().calls.startVoiceCapture)).toBe(2)
    }
  } finally { overlay.dispose(); await page.close() }
})
if (isolatedCase && !registeredCase) throw new Error(`Unknown native renderer continuity case: ${isolatedCase}`)
