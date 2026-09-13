/**
 * RMA-I027 / #383 — Conation sync checkpoints.
 * Empty page is not delete-all. Offline writes stay pending.
 * Revoke after await is re-checked before commit. Origin markers stop echo loops.
 */

import { confirmWrite, CONATION_FIXTURE_SCHEMA_HASH } from './capabilities.ts'
import { blocked, denied, type MeetingOpResult } from '../types.ts'

export type SyncPage = {
  readonly cursor: string
  readonly nextCursor: string | null
  readonly items: readonly SyncItem[]
}

export type SyncItem = {
  readonly id: string
  readonly revision: string
  readonly deleted?: boolean
  readonly origin?: 'rox' | 'remote'
  readonly localDirty?: boolean
}

export type SyncState = {
  checkpoint: string | null
  applied: Map<string, SyncItem>
  pending: SyncItem[]
  tombstones: Set<string>
  revokeGeneration: number
  seenCursors: string[]
}

export function createSyncState(): SyncState {
  return {
    checkpoint: null,
    applied: new Map(),
    pending: [],
    tombstones: new Set(),
    revokeGeneration: 0,
    seenCursors: [],
  }
}

export function syncConationPage(
  state: SyncState,
  page: SyncPage,
  options: {
    readonly authPresent: boolean
    readonly revokeGeneration: number
    readonly crashBeforeCheckpoint?: boolean
    readonly schemaHash?: string | null
  },
): MeetingOpResult {
  if (!options.authPresent) return denied('no-auth')
  const write = confirmWrite({
    moduleId: 'GraphqlSoupDocument',
    operation: 'edit',
    schemaHash: options.schemaHash ?? CONATION_FIXTURE_SCHEMA_HASH,
    authPresent: true,
  })
  if (!write.allowed && ['create', 'edit'].includes('edit') && options.schemaHash && options.schemaHash !== CONATION_FIXTURE_SCHEMA_HASH) {
    return blocked('incompatible-schema')
  }
  if (options.revokeGeneration !== state.revokeGeneration) {
    return denied('revoked')
  }
  if (state.seenCursors.includes(page.cursor) && page.cursor === state.checkpoint) {
    return { status: 'duplicate', reason: 'repeated-cursor', live: false, evidenceLevel: 'C2' }
  }
  if (page.items.length === 0) {
    return { status: 'verified', reason: 'empty-page-not-delete-all', live: false, evidenceLevel: 'C2', payload: { retained: state.applied.size } }
  }
  for (const item of page.items) {
    if (item.origin === 'rox') continue
    const existing = state.applied.get(item.id)
    if (existing?.localDirty && !item.deleted) {
      return {
        status: 'conflict',
        reason: 'concurrent-edit',
        live: false,
        evidenceLevel: 'C2',
      }
    }
    if (item.deleted) {
      state.applied.delete(item.id)
      state.tombstones.add(item.id)
      continue
    }
    state.applied.set(item.id, item)
  }
  if (options.crashBeforeCheckpoint) {
    return { status: 'pending', reason: 'crash-before-checkpoint', live: false, evidenceLevel: 'C2' }
  }
  state.checkpoint = page.cursor
  state.seenCursors.push(page.cursor)
  return { status: 'verified', reason: 'checkpoint', live: false, evidenceLevel: 'C2' }
}

export function queueOfflineWrite(state: SyncState, item: SyncItem): MeetingOpResult {
  state.pending.push({ ...item, localDirty: true })
  return { status: 'pending', reason: 'offline-write', live: false, evidenceLevel: 'C2' }
}

export function revokeSync(state: SyncState): void {
  state.revokeGeneration += 1
}
