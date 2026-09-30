/**
 * Organization storage — CONFIG_DIR/orgs.json
 *
 * Local persistence for organization membership and bounded-lifetime invites.
 * Trusted RPC callers supply their server-issued identity; local callers use
 * the device profile. Invite tokens stay inside privileged create/accept flows.
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from "../config/paths.ts"
import {
  ensureLocalUserIdentity,
  type LocalUserIdentity,
} from '../config/preferences.ts'
import type {
  AcceptInviteInput,
  CreateOrganizationInput,
  InviteToOrgInput,
  OrgActorIdentity,
  OrgAuditEvent,
  OrgInvite,
  OrgInvitePublic,
  OrgMember,
  OrgRole,
  Organization,
  OrganizationWithMembers,
  OrgsStoreFile,
} from './types.ts'

const ORGS_FILE = join(resolveConfigDir(), 'orgs.json')

const STORE_VERSION = 2 as const

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isPendingInvite(invite: OrgInvite, now = Date.now()): boolean {
  const expiresAt = invite.expiresAt ?? invite.createdAt + INVITE_TTL_MS
  return !invite.acceptedAt && !invite.revokedAt && expiresAt > now
}

function resolveActor(actor?: OrgActorIdentity): OrgActorIdentity {
  if (actor === undefined) return ensureLocalUserIdentity()
  const userId = typeof actor.userId === 'string' ? actor.userId.trim() : ''
  if (!userId) throw new Error('Authenticated organization subject is required')
  return { ...actor, userId }
}

function matchesInvitee(invite: OrgInvite, actor: OrgActorIdentity): boolean {
  const target = invite.emailOrUsername.trim().toLowerCase()
  return [actor.userId, actor.email, actor.username]
    .some((value) => typeof value === 'string' && value.trim().toLowerCase() === target)
}

function isNativeSubjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
const EMPTY_STORE: OrgsStoreFile = {
  version: STORE_VERSION,
  organizations: [],
  members: [],
  invites: [],
  auditEvents: [],
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

function ensureDir(): void {
  const dir = dirname(ORGS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function getOrgsPath(): string {
  return ORGS_FILE
}

export function loadOrgsStore(): OrgsStoreFile {
  if (!existsSync(ORGS_FILE)) {
    return { ...EMPTY_STORE, organizations: [], members: [], invites: [] }
  }
  // Fail closed: corrupt or unreadable existing file must not wipe data on next save.
  let raw: Partial<OrgsStoreFile> | null
  try {
    raw = readJsonFileSync<Partial<OrgsStoreFile>>(ORGS_FILE)
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`Failed to read orgs store: ${String(err)}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid orgs store: expected a JSON object')
  }
  const invites = Array.isArray(raw.invites)
    ? raw.invites.map((invite) => ({
      ...invite,
      expiresAt: Number.isFinite(invite.expiresAt) ? invite.expiresAt : invite.createdAt + INVITE_TTL_MS,
    }))
    : []
  return {
    version: STORE_VERSION,
    organizations: Array.isArray(raw.organizations) ? raw.organizations : [],
    members: Array.isArray(raw.members) ? raw.members : [],
    invites,
    auditEvents: Array.isArray(raw.auditEvents) ? raw.auditEvents : [],
  }
}

export function saveOrgsStore(store: OrgsStoreFile): void {
  ensureDir()
  const payload: OrgsStoreFile = {
    version: STORE_VERSION,
    organizations: store.organizations,
    members: store.members,
    invites: store.invites,
    auditEvents: store.auditEvents,
  }
  atomicWriteFileSync(ORGS_FILE, JSON.stringify(payload, null, 2) + '\n')
}

export function recordOrganizationAccessDenial(
  orgId: string,
  actorUserId: string,
  action: OrgAuditEvent['action'],
): void {
  const userId = actorUserId.trim()
  if (!userId) throw new Error('Authenticated organization subject is required for audit')
  const store = loadOrgsStore()
  store.auditEvents.push({
    id: `audit_${randomUUID().slice(0, 12)}`,
    orgId: orgId.trim().slice(0, 128),
    actorUserId: userId,
    action,
    outcome: 'denied',
    occurredAt: Date.now(),
  })
  if (store.auditEvents.length > 1000) store.auditEvents.splice(0, store.auditEvents.length - 1000)
  saveOrgsStore(store)
}

/** Strip invite tokens from list/get DTOs (create/accept still return full tokens). */
function toPublicInvite(invite: OrgInvite): OrgInvitePublic {
  const { token: _token, ...rest } = invite
  return rest
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function contactFields(
  identity: OrgActorIdentity,
  inviteTarget?: string,
): { username?: string; email?: string } {
  const username = identity.username?.trim() || undefined
  const email = identity.email?.trim() || undefined
  if (!inviteTarget) return { username, email }
  if (looksLikeEmail(inviteTarget)) {
    return { username, email: email || inviteTarget.trim() }
  }
  return { username: username || inviteTarget.trim(), email }
}

/** Overlay the local profile onto the matching member without writing the store. */
export function hydrateMemberIdentity(
  member: OrgMember,
  identity: LocalUserIdentity = ensureLocalUserIdentity(),
): OrgMember {
  if (member.userId !== identity.userId) {
    return member
  }
  const username = identity.username?.trim() || member.username
  const email = identity.email?.trim() || member.email
  return {
    ...member,
    username,
    email,
    displayLabel: identity.username || identity.email || member.displayLabel || member.userId,
  }
}

function hydrateMembers(members: OrgMember[]): OrgMember[] {
  const identity = ensureLocalUserIdentity()
  return members.map((member) => hydrateMemberIdentity(member, identity))
}

function uniqueSlug(base: string, existing: Organization[]): string {
  const root = slugify(base) || 'org'
  let slug = root
  let n = 2
  const taken = new Set(existing.map((o) => o.slug))
  while (taken.has(slug)) {
    slug = `${root}-${n}`
    n += 1
  }
  return slug
}

export function getLocalIdentity(): LocalUserIdentity {
  return ensureLocalUserIdentity()
}

/**
 * Resolve a membership without granting authority to a missing organization.
 * Callers that need to authorize a mutation should use one of the `require*`
 * variants below rather than treating a locally supplied orgId as proof.
 */
export function getOrganizationMembership(orgId: string, userId: string): OrgMember | null {
  const normalizedOrgId = typeof orgId === 'string' ? orgId.trim() : ''
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
  if (!normalizedOrgId || !normalizedUserId) return null

  const store = loadOrgsStore()
  if (!store.organizations.some((org) => org.id === normalizedOrgId)) return null
  return store.members.find(
    (member) => member.orgId === normalizedOrgId && member.userId === normalizedUserId,
  ) ?? null
}

/**
 * Server-side organization authority check for TeamSpace mutations.
 * A client-controlled orgId is never sufficient: the current principal must
 * be a durable member in the local server store.
 */
export function requireOrganizationMembership(orgId: string, userId: string): OrgMember {
  const normalizedOrgId = typeof orgId === 'string' ? orgId.trim() : ''
  if (!normalizedOrgId) throw new Error('orgId is required for a team workspace')

  const store = loadOrgsStore()
  if (!store.organizations.some((org) => org.id === normalizedOrgId)) {
    throw new Error(`Organization not found: ${normalizedOrgId}`)
  }

  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
  const member = normalizedUserId
    ? store.members.find(
      (candidate) =>
        candidate.orgId === normalizedOrgId && candidate.userId === normalizedUserId,
    )
    : undefined
  if (!member) throw new Error('Not a member of this organization')
  return member
}

/** Require membership for the authenticated local server identity. */
export function requireCurrentLocalOrganizationMembership(orgId: string): OrgMember {
  return requireOrganizationMembership(orgId, ensureLocalUserIdentity().userId)
}

/** Fail closed for listing/selection paths when the org store is unavailable. */
export function isCurrentLocalOrganizationMember(orgId: string): boolean {
  try {
    return Boolean(requireCurrentLocalOrganizationMembership(orgId))
  } catch {
    return false
  }
}

export function listOrganizations(viewerUserId?: string): OrganizationWithMembers[] {
  const store = loadOrgsStore()
  const viewerId = viewerUserId?.trim()
  if (viewerUserId !== undefined && !viewerId) return []
  return store.organizations
    .filter((org) => !viewerId || store.members.some((member) => member.orgId === org.id && member.userId === viewerId))
    .map((org) => {
      const viewerMembership = viewerId
        ? store.members.find((member) => member.orgId === org.id && member.userId === viewerId)
        : undefined
      const canManageInvites = !viewerId || viewerMembership?.role === 'owner' || viewerMembership?.role === 'admin'
      return {
        ...org,
        ...(viewerId ? { viewerUserId: viewerId } : {}),
        members: hydrateMembers(store.members.filter((member) => member.orgId === org.id)),
        pendingInvites: canManageInvites
          ? store.invites.filter((invite) => invite.orgId === org.id && isPendingInvite(invite)).map(toPublicInvite)
          : [],
      }
    })
}

export function getOrganization(orgId: string, viewerUserId?: string): OrganizationWithMembers | null {
  return listOrganizations(viewerUserId).find((org) => org.id === orgId) ?? null
}

export function listOrgMembers(orgId: string, viewerUserId?: string): OrgMember[] {
  const store = loadOrgsStore()
  if (!store.organizations.some((org) => org.id === orgId)) {
    throw new Error(`Organization not found: ${orgId}`)
  }
  if (viewerUserId !== undefined) requireOrganizationMembership(orgId, viewerUserId)
  return hydrateMembers(store.members.filter((member) => member.orgId === orgId))
}

export function createOrganization(input: CreateOrganizationInput, actorIdentity?: OrgActorIdentity): OrganizationWithMembers {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('Organization name is required')

  const identity = resolveActor(actorIdentity)
  const store = loadOrgsStore()
  const slug = uniqueSlug(input.slug?.trim() || name, store.organizations)
  const now = Date.now()
  const org: Organization = {
    id: `org_${randomUUID().slice(0, 12)}`,
    name,
    slug,
    createdBy: identity.userId,
    createdAt: now,
  }
  const contact = contactFields(identity)
  const owner: OrgMember = {
    orgId: org.id,
    userId: identity.userId,
    role: 'owner',
    displayLabel: identity.username || identity.email || identity.userId,
    username: contact.username,
    email: contact.email,
    joinedAt: now,
  }

  store.organizations.push(org)
  store.members.push(owner)
  saveOrgsStore(store)

  return {
    viewerUserId: identity.userId,
    ...org,
    members: hydrateMembers([owner]),
    pendingInvites: [],
  }
}

function requireMemberRole(store: OrgsStoreFile, orgId: string, userId: string, min: OrgRole): OrgMember {
  const member = store.members.find((m) => m.orgId === orgId && m.userId === userId)
  if (!member) throw new Error('Not a member of this organization')
  const rank: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 }
  if (rank[member.role] < rank[min]) {
    throw new Error(`Requires ${min} role or higher`)
  }
  return member
}

