import { nowMs } from './stats'
import type { PerfMarkName } from './types'

export interface MarkRecord {
  name: PerfMarkName
  durationMs: number
}

function userTimingMark(label: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(label)
    }
  } catch {
    // User Timing is optional; harness clocks still work without it.
  }
}

function userTimingMeasure(name: PerfMarkName): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
      performance.measure(`rox.perf:${name}`, `rox.perf:${name}:start`, `rox.perf:${name}:end`)
    }
  } catch {
    // Missing start mark or User Timing unsupported.
  }
}

export class PerfMarkClock {
  private readonly open = new Map<PerfMarkName, number>()
  readonly completed: MarkRecord[] = []

  start(name: PerfMarkName): void {
    this.open.set(name, nowMs())
    userTimingMark(`rox.perf:${name}:start`)
  }

  end(name: PerfMarkName): number {
    const started = this.open.get(name)
    if (started === undefined) {
      throw new Error(`perf mark ${name} was never started`)
    }
    this.open.delete(name)
    userTimingMark(`rox.perf:${name}:end`)
    userTimingMeasure(name)
    const durationMs = nowMs() - started
    this.completed.push({ name, durationMs })
    return durationMs
  }

  measure<T>(name: PerfMarkName, fn: () => T): { value: T; durationMs: number } {
    this.start(name)
    const value = fn()
    const durationMs = this.end(name)
    return { value, durationMs }
  }
}
