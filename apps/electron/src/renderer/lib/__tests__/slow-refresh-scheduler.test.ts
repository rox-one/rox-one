import { afterEach, describe, expect, it } from 'bun:test'
import {
  SLOW_REFRESH_MS,
  setSlowRefreshClockForTests,
  subscribeSlowRefresh,
} from '../slow-refresh-scheduler'

class FakeClock {
  nowMs = 0
  hiddenFlag = false
  timeouts = new Map<number, { fn: () => void; at: number }>()
  nextId = 1
  vis = new Set<() => void>()
  now = () => this.nowMs
  hidden = () => this.hiddenFlag
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++
    this.timeouts.set(id, { fn, at: this.nowMs + ms })
    return id
  }
  clearTimeout = (id: unknown) => {
    this.timeouts.delete(id as number)
  }
  onVisibility = (listener: () => void) => {
    this.vis.add(listener)
    return () => { this.vis.delete(listener) }
  }
  advance(ms: number) {
    this.nowMs += ms
    for (const [id, entry] of [...this.timeouts]) {
      if (entry.at <= this.nowMs) {
        this.timeouts.delete(id)
        entry.fn()
      }
    }
  }
  setHidden(value: boolean) {
    this.hiddenFlag = value
    for (const listener of [...this.vis]) listener()
  }
}

describe('slow-refresh-scheduler', () => {
  afterEach(() => setSlowRefreshClockForTests(null))

  it('fires 0 times while the document is hidden', () => {
    const clock = new FakeClock()
    clock.hiddenFlag = true
    setSlowRefreshClockForTests(clock)
    let n = 0
    const off = subscribeSlowRefresh(() => { n++ })
    clock.advance(SLOW_REFRESH_MS * 3)
    expect(n).toBe(0)
    off()
  })

  it('visible idle: ≤ 2 calls per 60s', () => {
    const clock = new FakeClock()
    setSlowRefreshClockForTests(clock)
    let n = 0
    const off = subscribeSlowRefresh(() => { n++ })
    clock.advance(SLOW_REFRESH_MS)
    expect(n).toBe(1)
    clock.advance(SLOW_REFRESH_MS - 1)
    expect(n).toBeLessThanOrEqual(2)
    off()
  })
})
