import { describe, expect, it } from 'bun:test'
import type { MailMessage } from '../../../../../shared/mail-local'
import { buildDraft, draftFromMessage, emailIdFromItem, mailToInboxItem, statusKey } from '../mail-view'

const msg: MailMessage = {
  id: 'e1', threadId: 't1', folderIds: ['i'], subject: 'План', preview: 'привет', receivedAt: Date.UTC(2026, 8, 29, 12),
  from: [{ name: 'Test', email: 'test@example.com' }], to: [{ name: null, email: 'mark@rox.one' }], cc: [{ name: null, email: 'ann@rox.one' }],
  seen: false, flagged: false, draft: false, hasAttachment: false, size: 10,
  replyTo: [], bcc: [], text: 'строка 1\nстрока 2', html: null, attachments: [], messageId: ['m1'], references: [], sentAt: null,
} as unknown as MailMessage

describe('mail-view', () => {
  it('maps unread mail into inbox rows', () => {
    const item = mailToInboxItem(msg, '(без темы)')
    expect(item).toMatchObject({ id: 'mail:e1', kind: 'mail', group: 'message', title: 'План', source: 'Test' })
    expect(emailIdFromItem(item.id)).toBe('e1')
    expect(emailIdFromItem('perm:1')).toBeNull()
  })
  it('builds reply / reply-all / forward drafts', () => {
    const header = () => 'HDR'
    const reply = buildDraft('reply', msg, 'mark@rox.one', header)
    expect(reply.to).toContain('test@example.com')
    expect(reply.subject).toBe('Re: План')
    expect(reply.text).toContain('> строка 1')
    const all = buildDraft('replyAll', msg, 'mark@rox.one', header)
    expect(all.cc).toContain('ann@rox.one')
    expect(all.cc).not.toContain('mark@rox.one')
    const fwd = buildDraft('forward', msg, 'mark@rox.one', header)
    expect(fwd.to).toBe('')
    expect(fwd.subject).toBe('Fwd: План')
  })
  it('reopens drafts', () => {
    expect(draftFromMessage({ ...msg, draft: true }).draftId).toBe('e1')
  })
  it('maps status to honest keys', () => {
    expect(statusKey(null)).toBe('inbox.mail.status.loading')
    expect(statusKey({ enabled: true, state: 'ready', local: true } as never)).toBe('inbox.mail.status.readyLocal')
    expect(statusKey({ enabled: false, state: 'disabled' } as never)).toBe('inbox.mail.status.disabled')
  })
})
