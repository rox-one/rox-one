/**
 * Dependency-free TOTP (RFC 6238) over HOTP (RFC 4226).
 *
 * SHA-1 only, 30-second period, 6 digits by default — the profile every
 * mainstream authenticator uses. Verification accepts the RFC's ±1 window.
 * Secrets are base32 (RFC 4648, padding tolerated, case-insensitive).
 */
import { createHmac } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE32_LOOKUP: Record<string, number> = {}
for (let index = 0; index < BASE32_ALPHABET.length; index++) {
  BASE32_LOOKUP[BASE32_ALPHABET[index]!] = index
}

export const TOTP_DEFAULT_PERIOD_SECONDS = 30
export const TOTP_DEFAULT_DIGITS = 6
export const TOTP_DEFAULT_WINDOW = 1

/** Decode an RFC 4648 base32 secret; throws on any character outside the alphabet. */
export function base32Decode(secret: string): Buffer {
  if (typeof secret !== 'string') throw new Error('totp-secret-invalid')
  const normalized = secret.replace(/[\s=]/g, '').toUpperCase()
  if (!normalized) throw new Error('totp-secret-invalid')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of normalized) {
    const value = BASE32_LOOKUP[character]
    if (value === undefined) throw new Error('totp-secret-invalid')
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  if (bytes.length === 0) throw new Error('totp-secret-invalid')
  return Buffer.from(bytes)
}

/** RFC 4226 HOTP truncation for one counter value. */
export function hotp(secret: string | Buffer, counter: number, digits = TOTP_DEFAULT_DIGITS): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('totp-counter-invalid')
  if (!Number.isSafeInteger(digits) || digits < 6 || digits > 10) throw new Error('totp-digits-invalid')
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

export function totpCounter(atMs: number, periodSeconds = TOTP_DEFAULT_PERIOD_SECONDS): number {
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds < 1) throw new Error('totp-period-invalid')
  return Math.floor(Math.floor(atMs / 1000) / periodSeconds)
}

/** TOTP code for the given instant (defaults to `Date.now()`). */
export function totp(
  secret: string | Buffer,
  options: { atMs?: number; periodSeconds?: number; digits?: number } = {},
): string {
  const period = options.periodSeconds ?? TOTP_DEFAULT_PERIOD_SECONDS
  const atMs = options.atMs ?? Date.now()
  return hotp(secret, totpCounter(atMs, period), options.digits ?? TOTP_DEFAULT_DIGITS)
}

/** Milliseconds until the current code rotates (1..period*1000). */
export function totpSecondsRemaining(atMs: number, periodSeconds = TOTP_DEFAULT_PERIOD_SECONDS): number {
  const periodMs = periodSeconds * 1000
  const elapsed = ((atMs % periodMs) + periodMs) % periodMs
  return Math.ceil((periodMs - elapsed) / 1000)
}

/** Absolute epoch ms at which the code covering `atMs` expires. */
export function totpExpiresAt(atMs: number, periodSeconds = TOTP_DEFAULT_PERIOD_SECONDS): number {
  const periodMs = periodSeconds * 1000
  return (totpCounter(atMs, periodSeconds) + 1) * periodMs
}

/** Constant-shape verification across the ±`window` counters. */
export function verifyTotp(
  secret: string | Buffer,
  code: string,
  options: { atMs?: number; periodSeconds?: number; digits?: number; window?: number } = {},
): boolean {
  if (typeof code !== 'string') return false
  const digits = options.digits ?? TOTP_DEFAULT_DIGITS
  const period = options.periodSeconds ?? TOTP_DEFAULT_PERIOD_SECONDS
  const atMs = options.atMs ?? Date.now()
  const window = options.window ?? TOTP_DEFAULT_WINDOW
  const expected = code.trim()
  if (!new RegExp(`^\\d{${digits}}$`).test(expected)) return false
  const counter = totpCounter(atMs, period)
  let matched = false
  for (let offset = -window; offset <= window; offset++) {
    if (counter + offset < 0) continue
    if (hotp(secret, counter + offset, digits) === expected) matched = true
  }
  return matched
}