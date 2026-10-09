/**
 * W1-11 (#1508) — Identity lifecycle: invitations, placeholder principals and
 * their activation / merge (TECH-SPEC §15.1, DATA-MODEL §5.11, ADR-U16).
 *
 * The three lifecycle commands move one `principal` row through
 * `placeholder → active` (activation) or `placeholder → deactivated`
 * (merge), and **the id never changes**: mentions, assignments, chat
 * membership and entity links keep pointing at the same `principal_id`, which
 * is the whole point of inviting a placeholder before the account exists.
 *
 * Everything here is a pure plan: the caller (workspace-service `modules/identity`
 * for the workspace authority, server-core for local mode) executes the steps
 * in one transaction and emits the events. `@rox/core` stays dependency-free.
 */

import {
  ACTIVATED_MEMBER_STATUS,
  PENDING_ACTIVATION_CHAT_STATE,
  membershipAfterActivation,
  type Principal,
  type PrincipalStatus,
  type WorkspaceMember,
  type WorkspaceMemberRole,
  type WorkspaceMemberStatus,
} from './principal.ts'
import { normalizePrimaryEmail, type Invitation, type InvitationRole, type InvitationTarget } from './invitation.ts'
import { GENERAL_CHAT_SYSTEM_ROLE, type TeamChat } from './team-chats.ts'

/** `domain_event` types this lifecycle emits (DATA-MODEL §9.1). */
export const IDENTITY_EVENTS = {
  accountCreated: 'identity.account_created',
  placeholderCreated: 'identity.placeholder_created',
  placeholderActivated: 'identity.placeholder_activated',
  placeholderMerged: 'identity.placeholder_merged',
  invitationSent: 'identity.invitation_sent',
  invitationAccepted: 'identity.invitation_accepted',
  invitationRevoked: 'identity.invitation_revoked',
  invitationExpired: 'identity.invitation_expired',
  memberAdded: 'people.member_added',
  invitationsSent: 'people.invitations_sent',
} as const

export type IdentityEventType = (typeof IDENTITY_EVENTS)[keyof typeof IDENTITY_EVENTS]

/** The catalogue commands of this lifecycle (§15.1). */
export const IDENTITY_COMMAND_TYPES = [
  'workspaces.create',
  'people.invite',
  'identity.ensure_placeholder',
  'identity.activate_placeholder',
  'identity.merge_placeholder',
] as const

export type IdentityCommandType = (typeof IDENTITY_COMMAND_TYPES)[number]

export function isIdentityCommandType(value: string): value is IdentityCommandType {
  return (IDENTITY_COMMAND_TYPES as readonly string[]).includes(value)
}

/** `people.invite` (§15.1): one command, many emails, one role and target set. */
export interface InvitePeoplePayload {
  workspaceId: string
  emails: readonly string[]
  role?: InvitationRole
  targets?: readonly InvitationTarget[]
  message?: string
}

/** `identity.ensure_placeholder` (§5.11 rule 1). */
export interface EnsurePlaceholderPayload {
  workspaceId: string
  email: string
  invitedBy: string
  role?: InvitationRole
  targets?: readonly InvitationTarget[]
  /** Where the invitee is auto-joined as `pending_activation`; General is implicit. */
  chatIds?: readonly string[]
  message?: string
  /** Override for tests; defaults to now. */
  sentAt?: string
}

/** `identity.activate_placeholder` (§5.11 rule 4). */
export interface ActivatePlaceholderPayload {
  /** The auth subject (OIDC `sub`, password account, magic link) being attached. */
  authSubject: string
  /** The email the provider verified; must equal `principal.primary_email`. */
  verifiedEmail: string
}

/** `identity.merge_placeholder` (§5.11 rule 6). */
export interface MergePlaceholderPayload {
  placeholderId: string
  accountId: string
  /** An admin confirmed the merge; it is audited either way. */
  confirmedBy: string
}

/** Why an activation or merge cannot proceed. */
export type IdentityLifecycleRefusal =
  | 'not_a_placeholder'
  | 'email_mismatch'
  | 'deactivated'
  | 'same_principal'
  | 'account_not_active'

export interface LifecycleRefusal {
  ok: false
  reason: IdentityLifecycleRefusal
}

export interface PlaceholderPlan {
  ok: true
  email: string
  /** `true` when a new placeholder row must be created. */
  createPlaceholder: boolean
  /** Existing principal the invitation attaches to (placeholder or account). */
  principalId: string | null
  /** Existing active account: the invite is an Inbox card, no placeholder. */
  existingAccount: boolean
  memberStatus: WorkspaceMemberStatus
  chatMemberships: readonly ChatMembershipStep[]
  role: InvitationRole
}

export interface ChatMembershipStep {
  /** `general` = the workspace's General chat; an id otherwise. */
  chatId: string
  state: typeof PENDING_ACTIVATION_CHAT_STATE
}

/**
 * Plan an invitation for one email (§5.11 rules 1–2). An existing **active**
 * principal is added as `invited` with an Inbox card and no placeholder; an
 * unknown or already-placeholder email becomes (or stays) a placeholder.
 */
export function planPlaceholder(input: {
  email: string
  existing?: Pick<Principal, 'principalId' | 'status' | 'kind'> | null
  role?: InvitationRole
  chatIds?: readonly string[]
}): PlaceholderPlan {
  const email = normalizePrimaryEmail(input.email)
  const existing = input.existing ?? null
  // A deactivated row does not block the email (unique index is partial), so a
  // fresh invite creates a new placeholder rather than reviving a dead one.
  const reusable = existing !== null && existing.status !== 'deactivated'
  const activeAccount = reusable && existing.status === 'active' && existing.kind === 'human'
  return {
    ok: true,
    email,
    createPlaceholder: !reusable,
    principalId: reusable ? existing.principalId : null,
    existingAccount: activeAccount,
    memberStatus: 'invited',
    chatMemberships: (input.chatIds ?? []).map(chatId => ({ chatId, state: PENDING_ACTIVATION_CHAT_STATE })),
    role: input.role ?? 'member',
  }
}

