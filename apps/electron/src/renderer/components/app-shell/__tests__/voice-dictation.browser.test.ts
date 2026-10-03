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
})
