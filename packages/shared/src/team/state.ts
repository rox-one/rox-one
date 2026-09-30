import type {
  TeamAccessRole,
  TeamActivityEvent,
  TeamApprovalStatus,
  TeamInboxItem,
  TeamLocalState,
  TeamMemberRef,
  TeamOutboxOp,
  TeamRecipientAction,
  TeamRecipientRequest,
  TeamVersionedTarget,
  TeamTarget,
} from './types.ts'
import { resolveMentions } from './mentions.ts'

export const TEAM_ACTIVITY_LIMIT = 500

export function emptyTeamState(): TeamLocalState {
  return { version: 1, comments: [], assignments: [], handoffs: [], access: [], approvals: [], recipientRequests: [], recipientActions: [], activity: [], outbox: [] }
}
export function normalizeTeamState(raw: unknown): TeamLocalState {
  const base = emptyTeamState()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Record<keyof TeamLocalState, unknown>>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    version: 1,
    comments: arr(r.comments),
    assignments: arr(r.assignments),
    handoffs: arr(r.handoffs),
    access: arr(r.access),
    approvals: arr(r.approvals),
    recipientRequests: arr(r.recipientRequests),
    recipientActions: arr(r.recipientActions),
    activity: arr<TeamActivityEvent>(r.activity).slice(0, TEAM_ACTIVITY_LIMIT),
    outbox: arr(r.outbox),
  }
}
export interface TeamActionContext {
  selfUserId: string
  organizationId?: string
  now: number
  newId: () => string
}
function push(
  state: TeamLocalState,
  ctx: TeamActionContext,
  op: TeamOutboxOp,
  events: Array<Omit<TeamActivityEvent, 'id' | 'at' | 'actorUserId'>>,
): TeamLocalState {
  const activity: TeamActivityEvent[] = events.map((e) => ({ ...e, id: ctx.newId(), at: ctx.now, actorUserId: ctx.selfUserId }))
  return {
    ...state,
    activity: [...activity.reverse(), ...state.activity].slice(0, TEAM_ACTIVITY_LIMIT),
    outbox: [...state.outbox, { id: ctx.newId(), op, queuedAt: ctx.now, attempts: 0 }],
  }
}

function requireText(value: string, what: string): string {
  const v = value.trim()
  if (!v) throw new Error(`${what} is required`)
  return v
}

