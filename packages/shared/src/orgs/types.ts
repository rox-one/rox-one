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

// ---------------------------------------------------------------------------
// Named operator roles and their method-scope ceiling
// ---------------------------------------------------------------------------
// Clean-room re-expression of OpenClaw's `gateway.roles` boundary
// (port-matrix row a1.2; upstream src/config/zod-schema.gateway.ts:82 and
// src/gateway/operator-role-policy.ts:95). A role is a configuration ceiling
// on an identified operator connection; it is NOT a tenant or trust boundary.

/** Closed set of operator scopes. Unknown scopes are refused at validation. */
export const OPERATOR_SCOPES = [
  'operator.read',
  'operator.sessions.read',
  'operator.sessions.write',
  'operator.write',
  'operator.admin',
  'operator.pairing',
  'operator.approvals',
  'operator.questions',
  'operator.talk',
  'operator.talk.secrets',
] as const

export type OperatorScope = (typeof OPERATOR_SCOPES)[number]

export interface OperatorRoleModelPolicy {
  sourceAgent?: string
  allow?: readonly string[]
  deny?: readonly string[]
}

export interface OperatorRoleSessions {
  /** Ceiling for operating sessions without explicit membership. */
  others: 'none' | 'view' | 'suggest' | 'write'
}

export interface OperatorRoleDefinition {
  /** Maximum access to someone else's sessions. */
  sessions?: OperatorRoleSessions
  /** Agent ids available to the role, or "*" for all. */
  agents?: '*' | readonly string[]
  /** Allowed operator scopes — the role's method-scope ceiling. */
  scopes: readonly OperatorScope[]
  sandbox?: 'inherit' | 'required'
  modelPolicy?: OperatorRoleModelPolicy
  accessPolicyPlugin?: string
}

/**
 * Effective per-connection ceiling. `configured:false` means no named-role
 * boundary is in force, so existing grant-based authority is unchanged. When
 * `configured` is true an empty `scopes` array is a deny-all ceiling.
 */
export interface OperatorRoleCeiling {
  readonly configured: boolean
  readonly role: string | null
  readonly scopes: readonly OperatorScope[]
  /**
   * Name of the access-policy plugin the role's definition declares, if any.
   * Resolved at admission against the access-policy registry; a named but
   * unregistered plugin fails closed (see access-policy-registry.ts).
   */
  readonly accessPolicyPlugin?: string | null
}
