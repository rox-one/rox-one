/**
 * W1-11 (#1508) — Reference handlers for the identity, team-chat and agent
 * commands (TECH-SPEC §15.1, DATA-MODEL §5.11–§5.14, D-v2-2).
 *
 * These are the **reference** implementations of the frozen contracts: real
 * logic against the reference stores, wired through `COMMAND_MODULES` so the
 * local authority and the workspace service bind the same set. Wave-2 packages
 * replace a handler with one that talks to its own tables; the contracts, the
 * risk classes, the events and the receipts stay as they are here.
 *
 * Every handler:
 * - assumes the payload was validated by the bound zod schema;
 * - emits only catalogue domain events, so activity and notifications work;
 * - writes an audit row when DATA-MODEL §5.13 requires it (invitations,
 *   placeholder merges, approve/reject decisions, pauses) — the agent path is
 *   audited by the middleware instead.
 */

import { createHash, randomBytes } from 'node:crypto'
import { CommandRejection, type CommandHandlerContext, type CommandHandlerResult } from '@rox/core/commands'
import { isDomainEventType, type DomainEventDraft } from '@rox/core/events'
import {
  IDENTITY_EVENTS,
  agentDisplayHandle,
  agentDisplayName,
  canCreateChat,
  canJoinChat,
  canSetVisibility,
  dueInvitationReminder,
  generalChatDraft,
  inboxInviteCard,
  invitationExpiry,
  invitationPendingKey,
  normalizeInviteEmails,
  planPlaceholder,
  planPlaceholderActivation,
  planPlaceholderMerge,
  PERSONAL_AGENT_HANDLE,
  type ActivatePlaceholderPayload,
  type CreateChatPayload,
  type EnsurePlaceholderPayload,
  type InvitePeoplePayload,
  type MergePlaceholderPayload,
  type TeamChat,
} from '@rox/core/identity'
import type { AgentInvokePayload, DecideApprovalPayload, PauseAgentPayload, ProvisionPersonalAgentPayload } from '@rox/shared/agents/schemas'
import type { CreateWorkspacePayload } from '@rox/shared/identity/schemas'
import {
  AGENT_ALL_SUBJECT,
  APPROVAL_TTL_HOURS,
  DEFAULT_AGENT_GRANT_SCOPES,
  DEFAULT_STANDING_APPROVAL_DAYS,
  agentIsRunnable,
  standingApprovalFromApproval,
  type AgentBinding,
  type ApprovalRequest,
} from '@rox/core/agents'
import { getAgentsRuntime, type AgentsRuntime } from './runtime.ts'
import { deterministicId } from '../work/reference/engine.ts'
import type { ChatMemberRecord, PrincipalRecord, WorkspaceRecord } from './store.ts'

/** The subject an invitation audit row uses (`rate_limit_policy` naming). */
export const INVITE_SUBJECT = 'people:invite'

function events(...drafts: DomainEventDraft[]): DomainEventDraft[] {
  for (const draft of drafts) {
    if (!isDomainEventType(draft.type)) throw new CommandRejection('INTERNAL', `Handler emitted invalid event type ${draft.type}`)
  }
  return drafts
}

/** sha256 of an invitation token, as stored (`invitation.token_hash`). */
export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A fresh single-use invitation token (§15.2: 32 random bytes). */
export function newInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

/** `person:<id>` refs used by the identity handlers. */
function personRef(principalId: string) {
  return { kind: 'person' as const, id: principalId }
}

/** One audit row per DATA-MODEL §5.13 for the identity paths. */
async function writeAudit(runtime: AgentsRuntime, input: {
  workspaceId: string
  actorPrincipalId: string
  actorKind: 'human' | 'bot' | 'system' | 'rule'
  onBehalfOf?: string | null
  commandType: string
  targetRef?: string | null
  decision: 'executed' | 'proposed' | 'approved' | 'rejected' | 'expired' | 'denied' | 'rate_limited' | 'failed' | 'undone'
  riskClass: 'routine' | 'consequential' | 'privileged'
  provenance?: Record<string, unknown>
  requestHash?: string
  error?: string | null
}): Promise<void> {
  const now = runtime.now()
  await runtime.audit.append({
    auditId: runtime.newId(),
    workspaceId: input.workspaceId,
    actorPrincipalId: input.actorPrincipalId,
    actorKind: input.actorKind,
    onBehalfOf: input.onBehalfOf ?? null,
    commandType: input.commandType,
    targetRef: input.targetRef ?? null,
    decision: input.decision,
    riskClass: input.riskClass,
    provenance: input.provenance ?? {},
    requestHash: input.requestHash ?? invitationTokenHash(`${input.commandType}:${input.actorPrincipalId}:${now.toISOString()}`),
    error: input.error ?? null,
    createdAt: now.toISOString(),
  })
}

// ── workspaces.create ───────────────────────────────────────────────────────

/**
 * Create a team: the workspace, its **General** group chat and the creator as
 * admin, in one transaction (§15.1, D-v2-2). Invites are sent through
 * `people.invite` semantics and reported as `people.invitations_sent`.
 */
