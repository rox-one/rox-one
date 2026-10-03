import { expect, it } from 'bun:test'
import { sanitizeRuntimeTrace } from './privacy'

it('projects private and public own data without executing accessors or inherited fields', () => {
  let accesses = 0
  const input = Object.create({ inherited: 'not-captured' })
  for (const key of ['password', 'publicGetter']) {
    Object.defineProperty(input, key, { enumerable: true, get: () => { accesses++; throw new Error('Getter must not execute') } })
  }
  input.safe = { authorization: 'Bearer fixture', text: 'Ordinary output' }
  const result = sanitizeRuntimeTrace(input) as Record<string, unknown>
  expect(accesses).toBe(0)
  expect(result.password).toBe('[REDACTED]')
  expect(result.publicGetter).toBe('[Accessor omitted]')
  expect(Object.hasOwn(result, 'inherited')).toBe(false)
  expect(result.safe).toEqual({ authorization: '[REDACTED]', text: 'Ordinary output' })
})

it('retains JSON prototype-name data without changing the projected prototype', () => {
  const result = sanitizeRuntimeTrace(JSON.parse('{"__proto__":{"marker":"fixture"},"constructor":{"password":"fixture"}}')) as Record<string, unknown>
  expect(Object.getPrototypeOf(result)).toBeNull()
  expect(Object.hasOwn(result, '__proto__')).toBe(true)
  expect(result.marker).toBeUndefined()
  expect(JSON.parse(JSON.stringify(result))).toEqual({ ['__proto__']: { marker: 'fixture' }, constructor: { password: '[REDACTED]' } })
})

it('does not execute indexed getters and retains circular and size boundaries', () => {
  let accesses = 0
  const values: unknown[] = ['safe']
  Object.defineProperty(values, '1', { enumerable: true, get: () => { accesses++; return 'private' } })
  values.push(values)
  expect(sanitizeRuntimeTrace(values)).toEqual(['safe', '[Accessor or hole omitted]', '[Circular]'])
  expect(accesses).toBe(0)
  const bounded = sanitizeRuntimeTrace(Array.from({ length: 20_000 }, () => 'safe')) as unknown[]
  expect(bounded.length).toBeLessThanOrEqual(10_000)
})
