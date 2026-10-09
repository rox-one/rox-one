/**
 * ROX Keeper store: one encrypted JSON vault per scope.
 *
 * Layout (per scope, default `personal`):
 *   <configDir>/keeper/<scope>/vault.json      AES-256-GCM sealed payload
 *   <configDir>/keeper/<scope>/vault.key.enc   safeStorage-wrapped vault key
 *
 * Writes go through a same-directory temporary file + rename, so a crash never
 * leaves a half-written vault. Reads are main-process only: the renderer sees
 * `KeeperItemView`, never a secret.
 */
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyItemPatch,
  deriveFolders,
  KEEPER_BROWSER_IMPORT_FOLDER,
  KEEPER_BROWSER_IMPORT_TAG,
  KEEPER_ERROR,
  KeeperError,
  normalizeItemInput,
  type BrowserCredentialRecord,
  type KeeperImportResult,
  type KeeperItem,
  type KeeperItemInput,
  type KeeperItemPatch,
  type KeeperItemView,
  type KeeperRevealResult,
  type KeeperUnlockStatus,
  type KeeperVaultSnapshot,
} from './types'
import { createKeeperKeyCustody, openVaultPayload, sealVaultPayload, storageCustodyAvailable, type KeeperKeyCustody, type KeeperSafeStorage } from './crypto'
import { totp, totpExpiresAt, TOTP_DEFAULT_PERIOD_SECONDS } from './totp'

const MAX_VAULT_BYTES = 32 * 1024 * 1024
const VAULT_FILE = 'vault.json'
/** Custody base name; the wrapped key lives at `${KEY_NAME}.key.enc`. */
const KEY_NAME = 'vault'

/** Filesystem seam so atomic-rename behavior is testable. */
export interface KeeperVaultFs {
  exists(path: string): boolean
  readText(path: string): string | null
  mkdirp(dir: string, mode: number): void
  writeFile(path: string, data: string, mode: number): void
  rename(from: string, to: string): void
  chmod(path: string, mode: number): void
  remove(path: string): void
}

export const nodeKeeperVaultFs: KeeperVaultFs = {
  exists: (path) => existsSync(path),
  readText: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  mkdirp: (dir, mode) => mkdirSync(dir, { recursive: true, mode }),
  writeFile: (path, data, mode) => writeFileSync(path, data, { mode, flag: 'wx' }),
  rename: (from, to) => renameSync(from, to),
  chmod: (path, mode) => chmodSync(path, mode),
  remove: (path) => rmSync(path, { force: true }),
}

interface PersistedVault {
  version: 1
  items: KeeperItem[]
}

export interface KeeperStoreOptions {
  directory: string
  safeStorage: KeeperSafeStorage
  /** Vault scope; default `personal`. One directory per scope. */
  scope?: string
  platform?: NodeJS.Platform
  fs?: KeeperVaultFs
  now?: () => number
  newId?: () => string
}

export interface KeeperStore {
  readonly scope: string
  readonly vaultPath: string
  custodyAvailable(): boolean
  vaultExists(): boolean
  status(): KeeperUnlockStatus
  snapshot(atMs?: number): KeeperVaultSnapshot
  getItemView(id: string, atMs?: number): KeeperItemView
  readItem(id: string): KeeperItem
  createItem(input: unknown): KeeperItemView
  updateItem(id: string, patch: unknown): KeeperItemView
  deleteItem(id: string): { id: string }
  reveal(id: string, field?: 'password' | 'totpSecret'): KeeperRevealResult
  importBrowserRecords(records: readonly BrowserCredentialRecord[], options?: { profileId?: string; folder?: string }): KeeperImportResult
}

function sanitizeScope(scope: string): string {
  const cleaned = scope.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
  return cleaned || 'personal'
}

function emptyVault(): PersistedVault {
  return { version: 1, items: [] }
}

function coerceStoredItem(value: unknown): KeeperItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  try {
    const normalized = normalizeItemInput(raw)
    const createdAt = typeof raw.createdAt === 'number' && raw.createdAt > 0 ? Math.floor(raw.createdAt) : 0
    const updatedAt = typeof raw.updatedAt === 'number' && raw.updatedAt > 0 ? Math.floor(raw.updatedAt) : createdAt
    if (typeof raw.id !== 'string' || !raw.id) return null
    return { id: raw.id, ...normalized, createdAt, updatedAt } as KeeperItem
  } catch {
    return null
  }
}

