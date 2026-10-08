/**
 * W1-14 (#1511) — Collaboration reference handlers (TECH-SPEC §11, §12).
 *
 * What #1503's placeholders cannot express, implemented for real:
 *
 * - `docs.suggest_changes` / `docs.sync_suggestions` — the open-suggestion
 *   index of a doc, and the rule that a row whose marks disappeared without a
 *   decision becomes `stale` (§11.4);
 * - `docs.decide_suggestion` — one decision per suggestion, taken only by
 *   someone who may take it (core's `canDecideSuggestion`);
 * - `docs.record_view` — one `doc_view` write per 10 minutes per user, with
 *   `first_viewed_at` never moving (§11.7);
 * - `im.mark_read` — `last_read_seq` is a monotonic max, with the 2 s
 *   `read.changed` throttle and the membership check;
 * - `presence.*` — ephemeral: the commands write the presence store and
 *   **no** domain event (DATA-MODEL §5.17);
 * - `calendar.free_busy` — the §11.9 aggregate, always through the free-busy
 *   redaction of `@rox/core/collab`.
 */

import type { AclRole } from '@rox/core/acl'
import {
  COLLAB_COMMAND_RISK, canDecideSuggestion, freeBusyBlocks, readChangedAllowed, recordDocView, staleSuggestionIds,
  type BusyBlock, type CalendarEventTiming, type DocSuggestion, type PresenceHeartbeatAck, type PresenceHeartbeatPayload,
  type PresenceObjectPayload, type PresenceObjectResult, type SuggestionDecision, type TimeRange,
} from '@rox/core/collab'
import { CommandRejection, type CommandHandler, type CommandHandlerContext, type CommandHandlerResult, type CommandRegistry } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { COLLAB_COMMAND_SCHEMAS } from '@rox/shared/collab'
import { deterministicId, isDeleted, referenceHandler, type ReferenceOp, type ReferenceOutcome, type ReferenceTx } from '../work/reference/engine'
import type { RecordBackend, StoredRecord } from '../work/reference/types'
import type { ReferenceSpecMap } from '../work/reference/specs/types'
import { PresenceStore } from './presence-store'

const SUGGESTION = 'doc-suggestion'
const SUGGESTION_INDEX = 'doc-suggestion-index'
const CALENDAR_INDEX = 'calendar-index'

const outcome = (collection: string, id: string, revision: number, changes: string[], extra: Partial<ReferenceOutcome> = {}): ReferenceOutcome => ({
  collection, id, revision, changes, ...extra,
})

/** The suggestion index row of a doc: its open ids, maintained by this module. */
async function openSuggestionIds(tx: ReferenceTx, docId: string): Promise<string[]> {
  const index = await tx.get(SUGGESTION_INDEX, docId)
  const ids = index && !isDeleted(index) ? index.data.openIds : undefined
  return Array.isArray(ids) ? (ids as string[]) : []
}

async function setOpenSuggestionIds(tx: ReferenceTx, docId: string, ids: readonly string[]): Promise<void> {
  await tx.upsert(SUGGESTION_INDEX, docId, { openIds: [...ids] }, { docId })
}

/** A stored suggestion row as the §11.4 contract describes it. */
function suggestionOf(id: string, record: StoredRecord | null): DocSuggestion | null {
  if (!record || isDeleted(record)) return null
  return {
    suggestionId: id,
    docId: String(record.data.docId ?? ''),
    authorId: String(record.data.authorId ?? ''),
    kind: (record.data.kind ?? 'insert') as DocSuggestion['kind'],
    anchor: (record.data.anchor ?? { start: '', end: '' }) as DocSuggestion['anchor'],
    summary: String(record.data.summary ?? ''),
    status: (record.data.status ?? 'open') as DocSuggestion['status'],
    ...(typeof record.data.decidedBy === 'string' ? { decidedBy: record.data.decidedBy } : {}),
    ...(typeof record.data.decidedAt === 'string' ? { decidedAt: record.data.decidedAt } : {}),
    createdAt: String(record.data.createdAt ?? ''),
  }
}

