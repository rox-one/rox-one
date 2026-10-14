import { describe, it, expect } from 'bun:test'
import { computeLaterTurnFlags, isOffscreenEligible, LIVE_TAIL_TURNS } from '../chat-timeline-window'

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
})
