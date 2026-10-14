import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JmapError } from '@rox/shared/mail'
import { MailError, MailService, errorResult, findStandardMailbox, mailErrorCode } from '../mail-service'

type Box = { id: string; name: string; role: string | null }

function service(boxes: Box[], opts: { domain?: string; refuse?: boolean } = {}) {
  const logs: string[] = []
  const calls: unknown[] = []
  const svc = new MailService({
    configDir: mkdtempSync(join(tmpdir(), 'mail-folders-')),
    env: {},
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} } as never,
    identity: async () => ({ handles: [] }),
    log: (m, e) => logs.push(`${m} ${e ?? ''}`),
  })
  const fake = {
    mailboxes: async () => boxes,
    accountId: async () => 'acc',
    call: async (c: unknown) => {
      calls.push(c)
      if (opts.refuse) return [['Mailbox/set', { notCreated: { f: { type: 'forbidden' } } }, 'f']]
      const created = { id: `new-${boxes.length}`, name: (c as any)[0][1].create.f.name, role: (c as any)[0][1].create.f.role }
      boxes.push(created)
      return [['Mailbox/set', { created: { f: { id: created.id } } }, 'f']]
    },
    flaggedCount: async () => ({ total: 0, unread: 0 }),
    outboxEmails: async () => ({ total: 0, emails: [] }),
    moveEmails: async (ids: string[]) => ({ updated: ids }),
  }
  const domain = opts.domain ?? 'rox.one'
  Object.assign(svc as object, {
    jmap: async () => fake,
    record: { address: `mark@${domain}`, handle: 'mark', domain, ownerUuid: 'u', stalwartAccountId: 's', jmapAccountId: null, state: 'READY' },
  })
  return { svc, calls, logs, boxes }
}

describe('standard mail folders', () => {
  it('matches by role first, then by localized name for role-less folders', () => {
    const boxes = [{ id: '1', name: 'Отправленные', role: null }, { id: '2', name: 'Trash', role: 'trash' }, { id: '3', name: 'Корзина', role: null }]
    expect(findStandardMailbox(boxes, 'sent')?.id).toBe('1')
    expect(findStandardMailbox(boxes, 'trash')?.id).toBe('2')
    expect(findStandardMailbox(boxes, 'archive')).toBeUndefined()
  })

  it('listing never creates folders', async () => {
    const { svc, calls } = service([{ id: 'i', name: 'Inbox', role: 'inbox' }])
    await svc.folders()
    expect(calls).toHaveLength(0)
  })

  it('reuses a user-made «Архив» instead of creating a duplicate', async () => {
    const { svc, calls } = service([{ id: 'i', name: 'Inbox', role: 'inbox' }, { id: 'a', name: 'Архив', role: null }])
    expect(await svc.move(['m'], 'archive')).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('creates a missing folder lazily, in Russian, once', async () => {
    const { svc, calls, boxes } = service([{ id: 'i', name: 'Inbox', role: 'inbox' }])
    await svc.move(['m'], 'archive')
    await svc.move(['m'], 'archive')
    expect(calls).toHaveLength(1)
    expect(boxes.find((b) => b.role === 'archive')?.name).toBe('Архив')
  })

  it('does not create folders on mailboxes Rox did not provision', async () => {
    const { svc, calls, logs } = service([{ id: 'i', name: 'Inbox', role: 'inbox' }], { domain: 'example.com' })
    await expect(svc.move(['m'], 'archive')).rejects.toThrow()
    expect(calls).toHaveLength(0)
    expect(logs.join('\n')).toContain('not Rox-provisioned')
  })

  it('logs a refused creation with its reason', async () => {
    const { svc, logs } = service([{ id: 'i', name: 'Inbox', role: 'inbox' }], { refuse: true })
    await expect(svc.move(['m'], 'trash')).rejects.toThrow()
    expect(logs.join('\n')).toContain('forbidden')
  })
})

describe('mail error codes', () => {
  it('maps failures to stable codes', () => {
    expect(mailErrorCode(new JmapError('Mail server rejected the credentials', 'auth', 401))).toBe('credential-revoked')
    expect(mailErrorCode(new JmapError('JMAP method error: overQuota', 'method'))).toBe('quota')
    expect(mailErrorCode(new JmapError('JMAP method error: notFound', 'method'))).toBe('not-found')
    expect(mailErrorCode(new MailError('external-blocked', 'x'))).toBe('external-blocked')
    expect(mailErrorCode(new Error('boom'))).toBe('error')
    expect(errorResult(new JmapError('x', 'auth', 403)).code).toBe('credential-revoked')
  })
})
