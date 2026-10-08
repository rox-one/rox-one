import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { cpus, loadavg, platform, release, totalmem } from 'node:os'
import { measureRuntimeCardVisibility } from './visible-cards'

const server = 'http://127.0.0.1:4177'
test.beforeEach(async ({ request }) => { expect((await request.post(`${server}/reset`, { data: {} })).ok()).toBe(true) })
test.use({ trace: 'off', video: 'off' })
test('production ingress and canvas measure 10000-event 20-agent load', async ({ page }, info) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('toggle-map').click()
  await expect(page.getByTestId('runtime-map-dock')).toBeVisible()
  const profile = await page.evaluate(async () => (window as unknown as { runtimePerformance: { load(): Promise<Record<string, number>> } }).runtimePerformance.load())
  expect(profile.fixtureEvents).toBe(10_000)
  expect(profile.projectedNodes).toBe(221)
  expect(profile.agents).toBe(20)
  expect(profile.mountedCards).toBeLessThan(20)
  await expect(page.locator('.runtime-node-tool').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const metricsSession = await page.context().newCDPSession(page)
  await metricsSession.send('Performance.enable')
  const snapshotMetrics = async () => Object.fromEntries((await metricsSession.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
  const eventMetricsBefore = await snapshotMetrics()
  const profiler = process.env.ROX_RUNTIME_PROFILE === '1' ? await page.context().newCDPSession(page) : undefined
  const deltas: number[] = []
  for (let index = 0; index < 20; index++) deltas.push(await page.evaluate(async () => (window as unknown as { runtimePerformance: { measureVisibleUpdate(): Promise<number> } }).runtimePerformance.measureVisibleUpdate()))
  await page.getByRole('button', { name: 'Показать видимые события целиком', exact: true }).click()
  await expect.poll(() => page.getByTestId('runtime-node').count()).toBeGreaterThanOrEqual(180)
  await expect.poll(async () => (await measureRuntimeCardVisibility(page)).physicallyPaintable).toBe(200)
  const denseVisibility = await measureRuntimeCardVisibility(page)
  const denseMountedCards = denseVisibility.mounted
  const denseVisibleCards = denseVisibility.physicallyPaintable
  // Capture the physical overview before the pan gesture can move it out of view.
  await page.screenshot({ path: info.outputPath('runtime-map-dense-fit-overview.png'), fullPage: true })
  const denseDeltas: number[] = []
  for (let index = 0; index < 20; index++) denseDeltas.push(await page.evaluate(async () => (window as unknown as { runtimePerformance: { measureVisibleUpdate(mode: 'completion-status'): Promise<number> } }).runtimePerformance.measureVisibleUpdate('completion-status')))
  const canvas = await page.getByTestId('runtime-canvas').boundingBox()
  if (!canvas) throw new Error('Canvas has no dimensions')
  const panMetricsBefore = await snapshotMetrics()
  const panStartedAt = performance.now()
  const loadBeforePan = loadavg()
  let tracingComplete: Promise<{ stream: string }> | undefined
  if (profiler) {
    tracingComplete = new Promise(resolve => profiler.once('Tracing.tracingComplete', resolve))
    await profiler.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' })
    await profiler.send('Profiler.enable'); await profiler.send('Profiler.start')
  }
  await page.evaluate(() => (window as unknown as { runtimePerformance: { startFrameMeasurement(): void } }).runtimePerformance.startFrameMeasurement())
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 40)
  await page.mouse.down()
  for (let index = 0; index < 60; index++) await page.mouse.move(canvas.x + canvas.width / 2 + Math.sin(index / 10) * 120, canvas.y + 40 + index, { steps: 2 })
  await page.mouse.up()
  const frames = await page.evaluate(() => (window as unknown as { runtimePerformance: { stopFrameMeasurement(): number[] } }).runtimePerformance.stopFrameMeasurement())
  const panElapsedMs = performance.now() - panStartedAt
  const panMetricsAfter = await snapshotMetrics()
  if (profiler) {
    const cpuProfile = await profiler.send('Profiler.stop')
    await info.attach('browser-cpu-profile.json', { body: JSON.stringify(cpuProfile), contentType: 'application/json' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(info.outputPath('browser-cpu-profile.json'), JSON.stringify(cpuProfile))
    await profiler.send('Tracing.end')
    const { stream } = await tracingComplete!
    let timeline = ''
    for (;;) { const chunk = await profiler.send('IO.read', { handle: stream }); timeline += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data; if (chunk.eof) break }
    await profiler.send('IO.close', { handle: stream })
    await writeFile(info.outputPath('browser-pan-timeline.json'), timeline)
  }
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * .95)] ?? Infinity
  const secondsMetrics = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']
  const readSystemValue = (path: string) => { try { return readFileSync(path, 'utf8').trim() } catch { return null } }
  const result = { class: 'renderer-component-performance', rendererBuild: 'vite-production', recording: false, cpuProfiler: !!profiler, syntheticFixture: true, measuredDelta: 'tool.completed result replacement on an existing span', viewport: { width: 1440, height: 900 }, profile,
    denseMountedCards, denseVisibleCards, denseVisibility, denseCamera: 'actual user Fit overview; each fully contained card >=40×8 CSS pixels with status SVG >=2×2; source identities retained',
    mountedCards: await page.getByTestId('runtime-node').count(), eventToVisiblePaintMs: deltas, eventToVisiblePaintP95Ms: p95(deltas),
    denseEventToVisiblePaintMs: denseDeltas, denseEventToVisiblePaintP95Ms: p95(denseDeltas), denseMeasuredDelta: 'running→succeeded status/icon on 20 distinct existing tool spans',
    panFrameMs: frames, panFrameP95Ms: p95(frames), browser: await page.evaluate(() => navigator.userAgent),
    pageErrors,
    chromiumPerformanceMetrics: { eventMetricsBefore, panMetricsBefore, panMetricsAfter, panElapsedMs,
      panDurationDeltasSeconds: Object.fromEntries(secondsMetrics.map(name => [name, panMetricsAfter[name] - panMetricsBefore[name]])),
      heapUnit: 'bytes', durationUnit: 'seconds; cumulative Chromium Performance.getMetrics counters; no CPU percentage inferred' },
    environment: { gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version,
      platform: platform(), release: release(), cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
      cgroupCpuMax: readSystemValue('/sys/fs/cgroup/cpu.max'), cgroupMemoryMax: readSystemValue('/sys/fs/cgroup/memory.max'), loadBeforePan, loadAfterPan: loadavg() } }
  await info.attach('browser-performance.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(info.outputPath('browser-performance.json'), JSON.stringify(result, null, 2))
  await page.screenshot({ path: info.outputPath('load-10000-events.png'), fullPage: true })
  expect(result.eventToVisiblePaintP95Ms).toBeLessThan(150)
  expect(result.denseEventToVisiblePaintP95Ms).toBeLessThan(150)
  expect(result.panFrameP95Ms).toBeLessThan(32)
  expect(pageErrors).toEqual([])
})
