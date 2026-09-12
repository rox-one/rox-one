import { isPerfHarnessEnabled } from './flags'
import { IpcCallCounter } from './ipc-counter'
import { createReactCommitOnRender, attachLongTaskObserver } from './observers'
import { installSessionIpcProbe } from './probe'
import { PerfTelemetry } from './telemetry'
import type { ReactCommitOnRender } from './observers'

export interface InstalledPerfHarness {
  enabled: boolean
  ipc: IpcCallCounter
  telemetry: PerfTelemetry
  onRender: ReactCommitOnRender
  restore(): void
}

function emptyHarness(): InstalledPerfHarness {
  const ipc = new IpcCallCounter()
  const telemetry = new PerfTelemetry()
  return {
    enabled: false,
    ipc,
    telemetry,
    onRender: createReactCommitOnRender(telemetry),
    restore() {},
  }
}

/**
 * Default-off renderer install. Does not flip workbench flags.
 * When enabled: wraps session ElectronAPI, observes long tasks, records React commits.
 */
export function installRendererPerfHarness(
  api: { getSessions?: (...args: never[]) => unknown } | null | undefined = typeof window === 'undefined'
    ? null
    : (window as unknown as { electronAPI?: { getSessions?: (...args: never[]) => unknown } }).electronAPI,
  enabled = isPerfHarnessEnabled(),
): InstalledPerfHarness {
  if (!enabled) return emptyHarness()

  const ipc = new IpcCallCounter()
  const telemetry = new PerfTelemetry()
  const probe = api ? installSessionIpcProbe(api, ipc, telemetry) : null
  const longTasks = attachLongTaskObserver(telemetry)

  return {
    enabled: true,
    ipc,
    telemetry,
    onRender: createReactCommitOnRender(telemetry),
    restore() {
      longTasks.disconnect()
      probe?.restore()
    },
  }
}
