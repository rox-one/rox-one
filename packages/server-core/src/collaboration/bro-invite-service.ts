/**
 * Session-scoped “Позвать Бро” service.
 *
 * Account membership is resolved server-side. Renderer-supplied IDs are
 * never treated as authorization claims.
 */

import { getCredentialManager } from '@craft-agent/shared/credentials'
import {
  BroInviteStore,
  slugifyUsername,
  type BroInviteCard,
  type JoinResult,
  type PresenceMember,
  type RoxAccount,
} from '@craft-agent/shared/collaboration'

export type AccountResolver = () => Promise<RoxAccount | null>

export async function resolveRoxAccountFromCredentials(): Promise<RoxAccount | null> {
  const session = await getCredentialManager().getRoxCloudSession()
  if (!session?.userId) return null
  const username = slugifyUsername(session.email || session.name || session.userId)
  return {
    accountId: session.userId,
    username,
    displayName: session.name || username,
  }
}

export class BroInviteService {
  constructor(
    private readonly store: BroInviteStore,
    private readonly resolveAccount: AccountResolver,
  ) {}

  async invite(
    sessionId: string,
    role: 'editor' | 'viewer' = 'editor',
  ): Promise<{ success: true; card: BroInviteCard } | { success: false; error: string; errorCode: string }> {
    const account = await this.resolveAccount()
    if (!account) {
      return { success: false, error: 'Rox account required', errorCode: 'membership_required' }
    }
    const card = this.store.createInvite({ sessionId, owner: account, role })
    return { success: true, card }
  }

  async join(url: string): Promise<JoinResult> {
    const account = await this.resolveAccount()
    return this.store.join(url, account)
  }

  async revoke(joinKey: string): Promise<{ success: boolean }> {
    const account = await this.resolveAccount()
    if (!account) return { success: false }
    return { success: this.store.revoke(joinKey, account.accountId) }
  }

  listPresence(sessionId: string): PresenceMember[] {
    return this.store.listPresence(sessionId)
  }
}

let singleton: BroInviteService | null = null

export function getBroInviteService(): BroInviteService {
  if (!singleton) {
    singleton = new BroInviteService(new BroInviteStore(), resolveRoxAccountFromCredentials)
  }
  return singleton
}

export function setBroInviteService(service: BroInviteService): void {
  singleton = service
}

export function resetBroInviteServiceForTests(): void {
  singleton = null
}
