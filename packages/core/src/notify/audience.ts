/**
 * W1-09 (#1506) — Notification audience resolution (DATA-MODEL §9.2).
 *
 * The rules are table-driven: `notificationKindDescriptor(kind).audience`
 * names the sources a kind reads, and this module is the only place that
 * knows how to read them. Operately's rule applies to every kind: **the actor
 * is never notified about their own action**, and one principal gets at most
 * one notification per event.
 *
 * Where the audience data comes from is the host's business: the workspace
 * service fills an `AudienceContext` from the entity store (goal champion /
 * reviewer, `subscription` rows, `work_item_member`, the check-in `notify`
 * policy). The resolver is a pure function of that context.
 */

import { notificationKindDescriptor, type AudienceSource, type NotificationKind } from './types.ts'

export const AUDIENCE_SOURCES = [
  'mentioned',
  'assignees',
  'champion',
  'reviewer',
  'subscribers',
  'allSubscribers',
  'threadParticipants',
  'owner',
  'invitee',
  'attendees',
  'members',
  'participants',
  'targets',
] as const satisfies readonly AudienceSource[]

/**
 * Principal ids per source. Everything is optional: a source the event cannot
 * fill simply contributes nobody.
 *
 * - `assignees` — directly addressed people (task assignee, new champion / reviewer, contributor).
 * - `subscribers` — `subscription` rows for the subject.
 * - `allSubscribers` — subscribers included by the subject's notify setting
 *   (`check_in.notify = 'everyone'`); `selected` / `none` leave this empty.
 * - `threadParticipants` — everyone in a comment thread (`comment_reply`, `thread_resolved`).
 * - `owner` — the principal the notification belongs to (doc owner, agent owner,
 *   drive owner, reminder owner, inviter).
 * - `invitee` — the person added to a chat / space.
 * - `attendees` / `participants` / `members` — calendar, meeting, chat membership.
 * - `targets` — the principals an ACL event addresses (sharee), or the
 *   managers / admins a failure escalates to.
 */
export interface AudienceContext {
  /** The principal whose action caused the event; never notified. */
  actorId?: string | null | undefined
  mentioned?: readonly string[] | undefined
  assignees?: readonly string[] | undefined
  champion?: string | null | undefined
  reviewer?: string | null | undefined
  subscribers?: readonly string[] | undefined
  allSubscribers?: readonly string[] | undefined
  threadParticipants?: readonly string[] | undefined
  owner?: string | null | undefined
  invitee?: string | null | undefined
  attendees?: readonly string[] | undefined
  members?: readonly string[] | undefined
  participants?: readonly string[] | undefined
  targets?: readonly string[] | undefined
  /** Muted principals (chat / thread mute); never notified for this subject. */
  muted?: readonly string[] | undefined
}

export interface AudienceOptions {
  /** Include the actor (off by default: Operately never notifies the author). */
  includeActor?: boolean
  /** Extra principals to exclude (muted prefs resolved by the host). */
  exclude?: readonly string[] | undefined
}

export interface AudienceResolution {
  /** Recipients in a stable order (first source first, then as listed). */
  recipients: readonly string[]
  /** The sources that contributed at least one recipient. */
  sources: readonly AudienceSource[]
}

/** The audience sources for a kind, from the contract table. */
export function audienceSourcesFor(kind: NotificationKind): readonly AudienceSource[] {
  return notificationKindDescriptor(kind).audience
}

function idsFor(source: AudienceSource, context: AudienceContext): readonly string[] {
  const value = context[source]
  if (value === null || value === undefined) return []
  return typeof value === 'string' ? [value] : value
}

/**
 * Resolve the recipient set for one event.
 *
 * Deduped, ordered, actor-free. Ids must be non-empty strings; anything else is
 * dropped rather than notified (a malformed id can never become a recipient).
 */
export function resolveAudience(
  kind: NotificationKind,
  context: AudienceContext,
  options: AudienceOptions = {},
): AudienceResolution {
  const blocked = new Set<string>()
  if (!options.includeActor && context.actorId) blocked.add(context.actorId)
  for (const id of options.exclude ?? []) blocked.add(id)
  for (const id of context.muted ?? []) blocked.add(id)

  const recipients: string[] = []
  const seen = new Set<string>()
  const sources: AudienceSource[] = []
  for (const source of audienceSourcesFor(kind)) {
    let contributed = false
    for (const raw of idsFor(source, context)) {
      if (typeof raw !== 'string' || raw.length === 0) continue
      contributed = true
      if (blocked.has(raw) || seen.has(raw)) continue
      seen.add(raw)
      recipients.push(raw)
    }
    if (contributed) sources.push(source)
  }
  return { recipients, sources }
}