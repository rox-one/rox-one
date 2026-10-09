/**
 * Pure view-model helpers for the «Секреты» vault surface: password generation,
 * list filtering and code formatting. No React, so it stays unit-testable.
 */
import type { KeeperItemKind, KeeperItemView } from '../../../../shared/types'

export const KEEPER_KIND_OPTIONS: readonly KeeperItemKind[] = ['login', 'note', 'card', 'identity', 'totp']

export const PASSWORD_CLASSES = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
} as const

export type RandomSource = (size: number) => Uint8Array

const cryptoRandom: RandomSource = (size) => globalThis.crypto.getRandomValues(new Uint8Array(size))

function randomInt(maxExclusive: number, random: RandomSource): number {
  const limit = 256 - (256 % maxExclusive)
  for (;;) {
    const byte = random(1)[0]
    if (byte < limit) return byte % maxExclusive
  }
}

function randomIndex(alphabet: string, random: RandomSource): string {
  return alphabet[randomInt(alphabet.length, random)]
}

/** Cryptographically random password with at least one character per class. */
export function generatePassword(length = 20, random: RandomSource = cryptoRandom): string {
  const size = Math.max(8, Math.min(64, Math.floor(length)))
  const classes = Object.values(PASSWORD_CLASSES)
  const pool = classes.join('')
  const characters: string[] = []
  for (let index = 0; index < size; index++) characters.push(randomIndex(pool, random))
  for (let index = 0; index < classes.length && index < size; index++) characters[index] = randomIndex(classes[index], random)
  for (let index = characters.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1, random)
    const temporary = characters[index]
    characters[index] = characters[swap]
    characters[swap] = temporary
  }
  return characters.join('')
}

export interface VaultFilter {
  /** Folder name, or `null` for all folders. */
  folder: string | null
  search: string
  favoritesOnly: boolean
}

/** Case-insensitive title/username search within the selected folder. */
export function filterVaultItems(items: readonly KeeperItemView[], filter: VaultFilter): KeeperItemView[] {
  const needle = filter.search.trim().toLowerCase()
  return items.filter((item) => {
    if (filter.folder && !item.folders.includes(filter.folder)) return false
    if (filter.favoritesOnly && !item.favorite) return false
    if (!needle) return true
    return item.title.toLowerCase().includes(needle) || (item.username ?? '').toLowerCase().includes(needle)
  })
}

/** `123456` → `123 456` — matches authenticator display without changing the value. */
export function formatTotpCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

export function totpSecondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

export function isExpired(expiresAt: number | undefined, now: number): boolean {
  return typeof expiresAt === 'number' && expiresAt > 0 && expiresAt <= now
}