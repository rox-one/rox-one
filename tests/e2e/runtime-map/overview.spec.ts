import { test, expect } from '@playwright/test'

const server = 'http://127.0.0.1:4177'

test('actual Fit overview shows the 200-card runtime window before panning', async ({ page, request }, info) => {
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
  const readVisibility = () => page.getByTestId('runtime-node').evaluateAll(cards => {
    const viewport = document.querySelector('[data-testid="runtime-canvas"]')!.getBoundingClientRect()
    const visible = cards.filter(card => {
      const rect = card.getBoundingClientRect()
      return rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom
    })
    return { mounted: cards.length, visible: visible.length, viewport: { width: viewport.width, height: viewport.height } }
  })
  await expect.poll(async () => (await readVisibility()).visible).toBe(200)
  await page.evaluate(() => document.fonts.ready)
  const visibility = await readVisibility()
  await page.screenshot({ path: info.outputPath('runtime-map-dense-fit-overview.png'), fullPage: true })
  await info.attach('runtime-overview.json', { body: JSON.stringify({
    classification: 'production renderer with explicitly synthetic typed fixture; overview proof, no new latency claim',
    fixture, visibility, capturedBeforePan: true,
    camera: await page.evaluate(() => JSON.parse(localStorage.getItem('rox.runtime-map.camera:fixture-workspace:fixture-session:test-panel') ?? '{}')),
  }, null, 2), contentType: 'application/json' })
})
