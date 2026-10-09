import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KEEPER_ERROR, type KeeperItemView } from '../types'
import { createKeeperStore, mapBrowserCredentialRecords, nodeKeeperVaultFs, type KeeperVaultFs } from '../store'
import type { KeeperSafeStorage } from '../crypto'
import { totp, totpExpiresAt } from '../totp'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-keeper-store-'))
  roots.push(root)
  return root
}

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

function makeStore(directory: string, overrides: Partial<Parameters<typeof createKeeperStore>[0]> = {}) {
  return createKeeperStore({ directory, safeStorage: fakeSafeStorage(), platform: 'darwin', ...overrides })
}

const BASE32_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('keeper store CRUD', () => {
  it('reports unlock status before any vault exists', () => {
    const store = makeStore(tempDir())
    expect(store.status()).toEqual({ scope: 'personal', keyAvailable: true, vaultExists: false, available: true })
  })

  it('creates, reads, updates and deletes an item; persists across instances', () => {
    const directory = tempDir()
    const store = makeStore(directory)
    const created = store.createItem({ kind: 'login', title: 'Банк', username: 'user', password: 'hunter2', tags: ['finance'], folders: ['Работа'] })
    expect(created.hasPassword).toBe(true)
    expect(store.status().vaultExists).toBe(true)

    const reopened = makeStore(directory)
    expect(reopened.getItemView(created.id).title).toBe('Банк')
    expect(reopened.snapshot().folders).toEqual([{ id: 'folder-работа', name: 'Работа' }])

    const updated = reopened.updateItem(created.id, { title: 'Банк 2', folders: ['Личное'] })
    expect(updated.title).toBe('Банк 2')
    expect(updated.folders).toEqual(['Личное'])
    expect(reopened.snapshot().folders).toEqual([{ id: 'folder-личное', name: 'Личное' }])

    expect(reopened.deleteItem(created.id)).toEqual({ id: created.id })
    expect(reopened.snapshot().items).toEqual([])
    expect(() => reopened.getItemView(created.id)).toThrow(KEEPER_ERROR.notFound)
  })

  it('validates untrusted input', () => {
    const store = makeStore(tempDir())
    expect(() => store.createItem({ kind: 'nope', title: 'x' })).toThrow(KEEPER_ERROR.invalid)
    expect(() => store.createItem({ kind: 'note', title: '   ' })).toThrow(KEEPER_ERROR.invalid)
    const item = store.createItem({ kind: 'note', title: 'Заметка', password: '  spaced  ' })
    expect(store.readItem(item.id).password).toBe('  spaced  ') // secrets are never trimmed
  })

  it('moves items between folders and keeps the registry derived', () => {
    const store = makeStore(tempDir())
    const a = store.createItem({ kind: 'login', title: 'A', folders: ['Из браузера'] })
    expect(store.snapshot().folders.map((folder) => folder.name)).toEqual(['Из браузера'])
    store.updateItem(a.id, { folders: ['Работа'] })
    expect(store.snapshot().folders.map((folder) => folder.name)).toEqual(['Работа'])
    expect(store.getItemView(a.id).folders).toEqual(['Работа'])
  })
})

describe('reveal gating', () => {
  it('never exposes secrets in list/get views, only through reveal', () => {
    const store = makeStore(tempDir())
    const item = store.createItem({ kind: 'totp', title: '2FA', password: 'p@ss', totpSecret: BASE32_SECRET })
    const view = store.getItemView(item.id)
    expect(view.password).toBeNull()
    expect(view.totpSecret).toBeNull()
    expect(view.hasPassword).toBe(true)
    expect(view.hasTotpSecret).toBe(true)
    expect(JSON.stringify(store.snapshot())).not.toContain('p@ss')
    expect(JSON.stringify(store.snapshot())).not.toContain(BASE32_SECRET)
    expect(store.reveal(item.id)).toEqual({ id: item.id, field: 'password', value: 'p@ss' })
    expect(store.reveal(item.id, 'totpSecret')).toEqual({ id: item.id, field: 'totpSecret', value: BASE32_SECRET })
  })

  it('computes the live TOTP code in-process without leaking the secret', () => {
    const at = 1_111_111_109_000
    const store = makeStore(tempDir(), { now: () => at })
    const item = store.createItem({ kind: 'totp', title: '2FA', totpSecret: BASE32_SECRET })
    const view = store.getItemView(item.id) as KeeperItemView
    expect(view.totp).toEqual({ code: totp(BASE32_SECRET, { atMs: at }), period: 30, expiresAt: totpExpiresAt(at, 30) })
  })

  it('rejects reveal for an item without the requested secret', () => {
    const store = makeStore(tempDir())
    const item = store.createItem({ kind: 'note', title: 'Заметка' })
    expect(() => store.reveal(item.id)).toThrow(KEEPER_ERROR.notFound)
    expect(() => store.reveal(item.id, 'totpSecret')).toThrow(KEEPER_ERROR.notFound)
  })
})

