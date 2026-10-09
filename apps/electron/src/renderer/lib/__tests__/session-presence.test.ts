import { describe, expect, it } from 'bun:test'
import type { BroPresenceMemberDto, SessionEvent } from '@rox/shared/protocol'
import {
  EMPTY_SESSION_ACTIVITY,
  TypingBeacon,
  collectSessionOwnerOptions,
  reduceSessionActivityEvent,
  resolveViewerIdentity,
  sessionInvolvesViewer,
  sessionMatchesOwnerFilter,
  UNASSIGNED_OWNER_FILTER_ID,
  type SessionActivityState,
  type ViewerIdentity,
} from '../session-presence'

const viewerB: BroPresenceMemberDto = {
  accountId: 'acc-b', displayName: 'Анна Котова', username: 'anna', role: 'editor', status: 'online', joinedAt: 1,
}
const viewerC: BroPresenceMemberDto = {
  accountId: 'acc-c', displayName: 'Mark', username: 'mark', role: 'viewer', status: 'away', joinedAt: 2,
}

const presenceEvent = (viewers: BroPresenceMemberDto[]): SessionEvent =>
  ({ type: 'session_presence', sessionId: 's1', viewers })
const typingEvent = (actors: { accountId: string; displayName: string; expiresAt: number }[]): SessionEvent =>
  ({ type: 'session_typing', sessionId: 's1', actors })

describe('session activity reducer', () => {
  it('routes presence and typing snapshots into the per-session entry', () => {
    let state = new Map<string, SessionActivityState>()
    state = reduceSessionActivityEvent(state, presenceEvent([viewerB, viewerC]))
    state = reduceSessionActivityEvent(state, typingEvent([{ accountId: 'acc-b', displayName: 'Анна Котова', expiresAt: 5 }]))
    expect(state.get('s1')).toEqual({
      viewers: [viewerB, viewerC],
      typingActors: [{ accountId: 'acc-b', displayName: 'Анна Котова', expiresAt: 5 }],
    })
  })

  it('drops the entry once both signals are empty and ignores non-activity events', () => {
    let state = new Map<string, SessionActivityState>()
    state = reduceSessionActivityEvent(state, presenceEvent([viewerB]))
    state = reduceSessionActivityEvent(state, typingEvent([]))
    expect(state.has('s1')).toBe(true)
    state = reduceSessionActivityEvent(state, presenceEvent([]))
    expect(state.has('s1')).toBe(false)

    const untouched = reduceSessionActivityEvent(state, { type: 'title_generated', sessionId: 's1', title: 'x' })
    expect(untouched).toBe(state)
  })

  it('returns the same reference when a snapshot is unchanged', () => {
    const seeded = reduceSessionActivityEvent(new Map(), presenceEvent([viewerB]))
    const again = reduceSessionActivityEvent(seeded, presenceEvent([viewerB]))
    expect(again).toBe(seeded)
    expect(EMPTY_SESSION_ACTIVITY.viewers).toEqual([])
  })
})

describe('typing beacon', () => {
  it('sends one leading true per interval and exactly one false on clear', () => {
    const sent: boolean[] = []
    let clock = 1_000
    const beacon = new TypingBeacon((typing) => sent.push(typing), 3_000, () => clock)

    expect(sent).toEqual([])
    beacon.notify()
    beacon.notify()          // within interval → collapsed
    expect(sent).toEqual([true])
    clock += 3_000
    beacon.notify()          // interval elapsed → refresh
    expect(sent).toEqual([true, true])
    expect(beacon.isTyping).toBe(true)

    beacon.clear()
    beacon.clear()           // no duplicate false
    expect(sent).toEqual([true, true, false])
    expect(beacon.isTyping).toBe(false)

    beacon.notify()          // typing again after clear
    expect(sent).toEqual([true, true, false, true])
  })

  it('never sends false when no true is outstanding', () => {
    const sent: boolean[] = []
    new TypingBeacon((typing) => sent.push(typing)).clear()
    expect(sent).toEqual([])
  })
})

