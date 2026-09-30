/**
 * Pure aggregation for the Входящие mode screen: everything waiting on me,
 * normalized into InboxItem rows from sources that already exist in the app
 * (pending permissions/credentials, plans, memory proposals, skill candidates,
 * new messenger senders, unread agent replies). No I/O here.
 */

import type { TeamInboxItem } from '@craft-agent/shared/team'

export type InboxKind = 'permission' | 'credential' | 'plan' | 'memory' | 'skill' | 'sender' | 'reply' | 'error' | 'mail' | 'team-recipient'
export type InboxGroup = 'decision' | 'message'
export type InboxView = 'all' | 'decisions' | 'messages' | 'snoozed' | 'done'
export type InboxFilter = InboxView | { kind: InboxKind }

export interface InboxItem {
  id: string
  kind: InboxKind
  group: InboxGroup
  /** Blocks an agent until answered (drives the pill badge). */
  blocking: boolean
  title: string
  /** Where it came from: session name, platform, … */
  source: string
  at: number
  sessionId?: string
  /** Stable source-object identity retained through aggregation and actions. */
  sourceRef?: { domain: 'team-recipient'; organizationId: string; requestId: string; targetKind: string; targetId: string; targetRevision: string }
  data?: unknown
}

export interface InboxState {
  done: Record<string, number>
  snoozed: Record<string, number>
}

export const EMPTY_INBOX_STATE: InboxState = { done: {}, snoozed: {} }

export const DECISION_KINDS: readonly InboxKind[] = ['permission', 'credential', 'plan', 'memory', 'skill', 'sender', 'team-recipient']
export const ALL_KINDS: readonly InboxKind[] = ['permission', 'credential', 'plan', 'memory', 'skill', 'sender', 'reply', 'error', 'mail', 'team-recipient']

export interface SessionLike {
  id: string
  name?: string
  preview?: string
  lastMessageAt?: number
  isProcessing?: boolean
  hasUnread?: boolean
  lastMessageRole?: string
  lastFinalMessageId?: string
  sessionStatus?: string
}

export interface PermissionLike {
  requestId: string
  sessionId: string
  toolName: string
  command?: string
  description: string
  appName?: string
  reason?: string
}

export interface CredentialLike {
  requestId: string
  sessionId?: string
  sourceSlug?: string
  sourceName?: string
  description?: string
  mode?: string
}

export interface MemoryProposalLike {
  id: string
  text: string
  status: string
  sessionId: string
  createdAt: string
  kind?: string
}

export interface PendingSkillLike {
  slug: string
  description: string
  createdAt?: string | number
}

export interface PendingSenderLike {
  platform: string
  userId: string
  displayName?: string
  username?: string
  lastAttemptAt: number
  attemptCount: number
  bindingId?: string
  reason?: string
}

export interface InboxSources {
  sessions: readonly SessionLike[]
  permissions: ReadonlyMap<string, readonly PermissionLike[]>
  credentials: ReadonlyMap<string, readonly CredentialLike[]>
  memoryProposals?: readonly MemoryProposalLike[]
  pendingSkills?: readonly PendingSkillLike[]
  pendingSenders?: readonly PendingSenderLike[]
  /** Only server-confirmed addressed requests from the team domain. */
  teamInbox?: readonly TeamInboxItem[]
  /** First-seen timestamps for items without their own time (keeps order stable). */
  firstSeen?: ReadonlyMap<string, number>
  now: number
}

export function sessionTitle(session: SessionLike | undefined, fallback: string): string {
  const name = session?.name?.trim() || session?.preview?.trim()
  return name ? name.slice(0, 80) : fallback
}