/**
 * The actor's role on a doc, from the executor's authorizer: `write` is an
 * editor, `read` a commenter. The authorizer speaks Rox2 verbs, not lattice
 * roles, so this is the closest the reference handler can get; the full ACL
 * engine (W1-04) resolves the exact role for the UI.
 */
async function docRole(tx: ReferenceTx, docRef: EntityRef): Promise<AclRole | null> {
  if (await tx.can('write', docRef)) return 'editor'
  if (await tx.can('read', docRef)) return 'commenter'
  return null
}

const DECISION_DENIAL: Readonly<Record<string, 'VALIDATION' | 'FORBIDDEN'>> = {
  already_decided: 'VALIDATION',
  not_author: 'FORBIDDEN',
  not_commenter: 'FORBIDDEN',
  forbidden: 'FORBIDDEN',
}

export const COLLAB_REFERENCE_SPECS: ReferenceSpecMap = {
  /** A new suggestion mark: the row plus the doc's open-suggestion index (§11.4). */
  'docs.suggest_changes': async tx => {
    const note = await tx.requireTarget('note')
    const id = tx.createId()
    await tx.assertAbsent(SUGGESTION, id)
    const data = {
      docId: note.id,
      authorId: tx.actor,
      kind: tx.payload.kind,
      anchor: tx.payload.anchor,
      summary: tx.payload.summary,
      status: 'open',
    }
    const record = await tx.insert(SUGGESTION, id, data)
    await setOpenSuggestionIds(tx, note.id, [...(await openSuggestionIds(tx, note.id)), id])
    return outcome(SUGGESTION, id, record.revision, ['status'], { ref: tx.rawTarget ?? null, result: { suggestionId: id } })
  },

  /**
   * The debounced observer's report (§11.4): the ids of the suggestion marks
   * currently in the Y doc. Rows that lost their marks go `stale`; a stale row
   * whose mark is back opens again. Rows themselves are created by
   * `docs.suggest_changes` — the observer only counts them.
   */
  'docs.sync_suggestions': async tx => {
    const note = await tx.requireTarget('note')
    const present = [...new Set(tx.payload.suggestionIds as string[])]
    const known = await openSuggestionIds(tx, note.id)
    const rows: Array<{ id: string; suggestion: DocSuggestion }> = []
    for (const id of known) {
      const suggestion = suggestionOf(id, await tx.get(SUGGESTION, id))
      if (suggestion) rows.push({ id, suggestion })
    }
    const staled = staleSuggestionIds(rows.map(row => row.suggestion), present)
    for (const id of staled) {
      const record = await tx.get(SUGGESTION, id)
      if (record && !isDeleted(record)) await tx.update(SUGGESTION, record, { status: 'stale' })
    }
    const reopened: string[] = []
    for (const id of present) {
      const record = await tx.get(SUGGESTION, id)
      if (record && !isDeleted(record) && record.data.status === 'stale') {
        await tx.update(SUGGESTION, record, { status: 'open' })
        reopened.push(id)
      }
    }
    const kept = known.filter(id => !staled.includes(id) && !present.includes(id))
    await setOpenSuggestionIds(tx, note.id, [...new Set([...kept, ...present])])
    const record = await tx.update('note', note, { suggestionsSyncedAt: tx.now })
    return outcome('note', note.id, record.revision, ['suggestionsSyncedAt'], {
      ref: tx.rawTarget ?? null,
      result: { created: present.filter(id => !known.includes(id)), updated: reopened, staled },
    })
  },

  /** One decision per suggestion, by an editor or by the author withdrawing (§11.4). */
  'docs.decide_suggestion': async tx => {
    const note = await tx.requireTarget('note')
    const suggestionId = String(tx.payload.suggestionId)
    const decision = tx.payload.decision as SuggestionDecision
    const record = await tx.require(SUGGESTION, suggestionId)
    if (record.data.docId !== note.id) throw new CommandRejection('NOT_FOUND', `${suggestionId} does not belong to ${note.id}`)
    const suggestion = suggestionOf(suggestionId, record)
    if (!suggestion) throw new CommandRejection('NOT_FOUND', `${suggestionId} not found`)
    const verdict = canDecideSuggestion(tx.actor, suggestion, await docRole(tx, { kind: 'note', id: note.id }), decision)
    if (!verdict.allowed) throw new CommandRejection(DECISION_DENIAL[verdict.reason] ?? 'FORBIDDEN', `cannot decide ${suggestionId}: ${verdict.reason}`)
    const updated = await tx.update(SUGGESTION, record, { status: decision, decidedBy: tx.actor, decidedAt: tx.now })
    await setOpenSuggestionIds(tx, note.id, (await openSuggestionIds(tx, note.id)).filter(id => id !== suggestionId))
    return outcome(SUGGESTION, suggestionId, updated.revision, ['status'], {
      ref: tx.rawTarget ?? null,
      result: { suggestionId, status: decision },
    })
  },

  /** One `doc_view` write per 10 minutes per user (§11.7). */
  'docs.record_view': async tx => {
    const note = await tx.requireTarget('note')
    const id = `${note.id}:${tx.actor}`
    const current = await tx.get('doc-view', id)
    const existing = current && !isDeleted(current) ? {
      docId: note.id,
      principalId: tx.actor,
      firstViewedAt: String(current.data.firstViewedAt ?? tx.now),
      lastViewedAt: String(current.data.lastViewedAt ?? tx.now),
      viewCount: Number(current.data.viewCount ?? 1),
    } : null
    const view = recordDocView(existing, note.id, tx.actor, tx.now)
    if (!view) {
      return outcome('doc-view', id, current?.revision ?? 0, [], {
        ref: tx.rawTarget ?? null,
        result: { written: false, viewCount: existing?.viewCount ?? 0 },
      })
    }
    const record = await tx.upsert('doc-view', id, { lastViewedAt: view.lastViewedAt, viewCount: view.viewCount }, {
      docId: note.id, principalId: tx.actor, firstViewedAt: view.firstViewedAt,
    })
    return outcome('doc-view', id, record.revision, ['lastViewedAt', 'viewCount'], {
      ref: tx.rawTarget ?? null,
      result: { written: true, viewCount: view.viewCount },
    })
  },

  /** `last_read_seq` is a monotonic max, and only a member may move it (§11.7). */
  'im.mark_read': async tx => {
    const chat = await tx.requireTarget('channel')
    const entry = await tx.get('channel-member', `${chat.id}:${tx.actor}`)
    if (!entry || isDeleted(entry) || entry.data.state !== 'active') throw new CommandRejection('FORBIDDEN', 'not a member of this chat')
    const previous = Number(entry.data.lastReadSeq ?? 0)
    const lastReadSeq = Math.max(previous, Number(tx.payload.seq))
    const emittedAt = typeof entry.data.lastReadChangedAt === 'number' ? entry.data.lastReadChangedAt : null
    const now = Date.parse(tx.now)
    const emitted = readChangedAllowed(emittedAt, now)
    const record = await tx.update('channel-member', entry, {
      lastReadSeq,
      ...(emitted ? { lastReadChangedAt: now } : {}),
      ...(lastReadSeq > previous ? { lastReadAt: tx.now } : {}),
    })
    return outcome('channel-member', record.id, record.revision, ['lastReadSeq'], {
      ref: tx.rawTarget ?? null,
      result: { lastReadSeq, emitted },
    })
  },
}