export async function createWorkspace(ctx: CommandHandlerContext<CreateWorkspacePayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const workspaceId = runtime.newId()
  const now = runtime.now().toISOString()

  const general = generalChatDraft(payload.name)
  const chatId = runtime.newId()
  const chat: TeamChat & { chatCreation: 'members' | 'admins' } = {
    chatId,
    workspaceId,
    kind: general.kind,
    visibility: general.visibility,
    systemRole: general.systemRole,
    name: general.name,
    description: null,
    postingPolicy: general.postingPolicy,
    invitePolicy: general.invitePolicy,
    createdBy: ctx.actor.principalId,
    archivedAt: null,
    chatCreation: payload.chatCreation ?? 'members',
  }
  const workspace: WorkspaceRecord = {
    workspaceId,
    name: payload.name,
    slug: payload.slug,
    generalChatId: chatId,
    chatCreation: payload.chatCreation ?? 'members',
    createdBy: ctx.actor.principalId,
    createdAt: now,
  }
  runtime.identity.createWorkspace(workspace)
  runtime.identity.createChat(chat)
  // The creator is an admin member and is auto-joined to General.
  runtime.identity.upsertMembership({ workspaceId, principalId: ctx.actor.principalId, role: 'admin', status: 'active', joinedAt: now })
  runtime.identity.upsertChatMember({ chatId, principalId: ctx.actor.principalId, role: 'owner', state: 'active' })

  const drafts: DomainEventDraft[] = []
  const invited: string[] = []
  for (const invite of normalizeInviteEmails((payload.invites ?? []).map(entry => entry.email)).map((email) => ({
    email,
    role: (payload.invites ?? []).find(entry => entry.email.trim().toLowerCase() === email)?.role ?? 'member' as const,
  }))) {
    const invitation = await inviteOne(runtime, {
      workspaceId,
      email: invite.email,
      invitedBy: ctx.actor.principalId,
      role: invite.role,
      chatIds: [chatId],
      message: undefined,
    })
    invited.push(invitation.principalId)
    drafts.push({ type: IDENTITY_EVENTS.placeholderCreated, subject: personRef(invitation.principalId), payload: { email: invite.email, workspaceId } })
  }
  if (invited.length > 0) drafts.push({ type: IDENTITY_EVENTS.invitationsSent, payload: { workspaceId, count: invited.length, emails: invited } })

  return {
    revision: 1,
    result: { workspaceId, generalChatId: chatId, invited },
    events: events(...drafts),
  }
}

// ── the invite path (people.invite / workspaces.create / R4) ────────────────

interface InviteOneInput {
  workspaceId: string
  email: string
  invitedBy: string
  role: 'member' | 'admin' | 'guest'
  chatIds: readonly string[]
  targets?: InvitePeoplePayload['targets']
  message?: string | undefined
  sentAt?: string
}

/**
 * §5.11 rules 1–2: an unknown email becomes a placeholder (memberships in
 * `invited` / `pending_activation`), an existing active account gets the same
 * memberships plus an Inbox card and no placeholder.
 */
async function inviteOne(runtime: AgentsRuntime, input: InviteOneInput): Promise<{ principalId: string; invitationId: string; token: string; existingAccount: boolean }> {
  const now = runtime.now()
  const sentAt = input.sentAt ?? now.toISOString()
  const existing = runtime.identity.principalByEmail(input.email)
  const plan = planPlaceholder({ email: input.email, existing, role: input.role, chatIds: input.chatIds })
  const principalId = plan.principalId ?? runtime.newId()
  if (plan.createPlaceholder) {
    runtime.identity.createPrincipal({
      principalId,
      kind: 'human',
      status: 'placeholder',
      primaryEmail: plan.email,
      invitedBy: input.invitedBy,
      displayName: plan.email,
    })
  }
  runtime.identity.upsertMembership({ workspaceId: input.workspaceId, principalId, role: plan.role === 'guest' ? 'guest' : plan.role, status: 'invited' })
  for (const step of plan.chatMemberships) {
    runtime.identity.upsertChatMember({ chatId: step.chatId, principalId, role: 'member', state: step.state })
  }
  const token = newInvitationToken()
  const invitationId = runtime.newId()
  runtime.identity.createInvitation({
    invitationId,
    workspaceId: input.workspaceId,
    email: plan.email,
    principalId,
    invitedBy: input.invitedBy,
    role: plan.role,
    targets: (input.targets ?? []).map(target => ({ ...target })),
    status: 'pending',
    message: input.message ?? null,
    sentAt,
    lastRemindedAt: null,
    expiresAt: invitationExpiry(new Date(sentAt)),
    acceptedAt: null,
    createdAt: sentAt,
    revision: 1,
  })
  // `token_hash` is the only stored form of the token (§15.2).
  runtime.identity.updateInvitation(invitationId, { revision: 1 })
  invitationTokens.set(invitationId, invitationTokenHash(token))
  return { principalId, invitationId, token, existingAccount: plan.existingAccount }
}

