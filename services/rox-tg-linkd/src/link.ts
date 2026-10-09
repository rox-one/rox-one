/**
 * Pure linking primitives: the code alphabet, the 30-minute TTL, deep links
 * and code normalisation. Nothing here touches the network or the database,
 * so every rule is directly unit-testable.
 *
 * Owner spec (R4): кнопка → бот → Start → поделиться телефоном → 8-значный код
 * → ввод в приложении, 30 минут, авто-проверка на 8-м символе.
 */
import { randomBytes, randomInt } from 'node:crypto'

/**
 * 8-character codes use A-Z and 2-9 (digits 0 and 1 are excluded — they are
 * routinely confused with O/I when the user retypes the code by hand).
 */
export const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 8
/** Owner spec: the code is valid for 30 minutes. */
export const LINK_TTL_MS = 30 * 60 * 1000
/** A pending link is invalidated after this many wrong codes. */
export const MAX_ATTEMPTS = 10
/** Telegram link host used when the tg:// scheme is not handled. */
export const TELEGRAM_HTTPS_HOST = 'https://t.me'

/** Service-side state of a link. `none` means the user has no pending link. */
export type LinkStatus = 'none' | 'waiting-code' | 'code-sent' | 'linked' | 'expired'

/** Injectable index generator so tests get deterministic codes. */
export type RandomIndex = (maxExclusive: number) => number

export function generateCode(randomIndex: RandomIndex = randomInt): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)]
  return out
}

/** Opaque per-link secret embedded in the bot deep link (`/start <token>`). */
export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Uppercase, drop separators (the dialog may show `ABCD-2345`) and any other
 * punctuation, so a pasted or hand-typed code compares correctly.
 */
export function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** True when `input` (raw) has the exact shape of a code: 8 chars, A-Z / 2-9. */
export function isWellFormedCode(input: unknown): boolean {
  const code = normalizeCode(input)
  if (code.length !== CODE_LENGTH) return false
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return false
  return true
}

/** `https://t.me/<bot>?start=<token>` — used as the tg:// fallback. */
export function deepLinkHttps(botUsername: string, token: string): string {
  return `${TELEGRAM_HTTPS_HOST}/${botUsername}?start=${encodeURIComponent(token)}`
}

/** `tg://resolve?domain=<bot>&start=<token>` — opens the desktop/mobile app. */
export function deepLinkTg(botUsername: string, token: string): string {
  return `tg://resolve?domain=${encodeURIComponent(botUsername)}&start=${encodeURIComponent(token)}`
}

/** Extract the `/start <token>` payload from a bot message, if present. */
export function parseStartPayload(text: unknown): { command: string; payload: string | null } | null {
  if (typeof text !== 'string') return null
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(text.trim())
  if (!match) return null
  return { command: match[1]!.toLowerCase(), payload: match[2] ?? null }
}

/**
 * Effective status of a stored pending row at time `now`: an unlinked row past
 * its TTL is expired even before the sweep writes that back.
 */
export function effectiveStatus(status: LinkStatus, expiresAt: number, now: number): LinkStatus {
  if (status === 'linked' || status === 'expired') return status
  return expiresAt <= now ? 'expired' : status
}