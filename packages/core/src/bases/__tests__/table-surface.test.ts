import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createTableSurface, decodeTableSurface, encodeTableSurface,
  retargetTableSurface, tableSourceKey, tableQueryKey,
} from '../index.ts'

const input = () => ({
  baseRef: { workspaceId: 'w:1', entityId: 'page:base-1', accountNamespace: 'work:mail' },
  tableId: 'table-1', viewId: 'grid-1', host: { kind: 'standalone' as const },
})
const wire = () => ({ version: 1, type: 'rox-table', ...input(), mode: { kind: 'live' } })
const decode = (value: unknown) => decodeTableSurface(JSON.stringify(value))

// A missing version/default, namespace loss, permissive codec or copied rows must fail these tests.
test('creation adds version/type and live mode without changing canonical refs', () => {
  assert.deepEqual(createTableSurface(input()), wire())
})
test('factory returns a detached descriptor, not aliases to caller references', () => {
  const source = input(); const made = createTableSurface(source)
  source.baseRef.entityId = 'page:changed'
  assert.equal(made.baseRef.entityId, 'page:base-1')
})
test('valid descriptor encodes and decodes without data loss', () => {
  const result = decodeTableSurface(encodeTableSurface(wire()))
  assert.deepEqual(result, { status: 'valid', surface: wire() })
})
test('unicode IDs and pinned revision survive roundtrip', () => {
  const value = wire(); value.baseRef = { ...value.baseRef, entityId: 'page:Таблица-🟢' }
  const extended = { ...value, baseRef: { ...value.baseRef, revisionId: 'revision:7' } }
  assert.deepEqual(decodeTableSurface(encodeTableSurface(extended)), { status: 'valid', surface: extended })
})
for (const kind of ['note', 'document', 'dashboard', 'application'] as const) {
  test(`${kind} retarget keeps one source and independent host/block identity`, () => {
    const original = createTableSurface(input())
    const host = { kind, ref: { workspaceId: 'w:1', entityId: `page:${kind}` }, blockId: 'block:1' }
    const embedded = retargetTableSurface(original, host)
    assert.deepEqual(embedded.host, host)
    assert.equal(tableSourceKey(embedded), tableSourceKey(original))
    assert.deepEqual(original.host, { kind: 'standalone' })
    assert.deepEqual(decodeTableSurface(encodeTableSurface(embedded)), { status: 'valid', surface: embedded })
  })
}
test('different views share source identity but not query identity', () => {
  const a = createTableSurface(input()); const b = createTableSurface({ ...input(), viewId: 'board' })
  assert.equal(tableSourceKey(a), tableSourceKey(b)); assert.notEqual(tableQueryKey(a), tableQueryKey(b))
})
test('workspace and account namespace isolate source identity', () => {
  const a = createTableSurface(input())
  for (const baseRef of [
    { ...input().baseRef, workspaceId: 'w:2' },
    { ...input().baseRef, accountNamespace: 'personal' },
    { workspaceId: 'w:1', entityId: 'page:base-1' },
  ]) assert.notEqual(tableSourceKey(a), tableSourceKey(createTableSurface({ ...input(), baseRef })))
})
test('tuple keys cannot collide through colon separators', () => {
  const a = createTableSurface({ ...input(), tableId: 'a:b', viewId: 'c' })
  const b = createTableSurface({ ...input(), tableId: 'a', viewId: 'b:c' })
  assert.notEqual(tableSourceKey(a), tableSourceKey(b)); assert.notEqual(tableQueryKey(a), tableQueryKey(b))
})
test('snapshot and base revision change query identity, not source identity', () => {
  const a = createTableSurface(input())
  const b = createTableSurface({ ...input(), mode: { kind: 'snapshot', snapshotId: 'snapshot:1' } })
  const c = createTableSurface({ ...input(), baseRef: { ...input().baseRef, revisionId: 'r:2' } })
  assert.equal(tableSourceKey(a), tableSourceKey(b)); assert.equal(tableSourceKey(a), tableSourceKey(c))
  assert.equal(new Set([tableQueryKey(a), tableQueryKey(b), tableQueryKey(c)]).size, 3)
})
test('presentation is validated and preserved without changing query identity', () => {
  const a = createTableSurface(input())
  const b = createTableSurface({ ...input(), presentation: { density: 'compact', height: 480, showToolbar: false } })
  assert.equal(tableQueryKey(a), tableQueryKey(b))
  assert.deepEqual(decodeTableSurface(encodeTableSurface(b)), { status: 'valid', surface: b })
})
test('cross-workspace embed is rejected, not granted by parent visibility', () => {
  const host = { kind: 'note', ref: { workspaceId: 'other', entityId: 'note:1' }, blockId: 'block:1' }
  assert.deepEqual(decode({ ...wire(), host }), { status: 'invalid', code: 'cross-workspace' })
  assert.throws(() => retargetTableSurface(wire(), host), /cross-workspace/)
})
for (const [name, patch] of [
  ['rows', { rows: [{ salary: 'private' }] }], ['credentials', { apiKey: 'secret' }],
  ['grants', { grants: { editRows: true } }], ['script', { script: 'execute()' }],
  ['unknown key', { surprise: true }],
] as const) {
  test(`v1 rejects ${name} rather than persisting or silently dropping it`, () => {
    assert.deepEqual(decode({ ...wire(), ...patch }), { status: 'invalid', code: 'invalid-shape' })
    assert.throws(() => encodeTableSurface({ ...wire(), ...patch }), /invalid-shape/)
  })
}
test('factory rejects unknown inputs instead of silently losing them', () => {
  assert.throws(() => createTableSurface({ ...input(), rows: [] }), /invalid-shape/)
})
for (const [name, patch] of [
  ['empty ID', { tableId: '' }], ['whitespace ID', { viewId: '  ' }],
  ['control character', { tableId: 'a\nb' }], ['oversized ID', { tableId: 'x'.repeat(1025) }],
  ['snapshot without ID', { mode: { kind: 'snapshot' } }],
  ['live with snapshot', { mode: { kind: 'live', snapshotId: 'old' } }],
  ['unknown host', { host: { kind: 'iframe' } }],
  ['embedded host without block', { host: { kind: 'note', ref: input().baseRef } }],
  ['standalone with copied rows', { host: { kind: 'standalone', rows: [] } }],
  ['negative height', { presentation: { height: -1 } }],
  ['unknown density', { presentation: { density: 'huge' } }],
  ['nonboolean toolbar', { presentation: { showToolbar: 'yes' } }],
  ['unknown ref property', { baseRef: { ...input().baseRef, token: 'private' } }],
  ['null namespace', { baseRef: { ...input().baseRef, accountNamespace: null } }],
] as const) {
  test(`invalid descriptor: ${name}`, () => {
    assert.deepEqual(decode({ ...wire(), ...patch }), { status: 'invalid', code: 'invalid-shape' })
  })
}
test('future version remains byte-for-byte raw and is never treated as valid v1', () => {
  const raw = ' { "version": 2, "type": "rox-table", "future": {"a":1} } '
  assert.deepEqual(decodeTableSurface(raw), { status: 'unsupported-version', version: 2, raw })
})
test('wrong type and invalid version do not take the future-version path', () => {
  for (const value of [ { type: 'other', version: 2 }, { type: 'rox-table', version: 0 },
    { type: 'rox-table', version: 1.5 }, { type: 'rox-table', version: '2' } ]) {
    assert.deepEqual(decode(value), { status: 'invalid', code: 'invalid-shape' })
  }
})
test('malformed JSON returns a stable error without echoing contents', () => {
  assert.deepEqual(decodeTableSurface('{"secret":"private"'), { status: 'invalid', code: 'invalid-json' })
})
test('only object descriptors are accepted', () => {
  for (const value of [null, [], 42, 'hello', true])
    assert.deepEqual(decode(value), { status: 'invalid', code: 'invalid-shape' })
})
test('UTF-8 size bound applies before parsing including future versions', () => {
  const raw = JSON.stringify({ type: 'rox-table', version: 2, future: 'Я'.repeat(9000) })
  assert.ok(raw.length < 16384)
  assert.deepEqual(decodeTableSurface(raw), { status: 'invalid', code: 'too-large' })
})
test('prototype keys cannot smuggle values into v1', () => {
  const raw = JSON.stringify(wire()).replace('"version":1', '"version":1,"__proto__":{"grants":true}')
  assert.deepEqual(decodeTableSurface(raw), { status: 'invalid', code: 'invalid-shape' })
  assert.equal(Object.hasOwn({}, 'grants'), false)
})
test('explicit null mode is invalid, not an omitted default', () => {
  assert.throws(() => createTableSurface({ ...input(), mode: null }), /invalid-shape/)
})
test('descriptor byte boundary is inclusive and checked for unknown versions', () => {
  const base = JSON.stringify({ type: 'rox-table', version: 2, future: '' })
  const raw = base.replace('"future":""', `"future":"${'x'.repeat(16384 - base.length)}"`)
  assert.equal(new TextEncoder().encode(raw).length, 16384)
  assert.equal(decodeTableSurface(raw).status, 'unsupported-version')
  assert.deepEqual(decodeTableSurface(raw + ' '), { status: 'invalid', code: 'too-large' })
})
