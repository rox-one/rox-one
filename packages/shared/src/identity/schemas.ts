/**
 * W1-11 (#1508) — Zod validation for the identity lifecycle and team-chat
 * commands (TECH-SPEC §15.1, DATA-MODEL §5.11, D-v2-2).
 *
 * `@rox/core/identity` holds the types and the pure rules; this file validates
 * untrusted payloads (the workspace HTTP body, the RPC arguments) and lives in
 * `@rox/shared`, which already depends on zod. Every schema narrows into the
 * core type it validates, so a payload that parses is safe to hand to a
 * handler.
 */

import { z } from 'zod'
import {
  CHAT_CREATION_POLICIES,
  CHAT_INVITE_POLICIES,
  CHAT_POSTING_POLICIES,
  CHAT_VISIBILITIES,
  INVITATION_ROLES,
  PRINCIPAL_STATUSES,
  TEAM_CHAT_KINDS,
  WORKSPACE_MEMBER_ROLES,
  WORKSPACE_MEMBER_STATUSES,
  isChatCreationPolicy,
  isChatInvitePolicy,
  isChatPostingPolicy,
  isChatVisibility,
  isInvitationRole,
  isPrincipalStatus,
  isTeamChatKind,
  isWorkspaceMemberRole,
  isWorkspaceMemberStatus,
  type ActivatePlaceholderPayload,
  type BrowsePublicChatsPayload,
  type CreateChatPayload,
  type EnsurePlaceholderPayload,
  type InvitePeoplePayload,
  type JoinChatPayload,
  type LeaveChatPayload,
  type MergePlaceholderPayload,
  type SetVisibilityPayload,
} from '@rox/core/identity'

/** Ids are opaque strings to the domain; the stores own their shape. */
const idSchema = z.string().min(1).max(256)
const emailSchema = z.string().min(3).max(320).refine(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()), { message: 'not an email address' })
const textSchema = z.string().max(10_000)
const shortTextSchema = z.string().min(1).max(256)

function enumerated<T extends string>(values: readonly T[], guard: (value: unknown) => value is T, what: string) {
  return z.string().refine(guard, { message: `unknown ${what}: expected one of ${values.join(', ')}` })
}

/** `principal.status` (§5.11). */
export const principalStatusSchema = enumerated(PRINCIPAL_STATUSES, isPrincipalStatus, 'principal status')
/** `workspace_member.status` / `chat_member.state` source. */
export const workspaceMemberStatusSchema = enumerated(WORKSPACE_MEMBER_STATUSES, isWorkspaceMemberStatus, 'member status')
export const workspaceMemberRoleSchema = enumerated(WORKSPACE_MEMBER_ROLES, isWorkspaceMemberRole, 'member role')
export const invitationRoleSchema = enumerated(INVITATION_ROLES, isInvitationRole, 'invitation role')

export const inviteTargetSchema = z.object({
  kind: z.enum(['space', 'channel']),
  id: idSchema,
  role: workspaceMemberRoleSchema.optional(),
})

/** `people.invite {workspaceId, emails[], role, targets[], message?}` (§15.1). */
export const invitePeopleSchema: z.ZodType<InvitePeoplePayload> = z.object({
  workspaceId: idSchema,
  emails: z.array(emailSchema).min(1).max(100),
  role: invitationRoleSchema.optional(),
  targets: z.array(inviteTargetSchema).max(64).optional(),
  message: textSchema.optional(),
})

/** `identity.ensure_placeholder` (§5.11 rule 1). */
export const ensurePlaceholderSchema: z.ZodType<EnsurePlaceholderPayload> = z.object({
  workspaceId: idSchema,
  email: emailSchema,
  invitedBy: idSchema,
  role: invitationRoleSchema.optional(),
  targets: z.array(inviteTargetSchema).max(64).optional(),
  chatIds: z.array(idSchema).max(256).optional(),
  message: textSchema.optional(),
  sentAt: z.string().datetime().optional(),
})

