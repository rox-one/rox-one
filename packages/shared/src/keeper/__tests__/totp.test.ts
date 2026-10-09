import { describe, expect, it } from 'bun:test'
import { base32Decode, hotp, totp, totpCounter, totpExpiresAt, totpSecondsRemaining, verifyTotp } from '../totp'

// RFC 4226 / RFC 6238 test secrets.
const ASCII_SECRET = '12345678901234567890'
const BASE32_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('base32Decode', () => {
  it('decodes the RFC secret to its ASCII bytes', () => {
    expect(base32Decode(BASE32_SECRET).toString('ascii')).toBe(ASCII_SECRET)
  })

  it('tolerates padding, whitespace and lowercase', () => {
    expect(base32Decode('gezdgnbvgy3tqojqgezdgnbvgy3tqojq===').toString('ascii')).toBe(ASCII_SECRET)
  })

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('0189!')).toThrow('totp-secret-invalid')
  })
})

describe('hotp (RFC 4226 appendix D vectors, 6 digits)', () => {
  const vectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  it.each(vectors.map((code, counter) => [counter, code] as const))('counter %i → %s', (counter, code) => {
    expect(hotp(Buffer.from(ASCII_SECRET), counter, 6)).toBe(code)
    expect(hotp(base32Decode(BASE32_SECRET), counter, 6)).toBe(code)
  })
})

describe('totp (RFC 6238 appendix B SHA-1 vectors, 8 digits)', () => {
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]
  it.each(vectors)('T=%i → %s', (seconds, code) => {
    expect(totp(BASE32_SECRET, { atMs: seconds * 1000, digits: 8 })).toBe(code)
  })

  it('uses 6 digits and a 30-second period by default', () => {
    // T=59 → 8-digit 94287082 → low 6 digits 287082.
    expect(totp(BASE32_SECRET, { atMs: 59_000 })).toBe('287082')
    expect(totpCounter(59_000)).toBe(1)
    expect(totpSecondsRemaining(59_000)).toBe(1)
    expect(totpSecondsRemaining(30_000)).toBe(30)
    expect(totpExpiresAt(59_000)).toBe(60_000)
  })
})

describe('verifyTotp window', () => {
  const at = 1_111_111_109_000
  const code = totp(BASE32_SECRET, { atMs: at })
  it('accepts the current and neighbouring counters within ±1', () => {
    expect(verifyTotp(BASE32_SECRET, code, { atMs: at })).toBe(true)
    expect(verifyTotp(BASE32_SECRET, code, { atMs: at + 30_000 })).toBe(true)
    expect(verifyTotp(BASE32_SECRET, code, { atMs: at - 30_000 })).toBe(true)
  })
  it('rejects codes outside the window and malformed input', () => {
    expect(verifyTotp(BASE32_SECRET, code, { atMs: at + 90_000 })).toBe(false)
    expect(verifyTotp(BASE32_SECRET, '000000', { atMs: at })).toBe(false)
    expect(verifyTotp(BASE32_SECRET, 'abcdef', { atMs: at })).toBe(false)
  })
})