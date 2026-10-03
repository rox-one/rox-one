import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/caller')
const executablePath = '/usr/bin/chromium'
const url = 'http://127.0.0.1:5234'
type Fixture = { calls: Array<{ method: string; actor: string; args?: unknown[] }>; switchActor(next: string): void; changeActorWithoutEvent(next: string): void; failIdentity(): void; recoverIdentity(): void; resolveList(index: number, title?: string): void; resolveTasks(): void; resolveNotes(): void }

describe.skipIf(!existsSync(executablePath))('Feed authenticated caller, scheduled refresh and confirmed conversions', () => {
  let server: ReturnType<typeof Bun.spawn>, browser: Browser, page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5234'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30000
    for (;;) { try { if ((await fetch(url)).ok) break } catch {} if (Date.now() > deadline) throw new Error('Feed fixture startup failed'); await Bun.sleep(100) }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  }, 40000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.on('pageerror', error => errors.push(error.message)) })
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page.close() } })
  afterAll(async () => { server?.kill(); await browser?.close(); await server?.exited })
  const callCount = (method: string) => page.evaluate(method => (window as unknown as { __feedFixture: Fixture }).__feedFixture.calls.filter(call => call.method === method).length, method)
  it('loads and performs a confirmed conversion under actual StrictMode effect replay', async () => {
    await page.goto(`${url}/?mode=strict`); await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor A private feed')
    expect(await page.evaluate(() => Object.isFrozen(window.electronAPI) && Object.getOwnPropertyDescriptor(window.electronAPI, 'feedList')?.configurable === false)).toBe(true)
    await page.getByTestId('feed-to-note').click(); await expectDOM(page.getByTestId('feed-sent')).toBeVisible()
  }, 30000)
  it('clears actor A on same-workspace identity change, keeps private preferences separate and preserves B after reload', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor A private feed')
    await page.getByTestId('feed-search').fill('A private')
    await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.switchActor('B'))
    await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor B private feed'); await expectDOM(page.getByTestId('feed-search')).toHaveValue('')
    await expectDOM(page.getByText('Actor A private feed', { exact: true })).toHaveCount(0)
    await page.reload(); await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor B private feed')
  }, 30000)
  it('rejects late A and B replies across same-workspace A→B→A', async () => {
    await page.goto(`${url}/?mode=deferred`); await expectDOM.poll(() => callCount('feedList')).toBe(1)
    await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.switchActor('B')); await expectDOM.poll(() => callCount('feedList')).toBe(2)
    await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.switchActor('A')); await expectDOM.poll(() => callCount('feedList')).toBe(3)
    await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.resolveList(2, 'Latest A snapshot'))
    await expectDOM(page.getByTestId('feed-detail')).toContainText('Latest A snapshot')
    await page.evaluate(() => { const fixture = (window as unknown as { __feedFixture: Fixture }).__feedFixture; fixture.resolveList(0, 'Stale A private'); fixture.resolveList(1, 'Late B private') })
    await expectDOM(page.getByText('Stale A private', { exact: true })).toHaveCount(0); await expectDOM(page.getByText('Late B private', { exact: true })).toHaveCount(0)
  }, 30000)
  it('hides prior private data after identity revalidation fails and recovers with a fresh caller', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('feed-detail')).toBeVisible()
    await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.failIdentity())
    await expectDOM(page.getByTestId('feed-detail')).toHaveCount(0)
    await page.evaluate(() => { const fixture = (window as unknown as { __feedFixture: Fixture }).__feedFixture; fixture.switchActor('B'); fixture.recoverIdentity() })
    await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor B private feed')
  }, 30000)
  it('revalidates identity before writes and hides old data even if the identity event is missing', async () => {
    await page.goto(url); await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor A private feed')
    await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.changeActorWithoutEvent('B'))
    await page.getByTestId('feed-to-note').click(); await expectDOM(page.getByTestId('feed-detail')).toHaveCount(0)
    expect(await callCount('createNote')).toBe(0)
  }, 30000)
  it('active-view timer sends due refresh before list, while read-only callers only read', async () => {
    await page.clock.install(); await page.goto(url); await expectDOM(page.getByTestId('feed-detail')).toBeVisible()
    await page.clock.fastForward(60000); await expectDOM.poll(() => callCount('feedRefresh')).toBe(1)
    expect(await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.calls.filter(call => ['feedRefresh', 'feedList'].includes(call.method)).slice(-2).map(call => [call.method, call.args]))).toEqual([['feedRefresh', ['__due__']], ['feedList', undefined]])
    await page.goto(`${url}/?mode=readonly`); await expectDOM(page.getByTestId('feed-detail')).toBeVisible(); await page.clock.fastForward(60000)
    await expectDOM.poll(() => callCount('feedList')).toBe(2); expect(await callCount('feedRefresh')).toBe(0)
  }, 30000)
  it('note conversion saves full body with native revision and reuses its attempt after failure', async () => {
    await page.goto(`${url}/?mode=note-retry`); await expectDOM(page.getByTestId('feed-to-note')).toBeVisible(); await page.getByTestId('feed-to-note').click()
    await expectDOM(page.getByRole('alert')).toContainText('Fixture save was not acknowledged'); await expectDOM(page.getByTestId('feed-sent')).toHaveCount(0)
    await page.getByTestId('feed-to-note').click(); await expectDOM(page.getByTestId('feed-sent')).toBeVisible()
    expect(await callCount('createNote')).toBe(1)
    const saved = await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.calls.filter(call => call.method === 'saveNote').map(call => call.args!))
    expect(saved[0]![2]).toContain('Full useful article body'); expect(saved[0]![2]).toContain('https://example.com/original'); expect(saved[0]![4]).toEqual(saved[1]![4])
  }, 30000)
  it('legacy note conversion supplies opened hash and source owner', async () => {
    await page.goto(`${url}/?mode=legacy-note`); await expectDOM(page.getByTestId('feed-to-note')).toBeVisible(); await page.getByTestId('feed-to-note').click(); await expectDOM(page.getByTestId('feed-sent')).toBeVisible()
    const saved = await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.calls.find(call => call.method === 'saveNote')!.args!)
    expect(saved[3]).toBe('opened-content-hash'); expect(saved[4]).toBe('legacy-source-owner')
  }, 30000)
  it('task conversion awaits canonical ACK and retries the same task ID after failure', async () => {
    await page.goto(`${url}/?mode=task-retry`); await expectDOM(page.getByTestId('feed-to-task')).toBeVisible(); await page.getByTestId('feed-to-task').click()
    await expectDOM(page.getByRole('alert')).toBeVisible(); await expectDOM(page.getByTestId('feed-sent')).toHaveCount(0)
    await page.getByTestId('feed-to-task').click(); await expectDOM(page.getByTestId('feed-sent')).toBeVisible()
    const attempts = await page.evaluate(() => (window as unknown as { __feedFixture: Fixture }).__feedFixture.calls.filter(call => call.method === 'personalTasksPut').map(call => call.args![0] as Array<{ task: { id: string } }>))
    expect(attempts[0]![0]!.task.id).toBe(attempts[1]![0]!.task.id)
    await page.reload(); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-tasks') ?? '[]').length)).toBe(1)
  }, 30000)
  it('pending task and note results cannot confirm or save into a successor actor', async () => {
    await page.goto(`${url}/?mode=task-race`); await expectDOM(page.getByTestId('feed-to-task')).toBeVisible(); await page.getByTestId('feed-to-task').click(); await expectDOM.poll(() => callCount('personalTasksPut')).toBe(1)
    await expectDOM(page.getByTestId('feed-sent')).toHaveCount(0)
    await page.evaluate(() => { const fixture = (window as unknown as { __feedFixture: Fixture }).__feedFixture; fixture.switchActor('B'); fixture.resolveTasks() })
    await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor B private feed'); await expectDOM(page.getByTestId('feed-sent')).toHaveCount(0)
    await page.goto(`${url}/?mode=note-race`); await expectDOM(page.getByTestId('feed-to-note')).toBeVisible(); await page.getByTestId('feed-to-note').click(); await expectDOM.poll(() => callCount('createNote')).toBe(1)
    await page.evaluate(() => { const fixture = (window as unknown as { __feedFixture: Fixture }).__feedFixture; fixture.switchActor('C'); fixture.resolveNotes() })
    await expectDOM(page.getByTestId('feed-detail')).toContainText('Actor C private feed'); expect(await callCount('saveNote')).toBe(0); await expectDOM(page.getByTestId('feed-sent')).toHaveCount(0)
  }, 30000)
  it('localizes the native failed-automation code in Russian', async () => {
    await page.goto(`${url}/?mode=ru-error`); await expectDOM(page.getByTestId('feed-detail')).toBeVisible(); await expectDOM(page.getByTestId('feed-detail')).not.toContainText('automation-run-failed')
    await expectDOM(page.getByTestId('feed-detail').locator('pre')).toContainText('Ошибка')
  }, 30000)
})