// ── Presence (ephemeral: no domain event, no row) ───────────────────────────

const presenceStore = new PresenceStore()

export function collabPresenceStore(): PresenceStore {
  return presenceStore
}

/** A published `presence.changed` frame's addressing, as the receipt carries it. */
export interface PresenceFrameHint {
  topic: string
  notify: string[]
}

/** The three presence handlers, typed by their payload so no cast is needed. */
export interface PresenceCommandHandlers {
  'presence.heartbeat': CommandHandler<PresenceHeartbeatPayload, PresenceHeartbeatAck & PresenceFrameHint>
  'presence.join': CommandHandler<PresenceObjectPayload, PresenceObjectResult>
  'presence.leave': CommandHandler<PresenceObjectPayload, PresenceObjectResult>
}

export function presenceHandlers(store: PresenceStore = presenceStore, now: () => Date = () => new Date()): PresenceCommandHandlers {
  return {
    'presence.heartbeat': async (ctx: CommandHandlerContext<PresenceHeartbeatPayload>): Promise<CommandHandlerResult<PresenceHeartbeatAck & PresenceFrameHint>> => {
      const at = now().getTime()
      const state = await store.heartbeat(ctx.workspaceId, ctx.actor.principalId, ctx.payload, at)
      const transition = store.takeTransition(ctx.workspaceId, ctx.actor.principalId)
      return {
        result: {
          status: state.status,
          expiresAt: state.expiresAt,
          notify: state.notify,
          topic: store.changedTopic(ctx.actor.principalId),
          ...(transition ? { from: transition.from, to: transition.to } : {}),
        } as PresenceHeartbeatAck & PresenceFrameHint,
      }
    },
    'presence.join': async (ctx: CommandHandlerContext<PresenceObjectPayload>): Promise<CommandHandlerResult<PresenceObjectResult>> => ({
      result: store.join(ctx.workspaceId, ctx.actor.principalId, ctx.payload, now().getTime()),
    }),
    'presence.leave': async (ctx: CommandHandlerContext<PresenceObjectPayload>): Promise<CommandHandlerResult<PresenceObjectResult>> => ({
      result: store.leave(ctx.workspaceId, ctx.actor.principalId, ctx.payload, now().getTime()),
    }),
  }
}

