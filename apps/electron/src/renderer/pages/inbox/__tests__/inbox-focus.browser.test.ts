import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/focus')
const executablePath = await resolveChromiumExecutable()
const url = 'http://127.0.0.1:5203'
const proof = process.env.INBOX_FOCUS_PROOF_DIR

describe.skipIf(!existsSync(executablePath))('Inbox foreground and real source actions', () => {
  let server: ReturnType<typeof Bun.spawn>
  let browser: Browser
  let page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5203'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30_000
    for (;;) { try { if ((await fetch(url)).ok) break } catch {} if (Date.now() > deadline) throw new Error('Inbox fixture did not start'); await Bun.sleep(100) }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
    const warmup = await browser.newPage(); warmup.on('pageerror', (error) => console.error('Inbox warmup:', error.message)); await warmup.goto(`${url}/?mode=empty`); await expectDOM(warmup.getByTestId('inbox-empty')).toBeVisible({ timeout: 30_000 }); await warmup.close()
    if (proof) mkdirSync(proof, { recursive: true })
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.on('pageerror', (error) => errors.push(error.message)) }, 30_000)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, 30_000)
  afterAll(async () => { server?.kill(); try { await browser?.close() } finally { await server?.exited } }, 30_000)
  const capture = async (name: string) => { if (!proof) return; await page.screenshot({ path: resolve(proof, `inbox-focus-${name}.png`), fullPage: true }); writeFileSync(resolve(proof, `inbox-focus-${name}.json`), JSON.stringify({ calls: await page.evaluate(() => (window as any).__inboxFixture.calls), pageErrors: errors }, null, 2)) }
  const sourceCalls = () => page.evaluate(() => (window as any).__inboxFixture.calls.filter((call: any) => call.method === 'listMemoryProposals').length)
  it('opens all incoming items in the main list without an empty selection toolbar or detail pane', async () => {
    await page.goto(url); await expectDOM(page.getByRole('option')).toHaveCount(6)
    await expectDOM(page.getByTestId('inbox-selection-toolbar')).toHaveCount(0); await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    await expectDOM(page.getByRole('switch', { name: 'Select Release reply', exact: true })).toBeVisible()
    await capture('populated')
  }, 30_000)
  it('bulk selection has working switches, preserves a failed read receipt and retries only the failed item', async () => {
    await page.goto(`${url}/?mode=partial-bulk`); await expectDOM(page.getByTestId('inbox-row-reply')).toHaveCount(2)
    await page.getByRole('switch', { name: 'Select Release reply', exact: true }).check(); await page.getByRole('switch', { name: 'Select Review complete', exact: true }).check()
    await page.getByRole('button', { name: 'Mark selected done/read', exact: true }).click(); await expectDOM(page.getByTestId('inbox-row-reply')).toHaveCount(1)
    await expectDOM(page.getByRole('switch', { name: 'Select Review complete', exact: true })).toBeChecked()
    await page.evaluate(() => (window as any).__inboxFixture.retry()); await page.getByRole('button', { name: /Retry failed items/ }).click()
    await expectDOM(page.getByTestId('inbox-row-reply')).toHaveCount(0); await expectDOM(page.getByTestId('inbox-selection-toolbar')).toHaveCount(0)
    const commands = await page.evaluate(() => (window as any).__inboxFixture.calls.filter((call: any) => call.method === 'sessionCommand').map((call: any) => call.value))
    expect(commands).toEqual([{ id: 'session-1', command: { type: 'markRead' } }, { id: 'session-2', command: { type: 'markRead' } }, { id: 'session-2', command: { type: 'markRead' } }])
    await page.reload(); await expectDOM(page.getByTestId('inbox-empty')).toContainText('Inbox zero'); await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    await capture('bulk-retry')
  }, 30_000)
  it('approval uses the actual source action and returns focus to the queue after a saved decision', async () => {
    await page.goto(url); await page.getByTestId('inbox-row-memory').click(); await page.getByRole('button', { name: 'Remember', exact: true }).click()
    await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0); await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__inboxFixture.calls.filter((call: any) => call.method === 'approveMemoryProposal').map((call: any) => call.value))).toEqual([{ workspaceId: 'workspace-A', id: 'proposal-1', scope: 'global' }])
    await page.reload(); await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
  }, 30_000)
  it('shows a source failure instead of Inbox zero, and an actual retry loads incoming items', async () => {
    await page.goto(`${url}/?mode=source-failed`); await expectDOM(page.getByTestId('inbox-source-error')).toBeVisible(); await expectDOM(page.getByTestId('inbox-empty')).not.toContainText('Inbox zero')
    await page.evaluate(() => (window as any).__inboxFixture.retry()); await page.getByTestId('inbox-source-error').getByRole('button', { name: 'Retry', exact: true }).click()
    await expectDOM(page.getByTestId('inbox-row-memory')).toBeVisible(); await expectDOM(page.getByTestId('inbox-source-error')).toHaveCount(0)
    await capture('source-retry')
  }, 30_000)
  it('does not report an empty inbox while incoming sources are still loading', async () => {
    await page.goto(`${url}/?mode=deferred`); await expectDOM(page.getByTestId('inbox-empty')).not.toContainText('Inbox zero')
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(0, 'A newly loaded incoming proposal'))
    await expectDOM(page.getByTestId('inbox-row-memory')).toBeVisible(); await expectDOM(page.getByTestId('inbox-empty')).toHaveCount(0)
  }, 30_000)
  it('keeps the last valid snapshot when one source fails during refresh', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('inbox-row-memory')).toBeVisible(); await page.evaluate(() => (window as any).__inboxFixture.failMemory())
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expectDOM(page.getByTestId('inbox-source-error')).toBeVisible(); await expectDOM(page.getByTestId('inbox-row-memory')).toBeVisible(); await expectDOM(page.getByTestId('inbox-empty')).toHaveCount(0)
  }, 30_000)
  it('an A→B→A workspace switch rejects old responses even when the workspace ID matches again', async () => {
    await page.goto(`${url}/?mode=workspace-race`); await expectDOM.poll(sourceCalls).toBe(1)
    await page.evaluate(() => (window as any).__inboxFixture.switchWorkspace('workspace-B')); await expectDOM.poll(sourceCalls).toBe(2)
    await page.evaluate(() => (window as any).__inboxFixture.switchWorkspace('workspace-A')); await expectDOM.poll(sourceCalls).toBe(3)
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(2, 'Latest workspace A item')); await expectDOM(page.getByText('Latest workspace A item', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(0, 'Stale workspace A item')); await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(1, 'Foreign workspace B item'))
    await expectDOM(page.getByText('Stale workspace A item', { exact: true })).toHaveCount(0); await expectDOM(page.getByText('Foreign workspace B item', { exact: true })).toHaveCount(0)
  }, 30_000)
  it('workspace B cannot prune a snoozed item from workspace A, including after reload', async () => {
    await page.goto(`${url}/?mode=workspace-triage`); await page.getByTestId('inbox-row-memory').click(); await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
    await page.evaluate(() => (window as any).__inboxFixture.switchWorkspace('workspace-B')); await expectDOM(page.getByTestId('inbox-empty')).toContainText('Inbox zero')
    await page.evaluate(() => (window as any).__inboxFixture.switchWorkspace('workspace-A')); await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
    await page.reload(); await page.getByTestId('inbox-nav-snoozed').click(); await expectDOM(page.getByTestId('inbox-row-memory')).toBeVisible()
  }, 30_000)
  it('the latest refresh wins when a previous memory request completes later', async () => {
    await page.goto(`${url}/?mode=refresh-race`); await expectDOM.poll(sourceCalls).toBe(1)
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(0, 'Initial snapshot')); await expectDOM(page.getByText('Initial snapshot', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expectDOM.poll(sourceCalls).toBe(2)
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expectDOM.poll(sourceCalls).toBe(3)
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(2, 'Newest snapshot')); await expectDOM(page.getByText('Newest snapshot', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(1, 'Old snapshot')); await expectDOM(page.getByText('Old snapshot', { exact: true })).toHaveCount(0)
  }, 30_000)
  it('same-workspace identity A→B→A rejects old private source responses and reloads each actor', async () => {
    await page.goto(`${url}/?mode=identity-source-race`); await expectDOM.poll(sourceCalls).toBe(1)
    expect(await page.evaluate(() => (window as any).__inboxFixture.identitySubscriptions())).toBe(1)
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('B')); await expectDOM.poll(sourceCalls).toBe(2)
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('A')); await expectDOM.poll(sourceCalls).toBe(3)
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(2, 'Current actor A private proposal'))
    await expectDOM(page.getByText('Current actor A private proposal', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(0, 'Stale actor A private proposal'))
    await page.evaluate(() => (window as any).__inboxFixture.resolveMemory(1, 'Stale actor B private proposal'))
    await expectDOM(page.getByText(/Stale actor [AB] private proposal/)).toHaveCount(0)
    await capture('identity-source-epochs')
  }, 30_000)
  it('clears an already loaded private row and selection immediately when identity changes', async () => {
    await page.goto(`${url}/?mode=identity-actions`); await expectDOM(page.getByText('Actor A incoming proposal', { exact: true })).toBeVisible()
    await page.getByTestId('inbox-row-memory').click(); await expectDOM(page.getByTestId('inbox-detail-pane')).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('B'))
    await expectDOM(page.getByText('Actor A incoming proposal')).toHaveCount(0)
    await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    await expectDOM(page.getByText('Actor B incoming proposal', { exact: true })).toBeVisible()
  }, 30_000)
  it('held actor A approval success/error cannot publish details, errors or refreshes into actor B', async () => {
    await page.goto(`${url}/?mode=identity-actions`); await page.getByTestId('inbox-row-memory').click(); await page.getByRole('button', { name: 'Remember', exact: true }).click()
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('B')); await expectDOM(page.getByText('Actor B incoming proposal', { exact: true })).toBeVisible()
    const before = await sourceCalls()
    await page.evaluate(() => (window as any).__inboxFixture.resolveApproval(0))
    await expectDOM(page.getByText('Actor B incoming proposal', { exact: true })).toBeVisible(); expect(await sourceCalls()).toBe(before)
    await page.getByTestId('inbox-row-memory').click(); await page.getByRole('button', { name: 'Remember', exact: true }).click()
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('A')); await expectDOM(page.getByText('Actor A incoming proposal', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.resolveApproval(1, 'Private actor B action failure'))
    await expectDOM(page.getByText('Private actor B action failure')).toHaveCount(0); await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    await capture('identity-held-actions')
  }, 30_000)
  it('triage is personal even when different actors have the same incoming item ID', async () => {
    await page.goto(`${url}/?mode=identity-triage`); await page.getByTestId('inbox-row-memory').click(); await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('B')); await expectDOM(page.getByText('Actor B incoming proposal', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('A')); await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
    await page.reload(); await page.getByTestId('inbox-nav-snoozed').click(); await expectDOM(page.getByText('Actor A incoming proposal', { exact: true })).toBeVisible()
    await capture('identity-personal-triage')
  }, 30_000)
  it('native identity discovery survives React StrictMode effect setup/cleanup replay', async () => {
    await page.goto(`${url}/?mode=identity-strict`); await expectDOM(page.getByText('Actor A incoming proposal', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__inboxFixture.identitySubscriptions())).toBe(1)
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('B')); await expectDOM(page.getByText('Actor B incoming proposal', { exact: true })).toBeVisible()
    await expectDOM(page.getByText('Actor A incoming proposal')).toHaveCount(0)
    await capture('identity-strict-mode')
  }, 30_000)
  it('equal native subjects from different issuers have independent persistent triage', async () => {
    await page.goto(`${url}/?mode=identity-triage`); await page.getByTestId('inbox-row-memory').click(); await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
    await page.evaluate(() => (window as any).__inboxFixture.changeIssuer('fixture-server-two')); await expectDOM(page.getByText('Actor A incoming proposal', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__inboxFixture.changeIssuer('fixture-server-one')); await expectDOM(page.getByTestId('inbox-row-memory')).toHaveCount(0)
    await capture('identity-issuer-triage')
  }, 30_000)
  it('a mailbox status error is caught and has a working retry', async () => {
    await page.goto(`${url}/?mode=mail-failed`); await expectDOM(page.getByTestId('inbox-source-error')).toBeVisible(); await expectDOM(page.getByTestId('inbox-empty')).not.toContainText('Inbox zero')
    await page.evaluate(() => (window as any).__inboxFixture.retry()); await page.getByTestId('inbox-source-error').getByRole('button', { name: 'Retry', exact: true }).click(); await expectDOM(page.getByTestId('inbox-source-error')).toHaveCount(0)
  }, 30_000)
  it('a configured unreachable mailbox reports partial loading failure instead of Inbox zero', async () => {
    await page.goto(`${url}/?mode=mail-unreachable`); await expectDOM(page.getByTestId('inbox-source-error')).toBeVisible(); await expectDOM(page.getByTestId('inbox-empty')).not.toContainText('Inbox zero')
    await expectDOM(page.getByTestId('mail-status')).toBeVisible()
  }, 30_000)
  it('an absent optional local mail pilot keeps the main queue calm and offers setup in Mail', async () => {
    await page.goto(`${url}/?mode=optional-mail-setup`); await expectDOM(page.getByTestId('inbox-empty')).toContainText('Inbox zero')
    await expectDOM(page.getByTestId('inbox-source-error')).toHaveCount(0)
    await page.setViewportSize({ width: 320, height: 780 })
    await page.getByRole('combobox').selectOption('mail:inbox')
    await expectDOM(page.getByTestId('mail-server-url')).toBeVisible()
    await expectDOM(page.getByTestId('mail-status').first()).toContainText('No mailbox yet')
  }, 30_000)
  it('an explicitly configured local pilot failure remains a real queue error', async () => {
    await page.goto(`${url}/?mode=explicit-local-mail`); await expectDOM(page.getByTestId('inbox-source-error')).toBeVisible()
    await expectDOM(page.getByTestId('inbox-empty')).not.toContainText('Inbox zero')
  }, 30_000)
  it('mailbox status responses from an older workspace visit cannot replace the latest address', async () => {
    const mailCalls = () => page.evaluate(() => (window as any).__inboxFixture.calls.filter((call: any) => call.method === 'mail.status').length)
    await page.goto(`${url}/?mode=mail-race`); await expectDOM.poll(mailCalls).toBe(1)
    await page.evaluate(() => (window as any).__inboxFixture.switchWorkspace('workspace-B')); await expectDOM.poll(mailCalls).toBe(2)
    await page.evaluate(() => (window as any).__inboxFixture.switchWorkspace('workspace-A')); await expectDOM.poll(mailCalls).toBe(3)
    await page.evaluate(() => (window as any).__inboxFixture.resolveMailStatus(2, 'latest@example.test')); await expectDOM(page.getByTestId('mail-status')).toContainText('latest@example.test')
    await page.evaluate(() => (window as any).__inboxFixture.resolveMailStatus(0, 'stale@example.test')); await page.evaluate(() => (window as any).__inboxFixture.resolveMailStatus(1, 'foreign@example.test'))
    await expectDOM(page.getByTestId('mail-status')).toContainText('latest@example.test'); await expectDOM(page.getByText(/stale@example.test|foreign@example.test/)).toHaveCount(0)
  }, 30_000)
  it('mailbox responses from actor A cannot replace actor B in the same workspace', async () => {
    const mailCalls = () => page.evaluate(() => (window as any).__inboxFixture.calls.filter((call: any) => call.method === 'mail.status').length)
    await page.goto(`${url}/?mode=identity-mail-race`); await expectDOM.poll(mailCalls).toBe(1)
    await page.evaluate(() => (window as any).__inboxFixture.changeActor('B')); await expectDOM.poll(mailCalls).toBe(2)
    await page.evaluate(() => (window as any).__inboxFixture.resolveMailStatus(1, 'actor-b@example.test')); await expectDOM(page.getByTestId('mail-status')).toContainText('actor-b@example.test')
    await page.evaluate(() => (window as any).__inboxFixture.resolveMailStatus(0, 'actor-a-private@example.test'))
    await expectDOM(page.getByText(/actor-a-private@example.test/)).toHaveCount(0); await expectDOM(page.getByTestId('mail-status')).toContainText('actor-b@example.test')
    await capture('identity-mail-response')
  }, 30_000)
  it('opening mail sends a real seen receipt and the read item leaves the queue after returning', async () => {
    await page.goto(url); await page.getByTestId('inbox-row-mail').click(); await expectDOM(page.getByTestId('inbox-detail-pane')).toBeVisible()
    await expectDOM.poll(() => page.evaluate(() => (window as any).__inboxFixture.calls.filter((call: any) => call.method === 'mail.setFlags').length)).toBe(1)
    await expectDOM(page.getByTestId('inbox-detail')).toHaveAttribute('data-kind', 'mail')
    await page.getByRole('button', { name: 'Back to list', exact: true }).click(); await expectDOM(page.getByTestId('inbox-row-mail')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__inboxFixture.calls.find((call: any) => call.method === 'mail.setFlags').value)).toEqual({ ids: ['email-1'], flags: { seen: true } })
  }, 30_000)
  it('an empty inbox is calm at 320px, without zero selections or a choose-item panel', async () => {
    await page.setViewportSize({ width: 320, height: 760 }); await page.goto(`${url}/?mode=empty`); await expectDOM(page.getByTestId('inbox-empty')).toContainText('Inbox zero')
    await expectDOM(page.getByTestId('inbox-selection-toolbar')).toHaveCount(0); await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await capture('empty-320')
  }, 30_000)
  it('320px keeps the incoming list and switches visible, opens one readable detail, and returns with Back', async () => {
    await page.setViewportSize({ width: 320, height: 760 }); await page.goto(url); await expectDOM(page.getByRole('switch', { name: 'Select Release reply', exact: true })).toBeInViewport()
    await page.getByTestId('inbox-row-memory').click(); await expectDOM(page.getByTestId('inbox-queue')).toBeHidden(); await expectDOM(page.getByRole('button', { name: 'Remember', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Back to list', exact: true }).click(); await expectDOM(page.getByTestId('inbox-queue')).toBeVisible(); await expectDOM(page.getByTestId('inbox-detail-pane')).toHaveCount(0)
    await capture('populated-320')
  }, 30_000)
})
