import { describe, expect, it } from 'bun:test'
import { handleVariants, isAllowedHandle, normalizeHandle, pickHandle } from '../handle'
import { JmapClient, JmapError, normalizeBaseUrl, parseAddressList, resolveSameOrigin, type FetchLike } from '../jmap-client'
import { provisionMailbox, type MailboxSecretStore } from '../provisioning'

describe('mail handle', () => {
  it('normalizes names, emails and cyrillic', () => {
    expect(normalizeHandle('Mark.Lindgreen@gmail.com')).toBe('mark.lindgreen')
    expect(normalizeHandle('Марк Линдгрин')).toBe('mark.lindgrin')
    expect(normalizeHandle('  __a..b__ ')).toBe('a.b')
    expect(normalizeHandle('ab')).toBeNull()
    expect(normalizeHandle('x'.repeat(40))!.length).toBe(32)
  })
  it('skips reserved handles and falls back', () => {
    expect(pickHandle(['admin@x.com', 'postmaster', null, 'agisota'])).toBe('agisota')
    expect(pickHandle([null, 'a'])).toBe('mark')
    expect(isAllowedHandle('support')).toBe(false)
    expect(isAllowedHandle('mark')).toBe(true)
  })
  it('generates numbered variants', () => {
    const v = [...handleVariants('mark', 3)]
    expect(v).toEqual(['mark', 'mark2', 'mark3'])
  })
})

describe('jmap helpers', () => {
  it('allows plain http only for loopback', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8480/')).toBe('http://127.0.0.1:8480')
    expect(normalizeBaseUrl('https://mail.rox.one')).toBe('https://mail.rox.one')
    expect(() => normalizeBaseUrl('http://mail.rox.one')).toThrow(JmapError)
    expect(() => normalizeBaseUrl('https://u:p@mail.rox.one')).toThrow(JmapError)
  })
  it('refuses cross-origin session URLs', () => {
    expect(resolveSameOrigin('http://127.0.0.1:8480', '/jmap/')).toBe('http://127.0.0.1:8480/jmap/')
    expect(() => resolveSameOrigin('http://127.0.0.1:8480', 'https://evil.example/jmap/')).toThrow(JmapError)
  })
  it('rejects a recipient list containing malformed addresses instead of silently dropping recipients', () => {
    expect(() => parseAddressList('valid@rox.one, invalid-address')).toThrow(/invalid email address/i)
    expect(() => parseAddressList('valid@rox.one, not-an-email@example')).toThrow(/invalid email address/i)
  })
  it('parses valid recipient lists including quoted commas', () => {
    expect(parseAddressList('"Mark L" <mark@rox.one>, test@example.com; ')).toEqual([
      { name: 'Mark L', email: 'mark@rox.one' },
      { name: null, email: 'test@example.com' },
    ])
    expect(parseAddressList('"Doe, Jane" <jane@rox.one>')).toEqual([{ name: 'Doe, Jane', email: 'jane@rox.one' }])
  })
  it('filters unread mail before applying the result limit', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/jmap/session')) {
        return new Response(JSON.stringify({ apiUrl: '/jmap/', primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account' } }), { status: 200 })
      }
      const { methodCalls } = JSON.parse(String(init?.body)) as { methodCalls: Array<[string, Record<string, any>, string]> }
      const responses = methodCalls.map(([name, args, tag]) => {
        if (name === 'Email/query') {
          const ids = args.filter.notKeyword === '$seen' ? ['older-unread'] : ['recent-read']
          return [name, { ids, total: ids.length, queryState: 'q1' }, tag]
        }
        return [name, { list: [{ id: 'older-unread', threadId: 'thread-1', mailboxIds: { inbox: true }, keywords: {}, from: [], to: [], subject: 'Unread', receivedAt: '2026-09-01T00:00:00Z', preview: '', hasAttachment: false, size: 0 }] }, tag]
      })
      return new Response(JSON.stringify({ methodResponses: responses }), { status: 200 })
    }
    const client = new JmapClient({ baseUrl: 'http://127.0.0.1:8480', username: 'mail@rox.one', secret: 'secret' }, { fetch: fetchImpl })
    const result = await client.queryEmails({ unseenOnly: true, limit: 1 })
    expect(result.emails.map((email) => email.id)).toEqual(['older-unread'])
    expect(result.total).toBe(1)
  })
  it('loads all messages in one thread in chronological order', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/jmap/session')) {
        return new Response(JSON.stringify({ apiUrl: '/jmap/', primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account' } }), { status: 200 })
      }
      const { methodCalls } = JSON.parse(String(init?.body)) as { methodCalls: Array<[string, Record<string, any>, string]> }
      const responses = methodCalls.map(([name, args, tag]) => {
        if (name === 'Thread/get') return [name, { list: [{ id: 'thread-1', emailIds: ['newer', 'older'] }] }, tag]
        if (name === 'Email/get') {
          const messages = [
            { id: 'newer', threadId: 'thread-1', receivedAt: '2026-09-02T00:00:00Z', sentAt: null },
            { id: 'older', threadId: 'thread-1', receivedAt: '2026-09-01T00:00:00Z', sentAt: null },
          ]
          return [name, { list: messages.filter((message) => args.ids.includes(message.id)) }, tag]
        }
        return [name, {}, tag]
      })
      return new Response(JSON.stringify({ methodResponses: responses }), { status: 200 })
    }
    const client = new JmapClient({ baseUrl: 'http://127.0.0.1:8480', username: 'mail@rox.one', secret: 'secret' }, { fetch: fetchImpl })
    const messages = await client.getThread('thread-1')
    expect(messages.map((message) => message.id)).toEqual(['older', 'newer'])
  })
})

