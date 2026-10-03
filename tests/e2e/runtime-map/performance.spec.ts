import { test, expect } from '@playwright/test'

const server = 'http://127.0.0.1:4177'
test.beforeEach(async ({ request }) => { expect((await request.post(`${server}/reset`, { data: {} })).ok()).toBe(true) })
test.use({ trace: 'off', video: 'off' })
test('production ingress and canvas measure 10000-event 20-agent load', async ({ page }, info) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('toggle-map').click()
  await expect(page.getByTestId('runtime-map-dock')).toBeVisible()
  const profile = await page.evaluate(async () => (window as unknown as { runtimePerformance: { load(): Promise<Record<string, number>> } }).runtimePerformance.load())
  expect(profile.fixtureEvents).toBe(10_000)
  expect(profile.projectedNodes).toBe(221)
  expect(profile.agents).toBe(20)
  await expect(page.locator('.runtime-node-tool').first()).toBeVisible()
  const profiler = process.env.ROX_RUNTIME_PROFILE === '1' ? await page.context().newCDPSession(page) : undefined
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start') }
  const deltas: number[] = []
  for (let index = 0; index < 20; index++) deltas.push(await page.evaluate(async () => (window as unknown as { runtimePerformance: { measureVisibleUpdate(): Promise<number> } }).runtimePerformance.measureVisibleUpdate()))
  if (profiler) { const cpuProfile = await profiler.send('Profiler.stop'); await info.attach('browser-cpu-profile.json', { body: JSON.stringify(cpuProfile), contentType: 'application/json' }) }
  const canvas = await page.getByTestId('runtime-canvas').boundingBox()
  if (!canvas) throw new Error('Canvas has no dimensions')
  await page.evaluate(() => (window as unknown as { runtimePerformance: { startFrameMeasurement(): void } }).runtimePerformance.startFrameMeasurement())
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 40)
  await page.mouse.down()
  for (let index = 0; index < 60; index++) await page.mouse.move(canvas.x + canvas.width / 2 + Math.sin(index / 10) * 120, canvas.y + 40 + index, { steps: 2 })
  await page.mouse.up()
  const frames = await page.evaluate(() => (window as unknown as { runtimePerformance: { stopFrameMeasurement(): number[] } }).runtimePerformance.stopFrameMeasurement())
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * .95)] ?? Infinity
  const result = { class: 'renderer-component-performance', rendererBuild: 'vite-production', recording: false, cpuProfiler: !!profiler, syntheticFixture: true, measuredDelta: 'tool.completed result replacement on an existing span', viewport: { width: 1440, height: 900 }, profile,
    mountedCards: await page.getByTestId('runtime-node').count(), eventToVisiblePaintMs: deltas, eventToVisiblePaintP95Ms: p95(deltas),
    panFrameMs: frames, panFrameP95Ms: p95(frames), browser: await page.evaluate(() => navigator.userAgent) }
  await info.attach('browser-performance.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(info.outputPath('browser-performance.json'), JSON.stringify(result, null, 2))
  await page.screenshot({ path: info.outputPath('load-10000-events.png'), fullPage: true })
  expect(result.eventToVisiblePaintP95Ms).toBeLessThan(150)
  expect(result.panFrameP95Ms).toBeLessThan(32)
})
