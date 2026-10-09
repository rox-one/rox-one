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

export interface SessionTypingActor {
  accountId: string
  displayName: string
  expiresAt: number
}