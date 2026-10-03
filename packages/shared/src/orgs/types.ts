import { resolveConfigDir } from "../config/paths.ts"
/**
 * Organization and team workspace types for local persistence and authorized RPC.
 */

export type OrgRole = 'owner' | 'admin' | 'member'

export interface Organization {
  id: string
  name: string
  slug: string
  createdBy: string
  createdAt: number
}

export interface OrgMember {
  orgId: string
  userId: string
  role: OrgRole
  /** Display hint only — may be email or username at invite time */
  displayLabel?: string
  username?: string
  email?: string
  joinedAt: number
}

export interface OrgInvite {
  id: string
  orgId: string
  /** Email or username the invite targets */
  emailOrUsername: string
  role: Exclude<OrgRole, 'owner'>
  token: string
  createdAt: number
  /** Invitations expire after a bounded acceptance window. */
  expiresAt: number
  createdBy: string
  acceptedAt?: number
  acceptedByUserId?: string
  revokedAt?: number
  revokedByUserId?: string
}

/** List/get DTO invite — token is never exposed outside create/accept. */
export type OrgInvitePublic = Omit<OrgInvite, 'token'> & { token?: never }

export interface OrgAuditEvent {
  id: string
  orgId: string
  actorUserId: string
  action: 'invite' | 'accept' | 'role-change' | 'member-remove' | 'invite-revoke'
  outcome: 'denied'
  occurredAt: number
}

export interface OrgsStoreFile {
  version: 2
  organizations: Organization[]
  members: OrgMember[]
  invites: OrgInvite[]
  auditEvents: OrgAuditEvent[]
}

export interface CreateOrganizationInput {
  name: string
  slug?: string
}

export interface InviteToOrgInput {
  orgId: string
  emailOrUsername: string
  role?: Exclude<OrgRole, 'owner'>
}

export interface AcceptInviteInput {
  token: string
}

export interface OrganizationWithMembers extends Organization {
  members: OrgMember[]
  /** Current caller identity, supplied by the authorized listing boundary. */
  viewerUserId?: string
  viewerAuthority?: 'native' | 'local'
  viewerIssuer?: string
  /** Pending invites without redeem tokens (create/accept return tokens). */
  pendingInvites: OrgInvitePublic[]
}

/** Identity response explicitly distinguishes server principal from local profile. */
export interface OrgCallerIdentity {
  /** Authenticated self profile display name; native actors never inherit host preferences. */
  name?: string
  userId: string
  username?: string
  email?: string
  authority: 'native' | 'local'
  issuer?: string
}

/** Authenticated identity supplied by the RPC server, never request payload data. */
export interface OrgActorIdentity {
  userId: string
  email?: string
  username?: string
}
