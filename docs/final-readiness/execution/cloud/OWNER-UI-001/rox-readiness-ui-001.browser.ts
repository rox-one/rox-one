import { chromium } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { buildMainFixture } from '../../../../../apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.component-harness'

const temp = mkdtempSync(join(import.meta.dir, 'rox-readiness-ui-001-temp-'))
const entry = await buildMainFixture(temp, true)
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  return new URL(request.url).pathname === '/fixture.js'
    ? new Response(Bun.file(entry), { headers: { 'Content-Type': 'application/javascript' } })
    : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } })
} })
const browser = await chromium.launch({ headless: true, ...(process.env.ROX_UI001_BROWSER_EXECUTABLE ? { executablePath: process.env.ROX_UI001_BROWSER_EXECUTABLE } : {}) })
const page = await browser.newPage()
const results: Array<{ name: string; pass: boolean; error?: string }> = []
const errors: string[] = []
page.on('pageerror', error => { errors.push(error.message) })
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: String(error) }) }
}
async function render(route: string, workspace = 'workspace-a') {
  await page.evaluate(({ route, workspace }) => (window as any).ui001.render({ route, workspace }), { route, workspace })
  await page.locator('[data-route-host]').waitFor({ timeout: 1500 })
}
async function sourceMount() { return page.locator('[data-route-host="SourceInfoPage"]').getAttribute('data-mount') }
try {
  await page.goto(`http://127.0.0.1:${server.port}`)
  await page.locator('[data-route-host="SourceInfoPage"]').waitFor()
  await check('Changing the selected source remounts its detail state', async () => {
    const mount = await sourceMount()
    await render('sources/source/two')
    await page.waitForFunction(() => document.querySelector('[data-route-host="SourceInfoPage"]')?.getAttribute('data-props')?.includes('two'))
    assert.notEqual(await sourceMount(), mount)
  })
  await check('Changing workspace cannot retain the previous source detail state', async () => {
    const mount = await sourceMount()
    await render('sources/source/two', 'workspace-b')
    await page.waitForFunction(() => document.querySelector('[data-route-host="SourceInfoPage"]')?.getAttribute('data-props')?.includes('workspace-b'))
    assert.notEqual(await sourceMount(), mount)
  })
  await check('A live deletion leaves the selected source on a specific missing surface', async () => {
    await page.evaluate(() => (window as any).ui001.sources('workspace-b', []))
    await page.locator('[data-testid="route-entity-missing"][data-route-family="source"]').waitFor({ timeout: 1000 })
    assert.equal(await page.locator('[data-testid="route-entity-missing"]').textContent(), 'sourceInfo.notFound')
  })
  await check('Recreating a selected source recovers its detail host', async () => {
    await page.evaluate(() => (window as any).ui001.sources('workspace-b', [{ config: { slug: 'two' } }]))
    await page.locator('[data-route-host="SourceInfoPage"]').waitFor({ timeout: 1000 })
  })
  await check('Foreign workspace events cannot remove the current selected source', async () => {
    await page.evaluate(() => (window as any).ui001.sources('foreign', []))
    assert.equal(await page.locator('[data-route-host="SourceInfoPage"]').count(), 1)
  })
  await render('skills/skill/one')
  await page.locator('[data-route-host="SkillInfoPage"]').waitFor()
  await check('A live deletion leaves the selected skill on a specific missing surface', async () => {
    await page.evaluate(() => (window as any).ui001.skills('workspace-a', []))
    await page.locator('[data-testid="route-entity-missing"][data-route-family="skill"]').waitFor({ timeout: 1000 })
    assert.equal(await page.locator('[data-testid="route-entity-missing"]').textContent(), 'skillInfo.notFound')
  })
  await check('Recreating a selected skill recovers its detail host', async () => {
    await page.evaluate(() => (window as any).ui001.skills('workspace-a', [{ slug: 'one' }]))
    await page.locator('[data-route-host="SkillInfoPage"]').waitFor({ timeout: 1000 })
  })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ environment: 'isolated headless Chromium component fixture; real MainContentPanel with leaf hosts and IPC event fixtures; not installed/native/hosted acceptance', browserVersion: browser.version(), results }, null, 2))
  if (results.some(result => !result.pass)) process.exitCode = 1
} finally { await browser.close(); server.stop(); rmSync(temp, { recursive: true, force: true }) }
