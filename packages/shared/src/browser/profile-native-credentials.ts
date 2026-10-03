/**
 * Native Chromium password import. This module is never called by a renderer:
 * the host first obtains a grant for the exact selected profile and a separate
 * OS-protected destination key. Only ciphertext and counts leave this adapter.
 * Firefox NSS, Safari/iCloud and Chromium app-bound v20 are deliberately not
 * treated as compatible with Chromium's older encryption schemes.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DiscoveredProfile } from './profile-import.ts'
import { withBrowserDatabaseSnapshot } from './profile-native-data.ts'

export interface NativeCredentialAccess {
  /** These are produced by the host's native permission adapter, not RPC input. */
  profileId: string
  profilePath: string
  /** macOS/Linux Chromium Safe Storage key, already derived by the host. */
  key: Buffer | null
  /** Windows current-user DPAPI. No secret bytes are passed on the command line. */
  decryptWindows?: (blob: Uint8Array) => Promise<Buffer>
}

export interface SealedNativeCredentials {
  sealedBlob: string | null
  count: number
  skipped: number
  unsupported: number
}

interface CredentialRow {
  origin_url?: unknown
  action_url?: unknown
  signon_realm?: unknown
  username_value?: unknown
  password_value?: unknown
}

const CREDENTIAL_LIMIT = 50_000
const MAX_ENCRYPTED_VALUE_BYTES = 1024 * 1024
const MAX_LOCAL_STATE_BYTES = 16 * 1024 * 1024
const MAX_VAULT_PAYLOAD_BYTES = 32 * 1024 * 1024
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux', 'win32'])
const utf8 = new TextDecoder('utf-8', { fatal: true })

function rejectLinkedStore(path: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error('browser-credentials-store-unsupported')
}

async function unprotectWindows(blob: Uint8Array, decrypt: NonNullable<NativeCredentialAccess['decryptWindows']>): Promise<Buffer> {
  try { return await decrypt(blob) } catch {
    // Never propagate helper stderr or an exception that could contain a
    // decrypted password. Native permission outcomes are reported by the host.
    throw new Error('browser-credentials-access-denied')
  }
}

function decryptChunks(decipher: ReturnType<typeof createDecipheriv>, encrypted: Buffer): Buffer {
  let partial: Buffer | null = null
  let final: Buffer | null = null
  try {
    partial = decipher.update(encrypted)
    final = decipher.final()
    return Buffer.concat([partial, final])
  } finally { partial?.fill(0); final?.fill(0) }
}

function exactProfileGrant(profile: DiscoveredProfile, access: NativeCredentialAccess): boolean {
  // Matching the host-resolved path also prevents replacing the selected
  // profile with an arbitrary sibling when the grant object is reused.
  return profile.id === access.profileId && resolve(profile.path) === resolve(access.profilePath)
}

function webOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return parsed.href
  } catch { return null }
}

/** The Windows DPAPI-wrapped Chromium key is scoped to this browser root. */
async function windowsKeyFor(profilePath: string, decrypt: NativeCredentialAccess['decryptWindows']): Promise<Buffer | null> {
  if (!decrypt) throw new Error('browser-credentials-access-unavailable')
  const candidates = [join(profilePath, 'Local State'), join(dirname(profilePath), 'Local State')]
  const path = candidates.find(candidate => existsSync(candidate))
  if (!path) return null // Old Chromium rows can be protected directly with DPAPI.
  let wrapped: Buffer | null = null
  let key: Buffer | null = null
  try {
    rejectLinkedStore(path)
    const raw = readFileSync(path)
    if (raw.byteLength > MAX_LOCAL_STATE_BYTES) throw new Error('browser-credentials-key-unavailable')
    const state = JSON.parse(raw.toString('utf8')) as { os_crypt?: { encrypted_key?: unknown } }
    if (typeof state.os_crypt?.encrypted_key !== 'string') return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(state.os_crypt.encrypted_key)) throw new Error('browser-credentials-key-unavailable')
    wrapped = Buffer.from(state.os_crypt.encrypted_key, 'base64')
    if (wrapped.subarray(0, 5).toString('ascii') !== 'DPAPI' || wrapped.length <= 5) {
      throw new Error('browser-credentials-key-unsupported')
    }
    key = await unprotectWindows(wrapped.subarray(5), decrypt)
    if (key.length !== 32) throw new Error('browser-credentials-key-unavailable')
    // The DPAPI result belongs to this adapter; its caller never retains it.
    return key
  } catch (error) {
    key?.fill(0)
    if (error instanceof Error && error.message.startsWith('browser-credentials-')) throw error
    throw new Error('browser-credentials-key-unavailable')
  } finally { wrapped?.fill(0) }
}

async function decryptPassword(
  encrypted: Buffer,
  platform: NodeJS.Platform,
  key: Buffer | null,
  decryptWindows: NativeCredentialAccess['decryptWindows'],
): Promise<{ plain: Buffer | null; unsupported: boolean }> {
  const prefix = encrypted.subarray(0, 3).toString('latin1')
  if (prefix === 'v20' || /^v\d\d$/.test(prefix) && prefix !== 'v10' && prefix !== 'v11') {
    return { plain: null, unsupported: true }
  }
  if (platform === 'win32' && prefix !== 'v10' && prefix !== 'v11') {
    if (!decryptWindows) throw new Error('browser-credentials-access-unavailable')
    // Historical rows are individually DPAPI protected. The callback is a
    // privileged host capability and must not be reconstructed from RPC data.
    return { plain: await unprotectWindows(encrypted, decryptWindows), unsupported: false }
  }
  if (prefix !== 'v10' && prefix !== 'v11') return { plain: null, unsupported: true }
  if (!key) return { plain: null, unsupported: true }
  try {
    if (platform === 'win32') {
      // v10/v11: 3-byte version, 12-byte nonce, ciphertext, 16-byte GCM tag.
      if (key.length !== 32 || encrypted.length < 3 + 12 + 16) return { plain: null, unsupported: false }
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15))
      decipher.setAuthTag(encrypted.subarray(-16))
      return { plain: decryptChunks(decipher, encrypted.subarray(15, -16)), unsupported: false }
    }
    // Passwords do NOT contain the cookie DB's 32-byte host digest prefix.
    if (key.length !== 16 || encrypted.length < 3 + 16 || (encrypted.length - 3) % 16 !== 0) {
      return { plain: null, unsupported: false }
    }
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    return { plain: decryptChunks(decipher, encrypted.subarray(3)), unsupported: false }
  } catch { return { plain: null, unsupported: false } }
}

