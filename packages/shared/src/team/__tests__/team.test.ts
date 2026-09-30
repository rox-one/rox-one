import { describe, expect, it } from 'bun:test'
import {
  LocalOnlyTeamSyncAdapter,
  TEAM_FLAG,
  activeMentionQuery,
  addComment,
  applyPushResult,
  assign,
  createTeamSyncAdapter,
  decideRecipientRequest,
  deleteComment,
  emptyTeamState,
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
const ctx = { selfUserId: 'u-self', organizationId: 'org-1', now: 1000, newId: () => `id-${++n}` }
const target = { kind: 'session' as const, id: 's1', title: 'S1', revision: 'source-rev-1' }

describe('team flags', () => {
  it('defaults every team flag ON and honours boolean overrides', () => {
    for (const id of Object.values(TEAM_FLAG)) expect(isTeamFlagEnabled(id)).toBe(true)
    expect(isTeamFlagEnabled(TEAM_FLAG.handoff, { 'team.handoff.v1': false })).toBe(false)
    expect(parseTeamFlagOverrides('{"team.assign.v1":false,"other":false,"team.x":"no"}')).toEqual({ 'team.assign.v1': false })
    expect(parseTeamFlagOverrides('not json')).toEqual({})
  })
})

describe('mentions', () => {
  it('uses stable collision-safe roster handles', () => {
    const collisionRoster = [
      { ...roster[0]!, username: 'sam' },
      { ...roster[1]!, username: 'sam' },
    ]
    const first = mentionHandle(collisionRoster[0]!)
    const second = mentionHandle(collisionRoster[1]!)
    expect(first).not.toBe(second)
    expect(resolveMentions(`@${first} @${second} @sam`, collisionRoster)).toEqual(['u-self', 'u-2'])
    expect(suggestMentions('@sam', collisionRoster).map((m) => m.userId)).toEqual(['u-self', 'u-2'])
    expect(activeMentionQuery(`ping @${second}`, `ping @${second}`.length)).toBe(second)
    expect(activeMentionQuery('mail a@b', 8)).toBeNull()
  })
})

describe('state reducers', () => {
  it('binds comments to immutable revisions and queues mentions as undelivered recipient requests', () => {
    const body = `look @${mentionHandle(roster[1]!)} @${mentionHandle(roster[0]!)}`
    const s = addComment(emptyTeamState(), ctx, { target, body, roster })
    expect(s.comments).toHaveLength(1)
    expect(s.comments[0]!.target.revision).toBe('source-rev-1')
    expect(s.comments[0]!.mentions).toEqual(['u-2'])
    expect(s.comments[0]!.sync).toBe('queued')
    expect(s.activity.map((a) => a.kind).sort()).toEqual(['comment', 'mention'])
    expect(s.recipientRequests[0]).toMatchObject({
      organizationId: 'org-1',
      recipientUserId: 'u-2',
      target: { revision: 'source-rev-1' },
      idempotencyKey: `org-1:${s.comments[0]!.id}:u-2`,
      delivery: 'pending-delivery',
      decision: 'pending',
    })
    expect(s.outbox).toHaveLength(2)
    expect(selectInboxForUser(s, 'u-2')).toEqual([])
    expect(() => addComment(s, ctx, { target: { ...target, revision: undefined }, body: 'x', roster })).toThrow('exact source revision')
    expect(() => addComment(s, ctx, { target, body: '   ', roster })).toThrow()
  })
  it('threads only to the exact revision and author deletion leaves a hidden tombstone', () => {
    const root = addComment(emptyTeamState(), ctx, { target, body: 'root', roster })
    const rootId = root.comments[0]!.id
    const reply = addComment(root, ctx, { target, body: 'reply', roster, parentCommentId: rootId })
    expect(reply.comments[1]!.parentCommentId).toBe(rootId)
    expect(() => addComment(reply, ctx, {
      target: { ...target, revision: 'later-revision' },
      body: 'stale reply',
      roster,
      parentCommentId: rootId,
    })).toThrow('exact target revision')
    expect(() => deleteComment(reply, { ...ctx, selfUserId: 'u-2' }, rootId)).toThrow('comment author')
    const deleted = deleteComment(reply, ctx, rootId)
    expect(deleted.comments[0]!.deletedAt).toBe(ctx.now)
    expect(selectForTarget(deleted, 'session', 's1', target.revision).comments.map((comment) => comment.id)).toEqual([reply.comments[1]!.id])
    expect(deleteComment(deleted, ctx, rootId)).toBe(deleted)
  })

  it('hides mention requests immediately when source comment is tombstoned and records acknowledged revocation', () => {
    const draft = addComment(emptyTeamState(), ctx, { target, body: `@${mentionHandle(roster[1]!)} review`, roster })
    const request = draft.recipientRequests[0]!
    const delivered = { ...draft, recipientRequests: draft.recipientRequests.map((item) => ({ ...item, delivery: 'delivered' as const })) }
    const deleted = deleteComment(delivered, ctx, draft.comments[0]!.id)
    expect(selectInboxForUser(deleted, 'u-2')).toEqual([])
    expect(deleted.recipientRequests[0]!.delivery).toBe('revocation-pending')
    const revoke = deleted.outbox.find((entry) => entry.op.type === 'recipient-revoke')!
    const acknowledged = applyPushResult(deleted, { acceptedIds: [revoke.id], rejected: [] })
    expect(acknowledged.recipientRequests[0]!.delivery).toBe('revoked')
    expect(selectInboxForUser(acknowledged, 'u-2')).toEqual([])
    expect(request.sourceCommentId).toBe(draft.comments[0]!.id)
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
    expect(() => requestApproval(s, ctx, { target, reviewerUserId: 'ghost', note: 'review', roster })).toThrow()
    s = requestApproval(s, ctx, { target, reviewerUserId: 'u-2', note: 'review', roster })
    expect(s.outbox.map((entry) => entry.op.type)).toEqual(['assign', 'assign', 'handoff', 'access', 'access', 'approval'])
  })

  it('recipient Inbox requires delivery acknowledgment and decisions remain pending until service ack', () => {
    const draft = addComment(emptyTeamState(), ctx, { target, body: `@${mentionHandle(roster[1]!)} hi`, roster })
    expect(selectInboxForUser(draft, 'u-2')).toEqual([])
    const delivered = {
      ...draft,
      recipientRequests: draft.recipientRequests.map((request) => ({ ...request, delivery: 'delivered' as const })),
    }
    const inbox = selectInboxForUser(delivered, 'u-2')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({
      kind: 'recipient-request',
      delivery: 'delivered',
      organizationId: 'org-1',
      target: { revision: 'source-rev-1' },
    })
    expect(() => decideRecipientRequest(delivered, { ...ctx, selfUserId: 'u-self' }, inbox[0]!.requestId!, 'accepted')).toThrow('addressed recipient')
    const submitted = decideRecipientRequest(delivered, { ...ctx, selfUserId: 'u-2' }, inbox[0]!.requestId!, 'accepted')
    expect(submitted.recipientRequests[0]!.decision).toBe('pending')
    expect(selectInboxForUser(submitted, 'u-2')[0]!.pendingAction).toBe('accepted')
    expect(() => decideRecipientRequest(submitted, { ...ctx, selfUserId: 'u-2' }, inbox[0]!.requestId!, 'rejected')).toThrow('not actionable')
    const actionOutbox = submitted.outbox.find((entry) => entry.op.type === 'recipient-action')!
    const acknowledged = applyPushResult(submitted, { acceptedIds: [actionOutbox.id], rejected: [] })
    expect(acknowledged.recipientRequests[0]!.decision).toBe('accepted')
    expect(selectInboxForUser(acknowledged, 'u-2')).toEqual([])
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
