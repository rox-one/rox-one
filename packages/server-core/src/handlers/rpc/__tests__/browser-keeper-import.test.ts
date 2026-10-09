/**
 * Host-side browser-password export for Keeper. The acceptance contract:
 *  - the sealed envelope is opened only in the host process, gated by the same
 *    native grant as the import flow (a renderer cannot manufacture access);
 *  - the vault key is never returned or serialized into a result;
 *  - items are capped, de-duplicated and named deterministically.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createCipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { BrowserCredentialHost } from '@rox/shared/browser/browser-credential-host'
import type { DiscoveredProfile, ProfileFs } from '@rox/shared/browser/profile-import'
import type { RpcServer, HandlerFn, RequestContext, RpcHandlerOptions } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerBrowserProfileImportHandlers } from '../browser-profile-import'
import {
  KEEPER_EXPORT_MAX_ITEMS,
  exportBrowserCredentialsForKeeper,
  keeperExportKey,
  type KeeperBrowserCredentialItem,
} from '../browser-credential-vault'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const VAULT_KEY = Buffer.alloc(32, 0x2b)

/** Same envelope serializer as `sealNativeBrowserCredentials`. */
function sealEnvelope(key: Buffer, profileId: string, credentials: unknown[]): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const payload = Buffer.from(JSON.stringify({ version: 1, profileId, credentials }), 'utf8')
  const data = Buffer.concat([cipher.update(payload), cipher.final()])
  return JSON.stringify({
    version: 1,
    format: 'rox-browser-credentials',
    cipher: 'aes-256-gcm',
    iv: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  })
}

const record = (origin: string, username: string, password: string) => ({ origin, action: null, realm: origin, username, password })

const profile: DiscoveredProfile = {
  id: 'chromium:/profiles/Default',
  family: 'chromium',
  name: 'Default',
  path: '/profiles/Default',
  lastUsedAt: null,
  recommended: false,
  state: 'ok',
}

function fixtureHost(overrides: {
  available?: boolean
  decision?: 'granted' | 'denied' | 'cancelled'
  vaultKey?: Buffer | null
} = {}) {
  const calls = { requests: 0, released: 0, readKey: 0 }
  const host: BrowserCredentialHost = {
    capabilities: () => ({ supported: true, mechanism: 'linux-secret-service' }),
    async requestAccess(request) {
      calls.requests++
      if ((overrides.decision ?? 'granted') !== 'granted') {
        return { status: overrides.decision ?? 'granted', reason: 'fixture' } as never
      }
      const key = Buffer.from(VAULT_KEY)
      return {
        status: 'granted',
        workspaceId: request.workspaceId,
        profileId: request.profile.id,
        profilePath: request.profile.path,
        mechanism: 'linux-secret-service',
        key,
        release() { calls.released++; key.fill(0) },
      }
    },
    vaultKeys: {
      available: () => overrides.available ?? true,
      storeKey: () => true,
      deleteKey: () => true,
    },
  }
  const readVaultKey = (): Buffer | null => {
    calls.readKey++
    return overrides.vaultKey ?? null
  }
  return { host, calls, readVaultKey }
}

function exportInput(host: BrowserCredentialHost, sealedText: string | null, keyRef: string | null, readVaultKey: (reference: string) => Buffer | null, limit?: number) {
  return {
    host,
    workspaceId: 'workspace',
    webContentsId: 41,
    profile,
    readSealedEnvelope: () => sealedText,
    readKeyReference: () => keyRef,
    readVaultKey,
    limit,
  }
}

describe('keeper export naming', () => {
  it('slugs origin + username and trims separators', () => {
    expect(keeperExportKey('https://fixture.example/', 'fixture-user')).toBe('https-fixture-example-fixture-user')
  })

  it('falls back to a stable base for empty slugs', () => {
    expect(keeperExportKey('###', '', new Set())).toBe('login')
  })

  it('suffixes collisions without exceeding the key limit', () => {
    const taken = new Set<string>()
    const first = keeperExportKey('https://a.example/', 'user', taken)
    taken.add(first)
    const second = keeperExportKey('https://a.example/', 'user', taken)
    taken.add(second)
    const third = keeperExportKey('https://a.example/', 'user', taken)
    expect(first).toBe('https-a-example-user')
    expect(second).toBe('https-a-example-user-2')
    expect(third).toBe('https-a-example-user-3')
  })

  it('caps derived keys at 120 characters even when suffixing', () => {
    const longOrigin = `https://${'a'.repeat(400)}.example/`
    const taken = new Set<string>()
    const first = keeperExportKey(longOrigin, 'user', taken)
    taken.add(first)
    const second = keeperExportKey(longOrigin, 'user', taken)
    expect(first.length).toBeLessThanOrEqual(120)
    expect(second.length).toBeLessThanOrEqual(120)
    expect(second).not.toBe(first)
  })
})

