import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTableSurface, getTableCapabilityAvailability, TABLE_CAPABILITIES } from '../index.ts'

const surface = (mode: unknown = { kind: 'live' }) => createTableSurface({
  baseRef: { workspaceId: 'w', entityId: 'page:base' }, tableId: 't', viewId: 'v',
  host: { kind: 'standalone' }, mode,
})
const all = () => Object.fromEntries(TABLE_CAPABILITIES.map(key => [key, true]))
const policy = () => ({ sourceReadable: true, hostReadable: true, schemaSupported: true,
  hostMode: 'interactive', runtime: all(), grants: all() })

// A union of runtime/grants or surface-based grant inheritance must fail this suite.
test('all capabilities are available only with complete positive evidence', () => {
  const result = getTableCapabilityAvailability(surface(), policy())
  assert.equal(Object.keys(result).length, TABLE_CAPABILITIES.length)
  assert.ok(TABLE_CAPABILITIES.length >= 10)
  for (const value of Object.values(result)) assert.deepEqual(value, { available: true })
})
test('a runtime capability cannot substitute for permission', () => {
  const p = policy(); p.grants.editRows = false
  assert.deepEqual(getTableCapabilityAvailability(surface(), p).editRows, { available: false, reason: 'not-permitted' })
})
test('a grant cannot substitute for an implemented runtime capability', () => {
  const p = policy(); p.runtime.runActions = false
  assert.deepEqual(getTableCapabilityAvailability(surface(), p).runActions, { available: false, reason: 'missing-runtime' })
})
test('missing grants and missing runtime maps fail closed', () => {
  for (const p of [{ ...policy(), grants: {} }, { ...policy(), runtime: {} }]) {
    assert.ok(Object.values(getTableCapabilityAvailability(surface(), p)).every(v => v.available === false))
  }
})
for (const [key, reason] of [['sourceReadable', 'source-denied'], ['hostReadable', 'host-denied'],
  ['schemaSupported', 'unsupported-schema']] as const) {
  test(`${key}=false suppresses every capability without leaking extra state`, () => {
    for (const value of Object.values(getTableCapabilityAvailability(surface(), { ...policy(), [key]: false })))
      assert.deepEqual(value, { available: false, reason })
  })
}
test('snapshot disables every mutation but retains independently granted reads', () => {
  const result = getTableCapabilityAvailability(surface({ kind: 'snapshot', snapshotId: 's' }), policy())
  for (const key of ['createRows', 'editRows', 'deleteRows', 'editSchema', 'manageViews', 'runActions',
    'manageAutomations', 'manageSync', 'managePermissions', 'configureAI', 'publish'] as const)
    assert.deepEqual(result[key], { available: false, reason: 'snapshot-read-only' })
  for (const key of ['readRows', 'viewCharts', 'viewHistory', 'export'] as const) assert.deepEqual(result[key], { available: true })
})
test('read-only host disables effects but not permitted reads', () => {
  const result = getTableCapabilityAvailability(surface(), { ...policy(), hostMode: 'read-only' })
  assert.deepEqual(result.runActions, { available: false, reason: 'host-read-only' })
  assert.deepEqual(result.readRows, { available: true })
})
test('changing host kind does not expand capabilities', () => {
  const p = { ...policy(), grants: {} }; const a = surface()
  const b = { ...a, host: { kind: 'note', ref: { workspaceId: 'w', entityId: 'note:1' }, blockId: 'b' } }
  assert.deepEqual(getTableCapabilityAvailability(a, p), getTableCapabilityAvailability(b, p))
})
test('truthy strings and inherited properties are not verified true', () => {
  for (const grants of [{ ...all(), editRows: 'true' }, Object.create(all())]) {
    assert.deepEqual(getTableCapabilityAvailability(surface(), { ...policy(), grants }).editRows,
      { available: false, reason: 'not-permitted' })
  }
})
test('complete boolean matrix requires both runtime and grant', () => {
  for (const runtime of [false, true]) for (const grant of [false, true]) {
    const p = policy(); p.runtime.editRows = runtime; p.grants.editRows = grant
    assert.equal(getTableCapabilityAvailability(surface(), p).editRows.available, runtime && grant)
  }
})