export function inviteToOrganization(input: InviteToOrgInput, actorIdentity?: OrgActorIdentity): OrgInvite {
  const orgId = input.orgId
  const emailOrUsername = (input.emailOrUsername ?? '').trim()
  if (!orgId) throw new Error('orgId is required')
  if (!emailOrUsername) throw new Error('emailOrUsername is required')
  if (actorIdentity !== undefined && !isNativeSubjectId(emailOrUsername)) {
    throw new Error('Server invitations require an exact server-issued subject UUID')
  }

  const role: Exclude<OrgRole, 'owner'> = input.role === 'admin' ? 'admin' : 'member'
  const identity = resolveActor(actorIdentity)
  const store = loadOrgsStore()
  if (!store.organizations.some((organization) => organization.id === orgId)) {
    throw new Error(`Organization not found: ${orgId}`)
  }
  requireMemberRole(store, orgId, identity.userId, 'admin')

  const existing = store.invites.find(
    (invite) =>
      invite.orgId === orgId &&
      isPendingInvite(invite) &&
      invite.emailOrUsername.toLowerCase() === emailOrUsername.toLowerCase(),
  )
  if (existing) {
    existing.role = role
    saveOrgsStore(store)
    return existing
  }

  const createdAt = Date.now()
  const invite: OrgInvite = {
    id: `inv_${randomUUID().slice(0, 12)}`,
    orgId,
    emailOrUsername,
    role,
    token: newToken(),
    createdAt,
    expiresAt: createdAt + INVITE_TTL_MS,
    createdBy: identity.userId,
  }
  store.invites.push(invite)
  saveOrgsStore(store)
  return invite
}