/**
 * Hashes of live invitation tokens, keyed by invitation. The DDL stores
 * `token_hash`; the store above keeps the raw value out of the row, so the
 * reference path keeps the hash here and verify does a constant-shape compare.
 */
export const invitationTokens = new Map<string, string>()

/** Verify a presented token against the stored hash (single use). */
export function verifyInvitationToken(invitationId: string, token: string): boolean {
  const stored = invitationTokens.get(invitationId)
  return stored !== undefined && stored === invitationTokenHash(token)
}

/** `people.invite {emails[], role, targets[], message?}` (§15.1). */
export async function invitePeople(ctx: CommandHandlerContext<InvitePeoplePayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const workspaceId = payload.workspaceId
  const workspace = runtime.identity.workspace(workspaceId)
  if (!workspace) throw new CommandRejection('NOT_FOUND', `Unknown workspace: ${workspaceId}`)
  const role = payload.role ?? 'member'
  const chatIds = workspace.generalChatId ? [workspace.generalChatId] : []
  const drafts: DomainEventDraft[] = []
  const invited: Array<{ email: string; principalId: string; existingAccount: boolean; token?: string }> = []
  for (const email of normalizeInviteEmails(payload.emails)) {
    if (runtime.identity.pendingInvitation(workspaceId, email)) continue
    const result = await inviteOne(runtime, { workspaceId, email, invitedBy: ctx.actor.principalId, role, chatIds, targets: payload.targets, message: payload.message })
    invited.push({ email, principalId: result.principalId, existingAccount: result.existingAccount, token: result.token })
    drafts.push({
      type: result.existingAccount ? IDENTITY_EVENTS.memberAdded : IDENTITY_EVENTS.placeholderCreated,
      subject: personRef(result.principalId),
      payload: { email, workspaceId, role },
    })
  }
  if (invited.length > 0) {
    drafts.push({ type: IDENTITY_EVENTS.invitationsSent, payload: { workspaceId, count: invited.length, emails: invited.map(entry => entry.email) } })
    await writeAudit(runtime, {
      workspaceId,
      actorPrincipalId: ctx.actor.principalId,
      actorKind: 'human',
      commandType: 'people.invite',
      targetRef: `workspace:${workspaceId}`,
      decision: 'executed',
      riskClass: 'privileged',
      provenance: { count: invited.length },
    })
  }
  return {
    revision: 1,
    result: { invited, cards: invited.filter(entry => entry.existingAccount).map(() => inboxInviteCard({ workspaceId, role, invitedBy: ctx.actor.principalId, targets: payload.targets ?? [] })) },
    events: events(...drafts),
  }
}

/** `identity.ensure_placeholder` — the R4 entry point (§5.11 rule 1). */
export async function ensurePlaceholder(ctx: CommandHandlerContext<EnsurePlaceholderPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  if (!runtime.identity.workspace(payload.workspaceId)) {
    throw new CommandRejection('NOT_FOUND', `Unknown workspace: ${payload.workspaceId}`)
  }
  const pending = runtime.identity.pendingInvitation(payload.workspaceId, payload.email)
  if (pending) return { ref: personRef(pending.principalId), revision: pending.revision ?? 1, result: { invitationId: pending.invitationId, reused: true } }
  const result = await inviteOne(runtime, {
    workspaceId: payload.workspaceId,
    email: payload.email,
    invitedBy: payload.invitedBy,
    role: payload.role ?? 'member',
    chatIds: payload.chatIds ?? [],
    targets: payload.targets,
    message: payload.message,
    sentAt: payload.sentAt,
  })
  await writeAudit(runtime, {
    workspaceId: payload.workspaceId,
    actorPrincipalId: ctx.actor.principalId,
    actorKind: ctx.actor.kind === 'system' ? 'system' : 'human',
    commandType: 'identity.ensure_placeholder',
    targetRef: `person:${result.principalId}`,
    decision: 'executed',
    riskClass: 'privileged',
    provenance: { email: payload.email },
  })
  return {
    ref: personRef(result.principalId),
    revision: 1,
    result: { invitationId: result.invitationId, email: payload.email, existingAccount: result.existingAccount },
    events: events(
      { type: IDENTITY_EVENTS.placeholderCreated, subject: personRef(result.principalId), payload: { email: payload.email, workspaceId: payload.workspaceId } },
      { type: IDENTITY_EVENTS.invitationSent, subject: personRef(result.principalId), payload: { email: payload.email, workspaceId: payload.workspaceId } },
    ),
  }
}

/**
 * `identity.activate_placeholder` — sign-up with the invited email attaches the
 * auth subject to the **same** principal (ids never change), flips the
 * memberships, releases the held notifications and emits
 * `people.member_added` (§5.11 rule 4, → rule R2).
 */
