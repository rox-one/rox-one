import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/auth-profile')
const executablePath = await resolveChromiumExecutable()
const url = 'http://127.0.0.1:5196'
const proof = process.env.AUTH_PROFILE_PROOF_DIR

describe.skipIf(!existsSync(executablePath))('authentication and profile production renderer', () => {
  let server: ReturnType<typeof Bun.spawn>
  let browser: Browser
  let page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5196'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30_000
    for (;;) {
      try { if ((await fetch(url)).ok) break } catch {}
      if (Date.now() > deadline) throw new Error('Auth renderer fixture did not start')
      await Bun.sleep(100)
    }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
    const warmup = await browser.newPage(); warmup.on('pageerror', error => console.error('Fixture warmup:', error.message)); await warmup.goto(url); await expectDOM(warmup.getByTestId('status')).toHaveText('idle', { timeout: 30_000 }); await warmup.close()
    if (proof) mkdirSync(proof, { recursive: true })
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 880, height: 960 } }); page.on('pageerror', error => errors.push(error.message)) }, 30_000)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, 30_000)
  afterAll(async () => { server?.kill(); try { await browser?.close() } finally { await server?.exited } }, 30_000)
  const calls = (method: string) => page.evaluate(value => (window as any).__authFixture.calls.filter((call: any) => call.method === value), method)
  const capture = async (name: string) => {
    if (!proof) return
    await page.screenshot({ path: resolve(proof, `auth-profile-${name}.png`), fullPage: true })
    writeFileSync(resolve(proof, `auth-profile-${name}.json`), JSON.stringify({ calls: await page.evaluate(() => (window as any).__authFixture.calls), pageErrors: errors }, null, 2))
  }
  it('keeps approval polling when automatic/manual browser launch fails', async () => {
    await page.goto(`${url}/?outcome=browser-failed`)
    await page.getByRole('button', { name: 'Connect with Rox', exact: true }).click()
    await expectDOM(page.getByTestId('status')).toHaveText('waiting')
    await expectDOM(page.getByText('https://auth.example.test/device?code=TEST-CODE', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open browser to approve', exact: true }).click()
    await expectDOM(page.getByTestId('status')).toHaveText('waiting')
    await page.evaluate(() => (window as any).__authFixture.approve())
    await expectDOM(page.getByTestId('status')).toHaveText('success')
    await expectDOM(page.getByTestId('step')).toHaveText('provider-select')
    const before = (await calls('getRoxCloudState')).length
    await page.waitForTimeout(2200)
    expect((await calls('getRoxCloudState')).length).toBe(before)
    await capture('browser-fallback')
  }, 30_000)
  it('continues when the Clipboard API is absent', async () => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
    await page.goto(url)
    await page.getByRole('button', { name: 'Connect with Rox', exact: true }).click()
    await expectDOM(page.getByTestId('status')).toHaveText('waiting')
    await expectDOM(page.getByText('TEST-CODE', { exact: true })).toBeVisible()
  }, 30_000)
  it('retries a failed start and clears the previous failure', async () => {
    await page.goto(`${url}/?outcome=start-failed`)
    await page.getByRole('button', { name: 'Connect with Rox', exact: true }).click()
    await expectDOM(page.getByTestId('status')).toHaveText('error')
    await page.getByRole('button', { name: 'Connect with Rox', exact: true }).click()
    await expectDOM(page.getByTestId('status')).toHaveText('waiting')
    await expectDOM(page.getByText('synthetic-device-start-failure')).toHaveCount(0)
    expect(await calls('startRoxConnect')).toHaveLength(2)
  }, 30_000)
  it('ignores a late device start from an older attempt', async () => {
    await page.goto(`${url}/?outcome=deferred-start`)
    await page.getByRole('button', { name: 'Connect with Rox', exact: true }).click()
    await page.evaluate(() => { void (window as any).__authFixture.start() })
    await page.evaluate(() => (window as any).__authFixture.resolveStart(1, 'NEW-CODE'))
    await expectDOM(page.getByText('NEW-CODE', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__authFixture.resolveStart(0, 'OLD-CODE'))
    await expectDOM(page.getByText('OLD-CODE', { exact: true })).toHaveCount(0)
    expect((await calls('openUrl')).map((call: any) => call.args)).toEqual(['https://auth.example.test/device?code=NEW-CODE'])
  }, 30_000)
  it('creates an authenticated profile, normalizes the name, and advances exactly once', async () => {
    await page.goto(`${url}/?mode=welcome`)
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('  A\u0301da   Native  ')
    await page.getByRole('button', { name: 'Get Started', exact: true }).click()
    await expectDOM(page.getByTestId('continued')).toHaveText('true')
    expect((await calls('updateOrgIdentity')).map((call: any) => call.args)).toEqual([{ name: '\u00c1da Native' }])
    expect(await calls('continued')).toHaveLength(1)
    await capture('created')
  }, 30_000)
  it('keeps the draft after a failed profile save and allows a successful retry', async () => {
    await page.goto(`${url}/?mode=welcome&outcome=save-failed`)
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('Ada Native')
    await page.getByRole('button', { name: 'Get Started', exact: true }).click()
    await expectDOM(page.getByTestId('continued')).toHaveText('false')
    await expectDOM(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue('Ada Native')
    await expectDOM(page.getByText('Could not save the username. Try again.', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__authFixture.setOutcome('ok'))
    await page.getByRole('button', { name: 'Get Started', exact: true }).click()
    await expectDOM(page.getByTestId('continued')).toHaveText('true')
    expect(await calls('continued')).toHaveLength(1)
    await capture('retried')
  }, 30_000)
  it('edits and saves the profile even when the XP service fails', async () => {
    await page.goto(`${url}/?mode=account&outcome=xp-failed`)
    await expectDOM(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Existing Ada')
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Edited Ada')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await calls('identityUpdateProfile')).map((call: any) => call.args)).toEqual([{ displayName: 'Edited Ada', email: 'ada@example.test' }])
    await expectDOM(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Edited Ada')
    await capture('account-xp-unavailable')
  }, 30_000)
  it('offers a retry after a profile read fails and saves the recovered draft', async () => {
    await page.goto(`${url}/?mode=account&outcome=read-failed`)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expectDOM(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Existing Ada')
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Recovered Ada')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect(await calls('identityUpdateProfile')).toHaveLength(1)
    await capture('account-retried')
  }, 30_000)

})
