/**
 * RMA-I027 / #383 — Conation sync checkpoints.
 * Empty page is not delete-all. Offline writes stay pending.
 * Revoke after await is re-checked before commit. Origin markers stop echo loops.
 * In-memory sync identity is not a live receipt: stamps stay pending
 * (live:false, not verified; L4 remains not_run).
 * Unconfirmed live writes stay blocked — never a verified checkpoint.
 */

import { confirmWrite, CONATION_FIXTURE_SCHEMA_HASH } from './capabilities.ts'
import { blocked, denied, type EvidenceLevel, type MeetingOpResult } from '../types.ts'

/** Local in-memory sync identity only. Never a live/L4 verified receipt. */
function localApplied<T extends string, P = unknown>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'C2',
  payload?: P,
): MeetingOpResult<T, P> {
  return payload === undefined
    ? { status: 'pending', reason, live: false, evidenceLevel }
    : { status: 'pending', reason, live: false, evidenceLevel, payload }
}

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
  if (options.revokeGeneration !== state.revokeGeneration) {
    return denied('revoked')
  }
  if (!write.allowed) {
    return blocked(write.reason)
  }
  if (state.seenCursors.includes(page.cursor) && page.cursor === state.checkpoint) {
    return { status: 'duplicate', reason: 'repeated-cursor', live: false, evidenceLevel: 'C2' }
  }
  if (page.items.length === 0) {
    return localApplied('empty-page-not-delete-all', 'C2', { retained: state.applied.size })
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
  return localApplied('checkpoint')
}

export function queueOfflineWrite(state: SyncState, item: SyncItem): MeetingOpResult {
  state.pending.push({ ...item, localDirty: true })
  return { status: 'pending', reason: 'offline-write', live: false, evidenceLevel: 'C2' }
}

export function revokeSync(state: SyncState): void {
  state.revokeGeneration += 1
}
