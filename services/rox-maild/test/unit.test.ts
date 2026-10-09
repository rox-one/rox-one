/**
 * Unit tests for the pure parts of rox-maild (no network, no Stalwart).
 *
 *   bun test services/rox-maild/test
 */
import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { bareAddress, prepareData } from '../src/smtp.ts'
import { hmacHex, verifySignature } from '../src/signature.ts'
import { decodeRawBase64, dedupeKey } from '../src/inbound.ts'
import { IdempotencyCache } from '../src/idempotency.ts'

describe('signature', () => {
  test('accepts the correct hex HMAC and rejects everything else', () => {
    const secret = 'test-secret-value'
    const body = Buffer.from('{"hello":"world"}')
    const signature = createHmac('sha256', secret).update(body).digest('hex')
    expect(hmacHex(secret, body)).toBe(signature)
    expect(verifySignature(secret, body, signature)).toBe(true)
    expect(verifySignature(secret, body, signature.toUpperCase())).toBe(true)
    expect(verifySignature(secret, body, 'deadbeef')).toBe(false)
    expect(verifySignature(secret, body, null)).toBe(false)
    expect(verifySignature(secret, Buffer.from('other'), signature)).toBe(false)
  })
})

describe('bareAddress', () => {
  test('unwraps display names and rejects header injection', () => {
    expect(bareAddress('Mark <mark@rox.one>')).toBe('mark@rox.one')
    expect(bareAddress('  mark@rox.one ')).toBe('mark@rox.one')
    expect(bareAddress('mark@rox.one\r\nRCPT TO:<evil@x>')).toBe(null)
    expect(bareAddress('')).toBe(null)
  })
})

describe('prepareData', () => {
  test('normalises line endings and dot-stuffs', () => {
    const out = prepareData(Buffer.from('Subject: x\n\n.leading dot\nbody')).toString('latin1')
    expect(out).toBe('Subject: x\r\n\r\n..leading dot\r\nbody\r\n.\r\n')
  })
})

describe('decodeRawBase64', () => {
  test('round-trips canonical base64 and rejects junk', () => {
    const message = Buffer.from('From: a@b\r\n\r\nHello')
    expect(decodeRawBase64(message.toString('base64'))?.equals(message)).toBe(true)
    expect(decodeRawBase64('not base64!!')).toBe(null)
    expect(decodeRawBase64('')).toBe(null)
  })
})

describe('dedupeKey', () => {
  test('prefers Message-ID and falls back to a content hash', () => {
    expect(dedupeKey({ from: 'a', to: 'b', rawB64: '', messageId: ' <m1@x> ' }, Buffer.from('x'))).toBe('mid:<m1@x>')
    const a = dedupeKey({ from: 'a', to: 'b', rawB64: '' }, Buffer.from('x'))
    const b = dedupeKey({ from: 'a', to: 'b', rawB64: '' }, Buffer.from('x'))
    expect(a).toBe(b)
    expect(a.startsWith('sha:')).toBe(true)
  })
})

describe('IdempotencyCache', () => {
  test('runs once per key and evicts oldest beyond capacity', async () => {
    const cache = new IdempotencyCache<number>(2)
    let calls = 0
    const work = async () => ++calls
    expect(await cache.once('a', work)).toEqual({ value: 1, duplicate: false })
    expect(await cache.once('a', work)).toEqual({ value: 1, duplicate: true })
    expect(calls).toBe(1)
    await cache.once('b', work)
    await cache.once('c', work)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })
})