describe('exportBrowserCredentialsForKeeper', () => {
  it.each(['denied', 'cancelled'] as const)('refuses without a grant (%s) and never touches custody', async (decision) => {
    const f = fixtureHost({ decision })
    const sealed = sealEnvelope(VAULT_KEY, profile.id, [record('https://a.example/', 'u', 'pw')])
    const result = await exportBrowserCredentialsForKeeper(exportInput(f.host, sealed, 'ref', f.readVaultKey))
    expect(result).toEqual({ status: decision, items: [], skipped: 0 })
    expect(f.calls.readKey).toBe(0)
    expect(f.calls.released).toBe(0)
  })

  it('reports unsupported when OS custody is unavailable without opening a prompt', async () => {
    const f = fixtureHost({ available: false })
    const result = await exportBrowserCredentialsForKeeper(exportInput(f.host, '{}', 'ref', f.readVaultKey))
    expect(result.status).toBe('unsupported')
    expect(f.calls.requests).toBe(0)
  })

  it('returns sealed items, drops duplicates and never leaks the vault key', async () => {
    const f = fixtureHost({ vaultKey: Buffer.from(VAULT_KEY) })
    const sealed = sealEnvelope(VAULT_KEY, profile.id, [
      record('https://b.example/', 'alice', 's3cret'),
      record('https://a.example/', 'bob', 'pw'),
      record('https://b.example/', 'alice', 'duplicate'),
      record('https://c.example/', '', ''),
    ])
    const result = await exportBrowserCredentialsForKeeper(exportInput(f.host, sealed, 'ref-1', f.readVaultKey))
    expect(result.status).toBe('granted')
    expect(result.items).toEqual([
      { key: 'https-b-example-alice', origin: 'https://b.example/', username: 'alice', password: 's3cret' },
      { key: 'https-a-example-bob', origin: 'https://a.example/', username: 'bob', password: 'pw' },
    ])
    expect(result.skipped).toBe(2)
    expect(f.calls.released).toBe(1)
    expect(JSON.stringify(result)).not.toContain(VAULT_KEY.toString('hex'))
  })

  it('caps the number of exported items', async () => {
    const f = fixtureHost({ vaultKey: Buffer.from(VAULT_KEY) })
    const records = Array.from({ length: 5 }, (_, index) => record(`https://h${index}.example/`, 'user', 'pw'))
    const result = await exportBrowserCredentialsForKeeper(exportInput(f.host, sealEnvelope(VAULT_KEY, profile.id, records), 'ref', f.readVaultKey, 2))
    expect(result.items).toHaveLength(2)
    expect(result.skipped).toBe(3)
    expect(KEEPER_EXPORT_MAX_ITEMS).toBeGreaterThan(2)
  })

  it('returns an empty export when no key reference or ciphertext is recorded', async () => {
    const f = fixtureHost({ vaultKey: Buffer.from(VAULT_KEY) })
    const missingRef = await exportBrowserCredentialsForKeeper(exportInput(f.host, '{}', null, f.readVaultKey))
    expect(missingRef).toEqual({ status: 'granted', items: [], skipped: 0 })
    expect(f.calls.readKey).toBe(0)
    const missingSealed = await exportBrowserCredentialsForKeeper(exportInput(f.host, null, 'ref', f.readVaultKey))
    expect(missingSealed).toEqual({ status: 'granted', items: [], skipped: 0 })
  })
})

