import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'bun:test'
import type { OrganizationWithMembers } from '@rox/shared/orgs'
import { addComment, assign, emptyTeamState, mentionHandle, selectForTarget, selectInboxForUser, type TeamRecipientRequest } from '@rox/shared/team'
import { pickActiveOrg, toTeamMembers } from '../use-team-roster'
import { activityText, memberInitials, memberName, syncStatusText } from '../team-labels'
import { __resetTeamStoreForTests, dispatchTeam, readTeamState, teamActionContext } from '../team-store'
import { TeamRevisionChip } from '../TeamSessionButton'

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)

const org: OrganizationWithMembers = {
  id: 'o1', name: 'Org', slug: 'org', createdBy: 'u1', createdAt: 1,
  members: [
    { orgId: 'o1', userId: 'u1', role: 'owner', username: 'mark', joinedAt: 1 },
    { orgId: 'o1', userId: 'u2', role: 'member', email: 'anna@example.test', joinedAt: 2 },
  ],
  pendingInvites: [], viewerUserId: 'u2', viewerAuthority: 'native', viewerIssuer: 'native-test',
}

describe('team roster (real org members only)', () => {
  it('maps org members and picks the org the user belongs to', () => {
    const members = toTeamMembers(org)
    expect(members.map((m) => m.displayName)).toEqual(['mark', 'anna@example.test'])
    expect(toTeamMembers(null)).toEqual([])
    const other = { ...org, id: 'o0', members: [] }
    expect(pickActiveOrg([other, org])?.id).toBe('o1')
    expect(pickActiveOrg([])).toBeNull()
    expect(pickActiveOrg([{ ...org, viewerUserId: undefined }])).toBeNull()
    expect(pickActiveOrg([{ ...org, viewerUserId: 'ghost' }])).toBeNull()
  })
})

describe('team labels', () => {
  it('renders honest sync states', () => {
    expect(syncStatusText({ state: 'no-org' }, 0, t)).toBe('teamCollab.sync.noOrg')
    expect(syncStatusText({ state: 'org-server-required', orgId: 'o1' }, 2, t)).toContain('serverRequiredPending')
    expect(memberName(toTeamMembers(org), 'u1', 'u1', t)).toBe('teamCollab.you')
    expect(memberName(toTeamMembers(org), 'zz', 'u1', t)).toBe('teamCollab.unknownMember')
    expect(memberInitials('Анна Котова')).toBe('АК')
  })
})

describe('team store', () => {
  beforeEach(() => __resetTeamStoreForTests())
  it('applies reducers and keeps queued outbox (no server)', () => {
    const roster = toTeamMembers(org)
    const target = { kind: 'session' as const, id: 's1', title: 'S', revision: 'rev-1' }
    dispatchTeam((s) => assign(s, teamActionContext('u1'), { target, assigneeUserId: 'u2', roster }))
    dispatchTeam((s) => addComment(s, teamActionContext('u1'), { target, body: `hi @${mentionHandle(roster[1]!)}`, roster }))
    const s = readTeamState()
    expect(s.assignments).toHaveLength(1)
    expect(s.comments[0]!.mentions).toEqual(['u2'])
    expect(s.outbox).toHaveLength(2)
    expect(activityText(s.activity[s.activity.length - 1]!, roster, 'u1', t)).toContain('teamCollab.activity.assign')
    expect(() => dispatchTeam((st) => assign(st, teamActionContext('u1'), { target, assigneeUserId: 'ghost', roster }))).toThrow()
  })

  it('reloads revision-bound queued changes from local persistence without claiming delivery', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const saved = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
    } })
    try {
      const roster = toTeamMembers(org)
      const target = { kind: 'session' as const, id: 's1', revision: 'rev-1' }
      expect(dispatchTeam((state) => addComment(state, teamActionContext('u1'), { target, body: `hi @${mentionHandle(roster[1]!)}`, roster }))).toBe(true)
      const before = readTeamState()
      __resetTeamStoreForTests()
      const after = readTeamState()
      expect(after.comments).toEqual(before.comments)
      expect(after.comments[0]?.mentions).toEqual(['u2'])
      expect(after.outbox).toEqual(before.outbox)
      expect(after.outbox).toHaveLength(1)
      expect(after.comments[0]?.sync).toBe('queued')
      expect(selectInboxForUser(after, 'u2')).toEqual([])
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
      __resetTeamStoreForTests()
    }
  })
})
describe('team collaboration delivery', () => {
  it('requires comments to stay pinned to the exact source revision', () => {
    const roster = toTeamMembers(org)
    const target = { kind: 'session' as const, id: 's1', title: 'S' }
    const ctx = teamActionContext('u1')

    expect(() => addComment(emptyTeamState(), ctx, { target, body: 'review this', roster })).toThrow('comment requires an exact source revision')

    const revisionTarget = { ...target, revision: 'rev-1' }
    const next = addComment(emptyTeamState(), ctx, { target: revisionTarget, body: 'review this', roster })
    expect(next.comments[0]?.target).toEqual(revisionTarget)
    expect(selectForTarget(next, 'session', 's1', 'rev-2').comments).toEqual([])
  })

  it('renders revision-bound actions disabled until a target revision exists', () => {
    const render = (revision?: string) => renderToStaticMarkup(createElement(TeamRevisionChip, {
      revision,
      onClick: () => {},
      children: 'Request review',
    }))

    expect(render()).toContain('disabled=""')
    expect(render('rev-1')).not.toContain('disabled=""')
  })

  it('shows recipient requests in Inbox only after the exact request is delivered', () => {
    const request: TeamRecipientRequest = {
      id: 'request-1',
      organizationId: 'o1',
      recipientUserId: 'u2',
      senderUserId: 'u1',
      target: { kind: 'session', id: 's1', revision: 'rev-1' },
      sourceCommentId: 'comment-1',
      idempotencyKey: 'o1:comment-1:u2',
      createdAt: 1,
      delivery: 'pending-delivery',
      decision: 'pending',
    }
    const state = { ...emptyTeamState(), recipientRequests: [request] }
    expect(selectInboxForUser(state, 'u2')).toEqual([])
    expect(selectInboxForUser(state, 'u3')).toEqual([])
    const delivered = { ...state, recipientRequests: [{ ...request, delivery: 'delivered' as const }] }
    expect(selectInboxForUser(delivered, 'u2').map((item) => item.target.revision)).toEqual(['rev-1'])
    expect(selectInboxForUser(delivered, 'u3')).toEqual([])
  })
})
