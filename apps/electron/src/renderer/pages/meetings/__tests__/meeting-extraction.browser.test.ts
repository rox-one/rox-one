import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/extraction')
const executablePath = await resolveChromiumExecutable()
const url = 'http://127.0.0.1:5202'
const proof = process.env.MEETING_EXTRACTION_PROOF_DIR

describe.skipIf(!existsSync(executablePath))('meeting automatic analysis production renderer', () => {
  let server: ReturnType<typeof Bun.spawn>
  let browser: Browser
  let page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5202'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30_000
    for (;;) { try { if ((await fetch(url)).ok) break } catch {} if (Date.now() > deadline) throw new Error('Meeting renderer fixture did not start'); await Bun.sleep(100) }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
    const warmup = await browser.newPage(); warmup.on('pageerror', (error) => console.error('Meeting fixture warmup:', error.message)); await warmup.goto(url); await expectDOM(warmup.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/, { timeout: 30_000 }); await warmup.close()
    if (proof) mkdirSync(proof, { recursive: true })
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 860, height: 900 } }); page.on('pageerror', (error) => errors.push(error.message)) }, 30_000)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, 30_000)
  afterAll(async () => { server?.kill(); try { await browser?.close() } finally { await server?.exited } }, 30_000)
  const capture = async (name: string) => { if (!proof) return; await page.screenshot({ path: resolve(proof, `meeting-analysis-${name}.png`), fullPage: true }); writeFileSync(resolve(proof, `meeting-analysis-${name}.json`), JSON.stringify({ meeting: await page.evaluate(() => (window as any).__meetingFixture.read()), pageErrors: errors }, null, 2)) }
  const actionsTab = () => page.getByRole('tab', { name: /Tasks|Action/ }).click()
  const decisionsTab = () => page.getByRole('tab', { name: /Decisions/ }).click()

  it('automatically analyses a completed transcript with the workspace model and no source tools', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/)
    const calls = await page.evaluate(() => (window as any).__meetingFixture.calls)
    const create = calls.filter((call: any) => call.method === 'createSession')
    expect(create).toHaveLength(1); expect(create[0].value).toEqual({ workspaceId: 'workspace-1', options: { name: expect.any(String), permissionMode: 'safe', enabledSourceSlugs: [] } })
    expect(calls.find((call: any) => call.method === 'sendMessage').value).toContain('segmentId=s0')
    await actionsTab(); await expectDOM(page.getByRole('checkbox', { name: 'Ada: prepare release notes', exact: true })).toBeVisible()
    await capture('generated-actions')
  }, 30_000)
  it('edits an individual generated task, completes it, and keeps both changes after reload', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/); await actionsTab()
    await page.getByRole('button', { name: /Edit action item|meetings.local.editAction/ }).click()
    const editor = page.getByTestId('meeting-action-editor'); await editor.getByRole('textbox').fill('Ada: review notes Monday'); await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Ada: review notes Monday' }).check()
    await page.reload(); await actionsTab(); await expectDOM(page.getByRole('checkbox', { name: 'Ada: review notes Monday' })).toBeChecked()
    expect(await page.evaluate(() => (window as any).__meetingFixture.read().actions[0].sourceSegmentIds)).toEqual(['s1'])
    expect(await page.evaluate(() => (window as any).__meetingFixture.calls.filter((call: any) => call.method === 'createSession').length)).toBe(0)
    await capture('edited-task')
  }, 30_000)
  it('edits a suggested decision before accepting it, then edits its explanation after acceptance', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/); await decisionsTab()
    await page.getByRole('button', { name: /Edit decision|meetings.local.editDecision/ }).click()
    let editor = page.getByTestId('meeting-decision-editor'); await editor.getByRole('textbox').first().fill('Ship Monday'); await editor.getByRole('textbox').nth(1).fill('Leave time for review'); await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Accept', exact: true }).click(); await expectDOM(page.getByTestId('meeting-decisions').getByText('Ship Monday', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Edit decision|meetings.local.editDecision/ }).click(); editor = page.getByTestId('meeting-decision-editor'); await editor.getByRole('textbox').nth(1).fill('Reviewed with the team'); await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await page.reload(); await decisionsTab(); await expectDOM(page.getByText('Reviewed with the team', { exact: true })).toBeVisible(); await expectDOM(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
    await capture('edited-decision')
  }, 30_000)
  it('keeps a manually edited summary after reload', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/)
    await page.getByTestId('meeting-summary').fill('My final reviewed summary'); await page.getByTestId('meeting-title').click()
    await page.reload(); await expectDOM(page.getByTestId('meeting-summary')).toHaveValue('My final reviewed summary')
    expect(await page.evaluate(() => (window as any).__meetingFixture.read().summary.generated)).toBe(false)
  }, 30_000)
  it('shows a persistent analysis failure and runs a successful explicit retry', async () => {
    await page.goto(`${url}/?outcome=invalid`); await expectDOM(page.getByTestId('meeting-extraction-failure')).toBeVisible()
    await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(''); expect(await page.evaluate(() => (window as any).__meetingFixture.read().actions)).toEqual([])
    await page.evaluate(() => (window as any).__meetingFixture.allowRetry()); await page.getByTestId('meeting-generate-summary').click()
    await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/); await expectDOM(page.getByTestId('meeting-extraction-failure')).toHaveCount(0)
    await capture('retry')
  }, 30_000)
  it('late automatic output cannot overwrite a summary edited while the model was running', async () => {
    await page.goto(`${url}/?outcome=deferred`); await expectDOM(page.getByTestId('meeting-generate-summary')).toBeDisabled()
    await page.getByTestId('meeting-summary').fill('Human notes written during analysis'); await page.getByTestId('meeting-title').click()
    await page.evaluate(() => (window as any).__meetingFixture.finish())
    await expectDOM(page.getByTestId('meeting-summary')).toHaveValue('Human notes written during analysis'); await expectDOM(page.getByTestId('meeting-extraction-failure')).toBeVisible()
    expect(await page.evaluate(() => (window as any).__meetingFixture.read().actions)).toEqual([])
    await capture('late-result-kept')
  }, 30_000)
  it('keeps editing controls within a narrow mobile viewport', async () => {
    await page.setViewportSize({ width: 375, height: 850 }); await page.goto(url); await expectDOM(page.getByTestId('meeting-summary')).toHaveValue(/Ship Friday/); await actionsTab()
    await page.getByRole('button', { name: /Edit action item|meetings.local.editAction/ }).click(); await expectDOM(page.getByTestId('meeting-action-editor').getByRole('button', { name: 'Save', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await capture('narrow-edit')
  }, 30_000)
})