/**
 * Read only Login Data files from the explicitly granted profile and seal all
 * imported records with an independent destination key. The result is suitable
 * for storage; it must never be substituted with an unencrypted JSON export.
 */
export async function sealNativeBrowserCredentials(
  profile: DiscoveredProfile,
  access: NativeCredentialAccess,
  vaultKey: Buffer,
  options: { platform?: NodeJS.Platform; temporaryRoot?: string } = {},
): Promise<SealedNativeCredentials> {
  if (!exactProfileGrant(profile, access)) throw new Error('browser-credentials-profile-not-authorized')
  const platform = options.platform ?? process.platform
  if (profile.family !== 'chromium' || !SUPPORTED_PLATFORMS.has(platform)) throw new Error('browser-credentials-store-unsupported')
  if (profile.state === 'locked' || profile.state === 'unsupported') throw new Error('browser-credentials-store-unavailable')
  if (!Buffer.isBuffer(vaultKey) || vaultKey.length !== 32) throw new Error('browser-credentials-vault-key-unavailable')
  if (platform === 'win32' ? !access.decryptWindows : !access.key || access.key.length !== 16) {
    throw new Error('browser-credentials-access-unavailable')
  }

  const result: SealedNativeCredentials = { sealedBlob: null, count: 0, skipped: 0, unsupported: 0 }
  // Chromium's profile-scoped account store is included; sibling profiles and
  // Firefox/Safari stores are never enumerated or opened by this adapter.
  const sources = ['Login Data', 'Login Data For Account']
    .map(name => join(profile.path, name)).filter(path => existsSync(path))
  if (sources.length === 0) return result
  let key: Buffer | null = null
  const records: Array<{ origin: string; action: string | null; realm: string; username: string; password: string }> = []
  let payload: Buffer | null = null
  let payloadEstimate = 0
  try {
    key = platform === 'win32' ? await windowsKeyFor(profile.path, access.decryptWindows) : Buffer.from(access.key!)
    for (const source of sources) {
      let rows: CredentialRow[]
      try {
        for (const path of [source, `${source}-wal`, `${source}-shm`]) {
          if (existsSync(path)) rejectLinkedStore(path)
        }
        rows = withBrowserDatabaseSnapshot(source, database => database.prepare(
          `SELECT origin_url, action_url, signon_realm, username_value, password_value FROM logins WHERE blacklisted_by_user = 0 AND length(password_value) > 0 LIMIT ${CREDENTIAL_LIMIT}`,
        ).all(), options.temporaryRoot)
      } catch { throw new Error('browser-credentials-read-failed') }
      for (const row of rows) {
        const origin = webOrigin(row.origin_url)
        if (!origin || typeof row.username_value !== 'string' || !(row.password_value instanceof Uint8Array) ||
            row.password_value.byteLength === 0 || row.password_value.byteLength > MAX_ENCRYPTED_VALUE_BYTES) {
          result.skipped++
          continue
        }
        const encrypted = Buffer.from(row.password_value)
        let plain: Buffer | null = null
        try {
          const decrypted = await decryptPassword(encrypted, platform, key, access.decryptWindows)
          plain = decrypted.plain
          if (!plain) { result.skipped++; if (decrypted.unsupported) result.unsupported++; continue }
          let password: string
          try { password = utf8.decode(plain) } catch { result.skipped++; continue }
          if (!password) { result.skipped++; continue }
          const record = {
            origin,
            action: webOrigin(row.action_url),
            realm: typeof row.signon_realm === 'string' ? row.signon_realm : origin,
            username: row.username_value,
            password,
          }
          payloadEstimate += Buffer.byteLength(JSON.stringify(record), 'utf8') + 1
          if (payloadEstimate > MAX_VAULT_PAYLOAD_BYTES || records.length >= CREDENTIAL_LIMIT) {
            throw new Error('browser-credentials-store-too-large')
          }
          records.push(record)
        } finally { plain?.fill(0); encrypted.fill(0) }
      }
    }
    result.count = records.length
    if (records.length > 0) {
      payload = Buffer.from(JSON.stringify({ version: 1, profileId: profile.id, credentials: records }), 'utf8')
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', vaultKey, nonce)
      const data = Buffer.concat([cipher.update(payload), cipher.final()])
      result.sealedBlob = JSON.stringify({
        version: 1,
        format: 'rox-browser-credentials',
        cipher: 'aes-256-gcm',
        iv: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      })
    }
    return result
  } finally {
    key?.fill(0)
    payload?.fill(0)
    // JavaScript strings cannot be overwritten. Drop references immediately;
    // no plaintext records are persisted, returned, or included in exceptions.
    for (const record of records) { record.password = ''; record.username = ''; record.realm = ''; record.origin = '' }
    records.length = 0
  }
}
