/**
 * W1-03 (#1500) — Realtime topic grammar, event catalogue and frames
 * (TECH-SPEC §3.5, §5).
 *
 * One socket per client; subscriptions are ACL-checked on subscribe; the
 * server pushes `{topic, type, seq, payload}` with a per-topic monotonically
 * increasing `seq`. Locally, server-core re-emits the same frame over the
 * WS-RPC push so renderer code is identical in both modes.
 */

import { isEntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'

export const TOPIC_KINDS = ['user', 'channel', 'entity', 'space', 'task-list', 'calendar', 'doc', 'meeting', 'workspace'] as const
export type TopicKind = (typeof TOPIC_KINDS)[number]

/** A topic string such as `channel:123` or `entity:task:abc`. */
export type Topic = string

export type ParsedTopic =
  | { kind: 'user'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'entity'; ref: EntityRef }
  | { kind: 'space'; id: string }
  | { kind: 'task-list'; id: string }
  | { kind: 'calendar'; id: string }
  | { kind: 'doc'; id: string }
  | { kind: 'meeting'; id: string }
  | { kind: 'workspace'; id: string }

export const MAX_TOPIC_ID_LENGTH = 256
const TOPIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/

function validId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_TOPIC_ID_LENGTH && TOPIC_ID_PATTERN.test(id)
}

/** Parse a topic string; `null` for anything outside the grammar (never throws). */
export function parseTopic(topic: unknown): ParsedTopic | null {
  if (typeof topic !== 'string' || topic.length > 320) return null
  const colon = topic.indexOf(':')
  if (colon <= 0) return null
  const kind = topic.slice(0, colon)
  const rest = topic.slice(colon + 1)
  if (kind === 'entity') {
    const inner = rest.indexOf(':')
    if (inner <= 0) return null
    const entityKind = rest.slice(0, inner)
    const id = rest.slice(inner + 1)
    // Canonical kinds only (no alias normalisation in topic names) and no fragments.
    if (!isEntityKind(entityKind) || !validId(id)) return null
    return { kind: 'entity', ref: { kind: entityKind, id } }
  }
  if (!(TOPIC_KINDS as readonly string[]).includes(kind) || !validId(rest)) return null
  return { kind: kind as Exclude<TopicKind, 'entity'>, id: rest } as ParsedTopic
}

export function formatTopic(parsed: ParsedTopic): Topic {
  return parsed.kind === 'entity' ? `entity:${parsed.ref.kind}:${parsed.ref.id}` : `${parsed.kind}:${parsed.id}`
}

/** Canonical form, or `null` when invalid. */
export function normalizeTopic(topic: unknown): Topic | null {
  const parsed = parseTopic(topic)
  return parsed ? formatTopic(parsed) : null
}

export function userTopic(principalId: string): Topic { return `user:${principalId}` }
export function entityTopic(ref: EntityRef): Topic { return `entity:${ref.kind}:${ref.id}` }

/**
 * What the ACL check on subscribe looks at (W1-04 plugs `acl.can` in):
 * - `self`: only that principal may subscribe (`user:{id}`);
 * - `workspace`: workspace membership (`workspace:{id}`);
 * - `entity`: `can(principal, 'read', ref)`.
 */
export type TopicAclTarget =
  | { kind: 'self'; principalId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'entity'; ref: EntityRef }

export function topicAclTarget(parsed: ParsedTopic): TopicAclTarget {
  switch (parsed.kind) {
    case 'user': return { kind: 'self', principalId: parsed.id }
    case 'workspace': return { kind: 'workspace', workspaceId: parsed.id }
    case 'entity': return { kind: 'entity', ref: parsed.ref }
    case 'channel': return { kind: 'entity', ref: { kind: 'channel', id: parsed.id } }
    case 'doc': return { kind: 'entity', ref: { kind: 'note', id: parsed.id } }
    case 'meeting': return { kind: 'entity', ref: { kind: 'call', id: parsed.id } }
    case 'space': return { kind: 'entity', ref: { kind: 'space', id: parsed.id } }
    case 'task-list': return { kind: 'entity', ref: { kind: 'task-list', id: parsed.id } }
    case 'calendar': return { kind: 'entity', ref: { kind: 'calendar', id: parsed.id } }
  }
}