/** Tiny in-memory Stalwart: session + x:Domain/x:Account/x:AppPassword. */
function fakeStalwart() {
  const accounts = new Map<string, { id: string; name: string; domainId: string; description: string; password: string; apps: string[] }>()
  let seq = 0
  const creds = (auth: string) => {
    const [user, secret] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':')
    if (user === 'admin' && secret === 'adminpw') return { user: 'admin', id: 'b' }
    const name = user!.split('@')[0]!
    const acc = [...accounts.values()].find((a) => a.name === name)
    if (acc && (acc.password === secret || acc.apps.includes(secret!))) return { user: user!, id: acc.id }
    return null
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl: FetchLike = async (url, init) => {
    const who = creds(String((init?.headers as Record<string, string>).Authorization))
    if (!who) return json({}, 401)
    if (url.endsWith('/jmap/session')) {
      return json({ apiUrl: '/jmap/', username: who.user, primaryAccounts: { 'urn:ietf:params:jmap:mail': who.id, 'urn:stalwart:jmap': who.id }, accounts: {}, capabilities: {} })
    }
    const { methodCalls } = JSON.parse(String(init?.body))
    const responses = methodCalls.map(([name, args, tag]: [string, any, string]) => {
      switch (name) {
        case 'x:Domain/get': return [name, { list: [{ id: 'd1', name: 'rox.one' }] }, tag]
        case 'x:Account/query': return [name, { ids: [...accounts.values()].filter((a) => (!args.filter.name || a.name === args.filter.name)).map((a) => a.id) }, tag]
        case 'x:Account/get': return [name, { list: args.ids.map((id: string) => accounts.get(id)) }, tag]
        case 'x:Account/set': {
          if (args.create) {
            const c = args.create.a
            const existing = [...accounts.values()].find((a) => a.name === c.name && a.domainId === c.domainId)
            if (existing) return [name, { notCreated: { a: { type: 'alreadyExists' } } }, tag]
            const id = `u${++seq}`
            accounts.set(id, { id, name: c.name, domainId: c.domainId, description: c.description, password: c.credentials['0'].secret, apps: [] })
            return [name, { created: { a: { id } } }, tag]
          }
          const [id, patch] = Object.entries(args.update)[0] as [string, any]
          accounts.get(id)!.password = patch.credentials['0'].secret
          return [name, { updated: { [id]: null } }, tag]
        }
        case 'x:AppPassword/set': {
          const secret = `app-${++seq}`
          accounts.get(who.id)!.apps.push(secret)
          return [name, { created: { p: { id: `c${seq}`, secret } } }, tag]
        }
        default: return ['error', { type: 'unknownMethod' }, tag]
      }
    })
    return json({ methodResponses: responses })
  }
  return { fetchImpl, accounts }
}

