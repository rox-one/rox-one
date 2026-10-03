import { afterEach, describe, expect, it } from 'bun:test'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { BrowserCredentialHost } from '@rox/shared/browser/browser-credential-host'
import type { ImportSummary, ProfileFs } from '@rox/shared/browser/profile-import'
import type { RpcServer, HandlerFn, RequestContext, RpcHandlerOptions } from '@rox/server-core/transport'
import { WsRpcServer, WsRpcClient } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerBrowserProfileImportHandlers } from '../browser-profile-import'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(useNativeFs = false) {
  const root = mkdtempSync(join(tmpdir(), 'rox-credential-rpc-'))
  roots.push(root)
  const home = join(root, 'home'), workspace = join(root, 'workspace')
  const profilePath = join(home, '.config/google-chrome/Default')
  mkdirSync(profilePath, { recursive: true }); mkdirSync(workspace)
  const sourceKey = Buffer.alloc(16, 0x6a)
  const cipher = createCipheriv('aes-128-cbc', sourceKey, Buffer.alloc(16, 0x20))
  const password = 'fixture-password-never-in-rpc'
  const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update(password), cipher.final()])
  const database = new DatabaseSync(join(profilePath, 'Login Data'))
  database.exec('CREATE TABLE logins (origin_url TEXT, action_url TEXT, signon_realm TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER DEFAULT 0)')
  database.prepare('INSERT INTO logins (origin_url,action_url,signon_realm,username_value,password_value) VALUES (?,?,?,?,?)').run('https://fixture.example/', 'https://fixture.example/login', 'https://fixture.example/', 'fixture-user', encrypted)
  database.close()
  const profileId = `chromium:${profilePath}`
  const keys = new Map<string, Buffer>()
  const calls = { requests: 0, released: 0, stores: 0, deletes: 0, writes: 0 }
  let decision: 'granted' | 'cancelled' | 'denied' = 'granted'
  let scope: 'valid' | 'profile' | 'workspace' = 'valid'
  let deletionAllowed = true
  let custodyAvailable = true
  const host: BrowserCredentialHost = {
    capabilities: () => ({ supported: true, mechanism: 'linux-secret-service' }),
    async requestAccess(request) {
      calls.requests++
      expect(request.workspaceId).toBe('workspace'); expect(request.profile.id).toBe(profileId); expect(request.webContentsId).toBe(41)
      if (decision !== 'granted') return { status: decision, reason: `browser-credential-access-${decision}` }
      const key = Buffer.from(sourceKey)
      return { status: 'granted', workspaceId: scope === 'workspace' ? 'other-workspace' : request.workspaceId,
        profileId: scope === 'profile' ? 'chromium:another-profile' : profileId, profilePath,
        mechanism: 'linux-secret-service', key, release() { calls.released++; key.fill(0) } }
    },
    vaultKeys: {
      available: () => custodyAvailable,
      storeKey(reference, key) { calls.stores++; if (keys.has(reference)) return false; keys.set(reference, Buffer.from(key)); return true },
      deleteKey(reference) { calls.deletes++; if (!deletionAllowed) return false; keys.get(reference)?.fill(0); keys.delete(reference); return true },
    },
  }
  const fs: ProfileFs = {
    exists: existsSync,
    readText: path => existsSync(path) ? readFileSync(path, 'utf8') : null,
    writeText(path, contents) { calls.writes++; mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents) },
    remove: path => rmSync(path, { force: true }),
    listPaths: prefix => existsSync(dirname(prefix)) ? readdirSync(dirname(prefix)).map(name => join(dirname(prefix), name)).filter(path => path.startsWith(prefix)) : [],
  }
  const handlers = new Map<string, HandlerFn>()
  const registrations = new Map<string, RpcHandlerOptions | undefined>()
  registerBrowserProfileImportHandlers({ handle: (channel: string, handler: HandlerFn, options?: RpcHandlerOptions) => { handlers.set(channel, handler); registrations.set(channel, options) } } as unknown as RpcServer,
    { browserCredentials: host } as HandlerDeps, { home, platform: 'linux', fs: useNativeFs ? undefined : fs, workspaceFor: id => id === 'workspace' ? { id, rootPath: workspace } : null })
  const ctx: RequestContext = { clientId: 'desktop-fixture', workspaceId: 'workspace', webContentsId: 41 }
  const args = { workspaceId: 'workspace', profileId,
    consent: { historyBookmarks: false, cookies: false, credentials: true, osCredentialsApproved: true } }
  const run = (dryRun = false, context = ctx) => Promise.resolve(handlers.get(RPC_CHANNELS.browserProfile.IMPORT)!(context, { ...args, dryRun })) as Promise<ImportSummary>
  const index = join(workspace, 'browser/profile-index.json'), vault = join(workspace, 'browser/credential-vault.json')
  return { registrations, root, run, fs, calls, keys, password, handlers, ctx, args, index, vault,
    decision(value: typeof decision) { decision = value }, scope(value: typeof scope) { scope = value },
    deletionAllowed(value: boolean) { deletionAllowed = value }, custodyAvailable(value: boolean) { custodyAvailable = value } }
}

