import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import type { TourCapability } from '../../contracts'
import { noteNativeBrowserStage as stage, runNativeBrowserProcess } from '../work/meetings-automations/native-browser-process'
declare global { interface Window { sourcePickerTest: { stats: { paused: number; captured: number; committed: number; selected: string[]; nativeLayers(): number; readiness: TourCapability | null }; mount(enabled: boolean, localMcpEnabled?: boolean | null, compact?: boolean, preselected?: boolean): void } } }
const isolatedCase = process.env.ROX_PRODUCT_TOUR_SOURCE_PICKER_CASE
let registeredIsolatedCase = false
let browser: Browser
let server: ReturnType<typeof Bun.serve>
beforeAll(async () => {
  if (!isolatedCase) return
  stage('source-picker:bundle:start')
  const built = await build({ entryPoints: [fileURLToPath(new URL('./source-picker.browser.tsx', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, outdir: 'source-picker-browser', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, plugins: [{ name: 'unused-vite-url-assets', setup(build) { build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'unused-url-asset' })); build.onLoad({ filter: /.*/, namespace: 'unused-url-asset' }, () => ({ contents: "export default 'about:blank'", loader: 'js' })) } }], tsconfig: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)) })
  const script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text
  stage('source-picker:bundle:ready')
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return new URL(request.url).pathname === '/script.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/script.js"></script></body></html>', { headers: { 'content-type': 'text/html' } }) } })
  stage('source-picker:browser:launch')
  browser = await chromium.launch({ executablePath: process.env.LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  stage('source-picker:browser:ready')
}, 30_000)
afterAll(async () => {
  if (!isolatedCase) return
  stage('source-picker:browser:close')
  await browser?.close()
  server?.stop(true)
  stage('source-picker:browser:closed')
})

// Keep the production bundle, browser lifecycle and native registries independent of
// other suites' Bun module caches and Playwright cleanup. Each child runs real assertions.
function browserTest(name: string, operation: () => Promise<void>) {
  if (isolatedCase && isolatedCase !== name) return
  if (isolatedCase) registeredIsolatedCase = true
  test(name, async () => {
    if (isolatedCase === name) {
      stage('source-picker:case:start')
      await operation()
      stage('source-picker:case:passed')
      return
    }
    const exitCode = await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], {
      label: name, env: { ...process.env, ROX_PRODUCT_TOUR_SOURCE_PICKER_CASE: name }, deadlineMs: 35_000,
    })
    expect(exitCode).toBe(0)
  }, isolatedCase ? 30_000 : 40_000)
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
  stage('source-picker:disabled:page')
  const page = await browser.newPage()
  page.on('pageerror', error => console.error('Source-picker browser error:', error.message))
  try {
    stage('source-picker:disabled:navigate')
    await page.goto(server.url.href)
    stage('source-picker:disabled:bootstrap')
    await page.waitForFunction(() => !!window.sourcePickerTest)
    stage('source-picker:disabled:mount')
    await page.evaluate(() => window.sourcePickerTest.mount(false))
    stage('source-picker:disabled:open')
    await page.getByRole('button', { name: 'Choose sources' }).click()
    stage('source-picker:disabled:select')
    await page.getByText('Native source A', { exact: true }).click()
    stage('source-picker:disabled:assert')
    expect(await page.evaluate(() => { const s = window.sourcePickerTest.stats; return { layers: s.nativeLayers(), paused: s.paused, captured: s.captured, committed: s.committed, selected: s.selected } })).toEqual({ layers: 0, paused: 0, captured: 0, committed: 0, selected: ['a'] })
  } finally {
    stage('source-picker:disabled:close-page')
    await page.close()
    stage('source-picker:disabled:page-closed')
  }
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