describe('involving-me filter', () => {
  const annaViewer: ViewerIdentity = { accountId: 'acc-b', username: 'anna', displayName: 'Анна Котова' }
  const unknownViewer: ViewerIdentity = { accountId: null, username: null, displayName: null }

  it('matches creator, owner and participants by identity', () => {
    expect(sessionInvolvesViewer({ creator: { accountId: 'acc-b', displayName: 'Анна', kind: 'profile' } }, annaViewer)).toBe(true)
    expect(sessionInvolvesViewer({ owner: { kind: 'account', id: 'acc-b', displayName: 'Анна', assignedAt: 1, assignedBy: 'x' } }, annaViewer)).toBe(true)
    expect(sessionInvolvesViewer({ participants: [{ accountId: 'acc-b', displayName: 'Анна', username: 'anna', kind: 'profile' }] }, annaViewer)).toBe(true)
    expect(sessionInvolvesViewer({ participants: [{ accountId: 'zz', displayName: 'Гость', username: 'guest', kind: 'profile' }] }, annaViewer)).toBe(false)
  })

  it('never matches without a viewer identity', () => {
    expect(sessionInvolvesViewer({ creator: { accountId: 'acc-b', displayName: 'Анна', kind: 'profile' } }, unknownViewer)).toBe(false)
  })
})

describe('viewer identity resolution', () => {
  it('prefers the server actor id so desktop self-assignment matches server comparison', () => {
    const viewer = resolveViewerIdentity({
      serverActorId: 'installation', accountId: 'rox-cloud-1', username: 'ada', displayName: 'Ada',
    })
    expect(viewer).toEqual({ accountId: 'installation', username: 'ada', displayName: 'Ada' })
    // The chip/filter then match the locally attributed creator id.
    expect(sessionInvolvesViewer(
      { creator: { accountId: 'installation', displayName: 'Local', kind: 'profile' } }, viewer,
    )).toBe(true)
  })

  it('falls back to the cloud account when the server id is absent', () => {
    expect(resolveViewerIdentity({ serverActorId: null, accountId: 'rox-cloud-1', username: 'ada', displayName: 'Ada' }))
      .toEqual({ accountId: 'rox-cloud-1', username: 'ada', displayName: 'Ada' })
    // A local actor id alone still supplies a usable display name for "assign to me".
    expect(resolveViewerIdentity({ serverActorId: 'installation' }))
      .toEqual({ accountId: 'installation', username: null, displayName: 'installation' })
  })
})

describe('owners filter', () => {
  const metas = [
    { owner: { kind: 'account' as const, id: 'acc-b', displayName: 'Анна', assignedAt: 1, assignedBy: 'x' } },
    { creator: { accountId: 'acc-c', displayName: 'Mark', kind: 'profile' as const } },
    {},
  ]

  it('collects distinct effective owners plus an unassigned row', () => {
    const options = collectSessionOwnerOptions(metas)
    expect(options.map(o => o.id)).toEqual(['acc-c', 'acc-b', UNASSIGNED_OWNER_FILTER_ID])
  })

  it('narrows the list to the selected owners', () => {
    const selected = new Set(['acc-c'])
    expect(metas.filter(meta => sessionMatchesOwnerFilter(meta, selected))).toEqual([metas[1]!])
    expect(metas.filter(meta => sessionMatchesOwnerFilter(meta, new Set([UNASSIGNED_OWNER_FILTER_ID])))).toEqual([metas[2]!])
    expect(metas.filter(meta => sessionMatchesOwnerFilter(meta, new Set()))).toEqual(metas)
  })

  it('combined with involving-me narrows to a single session', () => {
    const annaViewer: ViewerIdentity = { accountId: 'acc-b', username: null, displayName: 'Анна' }
    const involving = metas.filter(meta => sessionInvolvesViewer(meta, annaViewer))
    expect(involving).toEqual([metas[0]!])
    expect(involving.filter(meta => sessionMatchesOwnerFilter(meta, new Set(['acc-b'])))).toEqual([metas[0]!])
  })
})