export async function activatePlaceholder(ctx: CommandHandlerContext<ActivatePlaceholderPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const placeholder = runtime.identity.principalByEmail(ctx.payload.verifiedEmail)
  if (!placeholder) throw new CommandRejection('NOT_FOUND', `No invitation for ${ctx.payload.verifiedEmail}`)
  const activation = planPlaceholderActivation({
    placeholder,
    verifiedEmail: ctx.payload.verifiedEmail,
    authSubject: ctx.payload.authSubject,
    memberships: runtime.identity.membershipsOf(placeholder.principalId),
    now: runtime.now(),
  })
  if ('reason' in activation) throw new CommandRejection(activation.reason === 'deactivated' ? 'EXPIRED' : 'FORBIDDEN', `Placeholder cannot be activated (${activation.reason})`)

  const flippedWorkspaces: string[] = []
  for (const membership of runtime.identity.membershipsOf(activation.principalId)) {
    if (membership.status !== 'invited') continue
    runtime.identity.setMembershipStatus(membership.workspaceId, membership.principalId, 'active')
    flippedWorkspaces.push(membership.workspaceId)
  }
  const flippedChats = runtime.identity.activateChatMemberships(activation.principalId)
  const released = runtime.notifications.release(activation.principalId)
  runtime.identity.updatePrincipal(activation.principalId, {
    status: 'active',
    activatedAt: activation.activatedAt,
    authSubject: activation.authSubject,
  })

  const drafts: DomainEventDraft[] = [
    { type: IDENTITY_EVENTS.placeholderActivated, subject: personRef(activation.principalId), payload: { workspaces: flippedWorkspaces, chats: flippedChats } },
  ]
  for (const workspaceId of flippedWorkspaces) {
    drafts.push({ type: IDENTITY_EVENTS.memberAdded, payload: { workspaceId, principalId: activation.principalId, released: released.length } })
  }
  await writeAudit(runtime, {
    workspaceId: flippedWorkspaces[0] ?? '',
    actorPrincipalId: activation.principalId,
    actorKind: 'system',
    commandType: 'identity.activate_placeholder',
    targetRef: `person:${activation.principalId}`,
    decision: 'executed',
    riskClass: 'privileged',
    provenance: { authSubject: ctx.payload.authSubject, releasedNotifications: released.length },
  })
  return {
    ref: personRef(activation.principalId),
    revision: 1,
    result: { principalId: activation.principalId, workspaces: flippedWorkspaces, chats: flippedChats, releasedNotifications: released.length },
    events: events(...drafts),
  }
}

/** `identity.merge_placeholder` — admin-confirmed and audited (§5.11 rule 6). */
export async function mergePlaceholder(ctx: CommandHandlerContext<MergePlaceholderPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const placeholder = runtime.identity.principal(payload.placeholderId)
  const account = runtime.identity.principal(payload.accountId)
  if (!placeholder || !account) throw new CommandRejection('NOT_FOUND', 'Unknown placeholder or account')
  const plan = planPlaceholderMerge({ placeholder, account, confirmedBy: payload.confirmedBy })
  if ('ok' in plan) throw new CommandRejection('FORBIDDEN', `Placeholder cannot be merged (${plan.reason})`)

  // Re-point the memberships and the chat memberships, in the batch order of
  // PLACEHOLDER_MERGE_COLLECTIONS, then deactivate the placeholder.
  const repointed: string[] = []
  const workspaceIds: string[] = []
  for (const membership of runtime.identity.membershipsOf(plan.placeholderId)) {
    const existing = runtime.identity.membership(membership.workspaceId, plan.accountId)
    runtime.identity.upsertMembership(existing ?? { ...membership, principalId: plan.accountId })
    repointed.push(`workspace_member:${membership.workspaceId}`)
    workspaceIds.push(membership.workspaceId)
  }
  for (const chatMember of runtime.identity.chatMembershipsOf(plan.placeholderId)) {
    runtime.identity.removeChatMember(chatMember.chatId, plan.placeholderId)
    const existing: ChatMemberRecord | null = runtime.identity.chatMember(chatMember.chatId, plan.accountId)
    if (!existing || existing.state !== 'active') {
      runtime.identity.upsertChatMember({ ...chatMember, principalId: plan.accountId, state: 'active' })
    }
    repointed.push(`chat_member:${chatMember.chatId}`)
  }
  runtime.identity.updatePrincipal(plan.placeholderId, { status: 'deactivated', mergedInto: plan.accountId })
  await writeAudit(runtime, {
    workspaceId: workspaceIds[0] ?? '',
    actorPrincipalId: ctx.actor.principalId,
    actorKind: 'human',
    onBehalfOf: null,
    commandType: 'identity.merge_placeholder',
    targetRef: `person:${plan.accountId}`,
    decision: 'executed',
    riskClass: 'privileged',
    provenance: { placeholderId: plan.placeholderId, collections: plan.collections },
  })
  return {
    ref: personRef(plan.accountId),
    revision: 1,
    result: { placeholderId: plan.placeholderId, accountId: plan.accountId, collections: plan.collections, repointed },
    events: events({ type: IDENTITY_EVENTS.placeholderMerged, subject: personRef(plan.accountId), payload: { placeholderId: plan.placeholderId, accountId: plan.accountId } }),
  }
}

// ── team chats (D-v2-2) ────────────────────────────────────────────────────

