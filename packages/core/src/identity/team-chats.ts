/**
 * W1-11 (#1508) — Team-chat contracts (D-v2-2, PRD R-COL-11 / ADR-U16;
 * TECH-SPEC §15.1; DATA-MODEL §5.11; UI-SPEC §23.4).
 *
 * Team = workspace. Every workspace gets **one General group chat** at
 * creation (`kind='group'`, `visibility='public'`, `system_role='general'`,
 * `workspace.general_chat_id`), which cannot be deleted or made private.
 * Members then create additional **group chats** (a conversation for a chosen
 * set of people) and **channels** (named, topic-based, with an optional "only
 * admins post" policy), each **public** (listed in «Обзор чатов», any member
 * may `im.join_chat`) or **private** (invite-only, invisible to non-members).
 *
 * This file holds the contract, not the storage: the `chat` columns live in
 * `512-im.sql` + `513-identity-lifecycle.sql`, and the commands are declared in
 * the catalogue (`catalogue/im.ts`, `catalogue/identity.ts`). Schema *names*
 * only — the UI is wave 2 (UI-SPEC §23.4).
 */

import { isWorkspaceAdmin, type WorkspaceMemberRole, type WorkspaceMemberStatus } from './principal.ts'

/** Chat kinds a member may create (D-v2-2). Other kinds (`p2p`, `space`, …) are system-created. */
export const TEAM_CHAT_KINDS = ['group', 'channel'] as const
export type TeamChatKind = (typeof TEAM_CHAT_KINDS)[number]

export function isTeamChatKind(value: unknown): value is TeamChatKind {
  return typeof value === 'string' && (TEAM_CHAT_KINDS as readonly string[]).includes(value)
}

/** `chat.visibility`. */
export const CHAT_VISIBILITIES = ['public', 'private'] as const
export type ChatVisibility = (typeof CHAT_VISIBILITIES)[number]

export function isChatVisibility(value: unknown): value is ChatVisibility {
  return typeof value === 'string' && (CHAT_VISIBILITIES as readonly string[]).includes(value)
}

/** Workspace setting `chat_creation` (default `members`). */
export const CHAT_CREATION_POLICIES = ['members', 'admins'] as const
export type ChatCreationPolicy = (typeof CHAT_CREATION_POLICIES)[number]

export function isChatCreationPolicy(value: unknown): value is ChatCreationPolicy {
  return typeof value === 'string' && (CHAT_CREATION_POLICIES as readonly string[]).includes(value)
}

/** `chat.posting_policy`: channels may be restricted to admins. */
export const CHAT_POSTING_POLICIES = ['all', 'admins'] as const
export type ChatPostingPolicy = (typeof CHAT_POSTING_POLICIES)[number]

export function isChatPostingPolicy(value: unknown): value is ChatPostingPolicy {
  return typeof value === 'string' && (CHAT_POSTING_POLICIES as readonly string[]).includes(value)
}

/** `chat.invite_policy`: who may invite into a private chat. */
export const CHAT_INVITE_POLICIES = ['members', 'admins'] as const
export type ChatInvitePolicy = (typeof CHAT_INVITE_POLICIES)[number]

export function isChatInvitePolicy(value: unknown): value is ChatInvitePolicy {
  return typeof value === 'string' && (CHAT_INVITE_POLICIES as readonly string[]).includes(value)
}

/** The one system role a chat can carry (513-identity-lifecycle.sql). */
export const GENERAL_CHAT_SYSTEM_ROLE = 'general'

/** Name of the default General chat when the workspace has no better name. */
export const GENERAL_CHAT_FALLBACK_NAME = 'General'

/** `chat_member.state` while the invitee has not activated (513, §5.11). */
export const CHAT_MEMBER_PENDING_ACTIVATION = 'pending_activation'

export interface TeamChat {
  chatId: string
  workspaceId: string
  kind: TeamChatKind
  visibility: ChatVisibility
  /** `'general'` for the default chat of the workspace. */
  systemRole?: typeof GENERAL_CHAT_SYSTEM_ROLE | null
  name?: string
  description?: string | null
  postingPolicy?: ChatPostingPolicy
  invitePolicy?: ChatInvitePolicy
  createdBy?: string
  archivedAt?: string | null
}

