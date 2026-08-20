import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount } from '@craft-agent/shared/credentials'
import {
  CapabilityBroker,
  capabilityAuditPath,
  capabilityRevokeStorePath,
  getCapabilityBroker,
  parseSecretsUseAccount,
  resetCapabilityBroker,
  SECRETS_USE_PREFIX,
  urlMatchesAllowlistPrefix,
} from '../capability-broker'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

afterEach(() => {
  resetCapabilityBroker()
})

function mockGetCredential(store: Record<string, string>) {
  return async (id: CredentialId): Promise<StoredCredential | null> => {
    const key = credentialIdToAccount(id)
    const value = store[key]
    if (!value) return null
    return { value }
  }
}

describe('parseSecretsUseAccount', () => {
  it('accepts preferred credentialIdToAccount form', () => {
    expect(parseSecretsUseAccount('secrets.use:source_bearer::ws::src')).toBe(
      'source_bearer::ws::src',
    )
    expect(parseSecretsUseAccount('secrets.use:source_apikey::ws::api1')).toBe(
      'source_apikey::ws::api1',
    )
  })

  it('maps mcp/api shorthand heuristics', () => {
    expect(parseSecretsUseAccount('secrets.use:mcp::ws::slug')).toBe(
      'source_bearer::ws::slug',
    )
    expect(parseSecretsUseAccount('secrets.use:api::ws::slug')).toBe(
      'source_apikey::ws::slug',
    )
  })

  it('rejects empty / garbage', () => {
    expect(parseSecretsUseAccount('network.request')).toBeNull()
    expect(parseSecretsUseAccount('secrets.use:')).toBeNull()
    expect(parseSecretsUseAccount('secrets.use:not-a-real-type::x')).toBeNull()
    expect(parseSecretsUseAccount('secrets.use:bogus')).toBeNull()
  })
})

describe('CapabilityBroker.mint', () => {
  it('requires grant', () => {
    const broker = new CapabilityBroker()
    expect(() =>
      broker.mint({
        extensionId: 'ext-a',
        permission: 'network.request',
        grantedPermissions: [],
      }),
    ).toThrow(/not granted/i)

    expect(() =>
      broker.mint({
        extensionId: 'ext-a',
        permission: 'secrets.use:source_bearer::ws::src',
        grantedPermissions: ['network.request'],
      }),
    ).toThrow(/not granted/i)
  })

  it('mints when granted; response has token/expires/permission only (no secret)', () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'secrets.use:source_bearer::ws::src',
      grantedPermissions: ['secrets.use:source_bearer::ws::src'],
    })
    expect(cap.token.length).toBeGreaterThan(20)
    expect(cap.permission).toBe('secrets.use:source_bearer::ws::src')
    expect(cap.credentialAccount).toBe('source_bearer::ws::src')
    expect(cap.expiresAt).toBeGreaterThan(Date.now())
    expect(cap.extensionId).toBe('ext-a')
    // Mint surface never carries a secret field
    expect('secret' in cap).toBe(false)
    expect('value' in cap).toBe(false)
    expect(Object.keys(cap).sort()).toEqual(
      ['credentialAccount', 'expiresAt', 'extensionId', 'mintedAt', 'permission', 'token'].sort(),
    )
    expect(cap.credentialAccount).not.toBe('super-secret-token')
  })

  it('rejects bad secrets.use form even when granted', () => {
    const broker = new CapabilityBroker()
    expect(() =>
      broker.mint({
        extensionId: 'ext-a',
        permission: 'secrets.use:notvalid',
        grantedPermissions: ['secrets.use:notvalid'],
      }),
    ).toThrow(/invalid secrets\.use/i)
  })

  it('accepts mcp shorthand when granted as that string', () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'src-ext',
      permission: 'secrets.use:mcp::ws::slug',
      grantedPermissions: ['secrets.use:mcp::ws::slug'],
    })
    expect(cap.credentialAccount).toBe('source_bearer::ws::slug')
  })
})