function chatRef(chatId: string) {
  return { kind: 'channel' as const, id: chatId }
}

/** Membership role of the actor in a workspace, for the creation/visibility gates. */
function memberRole(runtime: AgentsRuntime, workspaceId: string, principalId: string) {
  return runtime.identity.membership(workspaceId, principalId)
}

/** `im.create_chat {kind: group|channel, visibility: public|private, …}`. */
export async function createChat(ctx: CommandHandlerContext<CreateChatPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const workspaceId = workspaceOfActor(runtime, ctx)
  const workspace = runtime.identity.workspace(workspaceId)
  if (!workspace) throw new CommandRejection('NOT_FOUND', `Unknown workspace: ${workspaceId}`)
  const membership = memberRole(runtime, workspaceId, ctx.actor.principalId)
  const permission = canCreateChat({
    role: membership?.role ?? null,
    status: membership?.status ?? 'removed',
    chatCreation: workspace.chatCreation,
  })
  if (!permission.allowed) throw new CommandRejection('FORBIDDEN', `Cannot create a chat (${permission.reason})`)
  if (payload.kind === 'channel' && !payload.name) throw new CommandRejection('VALIDATION', 'A channel needs a name')

  const chatId = runtime.newId()
  const chat: TeamChat = {
    chatId,
    workspaceId,
    kind: payload.kind,
    visibility: payload.visibility,
    systemRole: null,
    ...(payload.name ? { name: payload.name } : {}),
    description: payload.description ?? null,
    postingPolicy: payload.postingPolicy ?? 'all',
    invitePolicy: payload.invitePolicy ?? 'members',
    createdBy: ctx.actor.principalId,
    archivedAt: null,
  }
  runtime.identity.createChat(chat)
  runtime.identity.upsertChatMember({ chatId, principalId: ctx.actor.principalId, role: 'owner', state: 'active' })
  for (const principalId of payload.members ?? []) {
    if (principalId === ctx.actor.principalId) continue
    runtime.identity.upsertChatMember({ chatId, principalId, role: 'member', state: 'active' })
  }
  return {
    ref: chatRef(chatId),
    revision: 1,
    result: { chatId, kind: chat.kind, visibility: chat.visibility, members: runtime.identity.memberCount(chatId) },
    events: events({ type: 'im.chat.updated_v1', subject: chatRef(chatId), payload: { chatId, kind: chat.kind, visibility: chat.visibility, created: true } }),
  }
}

/** `im.join_chat` — public chats only; a private chat answers FORBIDDEN (§15.1). */
export async function joinChat(ctx: CommandHandlerContext<{ chatId: string }>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const chat = runtime.identity.chat(ctx.payload.chatId)
  if (!chat) throw new CommandRejection('NOT_FOUND', `Unknown chat: ${ctx.payload.chatId}`)
  if (!canJoinChat({ visibility: chat.visibility, archived: Boolean(chat.archivedAt) })) {
    throw new CommandRejection('FORBIDDEN', 'A private chat is invite-only')
  }
  const membership = memberRole(runtime, chat.workspaceId, ctx.actor.principalId)
  if (!membership || membership.status !== 'active') throw new CommandRejection('FORBIDDEN', 'Only active members may join a chat')
  runtime.identity.upsertChatMember({ chatId: chat.chatId, principalId: ctx.actor.principalId, role: 'member', state: 'active' })
  return {
    ref: chatRef(chat.chatId),
    revision: 1,
    result: { chatId: chat.chatId, joined: true },
    events: events({ type: 'im.chat.member.user.added_v1', subject: chatRef(chat.chatId), payload: { chatId: chat.chatId, principalId: ctx.actor.principalId } }),
  }
}

/** `im.leave_chat` — self-leave; the General chat keeps its members. */
export async function leaveChat(ctx: CommandHandlerContext<{ chatId: string }>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const chat = runtime.identity.chat(ctx.payload.chatId)
  if (!chat) throw new CommandRejection('NOT_FOUND', `Unknown chat: ${ctx.payload.chatId}`)
  if (chat.systemRole === 'general') throw new CommandRejection('FORBIDDEN', 'Every active member stays in the General chat')
  const member = runtime.identity.chatMember(chat.chatId, ctx.actor.principalId)
  if (!member) throw new CommandRejection('NOT_FOUND', 'Not a member of this chat')
  runtime.identity.upsertChatMember({ ...member, state: 'left' })
  return {
    ref: chatRef(chat.chatId),
    revision: 1,
    result: { chatId: chat.chatId, left: true },
    events: events({ type: 'im.chat.member.user.deleted_v1', subject: chatRef(chat.chatId), payload: { chatId: chat.chatId, principalId: ctx.actor.principalId } }),
  }
}

