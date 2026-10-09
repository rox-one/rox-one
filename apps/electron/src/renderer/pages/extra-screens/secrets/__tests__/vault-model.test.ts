import { describe, expect, it } from 'bun:test'
import type { KeeperItemView } from '../../../../../shared/types'
import { filterVaultItems, formatTotpCode, generatePassword, isExpired, PASSWORD_CLASSES, totpSecondsLeft } from '../vault-model'

function view(overrides: Partial<KeeperItemView>): KeeperItemView {
  return {
    id: 'id', kind: 'login', title: 'Item', tags: [], folders: [], createdAt: 0, updatedAt: 0,
    hasPassword: false, hasTotpSecret: false, password: null, totpSecret: null, ...overrides,
  }
}

const items: KeeperItemView[] = [
  view({ id: '1', title: 'Банк', username: 'ann@example.com', folders: ['Работа'], favorite: true }),
  view({ id: '2', title: 'GitHub', username: 'octocat', folders: ['Работа', 'Из браузера'] }),
  view({ id: '3', title: 'Почта', username: 'mail', folders: ['Личное'] }),
]

describe('filterVaultItems', () => {
  it('searches title and username case-insensitively', () => {
    expect(filterVaultItems(items, { folder: null, search: 'git', favoritesOnly: false }).map((item) => item.id)).toEqual(['2'])
    expect(filterVaultItems(items, { folder: null, search: 'ANN@', favoritesOnly: false }).map((item) => item.id)).toEqual(['1'])
  })

  it('scopes to a folder and to favorites', () => {
    expect(filterVaultItems(items, { folder: 'Работа', search: '', favoritesOnly: false }).map((item) => item.id)).toEqual(['1', '2'])
    expect(filterVaultItems(items, { folder: null, search: '', favoritesOnly: true }).map((item) => item.id)).toEqual(['1'])
    expect(filterVaultItems(items, { folder: 'Из браузера', search: '', favoritesOnly: false }).map((item) => item.id)).toEqual(['2'])
  })
})

describe('generatePassword', () => {
  const deterministic = (size: number) => new Uint8Array(size).fill(11)

  it('produces the requested length with one character from every class', () => {
    const password = generatePassword(24, deterministic)
    expect(password.length).toBe(24)
    expect([...password].some((character) => PASSWORD_CLASSES.upper.includes(character))).toBe(true)
    expect([...password].some((character) => PASSWORD_CLASSES.lower.includes(character))).toBe(true)
    expect([...password].some((character) => PASSWORD_CLASSES.digits.includes(character))).toBe(true)
    expect([...password].some((character) => PASSWORD_CLASSES.symbols.includes(character))).toBe(true)
  })

  it('clamps out-of-range lengths and draws from the real CSPRNG by default', () => {
    expect(generatePassword(1).length).toBe(8)
    expect(generatePassword(999).length).toBe(64)
    expect(generatePassword()).not.toBe(generatePassword())
  })
})

describe('totp helpers', () => {
  it('formats six-digit codes with a space and leaves others intact', () => {
    expect(formatTotpCode('123456')).toBe('123 456')
    expect(formatTotpCode('12345678')).toBe('12345678')
  })

  it('computes the countdown and expiry', () => {
    expect(totpSecondsLeft(60_000, 59_000)).toBe(1)
    expect(totpSecondsLeft(60_000, 61_000)).toBe(0)
    expect(isExpired(1000, 1000)).toBe(true)
    expect(isExpired(undefined, 1000)).toBe(false)
    expect(isExpired(2000, 1000)).toBe(false)
  })
})