describe('custody and failure modes', () => {
  it('refuses to open an existing vault when the OS key is unavailable', () => {
    const directory = tempDir()
    makeStore(directory).createItem({ kind: 'note', title: 'secret note' })
    const locked = makeStore(directory, {
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' },
    })
    expect(locked.status()).toEqual({ scope: 'personal', keyAvailable: false, vaultExists: true, available: false })
    expect(() => locked.snapshot()).toThrow(KEEPER_ERROR.locked)
  })

  it('refuses to read a vault sealed by a different OS store', () => {
    const directory = tempDir()
    makeStore(directory).createItem({ kind: 'note', title: 'note' })
    const other = makeStore(directory, {
      safeStorage: { isEncryptionAvailable: () => true, encryptString: () => Buffer.from('x'), decryptString: () => { throw new Error('other store') } },
    })
    expect(() => other.snapshot()).toThrow(KEEPER_ERROR.keyUnavailable)
  })

  it('keeps the previous vault intact when a write is interrupted before rename', () => {
    const directory = tempDir()
    const store = makeStore(directory)
    const item = store.createItem({ kind: 'note', title: 'Старое' })
    const renames: Array<[string, string]> = []
    const failing: KeeperVaultFs = {
      ...nodeKeeperVaultFs,
      writeFile: (path, data, mode) => nodeKeeperVaultFs.writeFile(path, data, mode),
      rename: (from, to) => { renames.push([from, to]); throw new Error('rename failed') },
    }
    const interrupted = makeStore(directory, { fs: failing })
    expect(() => interrupted.updateItem(item.id, { title: 'Новое' })).toThrow('rename failed')
    expect(store.getItemView(item.id).title).toBe('Старое')
    const scopeDir = join(directory, 'personal')
    expect(readdirSync(scopeDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('publishes each write through a temporary file + rename', () => {
    const directory = tempDir()
    const sequence: string[] = []
    const tracking: KeeperVaultFs = {
      ...nodeKeeperVaultFs,
      writeFile: (path, data, mode) => { sequence.push(`write:${path}`); nodeKeeperVaultFs.writeFile(path, data, mode) },
      rename: (from, to) => { sequence.push(`rename:${from}->${to}`); nodeKeeperVaultFs.rename(from, to) },
    }
    const store = makeStore(directory, { fs: tracking })
    const item = store.createItem({ kind: 'note', title: 'atomic' })
    const write = sequence.find((entry) => entry.startsWith('write:'))!
    const rename = sequence.find((entry) => entry.startsWith('rename:'))!
    expect(write).toContain('.tmp')
    expect(rename).toContain(`->${store.vaultPath}`)
    expect(existsSync(store.vaultPath)).toBe(true)
    expect(readFileSync(store.vaultPath, 'utf8')).not.toContain('atomic') // sealed on disk
    expect(item.title).toBe('atomic')
  })

  it('fails closed when custody is unavailable on a fresh store', () => {
    const store = makeStore(tempDir(), {
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' },
    })
    expect(store.status().available).toBe(false)
    expect(() => store.createItem({ kind: 'note', title: 'x' })).toThrow(KEEPER_ERROR.locked)
  })

  it('uses one vault directory per scope', () => {
    const directory = tempDir()
    expect(makeStore(directory).vaultPath).toBe(join(directory, 'personal', 'vault.json'))
    expect(makeStore(directory, { scope: 'workspace-1' }).vaultPath).toBe(join(directory, 'workspace-1', 'vault.json'))
  })
})

describe('browser import mapping', () => {
  const records = [
    { origin: 'https://www.example.com/', action: 'https://www.example.com/login', realm: 'https://example.com/', username: 'ann', password: 'p1' },
    { origin: 'https://mail.example.com', realm: 'https://mail.example.com', username: '', password: 'p2' },
    { origin: 'not-a-url', username: 'bob', password: 'p3' },
  ]

  it('maps rows to login items in the browser folder with a deterministic id', () => {
    const mapped = mapBrowserCredentialRecords(records, { profileId: 'chromium:/p', now: 42 })
    expect(mapped).toHaveLength(3)
    expect(mapped[0]).toMatchObject({
      kind: 'login', title: 'example.com', username: 'ann', password: 'p1', url: 'https://www.example.com/',
      tags: ['browser-import'], folders: ['Из браузера'], createdAt: 42, updatedAt: 42,
    })
    expect(mapped[1]!.title).toBe('mail.example.com')
    expect(mapped[2]!.title).toBe('not-a-url')
    const again = mapBrowserCredentialRecords(records, { profileId: 'chromium:/p', now: 99 })
    expect(again.map((item) => item.id)).toEqual(mapped.map((item) => item.id))
  })

  it('imports idempotently: a second run updates instead of duplicating', () => {
    const store = makeStore(tempDir())
    const first = store.importBrowserRecords(records, { profileId: 'chromium:/p' })
    expect(first).toEqual({ added: 3, updated: 0, skipped: 0, folder: 'Из браузера' })
    const second = store.importBrowserRecords(records, { profileId: 'chromium:/p' })
    expect(second).toEqual({ added: 0, updated: 3, skipped: 0, folder: 'Из браузера' })
    expect(store.snapshot().items).toHaveLength(3)
    expect(store.snapshot().folders.map((folder) => folder.name)).toEqual(['Из браузера'])
  })
})