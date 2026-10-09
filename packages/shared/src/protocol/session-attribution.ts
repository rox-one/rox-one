/**
 * Session attribution — who created, owns, and participates in a session.
 * Shared wire types for session ownership/presence/skills-port features.
 */

export type SessionActorKind = 'profile' | 'channel' | 'agent'

export interface SessionActorRef {
  kind: 'account' | 'agent'
  id: string
  displayName: string
}

export interface SessionCreatedActor {
  accountId: string
  displayName: string
  kind: SessionActorKind
}

export interface SessionOwnerRef extends SessionActorRef {
  assignedAt: number
  assignedBy: string
}

export interface SessionParticipantIdentity {
  accountId: string
  displayName: string
  username: string
  kind: SessionActorKind
}

export type SessionVisibility = 'shared' | 'read-only' | 'suggest' | 'draft'

/**
 * Suggestion lifecycle for a `suggest`-visibility session (a2.5). A suggestion
 * is authored by a workspace member who may not write directly; the session
 * owner resolves it, and acceptance dispatches exactly one message.
 */
export type SessionSuggestionState = 'pending' | 'accepted' | 'dismissed'

/** Resolve actions a session owner may take on a pending suggestion. */
export type SessionSuggestionResolution = 'accepted' | 'dismissed'

export interface SessionSuggestion {
  id: string
  sessionId: string
  body: string
  state: SessionSuggestionState
  /** The member who proposed the suggestion; suggestions are author-bound. */
  author: SessionCreatedActor
  createdAt: number
  /** Set when the suggestion leaves `pending`. */
  resolvedAt?: number
  /** Account id of the resolving owner. */
  resolvedBy?: string
  /** The single dispatched message produced by an accepted suggestion. */
  dispatchedMessageId?: string
}

/** Upper bound on a suggestion body (characters). */
export const SESSION_SUGGESTION_BODY_MAX = 2000
/** Upper bound on pending+resolved suggestions retained per session. */
export const SESSION_SUGGESTION_CAP_PER_SESSION = 64

export interface SessionTypingActor {
  accountId: string
  displayName: string
  expiresAt: number
}