import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/voice-history')
const url = 'http://127.0.0.1:5299'
const executablePath = await resolveChromiumExecutable()
const proofDirectory = process.env.VOICE_HISTORY_PROOF_DIR
const timeout = 30_000

describe.skipIf(!existsSync(executablePath))('voice history production renderer DOM', () => {
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
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5299'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
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
      await expectDOM(warmup.getByRole('textbox', { name: 'Search transcripts', exact: true })).toBeEnabled({ timeout })
      await warmup.close()
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) { await stop(); throw error }
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.on('pageerror', (error) => errors.push(error.message)) }, timeout)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, timeout)
  afterAll(stop, timeout)
  const calls = () => page.evaluate(() => (window as any).__historyFixture.calls as Array<{ method: string; args?: unknown }>)
  const load = async (query = '') => { await page.goto(`${url}/?${query}`); await expectDOM(page.getByRole('textbox', { name: 'Search transcripts', exact: true })).toBeEnabled() }

  const open = async (id = 'recording-one') => { await page.getByRole('button', { name: id, exact: true }).click(); await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).toBeVisible() }
  it('searches current transcript history and opens the owned detail', async () => {
    await load(); await page.getByRole('textbox', { name: 'Search transcripts' }).fill('Second')
    await expectDOM(page.getByRole('button', { name: 'recording-one', exact: true })).not.toBeVisible()
    await open('recording-two'); await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveValue('Second transcript')
    expect((await calls()).find(call => call.method === 'listVoiceHistory' && (call.args as any).search === 'Second')).toBeDefined()
  }, timeout)
  it('appends a manual revision then selects the original without mutating its text', async () => {
    await load(); await open()
    await page.getByRole('textbox', { name: 'Transcript', exact: true }).fill('Edited archive text')
    await page.getByRole('button', { name: 'Save as new revision' }).click()
    await expectDOM(page.getByRole('combobox', { name: 'Transcript revision' })).toHaveValue('manual-revision')
    await page.getByRole('combobox', { name: 'Transcript revision' }).selectOption('revision-0')
    await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveValue('Original first transcript')
    expect((await calls()).find(call => call.method === 'editVoiceTranscript')?.args).toEqual({ id: 'recording-one', expectedRevisionId: 'revision-0', text: 'Edited archive text' })
    expect((await calls()).find(call => call.method === 'selectVoiceTranscript')?.args).toEqual({ id: 'recording-one', expectedRevisionId: 'manual-revision', revisionId: 'revision-0' })
  }, timeout)
  it('rejects stale editing visibly and preserves the unsaved draft for recovery', async () => {
    await load('staleEdit=true'); await open(); await page.getByRole('textbox', { name: 'Transcript', exact: true }).fill('Unsaved draft')
    await page.getByRole('button', { name: 'Save as new revision' }).click()
    await expectDOM(page.getByRole('alert')).toBeVisible()
    await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveValue('Unsaved draft')
    await expectDOM(page.getByRole('combobox', { name: 'Transcript revision' })).toHaveValue('revision-0')
  }, timeout)
  it('copies only an explicit current transcript through the native port without touching the OS clipboard', async () => {
    await load(); await open(); await page.getByRole('textbox', { name: 'Transcript', exact: true }).fill('Explicit unsaved copy')
    await page.getByRole('button', { name: 'Copy transcript' }).click()
    await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveValue('Explicit unsaved copy')
    expect((await calls()).filter(call => call.method === 'copyVoiceText')).toEqual([{ method: 'copyVoiceText', args: { text: 'Explicit unsaved copy' } }])
  }, timeout)
  it('downloads complete TXT, JSON and SRT exports from the current scoped API', async () => {
    await load(); await open()
    for (const format of ['txt', 'json', 'srt']) {
      const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: `Export ${format.toUpperCase()}`, exact: true }).click()
      const download = await downloading; const path = await download.path()
      const contents = readFileSync(path!, 'utf8')
      expect(contents).toContain('Original first transcript'); expect(contents).not.toContain('PRIVATE')
      if (format === 'json') expect(JSON.parse(contents).recording.audioPath).toBe('')
      if (format === 'srt') expect(contents).toContain('00:00:00,000 --> 00:00:01,000')
      await expectDOM(page.getByRole('button', { name: 'Save as new revision' })).toBeEnabled()
    }
  }, timeout)
  it('plays verified synthetic WAV audio and revokes the owned playback URL when another recording opens', async () => {
    await load(); await open(); await page.getByRole('button', { name: 'Play recording' }).click()
    await expectDOM(page.locator('audio')).toBeVisible()
    await page.waitForFunction(() => (document.querySelector('audio')?.readyState ?? 0) >= 2)
    expect((await calls()).find(call => call.method === 'readVoiceRecordingAudio')?.args).toEqual({ id: 'recording-one', offset: 0, token: undefined })
    await open('recording-two'); await expectDOM(page.locator('audio')).not.toBeVisible()
    expect((await calls()).some(call => call.method === 'revokeObjectURL')).toBe(true)
  }, timeout)
  it('confirms deletion and removes the actual list/detail only after the scoped delete succeeds', async () => {
    await load(); await open(); await page.getByRole('button', { name: 'Delete recording', exact: true }).click()
    expect((await calls()).filter(call => call.method === 'deleteVoiceRecording')).toHaveLength(0)
    await page.getByRole('alert').getByRole('button', { name: 'Delete recording', exact: true }).click()
    await expectDOM(page.getByRole('button', { name: 'recording-one', exact: true })).not.toBeVisible()
    await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).not.toBeVisible()
    expect((await calls()).filter(call => call.method === 'deleteVoiceRecording')).toEqual([{ method: 'deleteVoiceRecording', args: { id: 'recording-one' } }])
  }, timeout)
  it('ignores a previous recording detail that arrives after a different recording opens', async () => {
    await load('deferredDetail=true'); await page.getByRole('button', { name: 'recording-one', exact: true }).click(); await open('recording-two')
    await page.evaluate(() => (window as any).__historyFixture.resolveDetail()); await page.waitForTimeout(25)
    await expectDOM(page.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveValue('Second transcript')
  }, timeout)
  it('unmounting during audio retrieval prevents late playback URL creation and disposes subscriptions', async () => {
    await load('deferredAudio=true'); await open(); await page.getByRole('button', { name: 'Play recording' }).click()
    await page.waitForFunction(() => (window as any).__historyFixture.calls.some((call: any) => call.method === 'readVoiceRecordingAudio'))
    await page.evaluate(() => { const fixture = (window as any).__historyFixture; fixture.unmount(); fixture.resolveAudio() }); await page.waitForTimeout(25)
    expect((await calls()).filter(call => call.method === 'createObjectURL')).toHaveLength(0)
    expect((await calls()).some(call => call.method === 'unsubscribe')).toBe(true)
  }, timeout)
  it('fails closed on the web runtime and shows list failures as errors, never an empty history success', async () => {
    await load('runtime=web'); expect((await calls()).filter(call => call.method === 'listVoiceHistory')).toHaveLength(0)
    await expectDOM(page.getByRole('alert')).toBeVisible()
    await load('failedList=true'); await expectDOM(page.getByRole('alert')).toBeVisible()
    await expectDOM(page.getByText('No dictations yet.', { exact: true })).not.toBeVisible()
  }, timeout)
})