describe('CapabilityBroker expiry / revoke', () => {
  it('expire → peek null', () => {
    let now = 1_000_000
    const broker = new CapabilityBroker({ now: () => now })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
      ttlMs: 100,
    })
    expect(broker.peek(cap.token)).not.toBeNull()
    now = 1_000_100
    expect(broker.peek(cap.token)).toBeNull()
  })

  it('revoke token', () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    broker.revoke(cap.token)
    expect(broker.peek(cap.token)).toBeNull()
  })

  it('revokeExtension clears all for that extension', () => {
    const broker = new CapabilityBroker()
    const a = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    const b = broker.mint({
      extensionId: 'ext-b',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    broker.revokeExtension('ext-a')
    expect(broker.peek(a.token)).toBeNull()
    expect(broker.peek(b.token)).not.toBeNull()
  })
})

describe('CapabilityBroker.resolveSecret', () => {
  it('uses CredentialManager mock and never exposes via mint', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
    })
    // mint result must not include secret
    expect(JSON.stringify(cap)).not.toContain('super-secret-token')

    const secret = await broker.resolveSecret(
      cap.token,
      mockGetCredential({ [account]: 'super-secret-token' }),
    )
    expect(secret).toBe('super-secret-token')
  })

  it('singleUse deletes after resolveSecret', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
      singleUse: true,
    })
    await broker.resolveSecret(
      cap.token,
      mockGetCredential({ [account]: 'v' }),
    )
    expect(broker.peek(cap.token)).toBeNull()
    await expect(
      broker.resolveSecret(cap.token, mockGetCredential({ [account]: 'v' })),
    ).rejects.toThrow(/invalid or expired/i)
  })
})

describe('CapabilityBroker.proxyFetch', () => {
  it('attaches Authorization Bearer from secrets.use', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
    })

    let seenAuth: string | undefined
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers
      if (headers && typeof headers === 'object' && 'Authorization' in headers) {
        const auth = (headers as Record<string, string>).Authorization
        if (typeof auth === 'string') seenAuth = auth
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/api',
      getCredential: mockGetCredential({ [account]: 'tok-abc' }),
      fetchImpl,
    })

    expect(seenAuth).toBe('Bearer tok-abc')
    expect(result.status).toBe(200)
    expect(result.body).toContain('ok')
    // Response must not echo the secret beyond what the remote returned
    expect(result.body).not.toContain('tok-abc')
  })

  it('network.request proxy without Authorization', async () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })

    let seenAuth: string | undefined
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers
      if (headers && typeof headers === 'object' && 'Authorization' in headers) {
        seenAuth = (headers as Record<string, string>).Authorization
      }
      return new Response('pong', { status: 204 })
    }

    const result = await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/',
      getCredential: mockGetCredential({}),
      fetchImpl,
    })
    expect(result.status).toBe(204)
    expect(seenAuth).toBeUndefined()
  })

  it('singleUse deletes after successful proxyFetch', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
      singleUse: true,
    })

    const fetchImpl = async () => new Response('ok', { status: 200 })

    await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/',
      getCredential: mockGetCredential({ [account]: 's' }),
      fetchImpl,
    })
    expect(broker.peek(cap.token)).toBeNull()
  })

  it('rejects expired token', async () => {
    let now = 1_000_000
    const broker = new CapabilityBroker({ now: () => now })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
      ttlMs: 50,
    })
    now = 1_000_050
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://example.com/',
        getCredential: mockGetCredential({}),
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/invalid or expired/i)
  })

  it('enforces allowedUrlPrefixes', async () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://evil.example/',
        getCredential: mockGetCredential({}),
        allowedUrlPrefixes: ['https://api.good.test/'],
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/allowlist/i)
  })
})

