/**
 * W1-09 (#1506) — Which domain event notifies whom (DATA-MODEL §9.1 → §9.2).
 *
 * The trigger table is the only place that maps an activity type to a
 * notification kind. Events with no row fan out to nobody:
 * - scheduler-driven kinds have no domain-event trigger at all
 *   (`check_in_due`, `task_due`, `task_overdue`, `milestone_due`,
 *   `kpi_update_due`, `event_reminder`, `invite_pending`, `reminder_due`);
 * - `collab.doc_viewed` is explicitly "not fanned out" (DATA-MODEL §9.1), so
 *   views can never produce a notification.
 *
 * Payloads are projected onto ids only (`restrictNotificationPayload`): the
 * fan-out never copies entity content into a notification, so a payload can be
 * delivered to every recipient without leaking restricted text. Titles are
 * resolved at render time through the entity resolver.
 */

import { isEntityKind, type EntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { DomainEvent, DomainEventType } from '../events/types.ts'
import { resolveAudience, type AudienceContext, type AudienceOptions, type AudienceResolution } from './audience.ts'
import { NOTIFICATION_PAYLOAD_KEYS, type NotificationKind, type NotificationPayload } from './types.ts'

/** Max nesting walked when collecting refs from a payload (payloads are shallow). */
export const MAX_PAYLOAD_DEPTH = 6
/** Payloads never carry more refs than this. */
export const MAX_PAYLOAD_REFS = 32
/** Scalar id fields copied into `payload.ids`. */
export const MAX_PAYLOAD_ID_FIELDS = 16

export interface NotificationTriggerRule {
  type: DomainEventType
  kind: NotificationKind
  /**
   * Extra guard, total and side-effect free. A check-in whose `notify` policy
   * is `none` is a silent update and notifies nobody (DATA-MODEL §9.2 uses the
   * `check_in.notify` setting for the subscriber part of the audience).
   */
  when?: (event: DomainEvent) => boolean
  /** Contract note (why this row exists). */
  note?: string
}

/** Event type → notification kind (append-only). */
export const NOTIFICATION_TRIGGERS: readonly NotificationTriggerRule[] = [
  // goals (DATA-MODEL §9.1/§9.2)
  { type: 'goals.goal_check_in', kind: 'check_in_submitted', when: event => payloadField(event, 'notify') !== 'none', note: 'check-in published → reviewer (+ subscribers by notify setting)' },
  { type: 'goals.goal_check_in_acknowledgement', kind: 'check_in_acknowledged', note: 'acknowledgement → champion' },
  { type: 'goals.goal_champion_updating', kind: 'assignment', note: 'champion set → the new champion' },
  { type: 'goals.goal_reviewer_updating', kind: 'assignment', note: 'reviewer set → the new reviewer' },
  { type: 'goals.goal_check_in_commented', kind: 'comment', note: 'comment on a subscribed goal' },
  { type: 'goals.goal_closing', kind: 'retrospective', note: 'goal closed → reviewer + subscribers' },
  // projects
  { type: 'projects.project_check_in_submitted', kind: 'check_in_submitted', when: event => payloadField(event, 'notify') !== 'none' },
  { type: 'projects.project_check_in_acknowledged', kind: 'check_in_acknowledged' },
  { type: 'projects.project_contributor_addition', kind: 'assignment', note: 'contributor added' },
  { type: 'projects.project_closed', kind: 'retrospective' },
  // tasks
  { type: 'task.task_assignee_assignment', kind: 'assignment' },
  { type: 'task.space_task_commented', kind: 'comment' },
  { type: 'task.project_task_commented', kind: 'comment' },
  // social
  { type: 'entities.mentioned_people', kind: 'mention' },
  { type: 'entities.comment_added', kind: 'comment', note: 'comment on a subscribed entity' },
  // docs
  { type: 'docs.document_commented', kind: 'comment' },
  { type: 'docs.note_shared', kind: 'doc_shared' },
  { type: 'docs.permission_changed', kind: 'doc_shared' },
  { type: 'docs.document_public_sharing_changed', kind: 'doc_shared' },
  // kpis / spaces
  { type: 'kpis.kpi_entry_commented', kind: 'comment' },
  { type: 'spaces.space_members_added', kind: 'space_invite' },
  { type: 'spaces.discussion_comment_submitted', kind: 'comment' },
  // messenger
  { type: 'im.message.receive_v1', kind: 'im_message', note: 'chat members − sender − muted (OS badge)' },
  { type: 'im.chat.member.user.added_v1', kind: 'chat_invite' },
  // calendar / meetings
  { type: 'calendar.calendar.event.changed_v4', kind: 'event_invite' },
  { type: 'vc.meeting.all_meeting_ended_v1', kind: 'meeting_started' },
  // v2: agents, collaboration, drive, automation
  { type: 'agents.approval_requested', kind: 'approval_request' },
  { type: 'agents.agent_action_executed', kind: 'agent_report' },
  { type: 'collab.suggestion_created', kind: 'suggestion' },
  { type: 'collab.comment_thread_resolved', kind: 'thread_resolved' },
  { type: 'collab.comment_thread_reopened', kind: 'thread_resolved', note: 'thread state change → the same participants' },
  { type: 'drive.quota_threshold_crossed', kind: 'quota_warning' },
  { type: 'automation.rule_execution_failed', kind: 'rule_failed' },
]

const TRIGGER_BY_TYPE: Readonly<Record<string, NotificationTriggerRule | undefined>> = Object.fromEntries(
  NOTIFICATION_TRIGGERS.map(rule => [rule.type, rule]),
)

export function notificationTriggerFor(type: string): NotificationTriggerRule | undefined {
  return TRIGGER_BY_TYPE[type]
}

function payloadField(event: DomainEvent, key: string): unknown {
  const payload = event.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return (payload as Record<string, unknown>)[key]
}

// ---------------------------------------------------------------------------
// Ids-only projection
// ---------------------------------------------------------------------------

function entityRefOf(value: unknown): EntityRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as { kind?: unknown; id?: unknown; fragment?: unknown }
  if (typeof candidate.kind !== 'string' || !isEntityKind(candidate.kind)) return undefined
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return undefined
  const ref: EntityRef = { kind: candidate.kind as EntityKind, id: candidate.id }
  if (typeof candidate.fragment === 'string' && candidate.fragment.length > 0) ref.fragment = candidate.fragment
  return ref
}