describe('native manual browser credential import', () => {
  it('checks capability without requesting access and previews without custody or disk writes', async () => {
    const f = fixture()
    expect(await f.handlers.get(RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES)!(f.ctx, f.args)).toEqual({ supported: true, mechanism: 'linux-secret-service' })
    expect(f.calls.requests).toBe(0)
    const preview = await f.run(true)
    expect(preview.credentialAccess).toBe('granted'); expect(preview.counts.credentials).toBe(1)
    expect(preview.rollbackToken).toBeNull(); expect(f.calls.writes).toBe(0); expect(f.calls.stores).toBe(0)
    expect(f.calls.released).toBe(1); expect(f.keys.size).toBe(0); expect(existsSync(f.vault)).toBe(false)
    expect(JSON.stringify(preview)).not.toContain(f.password)
  })

  it('publishes the real host vault and recovery files with restricted permissions', async () => {
    const f = fixture(true)
    await f.run(true)
    expect(existsSync(f.index)).toBe(false); expect(existsSync(f.vault)).toBe(false)
    const result = await f.run()
    for (const path of [f.index, f.vault, `${f.index}.${result.rollbackToken}`, `${f.index}.${result.rollbackToken}.credentials`]) {
      expect(statSync(path).isFile()).toBe(true)
      if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it.each(['denied', 'cancelled'] as const)('honors %s despite a forged renderer approved checkbox', async status => {
    const f = fixture(); f.decision(status)
    const summary = await f.run()
    expect(summary.credentialAccess).toBe(status); expect(summary.counts.credentials).toBe(0)
    expect(summary.accessedStores).not.toContain('credentials'); expect(summary.rollbackToken).toBeNull()
    expect(f.calls.writes).toBe(0); expect(f.calls.stores).toBe(0); expect(f.keys.size).toBe(0)
  })

  it.each(['profile', 'workspace'] as const)('rejects a native grant bound to another %s before reading passwords', async scope => {
    const f = fixture(); f.scope(scope)
    await expect(f.run()).rejects.toThrow('browser-credentials-profile-not-authorized')
    expect(f.calls.released).toBe(1); expect(f.calls.writes).toBe(0); expect(f.calls.stores).toBe(0)
  })

  it('denies remote and wrong-workspace requests without opening a native prompt', async () => {
    const f = fixture()
    expect((await f.run(false, { ...f.ctx, webContentsId: null })).credentialAccess).toBe('unsupported')
    expect((await f.run(false, { ...f.ctx, workspaceId: 'other' })).credentialAccess).toBe('denied')
    expect(f.calls.requests).toBe(0); expect(f.calls.writes).toBe(0)
  })

  it('stores authenticated ciphertext with a unique key and safely retries rollback after key deletion denial', async () => {
    const f = fixture(), summary = await f.run()
    expect(summary.counts.credentials).toBe(1); expect(summary.credentialAccess).toBe('granted')
    const raw = readFileSync(f.vault, 'utf8')
    expect(raw).not.toContain(f.password); expect(JSON.stringify(summary)).not.toContain(f.password)
    const envelope = JSON.parse(raw) as { iv: string; tag: string; data: string }
    const index = JSON.parse(readFileSync(f.index, 'utf8')) as { credentialKeyRef: string }
    const key = f.keys.get(index.credentialKeyRef)!
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
    expect(plain.toString()).toContain(f.password); plain.fill(0)
    f.deletionAllowed(false)
    const rollback = () => f.handlers.get(RPC_CHANNELS.browserProfile.ROLLBACK)!(f.ctx, { workspaceId: 'workspace', token: summary.rollbackToken })
    expect(rollback).toThrow('protected-credential-key-delete-failed')
    expect(readFileSync(f.vault, 'utf8')).toBe(raw); expect(f.keys.size).toBe(1)
    f.deletionAllowed(true)
    expect(rollback()).toEqual({ ok: true }); expect(f.keys.size).toBe(0); expect(existsSync(f.vault)).toBe(false)
  })

  it('retains deletion journal and sealed bytes until custody deletion succeeds', async () => {
    const f = fixture(); await f.run()
    f.deletionAllowed(false)
    const remove = () => f.handlers.get(RPC_CHANNELS.browserProfile.DELETE)!(f.ctx, 'workspace')
    expect(remove).toThrow('protected-credential-key-delete-failed')
    expect(existsSync(f.index + '.delete-credential-custody')).toBe(true); expect(existsSync(f.vault)).toBe(true)
    f.deletionAllowed(true)
    expect(remove()).toMatchObject({ deletionReceipt: { categories: ['credentials'], itemCount: 1 } })
    expect(f.keys.size).toBe(0); expect(existsSync(f.index)).toBe(false); expect(existsSync(f.vault)).toBe(false)
  })

  it.each(['rollback', 'delete'] as const)('retries %s after custody deletion succeeds but phase persistence is interrupted', async action => {
    const f = fixture(), summary = await f.run(), write = f.fs.writeText
    let failOnce = true
    f.fs.writeText = (path, contents) => {
      if (failOnce && f.calls.deletes > 0 && f.keys.size === 0 &&
        (action === 'rollback' ? path.endsWith('.credentials') : path.endsWith('.delete-credential-custody'))) {
        failOnce = false; throw Error('fixture-lost-phase-write')
      }
      write(path, contents)
    }
    const perform = () => action === 'rollback'
      ? f.handlers.get(RPC_CHANNELS.browserProfile.ROLLBACK)!(f.ctx, { workspaceId: 'workspace', token: summary.rollbackToken })
      : f.handlers.get(RPC_CHANNELS.browserProfile.DELETE)!(f.ctx, 'workspace')
    expect(perform).toThrow('fixture-lost-phase-write')
    expect(f.keys.size).toBe(0); expect(existsSync(f.vault)).toBe(true)
    expect(perform()).toBeDefined(); expect(existsSync(f.vault)).toBe(false)
  })

  it('uses separate keys for repeated imports and refuses a stale rollback', async () => {
    const f = fixture(), first = await f.run(), second = await f.run()
    expect(first.rollbackToken).not.toBe(second.rollbackToken); expect(f.keys.size).toBe(2)
    expect(() => f.handlers.get(RPC_CHANNELS.browserProfile.ROLLBACK)!(f.ctx, { workspaceId: 'workspace', token: first.rollbackToken }))
      .toThrow('credential-rollback-source-changed')
    expect(f.keys.size).toBe(2)
    f.handlers.get(RPC_CHANNELS.browserProfile.DELETE)!(f.ctx, 'workspace')
    expect(f.keys.size).toBe(0); expect(existsSync(f.vault)).toBe(false)
  })

  it('creates no custody if publication fails before recovery metadata is saved', async () => {
    const f = fixture(), write = f.fs.writeText
    f.fs.writeText = (path, contents) => { if (/\.rb-[^.]+$/.test(path)) throw Error('fixture-no-space'); write(path, contents) }
    await expect(f.run()).rejects.toThrow('fixture-no-space')
    expect(f.calls.stores).toBe(0); expect(f.keys.size).toBe(0); expect(f.calls.released).toBe(1)
  })

  it('does not prompt or read a protected source when destination custody is unavailable', async () => {
    const f = fixture()
    f.custodyAvailable(false)
    const capability = await f.handlers.get(RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES)!(f.ctx, f.args)
    expect(capability.supported).toBe(false); expect(f.calls.requests).toBe(0)
    expect((await f.run()).credentialAccess).toBe('unsupported')
    expect(f.calls.requests).toBe(0); expect(f.calls.writes).toBe(0)
  })
})


describe('browser credential RPC caller identity', () => {
  it('denies authenticated external callers spoofing a window before native access and accepts a bound renderer', async () => {
    const f = fixture()
    expect(f.registrations.get(RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES)?.access).toBe('localElectron')
    expect(f.registrations.get(RPC_CHANNELS.browserProfile.IMPORT)?.access).toBe('localElectron')
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true,
      validateToken: async token => token === 'fixture-token',
      resolveLocalClientBinding: candidate => candidate.webContentsId === 41 && candidate.workspaceId === 'workspace'
        && candidate.localClientProof === 'fixture-renderer-proof'
        ? { webContentsId: 41, workspaceId: 'workspace' } : null,
    })
    for (const channel of [RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES, RPC_CHANNELS.browserProfile.IMPORT]) {
      server.handle(channel, f.handlers.get(channel)!, f.registrations.get(channel))
    }
    const clients: WsRpcClient[] = []
    const client = (proof: string) => {
      const c = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
        token: 'fixture-token', workspaceId: 'workspace', webContentsId: 41, localClientProof: proof,
        mode: 'local', autoReconnect: false, connectTimeout: 3000, requestTimeout: 3000,
      })
      clients.push(c); c.connect(); return c
    }
    try {
      await server.listen()
      for (const proof of ['', 'forged-renderer-proof']) {
        const spoof = client(proof)
        await expect(spoof.invoke(RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES, f.args)).rejects.toThrow()
        await expect(spoof.invoke(RPC_CHANNELS.browserProfile.IMPORT, { ...f.args, dryRun: true })).rejects.toThrow()
      }
      expect(f.calls.requests).toBe(0)
      expect(f.calls.stores).toBe(0)
      const local = client('fixture-renderer-proof')
      expect((await local.invoke(RPC_CHANNELS.browserProfile.CREDENTIAL_CAPABILITIES, f.args)).supported).toBe(true)
      expect((await local.invoke(RPC_CHANNELS.browserProfile.IMPORT, { ...f.args, dryRun: true })).credentialAccess).toBe('granted')
      expect(f.calls.requests).toBe(1)
    } finally { for (const c of clients) c.destroy(); server.close() }
  })
})