/** TECH-SPEC §5 realtime event types per topic kind (v1 + v2 additions). Append-only. */
export const REALTIME_EVENT_TYPES: Readonly<Record<TopicKind, readonly string[]>> = {
  user: [
    'notification.created', 'notification.read', 'review.changed', 'chat.feed_updated', 'chat.unread_changed',
    'task.assigned', 'mention.created', 'presence.changed',
    'approval.requested', 'approval.decided', 'agent.reported', 'agent.rate_limited', 'quota.threshold',
    'invite.status_changed', 'rule.failed',
    // W1-03 exit criterion (ping round-trip).
    'system.pinged',
  ],
  channel: [
    'message.created', 'message.edited', 'message.recalled', 'reaction.changed', 'pin.changed', 'chat.updated',
    'member.added', 'member.removed', 'tab.changed', 'typing', 'read.changed', 'unfurl.updated',
    'member.pending_added', 'member.activated',
  ],
  doc: ['comment.created', 'comment.updated', 'comment.resolved', 'acl.changed', 'snapshot.written', 'doc.moved', 'doc.deleted'],
  entity: [
    'entity.updated', 'entity.deleted', 'entity.moved', 'link.added', 'link.removed', 'comment.created', 'comment.updated',
    'comment.resolved', 'reaction.changed', 'presence.viewers', 'suggestion.created', 'suggestion.decided',
    'comment.thread_resolved', 'comment.thread_reopened',
  ],
  'task-list': ['task.created', 'task.updated', 'task.moved', 'task.deleted', 'section.changed', 'status_set.changed'],
  space: ['workmap.changed', 'space.updated', 'space.members_changed', 'discussion.posted', 'kpi.entry_logged'],
  calendar: ['event.created', 'event.updated', 'event.deleted', 'rsvp.changed', 'calendar.members_changed'],
  meeting: ['meeting.started', 'meeting.ended', 'recording.ready', 'transcript.ready', 'proposal.created'],
  workspace: ['directory.changed', 'flags.changed', 'space.created'],
}

export function isRealtimeEventType(kind: TopicKind, type: string): boolean {
  return REALTIME_EVENT_TYPES[kind].includes(type)
}

// ---------------------------------------------------------------------------
// Frames (Phase-2 TECH-SPEC §3.3 shapes, carried over WS-RPC)
// ---------------------------------------------------------------------------

/** Server → client: one realtime event (projection of exactly one `domain_event`). */
export interface RealtimeEventFrame<P = unknown> {
  frame: 'event'
  topic: Topic
  /** Realtime event type (TECH-SPEC §5), e.g. `entity.updated`. */
  type: string
  /** Per-topic, strictly increasing, starting at 1 within one `epoch`. */
  seq: number
  /** Sequencer epoch; a new epoch (e.g. server restart) invalidates older seqs. */
  epoch: string
  payload: P
  /** Source `domain_event.event_id`. */
  eventId?: string
  /** Source `domain_event.type`. */
  domainType?: string
  at: string
}

/** Server → client: the requested history is no longer replayable; refetch via the query API. */
export interface RealtimeSnapshotRequiredFrame {
  frame: 'snapshot_required'
  topic: Topic
  /** The topic's current seq: after the refetch, continue from here. */
  latestSeq: number
  epoch: string
}

export type RealtimeFrame = RealtimeEventFrame | RealtimeSnapshotRequiredFrame

export interface RealtimeSubscribeTopic {
  topic: Topic
  /** Last seq the client has applied; omit for "from now". */
  sinceSeq?: number
  /** Epoch of `sinceSeq`; a different epoch means the client must refetch. */
  epoch?: string
}

export interface RealtimeSubscribeRequest {
  topics: RealtimeSubscribeTopic[]
  /** Resume from the server-side cursor (`realtime_cursor`) when `sinceSeq` is omitted. */
  resume?: boolean
}

export type RealtimeSubscribeStatus = 'subscribed' | 'forbidden' | 'invalid' | 'snapshot_required' | 'limit_exceeded'

export interface RealtimeSubscribeTopicResult {
  topic: Topic
  status: RealtimeSubscribeStatus
  /** Current seq of the topic (0 when nothing was published yet). */
  seq: number
  epoch: string
  /** Missed frames after `sinceSeq`, in seq order (replay closes the client's gap). */
  frames?: RealtimeEventFrame[]
}

export interface RealtimeSubscribeResult {
  topics: RealtimeSubscribeTopicResult[]
}

/** Upper bound for topics in one subscribe call. */
export const MAX_SUBSCRIBE_TOPICS = 100

/** Upper bound for topics one client may hold across all subscribe calls (`limit_exceeded`). */
export const MAX_TOPICS_PER_CLIENT = 500

/** WS-RPC channels of the workspace realtime gateway (workspace-service). */
export const REALTIME_RPC = {
  /** `(workspaceId, RealtimeSubscribeRequest) → RealtimeSubscribeResult` */
  SUBSCRIBE: 'realtime:subscribe',
  /** `(workspaceId, { topics }) → { topics }` */
  UNSUBSCRIBE: 'realtime:unsubscribe',
  /** Push: `(workspaceId, RealtimeFrame)` */
  EVENT: 'realtime:event',
} as const

