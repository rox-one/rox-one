/**
 * Long-task, React commit, and payload-size telemetry.
 * Safe in bun/node tests: observers no-op when APIs are missing.
 */

export interface TelemetrySnapshot {
  longTaskCount: number
  longTaskMs: number
  reactCommitMs: number
  reactCommitCount: number
  payloadBytes: number
}

interface TelemetryState {
  longTaskCount: number
  longTaskMs: number
  reactCommitMs: number
  reactCommitCount: number
  payloadBytes: number
}

const state: TelemetryState = {
  longTaskCount: 0,
  longTaskMs: 0,
  reactCommitMs: 0,
  reactCommitCount: 0,
  payloadBytes: 0,
}

let longTaskObserver: { disconnect(): void } | null = null

function performanceObj(): Performance | null {
  return typeof performance !== 'undefined' ? performance : null
}

export function recordLongTask(durationMs: number): void {
  state.longTaskCount += 1
  state.longTaskMs += durationMs
}

export function recordReactCommit(durationMs: number): void {
  state.reactCommitCount += 1
  state.reactCommitMs += durationMs
}

export function recordPayloadBytes(bytes: number): void {
  state.payloadBytes += Math.max(0, bytes)
}

export function startLongTaskObserver(): () => void {
  stopLongTaskObserver()
  const perf = performanceObj()
  const Observer = (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver
  if (!perf || !Observer) return () => {}

  try {
    const observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        recordLongTask(entry.duration)
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
    longTaskObserver = observer
  } catch {
    longTaskObserver = null
  }

  return stopLongTaskObserver
}

export function stopLongTaskObserver(): void {
  longTaskObserver?.disconnect()
  longTaskObserver = null
}

export function snapshotTelemetry(): TelemetrySnapshot {
  return { ...state }
}

export function resetTelemetry(): void {
  state.longTaskCount = 0
  state.longTaskMs = 0
  state.reactCommitMs = 0
  state.reactCommitCount = 0
  state.payloadBytes = 0
}

/**
 * React.Profiler onRender adapter. Product surfaces may wrap a subtree;
 * the Wave 0 harness uses this from tests without owning feature UI.
 */
export function onReactProfilerRender(
  _id: string,
  _phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
): void {
  recordReactCommit(actualDuration)
}
