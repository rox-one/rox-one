import { describe, expect, it } from 'bun:test'
import { isDetailNavState } from '../nav-helpers'

describe('isDetailNavState', () => {
  it('treats Settings Overview as a compact detail surface', () => {
    expect(isDetailNavState({ navigator: 'settings', subpage: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'settings', subpage: 'runtime' })).toBe(true)
  })

  it('keeps other navigator semantics', () => {
    expect(isDetailNavState(null)).toBe(false)
    expect(isDetailNavState({ navigator: 'sessions', filter: { kind: 'allSessions' }, details: null })).toBe(false)
    expect(isDetailNavState({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: { type: 'session', sessionId: 's1' },
    })).toBe(true)
    expect(isDetailNavState({ navigator: 'home', details: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'memory', details: null })).toBe(false)
  })
})
