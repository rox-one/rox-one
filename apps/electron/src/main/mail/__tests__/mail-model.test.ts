import { describe, expect, it } from 'bun:test'
import { externalRecipients, replySubject, safeFileName, sortFolders, threadHeaders, toFolder } from '../mail-model'

describe('mail-model', () => {
  it('flags recipients outside the local domain', () => {
    expect(externalRecipients(['a@rox.one', 'b@Example.com', 'c@ROX.ONE'], 'rox.one')).toEqual(['b@Example.com'])
  })
  it('prefixes subjects once', () => {
    expect(replySubject('Hello', 'reply')).toBe('Re: Hello')
    expect(replySubject('Re: Hello', 'replyAll')).toBe('Re: Hello')
    expect(replySubject('Hello', 'forward')).toBe('Fwd: Hello')
  })
  it('builds thread headers', () => {
    expect(threadHeaders({ messageId: ['m2'], references: ['m1'] })).toEqual({ inReplyTo: ['m2'], references: ['m1', 'm2'] })
  })
  it('sanitizes attachment file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFileName('')).toBe('attachment')
  })
  it('sorts role folders first', () => {
    const f = sortFolders([
      toFolder({ id: 'x', name: 'Custom', role: null, parentId: null, sortOrder: 0, totalEmails: 0, unreadEmails: 0 } as never),
      toFolder({ id: 't', name: 'Trash', role: 'trash', parentId: null, sortOrder: 0, totalEmails: 0, unreadEmails: 0 } as never),
      toFolder({ id: 'i', name: 'Inbox', role: 'inbox', parentId: null, sortOrder: 0, totalEmails: 2, unreadEmails: 1 } as never),
    ])
    expect(f[0]!.role).toBe('inbox')
    expect(f[f.length - 1]!.id).toBe('x')
  })
})
