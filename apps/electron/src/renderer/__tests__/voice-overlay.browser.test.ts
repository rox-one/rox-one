import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
const repository = resolve(import.meta.dirname, '../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/voice-overlay')
const url = 'http://127.0.0.1:5309'
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const proofDirectory = process.env.VOICE_OVERLAY_PROOF_DIR
const timeout = 30_000

describe.skipIf(!existsSync(executablePath))('owned voice overlay production renderer DOM', () => {
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
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5309'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
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
      await expectDOM(warmup.locator('#root')).toBeAttached({ timeout })
      await warmup.waitForFunction(() => (window as any).__overlayFixture?.subscriptions() === 1)
      await warmup.close()
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) { await stop(); throw error }
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.on('pageerror', (error) => errors.push(error.message)) }, timeout)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, timeout)
  afterAll(stop, timeout)
  const overlayCalls = () => page.evaluate(() => (window as any).__overlayFixture.calls as string[])
  const publish = async (phase: string, elapsedMs = 1345) => page.evaluate(({ phase, elapsedMs }) => (window as any).__overlayFixture.publish({ recordingId: 'owned-recording', phase, elapsedMs, rms: 0, streaming: false }), { phase, elapsedMs })
  const load = async () => { await page.goto(url); await page.waitForFunction(() => (window as any).__overlayFixture?.subscriptions() === 1) }
  it('private host states display the actual phase and elapsed time; stop routes once through the owned bridge', async () => {
    await load(); await publish('recording')
    await expectDOM(page.getByText('Recording', { exact: true })).toBeVisible()
    await expectDOM(page.getByText('0:01', { exact: true })).toBeVisible()
    if (proofDirectory) await page.screenshot({ path: join(proofDirectory, 'owned-recording.png') })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expectDOM(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
    expect(await overlayCalls()).toEqual(['stop'])
    await publish('transcribing')
    await expectDOM(page.getByText('Transcribing', { exact: true })).toBeVisible()
    await expectDOM(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await overlayCalls()).toEqual(['stop', 'cancel'])
  }, timeout)
  it('permission and terminal phases restrict commands and hidden state removes the surface', async () => {
    await load(); await publish('permission')
    await expectDOM(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await overlayCalls()).toEqual(['cancel'])
    await publish('ready')
    await expectDOM(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await publish('hidden'); await expectDOM(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  }, timeout)
  it('a refused native command displays a failure and preserves the actual current state', async () => {
    await load(); await publish('recording')
    await page.evaluate(() => (window as any).__overlayFixture.deny())
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expectDOM(page.getByRole('alert')).toHaveText('Error')
    await expectDOM(page.getByText('Recording', { exact: true })).toBeVisible()
    expect(await overlayCalls()).toEqual(['stop'])
  }, timeout)
})
