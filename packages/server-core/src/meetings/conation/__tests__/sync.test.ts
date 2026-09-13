import { describe, expect, it } from 'bun:test'
import { CONATION_FIXTURE_SCHEMA_HASH } from '../capabilities.ts'
import {
  createSyncState,
  queueOfflineWrite,
  revokeSync,
  syncConationPage,
} from '../sync.ts'

describe('conation sync (#383)', () => {
  it('treats a repeated cursor as duplicate, not a second apply', () => {
    const state = createSyncState()
    const page = {
      cursor: 'c1',
      nextCursor: null,
      items: [{ id: 'n1', revision: '1' }],
    }
    expect(syncConationPage(state, page, { authPresent: true, revokeGeneration: 0 }).reason).toBe('checkpoint')
    expect(syncConationPage(state, page, { authPresent: true, revokeGeneration: 0 }).status).toBe('duplicate')
  })

  it('does not delete-all on an empty page', () => {
    const state = createSyncState()
    state.applied.set('n1', { id: 'n1', revision: '1' })
    const result = syncConationPage(
      state,
      { cursor: 'empty', nextCursor: null, items: [] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.reason).toBe('empty-page-not-delete-all')
    expect(state.applied.size).toBe(1)
  })

  it('applies remote deletes as tombstones', () => {
    const state = createSyncState()
    state.applied.set('n1', { id: 'n1', revision: '1' })
    syncConationPage(
      state,
      { cursor: 'd1', nextCursor: null, items: [{ id: 'n1', revision: '2', deleted: true }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(state.applied.has('n1')).toBe(false)
    expect(state.tombstones.has('n1')).toBe(true)
  })

  it('re-checks revoke generation after await', () => {
    const state = createSyncState()
    revokeSync(state)
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.reason).toBe('revoked')
  })

  it('skips echo-loop items with origin=rox', () => {
    const state = createSyncState()
    syncConationPage(
      state,
      { cursor: 'e1', nextCursor: null, items: [{ id: 'n1', revision: '1', origin: 'rox' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(state.applied.has('n1')).toBe(false)
  })

  it('does not checkpoint if the process crashes first', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0, crashBeforeCheckpoint: true },
    )
    expect(result.reason).toBe('crash-before-checkpoint')
    expect(state.checkpoint).toBeNull()
  })

  it('offline writes stay pending and dirty local+remote is a conflict', () => {
    const state = createSyncState()
    expect(queueOfflineWrite(state, { id: 'n1', revision: '1' }).status).toBe('pending')
    state.applied.set('n1', { id: 'n1', revision: '1', localDirty: true })
    const conflict = syncConationPage(
      state,
      { cursor: 'c2', nextCursor: null, items: [{ id: 'n1', revision: '2' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(conflict.status).toBe('conflict')
  })

  it('blocks incompatible schema hashes', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0, schemaHash: 'sha256:other' },
    )
    expect(result.status).toBe('blocked')
    expect(CONATION_FIXTURE_SCHEMA_HASH).toBe('fixture-not-live')
  })
})
