import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createTableSurface, encodeTableSurface, getTableCapabilityAvailability,
  tableSourceKey, tableQueryKey, TABLE_CAPABILITIES,
} from '../index.ts'

const input = () => ({
  baseRef: { workspaceId: 'w', entityId: 'base:1' },
  tableId: 't', viewId: 'v', host: { kind: 'standalone' as const },
})
const surface = () => createTableSurface(input())
const all = () => Object.fromEntries(TABLE_CAPABILITIES.map(key => [key, true]))
const evidence = () => ({ sourceReadable: true, hostReadable: true, schemaSupported: true,
  hostMode: 'interactive', runtime: all(), grants: all() })

for (const [name, operation] of [
  ['encode', encodeTableSurface], ['source key', tableSourceKey], ['query key', tableQueryKey],
] as const) {
  test(`${name} refuses nonenumerable rows instead of silently dropping them`, () => {
    const value = surface()
    Object.defineProperty(value, 'rows', { value: [{ private: 'must-refuse' }], enumerable: false })
    assert.throws(() => operation(value), /invalid-shape/)
  })
}
test('factory refuses nonenumerable unknown fields', () => {
  const value = input()
  Object.defineProperty(value, 'rows', { value: [], enumerable: false })
  assert.throws(() => createTableSurface(value), /invalid-shape/)
})
for (const location of ['root', 'reference'] as const) {
  test(`encoder refuses unknown symbol fields on ${location}`, () => {
    const value = surface()
    Object.defineProperty(location === 'root' ? value : value.baseRef, Symbol('unknown'), { value: 'must-refuse' })
    assert.throws(() => encodeTableSurface(value), /invalid-shape/)
  })
}
for (const location of ['reference', 'host', 'mode', 'presentation'] as const) {
  test(`encoder refuses nonenumerable unknown fields in ${location}`, () => {
    const value = { ...surface(), presentation: { density: 'compact' as const } }
    const target = location === 'reference' ? value.baseRef : value[location]
    Object.defineProperty(target, 'rows', { value: [], enumerable: false })
    assert.throws(() => encodeTableSurface(value), /invalid-shape/)
  })
}
for (const [name, operation, value] of [
  ['factory', createTableSurface, input], ['encoder', encodeTableSurface, surface],
] as const) {
  test(`${name} refuses a known own accessor without executing it`, () => {
    let calls = 0
    const descriptor = value()
    Object.defineProperty(descriptor, 'baseRef', { get: () => { calls++; return input().baseRef }, enumerable: true })
    let failure: unknown
    try { operation(descriptor) } catch (error) { failure = error }
    assert.equal(calls, 0, 'validation must not execute user getters')
    assert.match(String(failure), /invalid-shape/)
  })
}
test('encoder refuses a nested reference getter without executing it', () => {
  let calls = 0
  const value = surface()
  Object.defineProperty(value.baseRef, 'entityId', { get: () => { calls++; return 'base:1' }, enumerable: true })
  let failure: unknown
  try { encodeTableSurface(value) } catch (error) { failure = error }
  assert.equal(calls, 0)
  assert.match(String(failure), /invalid-shape/)
})
test('factory preserves known nonenumerable data fields', () => {
  const value = input()
  Object.defineProperty(value, 'presentation', { value: { density: 'compact', showToolbar: false }, enumerable: false })
  assert.deepEqual(createTableSurface(value), { ...surface(), presentation: { density: 'compact', showToolbar: false } })
})
test('availability treats a source evidence accessor as denied without executing it', () => {
  let calls = 0
  const value = evidence()
  Object.defineProperty(value, 'sourceReadable', { get: () => { calls++; return true }, enumerable: true })
  const result = getTableCapabilityAvailability(surface(), value)
  assert.equal(calls, 0)
  for (const capability of Object.values(result)) assert.deepEqual(capability, { available: false, reason: 'source-denied' })
})
test('availability refuses runtime and grant map accessors without executing them', () => {
  for (const key of ['runtime', 'grants'] as const) {
    let calls = 0
    const value = evidence()
    Object.defineProperty(value, key, { get: () => { calls++; return all() }, enumerable: true })
    const result = getTableCapabilityAvailability(surface(), value)
    assert.equal(calls, 0)
    for (const capability of Object.values(result)) assert.deepEqual(capability, {
      available: false, reason: key === 'runtime' ? 'missing-runtime' : 'not-permitted',
    })
  }
})
test('availability refuses an interactive host accessor while retaining independently granted reads', () => {
  let calls = 0
  const value = evidence()
  Object.defineProperty(value, 'hostMode', { get: () => { calls++; return 'interactive' }, enumerable: true })
  const result = getTableCapabilityAvailability(surface(), value)
  assert.equal(calls, 0)
  assert.deepEqual(result.editRows, { available: false, reason: 'host-read-only' })
  assert.deepEqual(result.readRows, { available: true })
})
test('availability refuses nested capability accessors without executing them', () => {
  for (const key of ['runtime', 'grants'] as const) {
    let calls = 0
    const value = evidence()
    Object.defineProperty(value[key], 'editRows', { get: () => { calls++; return true }, enumerable: true })
    const result = getTableCapabilityAvailability(surface(), value)
    assert.equal(calls, 0)
    assert.deepEqual(result.editRows, { available: false, reason: key === 'runtime' ? 'missing-runtime' : 'not-permitted' })
    assert.deepEqual(result.readRows, { available: true })
  }
})