function memorySecrets(): MailboxSecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, get: async (a) => map.get(a) ?? null, put: async (a, s) => { map.set(a, s) }, delete: async (a) => { map.delete(a) } }
}

describe('provisionMailbox', () => {
  const base = { baseUrl: 'http://127.0.0.1:8480', domain: 'rox.one', deviceLabel: 'test', admin: async () => ({ username: 'admin', secret: 'adminpw' }) }

  it('creates a mailbox, stores the app password and is idempotent', async () => {
    const { fetchImpl, accounts } = fakeStalwart()
    const secrets = memorySecrets()
    const first = await provisionMailbox({ ...base, ownerUuid: 'u-1', handleCandidates: ['Mark'], secrets, fetch: fetchImpl })
    expect(first.address).toBe('mark@rox.one')
    expect(first.state).toBe('READY')
    expect(secrets.map.get('mark@rox.one')).toMatch(/^app-/)
    expect([...accounts.values()][0]!.description).toBe('rox:u-1')
    const again = await provisionMailbox({ ...base, ownerUuid: 'u-1', handleCandidates: ['Mark'], secrets, fetch: fetchImpl, existing: first })
    expect(again.address).toBe('mark@rox.one')
    expect(accounts.size).toBe(1)
  })

  it('never adopts a mailbox owned by someone else', async () => {
    const { fetchImpl, accounts } = fakeStalwart()
    await provisionMailbox({ ...base, ownerUuid: 'u-1', handleCandidates: ['mark'], secrets: memorySecrets(), fetch: fetchImpl })
    const other = await provisionMailbox({ ...base, ownerUuid: 'u-2', handleCandidates: ['mark'], secrets: memorySecrets(), fetch: fetchImpl })
    expect(other.address).toBe('mark2@rox.one')
    expect(accounts.size).toBe(2)
  })

  it('re-keys its own mailbox when the local credential is lost', async () => {
    const { fetchImpl, accounts } = fakeStalwart()
    const first = await provisionMailbox({ ...base, ownerUuid: 'u-1', handleCandidates: ['mark'], secrets: memorySecrets(), fetch: fetchImpl })
    const fresh = memorySecrets()
    const again = await provisionMailbox({ ...base, ownerUuid: 'u-1', handleCandidates: ['mark'], secrets: fresh, fetch: fetchImpl })
    expect(again.address).toBe(first.address)
    expect(fresh.map.get('mark@rox.one')).toMatch(/^app-/)
    expect(accounts.size).toBe(1)
  })
  it('reserves one unique address when different owners provision the same handle concurrently', async () => {
    const { fetchImpl, accounts } = fakeStalwart()
    const firstSecrets = memorySecrets()
    const secondSecrets = memorySecrets()
    const [first, second] = await Promise.all([
      provisionMailbox({ ...base, ownerUuid: 'u-1', handleCandidates: ['shared'], secrets: firstSecrets, fetch: fetchImpl }),
      provisionMailbox({ ...base, ownerUuid: 'u-2', handleCandidates: ['shared'], secrets: secondSecrets, fetch: fetchImpl }),
    ])
    expect(new Set([first.address, second.address]).size).toBe(2)
    expect([...accounts.values()].map((account) => account.description).sort()).toEqual(['rox:u-1', 'rox:u-2'])
  })
})
