import { describe, expect, it } from 'bun:test'
import { createLargeVaultFixture, createSessionFixture, lookupCachedSession, warmSessionCache } from '../fixtures'

describe('perf fixtures', () => {
  it('builds a deterministic 500-session fixture', () => {
    const a = createSessionFixture(500)
    const b = createSessionFixture(500)
    expect(a.sessions).toHaveLength(500)
    expect(a.sessions[0]).toEqual(b.sessions[0])
    expect(a.sessions[0]?.id).toBe('sess-0000')
    expect(JSON.stringify(a)).not.toMatch(/sk-|ghp_|@/)
  })

  it('builds a deterministic 2000-session fixture and warm cache', () => {
    const fixture = createSessionFixture(2000)
    expect(fixture.sessions).toHaveLength(2000)
    const cache = warmSessionCache(fixture.sessions)
    expect(lookupCachedSession(cache, 'sess-0017')?.name).toBe('Session 17')
    expect(lookupCachedSession(cache, 'missing')).toBeUndefined()
  })

  it('builds a large vault without secrets', () => {
    const vault = createLargeVaultFixture(2000)
    expect(vault.notes).toHaveLength(2000)
    expect(vault.notes[50]?.folder).toBe('folder-1')
    expect(JSON.stringify(vault)).not.toMatch(/\/Users\/|\/home\//)
  })
})