/**
 * Redeem with an identity resolved at the trusted call boundary. Client input
 * contains only the opaque token; it can never choose the resulting member ID.
 */
export function acceptInvite(input: AcceptInviteInput, actorIdentity?: OrgActorIdentity): {
  org: OrganizationWithMembers
  member: OrgMember
  invite: OrgInvitePublic
} {
  if (Object.hasOwn(input, 'userId')) throw new Error('Invite acceptance identity cannot be supplied by the caller')
  const token = (input.token ?? '').trim()
  if (!token) throw new Error('token is required')

  const store = loadOrgsStore()
  const invite = store.invites.find((candidate) => candidate.token === token)
  if (!invite) throw new Error('Invite not found')
  if (invite.acceptedAt) throw new Error('Invite already accepted')
  if (invite.revokedAt) throw new Error('Invite revoked')
  if (!isPendingInvite(invite)) throw new Error('Invite expired')

  const org = store.organizations.find((organization) => organization.id === invite.orgId)
  if (!org) throw new Error('Organization not found for invite')

  const identity = resolveActor(actorIdentity)
  if (!matchesInvitee(invite, identity)) throw new Error('Invite is addressed to a different identity')
  if (store.members.some((member) => member.orgId === invite.orgId && member.userId === identity.userId)) {
    throw new Error('Identity is already a member of this organization')
  }
  const contact = contactFields(identity)
  const now = Date.now()
  const member: OrgMember = {
    orgId: invite.orgId,
    userId: identity.userId,
    role: invite.role,
    displayLabel: identity.username || identity.email || identity.userId,
    ...(contact.username ? { username: contact.username } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    joinedAt: now,
  }
  store.members.push(member)
  invite.acceptedAt = now
  invite.acceptedByUserId = identity.userId
  saveOrgsStore(store)

  return {
    org: {
      ...org,
      viewerUserId: identity.userId,
      members: hydrateMembers(store.members.filter((candidate) => candidate.orgId === org.id)),
      pendingInvites: store.invites
        .filter((candidate) => candidate.orgId === org.id && isPendingInvite(candidate))
        .map(toPublicInvite),
    },
    member,
    invite: toPublicInvite(invite),
  }
}

export function updateMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
  actorIdentity?: OrgActorIdentity,
): OrgMember {
  if (!['owner', 'admin', 'member'].includes(role)) throw new Error('Invalid organization role')
  const identity = resolveActor(actorIdentity)
  const store = loadOrgsStore()
  requireMemberRole(store, orgId, identity.userId, 'owner')
  const member = store.members.find((candidate) => candidate.orgId === orgId && candidate.userId === userId)
  if (!member) throw new Error('Member not found')
  if (member.role === 'owner' && role !== 'owner') {
    const owners = store.members.filter((candidate) => candidate.orgId === orgId && candidate.role === 'owner')
    if (owners.length <= 1) throw new Error('Cannot demote the only owner')
  }
  member.role = role
  saveOrgsStore(store)
  return member
}

