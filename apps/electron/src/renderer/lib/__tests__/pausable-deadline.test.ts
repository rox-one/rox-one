import { describe, expect, it } from 'bun:test'
import { createPausableDeadline } from '../pausable-deadline'

function clock() {
  let time = 0
  let nextId = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    timers,
    now: () => time,
    setTimer(callback: () => void, ms: number) {
      const id = ++nextId
      timers.set(id, { at: time + ms, callback })
      return id
    },
    clearTimer: (id: number) => { timers.delete(id) },
    advance(ms: number) {
      time += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) { timers.delete(id); timer.callback() }
      }
    },
  }
}

describe('header reading deadline', () => {
  it('does no work until visible and expires exactly once after five visible seconds', () => {
    const scheduler = clock()
    let dismissed = 0
    const timer = createPausableDeadline({ durationMs: 5000, ...scheduler, onElapsed: () => { dismissed++ } })
    scheduler.advance(60_000)
    expect(dismissed).toBe(0)
    expect(scheduler.timers.size).toBe(0)
    timer.setActive(true)
    scheduler.advance(4999)
    expect(dismissed).toBe(0)
    scheduler.advance(1)
    expect(dismissed).toBe(1)
    timer.setActive(false)
    timer.setActive(true)
    scheduler.advance(5000)
    expect(dismissed).toBe(1)
  })

  it('preserves remaining reading time across hover, menus, and a hidden window', () => {
    const scheduler = clock()
    let dismissed = 0
    const timer = createPausableDeadline({ durationMs: 5000, ...scheduler, onElapsed: () => { dismissed++ } })
    timer.setActive(true)
    scheduler.advance(1200)
    timer.setActive(false)
    scheduler.advance(120_000)
    expect(dismissed).toBe(0)
    expect(scheduler.timers.size).toBe(0)
    timer.setActive(true)
    scheduler.advance(800)
    timer.setActive(false)
    timer.setActive(false)
    scheduler.advance(500)
    timer.setActive(true)
    timer.setActive(true)
    expect(scheduler.timers.size).toBe(1)
    scheduler.advance(2999)
    expect(dismissed).toBe(0)
    scheduler.advance(1)
    expect(dismissed).toBe(1)
  })

  it('cannot dismiss a replacement or fire a queued callback after unmount', () => {
    const scheduler = clock()
    const dismissed: string[] = []
    const first = createPausableDeadline({ durationMs: 5000, ...scheduler, onElapsed: () => dismissed.push('old') })
    first.setActive(true)
    const staleCallback = [...scheduler.timers.values()][0]!.callback
    scheduler.advance(4000)
    first.dispose()
    const second = createPausableDeadline({ durationMs: 5000, ...scheduler, onElapsed: () => dismissed.push('current') })
    second.setActive(true)
    staleCallback()
    scheduler.advance(1000)
    expect(dismissed).toEqual([])
    second.dispose()
    second.setActive(true)
    scheduler.advance(60_000)
    expect(scheduler.timers.size).toBe(0)
    expect(dismissed).toEqual([])
  })
})
