import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import type { TourCapability } from '../../contracts'
import { runNativeBrowserProcess } from '../work/meetings-automations/native-browser-process'
declare global { interface Window { sourcePickerTest: { stats: { paused: number; captured: number; committed: number; selected: string[]; nativeLayers(): number; readiness: TourCapability | null }; mount(enabled: boolean, localMcpEnabled?: boolean | null, compact?: boolean, preselected?: boolean): void } } }
const isolatedCase = process.env.ROX_PRODUCT_TOUR_SOURCE_PICKER_CASE
let registeredIsolatedCase = false
let browser: Browser
let server: ReturnType<typeof Bun.serve>
beforeAll(async () => {
  if (!isolatedCase) return
  const built = await build({ entryPoints: [fileURLToPath(new URL('./source-picker.browser.tsx', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, outdir: 'source-picker-browser', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, plugins: [{ name: 'unused-vite-url-assets', setup(build) { build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'unused-url-asset' })); build.onLoad({ filter: /.*/, namespace: 'unused-url-asset' }, () => ({ contents: "export default 'about:blank'", loader: 'js' })) } }], tsconfig: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)) })
  const script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return new URL(request.url).pathname === '/script.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/script.js"></script></body></html>', { headers: { 'content-type': 'text/html' } }) } })
  browser = await chromium.launch({ executablePath: process.env.LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
}, 30_000)
afterAll(async () => { await browser?.close(); server?.stop(true) }, 30_000)

// Keep the production bundle, browser lifecycle and native registries independent of
// other suites' Bun module caches and Playwright cleanup. Each child runs real assertions.
function browserTest(name: string, operation: () => Promise<void>) {
  if (isolatedCase && isolatedCase !== name) return
  if (isolatedCase) registeredIsolatedCase = true
  test(name, async () => {
    if (isolatedCase === name) return operation()
    const exitCode = await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], {
      label: name, env: { ...process.env, ROX_PRODUCT_TOUR_SOURCE_PICKER_CASE: name },
      // Supervision includes setup, the unchanged case, and owned teardown.
      deadlineMs: 90_000,
    })
    expect(exitCode).toBe(0)
  }, isolatedCase ? 30_000 : 100_000)
}

browserTest('T-SOURCES-SELECT custom portal owns native handoff so source click captures and commits before any outside pause', async () => {
  const page = await browser.newPage()
  page.on('pageerror', error => console.error('Source-picker browser error:', error.message))
  try {
    await page.goto(server.url.href)
    await page.waitForFunction(() => !!window.sourcePickerTest)
    await page.evaluate(() => window.sourcePickerTest.mount(true))
    await page.getByRole('button', { name: 'Choose sources' }).click()
    await page.waitForFunction(() => window.sourcePickerTest.stats.nativeLayers() > 0)
    await page.getByText('Native source A', { exact: true }).click()
    const result = await page.evaluate(() => { const s = window.sourcePickerTest.stats; return { paused: s.paused, captured: s.captured, committed: s.committed, selected: s.selected } })
    expect(result).toEqual({ paused: 0, captured: 1, committed: 1, selected: ['a'] })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.sourcePickerTest.stats.nativeLayers() === 0)
  } finally { await page.close() }
})

browserTest('APP-06 disabled learning preserves source selection and adds no native layer registrations or captures', async () => {
  const page = await browser.newPage()
  page.on('pageerror', error => console.error('Source-picker browser error:', error.message))
  try {
    await page.goto(server.url.href)
    await page.waitForFunction(() => !!window.sourcePickerTest)
    await page.evaluate(() => window.sourcePickerTest.mount(false))
    await page.getByRole('button', { name: 'Choose sources' }).click()
    await page.getByText('Native source A', { exact: true }).click()
    expect(await page.evaluate(() => { const s = window.sourcePickerTest.stats; return { layers: s.nativeLayers(), paused: s.paused, captured: s.captured, committed: s.committed, selected: s.selected } })).toEqual({ layers: 0, paused: 0, captured: 0, committed: 0, selected: ['a'] })
  } finally { await page.close() }
})

for (const compact of [false, true]) {
  browserTest(`DOMAIN-06 ${compact ? 'compact' : 'regular'} picker respects disabled and unknown native local-MCP policy`, async () => {
    const page = await browser.newPage()
    try {
      await page.goto(server.url.href)
      await page.waitForFunction(() => !!window.sourcePickerTest)
      await page.evaluate(compact => window.sourcePickerTest.mount(true, false, compact, true), compact)
      await page.waitForFunction(() => window.sourcePickerTest.stats.readiness?.state === 'unavailable')
      expect(await page.evaluate(() => window.sourcePickerTest.stats.readiness)).toEqual({ state: 'unavailable', reason: 'not-connected' })
      await page.evaluate(compact => window.sourcePickerTest.mount(true, null, compact, true), compact)
      await page.waitForFunction(() => window.sourcePickerTest.stats.readiness?.state === 'pending')
      expect(await page.evaluate(() => window.sourcePickerTest.stats.readiness)).toEqual({ state: 'pending', reason: 'api-unavailable' })
      await page.evaluate(compact => window.sourcePickerTest.mount(true, true, compact, true), compact)
      await page.waitForFunction(() => window.sourcePickerTest.stats.readiness?.state === 'ready')
      expect(await page.evaluate(() => window.sourcePickerTest.stats.readiness)).toEqual({ state: 'ready' })
    } finally { await page.close() }
  })
}
if (isolatedCase && !registeredIsolatedCase) throw new Error(`Unknown source picker isolation case: ${isolatedCase}`)
