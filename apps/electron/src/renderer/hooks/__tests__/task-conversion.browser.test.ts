import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../..'), fixture = resolve(import.meta.dirname, 'fixtures/task-conversion')
const executablePath = await resolveChromiumExecutable(), url = 'http://127.0.0.1:5327'
describe.skipIf(!existsSync(executablePath))('four actual conversion components with production confirmed bridge and task persistence', () => {
  let server: ReturnType<typeof Bun.spawn>, browser: Browser, page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5327'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30000
    for (;;) { try { if ((await fetch(url)).ok) break } catch {} if (Date.now() > deadline) throw new Error('Task conversion fixture startup failed'); await Bun.sleep(100) }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  }, 60000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)) })
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } })
  afterAll(async () => { server?.kill(); await browser?.close(); await server?.exited })
  const open = async (surface = 'meeting', mode = 'ok') => { await page.goto(`${url}/?surface=${surface}&mode=${mode}`); await expectDOM(page.getByTestId('fixture-ready')).toHaveText(surface, { timeout: 30000 }) }
  const button = () => page.getByTestId('converter').getByRole('button', { name: 'To task', exact: true })
  const proof = () => page.evaluate(() => (window as any).__conversion.read())
  const success = () => page.getByTestId('converter').getByText(/Open task|Task created/, { exact: false }).first()
  for (const surface of ['meeting', 'mail', 'radar', 'dossier']) {
    it(`${surface} keeps rejected task creation truthful and retries the same attempted ID`, async () => {
      await open(surface, 'denied'); await button().click(); await expectDOM(page.getByRole('alert')).toContainText('Failed to create the task')
      await expectDOM(success()).toHaveCount(0); expect((await proof()).meeting.actions[0].taskId).toBeUndefined()
      await page.evaluate(() => (window as any).__conversion.allow()); await button().click(); await expectDOM(success()).toBeVisible()
      const calls = await page.evaluate(() => (window as any).__conversion.calls.filter((call: any) => call.method === 'put'))
      expect(calls).toHaveLength(2); expect(calls[1].id).toBe(calls[0].id)
      expect((await proof()).records.flatMap((scope: any) => scope.tasks)).toHaveLength(1)
    }, 30000)
  }
  it('unknown caller cannot link an unpersisted meeting task and can retry after binding succeeds', async () => {
    await open('meeting', 'no-scope'); await button().click(); await expectDOM(page.getByRole('alert')).toBeVisible()
    expect((await proof()).meeting.actions[0].taskId).toBeUndefined(); expect(await page.evaluate(() => (window as any).__conversion.calls)).toEqual([])
    await page.evaluate(() => (window as any).__conversion.allow()); await button().click(); await expectDOM(success()).toBeVisible()
  }, 30000)
  it('lost canonical task ACK retries one durable identity before linking the meeting action', async () => {
    await open('meeting', 'lost-ack'); await button().click(); await expectDOM(page.getByRole('alert')).toBeVisible()
    expect((await proof()).meeting.actions[0].taskId).toBeUndefined(); await button().click(); await expectDOM(success()).toBeVisible()
    const data = await proof(); expect(data.records.flatMap((scope: any) => scope.tasks)).toHaveLength(1)
    const calls = await page.evaluate(() => (window as any).__conversion.calls.filter((call: any) => call.method === 'put')); expect(calls[1].id).toBe(calls[0].id)
  }, 30000)
  for (const mode of ['link-denied', 'link-lost-ack']) {
    it(`${mode} retries the already acknowledged task without another task write`, async () => {
      await open('meeting', mode); await button().click(); await expectDOM(page.getByRole('alert')).toBeVisible(); await expectDOM(success()).toHaveCount(0)
      await page.evaluate(() => (window as any).__conversion.allow()); await button().click(); await expectDOM(success()).toBeVisible()
      expect(await page.evaluate(() => (window as any).__conversion.calls.filter((call: any) => call.method === 'put').length)).toBe(1)
      expect((await proof()).records.flatMap((scope: any) => scope.tasks)).toHaveLength(1)
    }, 30000)
  }
  for (const change of ['actor', 'workspace', 'edit', 'replace', 'unmount']) {
    it(`pending canonical receipt after ${change} cannot publish into the successor action`, async () => {
      await open('meeting', 'held'); await button().click(); await expectDOM(button()).toBeDisabled()
      await page.evaluate(change => { const fixture = (window as any).__conversion; if (change === 'unmount') fixture.unmount(); else fixture.change(change); fixture.release() }, change)
      await expectDOM(success()).toHaveCount(0)
      await expectDOM.poll(async () => (await proof()).records.flatMap((scope: any) => scope.tasks).length).toBe(1)
      expect(await page.evaluate(() => (window as any).__conversion.calls.filter((call: any) => call.method === 'saveAction'))).toEqual([])
      expect((await proof()).meeting.actions[0].taskId).toBeUndefined()
    }, 30000)
  }
  for (const mode of ['workspace-mismatch', 'invalid-identity']) {
    it(`${mode} is rejected before a canonical task write`, async () => {
      await open('meeting', mode); await button().click(); await expectDOM(page.getByRole('alert')).toBeVisible()
      expect(await page.evaluate(() => (window as any).__conversion.calls)).toEqual([])
      expect((await proof()).meeting.actions[0].taskId).toBeUndefined()
    }, 30000)
  }
  for (const change of ['replace', 'workspace']) {
    it(`a retained converter after ${change} render cannot use its stale source`, async () => {
      await open('hook'); await page.evaluate(change => { const fixture = (window as any).__conversion; fixture.retain(); fixture.change(change) }, change)
      await page.evaluate(() => (window as any).__conversion.invokeOld())
      expect(await page.evaluate(() => (window as any).__conversion.calls)).toEqual([])
      await button().click(); await expectDOM(success()).toBeVisible()
      expect(await page.evaluate(() => (window as any).__conversion.calls.filter((call: any) => call.method === 'put').length)).toBe(1)
    }, 30000)
  }
  it('StrictMode initial converter works and synchronous double invocation writes once', async () => {
    await open('hook'); await page.evaluate(() => { const fixture = (window as any).__conversion; void fixture.invoke(); void fixture.invoke() })
    await expectDOM(success()).toBeVisible()
    expect(await page.evaluate(() => (window as any).__conversion.calls.filter((call: any) => call.method === 'put').length)).toBe(1)
  }, 30000)
  it('legacy local caller still receives a durable task before its meeting link', async () => {
    await open('meeting', 'legacy'); await button().click(); await expectDOM(success()).toBeVisible()
    const calls = await page.evaluate(() => (window as any).__conversion.calls)
    expect(calls.map((call: any) => call.method)).toEqual(['put', 'saveAction'])
    expect((await proof()).records.flatMap((scope: any) => scope.tasks)).toHaveLength(1)
  }, 30000)
})
