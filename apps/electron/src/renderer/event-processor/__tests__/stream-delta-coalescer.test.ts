import { describe, expect, it } from 'bun:test'
import { createStreamDeltaCoalescer } from '../stream-delta-coalescer'

type Ev = { type: string; sessionId?: string; turnId?: string; delta?: string; text?: string }

function harness() {
  const out: Ev[] = []
  let pendingFlush: (() => void) | null = null
  let schedules = 0
  const c = createStreamDeltaCoalescer<Ev>(e => out.push(e), {
    schedule: flush => { schedules++; pendingFlush = flush; return () => { pendingFlush = null } },
  })
  return { c, out, frame: () => pendingFlush?.(), schedules: () => schedules }
}

describe('#1589 stream delta coalescer', () => {
  it('merges adjacent deltas of the same session/turn into one delivery per frame', () => {
    const h = harness()
    for (const d of ['He', 'll', 'o']) h.c.push({ type: 'text_delta', sessionId: 's', turnId: 't', delta: d })
    expect(h.out).toEqual([])
    expect(h.schedules()).toBe(1)
    h.frame()
    expect(h.out).toEqual([{ type: 'text_delta', sessionId: 's', turnId: 't', delta: 'Hello' }])
  })

  it('keeps sessions, turns and delta kinds apart, in arrival order', () => {
    const h = harness()
    h.c.push({ type: 'text_delta', sessionId: 'a', turnId: '1', delta: 'x' })
    h.c.push({ type: 'text_delta', sessionId: 'b', turnId: '1', delta: 'y' })
    h.c.push({ type: 'thinking_delta', sessionId: 'b', turnId: '1', text: 'hm' })
    h.c.push({ type: 'thinking_delta', sessionId: 'b', turnId: '1', text: 'm' })
    h.c.push({ type: 'text_delta', sessionId: 'b', turnId: '2', delta: 'z' })
    h.frame()
    expect(h.out.map(e => `${e.type}:${e.sessionId}:${e.turnId}:${e.delta ?? e.text}`)).toEqual([
      'text_delta:a:1:x', 'text_delta:b:1:y', 'thinking_delta:b:1:hmm', 'text_delta:b:2:z',
    ])
  })

  it('flushes queued text before any other event and delivers that event synchronously', () => {
    const h = harness()
    h.c.push({ type: 'text_delta', sessionId: 's', delta: 'a' })
    h.c.push({ type: 'text_delta', sessionId: 's', delta: 'b' })
    h.c.push({ type: 'text_complete', sessionId: 's', text: 'ab' })
    expect(h.out.map(e => e.type)).toEqual(['text_delta', 'text_complete'])
    expect(h.out[0]!.delta).toBe('ab')
    h.frame()
    expect(h.out).toHaveLength(2)
  })

  it('dispose delivers what is left', () => {
    const h = harness()
    h.c.push({ type: 'text_delta', sessionId: 's', delta: 'tail' })
    h.c.dispose()
    expect(h.out.map(e => e.delta)).toEqual(['tail'])
  })

  it('does not mutate the caller event objects', () => {
    const h = harness()
    const first = { type: 'text_delta', sessionId: 's', delta: 'a' }
    h.c.push(first)
    h.c.push({ type: 'text_delta', sessionId: 's', delta: 'b' })
    h.frame()
    expect(first.delta).toBe('a')
  })

  it('a throwing handler loses only its own event; the rest and the trigger still deliver', () => {
    const out: string[] = []
    const errors: string[] = []
    let flushNow: (() => void) | null = null
    const c = createStreamDeltaCoalescer<Ev>(e => {
      if (e.sessionId === 'bad') throw new Error('boom')
      out.push(`${e.type}:${e.sessionId}`)
    }, { schedule: f => { flushNow = f; return () => {} }, onError: (_e, ev) => errors.push((ev as Ev).sessionId!) })
    c.push({ type: 'text_delta', sessionId: 'bad', delta: 'x' })
    c.push({ type: 'text_delta', sessionId: 'ok', delta: 'y' })
    c.push({ type: 'complete', sessionId: 'ok' })
    expect(out).toEqual(['text_delta:ok', 'complete:ok'])
    expect(errors).toEqual(['bad'])
    expect(flushNow).not.toBeNull()
  })

  it('ignores events after dispose', () => {
    const h = harness()
    h.c.dispose()
    h.c.push({ type: 'text_delta', sessionId: 's', delta: 'late' })
    h.c.push({ type: 'complete', sessionId: 's' })
    h.frame()
    expect(h.out).toEqual([])
    expect(h.schedules()).toBe(0)
  })
})
