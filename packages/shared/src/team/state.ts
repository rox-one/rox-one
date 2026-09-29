import type {
  TeamAccessRole,
  TeamActivityEvent,
  TeamApprovalStatus,
  TeamInboxItem,
  TeamLocalState,
  TeamMemberRef,
  TeamOutboxOp,
  TeamTarget,
} from './types.ts'
import { resolveMentions } from './mentions.ts'

export const TEAM_ACTIVITY_LIMIT = 500

export function emptyTeamState(): TeamLocalState {
  return { version: 1, comments: [], assignments: [], handoffs: [], access: [], approvals: [], activity: [], outbox: [] }
}

/** Defensive parse of persisted state; anything malformed falls back to empty collections. */
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
    activity: arr<TeamActivityEvent>(r.activity).slice(0, TEAM_ACTIVITY_LIMIT),
    outbox: arr(r.outbox),
  }
}

export interface TeamActionContext {
  selfUserId: string
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
  input: { target: TeamTarget; body: string; roster: readonly TeamMemberRef[] },
): TeamLocalState {
  const body = requireText(input.body, 'comment body')
  const mentions = resolveMentions(body, input.roster).filter((id) => id !== ctx.selfUserId)
  const record = { id: ctx.newId(), target: input.target, authorUserId: ctx.selfUserId, body, mentions, createdAt: ctx.now, sync: 'queued' as const }
  const next = push(state, ctx, { type: 'comment', record }, [
    { kind: 'comment', target: input.target, refId: record.id },
    ...mentions.map((uid) => ({ kind: 'mention' as const, subjectUserId: uid, target: input.target, refId: record.id })),
  ])
  return { ...next, comments: [...state.comments, record] }
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

const sameTarget = (a: TeamTarget, kind: TeamTarget['kind'], id: string) => a.kind === kind && a.id === id

export function selectForTarget(state: TeamLocalState, kind: TeamTarget['kind'], id: string) {
  return {
    comments: state.comments.filter((c) => sameTarget(c.target, kind, id)),
    assignment: state.assignments.find((a) => sameTarget(a.target, kind, id)) ?? null,
    handoffs: state.handoffs.filter((h) => sameTarget(h.target, kind, id)),
    access: state.access.filter((g) => sameTarget(g.target, kind, id)),
    approvals: state.approvals.filter((a) => sameTarget(a.target, kind, id)),
  }
}

/**
 * Items addressed to `userId` from someone else. Locally-authored records are
 * always from self, so this is empty until an org server delivers teammates'
 * records via pull() — the UI must render that honestly.
 */
export function selectInboxForUser(state: TeamLocalState, userId: string): TeamInboxItem[] {
  const items: TeamInboxItem[] = []
  for (const c of state.comments) {
    if (c.authorUserId !== userId && c.mentions.includes(userId)) items.push({ id: c.id, kind: 'mention', fromUserId: c.authorUserId, target: c.target, at: c.createdAt, text: c.body })
  }
  for (const h of state.handoffs) {
    if (h.fromUserId !== userId && h.toUserId === userId) items.push({ id: h.id, kind: 'handoff', fromUserId: h.fromUserId, target: h.target, at: h.createdAt, text: h.summary })
  }
  for (const a of state.assignments) {
    if (a.assignedByUserId !== userId && a.assigneeUserId === userId) items.push({ id: a.id, kind: 'assign', fromUserId: a.assignedByUserId, target: a.target, at: a.createdAt })
  }
  for (const r of state.approvals) {
    if (r.requestedByUserId !== userId && r.reviewerUserId === userId && r.status === 'pending') items.push({ id: r.id, kind: 'approval', fromUserId: r.requestedByUserId, target: r.target, at: r.createdAt, text: r.note })
  }
  return items.sort((a, b) => b.at - a.at)
}

export function pendingOutboxCount(state: TeamLocalState): number {
  return state.outbox.length
}
