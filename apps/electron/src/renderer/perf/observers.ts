import type { PerfTelemetry } from './telemetry'

export interface LongTaskEntry {
  duration: number
  name?: string
}

export interface LongTaskList {
  getEntries(): LongTaskEntry[]
}

export interface LongTaskObserverHost {
  PerformanceObserver?: new (callback: (list: LongTaskList) => void) => {
    observe(options: { type: string; buffered?: boolean }): void
    disconnect(): void
  }
}

export interface InstalledLongTaskObserver {
  disconnect(): void
}

/**
 * Records long tasks through PerformanceObserver when the host supports it.
 * Bun/jsdom hosts without the API return a no-op disconnect.
 */
export function attachLongTaskObserver(
  telemetry: PerfTelemetry,
  host: LongTaskObserverHost = globalThis as LongTaskObserverHost,
): InstalledLongTaskObserver {
  const Observer = host.PerformanceObserver
  if (!Observer) {
    return { disconnect() {} }
  }

  try {
    const observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        telemetry.recordLongTask(entry.duration)
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
    return { disconnect() { observer.disconnect() } }
  } catch {
    return { disconnect() {} }
  }
}

export interface ReactCommitOnRender {
  (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
  ): void
}

export function createReactCommitOnRender(telemetry: PerfTelemetry): ReactCommitOnRender {
  return (_id, _phase, actualDuration) => {
    telemetry.recordReactCommit(actualDuration)
  }
}