export interface CreateChatPayload {
  kind: TeamChatKind
  name?: string
  description?: string
  visibility: ChatVisibility
  members?: readonly string[]
  postingPolicy?: ChatPostingPolicy
  invitePolicy?: ChatInvitePolicy
}

export interface JoinChatPayload {
  chatId: string
}

export interface LeaveChatPayload {
  chatId: string
}

export interface SetVisibilityPayload {
  chatId: string
  visibility: ChatVisibility
  /** The owner/admin confirms that history becomes visible to joiners. */
  confirmHistoryExposure?: boolean
}

export interface BrowsePublicChatsPayload {
  query?: string
  kind?: TeamChatKind
  cursor?: string
  limit?: number
}

/**
 * What `workspaces.create` creates (§15.1): the workspace, its General chat
 * and the creator as admin, in one transaction.
 */
export interface GeneralChatDraft {
  kind: 'group'
  visibility: 'public'
  systemRole: 'general'
  name: string
  postingPolicy: 'all'
  invitePolicy: 'members'
}

/**
 * The invariant set of the General chat: auto-join for active members,
 * `pending_activation` for invited placeholders, never deleted, never private,
 * still renameable.
 */
export const GENERAL_CHAT_INVARIANTS = {
  autoJoin: 'all_active_members',
  pendingMembers: CHAT_MEMBER_PENDING_ACTIVATION,
  deletable: false,
  changeableVisibility: false,
  renameable: true,
  creatableBy: 'workspaces.create',
} as const

export function generalChatDraft(workspaceName?: string | null): GeneralChatDraft {
  const name = workspaceName?.trim() ? workspaceName.trim() : GENERAL_CHAT_FALLBACK_NAME
  return { kind: 'group', visibility: 'public', systemRole: GENERAL_CHAT_SYSTEM_ROLE, name, postingPolicy: 'all', invitePolicy: 'members' }
}

export function isGeneralChat(chat: Pick<TeamChat, 'systemRole'>): boolean {
  return chat.systemRole === GENERAL_CHAT_SYSTEM_ROLE
}

export interface CreateChatPermission {
  allowed: boolean
  reason?: 'policy_admins_only' | 'placeholder' | 'not_a_member'
}

/**
 * Who may create: any active member when `chat_creation='members'` (default),
 * owners / admins only when it is `'admins'`. Placeholders never can.
 */
export function canCreateChat(input: {
  role: WorkspaceMemberRole | null
  status: WorkspaceMemberStatus
  chatCreation: ChatCreationPolicy
}): CreateChatPermission {
  if (input.status === 'invited' || input.status === 'left' || input.status === 'removed') return { allowed: false, reason: 'placeholder' }
  if (!input.role) return { allowed: false, reason: 'not_a_member' }
  if (input.chatCreation === 'admins' && !isWorkspaceAdmin(input.role)) return { allowed: false, reason: 'policy_admins_only' }
  return { allowed: true }
}

/** Public chats are self-join; private chats are invite-only (§5.11). */
export function chatJoinMode(chat: Pick<TeamChat, 'visibility'>): 'self_join' | 'invite_only' {
  return chat.visibility === 'public' ? 'self_join' : 'invite_only'
}

/** `im.join_chat` is public-only; a private chat answers FORBIDDEN (§15.1). */
export function canJoinChat(input: { visibility: ChatVisibility; archived?: boolean }): boolean {
  return input.visibility === 'public' && input.archived !== true
}

export interface VisibilityChangePermission {
  allowed: boolean
  /** The switch exposes the chat's history to every joiner → privileged (§15.1). */
  requiresConfirmation: boolean
  /** Agent risk class of the switch: private → public is privileged. */
  privileged: boolean
  reason?: 'general_chat' | 'not_owner_or_admin'
}

/**
 * `im.set_visibility`: private → public needs an owner / admin **and** a
 * confirmation (the history becomes visible to joiners); public → private
 * keeps the current members and still needs an owner / admin. The General chat
 * is always public.
 */
export function canSetVisibility(input: {
  chat: Pick<TeamChat, 'systemRole' | 'visibility'>
  role: WorkspaceMemberRole | null
}): VisibilityChangePermission {
  if (isGeneralChat(input.chat)) return { allowed: false, requiresConfirmation: false, privileged: false, reason: 'general_chat' }
  if (!isWorkspaceAdmin(input.role)) return { allowed: false, requiresConfirmation: false, privileged: false, reason: 'not_owner_or_admin' }
  const toPublic = input.chat.visibility === 'private'
  return { allowed: true, requiresConfirmation: toPublic, privileged: toPublic }
}

