import { describe, expect, it } from 'bun:test'
import {
  LocalOnlyTeamSyncAdapter,
  TEAM_FLAG,
  activeMentionQuery,
  addComment,
  applyPushResult,
  assign,
  createTeamSyncAdapter,
  emptyTeamState,
  extractMentionHandles,
  grantAccess,
  handoff,
  isTeamFlagEnabled,
  mentionHandle,
  normalizeTeamState,
  parseTeamFlagOverrides,
  requestApproval,
  resolveMentions,
  selectForTarget,
  selectInboxForUser,
  suggestMentions,
  type TeamMemberRef,
} from '../index.ts'

const roster: TeamMemberRef[] = [
  { userId: 'u-self', displayName: 'Self User', username: 'self', role: 'owner' },
  { userId: 'u-2', displayName: 'Второй Участник', email: 'second@example.test', role: 'member' },
]
let n = 0
const ctx = { selfUserId: 'u-self', now: 1000, newId: () => `id-${++n}` }
const target = { kind: 'session' as const, id: 's1', title: 'S1' }

describe('team flags', () => {
  it('defaults every team flag ON and honours boolean overrides', () => {
    for (const id of Object.values(TEAM_FLAG)) expect(isTeamFlagEnabled(id)).toBe(true)
    expect(isTeamFlagEnabled(TEAM_FLAG.handoff, { 'team.handoff.v1': false })).toBe(false)
    expect(parseTeamFlagOverrides('{"team.assign.v1":false,"other":false,"team.x":"no"}')).toEqual({ 'team.assign.v1': false })
    expect(parseTeamFlagOverrides('not json')).toEqual({})
  })
})

describe('mentions', () => {
  it('derives handles and resolves only real members', () => {
    expect(mentionHandle(roster[0]!)).toBe('self')
    expect(mentionHandle(roster[1]!)).toBe('second')
    expect(extractMentionHandles('hi @second, and @ghost. mail a@b.c')).toEqual(['second', 'ghost'])
    expect(resolveMentions('hi @second and @ghost', roster)).toEqual(['u-2'])
    expect(suggestMentions('@se', roster).map((m) => m.userId)).toEqual(['u-self', 'u-2'])
    expect(activeMentionQuery('ping @sec', 9)).toBe('sec')
    expect(activeMentionQuery('mail a@b', 8)).toBeNull()
  })
})

describe('state reducers', () => {
  it('comment records mentions, activity and a queued outbox op', () => {
    const s = addComment(emptyTeamState(), ctx, { target, body: 'look @second @self', roster })
    expect(s.comments).toHaveLength(1)
    expect(s.comments[0]!.mentions).toEqual(['u-2'])
    expect(s.comments[0]!.sync).toBe('queued')
    expect(s.activity.map((a) => a.kind).sort()).toEqual(['comment', 'mention'])
    expect(s.outbox).toHaveLength(1)
    expect(() => addComment(s, ctx, { target, body: '   ', roster })).toThrow()
  })

  it('assign/handoff/access/approval require real members', () => {
    let s = emptyTeamState()
    expect(() => assign(s, ctx, { target, assigneeUserId: 'ghost', roster })).toThrow()
    s = assign(s, ctx, { target, assigneeUserId: 'u-2', roster })
    s = assign(s, ctx, { target, assigneeUserId: 'u-self', roster })
    expect(selectForTarget(s, 'session', 's1').assignment?.assigneeUserId).toBe('u-self')
    expect(() => handoff(s, ctx, { target, toUserId: 'u-self', summary: 'x', roster })).toThrow()
    expect(() => handoff(s, ctx, { target, toUserId: 'u-2', summary: ' ', roster })).toThrow()
    s = handoff(s, ctx, { target, toUserId: 'u-2', summary: 'done A, todo B', roster })
    s = grantAccess(s, ctx, { target, userId: 'u-2', role: 'view', roster })
    s = grantAccess(s, ctx, { target, userId: 'u-2', role: 'run', roster })
    expect(selectForTarget(s, 'session', 's1').access.map((g) => g.role)).toEqual(['run'])
    s = requestApproval(s, ctx, { target, reviewerUserId: 'u-2', note: 'ok?', roster })
    expect(s.outbox).toHaveLength(6)
  })

  it('inbox never shows self-authored records (needs org server for teammates)', () => {
    let s = addComment(emptyTeamState(), ctx, { target, body: '@second hi', roster })
    s = handoff(s, ctx, { target, toUserId: 'u-2', summary: 'sum', roster })
    expect(selectInboxForUser(s, 'u-self')).toEqual([])
    const forSecond = selectInboxForUser(s, 'u-2').map((i) => i.kind).sort()
    expect(forSecond).toEqual(['handoff', 'mention'])
  })

  it('normalizes malformed persisted state', () => {
    expect(normalizeTeamState(null)).toEqual(emptyTeamState())
    expect(normalizeTeamState({ comments: 'bad', activity: [] }).comments).toEqual([])
  })
})

describe('sync adapter', () => {
  it('local-only adapter is honest and keeps the outbox', async () => {
    expect(new LocalOnlyTeamSyncAdapter(null).status()).toEqual({ state: 'no-org' })
    const a = createTeamSyncAdapter({ orgId: 'o1', serverUrl: '' })
    expect(a.status()).toEqual({ state: 'org-server-required', orgId: 'o1' })
    const s = addComment(emptyTeamState(), ctx, { target, body: 'x', roster })
    const res = await a.push(s.outbox)
    expect(applyPushResult(s, res).outbox).toHaveLength(1)
    expect(await a.pull()).toBeNull()
    const partial = applyPushResult(s, { acceptedIds: [s.outbox[0]!.id], rejected: [] })
    expect(partial.outbox).toHaveLength(0)
  })
})
