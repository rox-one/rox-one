import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/voice-dictation')
const url = 'http://127.0.0.1:5298'
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const proofDirectory = process.env.VOICE_DICTATION_PROOF_DIR
const timeout = 30_000

describe.skipIf(!existsSync(executablePath))('voice dictation production renderer DOM', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let page: Page
  const errors: string[] = []
  const stop = async () => {
    const owned = server; server = undefined; owned?.kill()
    try { await browser?.close() } finally { await owned?.exited }
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
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
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

  it('unmount stops microphone tracks while permission is pending and its late grant cannot start a recorder', async () => {
    await load('deferredGrant=true'); await start()
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'grantVoicePermission').length).toBe(1)
    expect((await calls()).filter((call) => call.method === 'recorderStart')).toHaveLength(0)
    await page.evaluate(() => (window as any).__voiceFixture.unmount())
    await expectDOM(page.getByRole('button', { name: 'Loading…', exact: true })).toHaveCount(0)
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'stopTrack').length).toBeGreaterThan(0)
    expect((await calls()).filter((call) => call.method === 'cancelVoiceCapture')).toHaveLength(1)
    await page.evaluate(async () => {
      ;(window as any).__voiceFixture.resolveGrant()
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
    const afterGrant = await calls()
    expect(afterGrant.filter((call) => call.method === 'recorderStart')).toHaveLength(0)
    expect(afterGrant.filter((call) => ['sendVoiceChunk', 'stopVoiceCapture', 'transcribeVoice'].includes(call.method))).toHaveLength(0)
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
  }, timeout)

  it('synchronous double toggle starts only one capture while microphone access is pending', async () => {
    await load('deferredMedia=true')
    await page.getByRole('button', { name: 'Dictate', exact: true }).evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expectDOM(page.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
    const pending = await calls()
    expect(pending.filter((call) => call.method === 'getUserMedia')).toHaveLength(1)
    expect(pending.filter((call) => call.method === 'startVoiceCapture')).toHaveLength(0)
    await page.evaluate(() => (window as any).__voiceFixture.resolveMedia())
    await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    const started = await calls()
    expect(started.filter((call) => call.method === 'getUserMedia')).toHaveLength(1)
    expect(started.filter((call) => call.method === 'startVoiceCapture')).toHaveLength(1)
    expect(started.filter((call) => call.method === 'recorderStart')).toHaveLength(1)
    await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
  }, timeout)

  it('a microphone startup failure restores the enabled control and allows a successful retry', async () => {
    await load('rejectMediaOnce=true'); await start()
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'cancelVoiceCapture').length).toBe(1)
    await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled({ timeout: 2_000 })
    expect((await calls()).filter((call) => call.method === 'startVoiceCapture')).toHaveLength(0)
    await start()
    await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    const retried = await calls()
    expect(retried.filter((call) => call.method === 'getUserMedia')).toHaveLength(2)
    expect(retried.filter((call) => call.method === 'startVoiceCapture')).toHaveLength(1)
    expect(retried.filter((call) => call.method === 'recorderStart')).toHaveLength(1)
    await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
  }, timeout)

  it('a denied CANCEL during idle unmount stays optional and the control can remount', async () => {
    await load('rejectCancel=true')
    await page.evaluate(() => (window as any).__voiceFixture.unmount())
    await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0)
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'cancelVoiceCapture').length).toBe(1)
    await page.waitForTimeout(120)
    expect((await calls()).filter((call) => ['getUserMedia', 'recorderStart', 'sendVoiceChunk'].includes(call.method))).toHaveLength(0)
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    await page.evaluate(() => (window as any).__voiceFixture.remount())
    await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled()
  }, timeout)

  it('a denied CANCEL cannot hide the original startup failure or prevent a successful retry', async () => {
    await load('rejectMediaOnce=true&rejectCancel=true'); await start()
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'cancelVoiceCapture').length).toBe(1)
    await expectDOM(page.locator('[data-sonner-toast]')).toContainText('Synthetic microphone denial')
    await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    await start()
    await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    expect((await calls()).filter((call) => call.method === 'getUserMedia')).toHaveLength(2)
    expect((await calls()).filter((call) => call.method === 'recorderStart')).toHaveLength(1)
    await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
  }, timeout)

  it('a late START after unmount tolerates another denied CANCEL without granting or starting a recorder', async () => {
    await load('deferredStart=true&rejectCancel=true'); await start()
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'startVoiceCapture').length).toBe(1)
    await page.evaluate(() => (window as any).__voiceFixture.unmount())
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'stopTrack').length).toBeGreaterThan(0)
    await page.evaluate(() => (window as any).__voiceFixture.resolveStart())
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'cancelVoiceCapture').length).toBe(2)
    await page.waitForTimeout(120)
    expect((await calls()).filter((call) => ['grantVoicePermission', 'recorderStart', 'sendVoiceChunk', 'stopVoiceCapture'].includes(call.method))).toHaveLength(0)
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
  }, timeout)

  it('a denied user CANCEL stops local recording, discards its audio and allows another capture', async () => {
    await load('rejectCancel=true'); await start()
    await expectDOM(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__voiceFixture.cancel())
    await expectDOM(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled()
    await expectDOM.poll(async () => (await calls()).filter((call) => call.method === 'stopTrack').length).toBeGreaterThan(0)
    await page.waitForTimeout(120)
    const cancelled = await calls()
    expect(cancelled.filter((call) => call.method === 'cancelVoiceCapture')).toHaveLength(1)
    expect(cancelled.filter((call) => ['sendVoiceChunk', 'stopVoiceCapture', 'transcribeVoice'].includes(call.method))).toHaveLength(0)
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft')
    await start(); await finish()
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Existing draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
    expect((await calls()).filter((call) => call.method === 'recorderStart')).toHaveLength(2)
  }, timeout)

  it('uploads audio larger than 4 MiB as exact 1 MiB frames and consumes one STOP transcript into the current draft', async () => {
    await load('largeAudio=true&deferredStop=true'); await start(); await finish()
    await expectDOM.poll(async () => page.evaluate(() => (window as any).__voiceFixture.calls.filter((call: any) => call.method === 'stopVoiceCapture').length)).toBe(1)
    await page.getByRole('textbox', { name: 'Draft' }).fill('Large recording edited draft')
    const upload = await page.evaluate(() => {
      const fixture = (window as any).__voiceFixture
      const frames = fixture.calls.filter((call: any) => call.method === 'sendVoiceChunk')
        .map((call: any) => atob(call.args.audioBase64)) as string[]
      let total = 0
      let exact = true
      for (const frame of frames) {
        for (let index = 0; index < frame.length; index++) {
          if (frame.charCodeAt(index) !== (total + index) % 251) exact = false
        }
        total += frame.length
      }
      return { sizes: frames.map((frame) => frame.length), total, expected: fixture.audioBytes, exact,
        stops: fixture.calls.filter((call: any) => call.method === 'stopVoiceCapture').length,
        asr: fixture.calls.filter((call: any) => call.method === 'asrOnStop').length,
        directAsr: fixture.calls.filter((call: any) => call.method === 'transcribeVoice').length }
    })
    expect(upload.sizes).toEqual([1024 * 1024, 1024 * 1024, 1024 * 1024, 1024 * 1024, 1024 * 1024, 123])
    expect(upload.total).toBe(upload.expected)
    expect(upload.exact).toBe(true)
    expect(upload.stops).toBe(1)
    expect(upload.asr).toBe(1)
    expect(upload.directAsr).toBe(0)
    await page.evaluate(() => (window as any).__voiceFixture.resolveStop())
    await expectDOM(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Large recording edited draft Synthetic first paragraph.\n\nSynthetic second paragraph.')
  }, timeout)
})