function ts(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

export function buildInboxItems(src: InboxSources): InboxItem[] {
  const sessions = new Map(src.sessions.map((s) => [s.id, s]))
  const seen = (id: string) => src.firstSeen?.get(id) ?? src.now
  const items: InboxItem[] = []

  for (const [sessionId, list] of src.permissions) {
    for (const req of list) {
      const id = `perm:${sessionId}:${req.requestId}`
      items.push({
        id, kind: 'permission', group: 'decision', blocking: true,
        title: req.appName || req.command || req.toolName,
        source: sessionTitle(sessions.get(sessionId), sessionId),
        at: seen(id), sessionId, data: req,
      })
    }
  }
  for (const [sessionId, list] of src.credentials) {
    for (const req of list) {
      const id = `cred:${sessionId}:${req.requestId}`
      items.push({
        id, kind: 'credential', group: 'decision', blocking: true,
        title: req.sourceName || req.sourceSlug || req.description || req.requestId,
        source: sessionTitle(sessions.get(sessionId), sessionId),
        at: seen(id), sessionId, data: req,
      })
    }
  }
  for (const session of src.sessions) {
    if (session.lastMessageRole === 'plan' && !session.isProcessing) {
      const id = `plan:${session.id}:${session.lastFinalMessageId ?? session.lastMessageAt ?? ''}`
      items.push({
        id, kind: 'plan', group: 'decision', blocking: true,
        title: sessionTitle(session, session.id), source: sessionTitle(session, session.id),
        at: session.lastMessageAt ?? seen(id), sessionId: session.id,
      })
    } else if (session.lastMessageRole === 'error' && !session.isProcessing && session.hasUnread) {
      const id = `error:${session.id}:${session.lastFinalMessageId ?? session.lastMessageAt ?? ''}`
      items.push({
        id, kind: 'error', group: 'message', blocking: false,
        title: sessionTitle(session, session.id), source: sessionTitle(session, session.id),
        at: session.lastMessageAt ?? seen(id), sessionId: session.id,
      })
    } else if (session.hasUnread && !session.isProcessing) {
      const id = `reply:${session.id}:${session.lastFinalMessageId ?? session.lastMessageAt ?? ''}`
      items.push({
        id, kind: 'reply', group: 'message', blocking: false,
        title: sessionTitle(session, session.id), source: sessionTitle(session, session.id),
        at: session.lastMessageAt ?? seen(id), sessionId: session.id,
      })
    }
  }
  for (const proposal of src.memoryProposals ?? []) {
    if (proposal.status !== 'pending') continue
    const id = `mem:${proposal.id}`
    items.push({
      id, kind: 'memory', group: 'decision', blocking: false,
      title: proposal.text.slice(0, 120),
      source: sessionTitle(sessions.get(proposal.sessionId), proposal.sessionId),
      at: ts(proposal.createdAt, seen(id)), sessionId: proposal.sessionId, data: proposal,
    })
  }
  for (const skill of src.pendingSkills ?? []) {
    const id = `skill:${skill.slug}`
    items.push({
      id, kind: 'skill', group: 'decision', blocking: false,
      title: skill.slug, source: skill.description.slice(0, 120),
      at: ts(skill.createdAt, seen(id)), data: skill,
    })
  }
  for (const sender of src.pendingSenders ?? []) {
    const id = `sender:${sender.platform}:${sender.userId}:${sender.bindingId ?? ''}`
    items.push({
      id, kind: 'sender', group: 'decision', blocking: false,
      title: sender.displayName || (sender.username ? `@${sender.username}` : sender.userId),
      source: sender.platform,
      at: sender.lastAttemptAt || seen(id), data: sender,
    })
  }
  const seenTeamRecipientIds = new Set<string>()
  for (const item of src.teamInbox ?? []) {
    if (item.kind !== 'recipient-request' || item.delivery !== 'delivered' || !item.organizationId || !item.requestId || !item.target.revision) continue
    const id = `team-recipient:${item.organizationId}:${item.requestId}`
    if (seenTeamRecipientIds.has(id)) continue
    seenTeamRecipientIds.add(id)
    const source = item.target.title?.trim() || `${item.target.kind}:${item.target.id}`
    items.push({
      id,
      kind: 'team-recipient',
      group: 'decision',
      blocking: false,
      title: item.target.title?.trim() || item.target.id,
      source,
      at: item.at,
      sourceRef: {
        domain: 'team-recipient',
        organizationId: item.organizationId,
        requestId: item.requestId,
        targetKind: item.target.kind,
        targetId: item.target.id,
        targetRevision: item.target.revision,
      },
      data: item,
    })
  }
  return sortInbox(items)
}

/** Decisions first (blocking ones oldest-first: longest wait on top), then messages newest-first. */
export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  const rank = (item: InboxItem) => (item.blocking ? 0 : item.group === 'decision' ? 1 : 2)
  return [...items].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    return rank(a) === 0 ? a.at - b.at : b.at - a.at
  })
}

