/**
 * W1-11 (#1508) — Reference stores for the local authority and for tests.
 *
 * Two in-memory stores implementing the shapes the DDL owns
 * (`13-identity-lifecycle.sql`, `14-agent-governance.sql`):
 * - `InMemoryGovernanceStore` — `agent_binding`, `agent_grant`,
 *   `approval_policy`, `approval_request`, `standing_approval`,
 *   `rate_limit_policy`;
 * - `InMemoryIdentityStore` — `workspace` (+ `general_chat_id`,
 *   `chat_creation`), `principal` (+ `status`), `workspace_member`, `chat`
 *   (+ team-chat columns), `chat_member`, `invitation`.
 *
 * These are the **reference implementation**: the workspace authority replaces
 * them with Postgres repositories over the same DDL (wave 2, #1526ff), and
 * nothing here is stateful across processes. Rows are kept as frozen copies so
 * a handler cannot mutate the store's state by accident.
 */

import {
  AGGREGATE_SCOPE,
  DEFAULT_RATE_LIMIT_POLICY,
  RULE_ALL_SUBJECT,
  approvalPolicyForPermissionMode,
  containerMatches,
  grantMatches,
  standingApprovalMatches,
  type AgentBinding,
  type AgentBindingStatus,
  type AgentGrant,
  type AgentPermissionMode,
  type AgentScope,
  type ApprovalPolicy,
  type ApprovalRequest,
  type RateLimitBucket,
  type ScopeRequest,
  type StandingApproval,
} from '@rox/core/agents'
import {
  PENDING_ACTIVATION_CHAT_STATE,
  type ChatCreationPolicy,
  type ChatInvitePolicy,
  type ChatPostingPolicy,
  type ChatVisibility,
  type Invitation,
  type Principal,
  type PrincipalKind,
  type PrincipalStatus,
  type TeamChat,
  type TeamChatKind,
  type WorkspaceMember,
  type WorkspaceMemberRole,
  type WorkspaceMemberStatus,
} from '@rox/core/identity'

/** `workspace` row as the team-chat contract needs it (DATA-MODEL §5.11). */
export interface WorkspaceRecord {
  workspaceId: string
  name: string
  slug: string
  /** Set by `workspaces.create` in the same transaction as the chat. */
  generalChatId: string | null
  /** Workspace setting `chat_creation` (members | admins). */
  chatCreation: ChatCreationPolicy
  createdBy: string
  createdAt: string
}

export interface ChatMemberRecord {
  chatId: string
  principalId: string
  role: 'owner' | 'admin' | 'member'
  /** `chat_member.state`; placeholders are `pending_activation` until activation. */
  state: 'active' | typeof PENDING_ACTIVATION_CHAT_STATE | 'left' | 'removed'
}

/** `principal` row (01-domain-contract + the 513 columns). */
export interface PrincipalRecord extends Principal {
  /** Set by activation: the attached auth subject (`auth_subject_alias`). */
  authSubject?: string | null
}

function copy<T>(value: T): T {
  return { ...value }
}

/** Governance rows: bindings, grants, policies, approvals, limits. */
export class InMemoryGovernanceStore {
  private readonly bindings = new Map<string, AgentBinding>()
  private readonly grants = new Map<string, AgentGrant>()
  private readonly policies = new Map<string, ApprovalPolicy>()
  private readonly approvals = new Map<string, ApprovalRequest>()
  private readonly standing = new Map<string, StandingApproval>()
  private readonly pausedWorkspaces = new Set<string>()
  private readonly limits = new Map<string, readonly RateLimitBucket[]>()

  // ── agent_binding ─────────────────────────────────────────────────────────

  binding(agentPrincipalId: string): AgentBinding | null {
    const binding = this.bindings.get(agentPrincipalId)
    return binding ? copy(binding) : null
  }

  bindingOfOwner(workspaceId: string, ownerPrincipalId: string): AgentBinding | null {
    for (const binding of this.bindings.values()) {
      if (binding.workspaceId === workspaceId && binding.ownerPrincipalId === ownerPrincipalId) return copy(binding)
    }
    return null
  }

  bindingsIn(workspaceId: string): AgentBinding[] {
    return [...this.bindings.values()].filter(binding => binding.workspaceId === workspaceId).map(copy)
  }

  upsertBinding(binding: AgentBinding): void {
    this.bindings.set(binding.agentPrincipalId, copy(binding))
  }

