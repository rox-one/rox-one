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
  target: TeamTarget
  authorUserId: string
  body: string
  /** userIds mentioned via @username in body */
  mentions: string[]
  createdAt: number
  sync: TeamSyncState
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

export type TeamActivityKind =
  | 'comment'
  | 'mention'
  | 'assign'
  | 'handoff'
  | 'access'
  | 'approval-request'
  | 'approval-decision'

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
  | { type: 'approval'; record: TeamApprovalRequest }

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
  activity: TeamActivityEvent[]
  outbox: TeamOutboxEntry[]
}

/** Inbox item addressed to a member (mention, handoff, assignment, approval). */
export interface TeamInboxItem {
  id: string
  kind: 'mention' | 'handoff' | 'assign' | 'approval'
  fromUserId: string
  target: TeamTarget
  at: number
  text?: string
}
