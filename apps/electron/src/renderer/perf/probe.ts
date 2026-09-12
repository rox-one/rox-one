import { SESSION_API_TO_HARNESS, type SessionApiName } from './channels'
import { IpcCallCounter } from './ipc-counter'
import { PerfTelemetry } from './telemetry'

export type SessionApiSurface = Partial<Record<SessionApiName, (...args: never[]) => unknown>>

export interface InstalledSessionIpcProbe {
  ipc: IpcCallCounter
  telemetry: PerfTelemetry
  restore(): void
}

/**
 * Wraps live session ElectronAPI methods so permission/metadata N+1
 * is counted on the real IPC path. No-op when the method is missing.
 */
export function installSessionIpcProbe(
  api: SessionApiSurface,
  ipc = new IpcCallCounter(),
  telemetry = new PerfTelemetry(),
): InstalledSessionIpcProbe {
  const originals: Array<{ name: SessionApiName; fn: (...args: never[]) => unknown }> = []

  for (const name of Object.keys(SESSION_API_TO_HARNESS) as SessionApiName[]) {
    const current = api[name]
    if (typeof current !== 'function') continue
    const channel = SESSION_API_TO_HARNESS[name]
    originals.push({ name, fn: current })
    api[name] = ipc.wrapAsync(channel, async (...args: never[]) => {
      const result = await current(...args)
      if (name === 'getSessions') {
        telemetry.recordPayload({ channel, count: Array.isArray(result) ? result.length : 0 })
      }
      return result
    }) as SessionApiSurface[SessionApiName]
  }

  return {
    ipc,
    telemetry,
    restore() {
      for (const { name, fn } of originals) {
        api[name] = fn as SessionApiSurface[SessionApiName]
      }
    },
  }
}
