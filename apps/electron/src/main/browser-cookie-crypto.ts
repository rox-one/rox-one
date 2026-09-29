/**
 * Chromium cookie-store decryption helpers (pure, no Electron imports).
 *
 * macOS: values are prefixed `v10`, encrypted with AES-128-CBC; the key is
 * PBKDF2-SHA1(password = "<Brand> Safe Storage" keychain secret, salt
 * "saltysalt", 1003 iterations, 16 bytes) and the IV is 16 spaces.
 * Linux (basic store): same scheme, password "peanuts", 1 iteration.
 * Since cookie DB meta version 24 the plaintext starts with a 32-byte
 * SHA-256 of the host key, which is stripped.
 */

import { createDecipheriv, pbkdf2Sync } from 'node:crypto'

export interface ChromiumCookieRow {
  host_key: string
  name: string
  value: string
  encrypted_value: Uint8Array | null
  path: string
  expires_utc: number | bigint
  is_secure: number | bigint
  is_httponly: number | bigint
  samesite: number | bigint
  has_expires?: number | bigint
  is_persistent?: number | bigint
}

export interface ElectronCookieInput {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** Keychain "Safe Storage" service per Chromium-family browser directory. */
export function safeStorageServiceFor(profilePath: string): string {
  const p = profilePath.replaceAll('\\', '/')
  if (p.includes('/Google/Chrome')) return 'Chrome Safe Storage'
  if (p.includes('/Microsoft Edge')) return 'Microsoft Edge Safe Storage'
  if (p.includes('/BraveSoftware/')) return 'Brave Safe Storage'
  if (p.includes('/com.operasoftware.')) return 'Opera Safe Storage'
  if (p.includes('/Vivaldi')) return 'Vivaldi Safe Storage'
  if (p.includes('/Yandex/')) return 'Yandex Safe Storage'
  if (p.includes('/Arc/')) return 'Arc Safe Storage'
  if (p.includes('/Perplexity')) return 'Comet Safe Storage'
  if (p.includes('/Chromium')) return 'Chromium Safe Storage'
  return 'Chrome Safe Storage'
}

/** Human browser name for status lines. */
export function browserNameFor(profilePath: string): string {
  const p = profilePath.replaceAll('\\', '/')
  if (p.includes('/Google/Chrome Canary')) return 'Chrome Canary'
  if (p.includes('/Google/Chrome Beta')) return 'Chrome Beta'
  if (p.includes('/Google/Chrome Dev')) return 'Chrome Dev'
  if (p.includes('/Google/Chrome')) return 'Google Chrome'
  if (p.includes('/Microsoft Edge')) return 'Microsoft Edge'
  if (p.includes('/BraveSoftware/')) return 'Brave'
  if (p.includes('/com.operasoftware.OperaGX')) return 'Opera GX'
  if (p.includes('/com.operasoftware.')) return 'Opera'
  if (p.includes('/Vivaldi')) return 'Vivaldi'
  if (p.includes('/Yandex/')) return 'Yandex Browser'
  if (p.includes('/Perplexity')) return 'Comet'
  if (p.includes('/Chromium')) return 'Chromium'
  return 'Chromium'
}

export function deriveChromiumKey(password: string, iterations = 1003): Buffer {
  return pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1')
}

export function decryptChromiumValue(
  encrypted: Uint8Array | null | undefined,
  key: Buffer,
  metaVersion: number,
): string | null {
  if (!encrypted || encrypted.length === 0) return null
  const buf = Buffer.from(encrypted)
  const prefix = buf.subarray(0, 3).toString('latin1')
  if (prefix !== 'v10' && prefix !== 'v11') return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    let plain = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()])
    if (metaVersion >= 24 && plain.length >= 32) plain = plain.subarray(32)
    return plain.toString('utf8')
  } catch {
    return null
  }
}

const WINDOWS_EPOCH_OFFSET_S = 11_644_473_600

/** Chromium expires_utc (µs since 1601) → Unix seconds; undefined = session cookie. */
export function chromiumExpiryToUnix(expiresUtc: number | bigint): number | undefined {
  const micro = typeof expiresUtc === 'bigint' ? Number(expiresUtc) : expiresUtc
  if (!micro) return undefined
  return micro / 1_000_000 - WINDOWS_EPOCH_OFFSET_S
}

const SAME_SITE: Record<number, ElectronCookieInput['sameSite']> = {
  [-1]: 'unspecified',
  0: 'no_restriction',
  1: 'lax',
  2: 'strict',
}

/** Map a decrypted row to Electron's cookies.set() input. Returns null for expired/invalid rows. */
export function toElectronCookie(row: ChromiumCookieRow, value: string, nowS = Date.now() / 1000): ElectronCookieInput | null {
  if (!row.host_key || !row.name) return null
  const expirationDate = chromiumExpiryToUnix(row.expires_utc)
  if (expirationDate !== undefined && expirationDate <= nowS) return null
  const secure = Number(row.is_secure) === 1
  const host = row.host_key.startsWith('.') ? row.host_key.slice(1) : row.host_key
  const path = row.path || '/'
  let sameSite = SAME_SITE[Number(row.samesite)] ?? 'unspecified'
  if (sameSite === 'no_restriction' && !secure) sameSite = 'unspecified'
  return {
    url: `${secure ? 'https' : 'http'}://${host}${path}`,
    name: row.name,
    value,
    // Host-only cookies (no leading dot) must not carry a domain attribute.
    domain: row.host_key.startsWith('.') ? row.host_key : undefined,
    path,
    secure,
    httpOnly: Number(row.is_httponly) === 1,
    expirationDate,
    sameSite,
  }
}