describe('getCapabilityBroker singleton', () => {
  it('is stable until reset', () => {
    const a = getCapabilityBroker()
    const b = getCapabilityBroker()
    expect(a).toBe(b)
    resetCapabilityBroker()
    const c = getCapabilityBroker()
    expect(c).not.toBe(a)
  })
})

describe('CapabilityBroker.proxyFetch wrong extensionId / required allowlist', () => {
  it('rejects expectedExtensionId that does not match the minted extension', async () => {
    const broker = new CapabilityBroker({ requireUrlAllowlist: false })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://example.com/',
        expectedExtensionId: 'ext-b',
        getCredential: mockGetCredential({}),
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/extensionId/i)
  })

  it('allows fetch when expectedExtensionId matches', async () => {
    const broker = new CapabilityBroker({ requireUrlAllowlist: false })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    const result = await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/',
      expectedExtensionId: 'ext-a',
      getCredential: mockGetCredential({}),
      fetchImpl: async () => new Response('ok', { status: 200 }),
    })
    expect(result.status).toBe(200)
  })

  it('requires a URL allowlist when requireUrlAllowlist is true', async () => {
    const broker = new CapabilityBroker({ requireUrlAllowlist: true })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://example.com/',
        getCredential: mockGetCredential({}),
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/allowlist required/i)
  })

  it('rejects URL outside required prefix', async () => {
    const broker = new CapabilityBroker({ requireUrlAllowlist: true })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://evil.example/steal',
        allowedUrlPrefixes: ['https://api.good.test/'],
        getCredential: mockGetCredential({}),
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/allowlist/i)
  })

  it('rejects host-suffix allowlist bypass', async () => {
    const broker = new CapabilityBroker({ requireUrlAllowlist: true })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://api.good.test.evil.com/v1',
        allowedUrlPrefixes: ['https://api.good.test/'],
        getCredential: mockGetCredential({}),
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/allowlist/i)
  })
})

describe('urlMatchesAllowlistPrefix', () => {
  it('matches origin+path prefix, not sibling hosts', () => {
    expect(urlMatchesAllowlistPrefix('https://api.good.test/v1', 'https://api.good.test/')).toBe(
      true,
    )
    expect(
      urlMatchesAllowlistPrefix('https://api.good.test.evil.com/v1', 'https://api.good.test/'),
    ).toBe(false)
    expect(urlMatchesAllowlistPrefix('https://evil.example/', 'https://api.good.test/')).toBe(false)
  })
})

