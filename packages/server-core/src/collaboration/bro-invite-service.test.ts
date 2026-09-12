import { describe, expect, it } from 'bun:test'
import { BroInviteStore, type RoxAccount } from '@craft-agent/shared/collaboration'
import { BroInviteService } from './bro-invite-service.ts'

const owner: RoxAccount = {
  accountId: 'acc_owner',
  username: 'ada',
  displayName: 'Ada',
}

describe('BroInviteService membership', () => {
  it('refuses invite and join without a Rox account', async () => {
    const service = new BroInviteService(new BroInviteStore(() => 1), async () => null)
    const invited = await service.invite('sess-1')
    expect(invited.success).toBe(false)
    if (!invited.success) expect(invited.errorCode).toBe('membership_required')
    const joined = await service.join('https://bro.rox.one/@ada/sess-1/' + 'ab'.repeat(16))
    expect(joined).toEqual({ ok: false, error: 'membership_required' })
  })

  it('issues a one-time invite card for an authenticated owner', async () => {
    const service = new BroInviteService(new BroInviteStore(() => 1), async () => owner)
    const invited = await service.invite('sess-1', 'viewer')
    expect(invited.success).toBe(true)
    if (invited.success) {
      expect(invited.card.kind).toBe('collaboration')
      expect(invited.card.role).toBe('viewer')
      expect(invited.card.url).toContain('https://bro.rox.one/@ada/sess-1/')
    }
  })
})
