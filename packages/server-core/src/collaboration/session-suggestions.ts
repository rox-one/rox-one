/**
 * Session suggestions (a2.5) — the propose-only channel for a `suggest`
 * session.
 *
 * A `suggest` session refuses a non-owner DIRECT write (see
 * `evaluateSessionWriteAccess`). This store is the sanctioned alternative: a
 * workspace member proposes a suggestion, and only the session owner resolves
 * it. Accepting a suggestion dispatches exactly one message through the normal
 * send path; resolving is idempotent so a replayed request never dispatches
 * twice.
 *
 * State is process-local and bounded: at most `capPerSession` suggestions are
 * retained per session (oldest resolved ones are evicted first; a session full
 * of pending suggestions refuses as SESSION_SUGGESTION_LIMIT) and at most
 * `sessionCap` sessions are tracked (the stalest is evicted).
 */

import { randomUUID } from 'node:crypto'
import {
  CodedError,
  SESSION_SUGGESTION_BODY_MAX,
  SESSION_SUGGESTION_CAP_PER_SESSION,
  type SessionCreatedActor,
  type SessionSuggestion,
  type SessionSuggestionResolution,
} from '@rox/shared/protocol'

/** Upper bound on sessions with tracked suggestions; the stalest is evicted. */
export const SESSION_SUGGESTION_SESSION_CAP = 512

/** Dispatches an accepted suggestion through the normal send path; resolves to
 *  the persisted message id. Called at most once per suggestion. */
export type SessionSuggestionDispatcher = (suggestion: SessionSuggestion) => Promise<string>

export interface SessionSuggestionResolveResult {
  suggestion: SessionSuggestion
  /** True only for the first accepted resolve; a replay is never dispatched. */
  dispatched: boolean
}

export interface SessionSuggestionStoreOptions {
  now?: () => number
  newId?: () => string
  capPerSession?: number
  sessionCap?: number
}

export class SessionSuggestionStore {
  private readonly bySession = new Map<string, SessionSuggestion[]>()
  private readonly now: () => number
  private readonly newId: () => string
  private readonly capPerSession: number
  private readonly sessionCap: number

  constructor(options: SessionSuggestionStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? (() => randomUUID())
    this.capPerSession = options.capPerSession ?? SESSION_SUGGESTION_CAP_PER_SESSION
    this.sessionCap = options.sessionCap ?? SESSION_SUGGESTION_SESSION_CAP
  }

  /** Propose a suggestion authored by `author`. Author binding is the caller's
   *  identity, resolved server-side — never a client-supplied field. */
  add(sessionId: string, author: SessionCreatedActor, body: string): SessionSuggestion {
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text) throw new CodedError('SESSION_SUGGESTION_INVALID', 'Suggestion body must not be empty')
    if (text.length > SESSION_SUGGESTION_BODY_MAX) {
      throw new CodedError('SESSION_SUGGESTION_INVALID', `Suggestion body exceeds ${SESSION_SUGGESTION_BODY_MAX} characters`)
    }
    const list = this.ensureSession(sessionId)
    if (list.length >= this.capPerSession) {
      // Make room by dropping the oldest already-resolved entry; if every entry
      // is still pending the cap is a refusal, not a silent drop.
      const index = list.findIndex(suggestion => suggestion.state !== 'pending')
      if (index === -1) {
        throw new CodedError('SESSION_SUGGESTION_LIMIT', `Session already holds ${this.capPerSession} suggestions`)
      }
      list.splice(index, 1)
    }
    const suggestion: SessionSuggestion = {
      id: this.newId(),
      sessionId,
      body: text,
      state: 'pending',
      author,
      createdAt: this.now(),
    }
    list.push(suggestion)
    return suggestion
  }

  /** All suggestions for a session (insertion order). */
  list(sessionId: string): SessionSuggestion[] {
    return [...(this.bySession.get(sessionId) ?? [])]
  }

  /**
   * Resolve a pending suggestion. Idempotent: an already-resolved suggestion is
   * returned as-is and `dispatched` is false, so a replayed request does not
   * dispatch a second message. `dismissed` never dispatches.
   */
  async resolve(
    sessionId: string,
    suggestionId: string,
    resolution: SessionSuggestionResolution,
    resolvedBy: string,
    dispatch: SessionSuggestionDispatcher,
  ): Promise<SessionSuggestionResolveResult> {
    const suggestion = this.bySession.get(sessionId)?.find(entry => entry.id === suggestionId)
    if (!suggestion) throw new CodedError('SESSION_SUGGESTION_NOT_FOUND', 'Suggestion not found')
    if (suggestion.state !== 'pending') return { suggestion, dispatched: false }
    // Claim synchronously before any await so a concurrent/replayed resolve
    // observes a non-pending state and cannot dispatch again.
    suggestion.state = resolution
    suggestion.resolvedAt = this.now()
    suggestion.resolvedBy = resolvedBy
    if (resolution === 'dismissed') return { suggestion, dispatched: false }
    try {
      suggestion.dispatchedMessageId = await dispatch(suggestion)
      return { suggestion, dispatched: true }
    } catch (error) {
      // The dispatch failed; release the claim so a retry can succeed.
      suggestion.state = 'pending'
      suggestion.resolvedAt = undefined
      suggestion.resolvedBy = undefined
      throw error
    }
  }

  /** Drop all state (server shutdown / tests). */
  clear(): void {
    this.bySession.clear()
  }

  private ensureSession(sessionId: string): SessionSuggestion[] {
    let list = this.bySession.get(sessionId)
    if (list) {
      // Refresh recency so the stalest session is the eviction victim.
      this.bySession.delete(sessionId)
      this.bySession.set(sessionId, list)
      return list
    }
    while (this.bySession.size >= this.sessionCap) {
      const oldest = this.bySession.keys().next().value
      if (oldest === undefined) break
      this.bySession.delete(oldest)
    }
    list = []
    this.bySession.set(sessionId, list)
    return list
  }
}

let store: SessionSuggestionStore | null = null

/** Process-wide suggestion store used by the session RPC handlers. */
export function getSessionSuggestionStore(): SessionSuggestionStore {
  return (store ??= new SessionSuggestionStore())
}

/** Test/diagnostic hook: replace the singleton with a fresh store. */
export function resetSessionSuggestionStore(): void {
  store = null
}