import { describe, expect, test } from 'bun:test'
import { decodeCommandEnvelope, decodeCommandReceipt, decodeRealtimeSubscribeRequest, decodeRealtimeUnsubscribeRequest } from '../schemas'
import { COMMAND_BUS_WORKBENCH_FLAG, isCommandBusEnabled } from '../../feature-flags'

const base = { commandId: 'c1', type: 'system.ping', payload: {}, issuedAt: '2026-10-08T00:00:00.000Z' }

describe('decodeCommandEnvelope', () => {
  test('defaults idempotencyKey to commandId', () => {
    const decoded = decodeCommandEnvelope(base)
    expect(decoded).toEqual({ ok: true, value: { ...base, idempotencyKey: 'c1' } as never })
  })

  test('accepts target, origin and hints', () => {
    const decoded = decodeCommandEnvelope({ ...base, idempotencyKey: 'k', target: { kind: 'task', id: 't' }, expectedRevision: 2, origin: { kind: 'message', chatRef: 'ch', seq: 3 }, authorityHint: 'workspace', correlationId: 'corr' })
    expect(decoded.ok).toBe(true)
  })

  test.each([
    ['missing commandId', { ...base, commandId: undefined }],
    ['empty commandId', { ...base, commandId: '' }],
    ['oversized commandId', { ...base, commandId: 'x'.repeat(257) }],
    ['bad type', { ...base, type: 'Ping' }],
    ['bad target kind', { ...base, target: { kind: 'nope', id: 'x' } }],
    ['negative revision', { ...base, expectedRevision: -1 }],
    ['bad issuedAt', { ...base, issuedAt: 'yesterday' }],
    ['smuggled actor', { ...base, actorId: 'admin' }],
    ['smuggled workspace', { ...base, workspaceId: 'other' }],
    ['not an object', 'system.ping'],
  ])('rejects %s', (_label, input) => {
    const decoded = decodeCommandEnvelope(input)
    expect(decoded.ok).toBe(false)
  })
})

describe('receipt + subscribe schemas', () => {
  test('receipt round-trip', () => {
    expect(decodeCommandReceipt({ commandId: 'c', status: 'applied', eventIds: ['e'], revision: 1 }).ok).toBe(true)
    expect(decodeCommandReceipt({ commandId: 'c', status: 'rejected', error: { code: 'FORBIDDEN', message: 'no' } }).ok).toBe(true)
    expect(decodeCommandReceipt({ commandId: 'c', status: 'weird' }).ok).toBe(false)
    expect(decodeCommandReceipt({ commandId: 'c', status: 'rejected', error: { code: 'NOPE', message: '' } }).ok).toBe(false)
  })

  test('subscribe requests are bounded; topic names are checked per topic later', () => {
    expect(decodeRealtimeSubscribeRequest({ topics: [{ topic: 'user:u', sinceSeq: 3, epoch: 'e' }] }).ok).toBe(true)
    expect(decodeRealtimeSubscribeRequest({ topics: [{ topic: 'bogus' }] }).ok).toBe(true)
    expect(decodeRealtimeSubscribeRequest({ topics: [] }).ok).toBe(false)
    expect(decodeRealtimeSubscribeRequest({ topics: Array.from({ length: 101 }, () => ({ topic: 'user:u' })) }).ok).toBe(false)
    expect(decodeRealtimeSubscribeRequest({ topics: [{ topic: 'user:u', sinceSeq: -1 }] }).ok).toBe(false)
    expect(decodeRealtimeUnsubscribeRequest({ topics: ['user:u'] }).ok).toBe(true)
    expect(decodeRealtimeUnsubscribeRequest({ topics: ['bogus'] }).ok).toBe(false)
  })
})

describe('isCommandBusEnabled', () => {
  test('default off; workbench flag or env override turn it on', () => {
    const saved = process.env.CRAFT_FEATURE_COMMAND_BUS
    delete process.env.CRAFT_FEATURE_COMMAND_BUS
    try {
      expect(isCommandBusEnabled()).toBe(false)
      expect(isCommandBusEnabled(new Set())).toBe(false)
      expect(isCommandBusEnabled(new Set([COMMAND_BUS_WORKBENCH_FLAG]))).toBe(true)
      process.env.CRAFT_FEATURE_COMMAND_BUS = '0'
      expect(isCommandBusEnabled(new Set([COMMAND_BUS_WORKBENCH_FLAG]))).toBe(false)
      process.env.CRAFT_FEATURE_COMMAND_BUS = '1'
      expect(isCommandBusEnabled()).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.CRAFT_FEATURE_COMMAND_BUS
      else process.env.CRAFT_FEATURE_COMMAND_BUS = saved
    }
  })
})

describe('review 2: text Postgres cannot store and unsafe revisions are VALIDATION', () => {
  test.each([
    ['NUL in commandId', { ...base, commandId: 'c\u0000' }],
    ['control character in idempotencyKey', { ...base, idempotencyKey: 'k\n1' }],
    ['DEL in correlationId', { ...base, correlationId: 'x\u007f' }],
    ['NUL in a payload string', { ...base, payload: { title: 'a\u0000b' } }],
    ['NUL in a payload key', { ...base, payload: { ['a\u0000']: 1 } }],
    ['NUL deep in an array', { ...base, payload: { items: [{ nested: ['ok', 'bad\u0000'] }] } }],
    ['lone surrogate in a payload string', { ...base, payload: { title: 'x\ud800y' } }],
    ['revision beyond MAX_SAFE_INTEGER', { ...base, expectedRevision: 2 ** 53 }],
    ['revision 1e300', { ...base, expectedRevision: 1e300 }],
  ])('rejects %s', (_name, input) => {
    const decoded = decodeCommandEnvelope(input)
    expect(decoded.ok).toBe(false)
  })

  test('accepts MAX_SAFE_INTEGER, paired surrogates and escaped-looking text', () => {
    expect(decodeCommandEnvelope({ ...base, expectedRevision: Number.MAX_SAFE_INTEGER }).ok).toBe(true)
    expect(decodeCommandEnvelope({ ...base, payload: { emoji: '😀', literal: '\\u0000', tab: 'a\tb' } }).ok).toBe(true)
  })

  test('deep nesting is scanned without recursion limits', () => {
    let payload: unknown = 'leaf\u0000'
    for (let i = 0; i < 20_000; i += 1) payload = [payload]
    expect(decodeCommandEnvelope({ ...base, payload }).ok).toBe(false)
  })
})
