import { test, expect } from '@playwright/test'
import { measureRuntimeCardVisibility } from './visible-cards'

const server = 'http://127.0.0.1:4177'

test('actual Fit overview shows the 200-card runtime window before panning', async ({ page, request }, info) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  expect((await request.post(`${server}/reset`, { data: {} })).ok()).toBe(true)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('toggle-map').click()
  await expect(page.getByTestId('runtime-map-dock')).toBeVisible()
  const fixture = await page.evaluate(async () => (window as unknown as {
    runtimePerformance: { load(): Promise<Record<string, number>> }
  }).runtimePerformance.load())
  expect(fixture.fixtureEvents).toBe(10_000)
  expect(fixture.projectedNodes).toBe(221)
  expect(fixture.agents).toBe(20)
  await expect(page.locator('.runtime-node-tool').first()).toBeVisible()
  await page.getByRole('button', { name: 'Показать видимые события целиком', exact: true }).click()
  const readVisibility = () => measureRuntimeCardVisibility(page)
  await expect.poll(async () => (await readVisibility()).physicallyPaintable).toBe(200)
  await expect(page.getByTestId('runtime-canvas')).toHaveAttribute('data-runtime-presentation', 'overview')
  await page.evaluate(() => document.fonts.ready)
  const visibility = await readVisibility()
  await page.screenshot({ path: info.outputPath('runtime-map-dense-fit-overview.png'), fullPage: true })
  await info.attach('runtime-overview.json', { body: JSON.stringify({
    classification: 'production renderer with explicitly synthetic typed fixture; overview proof, no new latency claim',
    fixture, visibility, capturedBeforePan: true,
    camera: await page.evaluate(() => JSON.parse(localStorage.getItem('rox.runtime-map.camera:fixture-workspace:fixture-session:test-panel') ?? '{}')),
    pageErrors,
  }, null, 2), contentType: 'application/json' })
  const tool = page.locator('.runtime-node-tool').first()
  const selectedId = await tool.getAttribute('data-runtime-id')
  const selectedTitle = await tool.locator('header strong').innerText()
  await tool.click()
  await expect(page.getByTestId('runtime-canvas')).toHaveAttribute('data-runtime-presentation', 'timeline')
  await expect(page.getByTestId('runtime-inspector').locator('.runtime-inspector-header strong')).toHaveText(selectedTitle)
  await expect(page.locator('.runtime-node[data-selected="true"]')).toHaveAttribute('data-runtime-id', selectedId!)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rox.runtime-map.camera:fixture-workspace:fixture-session:test-panel') ?? '{}').zoom)).toBe(1)
  await page.screenshot({ path: info.outputPath('overview-focus-return.png'), fullPage: true })
  await info.attach('overview-focus-return.json', { body: JSON.stringify({ selectedId, selectedTitle,
    presentation: await page.getByTestId('runtime-canvas').getAttribute('data-runtime-presentation'),
    camera: await page.evaluate(() => JSON.parse(localStorage.getItem('rox.runtime-map.camera:fixture-workspace:fixture-session:test-panel') ?? '{}')),
  }, null, 2), contentType: 'application/json' })
  expect(pageErrors).toEqual([])
})