describe('browser credentials export RPC', () => {
  function rpcFixture() {
    const root = mkdtempSync(join(tmpdir(), 'rox-keeper-export-'))
    roots.push(root)
    const home = join(root, 'home'), workspace = join(root, 'workspace')
    const profilePath = join(home, '.config/google-chrome/Default')
    mkdirSync(profilePath, { recursive: true })
    mkdirSync(join(workspace, 'browser'), { recursive: true })
    const profileId = `chromium:${profilePath}`
    const sealed = sealEnvelope(VAULT_KEY, profileId, [record('https://fixture.example/', 'fixture-user', 'fixture-password')])
    writeFileSync(join(workspace, 'browser/credential-vault.json'), sealed)
    writeFileSync(join(workspace, 'browser/profile-index.json'), JSON.stringify({ credentialKeyRef: 'ref-fixture' }))

    const calls = { requests: 0, deleted: 0 }
    const host: BrowserCredentialHost & { vaultKeys: { readKey?: (reference: string) => Buffer | null } } = {
      capabilities: () => ({ supported: true, mechanism: 'linux-secret-service' }),
      async requestAccess(request) {
        calls.requests++
        const key = Buffer.from(VAULT_KEY)
        return {
          status: 'granted',
          workspaceId: request.workspaceId,
          profileId: request.profile.id,
          profilePath: request.profile.path,
          mechanism: 'linux-secret-service',
          key,
          release() { key.fill(0) },
        }
      },
      vaultKeys: {
        available: () => true,
        storeKey: () => true,
        deleteKey: () => { calls.deleted++; return true },
        readKey: (reference) => (reference === 'ref-fixture' ? Buffer.from(VAULT_KEY) : null),
      },
    }
    const fs: ProfileFs = {
      exists: existsSync,
      readText: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
      writeText(path, contents) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents) },
      remove: (path) => rmSync(path, { force: true }),
      listPaths: (prefix) => (existsSync(dirname(prefix)) ? readdirSync(dirname(prefix)).map((name) => join(dirname(prefix), name)).filter((path) => path.startsWith(prefix)) : []),
    }
    const handlers = new Map<string, HandlerFn>()
    const registrations = new Map<string, RpcHandlerOptions | undefined>()
    registerBrowserProfileImportHandlers(
      { handle: (channel: string, handler: HandlerFn, options?: RpcHandlerOptions) => { handlers.set(channel, handler); registrations.set(channel, options) } } as unknown as RpcServer,
      { browserCredentials: host } as HandlerDeps,
      { home, platform: 'linux', fs, workspaceFor: (id) => (id === 'workspace' ? { id, rootPath: workspace } : null) },
    )
    const ctx: RequestContext = { clientId: 'desktop-fixture', workspaceId: 'workspace', webContentsId: 41 }
    const invoke = (args: unknown, context: RequestContext = ctx) =>
      Promise.resolve(handlers.get(RPC_CHANNELS.browserCredentials.EXPORT_FOR_KEEPER)!(context, args)) as Promise<{ status: string; items: KeeperBrowserCredentialItem[]; skipped: number }>
    return { calls, ctx, invoke, registrations, handlers, profileId }
  }

  it('is registered as a local-Electron channel', () => {
    const f = rpcFixture()
    expect(f.registrations.get(RPC_CHANNELS.browserCredentials.EXPORT_FOR_KEEPER)?.access).toBe('localElectron')
  })

  it('refuses a forged or missing local window without reading custody', async () => {
    const f = rpcFixture()
    const args = { workspaceId: 'workspace', profileId: f.profileId }
    expect((await f.invoke(args, { ...f.ctx, webContentsId: null })).status).toBe('denied')
    expect((await f.invoke(args, { ...f.ctx, workspaceId: 'other' })).status).toBe('denied')
    expect(f.calls.requests).toBe(0)
  })

  it('opens the sealed envelope for the granted workspace and never returns the key', async () => {
    const f = rpcFixture()
    const result = await f.invoke({ workspaceId: 'workspace', profileId: f.profileId })
    expect(result.status).toBe('granted')
    expect(result.items).toEqual([{ key: 'https-fixture-example-fixture-user', origin: 'https://fixture.example/', username: 'fixture-user', password: 'fixture-password' }])
    expect(JSON.stringify(result)).not.toContain(VAULT_KEY.toString('hex'))
  })
})