function parseVault(text: string): PersistedVault {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new KeeperError(KEEPER_ERROR.corrupt)
  }
  if (!parsed || typeof parsed !== 'object') throw new KeeperError(KEEPER_ERROR.corrupt)
  const items = (parsed as { items?: unknown }).items
  if (!Array.isArray(items)) return emptyVault()
  return { version: 1, items: items.map(coerceStoredItem).filter((item): item is KeeperItem => item !== null) }
}

function hasSecret(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

/** Deterministic id keeps repeated imports idempotent (same row updates in place). */
function browserRecordId(record: BrowserCredentialRecord, profileId: string): string {
  const digest = createHash('sha256')
    .update([profileId, record.origin, record.realm ?? '', record.username].join('\u0000'))
    .digest('hex')
  return `browser-${digest.slice(0, 32)}`
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '') || origin
  } catch {
    return origin
  }
}

/**
 * Pure mapping from decrypted browser-import rows to keeper items. Items are
 * tagged `browser-import` and filed under the "Из браузера" folder.
 */
export function mapBrowserCredentialRecords(
  records: readonly BrowserCredentialRecord[],
  options: { profileId?: string; folder?: string; now: number },
): KeeperItem[] {
  const profileId = options.profileId ?? ''
  const folder = options.folder ?? KEEPER_BROWSER_IMPORT_FOLDER
  const mapped: KeeperItem[] = []
  const seen = new Set<string>()
  for (const record of records) {
    if (!record || typeof record.origin !== 'string' || typeof record.username !== 'string' || typeof record.password !== 'string') continue
    if (!record.origin || !record.password) continue
    const id = browserRecordId(record, profileId)
    if (seen.has(id)) continue
    seen.add(id)
    const item: KeeperItem = {
      id,
      kind: 'login',
      title: hostnameOf(record.origin),
      username: record.username || undefined,
      password: record.password,
      url: record.origin,
      tags: [KEEPER_BROWSER_IMPORT_TAG],
      folders: [folder],
      createdAt: options.now,
      updatedAt: options.now,
    }
    if (record.action) item.notes = `Вход: ${record.action}`
    mapped.push(item)
  }
  return mapped
}

