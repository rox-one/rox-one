/**
 * W1-12 (#1509) — R1: calendar event → meeting notes + prep task
 * (TECH-SPEC §14.3, DATA-MODEL §5.16; PRD decisions D-v2-3 / D-v2-4).
 *
 * Approved behaviour (Mark, 2026-10-08):
 * - D-v2-3: notes and the prep task are created for the **organiser only**
 *   (param `for` can widen it to every Rox attendee); all-day, declined and
 *   `free` events are skipped, and so are events tagged with `#no-notes`;
 * - D-v2-4: the prep task goes to the per-user system list «Бэклог», not the
 *   Things Inbox.
 *
 * Full behaviour (templates, R1u update / R1c cancel follow-ups) is package
 * AUTO (#1529); this declaration is the frozen wave-1 contract.
 */

import type { EntityRef } from '../../entities/refs.ts'
import type { DomainEvent } from '../../events/types.ts'
import { dailyLinkBlockId, dailyNoteDateKey, dailyNoteRef } from '../../docs/daily.ts'
import { calendarTriggerOf, type CalendarEventSnapshot, type CalendarTrigger } from '../events.ts'
import { uuidv5 } from '../ids.ts'
import type { DomainRule, RuleStep } from '../rule.ts'

export type R1OwnerScope = 'organiser' | 'all_rox_attendees'

export interface R1Params {
  /** Who gets notes + the prep task (D-v2-3 default: the organiser). */
  for: R1OwnerScope
  /** Skip all-day events (D-v2-3: yes). */
  skipAllDay: boolean
  /** Keywords that suppress the rule (D-v2-3: `#no-notes`). */
  skipKeywords: string[]
  /** System list the prep task lands in (D-v2-4: `backlog` → «Бэклог»). */
  listSystemKey: string
  /** Prefix of the prep task title (AUTO localises it through the workspace params). */
  prepTaskTitlePrefix: string
}

export const R1_DEFAULT_PARAMS: R1Params = {
  for: 'organiser',
  skipAllDay: true,
  skipKeywords: ['#no-notes'],
  listSystemKey: 'backlog',
  prepTaskTitlePrefix: 'Подготовиться: ',
}

/** Tolerant params reader: unknown values fall back to the D-v2-3 / D-v2-4 defaults. */
export function readR1Params(params: Readonly<Record<string, unknown>> = {}): R1Params {
  const ownerScope = params.for
  const keywords = params.skipKeywords
  return {
    for: ownerScope === 'all_rox_attendees' ? 'all_rox_attendees' : R1_DEFAULT_PARAMS.for,
    skipAllDay: typeof params.skipAllDay === 'boolean' ? params.skipAllDay : R1_DEFAULT_PARAMS.skipAllDay,
    skipKeywords: Array.isArray(keywords) && keywords.every(entry => typeof entry === 'string')
      ? (keywords as string[])
      : R1_DEFAULT_PARAMS.skipKeywords,
    listSystemKey: typeof params.listSystemKey === 'string' && params.listSystemKey ? params.listSystemKey : R1_DEFAULT_PARAMS.listSystemKey,
    prepTaskTitlePrefix: typeof params.prepTaskTitlePrefix === 'string' ? params.prepTaskTitlePrefix : R1_DEFAULT_PARAMS.prepTaskTitlePrefix,
  }
}

/** Deterministic id of a per-user system list (`task_lists.ensure_system_list`). */
export function systemListId(workspaceId: string, owner: string, systemKey: string): string {
  return uuidv5(`task-list:${workspaceId}:${owner}:${systemKey}`)
}

/** `R1:{event_id|provider_uid}:{occurrence_start|'single'}:{owner}` (DATA-MODEL §5.16). */
export function r1Key(owner: string, trigger: CalendarTrigger): string {
  const eventToken = trigger.kind === 'external' && trigger.providerUid ? trigger.providerUid : trigger.event.ref.id
  const occurrence = trigger.kind === 'occurrence' && trigger.occurrenceStart ? trigger.occurrenceStart : 'single'
  return `R1:${eventToken}:${occurrence}:${owner}`
}

/** Owners the event expands to (organiser by default; every Rox attendee on demand). */
export function r1Owners(trigger: CalendarTrigger, params: R1Params): string[] {
  const owners = new Set<string>()
  if (params.for === 'all_rox_attendees') for (const attendee of trigger.event.attendeeIds ?? []) if (attendee) owners.add(attendee)
  if (trigger.event.organizerId) owners.add(trigger.event.organizerId)
  return [...owners].sort()
}

function hasSkippedKeyword(event: CalendarEventSnapshot, keywords: readonly string[]): boolean {
  const tagged = [...(event.keywords ?? []), event.title]
  return keywords.some(keyword => keyword.length > 0 && tagged.some(value => value.toLowerCase().includes(keyword.toLowerCase())))
}