// ── calendar.free_busy (§11.9) ─────────────────────────────────────────────

/** Where the events of a principal's calendars are read from. */
export type FreeBusyEventQuery = (tx: ReferenceTx, principalId: string, range: TimeRange) => Promise<readonly CalendarEventTiming[]>

export interface CollabRuntime {
  now(): Date
  /**
   * The reference query reads the `calendar-index` rows the calendar handlers
   * maintain. Package CAL supplies the SQL one; the redaction is the §11.9
   * contract either way, so it does not move.
   */
  freeBusyEvents: FreeBusyEventQuery
}

const referenceFreeBusyEvents: FreeBusyEventQuery = async (tx, principalId, range) => {
  // The calendars of a principal the reference layer knows: the index row keyed
  // by the principal, and their default calendar's (same id the calendar
  // handlers derive in @rox/server-core/xsc). Package CAL queries them in SQL.
  const calendars = [principalId, deterministicId(tx.ctx.workspaceId, 'xsc', 'calendar', principalId)]
  const ids: string[] = []
  for (const calendarId of calendars) {
    const index = await tx.get(CALENDAR_INDEX, calendarId)
    if (index && !isDeleted(index) && Array.isArray(index.data.eventIds)) ids.push(...(index.data.eventIds as string[]))
  }
  const events: CalendarEventTiming[] = []
  for (const id of ids) {
    const record = await tx.get('calendar-event', id)
    if (!record || isDeleted(record)) continue
    const startAt = String(record.data.startAt ?? '')
    const endAt = String(record.data.endAt ?? '')
    if (!startAt || !endAt) continue
    if (Date.parse(endAt) <= Date.parse(range.start) || Date.parse(startAt) >= Date.parse(range.end)) continue
    events.push({
      startAt,
      endAt,
      ...(record.data.allDay === true ? { allDay: true } : {}),
      ...(typeof record.data.transparency === 'string' ? { transparency: record.data.transparency as CalendarEventTiming['transparency'] } : {}),
      ...(typeof record.data.response === 'string' ? { response: record.data.response as CalendarEventTiming['response'] } : {}),
    })
  }
  return events
}

