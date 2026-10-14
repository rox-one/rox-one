import { describe, it, expect } from 'bun:test'
import { computeLaterTurnFlags, isOffscreenEligible, LIVE_TAIL_TURNS, IDLE_JUMP, beginJump, settleJump, jumpScrollBehavior } from '../chat-timeline-window'

describe('chat timeline window (#1589)', () => {
  it('computeLaterTurnFlags matches slice().some() on a 2000-turn timeline', () => {
    const turns = Array.from({ length: 4000 }, (_, i) => ({ type: i % 7 === 3 ? 'system' : i % 2 ? 'assistant' : 'user' }))
    const f = computeLaterTurnFlags(turns)
    for (let i = 0; i < turns.length; i += 37) {
      expect(f.hasLaterUser[i]).toBe(turns.slice(i + 1).some(t => t.type === 'user'))
      expect(f.hasLaterAssistant[i]).toBe(turns.slice(i + 1).some(t => t.type === 'assistant'))
    }
    expect(f.hasLaterUser[turns.length - 1]).toBe(false)
  })
  it('keeps the live tail, streaming turns and search matches fully rendered', () => {
    expect(isOffscreenEligible(0, 100, { type: 'user' }, false)).toBe(true)
    expect(isOffscreenEligible(100 - LIVE_TAIL_TURNS, 100, { type: 'user' }, false)).toBe(false)
    expect(isOffscreenEligible(0, 100, { type: 'assistant', isStreaming: true }, false)).toBe(false)
    expect(isOffscreenEligible(0, 100, { type: 'user' }, true)).toBe(false)
  })
  it('pending jump disables offscreen style from target to bottom only', () => {
    const total = 100
    expect(isOffscreenEligible(10, total, { type: 'user' }, false, 20)).toBe(true)
    expect(isOffscreenEligible(20, total, { type: 'user' }, false, 20)).toBe(false)
    expect(isOffscreenEligible(50, total, { type: 'assistant' }, false, 20)).toBe(false)
    expect(isOffscreenEligible(50, total, { type: 'assistant' }, false, null)).toBe(true)
  })
  it('jumps outside the live tail scroll instantly', () => {
    expect(jumpScrollBehavior(10, 100, false)).toBe('instant')
    expect(jumpScrollBehavior(100 - LIVE_TAIL_TURNS, 100, false)).toBe('smooth')
    expect(jumpScrollBehavior(99, 100, true)).toBe('instant')
  })
  it('pending jump state: begin/settle with stale-token protection', () => {
    const a = beginJump(IDLE_JUMP, 5)
    expect(a.index).toBe(5)
    const b = beginJump(a, 9)
    // settling the older jump must not clear the newer one
    expect(settleJump(b, a.token)).toBe(b)
    const c = settleJump(b, b.token)
    expect(c.index).toBeNull()
    expect(settleJump(c, b.token).index).toBeNull()
  })
})
