/**
 * W1-14 (#1511) — Collaboration command contracts (TECH-SPEC §11, §12).
 *
 * The commands of the collaboration layer, with the risk class each one
 * carries for an agent (§13.2 step 5). Presence is ephemeral and self-scoped,
 * so it is routine; the free-busy query reads other people's calendars, so it
 * is routine *read*; deciding someone else's suggestion changes a shared doc
 * and is consequential.
 */

import type { CommandRiskContext, RiskClass } from '../commands/registry.ts'
import type { PresenceHeartbeatPayload, PresenceObjectPayload } from './presence.ts'
import type { FreeBusyPayload } from './calendar.ts'
import type { DecideSuggestionPayload, SyncSuggestionsPayload } from './suggestions.ts'
import type { MarkReadPayload } from './receipts.ts'

export type { PresenceHeartbeatPayload, PresenceObjectPayload, FreeBusyPayload, DecideSuggestionPayload, SyncSuggestionsPayload, MarkReadPayload }

/** `presence.heartbeat` result. */
export interface PresenceHeartbeatAck {
  status: string
  expiresAt: number
}

/** `presence.join` / `presence.leave` result. */
export interface PresenceViewersResult {
  viewers: string[]
  topic: string
}

/** `docs.record_view` result: `written` is false inside the 10-minute debounce. */
export interface RecordDocViewResult {
  written: boolean
  viewCount: number
}

/** `im.mark_read` result: the monotonic `last_read_seq` after the command. */
export interface MarkReadResult {
  lastReadSeq: number
  /** Whether a `read.changed` frame went out for this call. */
  emitted: boolean
}

/** Presence, receipts, doc views and the free-busy query are routine. */
export function collabRoutineRisk(_payload?: unknown, _ctx?: CommandRiskContext): RiskClass {
  return 'routine'
}

/** Accepting a suggestion rewrites a shared doc on someone else's behalf (§11.4). */
export function suggestionDecisionRisk(payload: unknown): RiskClass {
  return payload && typeof payload === 'object' && 'decision' in payload && payload.decision === 'accepted' ? 'consequential' : 'routine'
}

export type CollabContractType =
  | 'docs.suggest_changes'
  | 'presence.heartbeat'
  | 'presence.join'
  | 'presence.leave'
  | 'calendar.free_busy'
  | 'docs.sync_suggestions'
  | 'docs.decide_suggestion'
  | 'docs.record_view'
  | 'im.mark_read'

/** The collaboration commands this package declares or re-binds. */
export const COLLAB_CONTRACT_TYPES: readonly CollabContractType[] = [
  'docs.suggest_changes',
  'presence.heartbeat',
  'presence.join',
  'presence.leave',
  'calendar.free_busy',
  'docs.sync_suggestions',
  'docs.decide_suggestion',
  'docs.record_view',
  'im.mark_read',
]

/** Risk class of every collaboration command; `@rox/server-core/collab` binds these. */
export const COLLAB_COMMAND_RISK: Readonly<Record<CollabContractType, (payload: unknown, ctx: CommandRiskContext) => RiskClass>> = {
  'docs.suggest_changes': collabRoutineRisk,
  'presence.heartbeat': collabRoutineRisk,
  'presence.join': collabRoutineRisk,
  'presence.leave': collabRoutineRisk,
  'calendar.free_busy': collabRoutineRisk,
  'docs.sync_suggestions': collabRoutineRisk,
  'docs.decide_suggestion': suggestionDecisionRisk,
  'docs.record_view': collabRoutineRisk,
  'im.mark_read': collabRoutineRisk,
}