export function revokeOrganizationInvite(
  orgId: string,
  inviteId: string,
  actorIdentity?: OrgActorIdentity,
): OrgInvitePublic {
  const identity = resolveActor(actorIdentity)
  const store = loadOrgsStore()
  requireMemberRole(store, orgId, identity.userId, 'admin')
  const invite = store.invites.find((candidate) => candidate.orgId === orgId && candidate.id === inviteId)
  if (!invite) throw new Error('Invite not found')
  if (!isPendingInvite(invite)) throw new Error('Invite is no longer pending')
  invite.revokedAt = Date.now()
  invite.revokedByUserId = identity.userId
  saveOrgsStore(store)
  return toPublicInvite(invite)
}

export function removeOrganizationMember(
  orgId: string,
  userId: string,
  actorIdentity?: OrgActorIdentity,
): OrgMember {
  const identity = resolveActor(actorIdentity)
  const store = loadOrgsStore()
  requireMemberRole(store, orgId, identity.userId, 'owner')
  const memberIndex = store.members.findIndex((candidate) => candidate.orgId === orgId && candidate.userId === userId)
  if (memberIndex < 0) throw new Error('Member not found')
  const member = store.members[memberIndex]!
  if (member.role === 'owner' && store.members.filter((candidate) => candidate.orgId === orgId && candidate.role === 'owner').length <= 1) {
    throw new Error('Cannot remove the only owner')
  }
  store.members.splice(memberIndex, 1)
  saveOrgsStore(store)
  return member
}

export function findInviteByToken(token: string): OrgInvitePublic | null {
  const store = loadOrgsStore()
  const invite = store.invites.find((candidate) => candidate.token === token)
  return invite ? toPublicInvite(invite) : null
}