/** `im.set_visibility` — owner/admin, confirmation for private → public (§15.1). */
export async function setChatVisibility(ctx: CommandHandlerContext<{ chatId: string; visibility: 'public' | 'private'; confirmHistoryExposure?: boolean }>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const chat = runtime.identity.chat(payload.chatId)
  if (!chat) throw new CommandRejection('NOT_FOUND', `Unknown chat: ${payload.chatId}`)
  const membership = memberRole(runtime, chat.workspaceId, ctx.actor.principalId)
  const permission = canSetVisibility({ chat, role: membership?.role ?? null })
  if (!permission.allowed) throw new CommandRejection('FORBIDDEN', `Cannot change the visibility (${permission.reason})`)
  if (permission.requiresConfirmation && payload.confirmHistoryExposure !== true) {
    throw new CommandRejection('VALIDATION', 'Switching to public exposes the chat history; the confirmation is required')
  }
  runtime.identity.updateChat(chat.chatId, { visibility: payload.visibility })
  return {
    ref: chatRef(chat.chatId),
    revision: 1,
    result: { chatId: chat.chatId, visibility: payload.visibility, privileged: permission.privileged },
    events: events({ type: 'im.chat.updated_v1', subject: chatRef(chat.chatId), payload: { chatId: chat.chatId, visibility: payload.visibility } }),
  }
}

/** `im.browse_public_chats` — «Обзор чатов» (public, discoverable chats). */
export async function browsePublicChats(ctx: CommandHandlerContext<{ query?: string; kind?: 'group' | 'channel'; cursor?: string; limit?: number }>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const workspaceId = workspaceOfActor(runtime, ctx)
  const membership = memberRole(runtime, workspaceId, ctx.actor.principalId)
  if (!membership || membership.status !== 'active') throw new CommandRejection('FORBIDDEN', 'Only active members may browse chats')
  const limit = ctx.payload.limit ?? 50
  const chats = runtime.identity.publicChats(workspaceId, {
    ...(ctx.payload.kind ? { kind: ctx.payload.kind } : {}),
    ...(ctx.payload.query ? { query: ctx.payload.query } : {}),
  })
  return {
    result: {
      chats: chats.slice(0, limit),
      nextCursor: chats.length > limit ? chats[limit - 1]?.chatId ?? null : null,
    },
  }
}

/**
 * The workspace a command acts in: the envelope target's workspace when the
 * caller named a chat, the payload's `workspaceId`, else the actor's only
 * active workspace (the local single-workspace case).
 */
function workspaceOfActor(runtime: AgentsRuntime, ctx: CommandHandlerContext<unknown>): string {
  const payload = ctx.payload as { workspaceId?: unknown }
  if (typeof payload.workspaceId === 'string') return payload.workspaceId
  const chatId = (payload as { chatId?: unknown }).chatId
  if (typeof chatId === 'string') {
    const chat = runtime.identity.chat(chatId)
    if (chat) return chat.workspaceId
  }
  const memberships = runtime.identity.membershipsOf(ctx.actor.principalId)
  // An active membership wins; a non-active one still identifies the workspace,
  // so the handler answers FORBIDDEN (not NOT_FOUND) for a placeholder.
  return memberships.find(membership => membership.status === 'active')?.workspaceId ?? memberships[0]?.workspaceId ?? ''
}

// ── agents (§13) ───────────────────────────────────────────────────────────

/**
 * `agents.provision_personal_agent` — idempotent per (workspace, owner): a
 * second call returns the existing binding (§5.12, rules R2/R3 call it).
 */
export async function provisionPersonalAgent(ctx: CommandHandlerContext<ProvisionPersonalAgentPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const existing = runtime.governance.bindingOfOwner(payload.workspaceId, payload.ownerPrincipalId)
  if (existing) return { ref: personRef(existing.agentPrincipalId), revision: 1, result: { agentPrincipalId: existing.agentPrincipalId, created: false } }

  // The personal agent's principal id is deterministic per (workspace, owner):
  // the automation rules (W1-12 R2/R3) plan the agent DM and the welcome actor
  // from the pre-provision id (`rules/host.ts` `localAgentId`), so provisioning
  // must land on that same id for both orderings (R2-then-R3 and R3-then-R2) to
  // address one agent and one DM.
  const agentPrincipalId = deterministicId(payload.workspaceId, 'agent', payload.ownerPrincipalId)
  const now = runtime.now().toISOString()
  runtime.identity.createPrincipal({
    principalId: agentPrincipalId,
    kind: 'bot',
    status: 'active',
    displayName: agentDisplayName(payload.ownerDisplayName ?? null),
  })
  const displayHandle = payload.username ? agentDisplayHandle(payload.username) : PERSONAL_AGENT_HANDLE
  const binding: AgentBinding = {
    agentPrincipalId,
    workspaceId: payload.workspaceId,
    ownerPrincipalId: payload.ownerPrincipalId,
    handle: PERSONAL_AGENT_HANDLE,
    displayName: agentDisplayName(payload.ownerDisplayName ?? null),
    displayHandle,
    runtime: 'omp',
    dmChatId: null,
    status: 'active',
    policyId: null,
  }
  runtime.governance.upsertBinding(binding)
  // The owner ↔ agent DM (rule R3) is an ordinary p2p chat row.
  const dmChatId = runtime.newId()
  runtime.identity.createChat({
    chatId: dmChatId,
    workspaceId: payload.workspaceId,
    kind: 'group',
    visibility: 'private',
    systemRole: null,
    name: displayHandle,
    createdBy: payload.ownerPrincipalId,
    archivedAt: null,
    postingPolicy: 'all',
    invitePolicy: 'members',
  })
  runtime.identity.upsertChatMember({ chatId: dmChatId, principalId: payload.ownerPrincipalId, role: 'owner', state: 'active' })
  runtime.identity.upsertChatMember({ chatId: dmChatId, principalId: agentPrincipalId, role: 'member', state: 'active' })
  runtime.governance.upsertBinding({ ...binding, dmChatId })
  // Default grants: the routines an agent may run without an approval. Every
  // other scope is granted explicitly by the owner (§5.14).
  for (const [index, scope] of DEFAULT_AGENT_GRANT_SCOPES.entries()) {
    runtime.governance.addGrant({
      agentGrantId: `grant-${agentPrincipalId}-${index}`,
      workspaceId: payload.workspaceId,
      agentPrincipalId,
      scope,
      selector: {},
      grantedBy: payload.ownerPrincipalId,
      createdAt: now,
    })
  }
  return {
    ref: personRef(agentPrincipalId),
    revision: 1,
    result: { agentPrincipalId, dmChatId, created: true, grants: [...DEFAULT_AGENT_GRANT_SCOPES] },
    events: events({ type: 'agents.agent_provisioned', subject: personRef(agentPrincipalId), payload: { workspaceId: payload.workspaceId, ownerPrincipalId: payload.ownerPrincipalId, handle: displayHandle } }),
  }
}

