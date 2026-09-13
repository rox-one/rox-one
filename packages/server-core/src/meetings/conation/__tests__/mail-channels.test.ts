import { describe, expect, it } from 'bun:test'
import { isLiveVerified } from '../../types.ts'
import {
  liveChannelPostEnabled,
  liveMailEnabled,
  postChannel,
  presentMailWrite,
  sendMail,
  type MailDraft,
} from '../mail-channels.ts'

const draft: MailDraft = {
  id: 'd1',
  threadId: 'th1',
  to: ['a@example.com'],
  approvedTo: ['a@example.com'],
  attachments: ['file-1'],
  approvedAttachments: ['file-1'],
  includesPrivateNote: false,
}

describe('mail-channels (#380) fail-closed', () => {
  it('does not claim live Mail/Channel Conation', () => {
    expect(liveMailEnabled()).toBe(false)
    expect(liveChannelPostEnabled()).toBe(false)
    expect(sendMail(draft, 'cb-1', new Set()).status).toBe('blocked')
    expect(sendMail(draft, 'cb-1', new Set()).reason).toBe('mail-conation-unconfirmed')
    expect(sendMail(draft, 'cb-1', new Set()).live).toBe(false)
    expect(sendMail(draft, 'cb-1', new Set()).evidenceLevel).toBe('U1')
    expect(isLiveVerified(sendMail(draft, 'cb-1', new Set()))).toBe(false)
    expect(postChannel(draft).status).toBe('blocked')
    expect(postChannel(draft).reason).toBe('channel-conation-unconfirmed')
    expect(postChannel(draft).live).toBe(false)
  })

  it('would still deny changed recipient / private notes / revoked grant if live opened', () => {
    expect(draft.to).toEqual(draft.approvedTo)
    expect(
      sendMail({ ...draft, to: ['b@example.com'] }, 'cb-2', new Set()).status,
    ).toBe('blocked')
    expect(
      sendMail({ ...draft, includesPrivateNote: true }, 'cb-3', new Set()).status,
    ).toBe('blocked')
    expect(
      sendMail({ ...draft, grantExpired: true }, 'cb-4', new Set()).status,
    ).toBe('blocked')
  })

  it('UI presentation stays blocked even if a write result looks verified', () => {
    const honest = presentMailWrite(sendMail(draft, 'cb-5', new Set()))
    expect(honest.appearance).toBe('blocked')
    expect(honest.live).toBe(false)
    expect(honest.evidenceLevel).toBe('U1')
    expect(honest.l4).toBe('not_run')

    const lie = presentMailWrite({
      status: 'verified',
      reason: 'sent',
      live: true,
      evidenceLevel: 'L4',
    })
    expect(lie.appearance).toBe('blocked')
    expect(lie.live).toBe(false)
    expect(lie.l4).toBe('not_run')
    expect(lie.status).not.toBe('verified')
  })
})
