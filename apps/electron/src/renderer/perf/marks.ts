import { nowMs } from './stats'
import type { PerfMarkName } from './types'

export interface MarkRecord {
  name: PerfMarkName
  durationMs: number
}

export class PerfMarkClock {
  private readonly open = new Map<PerfMarkName, number>()
  readonly completed: MarkRecord[] = []

  start(name: PerfMarkName): void {
    this.open.set(name, nowMs())
  }

  end(name: PerfMarkName): number {
    const started = this.open.get(name)
    if (started === undefined) {
      throw new Error(`perf mark ${name} was never started`)
    }
    this.open.delete(name)
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
