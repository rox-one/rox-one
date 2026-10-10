/**
 * VisitorGrantStore unit tests (port-matrix row a1.6).
 *
 * TTL expiry is driven by an injected clock; the timers are disabled so the
 * sweep is exercised directly.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_VISITOR_GRANT_TTL_MS, VisitorGrantStore } from '../grant-store.ts'
import { visitorKey } from '../types.ts'

function clock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => { now += ms },
  }
}

function store(c: { now: () => number }, ttlMs = 1_000) {
  return new VisitorGrantStore({ now: c.now, ttlMs, timers: false })
}

describe('VisitorGrantStore', () => {
  test('grants, lists and revokes by email or github key', () => {
    const c = clock()
    const s = store(c)
    const grant = s.grant({ kind: 'email', email: 'Ada@Example.com' })

    expect(grant.key).toBe('email:ada@example.com')
    expect(grant.expiresAt).toBe(c.now() + 1_000)
    expect(s.has({ kind: 'email', email: 'ada@example.com' })).toBe(true)
    expect(s.list()).toHaveLength(1)

    const github = s.grant({ kind: 'github', accountId: '42' })
    expect(github.key).toBe('github:42')
    expect(s.list().map(g => g.key)).toEqual(['email:ada@example.com', 'github:42'])

    const revoked = s.revoke({ kind: 'email', email: 'ada@example.com' })
    expect(revoked?.key).toBe('email:ada@example.com')
    expect(s.revoke({ kind: 'email', email: 'ada@example.com' })).toBeNull()
    expect(s.list().map(g => g.key)).toEqual(['github:42'])
  })

  test('defaults to a 14-day TTL', () => {
    const c = clock()
    const s = new VisitorGrantStore({ now: c.now, timers: false })
    const grant = s.grant({ kind: 'email', email: 'v@example.com' })
    expect(grant.expiresAt - grant.createdAt).toBe(DEFAULT_VISITOR_GRANT_TTL_MS)
  })

  test('an expired grant is absent from get/has/list before any sweep', () => {
    const c = clock()
    const s = store(c)
    s.grant({ kind: 'email', email: 'v@example.com' })
    c.advance(1_000)
    expect(s.has({ kind: 'email', email: 'v@example.com' })).toBe(false)
    expect(s.get({ kind: 'email', email: 'v@example.com' })).toBeNull()
    expect(s.list()).toHaveLength(0)
  })

  test('sweep drops exactly the expired grants and returns their keys', () => {
    const c = clock()
    const s = store(c)
    s.grant({ kind: 'email', email: 'a@example.com' })
    c.advance(400)
    s.grant({ kind: 'email', email: 'b@example.com' }, { ttlMs: 2_000 })
    c.advance(700) // a expired (1000), b still live (2400)

    expect(s.sweep()).toEqual(['email:a@example.com'])
    expect(s.list().map(g => g.key)).toEqual(['email:b@example.com'])
    expect(s.sweep()).toEqual([])
  })

  test('re-granting a key replaces it and resets the lifetime', () => {
    const c = clock()
    const s = store(c)
    s.grant({ kind: 'email', email: 'a@example.com' })
    c.advance(900)
    const renewed = s.grant({ kind: 'email', email: 'a@example.com' }, { ttlMs: 5_000 })
    expect(renewed.createdAt).toBe(c.now())
    expect(renewed.expiresAt).toBe(c.now() + 5_000)
    expect(s.list()).toHaveLength(1)
  })

  test('an unusable subject throws a typed VisitorSubjectError', () => {
    const c = clock()
    const s = store(c)
    expect(() => s.grant({ kind: 'email', email: 'not-an-email' })).toThrow('Visitor email')
    expect(() => visitorKey({ kind: 'github', accountId: '   ' })).toThrow('GitHub account id')
  })
})