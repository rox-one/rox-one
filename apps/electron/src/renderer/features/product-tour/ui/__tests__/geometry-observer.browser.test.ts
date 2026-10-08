import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { resolveChromiumExecutable } from '../../../../test-utils/chromium-executable'

let browser: Browser
let productionScript: string
beforeAll(async () => {
  const build = await Bun.build({ entrypoints: [import.meta.dir + '/fixtures/geometry-observer.browser.ts'], target: 'browser' })
  expect(build.success).toBe(true)
  productionScript = await build.outputs[0]!.text()
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(), args: ['--no-sandbox'] })
}, 20_000)
afterAll(async () => { await browser?.close() })

async function setup() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await page.setContent('<div id="toolbar" style="display:flex;width:600px;height:40px;margin:100px;transition:transform 180ms linear"><button id="target" style="flex:none;width:60px;height:30px">Target</button></div>')
  await page.addScriptTag({ content: productionScript })
  await page.evaluate(async () => {
    const api = window as any
    api.measurements = []
    api.resizeChanges = 0
    api.stopGeometry = api.__observeTourGeometry(document.getElementById('target'), (geometry: any) => api.measurements.push(geometry))
    api.sizeObserver = new ResizeObserver(() => api.resizeChanges++)
    api.sizeObserver.observe(document.getElementById('target'))
    api.sizeObserver.observe(document.getElementById('toolbar'))
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
    api.resizeChanges = 0
  })
  return page
}
async function error(page: Page) {
  return page.evaluate(() => {
    const actual = document.getElementById('target')!.getBoundingClientRect()
    const api = window as any
    const measured = api.measurements.at(-1)?.rect
    return { offset: measured ? Math.abs(measured.left - actual.left) : Infinity, resizeChanges: api.resizeChanges }
  })
}

test('UI-05 a sibling insertion moves the target while target and ancestor sizes stay constant', async () => {
  const page = await setup()
  try {
    const initial = await page.locator('#target').boundingBox()
    await page.evaluate(() => {
      const sibling = document.createElement('span')
      sibling.textContent = 'New toolbar control'
      sibling.style.cssText = 'display:block;flex:none;width:112px;height:30px'
      document.getElementById('toolbar')!.insertBefore(sibling, document.getElementById('target'))
    })
    await page.waitForTimeout(250)
    const actual = await page.locator('#target').boundingBox()
    expect(actual!.x - initial!.x).toBe(112)
    const result = await error(page)
    expect(result.resizeChanges).toBe(0)
    expect(result.offset).toBeLessThanOrEqual(2)
  } finally { await page.close() }
})

test('UI-05 CSS transform transition settles at the correct target position without a size change', async () => {
  const page = await setup()
  try {
    const initial = await page.locator('#target').boundingBox()
    await page.evaluate(() => { document.getElementById('toolbar')!.style.transform = 'translateX(112px)' })
    await page.waitForTimeout(350)
    const actual = await page.locator('#target').boundingBox()
    expect(actual!.x - initial!.x).toBe(112)
    const result = await error(page)
    expect(result.resizeChanges).toBe(0)
    expect(result.offset).toBeLessThanOrEqual(2)
  } finally { await page.close() }
})
