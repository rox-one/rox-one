import { describe, expect, it } from 'bun:test'
import type { BroPresenceMemberDto } from '@rox/shared/protocol'
import { SessionActivityTracker } from '../../collaboration/session-activity-tracker'
import { evaluateSessionReadAccess, evaluateSessionWriteAccess } from '../SessionManager'

const creator = { accountId: 'installation', displayName: 'Local', kind: 'profile' as const }
const owner = { kind: 'account' as const, id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' }

describe('session visibility write access (a2.5)', () => {
  it('allows shared for every actor and keeps the open legacy default', () => {
    expect(evaluateSessionWriteAccess({ visibility: 'shared', creator }, 'somebody')).toEqual({ allowed: true })
    // Absent visibility is the open legacy default.
    expect(evaluateSessionWriteAccess({ creator }, 'somebody')).toEqual({ allowed: true })
  })

  it('denies a non-owner suggest write with SESSION_SUGGEST_ONLY, owner unchanged', () => {
    expect(evaluateSessionWriteAccess({ visibility: 'suggest', creator }, 'somebody')).toEqual({
      allowed: false, code: 'SESSION_SUGGEST_ONLY', message: 'Session accepts suggestions only from this actor',
    })
    // The creator/owner still writes directly.
    expect(evaluateSessionWriteAccess({ visibility: 'suggest', creator }, 'installation')).toEqual({ allowed: true })
    expect(evaluateSessionWriteAccess({ visibility: 'suggest', owner }, 'ada')).toEqual({ allowed: true })
    // No attribution means no owner to enforce against.
    expect(evaluateSessionWriteAccess({ visibility: 'suggest' }, 'somebody')).toEqual({ allowed: true })
  })

  it('denies read-only non-owners with SESSION_READ_ONLY', () => {
    expect(evaluateSessionWriteAccess({ visibility: 'read-only', owner }, 'somebody')).toEqual({
      allowed: false, code: 'SESSION_READ_ONLY', message: 'Session is read-only for this actor',
    })
    expect(evaluateSessionWriteAccess({ visibility: 'read-only', owner }, 'ada')).toEqual({ allowed: true })
    // No attribution means no owner to enforce against.
    expect(evaluateSessionWriteAccess({ visibility: 'read-only' }, 'somebody')).toEqual({ allowed: true })
  })

  it('denies draft non-owners with SESSION_OWNER_ONLY and honours the creator fallback', () => {
    expect(evaluateSessionWriteAccess({ visibility: 'draft', creator }, 'somebody')).toEqual({
      allowed: false, code: 'SESSION_OWNER_ONLY', message: 'Session is a private draft owned by another actor',
    })
    // The creator owns the session until someone else is assigned.
    expect(evaluateSessionWriteAccess({ visibility: 'draft', creator }, 'installation')).toEqual({ allowed: true })
    // An assigned owner overrides the creator.
    expect(evaluateSessionWriteAccess({ visibility: 'draft', creator, owner }, 'installation')).toEqual({
      allowed: false, code: 'SESSION_OWNER_ONLY', message: 'Session is a private draft owned by another actor',
    })
    // An unknown actor cannot write to a draft.
    expect(evaluateSessionWriteAccess({ visibility: 'draft', owner }, null)).toMatchObject({ allowed: false, code: 'SESSION_OWNER_ONLY' })
  })
})

describe('session visibility read access (a1.3 read side)', () => {
  const participant = { accountId: 'bob', displayName: 'Bob', username: 'bob', kind: 'profile' as const }

  it('reads shared, suggest, read-only and unattributed sessions for every actor', () => {
    for (const visibility of ['shared', 'suggest', 'read-only'] as const) {
      expect(evaluateSessionReadAccess({ visibility, owner, creator }, 'somebody')).toEqual({ allowed: true })
    }
    expect(evaluateSessionReadAccess({ creator }, 'somebody')).toEqual({ allowed: true })
  })

  it('withholds a draft from actors who are not owner, creator, or participant', () => {
    expect(evaluateSessionReadAccess({ visibility: 'draft', owner, creator }, 'somebody')).toEqual({ allowed: false })
    expect(evaluateSessionReadAccess({ visibility: 'draft', owner }, null)).toEqual({ allowed: false })
  })

  it('serves a draft to its owner, its creator, and its participants', () => {
    expect(evaluateSessionReadAccess({ visibility: 'draft', owner, creator }, 'ada')).toEqual({ allowed: true })
    expect(evaluateSessionReadAccess({ visibility: 'draft', owner, creator }, 'installation')).toEqual({ allowed: true })
    expect(evaluateSessionReadAccess({ visibility: 'draft', owner, creator, participants: [participant] }, 'bob')).toEqual({ allowed: true })
  })

  it('leaves an unattributed draft readable, mirroring the write gate', () => {
    expect(evaluateSessionReadAccess({ visibility: 'draft' }, 'somebody')).toEqual({ allowed: true })
  })
})

describe('session activity tracker (a1.4)', () => {
  const viewer = (accountId: string): BroPresenceMemberDto => ({
    accountId, displayName: accountId, username: accountId, role: 'editor', status: 'online', joinedAt: 1,
  })

  function harness() {
    let clock = 0
    const typing: Array<{ sessionId: string; actors: unknown[] }> = []
    const presence: Array<{ sessionId: string; viewers: unknown[] }> = []
    const tracker = new SessionActivityTracker({
      typingChanged: (sessionId, actors) => typing.push({ sessionId, actors }),
      presenceChanged: (sessionId, viewers) => presence.push({ sessionId, viewers }),
    }, {
      now: () => clock, typingTtlMs: 60_000, viewerTtlMs: 300_000, sweep: false,
    })
    return { tracker, typing, presence, advance: (ms: number) => { clock += ms } }
  }

  it('emits typing only on state change and expires it on the sweep', () => {
    const { tracker, typing, advance } = harness()
    const actor = { accountId: 'ada', displayName: 'Ada' }

    tracker.setTyping('s1', 'c1', actor, true)
    expect(typing).toHaveLength(1)
    // Same client, same actor: heartbeat refreshes without a second emit.
    advance(1_000)
    tracker.setTyping('s1', 'c1', actor, true)
    expect(typing).toHaveLength(1)

    // Past the TTL, the sweep drops the entry and emits the empty state once.
    advance(60_000)
    tracker.sweep()
    expect(typing).toHaveLength(2)
    expect(typing[1]).toEqual({ sessionId: 's1', actors: [] })
    // A second sweep is a no-op — the group is gone.
    tracker.sweep()
    expect(typing).toHaveLength(2)
  })

  it('replaces a typing actor identity with a single state-change emit', () => {
    const { tracker, typing } = harness()
    tracker.setTyping('s1', 'c1', { accountId: 'ada', displayName: 'Ada' }, true)
    tracker.setTyping('s1', 'c1', { accountId: 'bob', displayName: 'Bob' }, true)
    expect(typing.map(entry => entry.actors)).toEqual([
      [{ accountId: 'ada', displayName: 'Ada', expiresAt: 60_000 }],
      [{ accountId: 'bob', displayName: 'Bob', expiresAt: 60_000 }],
    ])
  })

  it('expires stale viewers on the sweep and keeps the presence event shape', () => {
    const { tracker, presence, advance } = harness()
    tracker.watch('s1', 'c1', viewer('ada'))
    expect(presence).toHaveLength(1)

    // Heartbeat with an identical live viewer: no duplicate emit.
    advance(60_000)
    tracker.watch('s1', 'c1', viewer('ada'))
    expect(presence).toHaveLength(1)

    // A changed viewer identity is a state change.
    tracker.watch('s1', 'c1', { ...viewer('ada'), status: 'away' })
    expect(presence).toHaveLength(2)

    // Past the viewer TTL the sweep drops it and emits the empty roster.
    advance(300_000)
    tracker.sweep()
    expect(presence).toHaveLength(3)
    expect(presence[2]).toEqual({ sessionId: 's1', viewers: [] })
  })

  it('drops every registration owned by a disconnected client', () => {
    const { tracker, typing, presence } = harness()
    tracker.setTyping('s1', 'c1', { accountId: 'ada', displayName: 'Ada' }, true)
    tracker.watch('s1', 'c1', viewer('ada'))
    tracker.removeClient('c1')
    expect(typing.map(entry => entry.actors)).toEqual([
      [{ accountId: 'ada', displayName: 'Ada', expiresAt: 60_000 }], [],
    ])
    expect(presence.map(entry => entry.viewers)).toEqual([[viewer('ada')], []])
  })
})