/**
 * Pure link primitives: the code alphabet, the 30-minute TTL, deep links and
 * code/phone normalisation. Nothing here touches the network or the database,
 * so every rule is directly unit-testable.
 *
 * Contract: bot issues an 8-letter code after the user shares their own phone;
 * the desktop client polls `/api/link/status` and confirms with
 * `/api/link/confirm`.
 */
import { randomBytes, randomInt } from 'node:crypto'

/** Codes are exactly 8 letters (A-Z). Digits are excluded by contract. */
export const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const CODE_LENGTH = 8
/** A link and its code are valid for 30 minutes. */
export const LINK_TTL_MS = 30 * 60 * 1000
/** A link is invalidated after this many wrong code attempts. */
export const MAX_ATTEMPTS = 5
/** Telegram link host used for the desktop deep link. */
export const TELEGRAM_HTTPS_HOST = 'https://t.me'

/** Service-side state of a link. */
export type LinkStatus = 'waiting' | 'code_issued' | 'confirmed' | 'expired'

/** Injectable index generator so tests get deterministic codes. */
export type RandomIndex = (maxExclusive: number) => number

export function generateCode(randomIndex: RandomIndex = randomInt): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)]
  return out
}

/** Opaque per-link identifier embedded in the bot deep link (`/start <linkId>`). */
export function generateLinkId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Uppercase, drop separators (the dialog may show `ABCD-EFGH`) and any other
 * punctuation, so a pasted or hand-typed code compares correctly.
 */
export function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.normalize('NFKC').toUpperCase().replace(/[^A-Z]/g, '')
}

/** True when `input` (raw) has the exact shape of a code: 8 letters A-Z. */
export function isWellFormedCode(input: unknown): boolean {
  const code = normalizeCode(input)
  if (code.length !== CODE_LENGTH) return false
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return false
  return true
}

/**
 * Mask a phone number for the status payload: keep the country digit and the
 * last two digits, hide the rest. Never exposes the full number to a caller
 * that only holds the short-lived desktop link.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 0) return ''
  if (digits.length <= 2) return '*'.repeat(digits.length)
  const head = digits.slice(0, 1)
  const tail = digits.slice(-2)
  return `+${head}${'*'.repeat(Math.max(1, digits.length - 3))}${tail}`
}

/** `https://t.me/<bot>?start=<linkId>` — the desktop deep link. */
export function deepLinkHttps(botUsername: string, linkId: string): string {
  return `${TELEGRAM_HTTPS_HOST}/${botUsername}?start=${encodeURIComponent(linkId)}`
}

/** Extract the `/start <payload>` (or `/status`) command from a bot message. */
export function parseStartPayload(text: unknown): { command: string; payload: string | null } | null {
  if (typeof text !== 'string') return null
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(text.trim())
  if (!match) return null
  return { command: match[1]!.toLowerCase(), payload: match[2] ?? null }
}

/**
 * Effective status of a stored row at time `now`: an unconfirmed row past its
 * TTL is expired even before the sweep writes that back.
 */
export function effectiveStatus(status: LinkStatus, expiresAt: number, now: number): LinkStatus {
  if (status === 'confirmed' || status === 'expired') return status
  return expiresAt <= now ? 'expired' : status
}