/**
 * `agents.invoke` — §13.1: the invocation is handed to the existing runtime
 * (`SessionManager` / `ExecutionCoordinator`); the handler never spawns one.
 * A host that has not wired the port gets `UNAVAILABLE`, so nothing pretends
 * to run.
 */
export async function invokeAgent(ctx: CommandHandlerContext<AgentInvokePayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const binding = runtime.governance.binding(payload.agentPrincipalId)
  if (!binding || binding.workspaceId !== payload.workspaceId) throw new CommandRejection('NOT_FOUND', 'Unknown agent for this workspace')
  if (!agentIsRunnable(binding)) throw new CommandRejection('DENIED', `Agent is ${binding.status}`)
  if (binding.ownerPrincipalId !== payload.ownerPrincipalId) throw new CommandRejection('FORBIDDEN', 'The agent belongs to another owner')
  if (!runtime.invocation) {
    throw new CommandRejection('UNAVAILABLE', 'No agent runtime is wired in this build (agents.autonomy.v1 + the OMP session path)')
  }
  const invocation = await runtime.invocation.invoke({
    workspaceId: payload.workspaceId,
    agentPrincipalId: payload.agentPrincipalId,
    ownerPrincipalId: payload.ownerPrincipalId,
    instruction: payload.instruction,
    trigger: payload.provenance.trigger,
    ...(payload.provenance.sessionId ? { sessionId: payload.provenance.sessionId } : {}),
    ...(payload.provenance.messageRef ? { messageRef: payload.provenance.messageRef } : {}),
    ...(payload.provenance.ruleId ? { ruleId: payload.provenance.ruleId } : {}),
    envelope: ctx.envelope,
  })
  return {
    ref: { kind: 'session', id: invocation.sessionId },
    revision: 1,
    result: { sessionId: invocation.sessionId, created: invocation.created, messageRef: invocation.messageRef ?? null },
    events: events({ type: 'agents.agent_action_executed', subject: personRef(payload.agentPrincipalId), payload: { sessionId: invocation.sessionId, trigger: payload.provenance.trigger } }),
  }
}

/**
 * `agents.decide_approval` — the owner's decision (§13.3). A pending request
 * past its expiry answers `EXPIRED`; approving dispatches the stored envelope
 * unchanged (same `commandId`), remembers a standing approval when asked, and
 * writes the `approved` / `rejected` audit row.
 */
