import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/voice-dictation')
const url = 'http://127.0.0.1:5298'
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const proofDirectory = process.env.VOICE_DICTATION_PROOF_DIR
const timeout = 30_000

describe.skipIf(!existsSync(executablePath))('voice dictation production renderer DOM', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browserOwnerDirectory: string | undefined
  let browser: Browser
  let page: Page
  const errors: string[] = []
  const stop = async () => {
    // The ephemeral bundler owns no persistent state. Retire it deterministically
    // even when another package build has saturated the host during teardown.
    const owned = server; server = undefined; owned?.kill('SIGKILL')
    const ownedBrowserDirectory = browserOwnerDirectory; browserOwnerDirectory = undefined
    const close = browser?.close()
    const pidFile = ownedBrowserDirectory && join(ownedBrowserDirectory, 'browser.pid')
    // The launcher records its own PID before exec, preserving Playwright's
    // private process group. Kill only that group; browser.close reaps it and
    // removes the private profile even if graceful CDP shutdown stalled.
    if (pidFile && existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned browser PID')
      try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    try { await close } finally {
      await owned?.exited
      if (ownedBrowserDirectory) rmSync(ownedBrowserDirectory, { recursive: true, force: true })
    }
  }
  beforeAll(async () => {
    try {
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5298'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + timeout
      for (;;) {
        if (server.exitCode !== null) throw new Error('Owned voice fixture exited before startup')
        try { if ((await fetch(url)).ok) break } catch {}
        if (Date.now() > deadline) throw new Error('Voice DOM fixture did not start')
        await Bun.sleep(100)
      }
      browserOwnerDirectory = mkdtempSync(join(tmpdir(), 'rox-voice-browser-'))
      browser = await chromium.launch({
        executablePath: process.platform === 'win32' ? executablePath : resolve(fixture, 'browser-launcher.sh'), headless: true, args: ['--no-sandbox'],
        env: { ...process.env, VOICE_BROWSER_PID_FILE: join(browserOwnerDirectory, 'browser.pid'), VOICE_BROWSER_ACTUAL_EXECUTABLE: executablePath },
      })
      const warmup = await browser.newPage(); warmup.on('pageerror', (error) => console.error('Voice fixture warmup:', error.message)); warmup.on('console', (message) => { if (message.type() === 'error') console.error('Voice fixture console:', message.text()) }); await warmup.goto(url)
      await expectDOM(warmup.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled({ timeout })
      await warmup.close()
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) { await stop(); throw error }
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.on('pageerror', (error) => errors.push(error.message)) }, timeout)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, timeout)
  afterAll(stop, timeout)
  const calls = () => page.evaluate(() => (window as any).__voiceFixture.calls as Array<{ method: string; args?: unknown }>)
  const load = async (query = '') => { await page.goto(`${url}/?${query}`); await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled() }
  const start = () => page.getByRole('button', { name: 'Dictate', exact: true }).click()
  const finish = () => page.getByRole('button', { name: 'Stop dictation', exact: true }).click()

  it('consumes STOP once and appends the returned paragraphs to the latest edited draft', async () => {
    await load('deferredStop=true'); await start(); await finish()
    await page.getByRole('textbox', { name: 'Draft' }).fill('Edited while transcribing')
    await page.evaluate(() => (window as any).__voiceFixture.resolveStop())
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Edited while transcribing Synthetic first paragraph.\n\nSynthetic second paragraph.')
    expect((await calls()).filter((call) => call.method === 'stopVoiceCapture')).toHaveLength(1)
    expect((await calls()).find((call) => call.method === 'startVoiceCapture')?.args).toEqual({ mimeType: 'audio/webm' })
    expect((await calls()).filter((call) => call.method === 'transcribeVoice')).toHaveLength(0)
  }, timeout)

  it('asks for cloud upload consent at first use and starts only after the saved grant', async () => {
    await load('consent=false&migration=true'); await start()
    await expectDOM(page.getByRole('dialog')).toBeVisible()
    expect((await calls()).filter((call) => call.method === 'getUserMedia')).toHaveLength(0)
    if (proofDirectory) await page.screenshot({ path: resolve(proofDirectory, 'deepgram-first-use-consent.png') })
    await page.getByRole('button', { name: 'Allow Deepgram and transcribe' }).click()
    await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    expect((await calls()).find((call) => call.method === 'saveVoicePrefs')?.args).toEqual({ cloudAsrConsent: true, privacyMigrationPending: false, sttEngine: 'cloud-rox' })
    await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
  }, timeout)

  it('closing the consent dialog leaves capture and audio upload untouched', async () => {
    await load('consent=false'); await start(); await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectDOM(page.getByRole('dialog')).not.toBeVisible()
    expect((await calls()).filter((call) => ['saveVoicePrefs', 'getUserMedia', 'sendVoiceChunk'].includes(call.method))).toHaveLength(0)
  }, timeout)

  it('late consent success after unmount cannot start a microphone capture', async () => {
    await load('consent=false&deferredConsent=true'); await start(); await page.getByRole('button', { name: 'Allow Deepgram and transcribe' }).click()
    await page.evaluate(() => { const fixture = (window as any).__voiceFixture; fixture.unmount() })
    await page.waitForTimeout(25)
    await page.evaluate(() => (window as any).__voiceFixture.resolveConsent())
    await page.waitForTimeout(25)
    expect((await calls()).filter((call) => call.method === 'getUserMedia')).toHaveLength(0)
  }, timeout)

  const hotkey = (command: string) => page.evaluate((value) => (window as any).__voiceFixture.hotkey(value), command)
  const waitForCall = (method: string) => page.waitForFunction((name) => (window as any).__voiceFixture.calls.some((call: { method: string }) => call.method === name), method)

  it('pairs push-to-talk once and consumes the current single-STOP transcript', async () => {
    await load(); await hotkey('ptt-up'); await hotkey('cancel')
    expect((await calls()).filter((call) => ['getUserMedia', 'cancelVoiceCapture'].includes(call.method))).toHaveLength(0)
    await hotkey('ptt-down'); await hotkey('ptt-down')
    await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    await hotkey('ptt-up'); await hotkey('ptt-up')
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
    expect((await calls()).filter((call) => call.method === 'startVoiceCapture')).toHaveLength(1)
    expect((await calls()).filter((call) => call.method === 'stopVoiceCapture')).toHaveLength(1)
    expect((await calls()).filter((call) => call.method === 'transcribeVoice')).toHaveLength(0)
  }, timeout)

  it('release while the microphone prompt is pending stops late tracks without starting or cancelling a host job', async () => {
    await load('deferredMicrophone=true'); await hotkey('ptt-down'); await waitForCall('getUserMedia')
    await hotkey('ptt-up'); await page.evaluate(() => (window as any).__voiceFixture.resolveMicrophone())
    await waitForCall('stopTrack')
    expect((await calls()).filter((call) => ['startVoiceCapture', 'grantVoicePermission', 'recorderStart', 'cancelVoiceCapture'].includes(call.method))).toHaveLength(0)
  }, timeout)

  for (const boundary of ['Start', 'Grant'] as const) {
    it(`release during pending ${boundary} immediately closes the microphone and fences late capture`, async () => {
      await load(`deferred${boundary}=true`); await hotkey('ptt-down'); await waitForCall(boundary === 'Start' ? 'startVoiceCapture' : 'grantVoicePermission')
      await hotkey('ptt-up'); await waitForCall('stopTrack')
      expect((await calls()).filter((call) => call.method === 'recorderStart')).toHaveLength(0)
      await page.evaluate((name) => (window as any).__voiceFixture[`resolve${name}`](), boundary)
      await waitForCall('cancelVoiceCapture')
      expect((await calls()).filter((call) => call.method === 'recorderStart')).toHaveLength(0)
      expect((await calls()).filter((call) => call.method === 'sendVoiceChunk')).toHaveLength(0)
      expect((await calls()).filter((call) => call.method === 'cancelVoiceCapture')).toHaveLength(1)
    }, timeout)
  }

  it('a refused START cleans acquired tracks without cancelling another host job', async () => {
    await load('refusedStart=true'); await hotkey('ptt-down'); await waitForCall('stopTrack')
    expect((await calls()).filter((call) => ['grantVoicePermission', 'recorderStart', 'cancelVoiceCapture'].includes(call.method))).toHaveLength(0)
  }, timeout)

  it('unmount cancels the owned request and discards a late STOP transcript', async () => {
    await load('deferredStop=true'); await hotkey('ptt-down'); await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    await hotkey('ptt-up'); await waitForCall('stopVoiceCapture')
    await page.evaluate(() => (window as any).__voiceFixture.unmount())
    await waitForCall('cancelVoiceCapture')
    await page.evaluate(() => (window as any).__voiceFixture.resolveStop())
    await page.waitForTimeout(25)
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    expect((await calls()).filter((call) => call.method === 'transcribeVoice')).toHaveLength(0)
  }, timeout)

  it('explicit clipboard completion uses the current local port and preserves the draft', async () => {
    await load('delivery=clipboard'); await start(); await finish()
    await page.waitForFunction(() => (window as any).__voiceFixture.calls.some((call: any) => call.method === 'copyVoiceText'))
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    expect((await calls()).filter(call => call.method === 'copyVoiceText')).toEqual([{ method: 'copyVoiceText', args: { text: 'Synthetic first paragraph.\n\nSynthetic second paragraph.' } }])
  }, timeout)
  it('refused clipboard completion preserves the draft and reports the delivery failure', async () => {
    await load('delivery=clipboard&failedCopy=true'); await start(); await finish()
    await page.waitForFunction(() => (window as any).__voiceFixture.calls.some((call: any) => call.method === 'copyVoiceText'))
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    await expectDOM(page.getByText('Synthetic clipboard denial', { exact: true })).toBeVisible()
  }, timeout)

  it('the explicit trailing-space preference applies to both current draft and clipboard completion', async () => {
    await load('trailingSpace=true'); await start(); await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph. ')
    await load('delivery=clipboard&trailingSpace=true'); await start(); await finish()
    await page.waitForFunction(() => (window as any).__voiceFixture.calls.some((call: any) => call.method === 'copyVoiceText'))
    expect((await calls()).find(call => call.method === 'copyVoiceText')?.args).toEqual({ text: 'Synthetic first paragraph.\n\nSynthetic second paragraph. ' })
  }, timeout)

  const learning = () => page.evaluate(() => {
    const state = (window as any).__voiceFixture.learning
    return { signals: state.signals, accepted: state.accepted, handoffs: state.handoffs,
      targets: [...state.targets.values()], capabilities: [...state.capabilities.entries()] }
  })

  it('learning observes only actual draft insertion, scoped target and balanced native handoff without transcript content', async () => {
    await load('learning=true&compact=true'); await start(); await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
    const observed = await learning()
    expect(observed.targets).toEqual([{ variant: 'compact', workspaceId: 'voice-workspace', panelId: 'voice-panel' }])
    expect(observed.capabilities).toEqual([['voice.available', { state: 'ready' }]])
    expect(observed.handoffs).toEqual([{ open: true, runToken: 'voice-original-attempt' }, { open: false, runToken: 'voice-original-attempt' }])
    expect(observed.signals).toHaveLength(1)
    expect(observed.signals[0]).toMatchObject({ name: 'dictation.inserted', level: 'observed', origin: 'native-event',
      binding: { workspaceId: 'voice-workspace', panelId: 'voice-panel', sessionId: 'voice-session', runToken: 'voice-original-attempt' } })
    expect(observed.accepted).toHaveLength(1)
    expect(JSON.stringify(observed)).not.toContain('Synthetic first paragraph')
    expect((await calls()).filter(call => call.method === 'stopVoiceCapture')).toHaveLength(1)
  }, timeout)

  it('learning never verifies consent refusal, capture refusal, no speech, cancellation or clipboard-only completion', async () => {
    await load('learning=true&consent=false'); await start(); await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await learning()).signals).toEqual([]); expect((await learning()).handoffs).toEqual([])
    expect((await calls()).filter(call => call.method === 'getUserMedia')).toEqual([])
    await load('learning=true&refusedStart=true'); await hotkey('ptt-down'); await waitForCall('stopTrack')
    expect((await learning()).signals).toEqual([])
    expect((await learning()).handoffs.map(item => item.open)).toEqual([true, false])
    await load('learning=true&noSpeech=true'); await start(); await finish()
    await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled()
    expect((await learning()).signals).toEqual([])
    await load('learning=true'); await start(); await hotkey('cancel'); await waitForCall('cancelVoiceCapture')
    expect((await learning()).signals).toEqual([])
    await load('learning=true&delivery=clipboard'); await start(); await finish(); await waitForCall('copyVoiceText')
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    expect((await learning()).signals).toEqual([])
  }, timeout)

  it('late STOP retains its original observation and disabled learning leaves successful dictation uninstrumented', async () => {
    await load('learning=true&deferredStop=true'); await start(); await finish(); await waitForCall('stopVoiceCapture')
    await page.evaluate(() => { const f = (window as any).__voiceFixture; f.changeAttempt(); f.resolveStop() })
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
    expect((await learning()).signals[0].binding.runToken).toBe('voice-original-attempt')
    expect((await learning()).accepted).toEqual([])
    await load('learning=true&deferredStop=true'); await start(); await finish(); await waitForCall('stopVoiceCapture')
    await page.evaluate(() => (window as any).__voiceFixture.unmount()); await waitForCall('cancelVoiceCapture')
    await page.evaluate(() => (window as any).__voiceFixture.resolveStop()); await page.waitForTimeout(25)
    expect((await learning()).signals).toEqual([]); expect((await learning()).targets).toEqual([])
    await load(); await start(); await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
    expect(await learning()).toEqual({ signals: [], accepted: [], handoffs: [], targets: [], capabilities: [] })
  }, timeout)

})
