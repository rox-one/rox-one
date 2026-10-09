/**
 * ROX Keeper — personal secret vault domain types.
 *
 * One encrypted vault per store scope. Items carry secrets; the renderer only
 * ever sees `KeeperItemView`, which replaces `password`/`totpSecret` with
 * `null` plus a `has*` flag. Secret values cross the process boundary only
 * through an explicit, single-shot `keeper:reveal`.
 *
 * This module is pure data + validation: no filesystem, no crypto.
 */

export type KeeperItemKind = 'login' | 'note' | 'card' | 'identity' | 'totp'

export const KEEPER_ITEM_KINDS: readonly KeeperItemKind[] = ['login', 'note', 'card', 'identity', 'totp']

/** Persisted vault item. `folders` holds folder *names* (see `KeeperFolder`). */
export interface KeeperItem {
  id: string
  kind: KeeperItemKind
  title: string
  username?: string
  password?: string
  url?: string
  notes?: string
  tags: string[]
  folders: string[]
  favorite?: boolean
  totpSecret?: string
  /** Epoch milliseconds; absent = never expires. */
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * Folder projection. Folders are derived from the names items reference (plus
 * any explicitly registered empty folder); `id` is a stable slug of `name`.
 */
export interface KeeperFolder {
  id: string
  name: string
}

/** One live TOTP code computed in the main process — the secret never leaves it. */
export interface KeeperTotpCode {
  code: string
  period: number
  /** Epoch milliseconds at which this code stops being valid. */
  expiresAt: number
}

/** Masked item sent to the renderer. Never contains secret material. */
export interface KeeperItemView {
  id: string
  kind: KeeperItemKind
  title: string
  username?: string
  url?: string
  notes?: string
  tags: string[]
  folders: string[]
  favorite?: boolean
  expiresAt?: number
  createdAt: number
  updatedAt: number
  hasPassword: boolean
  hasTotpSecret: boolean
  /** Always `null` — the real value is available only via `keeper:reveal`. */
  password: null
  /** Always `null` — the real value is available only via `keeper:reveal`. */
  totpSecret: null
  totp?: KeeperTotpCode
}

export interface KeeperVaultSnapshot {
  items: KeeperItemView[]
  folders: KeeperFolder[]
}

export interface KeeperUnlockStatus {
  scope: string
  /** OS-backed key custody (safeStorage) is available on this host. */
  keyAvailable: boolean
  /** An encrypted vault file already exists for this scope. */
  vaultExists: boolean
  /** True when the vault can be opened or created right now. */
  available: boolean
}

export interface KeeperItemInput {
  kind: KeeperItemKind
  title: string
  username?: string
  password?: string
  url?: string
  notes?: string
  tags?: string[]
  folders?: string[]
  favorite?: boolean
  totpSecret?: string
  expiresAt?: number
}

export interface KeeperItemPatch {
  kind?: KeeperItemKind
  title?: string
  username?: string
  password?: string
  url?: string
  notes?: string
  tags?: string[]
  folders?: string[]
  favorite?: boolean
  totpSecret?: string
  expiresAt?: number
  /** Explicitly remove the stored password (a `null` patch field is ambiguous). */
  clearPassword?: boolean
  clearTotpSecret?: boolean
}

/** One decrypted browser-import row, mapped from the sealed native envelope. */
export interface BrowserCredentialRecord {
  origin: string
  action?: string | null
  realm?: string
  username: string
  password: string
}

export interface KeeperImportResult {
  added: number
  updated: number
  skipped: number
  folder: string
}

export interface KeeperRevealResult {
  id: string
  field: 'password' | 'totpSecret'
  /** Returned exactly once per call for a single clipboard copy. */
  value: string
}

export type KeeperCreateRequest = { item: KeeperItemInput }
export type KeeperUpdateRequest = { id: string; patch: KeeperItemPatch }

export const KEEPER_BROWSER_IMPORT_TAG = 'browser-import'
export const KEEPER_BROWSER_IMPORT_FOLDER = 'Из браузера'

export const KEEPER_ERROR = {
  locked: 'keeper-vault-locked',
  keyUnavailable: 'keeper-vault-key-unavailable',
  invalidKey: 'keeper-vault-key-invalid',
  corrupt: 'keeper-vault-corrupt',
  notFound: 'keeper-item-not-found',
  invalid: 'keeper-invalid-input',
  tooLarge: 'keeper-vault-too-large',
  browserImportUnavailable: 'keeper-browser-import-unavailable',
} as const

export type KeeperErrorCode = (typeof KEEPER_ERROR)[keyof typeof KEEPER_ERROR]

/** Stable-coded error; the message is safe to surface and never contains a secret. */
export class KeeperError extends Error {
  readonly code: KeeperErrorCode | string
  constructor(code: KeeperErrorCode | string) {
    super(code)
    this.name = 'KeeperError'
    this.code = code
  }
}

export function isKeeperItemKind(value: unknown): value is KeeperItemKind {
  return typeof value === 'string' && (KEEPER_ITEM_KINDS as readonly string[]).includes(value)
}

const MAX_TITLE = 300
const MAX_FIELD = 4096
const MAX_NOTES = 32_768
const MAX_TAG = 120
const MAX_FOLDER = 120
const MAX_TAGS = 64
const MAX_FOLDERS = 64
const MAX_SECRET = 8192

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function cleanList(value: unknown, max: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const cleaned = cleanString(entry, max)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
    if (out.length >= maxItems) break
  }
  return out
}