export async function decideApproval(ctx: CommandHandlerContext<DecideApprovalPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const request = runtime.governance.approval(payload.approvalRequestId)
  if (!request) throw new CommandRejection('NOT_FOUND', `Unknown approval request: ${payload.approvalRequestId}`)
  if (request.ownerPrincipalId !== ctx.actor.principalId) throw new CommandRejection('FORBIDDEN', 'Only the owner decides this request')
  const now = runtime.now()
  if (request.status !== 'pending') throw new CommandRejection('VALIDATION', `Request is already ${request.status}`)
  if (Date.parse(request.expiresAt) <= now.getTime()) {
    runtime.governance.updateApproval(request.approvalRequestId, { status: 'expired', decidedAt: now.toISOString() })
    await writeAudit(runtime, {
      workspaceId: request.workspaceId,
      actorPrincipalId: ctx.actor.principalId,
      actorKind: 'human',
      commandType: 'agents.decide_approval',
      targetRef: `decision:${request.approvalRequestId}`,
      decision: 'expired',
      riskClass: request.riskClass,
      error: 'approval expired',
    })
    throw new CommandRejection('EXPIRED', 'The approval request expired (24 h)')
  }

  const approved = payload.decision === 'approve'
  const effective: ApprovalRequest = {
    ...request,
    status: approved ? 'approved' : 'rejected',
    decidedBy: ctx.actor.principalId,
    decidedAt: now.toISOString(),
    remember: payload.remember ? { standing: true, ...(payload.remember.container ? { selector: { container: payload.remember.container } } : {}), ...(payload.remember.until ? { until: payload.remember.until } : {}) } : null,
  }
  runtime.governance.updateApproval(request.approvalRequestId, effective)

  const drafts: DomainEventDraft[] = [
    { type: 'agents.approval_decided', subject: { kind: 'decision', id: request.approvalRequestId }, payload: { approved, approvalRequestId: request.approvalRequestId } },
  ]
  let standingApprovalId: string | null = null
  if (approved && payload.remember?.standing) {
    const standing = standingApprovalFromApproval(effective, {
      standingApprovalId: runtime.newId(),
      scope: scopeOfApproval(runtime, effective),
      ...(payload.remember.container ? { container: payload.remember.container } : {}),
      now,
    })
    if (standing) {
      runtime.governance.addStandingApproval(standing)
      standingApprovalId = standing.standingApprovalId
      drafts.push({ type: 'agents.standing_approval_created', subject: personRef(standing.agentPrincipalId), payload: { standingApprovalId: standing.standingApprovalId, scope: standing.scope, expiresAt: standing.expiresAt ?? null } })
    }
  }

  let receipt = null
  if (approved) {
    if (!runtime.dispatchApproved) throw new CommandRejection('UNAVAILABLE', 'No command dispatcher is wired to execute an approved request')
    const envelope = effective.command
    const dispatched = await runtime.dispatchApproved.dispatch(envelope as never)
    receipt = dispatched
    runtime.governance.updateApproval(request.approvalRequestId, { status: dispatched.status === 'applied' || dispatched.status === 'duplicate' ? 'executed' : 'failed' })
  }
  await writeAudit(runtime, {
    workspaceId: request.workspaceId,
    actorPrincipalId: ctx.actor.principalId,
    actorKind: 'human',
    onBehalfOf: request.agentPrincipalId,
    commandType: 'agents.decide_approval',
    targetRef: `decision:${request.approvalRequestId}`,
    decision: approved ? 'approved' : 'rejected',
    riskClass: request.riskClass,
    provenance: { approvalRequestId: request.approvalRequestId, standingApprovalId },
  })
  return {
    ref: { kind: 'decision', id: request.approvalRequestId },
    revision: 1,
    result: { approvalRequestId: request.approvalRequestId, approved, standingApprovalId, receipt },
    events: events(...drafts),
  }
}

/** The scope a parked request belongs to (its preview carries it). */
function scopeOfApproval(runtime: AgentsRuntime, request: ApprovalRequest): Parameters<typeof standingApprovalFromApproval>[1]['scope'] {
  const preview = request.preview as { scope?: unknown } | null
  const scope = preview && typeof preview.scope === 'string' ? preview.scope : null
  return (scope ?? 'tasks:create') as Parameters<typeof standingApprovalFromApproval>[1]['scope']
}

/** `agents.pause` — the kill switch on one agent (§13.2 step 1). */
export async function pauseAgent(ctx: CommandHandlerContext<PauseAgentPayload>): Promise<CommandHandlerResult> {
  const runtime = getAgentsRuntime()
  const payload = ctx.payload
  const binding = runtime.governance.binding(payload.agentPrincipalId)
  if (!binding) throw new CommandRejection('NOT_FOUND', `Unknown agent: ${payload.agentPrincipalId}`)
  const status = payload.paused ? 'paused' : 'active'
  runtime.governance.setBindingStatus(payload.agentPrincipalId, status)
  await writeAudit(runtime, {
    workspaceId: binding.workspaceId,
    actorPrincipalId: ctx.actor.principalId,
    actorKind: 'human',
    onBehalfOf: null,
    commandType: 'agents.pause',
    targetRef: `person:${payload.agentPrincipalId}`,
    decision: 'executed',
    riskClass: 'consequential',
    provenance: { status },
  })
  return {
    ref: personRef(payload.agentPrincipalId),
    revision: 1,
    result: { agentPrincipalId: payload.agentPrincipalId, status },
    events: events({ type: 'agents.agent_paused', subject: personRef(payload.agentPrincipalId), payload: { status } }),
  }
}

/**
 * Exports the wave-2 consumers (rules R2/R4 and the onboarding flows) reuse, so
 * an invitation created by a rule follows exactly the same path as one created
 * by `people.invite`.
 */
export { inviteOne as inviteOneReference, invitationPendingKey, dueInvitationReminder, APPROVAL_TTL_HOURS, DEFAULT_STANDING_APPROVAL_DAYS, AGENT_ALL_SUBJECT }
export type { PrincipalRecord, WorkspaceRecord }