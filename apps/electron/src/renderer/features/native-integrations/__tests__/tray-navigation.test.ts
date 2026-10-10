import { describe, expect, it, mock } from 'bun:test'
import type { DoctorReport } from '@rox/shared/service-lifecycle'
import { installTrayNavigation, runTrayDoctor } from '../tray-navigation'

const REPORT: DoctorReport = {
  generatedAt: 1_700_000_000_000,
  checks: [{ checkId: 'service-state', severity: 'ok', messageKey: 'doctor.check.serviceState', detail: { state: 'running' } }],
}

/** Minimal listener bus mirroring the `onMenu*` registrar contract. */
function createBus() {
  const handlers = new Map<string, Set<() => void>>()
  const on = (channel: string) => (handler: () => void) => {
    const set = handlers.get(channel) ?? new Set()
    set.add(handler)
    handlers.set(channel, set)
    return () => { set.delete(handler) }
  }
  return { on, emit: (channel: string) => { for (const handler of handlers.get(channel) ?? []) handler() } }
}

describe('tray navigation consumers', () => {
  it('routes the tray "Open dashboard" channel to the home dashboard', () => {
    const bus = createBus()
    const navigateHome = mock(() => {})
    const dispose = installTrayNavigation({
      onOpenDashboard: bus.on('menu:openDashboard'),
      onRunDoctor: bus.on('menu:runDoctor'),
      navigateHome,
      runDoctor: async () => REPORT,
      presentDoctor: () => {},
      reportError: () => {},
    })

    bus.emit('menu:openDashboard')
    expect(navigateHome).toHaveBeenCalledTimes(1)
    dispose()
    bus.emit('menu:openDashboard')
    expect(navigateHome).toHaveBeenCalledTimes(1)
  })

  it('routes the tray "Run diagnostics" channel to the host doctor handler', async () => {
    const bus = createBus()
    const runDoctor = mock(async () => REPORT)
    const presentDoctor = mock(() => {})
    const dispose = installTrayNavigation({
      onOpenDashboard: bus.on('menu:openDashboard'),
      onRunDoctor: bus.on('menu:runDoctor'),
      navigateHome: () => {},
      runDoctor,
      presentDoctor,
      reportError: () => {},
    })

    bus.emit('menu:runDoctor')
    await Promise.resolve()
    await Promise.resolve()
    expect(runDoctor).toHaveBeenCalledTimes(1)
    expect(presentDoctor).toHaveBeenCalledWith(REPORT)

    dispose()
  })
})

describe('runTrayDoctor', () => {
  it('presents the report the handler returns', async () => {
    const presentDoctor = mock(() => {})
    await runTrayDoctor({ runDoctor: async () => REPORT, presentDoctor, reportError: () => {} })
    expect(presentDoctor).toHaveBeenCalledWith(REPORT)
  })

  it('reports a handler failure instead of throwing', async () => {
    const reportError = mock(() => {})
    const failure = new Error('boom')
    await runTrayDoctor({ runDoctor: async () => { throw failure }, presentDoctor: () => {}, reportError })
    expect(reportError).toHaveBeenCalledWith(failure)
  })
})