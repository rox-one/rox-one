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