/** Every entity ref in a (possibly nested) payload value, deduped, ids only. */
export function collectEntityRefs(value: unknown, limit = MAX_PAYLOAD_REFS): EntityRef[] {
  const found: EntityRef[] = []
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_PAYLOAD_DEPTH || found.length >= limit) return
    const ref = entityRefOf(node)
    if (ref) {
      const key = `${ref.kind}:${ref.id}${ref.fragment ? `#${ref.fragment}` : ''}`
      if (!seen.has(key)) {
        seen.add(key)
        found.push(ref)
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const item of Object.values(node as Record<string, unknown>)) walk(item, depth + 1)
    }
  }
  walk(value, 0)
  return found
}

function scalarIdFields(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const ids: Record<string, string> = {}
  let count = 0
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_PAYLOAD_ID_FIELDS) break
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 256) continue
    ids[key] = entry
    count += 1
  }
  return Object.keys(ids).length > 0 ? ids : undefined
}

/**
 * Project an arbitrary event payload onto the notification payload shape.
 * Anything that is not a ref, a revision, a due instant or an id string is
 * dropped — titles, bodies, messages and every other content field never
 * reach a notification.
 */
export function restrictNotificationPayload(value: unknown): NotificationPayload {
  const payload: NotificationPayload = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return payload
  const source = value as Record<string, unknown>
  if (!NOTIFICATION_PAYLOAD_KEYS.some(key => key in source)) {
    // No shaped fields: keep the refs the raw payload holds.
    const refs = collectEntityRefs(source)
    if (refs.length > 0) payload.refs = refs
    return payload
  }
  const refs = collectEntityRefs(source.refs)
  if (refs.length > 0) payload.refs = refs
  if (typeof source.revision === 'number' && Number.isSafeInteger(source.revision) && source.revision >= 0) payload.revision = source.revision
  if (typeof source.dueAt === 'string' && source.dueAt.length <= 64) payload.dueAt = source.dueAt
  const ids = scalarIdFields(source.ids)
  if (ids) payload.ids = ids
  return payload
}

// ---------------------------------------------------------------------------
// The plan (pure)
// ---------------------------------------------------------------------------

export interface PlannedNotification {
  principalId: string
  kind: NotificationKind
  subject?: EntityRef
  actorId?: string
  payload: NotificationPayload
}

export type NotificationSkipReason = 'unmapped_event' | 'silent_event' | 'no_audience'

export interface NotificationPlan {
  kind?: NotificationKind
  audience?: AudienceResolution
  notifications: PlannedNotification[]
  skipped?: NotificationSkipReason
}

export interface PlanNotificationsInput {
  event: DomainEvent
  audience: AudienceContext
  /** Allow the actor to be notified (tests / self-reminders); default off. */
  includeActor?: boolean
  /** Extra principals to exclude (e.g. resolved mutes). */
  exclude?: readonly string[] | undefined
}

/**
 * The fan-out decision for one event, without I/O: kind, recipients and the
 * ids-only payload each of them receives. ACL and preferences are applied by
 * the caller (the ACL needs the recipient, the prefs need the kind).
 */
export function planNotifications(input: PlanNotificationsInput): NotificationPlan {
  const trigger = notificationTriggerFor(input.event.type)
  if (!trigger) return { notifications: [], skipped: 'unmapped_event' }
  let fires = true
  try {
    fires = trigger.when?.(input.event) !== false
  } catch {
    // A guard must never break fan-out; a malformed payload keeps the event quiet.
    fires = false
  }
  if (!fires) return { kind: trigger.kind, notifications: [], skipped: 'silent_event' }

  const audienceOptions: AudienceOptions = {
    ...(input.includeActor ? { includeActor: true } : {}),
    ...(input.exclude ? { exclude: input.exclude } : {}),
  }
  const audience = resolveAudience(trigger.kind, input.audience, audienceOptions)
  if (audience.recipients.length === 0) return { kind: trigger.kind, audience, notifications: [], skipped: 'no_audience' }

  const payload = restrictNotificationPayload(input.event.payload)
  const subject = input.event.subject
  const notifications = audience.recipients.map(principalId => {
    const planned: PlannedNotification = { principalId, kind: trigger.kind, payload }
    if (subject) planned.subject = { kind: subject.kind, id: subject.id, ...(subject.fragment ? { fragment: subject.fragment } : {}) }
    if (input.event.actorId) planned.actorId = input.event.actorId
    return planned
  })
  return { kind: trigger.kind, audience, notifications }
}