/**
 * Team collaboration model (team.*.v1).
 *
 * Rox is used by employees of one organization. This module holds the
 * local-first data model for teammate-facing actions: comments, @mentions,
 * assignments, handoffs, session access roles, approval requests and the
 * activity stream. Everything is written locally and queued in an outbox;
 * delivery to other members needs an organization server (see sync.ts).
 *
 * Members always come from real org membership (packages/shared/src/orgs).
 * This module never invents people.
 */

export type TeamTargetKind = 'session' | 'message' | 'note' | 'mapNode' | 'task' | 'automation'

export interface TeamTarget {
  kind: TeamTargetKind
  id: string
  /** Parent id, e.g. the session of a message or the map of a node. */
  parentId?: string
  title?: string
  /** Immutable source revision captured when the comment/request is created. */
  revision?: string
}
export interface TeamVersionedTarget extends TeamTarget {
  revision: string
}

/** A real org member as seen by the team layer. */
export interface TeamMemberRef {
  userId: string
  displayName: string
  username?: string
  email?: string
  role: 'owner' | 'admin' | 'member'
}

/** Access role granted to a teammate on a shared session. */
export type TeamAccessRole = 'view' | 'comment' | 'run'

export type TeamSyncState = 'local' | 'queued' | 'synced' | 'rejected'

export interface TeamComment {
  id: string
  target: TeamVersionedTarget
  authorUserId: string
  body: string
  /** Stable organization member IDs resolved from the visible roster. */
  mentions: string[]
  createdAt: number
  sync: TeamSyncState
  /** Replies refer to the immutable root comment; null/omitted starts a thread. */
  parentCommentId?: string
  /** Tombstone timestamp; body is retained locally for conflict/reconciliation. */
  deletedAt?: number
}

export type TeamRecipientDelivery = 'pending-delivery' | 'delivered' | 'failed' | 'revocation-pending' | 'revoked' | 'expired'
export type TeamRecipientDecision = 'pending' | 'accepted' | 'rejected'

/** Metadata-only consent request; it never grants access to the target itself. */
export interface TeamRecipientRequest {
  id: string
  organizationId: string
  recipientUserId: string
  senderUserId: string
  target: TeamVersionedTarget
  sourceCommentId: string
  idempotencyKey: string
  createdAt: number
  delivery: TeamRecipientDelivery
  decision: TeamRecipientDecision
  decidedAt?: number
}

export interface TeamAssignment {
  id: string
  target: TeamTarget
  assigneeUserId: string
  assignedByUserId: string
  createdAt: number
  sync: TeamSyncState
}

export interface TeamHandoff {
  id: string
  target: TeamTarget
  toUserId: string
  fromUserId: string
  summary: string
  createdAt: number
  sync: TeamSyncState
}

export interface TeamAccessGrant {
  id: string
  target: TeamTarget
  userId: string
  role: TeamAccessRole
  grantedByUserId: string
  createdAt: number
  sync: TeamSyncState
}

export type TeamApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface TeamApprovalRequest {
  id: string
  target: TeamTarget
  reviewerUserId: string
  requestedByUserId: string
  note: string
  status: TeamApprovalStatus
  createdAt: number
  sync: TeamSyncState
}
export interface TeamRecipientAction {
  requestId: string
  recipientUserId: string
  decision: Exclude<TeamRecipientDecision, 'pending'>
  decidedAt: number
  sync: TeamSyncState
}

export type TeamActivityKind =
  | 'comment'
  | 'mention'
  | 'assign'
  | 'handoff'
  | 'access'
  | 'approval-request'
  | 'approval-decision'
  | 'recipient-decision'
export interface TeamActivityEvent {
  id: string
  kind: TeamActivityKind
  actorUserId: string
  /** Other member affected (assignee, mentioned user, reviewer…) */
  subjectUserId?: string
  target: TeamTarget
  at: number
  /** Id of the record that produced the event */
  refId: string
}

export type TeamOutboxOp =
  | { type: 'comment'; record: TeamComment }
  | { type: 'assign'; record: TeamAssignment }
  | { type: 'handoff'; record: TeamHandoff }
  | { type: 'access'; record: TeamAccessGrant }
  | { type: 'recipient-revoke'; record: TeamRecipientRequest }
  | { type: 'approval'; record: TeamApprovalRequest }
  | { type: 'recipient-request'; record: TeamRecipientRequest }
  | { type: 'recipient-action'; record: TeamRecipientAction }
export interface TeamOutboxEntry {
  id: string
  op: TeamOutboxOp
  queuedAt: number
  attempts: number
  lastError?: string
}

export interface TeamLocalState {
  version: 1
  comments: TeamComment[]
  assignments: TeamAssignment[]
  handoffs: TeamHandoff[]
  access: TeamAccessGrant[]
  approvals: TeamApprovalRequest[]
  recipientRequests: TeamRecipientRequest[]
  recipientActions: TeamRecipientAction[]
  activity: TeamActivityEvent[]
  outbox: TeamOutboxEntry[]
}

/** Inbox item addressed to a member from an authoritative delivered record. */
export interface TeamInboxItem {
  id: string
  kind: 'mention' | 'handoff' | 'assign' | 'approval' | 'recipient-request'
  fromUserId: string
  target: TeamVersionedTarget
  at: number
  text?: string
  delivery: 'delivered'
  requestId?: string
  pendingAction?: Exclude<TeamRecipientDecision, 'pending'>
  pendingActionSync?: TeamSyncState
  organizationId?: string
}
