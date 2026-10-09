import { describe, expect, test } from 'bun:test'
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  LINK_TTL_MS,
  deepLinkHttps,
  effectiveStatus,
  generateCode,
  isWellFormedCode,
  maskPhone,
  normalizeCode,
  parseStartPayload,
} from '../src/link.ts'

const NOW = 1_700_000_000_000

describe('code primitives', () => {
  test('the alphabet is letters only and codes are 8 characters', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    expect([...CODE_ALPHABET].length).toBe(26)
    expect(CODE_LENGTH).toBe(8)
    expect(LINK_TTL_MS).toBe(30 * 60 * 1000)
  })

  test('generated codes are 8 letters from the alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode()
      expect(code).toMatch(/^[A-Z]{8}$/)
    }
    expect(generateCode(() => 0)).toBe('AAAAAAAA')
    expect(generateCode(max => max - 1)).toBe('ZZZZZZZZ')
  })

  test('normalisation accepts lowercase and separators, and shape checks are strict', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH')
    expect(normalizeCode(' abcd efgh ')).toBe('ABCDEFGH')
    expect(normalizeCode('ABCD1234')).toBe('ABCD')
    expect(normalizeCode(42)).toBe('')
    expect(isWellFormedCode('abcd-efgh')).toBe(true)
    expect(isWellFormedCode('abcdefg')).toBe(false)
    expect(isWellFormedCode('abcdefghi')).toBe(false)
    expect(isWellFormedCode('ABCD1234')).toBe(false)
    expect(isWellFormedCode('АВСDEFGH')).toBe(false) // Cyrillic lookalikes must not pass
  })

  test('maskPhone keeps only the country digit and last two digits', () => {
    expect(maskPhone('+7 (999) 123-45-67')).toBe('+7********67')
    expect(maskPhone('79991234567')).toBe('+7********67')
    expect(maskPhone('123')).toBe('+1*23')
    expect(maskPhone('12')).toBe('**')
    expect(maskPhone('')).toBe('')
  })

  test('deep links carry the link id', () => {
    expect(deepLinkHttps('rox_bot', 'abc123')).toBe('https://t.me/rox_bot?start=abc123')
    expect(deepLinkHttps('rox_bot', 'a b')).toBe('https://t.me/rox_bot?start=a%20b')
  })

  test('start payloads parse to command + payload', () => {
    expect(parseStartPayload('/start abc123')).toEqual({ command: 'start', payload: 'abc123' })
    expect(parseStartPayload('/start@rox_bot abc123')).toEqual({ command: 'start', payload: 'abc123' })
    expect(parseStartPayload('/start')).toEqual({ command: 'start', payload: null })
    expect(parseStartPayload('/status')).toEqual({ command: 'status', payload: null })
    expect(parseStartPayload('hello')).toBe(null)
    expect(parseStartPayload(null)).toBe(null)
  })

  test('effective status expires unconfirmed links past their TTL', () => {
    expect(effectiveStatus('waiting', NOW + LINK_TTL_MS, NOW)).toBe('waiting')
    expect(effectiveStatus('waiting', NOW, NOW)).toBe('expired')
    expect(effectiveStatus('code_issued', NOW - 1, NOW)).toBe('expired')
    expect(effectiveStatus('confirmed', NOW - 1, NOW)).toBe('confirmed')
    expect(effectiveStatus('expired', NOW + LINK_TTL_MS, NOW)).toBe('expired')
  })
})