/** Meeting-notes date: the local date of the occurrence (or of the event) in its own zone. */
export function r1NoteDate(trigger: CalendarTrigger): string {
  return dailyNoteDateKey(trigger.occurrenceStart ?? trigger.event.startAt, trigger.event.timeZone)
}

export const R1: DomainRule = {
  id: 'R1',
  triggers: ['calendar.event_created', 'calendar.external_event_seen', 'calendar.occurrence_upcoming'],
  scope: 'principal',

  async targets(ctx, event) {
    const trigger = calendarTriggerOf(event)
    if (!trigger) return []
    return r1Owners(trigger, readR1Params(await ctx.params('R1', null))).map(subject => ({ subject }))
  },

  async enabled(ctx) {
    return (await ctx.settings('R1')).enabled
  },

  async conditions(ctx, event) {
    const trigger = calendarTriggerOf(event)
    if (!trigger) return 'unknown_event'
    const params = readR1Params(await ctx.params('R1'))
    const snapshot = trigger.event
    if (snapshot.status === 'cancelled') return 'event_cancelled'
    if (params.skipAllDay && snapshot.allDay) return 'all_day'
    if ((snapshot.transparency ?? 'busy') === 'free') return 'free'
    if (snapshot.declinedByIds?.includes(ctx.subject)) return 'declined'
    if (params.for === 'organiser' && !snapshot.organizerId) return 'not_organiser'
    if (hasSkippedKeyword(snapshot, params.skipKeywords)) return 'no_notes_keyword'
    return null
  },

  key(ctx, event) {
    const trigger = calendarTriggerOf(event)
    if (!trigger) throw new Error('R1 key needs a calendar event payload')
    return r1Key(ctx.subject, trigger)
  },

  async steps(ctx, event) {
    const trigger = calendarTriggerOf(event)
    if (!trigger) return []
    const params = readR1Params(await ctx.params('R1'))
    const owner = ctx.subject
    const snapshot = trigger.event
    const key = r1Key(owner, trigger)
    const date = r1NoteDate(trigger)

    const ownerRef: EntityRef = { kind: 'person', id: owner }
    const listId = systemListId(ctx.workspaceId, owner, params.listSystemKey)
    const minutesId = uuidv5(`${key}:minutes`)
    const taskId = uuidv5(`${key}:task`)
    const minutesRef: EntityRef = { kind: 'note', id: minutesId }
    const taskRef: EntityRef = { kind: 'task', id: taskId }
    const dailyRef = dailyNoteRef(ctx.workspaceId, owner, date)

    const steps: RuleStep[] = [
      {
        name: 'ensure-backlog-list',
        actor: 'system',
        command: {
          type: 'task_lists.ensure_system_list',
          payload: { systemKey: params.listSystemKey, ownerId: owner, id: listId },
          target: ownerRef,
        },
      },
      {
        name: 'ensure-daily-note',
        actor: 'system',
        command: {
          type: 'docs.ensure_daily_note',
          payload: { date, ownerId: owner, id: dailyRef.id },
          target: ownerRef,
        },
      },
      {
        name: 'create-minutes',
        actor: 'system',
        command: {
          type: 'docs.create_meeting_notes',
          payload: { id: minutesId, eventRef: snapshot.ref, title: snapshot.title },
          target: ownerRef,
        },
      },
      {
        name: 'append-daily-link',
        actor: 'system',
        command: {
          type: 'docs.append_daily_link',
          payload: {
            date,
            ownerId: owner,
            id: dailyRef.id,
            link: minutesRef,
            label: snapshot.title,
            blockId: dailyLinkBlockId(key),
            time: snapshot.startAt,
          },
          target: ownerRef,
        },
      },
      {
        name: 'create-prep-task',
        actor: 'system',
        command: {
          type: 'tasks.create',
          payload: {
            id: taskId,
            title: `${params.prepTaskTitlePrefix}${snapshot.title}`,
            listId,
            dueAt: snapshot.startAt,
            origin: snapshot.ref,
            // The WorkItem model has no draft column (§5.1): the prep task is a
            // draft by intent, recorded in the free-form custom fields.
            customFields: { draft: true },
          },
          target: ownerRef,
        },
      },
      {
        name: 'link-minutes-event',
        actor: 'system',
        command: {
          type: 'links.add',
          payload: { from: minutesRef, to: snapshot.ref, relation: 'attached-to', role: 'minutes' },
          target: minutesRef,
        },
      },
      {
        name: 'link-task-event',
        actor: 'system',
        command: {
          type: 'links.add',
          payload: { from: taskRef, to: snapshot.ref, relation: 'derived-from' },
          target: taskRef,
        },
      },
      {
        name: 'link-minutes-daily',
        actor: 'system',
        command: {
          type: 'links.add',
          payload: { from: minutesRef, to: dailyRef, relation: 'parent' },
          target: minutesRef,
        },
      },
    ]
    return steps
  },
} satisfies DomainRule<DomainEvent>