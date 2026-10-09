import { afterEach, describe, expect, it } from 'bun:test'
import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { KEEPER_ERROR } from '@rox/shared/keeper'
import type {
  KeeperImportResult,
  KeeperItemView,
  KeeperRevealResult,
  KeeperSafeStorage,
  KeeperVaultSnapshot,
} from '@rox/shared/keeper'
import type { RpcServer, HandlerFn, RequestContext, RpcHandlerOptions } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { openBrowserCredentialEnvelope, registerKeeperRpcHandlers } from '../keeper'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fakeSafeStorage(): KeeperSafeStorage {
  const tag = Buffer.from('rox-test-seal:')
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.concat([tag, Buffer.from(value, 'utf8')]),
    decryptString: (value) => {
      if (!value.subarray(0, tag.length).equals(tag)) throw new Error('not sealed here')
      return value.subarray(tag.length).toString('utf8')
    },
  }
}

function sealEnvelope(key: Buffer, payload: unknown): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()])
  return JSON.stringify({
    version: 1,
    format: 'rox-browser-credentials',
    cipher: 'aes-256-gcm',
    iv: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  })
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-keeper-rpc-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, 'browser'), { recursive: true })
  const key = randomBytes(32)
  const handlers = new Map<string, HandlerFn>()
  const registrations = new Map<string, RpcHandlerOptions | undefined>()
  registerKeeperRpcHandlers(
    { handle: (channel: string, handler: HandlerFn, options?: RpcHandlerOptions) => { handlers.set(channel, handler); registrations.set(channel, options) } } as unknown as RpcServer,
    {} as HandlerDeps,
    {
      directory: join(root, 'keeper'),
      safeStorage: fakeSafeStorage(),
      platform: 'darwin',
      workspaceFor: (id) => (id === 'workspace' ? { id, rootPath: workspace } : null),
      readBrowserCredentialKey: (reference) => (reference === 'ref-abc' ? key : null),
    },
  )
  const ctx: RequestContext = { clientId: 'desktop-fixture', workspaceId: 'workspace', webContentsId: 1 }
  const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(ctx, ...args)) as Promise<T>
  return { root, workspace, key, handlers, registrations, ctx, call }
}

describe('keeper RPC surface', () => {
  it('registers every keeper channel as local-only', () => {
    const f = fixture()
    for (const channel of Object.values(RPC_CHANNELS.keeper)) {
      expect(f.handlers.has(channel)).toBe(true)
      expect(f.registrations.get(channel)?.access).toBe('localElectron')
    }
  })

  it('creates, lists (masked), reveals, updates and deletes', async () => {
    const f = fixture()
    expect(await f.call(RPC_CHANNELS.keeper.UNLOCK_STATUS)).toMatchObject({ vaultExists: false, available: true })

    const created = await f.call<KeeperItemView>(RPC_CHANNELS.keeper.CREATE, { item: { kind: 'login', title: 'Банк', username: 'ann', password: 'hunter2', folders: ['Работа'] } })
    expect(created.password).toBeNull()
    expect(created.hasPassword).toBe(true)

    const list = await f.call<KeeperVaultSnapshot>(RPC_CHANNELS.keeper.LIST)
    expect(JSON.stringify(list)).not.toContain('hunter2')
    expect(list.folders).toEqual([{ id: 'folder-работа', name: 'Работа' }])

    const got = await f.call<KeeperItemView>(RPC_CHANNELS.keeper.GET, created.id)
    expect(got.password).toBeNull()

    expect(await f.call<KeeperRevealResult>(RPC_CHANNELS.keeper.REVEAL, { id: created.id })).toEqual({ id: created.id, field: 'password', value: 'hunter2' })

    const updated = await f.call<KeeperItemView>(RPC_CHANNELS.keeper.UPDATE, { id: created.id, patch: { title: 'Банк 2', folders: ['Личное'] } })
    expect(updated.title).toBe('Банк 2')
    expect(updated.folders).toEqual(['Личное'])

    expect(await f.call<{ id: string }>(RPC_CHANNELS.keeper.DELETE, created.id)).toEqual({ id: created.id })
    expect((await f.call<KeeperVaultSnapshot>(RPC_CHANNELS.keeper.LIST)).items).toEqual([])
  })

  it('rejects malformed requests without touching the vault', async () => {
    const f = fixture()
    await expect(f.call(RPC_CHANNELS.keeper.CREATE, {})).rejects.toThrow(KEEPER_ERROR.invalid)
    await expect(f.call(RPC_CHANNELS.keeper.GET, '')).rejects.toThrow(KEEPER_ERROR.invalid)
    await expect(f.call(RPC_CHANNELS.keeper.UPDATE, { id: '' })).rejects.toThrow(KEEPER_ERROR.invalid)
    await expect(f.call(RPC_CHANNELS.keeper.DELETE, 42)).rejects.toThrow(KEEPER_ERROR.invalid)
  })
})

describe('browser import bridge', () => {
  it('maps the sealed envelope into keeper items and keeps it intact', async () => {
    const f = fixture()
    const envelope = sealEnvelope(f.key, {
      version: 1,
      profileId: 'chromium:/profile',
      credentials: [
        { origin: 'https://example.com/', action: 'https://example.com/login', realm: 'https://example.com/', username: 'ann', password: 'p1' },
        { origin: 'https://mail.example.com', username: 'bob', password: 'p2' },
      ],
    })
    writeFileSync(join(f.workspace, 'browser', 'credential-vault.json'), envelope)
    writeFileSync(join(f.workspace, 'browser', 'profile-index.json'), JSON.stringify({ credentialKeyRef: 'ref-abc' }))

    const result = await f.call(RPC_CHANNELS.keeper.IMPORT_BROWSER)
    expect(result).toEqual({ added: 2, updated: 0, skipped: 0, folder: 'Из браузера' })
    const list = await f.call<KeeperVaultSnapshot>(RPC_CHANNELS.keeper.LIST)
    expect(list.items.map((item) => item.title).sort()).toEqual(['example.com', 'mail.example.com'])
    expect(list.items[0].tags).toContain('browser-import')
    expect(JSON.stringify(list)).not.toContain('p1')
    // second run is idempotent
    expect(await f.call<KeeperImportResult>(RPC_CHANNELS.keeper.IMPORT_BROWSER)).toEqual({ added: 0, updated: 2, skipped: 0, folder: 'Из браузера' })
    // the sealed envelope is still there, untouched
    expect(JSON.parse(envelope)).toMatchObject({ format: 'rox-browser-credentials' })
  })

  it('is honest when no sealed browser credentials are available', async () => {
    const f = fixture()
    await expect(f.call(RPC_CHANNELS.keeper.IMPORT_BROWSER)).rejects.toThrow(KEEPER_ERROR.browserImportUnavailable)
    expect(await f.call<KeeperVaultSnapshot>(RPC_CHANNELS.keeper.LIST)).toEqual({ items: [], folders: [] })
  })

  it('rejects an envelope sealed with a different key', () => {
    const f = fixture()
    const envelope = sealEnvelope(randomBytes(32), { version: 1, credentials: [{ origin: 'https://x/', username: 'u', password: 'p' }] })
    expect(() => openBrowserCredentialEnvelope(envelope, f.key)).toThrow(KEEPER_ERROR.browserImportUnavailable)
  })
})