function requireMember(userId: string, roster: readonly TeamMemberRef[]): void {
  if (!roster.some((m) => m.userId === userId)) throw new Error('assignee must be a real organization member')
}
export function addComment(
  state: TeamLocalState,
  ctx: TeamActionContext,
  input: { target: TeamTarget; body: string; roster: readonly TeamMemberRef[]; parentCommentId?: string },
): TeamLocalState {
  const body = requireText(input.body, 'comment body')
  const revision = input.target.revision
  if (!revision) throw new Error('comment requires an exact source revision')
  const target: TeamVersionedTarget = { ...input.target, revision }
  if (input.parentCommentId) {
    const parent = state.comments.find((comment) => comment.id === input.parentCommentId)
    if (!parent || parent.deletedAt || parent.target.kind !== target.kind || parent.target.id !== target.id || parent.target.revision !== target.revision) {
      throw new Error('thread parent does not match the exact target revision')
    }
  }
  const mentions = resolveMentions(body, input.roster).filter((id) => id !== ctx.selfUserId)
  const record = { id: ctx.newId(), target, authorUserId: ctx.selfUserId, body, mentions, createdAt: ctx.now, sync: 'queued' as const, ...(input.parentCommentId ? { parentCommentId: input.parentCommentId } : {}) }
  const next = push(state, ctx, { type: 'comment', record }, [
    { kind: 'comment', target, refId: record.id },
    ...mentions.map((uid) => ({ kind: 'mention' as const, subjectUserId: uid, target, refId: record.id })),
  ])
  const requests: TeamRecipientRequest[] = ctx.organizationId
    ? mentions.map((recipientUserId) => ({
        id: ctx.newId(),
        organizationId: ctx.organizationId!,
        recipientUserId,
        senderUserId: ctx.selfUserId,
        target,
        sourceCommentId: record.id,
        idempotencyKey: `${ctx.organizationId}:${record.id}:${recipientUserId}`,
        createdAt: ctx.now,
        delivery: 'pending-delivery',
        decision: 'pending',
      }))
    : []
  const outbox = requests.map((request) => ({ id: ctx.newId(), op: { type: 'recipient-request' as const, record: request }, queuedAt: ctx.now, attempts: 0 }))
  return { ...next, comments: [...state.comments, record], recipientRequests: [...state.recipientRequests, ...requests], outbox: [...next.outbox, ...outbox] }
}
/** Author deletion is a tombstone; retries are idempotent and keep the source revision. */
export function deleteComment(state: TeamLocalState, ctx: TeamActionContext, commentId: string): TeamLocalState {
  const comment = state.comments.find((candidate) => candidate.id === commentId)
  if (!comment || comment.authorUserId !== ctx.selfUserId) throw new Error('only the comment author may delete it')
  if (comment.deletedAt) return state
  const tombstone = { ...comment, deletedAt: ctx.now, sync: 'queued' as const }
  const revokedRequests = state.recipientRequests.filter((request) => request.sourceCommentId === commentId && request.delivery !== 'revoked' && request.delivery !== 'expired')
    .map((request) => ({ ...request, delivery: 'revocation-pending' as const }))
  const revokedIds = new Set(revokedRequests.map((request) => request.id))
  const revokeOps = revokedRequests.map((request) => ({ id: ctx.newId(), op: { type: 'recipient-revoke' as const, record: request }, queuedAt: ctx.now, attempts: 0 }))
  return {
    ...state,
    comments: state.comments.map((candidate) => candidate.id === commentId ? tombstone : candidate),
    recipientRequests: state.recipientRequests.map((request) => revokedIds.has(request.id) ? { ...request, delivery: 'revocation-pending' as const } : request),
    activity: [{ id: ctx.newId(), kind: 'comment' as const, actorUserId: ctx.selfUserId, target: comment.target, at: ctx.now, refId: comment.id }, ...state.activity].slice(0, TEAM_ACTIVITY_LIMIT),
    outbox: [...state.outbox, { id: ctx.newId(), op: { type: 'comment', record: tombstone }, queuedAt: ctx.now, attempts: 0 }, ...revokeOps],
  }
}

/** Recipient consent is queued locally and does not claim server acceptance. */
export function decideRecipientRequest(
  state: TeamLocalState,
  ctx: TeamActionContext,
  requestId: string,
  decision: 'accepted' | 'rejected',
): TeamLocalState {
  const request = state.recipientRequests.find((item) => item.id === requestId)
  if (!request || request.delivery !== 'delivered' || request.decision !== 'pending' || state.recipientActions.some((item) => item.requestId === requestId)) {
    throw new Error('recipient request is not actionable')
  }
  if (request.recipientUserId !== ctx.selfUserId) throw new Error('only the addressed recipient may decide')
  const action: TeamRecipientAction = { requestId, recipientUserId: ctx.selfUserId, decision, decidedAt: ctx.now, sync: 'queued' }
  return {
    ...state,
    recipientActions: [...state.recipientActions, action],
    activity: [{ id: ctx.newId(), kind: 'recipient-decision' as const, actorUserId: ctx.selfUserId, subjectUserId: request.senderUserId, target: request.target, at: ctx.now, refId: requestId }, ...state.activity].slice(0, TEAM_ACTIVITY_LIMIT),
    outbox: [...state.outbox, { id: ctx.newId(), op: { type: 'recipient-action', record: action }, queuedAt: ctx.now, attempts: 0 }],
  }
}

export function assign(
  state: TeamLocalState,
  ctx: TeamActionContext,
  input: { target: TeamTarget; assigneeUserId: string; roster: readonly TeamMemberRef[] },
): TeamLocalState {
  requireMember(input.assigneeUserId, input.roster)
  const record = { id: ctx.newId(), target: input.target, assigneeUserId: input.assigneeUserId, assignedByUserId: ctx.selfUserId, createdAt: ctx.now, sync: 'queued' as const }
  const next = push(state, ctx, { type: 'assign', record }, [
    { kind: 'assign', subjectUserId: input.assigneeUserId, target: input.target, refId: record.id },
  ])
  const others = state.assignments.filter((a) => !(a.target.kind === input.target.kind && a.target.id === input.target.id))
  return { ...next, assignments: [...others, record] }
}

