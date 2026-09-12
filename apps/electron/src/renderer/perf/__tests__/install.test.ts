import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPerfHarnessEnabled } from '../flags'
import { installRendererPerfHarness } from '../install'
import { attachLongTaskObserver, createReactCommitOnRender } from '../observers'
import { installSessionIpcProbe } from '../probe'
import { createInMemoryLongTaskHost } from '../runner'
import { PerfTelemetry } from '../telemetry'

describe('perf harness flags', () => {
  it('stays off unless env, query, or localStorage opts in', () => {
    const previous = process.env.CRAFT_PERF_HARNESS
    delete process.env.CRAFT_PERF_HARNESS
    expect(isPerfHarnessEnabled()).toBe(false)
    if (previous === undefined) delete process.env.CRAFT_PERF_HARNESS
    else process.env.CRAFT_PERF_HARNESS = previous
  })
})

describe('session IPC probe', () => {
  it('flags permission N+1 on getSessions followed by per-row reconcile', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({ id: `s-${i}` }))
    const api = {
      getSessions: async () => sessions,
      getSessionPermissionModeState: async (id: string) => ({ id, permissionMode: 'ask' }),
      getSessionProvenance: async () => null,
      getSessionMessages: async () => null,
    }
    const original = api.getSessions
    const probe = installSessionIpcProbe(api)
    const loaded = await api.getSessions()
    await Promise.all(loaded.map((session) => api.getSessionPermissionModeState(session.id)))
    expect(probe.ipc.get('sessions.list')).toBe(1)
    expect(probe.ipc.detectSessionMetadataNPlusOne(50)).toContain(
      'sessions.permission called 50 times for 50 sessions',
    )
    probe.restore()
    expect(api.getSessions).toBe(original)
  })

  it('accepts a batched list without per-session permission fetches', async () => {
    const api = {
      getSessions: async () => [{ id: 'a' }, { id: 'b' }],
    }
    const probe = installSessionIpcProbe(api)
    await api.getSessions()
    expect(probe.ipc.detectSessionMetadataNPlusOne(2)).toEqual([])
    probe.restore()
  })
})

describe('long-task and React commit observers', () => {
  it('records long tasks from PerformanceObserver and React Profiler commits', () => {
    const telemetry = new PerfTelemetry()
    const host = createInMemoryLongTaskHost()
    const observer = attachLongTaskObserver(telemetry, host)
    host.emit(52)
    createReactCommitOnRender(telemetry)('rox-root', 'mount', 4.5)
    expect(telemetry.longTasks[0]?.durationMs).toBe(52)
    expect(telemetry.reactCommits[0]?.durationMs).toBe(4.5)
    observer.disconnect()
  })
})

describe('renderer install', () => {
  it('keeps the renderer entry default-off (no workbench flag)', () => {
    const src = readFileSync(join(import.meta.dir, '../../main.tsx'), 'utf8')
    expect(src).toContain('installRendererPerfHarness()')
    expect(src).toContain('rendererPerfHarness.enabled')
    expect(src).not.toContain('workbenchEnabled')
    expect(src).not.toContain('CRAFT_PERF_HARNESS=1')
  })
  it('does not wrap ElectronAPI when the harness flag is off', async () => {
    let calls = 0
    const api = {
      getSessions: async () => {
        calls += 1
        return []
      },
    }
    const installed = installRendererPerfHarness(api, false)
    expect(installed.enabled).toBe(false)
    await api.getSessions()
    expect(calls).toBe(1)
    expect(installed.ipc.get('sessions.list')).toBe(0)
  })

  it('wraps ElectronAPI when explicitly enabled', async () => {
    const api = {
      getSessions: async () => [{ id: 's-1' }],
    }
    const installed = installRendererPerfHarness(api, true)
    expect(installed.enabled).toBe(true)
    await api.getSessions()
    expect(installed.ipc.get('sessions.list')).toBe(1)
    expect(installed.telemetry.payloads.length).toBe(1)
    installed.restore()
  })
})
