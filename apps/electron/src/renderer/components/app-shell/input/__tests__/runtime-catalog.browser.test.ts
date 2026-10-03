import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as domExpect, type Browser, type Page } from 'playwright/test'

const repository = resolve(import.meta.dir, '../../../../../../../..')
const fixture = resolve(import.meta.dir, 'fixtures/runtime-catalog')
const executable = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const fixtureUrl = process.env.RUNTIME_CATALOG_FIXTURE_URL ?? 'http://127.0.0.1:5271'
const proofDirectory = process.env.RUNTIME_CATALOG_PROOF_DIR

// Public provider responses are synthetic. Both pickers, the runtime page,
// their shared context, translations and menus are production renderer code.
describe.skipIf(!existsSync(executable))('public native runtime catalog renderer DOM', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined, browser: Browser, page: Page
  let errors: string[] = []
  beforeAll(async () => {
    if (!process.env.RUNTIME_CATALOG_FIXTURE_URL) {
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5271'],
        { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
      const deadline = Date.now() + 30_000
      for (;;) {
        try { if ((await fetch(fixtureUrl)).ok) break } catch {}
        if (Date.now() > deadline) throw Error('Runtime catalog fixture did not start')
        await Bun.sleep(100)
      }
    }
    browser = await chromium.launch({ executablePath: executable, args: ['--no-sandbox'] })
    const warmup = await browser.newPage()
    const startupErrors: string[] = []
    warmup.on('pageerror', error => { startupErrors.push(error.message) })
    await warmup.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })
    try { await domExpect(warmup.getByTestId('compact-model-picker')).toBeVisible({ timeout: 60_000 }) }
    catch (error) { throw new Error(`Runtime catalog warmup failed: ${startupErrors.join('; ') || String(error)}`) }
    await warmup.close()
    if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
  }, 90_000)
  beforeEach(async () => {
    errors = []
    page = await browser.newPage({ viewport: { width: 1120, height: 900 } })
    page.on('pageerror', error => errors.push(error.message))
  })
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } })
  afterAll(async () => { server?.kill(); await browser?.close(); await server?.exited })
  const load = async (query = '') => {
    await page.goto(`${fixtureUrl}/?${query}`, { waitUntil: 'domcontentloaded' })
    await domExpect(page.getByTestId('compact-model-picker')).toBeVisible({ timeout: 30_000 })
  }
  const proof = async (name: string) => {
    if (!proofDirectory) return
    await page.screenshot({ path: resolve(proofDirectory, `original-completion-runtime-${name}.png`), fullPage: true })
    writeFileSync(resolve(proofDirectory, `original-completion-runtime-${name}.json`), JSON.stringify({ errors,
      calls: await page.evaluate(() => (window as any).__catalogFixture.calls), text: await page.locator('body').innerText() }, null, 2))
  }

  test('both real pickers advertise exactly R1 Max and submit the public connection without host account metadata', async () => {
    await load()
    await page.getByTestId('desktop-model-picker').getByRole('button', { name: 'Rox R1 Max', exact: true }).click()
    const desktopModels = page.getByRole('menuitem').filter({ hasText: /Rox/ })
    await domExpect(desktopModels).toHaveCount(1)
    await domExpect(desktopModels).toContainText('Rox R1 Max')
    await desktopModels.click()
    await page.getByTestId('compact-model-picker').getByRole('button').click()
    await page.getByRole('dialog').getByRole('button', { name: /Rox R1 Max/ }).click()
    const calls = await page.evaluate(() => (window as any).__catalogFixture.calls)
    expect(calls).toEqual([
      { method: 'model', args: { model: 'rox/r1-max', connection: 'workspace-rox' } },
      { method: 'model', args: { model: 'rox/r1-max', connection: 'workspace-rox' } },
    ])
    expect(await page.locator('body').innerText()).not.toMatch(/Authenticated|Claude|Explore|Vision|Rox Fast|Rox Max/)
    await proof('pickers')
  }, 30_000)

  test('a refreshed public catalog replaces choices in both real pickers', async () => {
    await load()
    await page.evaluate(() => (window as any).__catalogFixture.setSummary({ kind: 'configuration-only', slug: 'workspace-custom', providerType: 'omp', isDefault: true,
      defaultModel: 'custom/model', models: [{ id: 'custom/model', name: 'Workspace Custom', contextWindow: 100000 }] }))
    await page.getByTestId('desktop-model-picker').getByRole('button', { name: 'Rox R1 Max', exact: true }).click()
    await page.getByRole('menuitem').filter({ hasText: 'Workspace Custom' }).click()
    await page.getByTestId('compact-model-picker').getByRole('button').click()
    await domExpect(page.getByRole('dialog')).not.toContainText('Rox R1 Max')
    await page.getByRole('dialog').getByRole('button', { name: /Workspace Custom/ }).click()
    expect(await page.evaluate(() => (window as any).__catalogFixture.calls.map((call: any) => call.args))).toEqual([
      { model: 'custom/model', connection: 'workspace-custom' }, { model: 'custom/model', connection: 'workspace-custom' },
    ])
    await proof('custom')
  }, 30_000)

  test('a removed session connection stays unavailable without offering another provider catalog', async () => {
    await load('connection=foreign')
    await domExpect(page.getByTestId('desktop-model-picker')).toContainText('Unavailable')
    await page.getByTestId('compact-model-picker').getByRole('button', { name: 'Unavailable', exact: true }).click()
    await domExpect(page.getByRole('dialog')).not.toContainText('Rox R1 Max')
    await domExpect(page.getByRole('dialog')).not.toContainText('Claude')
    expect(await page.evaluate(() => (window as any).__catalogFixture.calls)).toEqual([])
    await proof('foreign')
  }, 30_000)

  test('the real Runtime page presents Rox and the configured model without invented account authentication', async () => {
    await page.goto(`${fixtureUrl}/?view=runtime`, { waitUntil: 'domcontentloaded' })
    const configuration = page.locator('[data-runtime-configuration="native"]')
    await domExpect(configuration).toContainText('Provider: Rox', { timeout: 30_000 })
    await domExpect(configuration).toContainText('Model: rox/r1-max')
    expect(await configuration.innerText()).not.toMatch(/OMP|Authenticated|Signed in|API key/)
    await proof('settings')
  }, 30_000)

  test('an existing private OMP session keeps its own catalog after the workspace selects a different default', async () => {
    await load('catalog=locked')
    await domExpect(page.getByTestId('catalog-state')).toHaveText('ready')
    await page.getByTestId('desktop-model-picker').getByRole('button', { name: 'Sonnet', exact: true }).click()
    await domExpect(page.getByRole('menu')).not.toContainText('Rox R1 Max')
    await page.getByRole('menuitem').filter({ hasText: 'Sonnet' }).click()
    await page.getByTestId('compact-model-picker').getByRole('button').click()
    await domExpect(page.getByRole('dialog')).not.toContainText('Rox R1 Max')
    await page.getByRole('dialog').getByRole('button', { name: /Sonnet/ }).click()
    expect(await page.evaluate(() => (window as any).__catalogFixture.calls.filter((call: any) => call.method === 'model').map((call: any) => call.args))).toEqual([
      { model: 'anthropic/claude-sonnet-4-5', connection: 'private-omp' }, { model: 'anthropic/claude-sonnet-4-5', connection: 'private-omp' },
    ])
    expect(await page.locator('body').innerText()).not.toMatch(/Unavailable|Authenticated|PRIVATE HOST/)
    await proof('locked-session')
  }, 30_000)

  test('a catalog read failure does not falsely mark an existing provider removed or offer the workspace default', async () => {
    await load('catalog=failed')
    await domExpect(page.getByTestId('catalog-state')).toHaveText('error')
    await domExpect(page.getByTestId('desktop-model-picker')).not.toContainText('Unavailable')
    await page.getByTestId('compact-model-picker').getByRole('button').click()
    await domExpect(page.getByRole('dialog')).not.toContainText('Rox R1 Max')
    await domExpect(page.getByRole('dialog')).not.toContainText('Unavailable')
    expect(await page.evaluate(() => (window as any).__catalogFixture.calls.filter((call: any) => call.method === 'model'))).toEqual([])
    await proof('catalog-read-failed')
  }, 30_000)

  test('a confirmed removed locked connection stays unavailable without falling through to the new default', async () => {
    await load('catalog=removed')
    await domExpect(page.getByTestId('catalog-state')).toHaveText('ready')
    await domExpect(page.getByTestId('desktop-model-picker')).toContainText('Unavailable')
    await page.getByTestId('compact-model-picker').getByRole('button', { name: 'Unavailable', exact: true }).click()
    await domExpect(page.getByRole('dialog')).not.toContainText('Rox R1 Max')
    await proof('catalog-removed')
  }, 30_000)

  test('late catalog success and failure cannot replace the active A → B → A session catalog', async () => {
    await load('catalog=deferred')
    await domExpect.poll(() => page.evaluate(() => (window as any).__catalogFixture.requests.length)).toBe(1)
    await page.evaluate(() => (window as any).__catalogFixture.setScope({ workspaceId: 'workspace-b', sessionId: 'session-b', connection: 'other-omp' }))
    await domExpect.poll(() => page.evaluate(() => (window as any).__catalogFixture.requests.length)).toBe(2)
    await page.evaluate(() => (window as any).__catalogFixture.setScope({ workspaceId: 'workspace', sessionId: 'session-a', connection: 'private-omp' }))
    await domExpect.poll(() => page.evaluate(() => (window as any).__catalogFixture.requests.length)).toBe(3)
    const selected = { kind: 'configuration-only', sessionId: 'session-a', workspaceId: 'workspace', slug: 'private-omp', providerType: 'omp',
      defaultModel: 'anthropic/claude-sonnet-4-5', models: [{ id: 'anthropic/claude-sonnet-4-5', name: 'Current Sonnet' }] }
    await page.evaluate(value => (window as any).__catalogFixture.resolve(2, value), selected)
    await domExpect(page.getByTestId('desktop-model-picker')).toContainText('Current Sonnet')
    await page.evaluate(value => { (window as any).__catalogFixture.resolve(0, { ...value, models: [{ id: value.defaultModel, name: 'Stale Sonnet' }] }); (window as any).__catalogFixture.reject(1) }, selected)
    await domExpect(page.getByTestId('catalog-state')).toHaveText('ready')
    await domExpect(page.getByTestId('desktop-model-picker')).toContainText('Current Sonnet')
    await domExpect(page.getByTestId('desktop-model-picker')).not.toContainText('Stale Sonnet')
    await page.getByTestId('compact-model-picker').getByRole('button').click()
    await domExpect(page.getByRole('dialog')).toContainText('Current Sonnet')
    await domExpect(page.getByRole('dialog')).not.toContainText('Stale Sonnet')
    await proof('catalog-aba')
  }, 30_000)

  test('mounting the real desktop picker tolerates a denied optional host home-directory read', async () => {
    await load('home=denied')
    await domExpect(page.getByTestId('desktop-model-picker')).toContainText('Rox R1 Max')
    await page.getByTestId('compact-model-picker').getByRole('button').click()
    await domExpect(page.getByRole('dialog')).toContainText('Rox R1 Max')
    await proof('home-denied')
  }, 30_000)
})