function cleanSecret(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.length > max ? value.slice(0, max) : value
}

function cleanExpiry(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

/** Validate + normalize untrusted item input into a safe persisted shape. */
export function normalizeItemInput(input: unknown): KeeperItemInput {
  const raw = (input ?? {}) as Record<string, unknown>
  if (!isKeeperItemKind(raw.kind)) throw new KeeperError(KEEPER_ERROR.invalid)
  const title = cleanString(raw.title, MAX_TITLE)
  if (!title) throw new KeeperError(KEEPER_ERROR.invalid)
  const item: KeeperItemInput = {
    kind: raw.kind,
    title,
    tags: cleanList(raw.tags, MAX_TAG, MAX_TAGS),
    folders: cleanList(raw.folders, MAX_FOLDER, MAX_FOLDERS),
  }
  const username = cleanString(raw.username, MAX_FIELD)
  if (username) item.username = username
  const password = cleanSecret(raw.password, MAX_SECRET)
  if (password !== undefined) item.password = password
  const url = cleanString(raw.url, MAX_FIELD)
  if (url) item.url = url
  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.slice(0, MAX_NOTES) : undefined
  if (notes) item.notes = notes
  if (raw.favorite === true) item.favorite = true
  const totpSecret = cleanSecret(raw.totpSecret, MAX_SECRET)
  if (totpSecret) item.totpSecret = totpSecret
  const expiresAt = cleanExpiry(raw.expiresAt)
  if (expiresAt) item.expiresAt = expiresAt
  return item
}

/** Apply a partial patch over an existing item; `undefined` leaves the field. */
export function applyItemPatch(base: KeeperItem, patch: unknown): KeeperItem {
  const raw = (patch ?? {}) as Record<string, unknown>
  if (raw.kind !== undefined && !isKeeperItemKind(raw.kind)) throw new KeeperError(KEEPER_ERROR.invalid)
  const next: KeeperItem = { ...base }
  if (raw.kind !== undefined) next.kind = raw.kind as KeeperItemKind
  if (raw.title !== undefined) {
    const title = cleanString(raw.title, MAX_TITLE)
    if (!title) throw new KeeperError(KEEPER_ERROR.invalid)
    next.title = title
  }
  if (raw.username !== undefined) {
    const username = cleanString(raw.username, MAX_FIELD)
    if (username === undefined) delete next.username
    else next.username = username
  }
  if (raw.url !== undefined) {
    const url = cleanString(raw.url, MAX_FIELD)
    if (url === undefined) delete next.url
    else next.url = url
  }
  if (raw.notes !== undefined) {
    if (typeof raw.notes === 'string' && raw.notes.trim()) next.notes = raw.notes.slice(0, MAX_NOTES)
    else delete next.notes
  }
  if (raw.tags !== undefined) next.tags = cleanList(raw.tags, MAX_TAG, MAX_TAGS)
  if (raw.folders !== undefined) next.folders = cleanList(raw.folders, MAX_FOLDER, MAX_FOLDERS)
  if (raw.favorite !== undefined) {
    if (raw.favorite === true) next.favorite = true
    else delete next.favorite
  }
  if (raw.expiresAt !== undefined) {
    const expiresAt = cleanExpiry(raw.expiresAt)
    if (expiresAt) next.expiresAt = expiresAt
    else delete next.expiresAt
  }
  if (raw.clearPassword === true) delete next.password
  else if (raw.password !== undefined) {
    const password = cleanSecret(raw.password, MAX_SECRET)
    if (password === undefined) delete next.password
    else next.password = password
  }
  if (raw.clearTotpSecret === true) delete next.totpSecret
  else if (raw.totpSecret !== undefined) {
    const secret = cleanSecret(raw.totpSecret, MAX_SECRET)
    if (secret === undefined) delete next.totpSecret
    else next.totpSecret = secret
  }
  return next
}

/** Stable slug used as the folder id (the display name stays the source of truth). */
export function folderSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `folder-${slug || 'unnamed'}`
}

/** Derive the folder registry from the names items reference. */
export function deriveFolders(items: readonly KeeperItem[]): KeeperFolder[] {
  const seen = new Map<string, KeeperFolder>()
  for (const item of items) {
    for (const name of item.folders) {
      const id = folderSlug(name)
      if (!seen.has(id)) seen.set(id, { id, name })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}