describe('CapabilityBroker persist revoke + audit + listPublic', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('persists revoke records and reloads them without the token', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cap-broker-'))
    const a = new CapabilityBroker({ persistDir: tmp, requireUrlAllowlist: false })
    const cap = a.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    a.revoke(cap.token)

    const storePath = capabilityRevokeStorePath(tmp)
    expect(existsSync(storePath)).toBe(true)
    const raw = readFileSync(storePath, 'utf8')
    expect(raw).not.toContain(cap.token)
    expect(raw).toContain(sha256(cap.token))

    const b = new CapabilityBroker({ persistDir: tmp, requireUrlAllowlist: false })
    const listed = b.listPublic()
    expect(listed.revoked).toHaveLength(1)
    expect(listed.revoked[0]?.extensionId).toBe('ext-a')
    expect(listed.revoked[0]?.permission).toBe('network.request')
    expect(listed.revoked[0]?.tokenHash).toBe(sha256(cap.token))
    expect(listed.revoked[0]?.revokedAt).toBeGreaterThan(0)
    expect(JSON.stringify(listed)).not.toContain(cap.token)
    expect(listed.minted.some((row) => 'token' in row)).toBe(false)
    expect(listed.revoked.some((row) => 'token' in row)).toBe(false)
    expect(listed.revoked.some((row) => 'secret' in row || 'value' in row)).toBe(false)
  })

  it('revokeByTokenHash drops a live capability and persists', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cap-broker-'))
    const broker = new CapabilityBroker({ persistDir: tmp, requireUrlAllowlist: false })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    expect(broker.peek(cap.token)).not.toBeNull()
    expect(broker.revokeByTokenHash(sha256(cap.token))).toBe(true)
    expect(broker.peek(cap.token)).toBeNull()
    const listed = broker.listPublic()
    expect(listed.minted).toHaveLength(0)
    expect(listed.revoked[0]?.tokenHash).toBe(sha256(cap.token))
  })

  it('listPublic minted rows never include token or secret', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cap-broker-'))
    const broker = new CapabilityBroker({ persistDir: tmp, requireUrlAllowlist: false })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'secrets.use:source_bearer::ws::src',
      grantedPermissions: ['secrets.use:source_bearer::ws::src'],
    })
    const listed = broker.listPublic()
    expect(listed.minted).toHaveLength(1)
    expect(listed.minted[0]?.extensionId).toBe('ext-a')
    expect(listed.minted[0]?.permission).toBe('secrets.use:source_bearer::ws::src')
    expect(listed.minted[0]?.tokenHash).toBe(sha256(cap.token))
    expect(JSON.stringify(listed)).not.toContain(cap.token)
    expect(JSON.stringify(listed)).not.toContain('super-secret')
    expect('token' in listed.minted[0]!).toBe(false)
  })

  it('persist namespaces do not clobber each other', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cap-broker-'))
    const a = new CapabilityBroker({
      persistDir: tmp,
      persistNamespace: 'ws-a',
      requireUrlAllowlist: false,
    })
    const b = new CapabilityBroker({
      persistDir: tmp,
      persistNamespace: 'ws-b',
      requireUrlAllowlist: false,
    })
    const capA = a.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    const capB = b.mint({
      extensionId: 'ext-b',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    a.revoke(capA.token)
    b.revoke(capB.token)

    const a2 = new CapabilityBroker({
      persistDir: tmp,
      persistNamespace: 'ws-a',
      requireUrlAllowlist: false,
    })
    const b2 = new CapabilityBroker({
      persistDir: tmp,
      persistNamespace: 'ws-b',
      requireUrlAllowlist: false,
    })
    expect(a2.listPublic().revoked).toHaveLength(1)
    expect(a2.listPublic().revoked[0]?.extensionId).toBe('ext-a')
    expect(b2.listPublic().revoked).toHaveLength(1)
    expect(b2.listPublic().revoked[0]?.extensionId).toBe('ext-b')
    expect(JSON.stringify(a2.listPublic())).not.toContain(capA.token)
    expect(JSON.stringify(b2.listPublic())).not.toContain(capB.token)
  })

  it('writes audit JSONL without tokens or secrets', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'cap-broker-'))
    const broker = new CapabilityBroker({ persistDir: tmp, requireUrlAllowlist: true })
    const account = 'source_bearer::ws::src'
    const secret = 'super-secret-token'
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: `secrets.use:${account}`,
      grantedPermissions: [`secrets.use:${account}`],
    })
    await broker
      .proxyFetch({
        token: cap.token,
        url: 'https://evil.example/',
        expectedExtensionId: 'ext-b',
        allowedUrlPrefixes: ['https://api.good.test/'],
        getCredential: mockGetCredential({ [account]: secret }),
        fetchImpl: async () => new Response('nope'),
      })
      .catch(() => undefined)
    broker.revoke(cap.token)

    const auditPath = capabilityAuditPath(tmp)
    expect(existsSync(auditPath)).toBe(true)
    const audit = readFileSync(auditPath, 'utf8')
    expect(audit).toContain('"event":"minted"')
    expect(audit).toContain('"event":"revoked"')
    expect(audit).toContain('proxy_denied')
    expect(audit).not.toContain(cap.token)
    expect(audit).not.toContain(secret)
    expect(audit).toContain(sha256(cap.token))
  })
})
