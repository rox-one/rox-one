import { describe, expect, it } from 'bun:test'
import { accumulateSessionTokens, markTurnTokensUncounted } from '../session-tokens'

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

describe('markTurnTokensUncounted', () => {
  const init = () => ({ outputTokens: 0 })
  it('an aborted turn hides an existing total for good', () => {
    const u = markTurnTokensUncounted({ outputTokens: 40, sessionTokens: 1200 }, init)
    expect(u).toEqual({ outputTokens: 40, sessionTokensIncomplete: true })
    expect(accumulateSessionTokens(u, totals(5, 5))).toEqual({ sessionTokensIncomplete: true })
  })
  it('an aborted first turn (no usage yet) still blocks later tracking', () => {
    const u = markTurnTokensUncounted(undefined, init)
    expect(u.sessionTokensIncomplete).toBe(true)
    expect(accumulateSessionTokens(u, totals(100, 10))).toEqual({ sessionTokensIncomplete: true })
  })
})