  setBindingStatus(agentPrincipalId: string, status: AgentBindingStatus): boolean {
    const binding = this.bindings.get(agentPrincipalId)
    if (!binding) return false
    this.bindings.set(agentPrincipalId, { ...binding, status })
    return true
  }

  // ── agent_grant ───────────────────────────────────────────────────────────

  grantsOf(agentPrincipalId: string): AgentGrant[] {
    return [...this.grants.values()].filter(grant => grant.agentPrincipalId === agentPrincipalId).map(copy)
  }

  addGrant(grant: AgentGrant): void {
    this.grants.set(grant.agentGrantId, copy(grant))
  }

  revokeGrant(agentGrantId: string, revokedAt: string): boolean {
    const grant = this.grants.get(agentGrantId)
    if (!grant) return false
    this.grants.set(agentGrantId, { ...grant, revokedAt })
    return true
  }

  /** Live grants covering one scope request (step 3 of the pipeline). */
  grantsCovering(agentPrincipalId: string, request: ScopeRequest, now: Date): AgentGrant[] {
    return this.grantsOf(agentPrincipalId).filter(grant => grantMatches(grant, request, now))
  }

  // ── approval_policy ───────────────────────────────────────────────────────

  policyOf(workspaceId: string, ownerPrincipalId: string, permissionMode: AgentPermissionMode = 'ask'): ApprovalPolicy {
    const key = `${workspaceId}\u0000${ownerPrincipalId}`
    const stored = this.policies.get(key)
    return stored ? copy(stored) : approvalPolicyForPermissionMode(ownerPrincipalId, permissionMode)
  }

  setPolicy(workspaceId: string, policy: ApprovalPolicy): void {
    this.policies.set(`${workspaceId}\u0000${policy.ownerPrincipalId}`, copy(policy))
  }

  // ── approval_request ─────────────────────────────────────────────────────

  park(request: ApprovalRequest): void {
    this.approvals.set(request.approvalRequestId, { ...request, command: request.command, preview: request.preview })
  }

  approval(approvalRequestId: string): ApprovalRequest | null {
    const request = this.approvals.get(approvalRequestId)
    return request ? copy(request) : null
  }

  pendingApprovals(workspaceId: string): ApprovalRequest[] {
    return [...this.approvals.values()].filter(request => request.workspaceId === workspaceId && request.status === 'pending').map(copy)
  }

  approvalsOf(agentPrincipalId: string): ApprovalRequest[] {
    return [...this.approvals.values()].filter(request => request.agentPrincipalId === agentPrincipalId).map(copy)
  }

  updateApproval(approvalRequestId: string, patch: Partial<ApprovalRequest>): ApprovalRequest | null {
    const request = this.approvals.get(approvalRequestId)
    if (!request) return null
    const updated = { ...request, ...patch }
    this.approvals.set(approvalRequestId, updated)
    return copy(updated)
  }

  // ── standing_approval ────────────────────────────────────────────────────

  addStandingApproval(approval: StandingApproval): void {
    this.standing.set(approval.standingApprovalId, copy(approval))
  }

  standingOf(agentPrincipalId: string): StandingApproval[] {
    return [...this.standing.values()].filter(approval => approval.agentPrincipalId === agentPrincipalId).map(copy)
  }

  standingCovering(agentPrincipalId: string, request: Parameters<typeof standingApprovalMatches>[1], now: Date): StandingApproval[] {
    return this.standingOf(agentPrincipalId).filter(approval => standingApprovalMatches(approval, request, now))
  }

  revokeStandingApproval(standingApprovalId: string, revokedAt: string): boolean {
    const approval = this.standing.get(standingApprovalId)
    if (!approval) return false
    this.standing.set(standingApprovalId, { ...approval, revokedAt })
    return true
  }

  // ── workspace kill switch + rate_limit_policy ────────────────────────────

  isPauseAllAgents(workspaceId: string): boolean {
    return this.pausedWorkspaces.has(workspaceId)
  }

  setPauseAllAgents(workspaceId: string, paused: boolean): void {
    if (paused) this.pausedWorkspaces.add(workspaceId)
    else this.pausedWorkspaces.delete(workspaceId)
  }

  rateLimitPolicy(workspaceId: string): readonly RateLimitBucket[] {
    return this.limits.get(workspaceId) ?? DEFAULT_RATE_LIMIT_POLICY
  }

