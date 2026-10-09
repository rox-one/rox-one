/**
 * W1-12 (#1509) — Daily-note contract (TECH-SPEC §14.3, DATA-MODEL §5.2).
 *
 * Shared by the notes UI, the local rule consumer and the workspace rules
 * consumer, so "the daily note of this user on this date" means exactly one
 * thing everywhere:
 * - local authority: one Markdown note in the vault folder `daily`
 *   (`DAILY_VAULT_FOLDER`, moved here from the notes renderer);
 * - workspace authority: one `note(subtype='daily', daily_date)` row per user,
 *   at the deterministic id below (uuidv5), so a retried rule execution finds
 *   the same note instead of creating a second one.
 *
 * Renderer-safe: pure functions, no Node imports.
 */

import { uuidv5, ROX_UUID_NAMESPACE } from '../automation/ids.ts'
import { entityRefEquals, type EntityRef } from '../entities/refs.ts'

/** Vault folder holding local daily notes (`note-views.ts` re-exports this name). */
export const DAILY_VAULT_FOLDER = 'daily'

/** Local date of `at` in the given IANA zone (or the host zone), as `YYYY-MM-DD`. */
export function dailyNoteDateKey(at: Date | string = new Date(), timeZone?: string): string {
  const date = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(at)}`)
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    // en-CA renders as YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts
  }
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Local daily note destination (vault folder + note title) — the notes UI contract. */
export function dailyNoteDestination(now = new Date()): { folder: string; title: string } {
  return { folder: DAILY_VAULT_FOLDER, title: dailyNoteDateKey(now) }
}

/** Deterministic workspace daily-note id for `(workspace, owner, date)`. */
export function dailyNoteId(workspaceId: string, owner: string, date: string): string {
  return uuidv5(`daily:${workspaceId}:${owner}:${date}`, ROX_UUID_NAMESPACE)
}

export function dailyNoteRef(workspaceId: string, owner: string, date: string): EntityRef {
  return { kind: 'note', id: dailyNoteId(workspaceId, owner, date) }
}

export function isDailyNoteRef(workspaceId: string, owner: string, date: string, ref: EntityRef): boolean {
  return entityRefEquals(ref, dailyNoteRef(workspaceId, owner, date))
}

/**
 * Deterministic block id of the link R1 appends to the daily note
 * (TECH-SPEC §14.3: `uuidv5(key + ':daily-link')`, updated in place).
 */
export function dailyLinkBlockId(idempotencyKey: string): string {
  return uuidv5(`${idempotencyKey}:daily-link`)
}

/** `docs.ensure_daily_note` request (contract for the rules and the notes UI). */
export interface EnsureDailyNoteRequest {
  /** Local date, `YYYY-MM-DD`. */
  date: string
  /** Owner of the note; defaults to the acting principal. */
  ownerId?: string
  /** Workspace authority: the deterministic id. Local authority: informational. */
  id?: string
}

export interface EnsureDailyNoteResult {
  ref: EntityRef
  /** True when the note already existed (a replay found it). */
  existed: boolean
  /** Local authority: vault-relative path of the note. */
  localPath?: string
  title: string
}

/** `docs.append_daily_link` request (R1 step 4). */
export interface AppendDailyLinkRequest extends EnsureDailyNoteRequest {
  link: EntityRef
  label?: string
  /** Deterministic block id (`dailyLinkBlockId(key)`); the block is updated in place. */
  blockId?: string
  /** Time the link refers to (ISO); rendered in the block. */
  time?: string
}