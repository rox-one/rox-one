import {
  parseInviteUrl,
  type BroInviteCard,
  type BroInviteStorage,
  type JoinResult,
  type PresenceMember,
  type RoxAccount,
  requireSessionPublicationInput,
  type RemoteSessionProjection,
  type SessionPublicationInput,
} from '../../../../../packages/shared/src/collaboration/index.ts'
import {
  IdentityDomainError,
  type AuthenticatedActor,
} from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'

/** Supplied by the host that owns canonical sessions, never by an HTTP request. */
export interface HostedSessionScope {
  resolveSession(workspaceId: string, sessionId: string): Promise<{ ownerPrincipalId: string } | null>
  publishSession?(actor: AuthenticatedActor, workspaceId: string, sessionId: string, input: SessionPublicationInput): RemoteSessionProjection
  readProjection?(workspaceId: string, sessionId: string): Promise<RemoteSessionProjection | null>
}

export type LiveCollaborationActor = () => Promise<AuthenticatedActor>

function record(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !keys.includes(key))) throw new IdentityDomainError('INVALID_PAYLOAD')
  return body as Record<string, unknown>
}

export function requireSessionId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === '.' || value === '..') {
    throw new IdentityDomainError('INVALID_PAYLOAD')
  }
  return value
}

function account(actor: AuthenticatedActor): RoxAccount {
  // Only the verified, immutable principal is available here. Profile names
  // are intentionally not accepted as identity or owner claims from a client.
  return { accountId: actor.principalId, username: actor.principalId, displayName: actor.principalId }
}

/**
 * Central invitation admission and membership, not a transcript/editing engine.
 * All asynchronous session checks complete before a live actor is reread and
 * the synchronous store consumes its one-time token.
 */
export class WorkspaceBroInvitationAuthority {
  constructor(private readonly store: BroInviteStorage, private readonly sessions: HostedSessionScope) {}

  async publish(actor: LiveCollaborationActor, workspaceId: string, sessionId: string, body: unknown): Promise<RemoteSessionProjection> {
    requireUuid(workspaceId)
    requireSessionId(sessionId)
    let input: SessionPublicationInput
    try { input = requireSessionPublicationInput(body) } catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
    if (!this.sessions.publishSession) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    // No awaits between the final authentication check and the ownership-bound write.
    return this.sessions.publishSession(requireActor(await actor(), workspaceId), workspaceId, sessionId, input)
  }

  async projection(actor: LiveCollaborationActor, workspaceId: string, sessionId: string): Promise<RemoteSessionProjection> {
    await this.presence(actor, workspaceId, sessionId)
    if (!this.sessions.readProjection) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const projection = await this.sessions.readProjection(workspaceId, sessionId)
    await this.presence(actor, workspaceId, sessionId)
    if (!projection) throw new IdentityDomainError('NOT_FOUND')
    return projection
  }

  async invite(actor: LiveCollaborationActor, workspaceId: string, sessionId: string, body: unknown): Promise<BroInviteCard> {
    requireUuid(workspaceId)
    requireSessionId(sessionId)
    const input = record(body, ['role'])
    if (input.role !== undefined && input.role !== 'editor' && input.role !== 'viewer') {
      throw new IdentityDomainError('INVALID_PAYLOAD')
    }
    requireActor(await actor(), workspaceId)
    const session = await this.sessions.resolveSession(workspaceId, sessionId)
    const current = requireActor(await actor(), workspaceId)
    if (!session || session.ownerPrincipalId !== current.principalId) throw new IdentityDomainError('FORBIDDEN')
    return this.store.createInvite({ workspaceId, sessionId, owner: account(current), role: input.role ?? 'editor' })
  }

  async join(actor: LiveCollaborationActor, body: unknown): Promise<JoinResult> {
    const input = record(body, ['url', 'workspaceId'])
    if (typeof input.url !== 'string' || input.url.length > 2048) throw new IdentityDomainError('INVALID_PAYLOAD')
    const expectedWorkspaceId = input.workspaceId === undefined ? undefined : requireUuid(input.workspaceId)
    const parsed = parseInviteUrl(input.url)
    if (!parsed) return { ok: false, error: 'invalid' }
    const invite = this.store.getInvite(parsed.joinKey)
    // Legacy local invitations are not admitted to the remote workspace API.
    if (!invite?.workspaceId || invite.sessionId !== parsed.sessionId || invite.ownerUsername !== parsed.username) {
      return { ok: false, error: 'invalid' }
    }
    // Bind app admission to its configured authority workspace before consuming a one-time token.
    if (expectedWorkspaceId !== undefined && invite.workspaceId !== expectedWorkspaceId) return { ok: false, error: 'invalid' }
    // Scoped app joins also require an openable snapshot; legacy invitation-only clients may omit the scope.
    if (expectedWorkspaceId !== undefined && !this.sessions.readProjection) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    requireActor(await actor(), invite.workspaceId)
    const session = await this.sessions.resolveSession(invite.workspaceId, invite.sessionId)
    const projection = this.sessions.readProjection ? await this.sessions.readProjection(invite.workspaceId, invite.sessionId) : undefined
    const current = requireActor(await actor(), invite.workspaceId)
    if (!session || session.ownerPrincipalId !== invite.ownerAccountId || projection === null) return { ok: false, error: 'invalid' }
    const joined = this.store.join(input.url, account(current))
    return joined.ok && projection ? { ...joined, remoteSession: projection } : joined
  }

  async revoke(actor: LiveCollaborationActor, workspaceId: string, joinKey: string, body: unknown): Promise<{ success: boolean }> {
    requireUuid(workspaceId)
    record(body, [])
    if (!/^[a-f0-9]{32}$/.test(joinKey)) throw new IdentityDomainError('INVALID_PAYLOAD')
    const invite = this.store.getInvite(joinKey)
    const current = requireActor(await actor(), workspaceId)
    if (!invite || invite.workspaceId !== workspaceId || invite.ownerAccountId !== current.principalId) {
      throw new IdentityDomainError('FORBIDDEN')
    }
    return { success: this.store.revoke(joinKey, current.principalId) }
  }

  async presence(actor: LiveCollaborationActor, workspaceId: string, sessionId: string): Promise<PresenceMember[]> {
    requireUuid(workspaceId)
    requireSessionId(sessionId)
    requireActor(await actor(), workspaceId)
    const session = await this.sessions.resolveSession(workspaceId, sessionId)
    const current = requireActor(await actor(), workspaceId)
    const presence = this.store.listPresence(sessionId, workspaceId)
    if (!session || (session.ownerPrincipalId !== current.principalId &&
        !presence.some(member => member.accountId === current.principalId))) throw new IdentityDomainError('FORBIDDEN')
    return presence
  }
}
