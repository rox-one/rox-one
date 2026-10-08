import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/quests')
const url = 'http://127.0.0.1:5296'
const executablePath = await resolveChromiumExecutable()
const proofDirectory = process.env.QUEST_PROOF_DIR
const timeout = 30_000

describe.skipIf(!existsSync(executablePath))('production quest cards in Chromium', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined, browser: Browser, page: Page
  const errors: string[] = []
  const stop = async () => { const owned = server; server = undefined; owned?.kill(); try { await browser?.close() } finally { await owned?.exited } }
  beforeAll(async () => {
    try {
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5296'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + timeout
      for (;;) { if (server.exitCode !== null) throw Error('Owned quest fixture exited'); try { if ((await fetch(url)).ok) break } catch {} if (Date.now() > deadline) throw Error('Quest fixture startup timeout'); await Bun.sleep(100) }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
      const warmup = await browser.newPage(); warmup.on('pageerror', error => console.error('Quest fixture warmup:', error.message)); await warmup.goto(url)
      await expectDOM(warmup.getByTestId('quest-progress-card')).toBeVisible({ timeout }); await warmup.close()
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) { await stop(); throw error }
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1200, height: 900 } }); page.on('pageerror', error => errors.push(error.message)) }, timeout)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, timeout)
  afterAll(stop, timeout)
  const load = async (query = '') => { await page.goto(`${url}/?case=${encodeURIComponent(Math.random().toString())}&${query}`); await expectDOM(page.getByTestId('quest-progress-card')).toBeVisible() }
  const actions = () => page.evaluate(() => (window as any).__questFixture.calls.filter((call: any) => call.method === 'act'))
  const doneNote = () => page.getByRole('button', { name: 'Done: Write a first note', exact: true })

  it('shows three distinct icon cards and a personal competition from actual supplied XP', async () => {
    await load(); await expectDOM(page.locator('article[data-quest-id]')).toHaveCount(3)
    const colors = await page.locator('article[data-quest-id]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderColor))
    expect(new Set(colors).size).toBe(3)
    await expectDOM(page.getByRole('progressbar', { name: 'Beat your previous week' })).toHaveAttribute('aria-valuenow', '60')
    await expectDOM(page.getByText('30 XP / 50 XP', { exact: true })).toBeVisible()
    await expectDOM(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
    if (proofDirectory) await page.screenshot({ path: resolve(proofDirectory, 'quest-cards-desktop.png') })
  }, timeout)
  it('completes a quest, increases real displayed progress, and retains achievement after browser reload', async () => {
    await load(); await doneNote().click(); await expectDOM(page.locator('article[data-quest-id="first_note"]')).toHaveCount(0)
    await expectDOM(page.getByText('150 XP', { exact: true })).toBeVisible(); expect(await actions()).toHaveLength(1)
    await page.getByRole('button', { name: /Achievements/ }).click(); await expectDOM(page.locator('article[data-quest-id="first_note"]')).toBeVisible()
    await page.reload(); await page.getByRole('button', { name: /Achievements/ }).click(); await expectDOM(page.locator('article[data-quest-id="first_note"]')).toBeVisible()
  }, timeout)
  it('disables every quest action while a pending completion prevents repeated clicks', async () => {
    await load('deferredAction=true'); await doneNote().click()
    await expectDOM(page.getByRole('button', { name: 'Done: Link two notes', exact: true })).toBeDisabled()
    await page.evaluate(() => (document.querySelector('[data-quest-id="first_note"] button') as HTMLButtonElement).click())
    expect(await actions()).toHaveLength(1); await page.evaluate(() => (window as any).__questFixture.resolveAction())
    await expectDOM(page.locator('article[data-quest-id="first_note"]')).toHaveCount(0)
  }, timeout)
  it('retains playable cards on a failed action and retry performs that same action', async () => {
    await load('actionFail=true'); await doneNote().click(); await expectDOM(page.getByRole('alert')).toContainText('This quest was not updated')
    await expectDOM(doneNote()).toBeEnabled(); await page.getByRole('alert').getByRole('button').click()
    await expectDOM(page.locator('article[data-quest-id="first_note"]')).toHaveCount(0); expect(await actions()).toHaveLength(2)
  }, timeout)
  it('recovers an initial unavailable profile without pretending an empty quest board', async () => {
    await load('loadFail=true'); await expectDOM(page.getByRole('alert')).toContainText('Your progress could not be loaded')
    await expectDOM(page.getByRole('progressbar')).toHaveCount(0); await page.getByRole('alert').getByRole('button').click()
    await expectDOM(page.getByRole('progressbar')).toHaveCount(2); await expectDOM(doneNote()).toBeEnabled()
  }, timeout)
  it('persists snooze and dismiss without XP and keeps the snoozed deadline visible', async () => {
    await load(); await page.getByRole('button', { name: 'Later: Write a first note', exact: true }).click()
    await page.getByRole('button', { name: 'Dismiss: Link two notes', exact: true }).click(); await page.reload()
    await expectDOM(page.getByText('135 XP', { exact: true })).toBeVisible(); await expectDOM(page.locator('article[data-quest-id="first_link"]')).toHaveCount(0)
    await page.getByRole('button', { name: /Saved for later/ }).click(); await expectDOM(page.locator('article[data-quest-id="first_note"]')).toContainText('Available')
    await expectDOM(doneNote()).toHaveCount(0)
  }, timeout)
  it('keeps levels and weekly competition available after every quest is completed', async () => {
    await load('complete=true'); await expectDOM(page.getByTestId('quest-progress-card-empty')).toBeVisible(); await expectDOM(page.getByRole('progressbar')).toHaveCount(2)
    await page.getByRole('button', { name: /Achievements/ }).click(); await expectDOM(page.locator('article[data-quest-id]')).toHaveCount(3)
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await expectDOM(page.locator('article[data-quest-id]')).toHaveCount(3)
  }, timeout)
  it('fits 320px and supports keyboard focus and activation', async () => {
    await page.setViewportSize({ width: 320, height: 800 }); await load()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: /Achievements/ }).focus(); await page.keyboard.press('Enter')
    await expectDOM(page.getByRole('button', { name: /Achievements/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /Ready to play/ }).click()
    if (proofDirectory) await page.screenshot({ path: resolve(proofDirectory, 'quest-cards-320px.png'), fullPage: true })
  }, timeout)
  it('ignores old replies after A → B → A workspace changes', async () => {
    await page.goto(`${url}/?deferredLoad=true`)
    await page.evaluate(() => (window as any).__questFixture.switchScope('B')); await expectDOM(page.getByText('0 XP', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__questFixture.switchScope('A')); await expectDOM(page.getByText('135 XP', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__questFixture.resolveLoad()); await page.waitForTimeout(30)
    await expectDOM(page.getByText('135 XP', { exact: true })).toBeVisible(); await expectDOM(page.getByText('999 XP', { exact: true })).toHaveCount(0)
  }, timeout)
  it('does not refresh or repaint after a pending action resolves following unmount', async () => {
    await load('deferredAction=true'); await doneNote().click()
    const before = await page.evaluate(() => (window as any).__questFixture.calls.filter((call: any) => call.method === 'get').length)
    await page.evaluate(() => (window as any).__questFixture.unmount())
    // The fixture requests removal through React state. Confirm that removal
    // committed before resolving the reply whose lifetime is being tested.
    await expectDOM(page.getByTestId('quest-progress-card')).toHaveCount(0)
    await page.evaluate(() => (window as any).__questFixture.resolveAction()); await page.waitForTimeout(30)
    expect(await page.evaluate(() => (window as any).__questFixture.calls.filter((call: any) => call.method === 'get').length)).toBe(before)
    await expectDOM(page.getByTestId('quest-progress-card')).toHaveCount(0)
  }, timeout)
})
