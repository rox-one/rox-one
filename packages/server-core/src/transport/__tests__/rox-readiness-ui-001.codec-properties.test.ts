import { describe, expect, test } from 'bun:test'
import { deserializeEnvelope, serializeEnvelope } from '../codec'

describe('UI-001 RPC wire properties stay data', () => {
  test('prototype fields cannot supply required envelope identity', () => {
    const raw = '{"__proto__":{"id":"inherited","type":"event","channel":"private"}}'
    expect(() => deserializeEnvelope(raw)).toThrow('Invalid envelope shape')
    expect(({} as Record<string, unknown>).id).toBeUndefined()
  })

  test('nested arbitrary keys round-trip without invoking the prototype setter', () => {
    const raw = '{"id":"own","type":"response","result":{"__proto__":{"injected":"payload"},"constructor":{"prototype":{"value":42}},"prototype":"ordinary","nested":[{"__proto__":"literal"}]}}'
    const envelope = deserializeEnvelope(raw)
    const result = envelope.result as Record<string, any>
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(result.__proto__).toEqual({ injected: 'payload' })
    expect(result.injected).toBeUndefined()
    expect(result['constructor'] as unknown).toEqual({ prototype: { value: 42 } })
    expect(result.prototype).toBe('ordinary')
    expect(Object.hasOwn(result.nested[0], '__proto__')).toBe(true)
    expect(JSON.parse(serializeEnvelope(envelope))).toEqual(JSON.parse(raw))
    expect(({} as Record<string, unknown>).injected).toBeUndefined()
  })

  test('binary payload decoding still works alongside literal special keys', () => {
    const raw = '{"id":"bytes","type":"response","result":{"data":{"__craftRpcType":"u8","base64":"AAH/"},"__proto__":null}}'
    const envelope = deserializeEnvelope(raw)
    const result = envelope.result as Record<string, any>
    expect(result.data).toEqual(new Uint8Array([0, 1, 255]))
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(result.__proto__).toBeNull()
    expect(JSON.parse(serializeEnvelope(envelope))).toEqual(JSON.parse(raw))
  })
})
