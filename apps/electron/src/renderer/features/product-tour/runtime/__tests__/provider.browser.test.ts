import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noteNativeBrowserStage as stage, runNativeBrowserProcess } from '../../adapters/work/meetings-automations/native-browser-process'

let browser: Browser
let server: ReturnType<typeof Bun.serve>
const root = resolve(import.meta.dir, '../../../../../../../..')
const isolatedCase = process.env.ROX_PRODUCT_TOUR_PROVIDER_CASE
let registeredIsolatedCase = false
beforeAll(async () => {
  if (!isolatedCase) return
  stage('provider:bundle:start')
  const compiled = await build({ entryPoints: [resolve(import.meta.dir, 'fixtures/provider.browser.tsx')], bundle: true,
    write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: resolve(root, 'apps/electron/tsconfig.json'),
    plugins: [{ name: 'isolated-provider-bootstrap', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === '@/contexts/NavigationContext') return { path: 'navigation', namespace: 'fixture' }
        if (args.path === 'react-i18next') return { path: 'i18n', namespace: 'fixture' }
        if (args.path === '../ui' && args.importer.endsWith('/runtime/ProductTourProvider.tsx')) return { path: 'presentation', namespace: 'fixture' }
        return null
      })
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root,
        contents: args.path === 'navigation'
          ? `import {useSyncExternalStore} from 'react'; export const useNavigation=()=>useSyncExternalStore(window.learningProviderTest.subscribe,()=>window.learningProviderTest.navSnapshot);`
          : args.path === 'i18n' ? `export const useTranslation=()=>({t:key=>key});`
            : `import * as React from 'react';
              export {createTargetRegistry} from '${resolve(root, 'apps/electron/src/renderer/features/product-tour/ui/target-registry.ts')}';
              export {TourErrorBoundary} from '${resolve(root, 'apps/electron/src/renderer/features/product-tour/ui/TourErrorBoundary.tsx')}';
              import {SpotlightOverlay as ActualOverlay} from '${resolve(root, 'apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx')}';
              export function SpotlightOverlay(props){if(window.learningProviderTest.failPresentation)throw new Error('Intentional presentation fault');return <ActualOverlay {...props}/>;}`,
      }))
    } }],
  })
  const script = compiled.outputFiles[0]!.text
  stage('provider:bundle:ready')
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/script.js' ? new Response(script, { headers: { 'Content-Type': 'application/javascript' } })
      : new Response('<!doctype html><div id="root"></div><script src="/script.js"></script>', { headers: { 'Content-Type': 'text/html' } })
  } })
  stage('provider:browser:launch')
  browser = await chromium.launch({ executablePath: process.env.LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
  stage('provider:browser:ready')
}, 30_000)
afterAll(async () => {
  if (!isolatedCase) return
  stage('provider:browser:close')
  await browser?.close()
  server?.stop(true)
  stage('provider:browser:closed')
}, 30_000)

// Keep the production bundle and browser lifecycle independent of other Bun suites.
// The child budget includes its 30s setup, unchanged case deadline and 30s teardown.
function browserTest(name: string, operation: () => Promise<void>, timeout: number) {
  if (isolatedCase && isolatedCase !== name) return
  if (isolatedCase) registeredIsolatedCase = true
  test(name, async () => {
    if (isolatedCase === name) {
      stage('provider:case:start')
      await operation()
      stage('provider:case:passed')
      return
    }
    const code = await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], {
      label: name, env: { ...process.env, ROX_PRODUCT_TOUR_PROVIDER_CASE: name }, deadlineMs: 80_000,
    })
    expect(code).toBe(0)
  }, isolatedCase ? timeout : 90_000)
}
async function setup() {
  stage('provider:fixture:page')
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  stage('provider:fixture:navigate')
  await page.goto(server.url.href)
  stage('provider:fixture:controller')
  await page.waitForFunction(() => (window as any).learningProviderTest?.controller?.ready)
  stage('provider:fixture:ready')
  return page
}
async function eventually(read: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await read()) return
    await Bun.sleep(25)
  }
  expect(await read()).toBe(true)
}
async function pauseLibrary(page: Page) {
  await page.evaluate(() => (window as any).learningProviderTest.controller.start('OBT-25'))
  await page.waitForSelector('[data-product-tour-step="learning.library"]')
  await page.locator('[data-product-tour-popover]').getByRole('button', { name: 'productTour.controls.pause', exact: true }).click()
  await page.waitForFunction(() => (window as any).learningProviderTest.controller.state.phase === 'paused')
  await eventually(() => page.evaluate(() => new Promise<boolean>(resolve => {
    const request = indexedDB.open('rox-product-tour')
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction('leases').objectStore('leases').getAll()
      read.onsuccess = () => { db.close(); resolve(read.result.every((lease: any) => lease.expiresAt === 0)) }
    }
  })))
}

