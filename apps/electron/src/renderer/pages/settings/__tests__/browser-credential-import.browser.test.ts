import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser, type Page } from 'playwright/test'

const expectDOM = playwrightExpect.configure({ timeout: 2_000 })

const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/credential-import')
const executablePath = process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'
const fixtureUrl = process.env.CREDENTIAL_IMPORT_FIXTURE_URL ?? 'http://127.0.0.1:5189'
const proofDirectory = process.env.CREDENTIAL_IMPORT_PROOF_DIR
const browserCaseTimeout = 30_000
const browserHookTimeout = 30_000

// Native credential services are replaced by a synthetic transport. The panel,
// menu, switches, translations and styles are the production renderer code.
describe.skipIf(!existsSync(executablePath))('browser credential import renderer DOM', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let page: Page
  const pageErrors: string[] = []

  const stopResources = async () => {
    const ownedServer = server
    server = undefined
    ownedServer?.kill()
    try {
      await browser?.close()
    } finally {
      await ownedServer?.exited
    }
  }

  beforeAll(async () => {
    try {
      if (!process.env.CREDENTIAL_IMPORT_FIXTURE_URL) {
        server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5189'], {
          cwd: repository, stdout: 'ignore', stderr: 'ignore',
        })
        const deadline = Date.now() + 30_000
        for (;;) {
          try { if ((await fetch(fixtureUrl)).ok) break } catch {}
          if (Date.now() > deadline) throw new Error('Credential DOM fixture did not start')
          await Bun.sleep(100)
        }
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
      // Compile the production styles and modules outside the per-case timeout.
      const warmup = await browser.newPage()
      await warmup.goto(fixtureUrl)
      await playwrightExpect(warmup.getByTestId('browser-profile-import')).toBeVisible({ timeout: 30_000 })
      await warmup.close()
      if (proofDirectory) mkdirSync(proofDirectory, { recursive: true })
    } catch (error) {
      await stopResources()
      throw error
    }
  }, 60_000)

  beforeEach(async () => {
    pageErrors.length = 0
    page = await browser.newPage({ viewport: { width: 1120, height: 1080 } })
    page.on('pageerror', (error) => pageErrors.push(error.message))
  }, browserHookTimeout)
  afterEach(async () => {
    try { expect(pageErrors).toEqual([]) } finally { await page?.close() }
  }, browserHookTimeout)
  afterAll(stopResources, browserHookTimeout)

  const load = async (query = '') => {
    await page.goto(`${fixtureUrl}/?${query}`)
    await expectDOM(page.getByRole('switch', { name: 'Password files', exact: true })).toBeEnabled()
  }
  const choose = async (family = 'chromium') => {
    await page.getByTestId('browser-profile-manual-toggle').click()
    await page.getByRole('radio').nth(['chromium', 'firefox', 'safari'].indexOf(family)).check()
  }
  const calls = (method: string) => page.evaluate((name) => (window as any).__credentialFixture.calls.filter((call: any) => call.method === name), method)
  const proof = async (name: string) => {
    if (!proofDirectory) return
    await page.screenshot({ path: resolve(proofDirectory, `credential-import-${name}.png`), fullPage: true })
    writeFileSync(resolve(proofDirectory, `credential-import-${name}.json`), JSON.stringify({ url: page.url(), calls: await page.evaluate(() => (window as any).__credentialFixture.calls), pageErrors }, null, 2))
  }

  it('retains default preferences, discovers explicitly, and requests a native grant for every preview/import', async () => {
    await load()
    for (const name of ['History', 'Bookmarks', 'Cookies', 'Password files']) {
      await expectDOM(page.getByRole('switch', { name, exact: true })).toBeChecked()
    }
    expect(await calls('discoverBrowserProfiles')).toHaveLength(0)
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await choose()
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Native access required')
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('before each preview or import')
    await page.getByRole('button', { name: 'Dry run', exact: true }).click()
    await expectDOM(page.getByTestId('browser-profile-import-summary')).toContainText('2')
    for (const [name, count] of [['History', '7'], ['Bookmarks', '3'], ['Password files', '2']]) {
      const cell = page.getByTestId('browser-profile-import-summary').locator('div').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) })
      await expectDOM(cell.locator('span').first()).toHaveText(count)
    }
    await expectDOM(page.getByRole('button', { name: 'Rollback last import', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const imports = await calls('importBrowserProfile')
    expect(imports).toHaveLength(2)
    expect(imports.map((call: any) => call.args.dryRun)).toEqual([true, false])
    for (const call of imports) {
      expect(call.args.consent.credentials).toBe(true)
      expect(call.args.consent.osCredentialsApproved).toBe(false)
      expect(call.args.consent.cookies).toBe(false)
      expect(call.args.profileId).toBe('chromium:synthetic')
    }
    await proof('supported')
  }, browserCaseTimeout)

  it.each(['firefox', 'safari'])('disables credential-only import for unsupported %s while retaining its saved preference', async (family) => {
    await load('categories=credentials')
    await choose(family)
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('unavailable for this browser or system')
    await expectDOM(page.getByRole('switch', { name: 'Password files', exact: true })).toBeChecked()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    await expectDOM(page.getByRole('button', { name: 'Dry run', exact: true })).toBeDisabled()
    expect(await calls('importBrowserProfile')).toHaveLength(0)
    await page.getByRole('switch', { name: 'History', exact: true }).click()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
  }, browserCaseTimeout)

  it('does not enable credential-only import when the native service is absent', async () => {
    await load('categories=credentials&capability=absent')
    await choose()
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Unavailable')
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    await proof('unavailable')
  }, browserCaseTimeout)

  it.each(['denied', 'cancelled'])('shows a %s native grant as zero passwords and no rollback/success claim', async (outcome) => {
    await load(`categories=credentials&outcome=${outcome}`)
    await choose()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expectDOM(page.getByRole('alert')).toContainText(`Password access was ${outcome}`)
    const count = page.getByTestId('browser-profile-import-summary').locator('div').filter({ has: page.locator('span', { hasText: /^Password files$/ }) })
    await expectDOM(count.locator('span').first()).toHaveText('0')
    await expectDOM(page.getByRole('button', { name: 'Rollback last import', exact: true })).toBeDisabled()
    expect((await calls('importBrowserProfile'))[0].args.consent.osCredentialsApproved).toBe(false)
    await proof(outcome)
  }, browserCaseTimeout)

  it('clears previous credential success counts when the next native grant fails', async () => {
    await load('categories=credentials')
    await choose()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expectDOM(page.getByTestId('browser-profile-import-summary')).toBeVisible()
    await page.evaluate(() => (window as any).__credentialFixture.setOutcome('throw'))
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expectDOM(page.getByRole('alert')).toContainText('Password import could not complete')
    await expectDOM(page.getByTestId('browser-profile-import-summary')).toHaveCount(0)
  }, browserCaseTimeout)

  it('reports native-service unavailability if support disappears before the grant', async () => {
    await load('categories=credentials&outcome=unavailable')
    await choose()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expectDOM(page.getByRole('alert')).toContainText('Password import could not complete')
    await expectDOM(page.getByRole('button', { name: 'Rollback last import', exact: true })).toBeDisabled()
  }, browserCaseTimeout)

  it('ignores a delayed import result after switching workspaces', async () => {
    await load('categories=credentials&outcome=deferred')
    await choose()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-b'))
    await page.evaluate(() => (window as any).__credentialFixture.resolveImport({ dryRun: false, profileId: 'chromium:synthetic', counts: { history: 0, bookmarks: 0, cookies: 0, credentials: 99, skipped: 0 }, accessedStores: ['credentials'], rollbackToken: 'stale', deletionReceipt: null, credentialAccess: 'granted' }))
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await expectDOM(page.getByTestId('browser-profile-import-summary')).toHaveCount(0)
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    await proof('workspace-switch')
  }, browserCaseTimeout)

  it('does not restore an old sync grant after switching away and back to its workspace', async () => {
    await load()
    await choose()
    const sync = page.getByRole('switch', { name: /^Keep history and bookmarks updated/ })
    await expectDOM(sync).toBeEnabled()
    await page.evaluate(() => (window as any).__credentialFixture.deferData('set'))
    await sync.click()
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-b'))
    await expectDOM(sync).not.toBeChecked()
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-a'))
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await page.evaluate(() => (window as any).__credentialFixture.resolveData({
      workspaceId: 'workspace-a', enabled: true, profileId: 'chromium:synthetic', state: 'idle',
      imported: { history: 7, bookmarks: 3 }, lastRunAt: null,
    }))
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expectDOM(sync).not.toBeChecked()
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
  }, browserCaseTimeout)

  it.each(['rollback', 'delete'])('ignores an old %s result after a new import in the same workspace', async (action) => {
    await load('categories=credentials')
    await choose()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expectDOM(page.getByRole('button', { name: 'Rollback last import', exact: true })).toBeEnabled()
    await page.evaluate((value) => (window as any).__credentialFixture.deferMutation(value), action)
    await page.getByRole('button', { name: action === 'rollback' ? 'Rollback last import' : 'Delete imported data', exact: true }).click()
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-b'))
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-a'))
    await page.getByRole('radio').first().check()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expectDOM(page.getByRole('button', { name: 'Rollback last import', exact: true })).toBeEnabled()
    await page.evaluate((value) => (window as any).__credentialFixture.resolveMutation(value === 'rollback' ? { ok: true } : { deletionReceipt: null }), action)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expectDOM(page.getByRole('button', { name: 'Rollback last import', exact: true })).toBeEnabled()
    const passwords = page.getByTestId('browser-profile-import-summary').locator('div').filter({ has: page.locator('span', { hasText: /^Password files$/ }) })
    await expectDOM(passwords.locator('span').first()).toHaveText('2')
  }, browserCaseTimeout)

  it('ignores a delayed capability from an old workspace and selected profile', async () => {
    await load('categories=credentials&capability=deferred')
    await choose()
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-b'))
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await page.getByRole('radio').nth(1).check()
    await page.evaluate(() => {
      const fixture = (window as any).__credentialFixture
      fixture.resolveCapability('workspace-b', 'firefox:synthetic', { supported: false, mechanism: null })
      fixture.resolveCapability('workspace-a', 'chromium:synthetic', { supported: true, mechanism: 'linux-secret-service' })
    })
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Unavailable')
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  }, browserCaseTimeout)

  it('ignores an old import after switching away and back to its workspace', async () => {
    await load('categories=credentials&outcome=deferred')
    await choose()
    await expectDOM(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-b'))
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await page.evaluate(() => (window as any).__credentialFixture.setWorkspace('workspace-a'))
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Choose a browser profile')
    await page.evaluate(() => (window as any).__credentialFixture.resolveImport({ dryRun: false, profileId: 'chromium:synthetic', counts: { history: 0, bookmarks: 0, cookies: 0, credentials: 99, skipped: 0 }, accessedStores: ['credentials'], rollbackToken: 'stale', deletionReceipt: null, credentialAccess: 'granted' }))
    await expectDOM(page.getByTestId('browser-profile-import-summary')).toHaveCount(0)
  }, browserCaseTimeout)

  it('explains native confirmation and the possible key-store unlock in Russian', async () => {
    await page.goto(`${fixtureUrl}/?lang=ru&categories=credentials`)
    await expectDOM(page.getByTestId('browser-profile-manual-toggle')).toBeVisible()
    await choose()
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Перед каждой проверкой или импортом Rox запросит подтверждение')
    await expectDOM(page.getByTestId('browser-profile-os-access')).toContainText('Система может попросить разблокировать хранилище ключей')
    await expectDOM(page.getByRole('switch', { name: 'Файлы паролей', exact: true })).toBeChecked()
    await proof('supported-ru')
  }, browserCaseTimeout)
})
