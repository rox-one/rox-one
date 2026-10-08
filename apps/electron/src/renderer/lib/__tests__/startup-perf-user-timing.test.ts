import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'

// The module reads `window.roxStartupPerf` lazily; give it a controllable bridge.
const bridge: { enabled?: boolean; mark?: (name: string, epochMs: number) => void } = { enabled: false, mark: () => {} }
const hadWindow = 'window' in globalThis
;(globalThis as Record<string, unknown>).window ??= globalThis
;(globalThis as unknown as { roxStartupPerf: typeof bridge }).roxStartupPerf = bridge

const markSpy = spyOn(performance, 'mark')
const measureSpy = spyOn(performance, 'measure')

const perf = await import('../startup-perf')

function flushFrame(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 5))
}

describe('renderer startup-perf User Timing (PERF-01 review)', () => {
  beforeEach(() => {
    perf.resetRendererStartupPerfForTests()
    markSpy.mockClear()
    measureSpy.mockClear()
  })

  afterAll(() => {
    markSpy.mockRestore()
    measureSpy.mockRestore()
    delete (globalThis as Record<string, unknown>).roxStartupPerf
    if (!hadWindow) delete (globalThis as Record<string, unknown>).window
  })

  it('creates no performance entries when perf is disabled, but still records marks internally', async () => {
    bridge.enabled = false
    perf.markRenderer('renderer:test-mark')
    for (let i = 0; i < 20; i++) {
      perf.startRouteSwitch(`session/${i}`)
      perf.endRouteSwitch('session')
    }
    await flushFrame()
    expect(markSpy).not.toHaveBeenCalled()
    expect(measureSpy).not.toHaveBeenCalled()
    const dump = perf.dumpRendererPerf()
    expect(dump.marks.map(m => m.name)).toContain('renderer:test-mark')
    expect(dump.routeSwitches.length).toBeGreaterThan(0)
  })

  it('creates marks and measures when perf is enabled', async () => {
    bridge.enabled = true
    perf.markRenderer('renderer:enabled-mark')
    perf.startRouteSwitch('settings/x')
    perf.endRouteSwitch('settings')
    await flushFrame()
    const names = markSpy.mock.calls.map(call => call[0])
    expect(names).toContain('renderer:enabled-mark')
    expect(names).toContain('nav:start:settings')
    expect(names).toContain('nav:painted:settings')
    expect(measureSpy.mock.calls.map(call => call[0])).toContain('nav:settings')
  })
})
