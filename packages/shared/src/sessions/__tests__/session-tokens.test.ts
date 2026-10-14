import { describe, expect, it } from 'bun:test'
import { accumulateSessionTokens } from '../session-tokens'

const totals = (p: number, o: number) => ({ promptTokens: p, outputTokens: o })

describe('accumulateSessionTokens', () => {
  it('starts tracking on a fresh session and sums every turn', () => {
    const a = accumulateSessionTokens({ outputTokens: 0 }, totals(1000, 50))
    expect(a).toEqual({ sessionTokens: 1050 })
    const b = accumulateSessionTokens({ outputTokens: 50, ...a }, totals(2000, 30))
    expect(b).toEqual({ sessionTokens: 3080 })
  })
  it('legacy sessions with prior usage but no total stay hidden', () => {
    expect(accumulateSessionTokens({ outputTokens: 900 }, totals(10, 1))).toEqual({ sessionTokensIncomplete: true })
  })
  it('a turn without per-request totals marks the session incomplete for good', () => {
    const a = accumulateSessionTokens({ outputTokens: 10, sessionTokens: 500 }, undefined)
    expect(a).toEqual({ sessionTokensIncomplete: true })
    expect(accumulateSessionTokens({ outputTokens: 20, ...a }, totals(1, 1))).toEqual({ sessionTokensIncomplete: true })
  })
})