/** Who may invite into a chat: `invite_policy` default `members` (§5.11). */
export function canInviteToChat(input: { invitePolicy?: ChatInvitePolicy; role: WorkspaceMemberRole | null }): boolean {
  if (!input.role) return false
  if ((input.invitePolicy ?? 'members') === 'admins') return isWorkspaceAdmin(input.role)
  return true
}

/** Who may post: `posting_policy` default `all`; channels may allow admins only. */
export function canPostToChat(input: { postingPolicy?: ChatPostingPolicy; role: WorkspaceMemberRole | null }): boolean {
  if (!input.role) return false
  if ((input.postingPolicy ?? 'all') === 'admins') return isWorkspaceAdmin(input.role)
  return true
}

// ── ACL projection (D-v2-2: private chats are hidden from non-members) ──────

/**
 * `resource_policy.privacy` for a chat, as the W1-04 ACL engine consumes it:
 * a private chat is `'invited'` — secret, so its name, members and content are
 * redacted from every listing, search result, mention and preview for a
 * non-member, and inheritance never flows through it (§8.2 "privacy presets").
 * A public chat inherits normally (`'inherit'`).
 */
export function chatPrivacyFor(chat: Pick<TeamChat, 'visibility'>): 'inherit' | 'invited' {
  return chat.visibility === 'private' ? 'invited' : 'inherit'
}

/** What one principal may do with one chat, derived from visibility + membership. */
export interface ChatAclProjection {
  /** `false` = the chat must not appear in a list, search or preview (§15.1). */
  visible: boolean
  /** The highest ACL action the principal may take on the chat resource. */
  action: 'none' | 'view_title' | 'view' | 'comment' | 'edit' | 'manage_access'
  /** `pending_activation` members are listed but cannot act yet. */
  pendingActivation: boolean
  /** The resource is secret to everyone else (ACL `secret` flag). */
  secret: boolean
}

/**
 * The chat's ACL projection for one principal. It is the single rule the
 * resolver, the search provider and the IM listings share, so "private chats
 * are invisible to non-members" is decided in one place:
 *
 * - a public chat is visible to active workspace members (`view`);
 * - a private chat is visible to its members only, and secret to everyone else;
 * - a chat owner / admin may `manage_access`, a member may post (`comment`);
 * - a placeholder (`pending_activation`) is visible to nobody and cannot act.
 */
export function chatAclProjection(input: {
  chat: Pick<TeamChat, 'visibility' | 'archivedAt'>
  member: { role: 'owner' | 'admin' | 'member'; state: 'active' | 'pending_activation' | 'left' | 'removed' } | null
  workspaceActive: boolean
}): ChatAclProjection {
  const { chat, member } = input
  const secret = chat.visibility === 'private'
  const active = member?.state === 'active'
  const pendingActivation = member?.state === 'pending_activation'
  const archived = chat.archivedAt !== null && chat.archivedAt !== undefined
  if (!input.workspaceActive) return { visible: false, action: 'none', pendingActivation, secret }
  if (secret) {
    if (!active) return { visible: false, action: 'none', pendingActivation, secret }
    return { visible: true, action: member?.role === 'owner' || member?.role === 'admin' ? 'manage_access' : 'comment', pendingActivation, secret }
  }
  if (!active) {
    // A public chat is listed for members who have not joined yet: title only.
    return { visible: true, action: 'view_title', pendingActivation, secret: archived ? true : secret }
  }
  return { visible: true, action: member?.role === 'owner' || member?.role === 'admin' ? 'manage_access' : 'comment', pendingActivation, secret }
}

/** Requests that carry the team-chat contract; the catalogue declares the same names. */
export const TEAM_CHAT_COMMANDS = [
  'workspaces.create',
  'im.create_chat',
  'im.join_chat',
  'im.leave_chat',
  'im.set_visibility',
  'im.browse_public_chats',
] as const

export type TeamChatCommand = (typeof TEAM_CHAT_COMMANDS)[number]

export function isTeamChatCommand(value: string): value is TeamChatCommand {
  return (TEAM_CHAT_COMMANDS as readonly string[]).includes(value)
}