import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'
const repository = resolve(import.meta.dirname, '../../../../../../..')
const fixture = resolve(import.meta.dirname, 'fixtures/optional-native-effects')
const executablePath = await resolveChromiumExecutable()
const url = 'http://127.0.0.1:5339'
type Fixture = { calls: Array<{ method: string; value?: unknown }>; toggle(): void; session(id: string): void; changed(id: string): void; reconnect(): void; resolve(index: number, name: string): void; held(): string[]; language(value: string): Promise<void>; allowLanguage(): void; stopLanguage(): void; resolveFocus(value: boolean): void; focus(value: boolean): void; capturedFocus(value: boolean): void }
describe.skipIf(!existsSync(executablePath))('actual optional native effects tolerate authority denial and fence their session lifecycle', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined, browser: Browser, page: Page
  const errors: string[] = []
  beforeAll(async () => {
    server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), '--config', resolve(fixture, 'vite.config.ts'), '--port', '5339'], { cwd: repository, stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + 30000
    for (;;) { if (server.exitCode !== null) throw new Error('Owned optional native fixture exited'); try { if ((await fetch(url)).ok) break } catch {} if (Date.now() > deadline) throw new Error('Optional native fixture startup timeout'); await Bun.sleep(100) }
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  }, 40000)
  beforeEach(async () => { errors.length = 0; page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)) })
  afterEach(async () => { try { expect(errors).toEqual([]) } finally { await page?.close() } })
  afterAll(async () => { server?.kill(); await browser?.close(); await server?.exited })
  const open = async (mode = 'denied') => { await page.goto(url + '/?mode=' + mode); await expectDOM(page.getByTestId('ready')).toBeVisible({ timeout: 20000 }) }
  const calls = () => page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.calls)
  const count = async (method: string) => (await calls()).filter(call => call.method === method).length
  it('denied watch and unwatch stay optional across real component mount, cleanup, remount and reload', async () => {
    await open(); await expectDOM(page.getByTestId('files')).toContainText('session-A.txt')
    await page.getByRole('button', { name: 'Toggle', exact: true }).click(); await expectDOM(page.getByTestId('files')).toHaveCount(0)
    await expectDOM.poll(() => count('unwatchSessionFiles')).toBe(1)
    await page.getByRole('button', { name: 'Toggle', exact: true }).click(); await expectDOM(page.getByTestId('files')).toContainText('session-A.txt')
    await expectDOM.poll(() => count('watchSessionFiles')).toBe(2)
    await page.reload(); await expectDOM(page.getByTestId('files')).toContainText('session-A.txt'); await page.waitForTimeout(100)
  }, 20000)
  it('reconnect retries a denied watcher and still loads the current session', async () => {
    await open(); await expectDOM(page.getByTestId('files')).toContainText('session-A.txt')
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.reconnect())
    await expectDOM.poll(() => count('getSessionFiles')).toBe(2)
    await expectDOM(page.getByTestId('files')).toContainText('session-A.txt'); await page.waitForTimeout(100)
  }, 15000)
  it('late files from A before A→B→A cannot overwrite the current A response', async () => {
    await open('held'); await expectDOM.poll(() => count('getSessionFiles')).toBe(1)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.session('session-B'))
    await expectDOM.poll(() => count('getSessionFiles')).toBe(2)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.session('session-A'))
    await expectDOM.poll(() => count('getSessionFiles')).toBe(3)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.resolve(2, 'current-A.txt'))
    await expectDOM(page.getByTestId('files')).toContainText('current-A.txt')
    await page.evaluate(() => { const state = (window as unknown as { __optionalNative: Fixture }).__optionalNative; state.resolve(0, 'private-old-A.txt'); state.resolve(1, 'private-B.txt') })
    await page.waitForTimeout(100); await expectDOM(page.getByTestId('files')).toContainText('current-A.txt'); await expectDOM(page.getByTestId('files')).not.toContainText('private-')
  }, 15000)
  it('populated A disappears synchronously under pending B and a successor A, including no-session cleanup', async () => {
    await open('held'); await expectDOM.poll(() => count('getSessionFiles')).toBe(1)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.resolve(0, 'visible-A.txt'))
    await expectDOM(page.getByTestId('files')).toContainText('visible-A.txt')
    const underB = await page.evaluate(() => { (window as unknown as { __optionalNative: Fixture }).__optionalNative.session('session-B'); return document.querySelector('[data-testid="files"]')?.textContent })
    expect(underB).not.toContain('visible-A.txt'); await expectDOM.poll(() => count('getSessionFiles')).toBe(2)
    const underNewA = await page.evaluate(() => { (window as unknown as { __optionalNative: Fixture }).__optionalNative.session('session-A'); return document.querySelector('[data-testid="files"]')?.textContent })
    expect(underNewA).not.toContain('visible-A.txt'); await expectDOM.poll(() => count('getSessionFiles')).toBe(3)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.resolve(2, 'successor-A.txt'))
    await expectDOM(page.getByTestId('files')).toContainText('successor-A.txt')
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.resolve(1, 'late-B.txt'))
    await page.waitForTimeout(100); await expectDOM(page.getByTestId('files')).not.toContainText('late-B.txt')
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.session(''))
    await expectDOM(page.getByTestId('files')).toBeEmpty(); expect(await count('getSessionFiles')).toBe(3)
  }, 15000)
  it('a newer files-changed read wins over a held older request for the same session', async () => {
    await open('held'); await expectDOM.poll(() => count('getSessionFiles')).toBe(1)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.changed('session-A'))
    await expectDOM.poll(() => count('getSessionFiles')).toBe(2)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.resolve(1, 'fresh.txt'))
    await expectDOM(page.getByTestId('files')).toContainText('fresh.txt')
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.resolve(0, 'stale.txt'))
    await page.waitForTimeout(100); await expectDOM(page.getByTestId('files')).not.toContainText('stale.txt')
  }, 15000)
  it('StrictMode can repeat denied watcher setup and cleanup without uncaught rejection', async () => {
    await open('strict'); await expectDOM(page.getByTestId('files')).toContainText('session-A.txt')
    await expectDOM.poll(() => count('watchSessionFiles')).toBe(2)
    await expectDOM.poll(() => count('unwatchSessionFiles')).toBe(1)
    await page.getByRole('button', { name: 'Toggle', exact: true }).click(); await expectDOM.poll(() => count('unwatchSessionFiles')).toBe(2); await page.waitForTimeout(100)
  }, 15000)
  it('language mirror sends one startup value, tolerates denial, retries changes and unsubscribes', async () => {
    await open(); await expectDOM.poll(() => count('changeLanguage')).toBe(1)
    await page.evaluate(() => (window as unknown as { __optionalNative: Fixture }).__optionalNative.language('ru'))
    await expectDOM.poll(() => count('changeLanguage')).toBe(2)
    await page.evaluate(async () => { const state = (window as unknown as { __optionalNative: Fixture }).__optionalNative; state.allowLanguage(); await state.language('en') })
    await expectDOM.poll(() => count('changeLanguage')).toBe(3)
    await page.evaluate(async () => { const state = (window as unknown as { __optionalNative: Fixture }).__optionalNative; state.stopLanguage(); await state.language('de') })
    await page.waitForTimeout(100); expect((await calls()).filter(call => call.method === 'changeLanguage').map(call => call.value)).toEqual(['en', 'ru', 'en'])
  }, 15000)
  it('denied badge refresh and automatic notifications preserve the mounted hook and allow another attempt', async () => {
    await open(); await expectDOM(page.getByTestId('focus')).toHaveText('false'); await expectDOM.poll(() => count('refreshBadge')).toBe(1)
    await page.getByRole('button', { name: 'Notify', exact: true }).click(); await expectDOM.poll(() => count('showNotification')).toBe(1)
    await page.getByRole('button', { name: 'Notify', exact: true }).click(); await expectDOM.poll(() => count('showNotification')).toBe(2); await page.waitForTimeout(100)
  }, 15000)
  it('late focus reads and callbacks after unmount cannot publish into a retired hook', async () => {
    await open('focus-held'); await expectDOM(page.getByTestId('focus')).toHaveText('true')
    await page.getByRole('button', { name: 'Toggle', exact: true }).click()
    await page.evaluate(() => { const state = (window as unknown as { __optionalNative: Fixture }).__optionalNative; state.resolveFocus(false); state.capturedFocus(false) })
    await page.waitForTimeout(100); await expectDOM(page.getByTestId('focus')).toHaveCount(0)
    expect((await calls()).filter(call => call.method.endsWith('Cleanup')).map(call => call.method).sort()).toEqual(['badgeCleanup', 'filesCleanup', 'focusCleanup', 'navigationCleanup', 'reconnectCleanup', 'windowsBadgeCleanup'].sort())
  }, 15000)
})
