/**
 * W1-14 (#1511) — Suggestion mode contract (TECH-SPEC §11.4, DATA-MODEL §5.17).
 *
 * Suggestion mode is the OSS `@handlewithcare/prosemirror-suggest-changes`
 * marks wrapped as a TipTap extension: every user transaction while
 * `suggesting=true` runs through `withSuggestChanges()`, and each mark carries
 * `{id, authorId, createdAt}`.
 *
 * **The Y doc stays the source of truth.** The `doc_suggestion` rows exist for
 * counts, Inbox notifications and the comments-panel list, and are written by
 * the debounced observer through `docs.sync_suggestions`. A row whose marks
 * disappear without a decision becomes `stale`; `docs.decide_suggestion`
 * records the decision the client already applied to the Y doc.
 */

import type { YAnchor } from './anchor.ts'
import type { AclRole } from '../acl/roles.ts'

export const SUGGESTION_KINDS = ['insert', 'delete', 'replace', 'format', 'block'] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

export const SUGGESTION_STATUSES = ['open', 'accepted', 'rejected', 'stale'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

export const SUGGESTION_DECISIONS = ['accepted', 'rejected'] as const
export type SuggestionDecision = (typeof SUGGESTION_DECISIONS)[number]

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return typeof value === 'string' && (SUGGESTION_KINDS as readonly string[]).includes(value)
}

export function isSuggestionDecision(value: unknown): value is SuggestionDecision {
  return typeof value === 'string' && (SUGGESTION_DECISIONS as readonly string[]).includes(value)
}

/** `doc_suggestion` row (`17-collab.sql`). */
export interface DocSuggestion {
  suggestionId: string
  docId: string
  authorId: string
  kind: SuggestionKind
  anchor: YAnchor
  /** Canonical stored summary, e.g. `Insert «quarterly review»`. */
  summary: string
  status: SuggestionStatus
  decidedBy?: string
  decidedAt?: string
  threadCommentId?: string
  createdAt: string
}

/**
 * The stored summary of a suggestion (the DDL fixes its shape: `"Insert «…»"`,
 * `"Delete «…»"`). It is data on the row, not UI copy: the panel renders the
 * structured `kind` + `anchor.quote` through i18n.
 */
export function suggestionSummary(kind: SuggestionKind, excerpt: string): string {
  const text = excerpt.replace(/\s+/g, ' ').trim().slice(0, 120)
  switch (kind) {
    case 'insert':
      return text ? `Insert «${text}»` : 'Insert'
    case 'delete':
      return text ? `Delete «${text}»` : 'Delete'
    case 'replace':
      return text ? `Replace with «${text}»` : 'Replace'
    case 'format':
      return text ? `Format «${text}»` : 'Format'
    case 'block':
      return text ? `Block «${text}»` : 'Block'
  }
}

/** `docs.sync_suggestions {suggestionIds[]}` — the debounced observer's report. */
export interface SyncSuggestionsPayload {
  /** Ids of the suggestion marks currently present in the Y doc (≤ 500). */
  suggestionIds: string[]
}

export interface SyncSuggestionsResult {
  /** Rows this sync opened (a mark appeared). */
  created: string[]
  /** Rows whose stored anchor / summary was refreshed. */
  updated: string[]
  /** Rows that lost their marks without a decision. */
  staled: string[]
}

/** `docs.decide_suggestion {suggestionId, decision}`. */
export interface DecideSuggestionPayload {
  suggestionId: string
  decision: SuggestionDecision
}

export interface DecideSuggestionResult {
  suggestionId: string
  status: SuggestionStatus
  /** The decision was applied to the Y doc by the client that dispatched it. */
  decidedBy: string
  decidedAt: string
}

/** A row that exists in the store but whose marks are gone (`stale`). */
export function staleSuggestionIds(open: readonly DocSuggestion[], presentIds: readonly string[]): string[] {
  const present = new Set(presentIds)
  return open.filter(suggestion => suggestion.status === 'open' && !present.has(suggestion.suggestionId)).map(suggestion => suggestion.suggestionId)
}

/** A sync may open new rows and refresh existing ones, never decide them. */
export function suggestionStatusAfterSync(status: SuggestionStatus, present: boolean): SuggestionStatus {
  if (status === 'stale' && present) return 'open'
  if (status === 'open' && !present) return 'stale'
  return status
}

export type SuggestionDenial = 'already_decided' | 'not_author' | 'not_commenter' | 'forbidden'

/**
 * Who may decide a suggestion (§11.4): an editor-or-above of the doc decides
 * anyone's suggestion; the author may only withdraw (reject their own);
 * commenters can create but never decide.
 */
export function canDecideSuggestion(
  actorId: string,
  suggestion: Pick<DocSuggestion, 'authorId' | 'status'>,
  role: AclRole | null,
  decision: SuggestionDecision,
): { allowed: true } | { allowed: false; reason: SuggestionDenial } {
  if (suggestion.status !== 'open') return { allowed: false, reason: 'already_decided' }
  const isEditor = role === 'editor' || role === 'manager' || role === 'owner'
  if (isEditor) return { allowed: true }
  if (suggestion.authorId !== actorId) return { allowed: false, reason: role === 'commenter' ? 'not_author' : 'forbidden' }
  return decision === 'rejected' ? { allowed: true } : { allowed: false, reason: 'not_commenter' }
}

/**
 * A commenter update as the server-side step check sees it (`beforeHandleMessage`,
 * §11.4): the ids of suggestion marks it added or removed, and whether it
 * touched content that carries no suggestion mark.
 */
export interface SuggestionUpdateSummary {
  addedSuggestionIds: string[]
  removedSuggestionIds: string[]
  touchesUnmarkedContent: boolean
}

/**
 * Commenters may only add or remove suggestion-marked content. Anything else
 * is rejected and the client reloads the document.
 */
export function commenterUpdateAllowed(summary: SuggestionUpdateSummary): boolean {
  return !summary.touchesUnmarkedContent
}