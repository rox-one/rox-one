import { test, expect, chromium } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Real browser zoom through Chrome's native tabs API, never CSS/DPR emulation. */
test('actual Chromium browser 200 percent zoom preserves the mounted chat and dock', async ({ request }, info) => {
  expect((await request.post('http://127.0.0.1:4177/reset', { data: {} })).ok()).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'rox-browser-zoom-'))
  const extension = join(directory, 'zoom-extension')
  await mkdir(extension)
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'ROX isolated browser zoom fixture', version: '1.0.0', permissions: ['tabs'], background: { service_worker: 'zoom.js' } }))
  await writeFile(join(extension, 'zoom.js'), `chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === 'complete' && tab.url?.startsWith('http://127.0.0.1:4176/')) chrome.tabs.setZoom(tabId, 2);
  });`)
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    executablePath: chromium.executablePath(), headless: false, viewport: null,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--headless=new', '--window-size=1440,900', '--force-device-scale-factor=1', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const page = context.pages()[0] ?? await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:4176/', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2)
    const actualZoom = await worker.evaluate(async () => {
      const chromeApi = (globalThis as unknown as { chrome: { tabs: {
        query(query: Record<string, unknown>): Promise<{ id: number; url: string }[]>
        getZoom(tabId: number): Promise<number>
      } } }).chrome
      const tabs = await chromeApi.tabs.query({})
      const fixtureTab = tabs.find(tab => tab.url.startsWith('http://127.0.0.1:4176/'))
      if (!fixtureTab) throw new Error('Fixture tab was not found')
      return chromeApi.tabs.getZoom(fixtureTab.id)
    })
    expect(actualZoom).toBe(2)
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.fill('Черновик при масштабе 200%')
    await page.getByTestId('attach-fixture').click()
    await page.getByTestId('start-run').click()
    await expect(page.getByTestId('received-count')).toHaveText('2')
    await page.getByTestId('step-run').click()
    await expect(page.getByTestId('received-count')).toHaveText('3')
    await page.getByTestId('toggle-map').click()
    await expect(page.getByTestId('runtime-map-dock')).toBeVisible()
    await expect(page.getByTestId('runtime-chat-slot')).toBeVisible()
    await expect(editor).toHaveText('Черновик при масштабе 200%')
    await expect(page.getByTestId('attachments-count')).toHaveText('1')
    expect(await page.evaluate(() => (window as unknown as { runtimeDiagnostics: { chatMounts: number; chatSends: number } }).runtimeDiagnostics)).toMatchObject({ chatMounts: 1, chatSends: 0 })
    const metrics = await page.evaluate(() => ({ devicePixelRatio, cssViewportWidth: innerWidth, cssViewportHeight: innerHeight, visualViewportScale: visualViewport?.scale }))
    await page.screenshot({ path: info.outputPath('actual-browser-zoom-200.png'), fullPage: true })
    await info.attach('actual-browser-zoom.json', { body: JSON.stringify({ actualZoom, mechanism: 'Chrome native tabs.setZoom/getZoom; isolated local extension', metrics, errors }, null, 2), contentType: 'application/json' })
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await rm(directory, { recursive: true, force: true })
  }
})
