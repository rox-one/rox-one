/**
 * ROX Keeper crypto: AES-256-GCM vault payloads plus OS-backed key custody.
 *
 * The vault key is 32 random bytes wrapped by Electron `safeStorage`
 * (Keychain / DPAPI / Secret Service). There is deliberately no plaintext
 * fallback: when the OS store is unavailable (or Electron reports Linux
 * `basic_text`, which is obfuscation with a hardcoded key), custody fails
 * closed and the vault cannot be opened or created.
 *
 * Custody files mirror `apps/electron/src/main/browser-credential-vault-keys.ts`:
 * 0700 directory, 0600 sealed file, O_NOFOLLOW reads, exclusive atomic publish.
 */
import { chmodSync, closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { KEEPER_ERROR, KeeperError } from './types'

export interface KeeperSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}

const KEY_BYTES = 32
const MAX_SEALED_BYTES = 16_384
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,118}[a-zA-Z0-9]$/

function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name) && !name.includes('..') && !name.includes('/') && !name.includes('\\')
}

/** Honors the same fail-closed rules as browser credential custody. */
export function storageCustodyAvailable(storage: KeeperSafeStorage, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!storage.isEncryptionAvailable()) return false
    if (platform === 'linux') {
      const backend = storage.getSelectedStorageBackend?.()
      return Boolean(backend && backend !== 'basic_text' && backend !== 'unknown')
    }
    return platform === 'darwin' || platform === 'win32'
  } catch {
    return false
  }
}

export function generateVaultKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

export interface SealedVault {
  version: 1
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

export function sealVaultPayload(key: Buffer, plaintext: string): SealedVault {
  if (key.length !== KEY_BYTES) throw new KeeperError(KEEPER_ERROR.invalidKey)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    version: 1,
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

function isSealedVault(value: unknown): value is SealedVault {
  if (!value || typeof value !== 'object') return false
  const sealed = value as Record<string, unknown>
  return sealed.version === 1 && sealed.cipher === 'aes-256-gcm'
    && typeof sealed.iv === 'string' && typeof sealed.tag === 'string' && typeof sealed.data === 'string'
}

/** Decrypt a sealed vault; wrong keys and tampered payloads fail as `keeper-vault-key-invalid`. */
export function openVaultPayload(key: Buffer, sealed: unknown): string {
  if (key.length !== KEY_BYTES || !isSealedVault(sealed)) throw new KeeperError(KEEPER_ERROR.invalidKey)
  let plain: Buffer | null = null
  try {
    const iv = Buffer.from(sealed.iv, 'base64')
    const tag = Buffer.from(sealed.tag, 'base64')
    const data = Buffer.from(sealed.data, 'base64')
    if (iv.length !== 12 || tag.length !== 16) throw new KeeperError(KEEPER_ERROR.invalidKey)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    plain = Buffer.concat([decipher.update(data), decipher.final()])
    return plain.toString('utf8')
  } catch {
    // Never surface OS/OpenSSL diagnostics; a key mismatch is the only public reason.
    throw new KeeperError(KEEPER_ERROR.invalidKey)
  } finally {
    plain?.fill(0)
  }
}

export interface KeeperKeyCustody {
  available(): boolean
  hasKey(name: string): boolean
  readKey(name: string): Buffer | null
  /** Generates and exclusively publishes a new wrapped key; null when it already exists or is unavailable. */
  createKey(name: string): Buffer | null
}

export function createKeeperKeyCustody(options: {
  directory: string
  safeStorage: KeeperSafeStorage
  platform?: NodeJS.Platform
}): KeeperKeyCustody {
  const platform = options.platform ?? process.platform
  const storage = options.safeStorage
  const keyFileFor = (name: string): string | null => (isValidName(name) ? join(options.directory, `${name}.key.enc`) : null)

  function available(): boolean {
    return storageCustodyAvailable(storage, platform)
  }

  function hasKey(name: string): boolean {
    const file = keyFileFor(name)
    if (!file) return false
    try {
      return lstatSync(file).isFile()
    } catch {
      return false
    }
  }

  function readKey(name: string): Buffer | null {
    const file = keyFileFor(name)
    if (!file || !available()) return null
    let sealed: Buffer | null = null
    let descriptor: number | null = null
    try {
      if (lstatSync(options.directory).isSymbolicLink()) return null
      descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = fstatSync(descriptor)
      const current = lstatSync(file)
      if (!info.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino || info.size > MAX_SEALED_BYTES) return null
      sealed = Buffer.alloc(MAX_SEALED_BYTES + 1)
      const length = readSync(descriptor, sealed, 0, sealed.length, 0)
      if (length > MAX_SEALED_BYTES) return null
      sealed = sealed.subarray(0, length)
      const value = storage.decryptString(sealed)
      return /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null
    } catch {
      return null
    } finally {
      sealed?.fill(0)
      if (descriptor !== null) closeSync(descriptor)
    }
  }

  function createKey(name: string): Buffer | null {
    const file = keyFileFor(name)
    if (!file || !available()) return null
    if (hasKey(name)) return null
    let key: Buffer | null = null
    let sealed: Buffer | null = null
    const pending = join(options.directory, `.pending-${randomUUID()}`)
    try {
      key = generateVaultKey()
      sealed = storage.encryptString(key.toString('hex'))
      if (sealed.length === 0) return null
      mkdirSync(options.directory, { recursive: true, mode: 0o700 })
      if (lstatSync(options.directory).isSymbolicLink()) return null
      chmodSync(options.directory, 0o700)
      writeFileSync(pending, sealed, { mode: 0o600, flag: 'wx' })
      chmodSync(pending, 0o600)
      // Atomic, exclusive publication: two writers cannot both win the name.
      linkSync(pending, file)
      return key
    } catch {
      return null
    } finally {
      sealed?.fill(0)
      try { rmSync(pending, { force: true }) } catch { /* A failed write is not a grant. */ }
    }
  }

  return { available, hasKey, readKey, createKey }
}