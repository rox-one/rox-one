import { describe, expect, it } from 'bun:test'
import { postChannel, sendMail, type MailDraft } from '../mail-channels.ts'

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
    expect(sendMail(draft, 'cb-1', new Set()).status).toBe('blocked')
    expect(sendMail(draft, 'cb-1', new Set()).reason).toBe('mail-conation-unconfirmed')
    expect(postChannel(draft).status).toBe('blocked')
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
})
