/**
 * W1-12 (#1509) — deterministic ids: RFC 3174 SHA-1 and RFC 4122 v5 UUIDs.
 * The vectors are the published ones, so a change in the implementation is
 * caught before it re-keys every derived id.
 */
import { describe, expect, test } from 'bun:test'
import {
  ROX_UUID_NAMESPACE,
  UUID_NAMESPACE_DNS,
  sha1Bytes,
  uuidv5,
} from '../ids'

const hex = (bytes: Uint8Array): string => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

describe('sha1', () => {
  test('matches the RFC 3174 vectors', () => {
    expect(hex(sha1Bytes(new TextEncoder().encode('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(hex(sha1Bytes(new TextEncoder().encode('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(hex(sha1Bytes(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))))
      .toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  })

  test('handles multi-block input (the padding path)', () => {
    const long = 'a'.repeat(1000)
    expect(hex(sha1Bytes(new TextEncoder().encode(long)))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba')
  })
})

describe('uuidv5', () => {
  test('matches the published name-based vectors', () => {
    // Both are the widely published expectations for the DNS namespace.
    expect(uuidv5('python.org', UUID_NAMESPACE_DNS)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
    expect(uuidv5('hello.example.com', UUID_NAMESPACE_DNS)).toBe('fdda765f-fc57-5604-a269-52a7df8164ec')
  })

  test('is deterministic, version 5 and variant 1', () => {
    const first = uuidv5('R1:event:single:principal-mark')
    const second = uuidv5('R1:event:single:principal-mark')
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first).not.toBe(uuidv5('R1:event:single:principal-other'))
    expect(first).not.toBe(uuidv5('R1:event:single:principal-mark', UUID_NAMESPACE_DNS))
    expect(ROX_UUID_NAMESPACE).toMatch(/^[0-9a-f-]{36}$/)
  })
})