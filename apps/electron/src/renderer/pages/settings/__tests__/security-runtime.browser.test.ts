import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser, type Page } from 'playwright/test'

const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/security-runtime')
const url = 'http://127.0.0.1:5194'
const chromiumPath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const proofDirectory = process.env.SECURITY_RUNTIME_PROOF_DIR
const expectDOM = playwrightExpect.configure({ timeout: 3_000 })

describe.skipIf(!existsSync(chromiumPath))('Security runtime production renderer DOM', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let page: Page
  const errors: string[] = []
  const stop = async () => { server?.kill(); try { await browser?.close() } finally { await server?.exited } }
  beforeAll(async () => {
    try {
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5194'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + 30_000
      for (;;) { try { if ((await fetch(url)).ok) break } catch {} ; if (Date.now() > deadline) throw new Error('Security fixture did not start'); await Bun.sleep(100) }
      browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
      const warmup = await browser.newPage()
      await warmup.goto(url)
      await playwrightExpect(warmup.getByTestId('security-rox-runtime')).toBeVisible({ timeout: 30_000 })
      await warmup.close()
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) { await stop(); throw error }
  }, 60_000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage({ viewport: { width: 1000, height: 1080 } }); page.on('pageerror', error => errors.push(error.message)) }, 30_000)
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } }, 30_000)
  afterAll(stop, 30_000)
  const load = async (query = '') => { await page.goto(`${url}/?${query}`); await expectDOM(page.getByTestId('security-rox-runtime')).toBeVisible() }
  const calls = (method: string) => page.evaluate(method => (window as any).__securityFixture.calls.filter((item: any) => item.method === method), method)
  const outcome = (method: string, value: string) => page.evaluate(([method, value]) => (window as any).__securityFixture.setOutcome(method, value), [method, value])
  const proof = async (name: string) => {
    if (!proofDirectory) return
    await page.screenshot({ path: resolve(proofDirectory, `${name}.png`), fullPage: true })
    writeFileSync(resolve(proofDirectory, `${name}.json`), JSON.stringify({ calls: await page.evaluate(() => (window as any).__securityFixture.calls), errors }, null, 2))
  }

  it('shows actual Rox readiness/version and default model while optional OpenClaw is not installed', async () => {
    await load()
    await expectDOM(page.getByTestId('security-rox-status')).toHaveText('Installed and ready to start · v18.4.12')
    await expectDOM(page.getByTestId('security-rox-runtime')).toContainText('rox/r1-max')
    await expectDOM(page.getByText('Optional OpenClaw runtime', { exact: true })).toBeVisible()
    await expectDOM(page.getByText('OpenClaw has not been installed for this workspace.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Manage runtime', exact: true }).click()
    expect((await calls('navigate'))[0].args.route).toBe('settings/runtime')
    await proof('rox-ready-openclaw-missing')
  }, 30_000)

  it('an audit waiting on its backend does not hold Rox or OpenClaw loading', async () => {
    await load('openclaw=running&audit=deferred')
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Installed and ready to start')
    await expectDOM(page.getByText('Running', { exact: true })).toBeVisible()
    await expectDOM(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
    await proof('audit-pending-other-runtime-ready')
  }, 30_000)

  it('optional OpenClaw can retry independently while Rox and the audit remain available', async () => {
    await load('openclaw=failed&audit=ready')
    await expectDOM(page.getByTestId('security-openclaw-error')).toContainText('Could not load the optional OpenClaw status.')
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Installed and ready to start')
    const auditReads = (await calls('auditStatus')).length
    const roxReads = (await calls('roxStatus')).length
    await outcome('openclaw', 'running')
    await page.getByRole('button', { name: 'Refresh OpenClaw status', exact: true }).click()
    await expectDOM(page.getByTestId('security-openclaw-error')).toHaveCount(0)
    await expectDOM(page.getByText('Running', { exact: true })).toBeVisible()
    expect((await calls('auditStatus')).length).toBe(auditReads)
    expect((await calls('roxStatus')).length).toBe(roxReads)
    await proof('openclaw-retry-independent')
  }, 30_000)

  it('Rox failures retry independently and optional runtime controls still execute confirmed real API calls', async () => {
    await load('rox=failed&openclaw=running&audit=ready')
    await expectDOM(page.getByTestId('security-rox-status')).toHaveText('Could not load the Rox runtime status')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expectDOM(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await calls('stopOpenclaw')).toHaveLength(0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Stop', exact: true }).click()
    expect((await calls('stopOpenclaw'))[0].args.workspaceId).toBe('workspace-a')
    await expectDOM(page.getByText('Stopped', { exact: true })).toBeVisible()
    await outcome('rox', 'ready')
    await page.getByRole('button', { name: 'Refresh Rox status', exact: true }).click()
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Installed and ready to start')
  }, 30_000)

  it('local Rox installation invokes the actual updater; remote runtime never offers a host install', async () => {
    await load('rox=missing&local=true')
    const card = page.getByTestId('security-rox-runtime')
    await card.getByRole('button', { name: 'Install', exact: true }).click()
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Installed and ready to start')
    expect((await calls('updateRox'))[0].args).toBe('omp')
    await load('rox=missing&local=true&remote=true')
    await expectDOM(page.getByTestId('security-rox-runtime').getByRole('button', { name: 'Install', exact: true })).toHaveCount(0)
  }, 30_000)

  it('read-only APIs still display runtime status and audit without requiring every mutation method', async () => {
    await load('readonly=true&openclaw=running&audit=ready')
    await expectDOM(page.getByText('Running', { exact: true })).toBeVisible()
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Installed and ready to start')
    await expectDOM(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
    await expectDOM(page.getByRole('button', { name: 'Audit', exact: true })).toBeDisabled()
  }, 30_000)

  it('A to B to A workspace navigation ignores stale status replies', async () => {
    await load('rox=deferred&openclaw=deferred&audit=deferred')
    await playwrightExpect.poll(async () => (await calls('openclawStatus')).length).toBe(1)
    for (const [method, value] of [['rox', 'ready'], ['openclaw', 'stopped'], ['audit', 'ready']]) await outcome(method, value)
    await page.evaluate(() => (window as any).__securityFixture.setWorkspace('workspace-b'))
    await expectDOM(page.getByText('Stopped', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as any).__securityFixture.setWorkspace('workspace-a'))
    await expectDOM(page.getByText('Stopped', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const fixture = (window as any).__securityFixture
      fixture.resolve('roxStatus', 'workspace-a', [{ name: 'omp', phase: 'error' }])
      fixture.resolve('openclawStatus', 'workspace-a')
      fixture.resolve('auditStatus', 'workspace-a')
    })
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Installed and ready to start')
    await expectDOM(page.getByText('Stopped', { exact: true })).toBeVisible()
    await expectDOM(page.getByText('Running', { exact: true })).toHaveCount(0)
  }, 30_000)

  it('live toolchain updates show current phase and narrow layout remains within the viewport', async () => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await load('local=true&lang=ru')
    await expectDOM(page.getByTestId('security-rox-status')).toContainText('Установлен и готов к запуску')
    await page.evaluate(() => (window as any).__securityFixture.emitStatus('outdated'))
    await expectDOM(page.getByTestId('security-rox-status')).toHaveText('Доступно обновление')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await proof('narrow-russian-live-update')
  }, 30_000)
})