export function handoff(
  state: TeamLocalState,
  ctx: TeamActionContext,
  input: { target: TeamTarget; toUserId: string; summary: string; roster: readonly TeamMemberRef[] },
): TeamLocalState {
  requireMember(input.toUserId, input.roster)
  if (input.toUserId === ctx.selfUserId) throw new Error('cannot hand off to yourself')
  const summary = requireText(input.summary, 'handoff summary')
  const record = { id: ctx.newId(), target: input.target, toUserId: input.toUserId, fromUserId: ctx.selfUserId, summary, createdAt: ctx.now, sync: 'queued' as const }
  const next = push(state, ctx, { type: 'handoff', record }, [
    { kind: 'handoff', subjectUserId: input.toUserId, target: input.target, refId: record.id },
  ])
  return { ...next, handoffs: [...state.handoffs, record] }
}

export function grantAccess(
  state: TeamLocalState,
  ctx: TeamActionContext,
  input: { target: TeamTarget; userId: string; role: TeamAccessRole; roster: readonly TeamMemberRef[] },
): TeamLocalState {
  requireMember(input.userId, input.roster)
  const record = { id: ctx.newId(), target: input.target, userId: input.userId, role: input.role, grantedByUserId: ctx.selfUserId, createdAt: ctx.now, sync: 'queued' as const }
  const next = push(state, ctx, { type: 'access', record }, [
    { kind: 'access', subjectUserId: input.userId, target: input.target, refId: record.id },
  ])
  const others = state.access.filter((g) => !(g.target.id === input.target.id && g.target.kind === input.target.kind && g.userId === input.userId))
  return { ...next, access: [...others, record] }
}

export function requestApproval(
  state: TeamLocalState,
  ctx: TeamActionContext,
  input: { target: TeamTarget; reviewerUserId: string; note: string; roster: readonly TeamMemberRef[] },
): TeamLocalState {
  requireMember(input.reviewerUserId, input.roster)
  if (input.reviewerUserId === ctx.selfUserId) throw new Error('cannot request approval from yourself')
  const record = { id: ctx.newId(), target: input.target, reviewerUserId: input.reviewerUserId, requestedByUserId: ctx.selfUserId, note: input.note.trim(), status: 'pending' as TeamApprovalStatus, createdAt: ctx.now, sync: 'queued' as const }
  const next = push(state, ctx, { type: 'approval', record }, [
    { kind: 'approval-request', subjectUserId: input.reviewerUserId, target: input.target, refId: record.id },
  ])
  return { ...next, approvals: [...state.approvals, record] }
}

// ── selectors ────────────────────────────────────────────────────────────

const sameTarget = (a: TeamTarget, target: Pick<TeamTarget, 'kind' | 'id' | 'revision'>) =>
  a.kind === target.kind && a.id === target.id && (target.revision === undefined || a.revision === target.revision)

export function selectForTarget(state: TeamLocalState, kind: TeamTarget['kind'], id: string, revision?: string) {
  const target = { kind, id, revision }
  return {
    comments: state.comments.filter((c) => sameTarget(c.target, target) && !c.deletedAt),
    assignment: state.assignments.find((a) => sameTarget(a.target, target)) ?? null,
    handoffs: state.handoffs.filter((h) => sameTarget(h.target, target)),
    access: state.access.filter((g) => sameTarget(g.target, target)),
    approvals: state.approvals.filter((a) => sameTarget(a.target, target)),
  }
}

/** Only explicitly delivered records enter a recipient inbox. */
/** Only acknowledged, still-pending recipient requests enter the receiver's Inbox. */
export function selectInboxForUser(state: TeamLocalState, userId: string): TeamInboxItem[] {
  return state.recipientRequests
    .filter((request) =>
      request.delivery === 'delivered' &&
      request.decision === 'pending' &&
      request.recipientUserId === userId &&
      Boolean(request.target.revision),
    )
    .map((request) => {
      const pendingAction = state.recipientActions.find((action) => action.requestId === request.id)
      return {
        id: `team-recipient:${request.organizationId}:${request.id}`,
        kind: 'recipient-request' as const,
        fromUserId: request.senderUserId,
        target: request.target,
        at: request.createdAt,
        delivery: 'delivered' as const,
        organizationId: request.organizationId,
        ...(pendingAction ? { pendingAction: pendingAction.decision, pendingActionSync: pendingAction.sync } : {}),
        requestId: request.id,
      }
    })
    .sort((a, b) => b.at - a.at)
}

export function pendingOutboxCount(state: TeamLocalState): number {
  return state.outbox.length
}