  setRateLimitPolicy(workspaceId: string, policy: readonly RateLimitBucket[]): void {
    this.limits.set(workspaceId, policy.map(copy))
  }
}

/** Identity rows: workspaces, principals, memberships, chats, invitations. */
export class InMemoryIdentityStore {
  private readonly workspaces = new Map<string, WorkspaceRecord>()
  private readonly principals = new Map<string, PrincipalRecord>()
  private readonly memberships = new Map<string, WorkspaceMember>()
  private readonly chats = new Map<string, TeamChat & { chatCreation?: ChatCreationPolicy }>()
  private readonly chatMembers = new Map<string, ChatMemberRecord>()
  private readonly invitations = new Map<string, Invitation>()

  // ── workspace ─────────────────────────────────────────────────────────────

  workspace(workspaceId: string): WorkspaceRecord | null {
    const workspace = this.workspaces.get(workspaceId)
    return workspace ? copy(workspace) : null
  }

  createWorkspace(record: WorkspaceRecord): void {
    this.workspaces.set(record.workspaceId, copy(record))
  }

  updateWorkspace(workspaceId: string, patch: Partial<WorkspaceRecord>): WorkspaceRecord | null {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) return null
    const updated = { ...workspace, ...patch }
    this.workspaces.set(workspaceId, updated)
    return copy(updated)
  }

  // ── principal ─────────────────────────────────────────────────────────────

  principal(principalId: string): PrincipalRecord | null {
    const principal = this.principals.get(principalId)
    return principal ? copy(principal) : null
  }

  principalByEmail(email: string): PrincipalRecord | null {
    const normalized = email.trim().toLowerCase()
    for (const principal of this.principals.values()) {
      if (principal.status === 'deactivated') continue
      if ((principal.primaryEmail ?? '').trim().toLowerCase() === normalized) return copy(principal)
    }
    return null
  }

  createPrincipal(record: PrincipalRecord): void {
    this.principals.set(record.principalId, copy(record))
  }

  updatePrincipal(principalId: string, patch: Partial<PrincipalRecord>): PrincipalRecord | null {
    const principal = this.principals.get(principalId)
    if (!principal) return null
    const updated = { ...principal, ...patch }
    this.principals.set(principalId, updated)
    return copy(updated)
  }

  allPrincipals(): PrincipalRecord[] {
    return [...this.principals.values()].map(copy)
  }

  principalsOfKind(kind: PrincipalKind, status: PrincipalStatus): PrincipalRecord[] {
    return this.allPrincipals().filter(principal => principal.kind === kind && principal.status === status)
  }

  // ── workspace_member ─────────────────────────────────────────────────────

  membershipsIn(workspaceId: string): WorkspaceMember[] {
    return [...this.memberships.values()].filter(member => member.workspaceId === workspaceId).map(copy)
  }

  /** Every membership of one principal (activation and merge iterate this). */
  membershipsOf(principalId: string): WorkspaceMember[] {
    return [...this.memberships.values()].filter(member => member.principalId === principalId).map(copy)
  }

  membership(workspaceId: string, principalId: string): WorkspaceMember | null {
    const member = this.memberships.get(`${workspaceId}\u0000${principalId}`)
    return member ? copy(member) : null
  }

  upsertMembership(member: WorkspaceMember): void {
    this.memberships.set(`${member.workspaceId}\u0000${member.principalId}`, copy(member))
  }

  setMembershipStatus(workspaceId: string, principalId: string, status: WorkspaceMemberStatus): boolean {
    const key = `${workspaceId}\u0000${principalId}`
    const member = this.memberships.get(key)
    if (!member) return false
    this.memberships.set(key, { ...member, status })
    return true
  }

  memberRoleOf(workspaceId: string, principalId: string): WorkspaceMemberRole | null {
    return this.membership(workspaceId, principalId)?.role ?? null
  }

  // ── chat (+ team-chat columns) ────────────────────────────────────────────

  chat(chatId: string): (TeamChat & { chatCreation?: ChatCreationPolicy }) | null {
    const chat = this.chats.get(chatId)
    return chat ? copy(chat) : null
  }

  chatsIn(workspaceId: string): (TeamChat & { chatCreation?: ChatCreationPolicy })[] {
    return [...this.chats.values()].filter(chat => chat.workspaceId === workspaceId).map(copy)
  }

  generalChat(workspaceId: string): TeamChat | null {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace?.generalChatId) return null
    return this.chat(workspace.generalChatId)
  }

  createChat(chat: TeamChat & { chatCreation?: ChatCreationPolicy }): void {
    this.chats.set(chat.chatId, copy(chat))
  }

  updateChat(chatId: string, patch: Partial<TeamChat>): (TeamChat & { chatCreation?: ChatCreationPolicy }) | null {
    const chat = this.chats.get(chatId)
    if (!chat) return null
    const updated = { ...chat, ...patch }
    this.chats.set(chatId, updated)
    return copy(updated)
  }

  /** Public, discoverable chats of a workspace («Обзор чатов»). */
  publicChats(workspaceId: string, options: { kind?: TeamChatKind; query?: string } = {}): TeamChat[] {
    const query = options.query?.trim().toLowerCase()
    return this.chatsIn(workspaceId)
      .filter(chat => chat.visibility === 'public' && !chat.archivedAt)
      .filter(chat => (options.kind ? chat.kind === options.kind : true))
      .filter(chat => (query ? `${chat.name ?? ''} ${chat.description ?? ''}`.toLowerCase().includes(query) : true))
      .map(copy)
  }

  // ── chat_member ──────────────────────────────────────────────────────────

  chatMember(chatId: string, principalId: string): ChatMemberRecord | null {
    const member = this.chatMembers.get(`${chatId}\u0000${principalId}`)
    return member ? copy(member) : null
  }

  chatMembersOf(chatId: string): ChatMemberRecord[] {
    return [...this.chatMembers.values()].filter(member => member.chatId === chatId).map(copy)
  }

  chatMembershipsOf(principalId: string): ChatMemberRecord[] {
    return [...this.chatMembers.values()].filter(member => member.principalId === principalId).map(copy)
  }

  upsertChatMember(member: ChatMemberRecord): void {
    this.chatMembers.set(`${member.chatId}\u0000${member.principalId}`, copy(member))
  }

  removeChatMember(chatId: string, principalId: string): boolean {
    return this.chatMembers.delete(`${chatId}\u0000${principalId}`)
  }

  /** Flip a placeholder's `pending_activation` memberships to `active`. */
  activateChatMemberships(principalId: string): number {
    let flipped = 0
    for (const member of this.chatMembershipsOf(principalId)) {
      if (member.state !== PENDING_ACTIVATION_CHAT_STATE) continue
      this.upsertChatMember({ ...member, state: 'active' })
      flipped += 1
    }
    return flipped
  }

  // ── invitation ───────────────────────────────────────────────────────────

  invitation(invitationId: string): Invitation | null {
    const invitation = this.invitations.get(invitationId)
    return invitation ? copy(invitation) : null
  }

  invitationsIn(workspaceId: string): Invitation[] {
    return [...this.invitations.values()].filter(invitation => invitation.workspaceId === workspaceId).map(copy)
  }

  pendingInvitation(workspaceId: string, email: string): Invitation | null {
    const normalized = email.trim().toLowerCase()
    for (const invitation of this.invitations.values()) {
      if (invitation.workspaceId === workspaceId && invitation.status === 'pending' && invitation.email.trim().toLowerCase() === normalized) {
        return copy(invitation)
      }
    }
    return null
  }

  createInvitation(invitation: Invitation): void {
    this.invitations.set(invitation.invitationId, copy(invitation))
  }

  updateInvitation(invitationId: string, patch: Partial<Invitation>): Invitation | null {
    const invitation = this.invitations.get(invitationId)
    if (!invitation) return null
    const updated = { ...invitation, ...patch }
    this.invitations.set(invitationId, updated)
    return copy(updated)
  }

  /** Members visible in chat listings: everything but `left` / `removed`. */
  visibleChatMembers(chatId: string): ChatMemberRecord[] {
    return this.chatMembersOf(chatId).filter(member => member.state !== 'left' && member.state !== 'removed')
  }

  chatNamesFor(chats: readonly TeamChat[]): string[] {
    return chats.map(chat => chat.name ?? chat.chatId)
  }

  memberCount(chatId: string): number {
    return this.visibleChatMembers(chatId).length
  }

  /** The role/state pair a chat-visibility check needs. */
  chatRole(chatId: string, principalId: string): ChatMemberRecord['role'] | null {
    return this.chatMember(chatId, principalId)?.role ?? null
  }

}
