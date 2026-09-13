import { describe, expect, it } from 'bun:test'
import { isLiveVerified } from '../../types.ts'
import { CONATION_FIXTURE_SCHEMA_HASH } from '../capabilities.ts'
import {
  createSyncState,
  queueOfflineWrite,
  revokeSync,
  syncConationPage,
} from '../sync.ts'

describe('conation sync (#383)', () => {
  it('does not stamp verified when live Conation writes are unconfirmed', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.status).not.toBe('verified')
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).toBe('U1')
    expect(result.evidenceLevel).not.toBe('L4')
    expect(result.evidenceLevel).not.toBe('E3')
    expect(isLiveVerified(result)).toBe(false)
    expect(state.applied.has('n1')).toBe(false)
    expect(state.checkpoint).toBeNull()
  })

  it('cannot return verified on the default unconfirmed path', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.status).not.toBe('verified')
    expect(result.status).toBe('blocked')
    expect(isLiveVerified(result)).toBe(false)
  })

  it('leaves applied, tombstones, and checkpoint unchanged when confirmWrite is denied', () => {
    const state = createSyncState()
    state.applied.set('keep', { id: 'keep', revision: '1' })
    state.tombstones.add('gone')
    state.checkpoint = 'c0'
    const appliedBefore = new Map(state.applied)
    const tombstonesBefore = new Set(state.tombstones)
    const checkpointBefore = state.checkpoint
    const result = syncConationPage(
      state,
      {
        cursor: 'c1',
        nextCursor: null,
        items: [
          { id: 'n1', revision: '1' },
          { id: 'keep', revision: '2', deleted: true },
        ],
      },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(result)).toBe(false)
    expect(state.applied.size).toBe(appliedBefore.size)
    expect(state.applied.get('keep')?.revision).toBe('1')
    expect(state.applied.has('n1')).toBe(false)
    expect(state.tombstones).toEqual(tombstonesBefore)
    expect(state.checkpoint).toBe(checkpointBefore)
  })

  it('does not apply a second page as a live checkpoint while writes are unconfirmed', () => {
    const state = createSyncState()
    const page = {
      cursor: 'c1',
      nextCursor: null,
      items: [{ id: 'n1', revision: '1' }],
    }
    const first = syncConationPage(state, page, { authPresent: true, revokeGeneration: 0 })
    const second = syncConationPage(state, page, { authPresent: true, revokeGeneration: 0 })
    expect(first.status).toBe('blocked')
    expect(second.status).toBe('blocked')
    expect(first.live).toBe(false)
    expect(second.live).toBe(false)
    expect(state.applied.size).toBe(0)
    expect(state.checkpoint).toBeNull()
  })

  it('does not delete-all on an empty page', () => {
    const state = createSyncState()
    state.applied.set('n1', { id: 'n1', revision: '1' })
    const result = syncConationPage(
      state,
      { cursor: 'empty', nextCursor: null, items: [] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.status).not.toBe('verified')
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(state.applied.size).toBe(1)
  })

  it('does not apply remote deletes as tombstones while writes are unconfirmed', () => {
    const state = createSyncState()
    state.applied.set('n1', { id: 'n1', revision: '1' })
    const result = syncConationPage(
      state,
      { cursor: 'd1', nextCursor: null, items: [{ id: 'n1', revision: '2', deleted: true }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(state.applied.has('n1')).toBe(true)
    expect(state.tombstones.has('n1')).toBe(false)
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
    const result = syncConationPage(
      state,
      { cursor: 'e1', nextCursor: null, items: [{ id: 'n1', revision: '1', origin: 'rox' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(result.status).toBe('blocked')
    expect(state.applied.has('n1')).toBe(false)
  })

  it('does not checkpoint if the process crashes first', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0, crashBeforeCheckpoint: true },
    )
    expect(result.status).not.toBe('verified')
    expect(result.live).toBe(false)
    expect(state.checkpoint).toBeNull()
  })

  it('offline writes stay pending and unconfirmed sync does not merge over dirty local', () => {
    const state = createSyncState()
    expect(queueOfflineWrite(state, { id: 'n1', revision: '1' }).status).toBe('pending')
    state.applied.set('n1', { id: 'n1', revision: '1', localDirty: true })
    const conflict = syncConationPage(
      state,
      { cursor: 'c2', nextCursor: null, items: [{ id: 'n1', revision: '2' }] },
      { authPresent: true, revokeGeneration: 0 },
    )
    expect(conflict.status).not.toBe('verified')
    expect(conflict.status).toBe('blocked')
    expect(conflict.live).toBe(false)
    expect(state.applied.get('n1')?.revision).toBe('1')
    expect(state.pending).toHaveLength(1)
  })

  it('blocks incompatible schema hashes', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      { authPresent: true, revokeGeneration: 0, schemaHash: 'sha256:other' },
    )
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(result)).toBe(false)
    expect(CONATION_FIXTURE_SCHEMA_HASH).toBe('fixture-not-live')
  })

  it('fixture schema-hash path does not claim live or L4', () => {
    const state = createSyncState()
    const result = syncConationPage(
      state,
      { cursor: 'c1', nextCursor: null, items: [{ id: 'n1', revision: '1' }] },
      {
        authPresent: true,
        revokeGeneration: 0,
        schemaHash: CONATION_FIXTURE_SCHEMA_HASH,
      },
    )
    expect(CONATION_FIXTURE_SCHEMA_HASH).toBe('fixture-not-live')
    expect(result.status).not.toBe('verified')
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).toBe('U1')
    expect(result.evidenceLevel).not.toBe('L4')
    expect(result.evidenceLevel).not.toBe('E3')
    expect(isLiveVerified(result)).toBe(false)
    expect(state.applied.size).toBe(0)
    expect(state.checkpoint).toBeNull()
  })
})
