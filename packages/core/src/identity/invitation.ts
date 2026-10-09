/**
 * W1-11 (#1508) — Invitation contract (TECH-SPEC §15.1–§15.2, DATA-MODEL §5.11).
 *
 * An invitation binds an email to a principal (a fresh placeholder, or an
 * existing account), carries the containers the invitee joins on activation
 * and owns the single-use token. Token issue / verify reuses the existing
 * `apps/workspace-service/src/modules/collaboration/invitations.ts` and
 * `packages/shared/src/collaboration/invite.ts` (extended with `principal_id`
 * and `targets`), so this file declares the contract those call sites share.
 *
 * `@rox/core` stays dependency-free: the token *hash* is computed by the owner
 * (server) with `sha256`; only the parameters live here.
 */

import type { WorkspaceMemberRole } from './principal.ts'

/** `invitation.status` (513-identity-lifecycle.sql). */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired', 'bounced'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export function isInvitationStatus(value: unknown): value is InvitationStatus {
  return typeof value === 'string' && (INVITATION_STATUSES as readonly string[]).includes(value)
}

/** `invitation.role` — the workspace role the invitee receives on activation. */
export const INVITATION_ROLES = ['member', 'admin', 'guest'] as const
export type InvitationRole = (typeof INVITATION_ROLES)[number]

export function isInvitationRole(value: unknown): value is InvitationRole {
  return typeof value === 'string' && (INVITATION_ROLES as readonly string[]).includes(value)
}

/** Containers joined when the invitation is accepted (General is implicit). */
export interface InvitationTarget {
  kind: 'space' | 'channel'
  id: string
  role?: 'owner' | 'admin' | 'member' | 'guest'
}

export interface Invitation {
  invitationId: string
  workspaceId: string
  /** citext: normalised (lower-case, trimmed, IDN → punycode). */
  email: string
  /** The placeholder or existing account the invitation belongs to. */
  principalId: string
  invitedBy: string
  role: InvitationRole
  targets: readonly InvitationTarget[]
  status: InvitationStatus
  message?: string | null
  sentAt?: string | null
  lastRemindedAt?: string | null
  /** `sentAt + 30 days`; never absent. */
  expiresAt: string
  acceptedAt?: string | null
  createdAt?: string
  revision?: number
}

/** A token is 32 random bytes, stored as its sha256 hash, single use (§15.2). */
export const INVITATION_TOKEN_BYTES = 32
export const INVITATION_TOKEN_ALGORITHM = 'sha256'

/** Invitations expire 30 days after they are sent (§15.2). */
export const INVITATION_TTL_DAYS = 30

/** Reminder emails go out on these days after the invitation was sent. */
export const INVITATION_REMINDER_DAYS = [3, 7] as const

/** Abuse limit for `people:invite`: 100 invitations per inviter per day (§15.2). */
export const INVITATION_DAILY_LIMIT_PER_INVITER = 100

/** Admin-restrictable allow-list of invite domains (`approval_policy` setting). */
export interface InviteDomainPolicy {
  /** Empty / absent = every domain is allowed. */
  allowedDomains?: readonly string[]
}

/**
 * Normalise an email for `principal.primary_email` (citext): trim, lower-case.
 * The IDN → punycode step of DATA-MODEL §5.11 is applied by the identity
 * module, which owns the DNS-facing part of the address.
 */
export function normalizePrimaryEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** The unique pending key: one live invitation per (workspace, email). */
export function invitationPendingKey(workspaceId: string, email: string): string {
  return `${workspaceId}:${normalizePrimaryEmail(email)}`
}

export function invitationIsExpired(invitation: Pick<Invitation, 'status' | 'expiresAt'>, now: Date = new Date()): boolean {
  if (invitation.status !== 'pending') return false
  const expires = Date.parse(invitation.expiresAt)
  return Number.isFinite(expires) ? expires <= now.getTime() : true
}

/**
 * The reminder that is due, if any: the largest configured day count that has
 * passed since `sentAt` and is later than `lastRemindedAt`.
 */
export function dueInvitationReminder(invitation: Invitation, now: Date = new Date()): number | null {
  if (invitation.status !== 'pending' || !invitation.sentAt) return null
  const sentAt = Date.parse(invitation.sentAt)
  if (!Number.isFinite(sentAt)) return null
  const lastReminded = invitation.lastRemindedAt ? Date.parse(invitation.lastRemindedAt) : Number.NEGATIVE_INFINITY
  const daysSinceSent = (now.getTime() - sentAt) / 86_400_000
  let due: number | null = null
  for (const day of INVITATION_REMINDER_DAYS) {
    if (daysSinceSent < day) break
    if (sentAt + day * 86_400_000 > lastReminded) due = day
  }
  return due
}

/** The invitation expiry a fresh invitation gets. */
export function invitationExpiry(sentAt: Date): string {
  return new Date(sentAt.getTime() + INVITATION_TTL_DAYS * 86_400_000).toISOString()
}

/** Whether an email may be invited under the workspace's domain policy. */
export function inviteDomainAllowed(email: string, policy: InviteDomainPolicy | null | undefined): boolean {
  const allowed = policy?.allowedDomains
  if (!allowed || allowed.length === 0) return true
  const at = normalizePrimaryEmail(email).lastIndexOf('@')
  if (at <= 0) return false
  const domain = normalizePrimaryEmail(email).slice(at + 1)
  return allowed.some(candidate => normalizePrimaryEmail(candidate) === domain)
}

export type { WorkspaceMemberRole }