let runtime: CollabRuntime = { now: () => new Date(), freeBusyEvents: referenceFreeBusyEvents }

/** Host wiring (the workspace service supplies the SQL-backed query). */
export function configureCollabRuntime(overrides: Partial<CollabRuntime>): () => void {
  const previous = runtime
  runtime = { ...runtime, ...overrides }
  return () => { runtime = previous }
}

export function resetCollabRuntime(): void {
  runtime = { now: () => new Date(), freeBusyEvents: referenceFreeBusyEvents }
  presenceStore.clearAll()
}

/** The §11.9 aggregate: the caller's own calendars, plus those shared with them. */
export function freeBusyOp(events: FreeBusyEventQuery = referenceFreeBusyEvents): ReferenceOp {
  return async tx => {
    const payload = tx.payload as { principals: string[]; range: TimeRange }
    const principals: Record<string, BusyBlock[]> = {}
    const unavailable: string[] = []
    for (const principalId of payload.principals) {
      // "Find a time" aggregates over calendars the caller may read; the rest
      // of the principal's time is not theirs to see.
      if (!(await tx.can('read', { kind: 'person', id: principalId }))) throw new CommandRejection('FORBIDDEN', `cannot read the calendars of ${principalId}`)
      const found = await events(tx, principalId, payload.range)
      principals[principalId] = freeBusyBlocks(found, payload.range)
    }
    return { collection: 'calendar-event', id: payload.principals[0] ?? '', changes: ['free_busy'], ref: null, result: { principals, unavailable } }
  }
}

/** A query writes no `domain_event`; only the executor's receipt is emitted. */
function readOnly(handler: CommandHandler<unknown, unknown>): CommandHandler<unknown, unknown> {
  return async ctx => {
    const result = await handler(ctx)
    return { ...result, events: [] }
  }
}

/**
 * Commands the collab module binds as plain handlers (no record collection):
 * the ephemeral presence trio and the free-busy query.
 */
export const COLLAB_DIRECT_HANDLER_TYPES = ['presence.heartbeat', 'presence.join', 'presence.leave', 'calendar.free_busy'] as const

export interface CollabCommandBindings {
  /** Reference-handler options shared with the W1-06 engine. */
  now: () => Date
  backendFor: (ctx: CommandHandlerContext<unknown>) => Promise<RecordBackend> | RecordBackend
}

/** Binds the collab payload schemas, risk classes and handlers (before the W1-06 reference module). */
export function bindCollabContracts(registry: CommandRegistry, bindings: CollabCommandBindings): void {
  for (const [type, schema] of Object.entries(COLLAB_COMMAND_SCHEMAS)) {
    if (!registry.has(type)) continue
    registry.bindSchema(type, schema, { riskClass: COLLAB_COMMAND_RISK[type as keyof typeof COLLAB_COMMAND_RISK] })
  }
  for (const [type, spec] of Object.entries(COLLAB_REFERENCE_SPECS)) {
    if (!registry.has(type) || registry.handler(type)) continue
    const { op, event } = typeof spec === 'function' ? { op: spec, event: undefined } : spec
    registry.bind(type, referenceHandler(type, op, { now: bindings.now, backendFor: bindings.backendFor, verb: registry.get(type)!.verb, ...(event ? { eventType: event } : {}) }))
  }
  for (const [type, handler] of Object.entries(presenceHandlers())) {
    if (!registry.has(type) || registry.handler(type)) continue
    registry.bind(type, handler)
  }
  if (registry.has('calendar.free_busy') && !registry.handler('calendar.free_busy')) {
    const handler = referenceHandler('calendar.free_busy', freeBusyOp(), {
      now: bindings.now,
      backendFor: bindings.backendFor,
      verb: 'read',
    })
    registry.bind('calendar.free_busy', readOnly(handler))
  }
}