export interface ActivationStep {
  principalId: string
  status: Extract<PrincipalStatus, 'active'>
  activatedAt: string
  /** The auth subject attached to this same principal (`auth_subject_alias`). */
  authSubject: string
  memberships: readonly { workspaceId: string; from: WorkspaceMemberStatus; to: WorkspaceMemberStatus }[]
  /** Held notifications released to the Inbox, collapsed. */
  releaseHeldNotifications: true
  /** Chat memberships that flip from `pending_activation` to `active`. */
  chatMemberships: 'pending_activation→active'
}

/**
 * Activation: the auth subject is attached to the **existing** principal, so
 * `principalId` is returned unchanged. This is the property test of PLAN §3
 * W1-11: activation keeps ids.
 */
export function planPlaceholderActivation(input: {
  placeholder: Pick<Principal, 'principalId' | 'status' | 'primaryEmail' | 'kind'>
  verifiedEmail: string
  authSubject: string
  memberships?: readonly Pick<WorkspaceMember, 'workspaceId' | 'status'>[]
  now?: Date
}): ActivationStep | LifecycleRefusal {
  const { placeholder } = input
  if (placeholder.status === 'deactivated') return { ok: false, reason: 'deactivated' }
  if (placeholder.status !== 'placeholder') return { ok: false, reason: 'not_a_placeholder' }
  if (normalizePrimaryEmail(input.verifiedEmail) !== normalizePrimaryEmail(placeholder.primaryEmail ?? '')) {
    return { ok: false, reason: 'email_mismatch' }
  }
  const now = input.now ?? new Date()
  return {
    principalId: placeholder.principalId,
    status: 'active',
    activatedAt: now.toISOString(),
    authSubject: input.authSubject,
    memberships: (input.memberships ?? []).map(member => ({
      workspaceId: member.workspaceId,
      from: member.status,
      to: membershipAfterActivation(member.status),
    })),
    releaseHeldNotifications: true,
    chatMemberships: 'pending_activation→active',
  }
}

/**
 * Collections a merge re-points (§5.11 rule 6), in the batch order the server
 * applies. Mention indexes keep the placeholder's row until the same batch
 * rewrites it, so a half-applied merge never loses a mention.
 */
export const PLACEHOLDER_MERGE_COLLECTIONS = [
  'chat_member',
  'workspace_member',
  'work_item.assignee_id',
  'entity_link',
  'mention_index',
] as const

export type PlaceholderMergeCollection = (typeof PLACEHOLDER_MERGE_COLLECTIONS)[number]

export interface MergeStep {
  placeholderId: string
  accountId: string
  collections: readonly PlaceholderMergeCollection[]
  /** The placeholder is deactivated with `merged_into`, never deleted. */
  placeholderStatus: Extract<PrincipalStatus, 'deactivated'>
  mergedInto: string
  audited: true
}

/** Merge needs an admin's confirmation and an active target account (§5.11 rule 6). */
export function planPlaceholderMerge(input: {
  placeholder: Pick<Principal, 'principalId' | 'status'>
  account: Pick<Principal, 'principalId' | 'status'>
  confirmedBy: string
}): MergeStep | LifecycleRefusal {
  if (input.placeholder.principalId === input.account.principalId) return { ok: false, reason: 'same_principal' }
  if (input.placeholder.status !== 'placeholder') return { ok: false, reason: 'not_a_placeholder' }
  if (input.account.status !== 'active') return { ok: false, reason: 'account_not_active' }
  return {
    placeholderId: input.placeholder.principalId,
    accountId: input.account.principalId,
    collections: PLACEHOLDER_MERGE_COLLECTIONS,
    placeholderStatus: 'deactivated',
    mergedInto: input.account.principalId,
    audited: true,
  }
}

/** Deduplicate and normalise an invite list, preserving order (§15.1). */
export function normalizeInviteEmails(emails: readonly string[]): string[] {
  const seen: Record<string, true> = {}
  const out: string[] = []
  for (const raw of emails) {
    const email = normalizePrimaryEmail(raw)
    if (!email || seen[email]) continue
    seen[email] = true
    out.push(email)
  }
  return out
}

/** The Inbox card an existing account gets instead of a placeholder (§5.11 rule 2). */
export interface InboxInviteCard {
  kind: 'invite'
  workspaceId: string
  role: InvitationRole
  invitedBy: string
  targets: readonly InvitationTarget[]
}

export function inboxInviteCard(input: {
  workspaceId: string
  role: InvitationRole
  invitedBy: string
  targets?: readonly InvitationTarget[]
}): InboxInviteCard {
  return { kind: 'invite', workspaceId: input.workspaceId, role: input.role, invitedBy: input.invitedBy, targets: input.targets ?? [] }
}

/** The General chat membership every invite creates (§5.11 rule 1). */
export function generalChatInviteChatIds(chat: Pick<TeamChat, 'chatId' | 'systemRole'>): string[] {
  return chat.systemRole === GENERAL_CHAT_SYSTEM_ROLE ? [chat.chatId] : []
}

export type { Invitation, InvitationRole, InvitationTarget, WorkspaceMemberRole, WorkspaceMemberStatus }