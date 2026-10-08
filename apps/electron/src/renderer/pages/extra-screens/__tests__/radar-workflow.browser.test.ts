import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'

const repository = resolve(import.meta.dir, '../../../../../../..')
const fixture = resolve(import.meta.dir, 'fixtures/radar')
const url = 'http://127.0.0.1:5204'
const executablePath = await resolveChromiumExecutable()
const proof = process.env.RADAR_PROOF_DIR
type FixtureControls = { calls: { method: string; value: unknown }[]; mode(value: string): void; ageSweep(): void; switchWorkspace(value: string): void; resolveCreate(): void }

describe.skipIf(!existsSync(executablePath))('Radar source and schedule workflow', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let page: Page
  const errors: string[] = []
  beforeAll(async () => {
    if (!process.env.RADAR_EXISTING_FIXTURE) server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5204'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30_000
    for (;;) {
      try { if ((await fetch(url)).ok) break } catch { /* Wait for the owned fixture. */ }
      if (Date.now() > deadline) throw new Error('Radar fixture did not start')
      await Bun.sleep(100)
    }
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
    if (proof) mkdirSync(proof, { recursive: true })
  }, 60_000)
  beforeEach(async () => {
    errors.length = 0
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await expectDOM(page.getByTestId('radar-setup')).toBeVisible({ timeout: 30_000 })
  }, 60_000)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page.close() } }, 30_000)
  afterAll(async () => { server?.kill('SIGKILL'); await Promise.race([browser?.close().catch(() => {}), Bun.sleep(5000)]); await server?.exited }, 30_000)
  const capture = async (name: string) => {
    if (!proof) return
    await page.screenshot({ path: resolve(proof, `radar-${name}.png`), fullPage: true })
    writeFileSync(resolve(proof, `radar-${name}.json`), JSON.stringify({ pageErrors: errors, calls: await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.calls) }, null, 2))
  }
  // Leaving an explicit item route returns to the overview, exactly like the workbench rail does.
  const backToOverview = async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('rox-navigate', { detail: { route: 'radar' } })))
    await expectDOM(page.getByTestId('radar-setup')).toBeVisible({ timeout: 15_000 })
  }
  const addTopic = async () => {
    await page.getByTestId('radar-setup').getByRole('button', { name: 'Topic', exact: true }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Rox releases')
    await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter')
    await backToOverview()
  }
  test('topic, keywords, explicit sources and daily hour survive reload', async () => {
    await page.getByRole('combobox', { name: 'Daily sweep time', exact: true }).selectOption('11')
    await addTopic()
    await page.getByTestId('radar-setup').getByRole('button', { name: 'Rox releases', exact: true }).click()
    await page.getByRole('textbox', { name: 'Word or phrase', exact: true }).fill('release notes')
    await page.getByRole('textbox', { name: 'Word or phrase', exact: true }).press('Enter')
    await page.getByRole('checkbox', { name: 'Exa', exact: true }).uncheck()
    await expectDOM(page.getByRole('checkbox', { name: 'Disconnected search', exact: true })).toBeDisabled()
    await backToOverview()
    await page.reload()
    await expectDOM(page.getByRole('combobox', { name: 'Daily sweep time', exact: true })).toHaveValue('11')
    await expectDOM(page.getByRole('switch', { name: 'Daily sweep', exact: true })).toBeChecked()
    await page.getByTestId('radar-setup').getByRole('button', { name: 'Rox releases', exact: true }).click()
    await expectDOM(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Rox releases')
    await expectDOM(page.getByRole('button', { name: 'release notes', exact: true })).toBeVisible()
    await expectDOM(page.getByRole('checkbox', { name: 'Brave Search', exact: true })).toBeChecked()
    await expectDOM(page.getByRole('checkbox', { name: 'Exa', exact: true })).not.toBeChecked()
    await capture('setup-wide')
  }, 30_000)
  test('a real-shaped agent response displays source/date and distinct buckets; its source link opens the recorded URL', async () => {
    await addTopic()
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expectDOM(page.getByText('Synthetic source-backed release', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expectDOM(page.locator('[data-radar-bucket="reaction"]')).toContainText('Brave Search')
    await expectDOM(page.locator('[data-radar-bucket="important"]')).toContainText('Exa')
    await page.getByText('Synthetic source-backed release', { exact: true }).click()
    await expectDOM(page.getByTestId('radar-item-date')).toContainText('Published')
    await page.getByRole('button', { name: 'https://example.test/release', exact: true }).click()
    expect(await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.calls.filter(call => call.method === 'openUrl').map(call => call.value))).toEqual(['https://example.test/release'])
    await capture('digest-wide')
    await page.setViewportSize({ width: 320, height: 900 })
    await page.getByTestId('radar-item-date').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await capture('digest-320')
  }, 30_000)
  test('a finished empty response is an error and retry loads a new source-backed digest', async () => {
    await addTopic()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.mode('empty'))
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.ageSweep())
    await expectDOM(page.getByRole('button', { name: 'Retry sweep', exact: true })).toBeEnabled({ timeout: 15_000 })
    await expectDOM(page.getByRole('alert')).toContainText('finished without a digest')
    await capture('empty-error')
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.mode('success'))
    await page.getByRole('button', { name: 'Retry sweep', exact: true }).click()
    await expectDOM(page.getByText('Synthetic source-backed release', { exact: true })).toBeVisible({ timeout: 15_000 })
    expect(await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.calls.filter(call => call.method === 'createSession').length)).toBe(2)
  }, 30_000)
  test('startup failure is visible and can be retried without abandoning setup', async () => {
    await addTopic()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.mode('start-failed'))
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expectDOM(page.getByRole('alert').first()).toContainText('could not start')
    await expectDOM(page.getByRole('button', { name: 'Retry sweep', exact: true })).toBeEnabled()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.mode('success'))
    await page.getByRole('button', { name: 'Retry sweep', exact: true }).click()
    await expectDOM(page.getByText('Synthetic source-backed release', { exact: true })).toBeVisible({ timeout: 15_000 })
  }, 30_000)
  test('running state blocks duplicate starts and setup/digest fit a 320px viewport', async () => {
    await page.setViewportSize({ width: 320, height: 900 }); await addTopic()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.mode('running'))
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expectDOM(page.getByRole('status')).toContainText('building the digest')
    await expectDOM(page.getByRole('button', { name: 'Starting…', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await capture('running-320')
  }, 30_000)
  test('a deferred start from an earlier A→B→A visit never sends its prompt', async () => {
    await addTopic()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.mode('deferred'))
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expectDOM.poll(() => page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.calls.filter(call => call.method === 'createSession').length)).toBe(1)
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.switchWorkspace('workspace-B'))
    await expectDOM(page.getByRole('button', { name: 'Run now', exact: true })).toBeDisabled()
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.switchWorkspace('workspace-A'))
    await expectDOM(page.getByTestId('radar-setup')).toContainText('Rox releases')
    await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.resolveCreate())
    await expectDOM(page.getByRole('button', { name: 'Run now', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => (window as unknown as { __radarFixture: FixtureControls }).__radarFixture.calls.filter(call => call.method === 'sendMessage'))).toEqual([])
  }, 30_000)
})