browserTest('paused Dismiss reacquires ownership and persists dismissal across a fresh repository', async () => {
  const page = await setup()
  try {
    await pauseLibrary(page)
    await page.getByTestId('product-tour-status').getByRole('button', { name: 'productTour.controls.dismiss' }).click()
    await eventually(() => page.evaluate(async () => {
      const result = await (window as any).learningProviderTest.read('OBT-25')
      return result.status === 'saved' && result.value?.status === 'dismissed' && result.value.dismissedUntilVersion === 1
    }))
    expect(await page.evaluate(() => (window as any).learningProviderTest.controller.state.phase)).toBe('finished')
    await page.reload()
    await page.waitForFunction(() => (window as any).learningProviderTest?.controller?.ready)
    expect(await page.evaluate(async () => (await (window as any).learningProviderTest.read('OBT-25')).value?.status)).toBe('dismissed')
  } finally { await page.close() }
}, 15_000)

browserTest('reset refuses a foreign window lease, preserves its progress, then succeeds after release', async () => {
  const page = await setup()
  try {
    await pauseLibrary(page)
    await page.evaluate(() => (window as any).learningProviderTest.holdForeignLease())
    await page.evaluate(() => (window as any).learningProviderTest.controller.reset())
    expect(await page.evaluate(async () => {
      const result = await (window as any).learningProviderTest.read('OBT-25')
      return result.status === 'saved' && result.value?.steps['learning.library']?.shownAt !== undefined
    })).toBeTrue()
    expect(await page.getByTestId('product-tour-status').textContent()).toContain('productTour.reasons.lease-lost')
    await page.evaluate(() => (window as any).learningProviderTest.releaseForeignLease())
    await page.evaluate(() => (window as any).learningProviderTest.controller.reset())
    expect(await page.evaluate(() => (window as any).learningProviderTest.read('OBT-25'))).toEqual({ status: 'saved', value: null })
  } finally { await page.close() }
}, 15_000)

browserTest('Dismiss cannot write another window owner, and can persist after that owner releases', async () => {
  const page = await setup()
  try {
    await pauseLibrary(page)
    await page.evaluate(() => (window as any).learningProviderTest.holdForeignLease())
    await page.getByTestId('product-tour-status').getByRole('button', { name: 'productTour.controls.dismiss' }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="product-tour-status"]')?.textContent?.includes('productTour.reasons.lease-lost'), undefined, { timeout: 5_000 })
    expect(await page.evaluate(async () => (await (window as any).learningProviderTest.read('OBT-25')).value?.status)).toBe('in-progress')
    await page.evaluate(() => (window as any).learningProviderTest.releaseForeignLease())
    await page.getByTestId('product-tour-status').getByRole('button', { name: 'productTour.controls.dismiss' }).click()
    await eventually(() => page.evaluate(async () => (await (window as any).learningProviderTest.read('OBT-25')).value?.status === 'dismissed'))
  } finally { await page.close() }
}, 15_000)

browserTest('a presentation failure is contained and a new attempt renders with a fresh boundary', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => { (window as any).learningProviderTest.failPresentation = true; return (window as any).learningProviderTest.controller.start('OBT-25') })
    await page.waitForFunction(() => (window as any).learningProviderTest.controller.state.phase === 'paused')
    expect(await page.locator('main').textContent()).toContain('Learning library')
    await page.evaluate(() => { (window as any).learningProviderTest.failPresentation = false; return (window as any).learningProviderTest.controller.start('OBT-25', 'resume') })
    await page.waitForSelector('[data-product-tour-step="learning.library"]', { timeout: 5_000 })
    expect(await page.evaluate(() => (window as any).learningProviderTest.controller.state.phase)).toBe('presenting')
  } finally { await page.close() }
}, 15_000)

