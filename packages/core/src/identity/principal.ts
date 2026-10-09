/**
 * W1-11 (#1508) — Principal model and placeholder rules (DATA-MODEL §5.11,
 * ADR-U16; TECH-SPEC §15).
 *
 * `principal` (01-domain-contract + 502 `kind` + 513 `status`) is the identity
 * of every actor: people, bots, system actors. A **placeholder principal** is
 * created when an email with no account is invited; it keeps its
 * `principal_id` forever, so mentions, assignments and chat membership that
 * point at it survive activation (ADR-U16).
 *
 * `@rox/core` stays dependency-free: ids and emails are opaque strings here,
 * the DDL owns their shape, and `@rox/shared/identity/schemas` owns validation.
 */

/** `principal.kind` (502-directory.sql). */
export const PRINCIPAL_KINDS = ['human', 'bot', 'guest', 'service'] as const
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number]

export function isPrincipalKind(value: unknown): value is PrincipalKind {
  return typeof value === 'string' && (PRINCIPAL_KINDS as readonly string[]).includes(value)
}

/** `principal.status` (513-identity-lifecycle.sql). */
export const PRINCIPAL_STATUSES = ['active', 'placeholder', 'deactivated'] as const
export type PrincipalStatus = (typeof PRINCIPAL_STATUSES)[number]

export function isPrincipalStatus(value: unknown): value is PrincipalStatus {
  return typeof value === 'string' && (PRINCIPAL_STATUSES as readonly string[]).includes(value)
}

export interface Principal {
  principalId: string
  kind: PrincipalKind
  status: PrincipalStatus
  /** citext, normalised (lower-case, trimmed); set for invited placeholders. */
  primaryEmail?: string | null
  activatedAt?: string | null
  invitedBy?: string | null
  displayName?: string | null
  username?: string | null
  /** Set on a merged placeholder: the account that absorbed it. */
  mergedInto?: string | null
}

/** Only an active human account can sign in (§5.11 rule 3). */
export function principalCanSignIn(principal: Pick<Principal, 'kind' | 'status'>): boolean {
  return principal.kind === 'human' && principal.status === 'active'
}

/** `workspace_member.status` (513-identity-lifecycle.sql). */
export const WORKSPACE_MEMBER_STATUSES = ['invited', 'active', 'left', 'removed'] as const
export type WorkspaceMemberStatus = (typeof WORKSPACE_MEMBER_STATUSES)[number]

export function isWorkspaceMemberStatus(value: unknown): value is WorkspaceMemberStatus {
  return typeof value === 'string' && (WORKSPACE_MEMBER_STATUSES as readonly string[]).includes(value)
}

/**
 * Membership roles of DATA-MODEL §5.11 (and `invitation.role`): `owner`,
 * `admin`, `member`, plus `guest` for external invitees. The current
 * `workspace_member` DDL (01-domain-contract) constrains direct rows to
 * `owner | member`; `admin` arrives through invitations and ACL grants, so the
 * vocabulary is declared here in one place.
 */
export const WORKSPACE_MEMBER_ROLES = ['owner', 'admin', 'member', 'guest'] as const
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number]

export function isWorkspaceMemberRole(value: unknown): value is WorkspaceMemberRole {
  return typeof value === 'string' && (WORKSPACE_MEMBER_ROLES as readonly string[]).includes(value)
}

export interface WorkspaceMember {
  workspaceId: string
  principalId: string
  role: WorkspaceMemberRole
  status: WorkspaceMemberStatus
  joinedAt?: string | null
}

/** Roles that may change a chat's visibility, membership or permissions. */
export const CHAT_ADMIN_ROLES = ['owner', 'admin'] as const

export function isWorkspaceAdmin(role: WorkspaceMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

// ── What a placeholder may and may not do (DATA-MODEL §5.11 rule 3) ──────────

/** Actions a placeholder principal may be the *target* of. */
export const PLACEHOLDER_ALLOWED_ACTIONS = ['mention', 'assign', 'event_attendee', 'contributor', 'invite'] as const
export type PlaceholderAction = (typeof PLACEHOLDER_ALLOWED_ACTIONS)[number]

/**
 * Everything else is denied for a placeholder, including every mutating
 * command: it cannot sign in, receive in-app notifications or appear in
 * presence, and it cannot create chats (§5.11 "Who may create").
 */
export const PLACEHOLDER_DENIED_ACTIONS = [
  'sign_in',
  'receive_in_app_notification',
  'appear_in_presence',
  'create_chat',
  'run_command',
] as const

export function placeholderCan(action: PlaceholderAction): boolean {
  return PLACEHOLDER_ALLOWED_ACTIONS.includes(action)
}

/** Notifications addressed to a placeholder are held, not delivered (§5.11 rule 3). */
export const HELD_NOTIFICATION_DIGEST_HOURS = 24

export interface HeldNotificationRule {
  /** `notification.status = 'held'` (§5.11, §5.10). */
  held: true
  /** At most one «N обновлений ждут вас в Rox» digest per this window. */
  digestEveryHours: number
  /** Titles only — never content the inviter could not share. */
  titlesOnly: true
}

export const HELD_NOTIFICATION_RULE: HeldNotificationRule = {
  held: true,
  digestEveryHours: HELD_NOTIFICATION_DIGEST_HOURS,
  titlesOnly: true,
}

/** A placeholder with no remaining invitation is deactivated after 30 days. */
export const PLACEHOLDER_DORMANT_DAYS = 30

/** Memberships that flip when a placeholder activates (§5.11 rule 4). */
export const ACTIVATED_MEMBER_STATUS: WorkspaceMemberStatus = 'active'
/** Chat membership state a placeholder holds until activation. */
export const PENDING_ACTIVATION_CHAT_STATE = 'pending_activation'

/** Whether a membership becomes active with the principal (or stays as it is). */
export function membershipAfterActivation(status: WorkspaceMemberStatus): WorkspaceMemberStatus {
  return status === 'invited' ? ACTIVATED_MEMBER_STATUS : status
}