/** `identity.activate_placeholder` (§5.11 rule 4). */
export const activatePlaceholderSchema: z.ZodType<ActivatePlaceholderPayload> = z.object({
  authSubject: shortTextSchema,
  verifiedEmail: emailSchema,
})

/** `identity.merge_placeholder` (§5.11 rule 6). */
export const mergePlaceholderSchema: z.ZodType<MergePlaceholderPayload> = z.object({
  placeholderId: idSchema,
  accountId: idSchema,
  confirmedBy: idSchema,
})

/** `workspaces.create {name, slug, invites?}` (§15.1). */
export const createWorkspaceSchema = z.object({
  name: shortTextSchema,
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lower-case kebab-case' }),
  invites: z.array(z.object({ email: emailSchema, role: invitationRoleSchema.optional() })).max(100).optional(),
  /** Workspace settings that ship with the team-chat contract (D-v2-2). */
  chatCreation: enumerated(CHAT_CREATION_POLICIES, isChatCreationPolicy, 'chat_creation policy').optional(),
})
export type CreateWorkspacePayload = z.infer<typeof createWorkspaceSchema>

/** `im.create_chat {kind: group|channel, visibility: public|private, …}` (D-v2-2). */
export const createChatSchema: z.ZodType<CreateChatPayload> = z.object({
  kind: enumerated(TEAM_CHAT_KINDS, isTeamChatKind, 'chat kind'),
  name: shortTextSchema.optional(),
  description: textSchema.optional(),
  visibility: enumerated(CHAT_VISIBILITIES, isChatVisibility, 'chat visibility'),
  members: z.array(idSchema).max(512).optional(),
  postingPolicy: enumerated(CHAT_POSTING_POLICIES, isChatPostingPolicy, 'posting policy').optional(),
  invitePolicy: enumerated(CHAT_INVITE_POLICIES, isChatInvitePolicy, 'invite policy').optional(),
})

export const joinChatSchema: z.ZodType<JoinChatPayload> = z.object({ chatId: idSchema })
export const leaveChatSchema: z.ZodType<LeaveChatPayload> = z.object({ chatId: idSchema })

/** `im.set_visibility`: private → public exposes history, hence the confirmation flag. */
export const setVisibilitySchema: z.ZodType<SetVisibilityPayload> = z.object({
  chatId: idSchema,
  visibility: enumerated(CHAT_VISIBILITIES, isChatVisibility, 'chat visibility'),
  confirmHistoryExposure: z.boolean().optional(),
})

/** `im.browse_public_chats` — «Обзор чатов». */
export const browsePublicChatsSchema: z.ZodType<BrowsePublicChatsPayload> = z.object({
  query: z.string().max(256).optional(),
  kind: enumerated(TEAM_CHAT_KINDS, isTeamChatKind, 'chat kind').optional(),
  cursor: idSchema.optional(),
  limit: z.number().int().positive().max(100).optional(),
})

/** One entry of the team-chat contract, keyed by the command name it validates. */
export const TEAM_CHAT_PAYLOAD_SCHEMAS = {
  'workspaces.create': createWorkspaceSchema,
  'im.create_chat': createChatSchema,
  'im.join_chat': joinChatSchema,
  'im.leave_chat': leaveChatSchema,
  'im.set_visibility': setVisibilitySchema,
  'im.browse_public_chats': browsePublicChatsSchema,
} as const

export const IDENTITY_PAYLOAD_SCHEMAS = {
  'people.invite': invitePeopleSchema,
  'identity.ensure_placeholder': ensurePlaceholderSchema,
  'identity.activate_placeholder': activatePlaceholderSchema,
  'identity.merge_placeholder': mergePlaceholderSchema,
} as const

export type CreateChatInput = z.infer<typeof createChatSchema>
export type SetVisibilityInput = z.infer<typeof setVisibilitySchema>
export type BrowsePublicChatsInput = z.infer<typeof browsePublicChatsSchema>