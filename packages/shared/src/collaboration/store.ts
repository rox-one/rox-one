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
  owner: RoxAccount
  role?: Exclude<CollaboratorRole, 'owner'>
  ttlMs?: number
}

export class BroInviteStore {
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
      ownerAccountId: input.owner.accountId,
      ownerUsername: slugifyUsername(input.owner.username),
      joinKey,
      role: input.role ?? 'editor',
      createdAt,
      expiresAt: createdAt + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS),
    }
    this.invites.set(joinKey, invite)
    this.presenceBySession.set(
      input.sessionId,
      upsertPresence(this.listPresence(input.sessionId), input.owner, 'owner', createdAt),
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
      invite.sessionId,
      upsertPresence(this.listPresence(invite.sessionId), account, invite.role, this.now()),
    )
    return {
      ok: true,
      sessionId: invite.sessionId,
      role: invite.role,
      accountId: account.accountId,
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

  listPresence(sessionId: string): PresenceMember[] {
    return [...(this.presenceBySession.get(sessionId) ?? [])]
  }

  getInvite(joinKey: string): BroInvite | undefined {
    return this.invites.get(joinKey)
  }
}