export function createKeeperStore(options: KeeperStoreOptions): KeeperStore {
  const scope = sanitizeScope(options.scope ?? 'personal')
  const directory = join(options.directory, scope)
  const vaultPath = join(directory, VAULT_FILE)
  const fs = options.fs ?? nodeKeeperVaultFs
  const now = options.now ?? Date.now
  const newId = options.newId ?? randomUUID
  const platform = options.platform ?? process.platform
  const custody: KeeperKeyCustody = createKeeperKeyCustody({
    directory,
    safeStorage: options.safeStorage,
    platform,
  })

  function custodyAvailable(): boolean {
    return storageCustodyAvailable(options.safeStorage, platform) && custody.available()
  }

  function vaultExists(): boolean {
    try {
      return fs.exists(vaultPath)
    } catch {
      return false
    }
  }

  function readKeyForWrite(): Buffer {
    if (!custodyAvailable()) throw new KeeperError(KEEPER_ERROR.locked)
    const existing = custody.readKey(KEY_NAME)
    if (existing) return existing
    const created = custody.createKey(KEY_NAME)
    if (!created) throw new KeeperError(KEEPER_ERROR.keyUnavailable)
    return created
  }

  function readVault(): PersistedVault {
    if (!vaultExists()) return emptyVault()
    if (!custodyAvailable()) throw new KeeperError(KEEPER_ERROR.locked)
    const raw = fs.readText(vaultPath)
    if (raw === null) return emptyVault()
    const key = custody.readKey(KEY_NAME)
    if (!key) throw new KeeperError(KEEPER_ERROR.keyUnavailable)
    const plaintext = openVaultPayload(key, JSON.parse(raw))
    return parseVault(plaintext)
  }

  function writeVault(vault: PersistedVault): void {
    const key = readKeyForWrite()
    const plaintext = JSON.stringify(vault)
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_VAULT_BYTES) throw new KeeperError(KEEPER_ERROR.tooLarge)
    const sealed = JSON.stringify(sealVaultPayload(key, plaintext))
    fs.mkdirp(directory, 0o700)
    const pending = join(directory, `${randomUUID()}.tmp`)
    fs.writeFile(pending, sealed, 0o600)
    try {
      fs.chmod(pending, 0o600)
      fs.rename(pending, vaultPath)
      fs.chmod(vaultPath, 0o600)
    } catch (error) {
      fs.remove(pending)
      throw error
    }
  }

  function findItem(vault: PersistedVault, id: string): KeeperItem {
    const item = vault.items.find((entry) => entry.id === id)
    if (!item) throw new KeeperError(KEEPER_ERROR.notFound)
    return item
  }

  function maskItem(item: KeeperItem, atMs: number): KeeperItemView {
    const view: KeeperItemView = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      tags: [...item.tags],
      folders: [...item.folders],
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      hasPassword: hasSecret(item.password),
      hasTotpSecret: hasSecret(item.totpSecret),
      password: null,
      totpSecret: null,
    }
    if (item.username !== undefined) view.username = item.username
    if (item.url !== undefined) view.url = item.url
    if (item.notes !== undefined) view.notes = item.notes
    if (item.favorite) view.favorite = true
    if (item.expiresAt !== undefined) view.expiresAt = item.expiresAt
    if (hasSecret(item.totpSecret)) {
      try {
        const period = TOTP_DEFAULT_PERIOD_SECONDS
        view.totp = { code: totp(item.totpSecret!, { atMs, periodSeconds: period }), period, expiresAt: totpExpiresAt(atMs, period) }
      } catch {
        // An unreadable secret must not break the whole list.
      }
    }
    return view
  }

  function snapshot(atMs = now()): KeeperVaultSnapshot {
    const vault = readVault()
    return {
      items: vault.items.map((item) => maskItem(item, atMs)).sort((a, b) => a.title.localeCompare(b.title)),
      folders: deriveFolders(vault.items),
    }
  }

  function getItemView(id: string, atMs = now()): KeeperItemView {
    return maskItem(findItem(readVault(), id), atMs)
  }

  return {
    scope,
    vaultPath,
    custodyAvailable,
    vaultExists,
    status(): KeeperUnlockStatus {
      const keyAvailable = custodyAvailable()
      const exists = vaultExists()
      const keyPresent = custody.hasKey(KEY_NAME)
      return { scope, keyAvailable, vaultExists: exists, available: keyAvailable && (!exists || keyPresent) }
    },
    snapshot,
    getItemView,
    readItem(id) {
      return findItem(readVault(), id)
    },
    createItem(input: unknown): KeeperItemView {
      const vault = readVault()
      const normalized = normalizeItemInput(input)
      const timestamp = now()
      const item: KeeperItem = {
        id: newId(),
        ...normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as KeeperItem
      vault.items.push(item)
      writeVault(vault)
      return maskItem(item, timestamp)
    },
    updateItem(id: string, patch: unknown): KeeperItemView {
      const vault = readVault()
      const current = findItem(vault, id)
      const next = applyItemPatch(current, patch)
      const updated: KeeperItem = { ...next, id: current.id, createdAt: current.createdAt, updatedAt: now() }
      vault.items = vault.items.map((entry) => (entry.id === id ? updated : entry))
      writeVault(vault)
      return maskItem(updated, updated.updatedAt)
    },
    deleteItem(id: string) {
      const vault = readVault()
      findItem(vault, id)
      vault.items = vault.items.filter((entry) => entry.id !== id)
      writeVault(vault)
      return { id }
    },
    reveal(id, field = 'password'): KeeperRevealResult {
      const item = findItem(readVault(), id)
      const value = field === 'totpSecret' ? item.totpSecret : item.password
      if (!hasSecret(value)) throw new KeeperError(KEEPER_ERROR.notFound)
      return { id, field, value: value! }
    },
    importBrowserRecords(records, importOptions = {}): KeeperImportResult {
      const folder = importOptions.folder ?? KEEPER_BROWSER_IMPORT_FOLDER
      const mapped = mapBrowserCredentialRecords(records, {
        profileId: importOptions.profileId,
        folder,
        now: now(),
      })
      const vault = readVault()
      const byId = new Map(vault.items.map((item) => [item.id, item]))
      let added = 0
      let updated = 0
      for (const item of mapped) {
        const existing = byId.get(item.id)
        if (existing) {
          byId.set(item.id, {
            ...item,
            createdAt: existing.createdAt,
            updatedAt: now(),
            favorite: existing.favorite,
          })
          updated++
        } else {
          byId.set(item.id, item)
          added++
        }
      }
      vault.items = [...byId.values()]
      writeVault(vault)
      return { added, updated, skipped: records.length - mapped.length, folder }
    },
  }
}