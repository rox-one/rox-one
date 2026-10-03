import {
  DEFAULT_INVITE_TTL_MS,
  buildInviteCard,
  inviteStatus,
  mintJoinKey,
  parseInviteUrl,
  slugifyUsername,
  type BroInvite,
  type BroInviteCard,
  type CollaboratorRole,
  type JoinResult,
  type RoxAccount,
} from './invite.ts'
import { upsertPresence, type PresenceMember } from './presence.ts'

export interface CreateInviteInput {
  sessionId: string
  workspaceId?: string
  owner: RoxAccount
  role?: Exclude<CollaboratorRole, 'owner'>
  ttlMs?: number
}

/** Server-side invitation persistence contract; never accepts renderer account claims. */
export interface BroInviteStorage {
  createInvite(input: CreateInviteInput): BroInviteCard
  join(url: string, account: RoxAccount | null): JoinResult
  revoke(joinKey: string, actorAccountId: string): boolean
  listPresence(sessionId: string, workspaceId?: string): PresenceMember[]
  getInvite(joinKey: string): BroInvite | undefined
  close?(): void
}

export class BroInviteStore implements BroInviteStorage {
  private readonly invites = new Map<string, BroInvite>()
  private readonly presenceBySession = new Map<string, PresenceMember[]>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly randomBytes?: (n: number) => Uint8Array,
  ) {}

  createInvite(input: CreateInviteInput): BroInviteCard {
    const joinKey = mintJoinKey(this.randomBytes)
    const createdAt = this.now()
    const invite: BroInvite = {
      sessionId: input.sessionId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      ownerAccountId: input.owner.accountId,
      ownerUsername: slugifyUsername(input.owner.username),
      joinKey,
      role: input.role ?? 'editor',
      createdAt,
      expiresAt: createdAt + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS),
    }
    this.invites.set(joinKey, invite)
    this.presenceBySession.set(
      this.presenceKey(input.sessionId, input.workspaceId),
      upsertPresence(this.listPresence(input.sessionId, input.workspaceId), input.owner, 'owner', createdAt),
    )
    return buildInviteCard(invite)
  }

  join(url: string, account: RoxAccount | null): JoinResult {
    if (!account) return { ok: false, error: 'membership_required' }
    const parsed = parseInviteUrl(url)
    if (!parsed) return { ok: false, error: 'invalid' }
    const invite = this.invites.get(parsed.joinKey)
    if (!invite) return { ok: false, error: 'invalid' }
    if (invite.sessionId !== parsed.sessionId || invite.ownerUsername !== parsed.username) {
      return { ok: false, error: 'invalid' }
    }
    const status = inviteStatus(invite, this.now())
    if (status !== 'active') return { ok: false, error: status }
    invite.usedAt = this.now()
    this.presenceBySession.set(
      this.presenceKey(invite.sessionId, invite.workspaceId),
      upsertPresence(this.listPresence(invite.sessionId, invite.workspaceId), account, invite.role, this.now()),
    )
    return {
      ok: true,
      sessionId: invite.sessionId,
      role: invite.role,
      accountId: account.accountId,
      ...(invite.workspaceId === undefined ? {} : { workspaceId: invite.workspaceId }),
    }
  }

  revoke(joinKey: string, actorAccountId: string): boolean {
    const invite = this.invites.get(joinKey)
    if (!invite) return false
    if (invite.ownerAccountId !== actorAccountId) return false
    if (invite.revokedAt != null) return true
    invite.revokedAt = this.now()
    return true
  }

  private presenceKey(sessionId: string, workspaceId?: string): string {
    return JSON.stringify([workspaceId ?? '', sessionId])
  }

  listPresence(sessionId: string, workspaceId?: string): PresenceMember[] {
    return [...(this.presenceBySession.get(this.presenceKey(sessionId, workspaceId)) ?? [])]
  }

  getInvite(joinKey: string): BroInvite | undefined {
    return this.invites.get(joinKey)
  }
}