export function isSnoozed(state: InboxState, id: string, now: number): boolean {
  const until = state.snoozed[id]
  return until !== undefined && until > now
}

export function isActive(state: InboxState, item: InboxItem, now: number): boolean {
  return state.done[item.id] === undefined && !isSnoozed(state, item.id, now)
}

export function filterInbox(items: readonly InboxItem[], state: InboxState, filter: InboxFilter, now: number): InboxItem[] {
  if (typeof filter === 'object') return items.filter((item) => item.kind === filter.kind && isActive(state, item, now))
  switch (filter) {
    case 'all': return items.filter((item) => isActive(state, item, now))
    case 'decisions': return items.filter((item) => item.group === 'decision' && isActive(state, item, now))
    case 'messages': return items.filter((item) => item.group === 'message' && isActive(state, item, now))
    case 'snoozed': return items.filter((item) => state.done[item.id] === undefined && isSnoozed(state, item.id, now))
    case 'done': return items.filter((item) => state.done[item.id] !== undefined)
  }
}

export function inboxCounts(items: readonly InboxItem[], state: InboxState, now: number) {
  const active = items.filter((item) => isActive(state, item, now))
  const byKind = Object.fromEntries(ALL_KINDS.map((k) => [k, active.filter((i) => i.kind === k).length])) as Record<InboxKind, number>
  return {
    all: active.length,
    decisions: active.filter((i) => i.group === 'decision').length,
    messages: active.filter((i) => i.group === 'message').length,
    snoozed: items.filter((i) => state.done[i.id] === undefined && isSnoozed(state, i.id, now)).length,
    done: items.filter((i) => state.done[i.id] !== undefined).length,
    blocking: active.filter((i) => i.blocking).length,
    byKind,
  }
}

export function markDone(state: InboxState, id: string, now: number): InboxState {
  const snoozed = { ...state.snoozed }
  delete snoozed[id]
  return { done: { ...state.done, [id]: now }, snoozed }
}

export function reopen(state: InboxState, id: string): InboxState {
  const done = { ...state.done }
  const snoozed = { ...state.snoozed }
  delete done[id]
  delete snoozed[id]
  return { done, snoozed }
}

export function snooze(state: InboxState, id: string, until: number): InboxState {
  return { ...state, snoozed: { ...state.snoozed, [id]: until } }
}

/** Drop state for items that no longer exist (resolved elsewhere) and expired snoozes. */
export function pruneInboxState(state: InboxState, liveIds: ReadonlySet<string>, now: number): InboxState {
  const done: Record<string, number> = {}
  const snoozed: Record<string, number> = {}
  for (const [id, at] of Object.entries(state.done)) if (liveIds.has(id)) done[id] = at
  for (const [id, until] of Object.entries(state.snoozed)) if (liveIds.has(id) && until > now) snoozed[id] = until
  const same = Object.keys(done).length === Object.keys(state.done).length && Object.keys(snoozed).length === Object.keys(state.snoozed).length
  return same ? state : { done, snoozed }
}

/** «Отложить»: later today (+3h), tomorrow 9:00, next Monday 9:00. */
export function snoozeTargets(now: number): { laterToday: number; tomorrow: number; nextWeek: number } {
  const d = new Date(now)
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0, 0)
  const daysToMonday = ((8 - d.getDay()) % 7) || 7
  const nextWeek = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToMonday, 9, 0, 0, 0)
  return { laterToday: now + 3 * 3_600_000, tomorrow: tomorrow.getTime(), nextWeek: nextWeek.getTime() }
}
