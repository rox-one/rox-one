/**
 * MailService.status() quota mapping: server-reported usage is surfaced as-is,
 * and a server without the JMAP Quotas capability yields the 1 GiB default
 * with an explicitly unknown usage (never a faked number).
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MAILBOX_QUOTA_BYTES } from '@rox/shared/mail'
import { MailService } from '../mail-service'

const BASE = 'http://127.0.0.1:8480'

function fakeServer(opts: { quota: boolean }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchImpl = (async (input: string, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/healthz/live')) return json({ ok: true })
    if (url.endsWith('/jmap/session')) {
      const primaryAccounts: Record<string, string> = { 'urn:ietf:params:jmap:mail': 'acc' }
      if (opts.quota) primaryAccounts['urn:ietf:params:jmap:quota'] = 'acc'
      return json({ apiUrl: '/jmap/', username: 'mark@rox.one', primaryAccounts, capabilities: {} })
    }
    const { methodCalls } = JSON.parse(String(init?.body)) as { methodCalls: Array<[string, unknown, string]> }
    const responses = methodCalls.map(([name, , tag]) => [name, { list: [{ resourceType: 'octets', used: 123, hardLimit: 2 * 1024 ** 3 }] }, tag])
    return json({ methodResponses: responses })
  }) as unknown as typeof fetch
  return fetchImpl
}

function service(fetchImpl: typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(), 'rox-mail-quota-'))
  mkdirSync(join(directory, 'mail'))
  writeFileSync(join(directory, 'mail/mailboxes.json'), JSON.stringify({
    'u-1': { address: 'mark@rox.one', ownerUuid: 'u-1', state: 'READY', handle: 'mark', domain: 'rox.one', stalwartAccountId: 'a', jmapAccountId: 'acc', credentialLabel: 'test', createdAt: 0, updatedAt: 0 },
  }))
  return {
    directory,
    service: new MailService({
      configDir: directory,
      env: { ROX_MAIL_NO_AUTOSTART: '1', ROX_MAIL_SERVER_URL: BASE },
      identity: async () => ({ ownerUuid: 'u-1', handles: ['mark'] }),
      secrets: { get: async () => 'secret', put: async () => {}, delete: async () => {} },
      fetch: fetchImpl,
    }),
  }
}

describe('mail status quota', () => {
  test('reports server usage and limit when the JMAP Quotas capability is present', async () => {
    const { directory, service: mail } = service(fakeServer({ quota: true }))
    try {
      const status = await mail.status()
      expect(status.state).toBe('ready')
      expect(status.quotaBytes).toBe(2 * 1024 ** 3)
      expect(status.quotaUsedBytes).toBe(123)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('falls back to the default limit with an unknown usage when the server exposes no quota', async () => {
    const { directory, service: mail } = service(fakeServer({ quota: false }))
    try {
      const status = await mail.status()
      expect(status.state).toBe('ready')
      expect(status.quotaBytes).toBe(DEFAULT_MAILBOX_QUOTA_BYTES)
      expect(status.quotaUsedBytes).toBeNull()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})