browserTest('OBT-22 preserves an existing selected meeting and accepts the native artifact observation', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => (window as any).learningProviderTest.navigate('meetings/meeting/meeting-a'))
    await page.waitForFunction(() => (window as any).learningProviderTest.navSnapshot.navigationState.details?.meetingId === 'meeting-a')
    await page.evaluate(() => (window as any).learningProviderTest.controller.start('OBT-22'))
    await page.waitForSelector('[data-product-tour-step="meetings.list"]')
    expect(await page.evaluate(() => (window as any).learningProviderTest.controller.state.attempt.binding.entityId)).toBe('meeting-a')
    await page.locator('[data-product-tour-popover]').getByRole('button', { name: 'productTour.controls.next', exact: true }).click()
    await page.waitForSelector('[data-product-tour-step="meetings.result"]')
    await page.getByRole('button', { name: 'Open existing artifact' }).click()
    await eventually(() => page.evaluate(async () => {
      const result = await (window as any).learningProviderTest.read('OBT-22')
      return result.status === 'saved' && result.value?.steps['meetings.result']?.observedAt !== undefined
    }))
    const result = await page.evaluate(() => (window as any).learningProviderTest.read('OBT-22'))
    expect(result.value.steps['meetings.result'].observedAt).toBeNumber()
    expect(result.value.steps['meetings.result'].verifiedAt).toBeUndefined()
    expect(await page.evaluate(() => (window as any).learningProviderTest.controller.state.phase)).toBe('finished')
    expect(await page.evaluate(() => (window as any).learningProviderTest.meetingObservation.binding.entityId)).toBe('meeting-a')
  } finally { await page.close() }
}, 15_000)

browserTest('blocked Dismiss persists after the capability failure released ownership', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => (window as any).learningProviderTest.controller.start('OBT-24'))
    await page.waitForFunction(() => (window as any).learningProviderTest.controller.state.phase === 'blocked')
    await page.getByTestId('product-tour-status').getByRole('button', { name: 'productTour.controls.dismiss' }).click()
    await eventually(() => page.evaluate(async () => (await (window as any).learningProviderTest.read('OBT-24')).value?.status === 'dismissed'))
    expect(await page.evaluate(() => (window as any).learningProviderTest.controller.state.phase)).toBe('finished')
  } finally { await page.close() }
}, 15_000)

browserTest('reset awaiting storage aborts on workspace change and preserves both partitions', async () => {
  const page = await setup()
  try {
    await pauseLibrary(page)
    await page.evaluate(() => (window as any).learningProviderTest.seedWorkspace('workspace-b'))
    await page.evaluate(() => (window as any).learningProviderTest.holdStorage())
    await page.evaluate(() => { (window as any).learningProviderTest.pendingReset = (window as any).learningProviderTest.controller.reset() })
    await page.evaluate(() => (window as any).learningProviderTest.switchWorkspace('workspace-b'))
    await page.waitForFunction(() => !(window as any).learningProviderTest.controller.ready)
    await page.evaluate(() => (window as any).learningProviderTest.releaseStorage())
    await page.evaluate(() => (window as any).learningProviderTest.pendingReset)
    await page.waitForFunction(() => (window as any).learningProviderTest.controller.ready)
    await eventually(() => page.evaluate(async () => {
      const f = (window as any).learningProviderTest
      const a = await f.read('OBT-25', 'workspace-a')
      const b = await f.read('OBT-25', 'workspace-b')
      return a.value?.steps['learning.library']?.shownAt !== undefined && b.value?.steps['learning.library']?.shownAt === 1
        && f.controller.progress['OBT-25']?.steps['learning.library']?.shownAt === 1
    }))
  } finally { await page.close() }
}, 15_000)

browserTest('a lost fence during Dismiss preserves durable progress and reports ownership failure', async () => {
  const page = await setup()
  try {
    await pauseLibrary(page)
    // The lease changes after acquisition and before the guarded progress transaction.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: any, key?: IDBValidKey) {
        if (this.name === 'leases') {
          IDBObjectStore.prototype.put = put
          return put.call(this, { ...value, ownerWindowId: 'taken-over-owner', fence: value.fence + 1 }, key)
        }
        return put.call(this, value, key)
      }
    })
    await page.getByTestId('product-tour-status').getByRole('button', { name: 'productTour.controls.dismiss' }).click()
    await eventually(() => page.evaluate(() => document.querySelector('[data-testid="product-tour-status"]')?.textContent?.includes('productTour.reasons.lease-lost') ?? false))
    expect(await page.evaluate(async () => (await (window as any).learningProviderTest.read('OBT-25')).value?.status)).toBe('in-progress')
  } finally { await page.close() }
}, 15_000)

if (isolatedCase && !registeredIsolatedCase) throw new Error(`Unknown provider regression case: ${isolatedCase}`)
