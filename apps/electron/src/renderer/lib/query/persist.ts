import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import type { NoteSummary } from '../../../shared/types'
import { queryKeyDomain, queryKeyWorkspace, type RoxQueryDomain } from './keys'
import { cacheWriteEpoch } from './shared-read'

/**
 * PERF-09 (#1576): persist a small, safe slice of the query cache so the
 * first visit after a restart paints from disk while the surface revalidates.
 *
 * Only the last-used workspace (one record per principal) is stored, and only domains that hold
 * metadata: no chat or message bodies, no source/automation configs (they
 * can carry tokens or headers), no inbox data (memory proposals quote
 * sessions), and no workspace-work snapshot (that client promises no
 * renderer persistence).
 */
export const PERSISTED_DOMAINS: ReadonlySet<RoxQueryDomain> = new Set<RoxQueryDomain>(['notes-list', 'agents-catalog'])
/** Bump when a persisted shape changes; older records are discarded. */
export const ROX_QUERY_CACHE_BUSTER = 'rox-query-v2'
export const ROX_QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000
export const ROX_QUERY_CACHE_MAX_CHARS = 4_000_000
/** Writes wait for quiet time: a debounce, then an idle callback. */
export const ROX_QUERY_PERSIST_DEBOUNCE_MS = 2_000

export interface PersistedRoxQueryCache {
  buster: string
  workspaceId: string
  /**
   * The principal the entries were read as (org identity
   * authority/issuer/userId, or `local`). A record is only restored when the
   * current principal matches: notes.LIST is ACL-filtered per caller, so a
   * previous account's list must not paint after an account change that
   * happened while no renderer was running.
   */
  principal: string
  savedAt: number
  state: DehydratedState
}

/**
 * Principal key for the persisted record and the cache's identity checks.
 *
 * Fails closed: `null` (nothing is restored or written, and the cache treats
 * the principal as unknown) when the identity read fails, returns nothing, or
 * a native principal has no userId. GET_IDENTITY throws for real reasons
 * (org identity gate off, native principal without a workspace), and a shared
 * fallback key would let one account's record restore for another whose read
 * also fails. `local` is only returned when main positively reports local
 * mode (authority `local`, no native principal) without a local user id.
 */
export async function readPersistencePrincipal(api: { getOrgIdentity?: () => Promise<{ userId?: string; authority?: string; issuer?: string } | null> } | undefined): Promise<string | null> {
  if (typeof api?.getOrgIdentity !== 'function') return null
  let identity: { userId?: string; authority?: string; issuer?: string } | null | undefined
  try {
    identity = await api.getOrgIdentity()
  } catch {
    return null
  }
  if (!identity || typeof identity !== 'object') return null
  const userId = typeof identity.userId === 'string' && identity.userId ? identity.userId : null
  if (identity.authority === 'native') {
    return userId ? JSON.stringify(['native', identity.issuer ?? '', userId]) : null
  }
  if (identity.authority === 'local') {
    return userId ? JSON.stringify(['local', '', userId]) : 'local'
  }
  return null
}

const NOTE_SUMMARY_FIELDS = ['id', 'title', 'path', 'relativePath', 'tags', 'properties', 'links', 'assetRefs', 'updatedAt', 'createdAt', 'size'] as const

/**
 * notes-list entries are projected to NoteSummary fields. In principal mode
 * notes.LIST returns full NoteDocument objects (content, backlink previews,
 * nativeRevision, sourceStoreId); none of that goes to disk.
 */
export function projectPersistedQueryData(key: readonly unknown[], data: unknown): unknown {
  if (queryKeyDomain(key) !== 'notes-list' || !Array.isArray(data)) return data
  return data.map(note => {
    if (!note || typeof note !== 'object') return note
    const summary: Partial<NoteSummary> = {}
    for (const field of NOTE_SUMMARY_FIELDS) if (field in (note as object)) (summary as Record<string, unknown>)[field] = (note as Record<string, unknown>)[field]
    return summary
  })
}

/**
 * One record per principal, so windows (or accounts) with different
 * principals never delete each other's warm start. `prune` drops other
 * principals' records past the max age and beyond ROX_QUERY_CACHE_MAX_RECORDS.
 */
export interface RoxQueryStorage {
  read(principal: string): Promise<unknown>
  write(value: PersistedRoxQueryCache): Promise<void>
  remove(principal: string): Promise<void>
  prune?(keepPrincipal: string, now: number): Promise<void>
}

/** Records kept for principals other than the current one (newest first). */
export const ROX_QUERY_CACHE_MAX_RECORDS = 3

function isPersistedKey(key: readonly unknown[], workspaceId: string): boolean {
  const domain = queryKeyDomain(key)
  return queryKeyWorkspace(key) === workspaceId && domain !== null && PERSISTED_DOMAINS.has(domain)
}

/** The record for one workspace, or null when there is nothing (or too much) to store. */
export function buildPersistedRoxQueryCache(client: QueryClient, workspaceId: string, principal: string, now = Date.now()): PersistedRoxQueryCache | null {
  const state = dehydrate(client, {
    shouldDehydrateQuery: query => query.state.status === 'success' && isPersistedKey(query.queryKey, workspaceId)
      && isFreshPersistedEntry(query.state.dataUpdatedAt, now),
    shouldDehydrateMutation: () => false,
  })
  // Projected here (not via serializeData) so the size cap is checked on the
  // exact bytes that go to disk, and so the in-memory entry stays untouched.
  for (const query of state.queries) {
    query.state = { ...query.state, data: projectPersistedQueryData(query.queryKey, query.state.data) }
  }
  if (state.queries.length === 0) return null
  if (JSON.stringify(state).length > ROX_QUERY_CACHE_MAX_CHARS) return null
  return { buster: ROX_QUERY_CACHE_BUSTER, workspaceId, principal, savedAt: now, state }
}

export function isRestorableRoxQueryCache(value: unknown, now = Date.now()): value is PersistedRoxQueryCache {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PersistedRoxQueryCache>
  if (record.buster !== ROX_QUERY_CACHE_BUSTER || typeof record.workspaceId !== 'string' || !record.workspaceId) return false
  if (typeof record.principal !== 'string' || !record.principal) return false
  if (typeof record.savedAt !== 'number' || now - record.savedAt > ROX_QUERY_CACHE_MAX_AGE_MS || record.savedAt > now + 60_000) return false
  const queries = record.state?.queries
  if (!Array.isArray(queries) || (record.state?.mutations?.length ?? 0) > 0) return false
  // Defence in depth: a record never smuggles another workspace or domain in.
  if (!queries.every(query => Array.isArray(query?.queryKey) && isPersistedKey(query.queryKey, record.workspaceId!))) return false
  if (!queries.every(query => typeof query?.state?.dataUpdatedAt === 'number' && query.state.dataUpdatedAt <= now + 60_000)) return false
  return queries.some(query => isFreshPersistedEntry(query.state.dataUpdatedAt, now))
}

/**
 * Age is each entry's own dataUpdatedAt (when it was last read), not the
 * record's savedAt: re-saving an entry that was never revalidated cannot
 * extend its lifetime.
 */
export function isFreshPersistedEntry(dataUpdatedAt: number, now = Date.now()): boolean {
  return now - dataUpdatedAt <= ROX_QUERY_CACHE_MAX_AGE_MS
}

/**
 * Hydrate a restored record. Restored entries are marked invalidated, so the
 * first surface that reads one paints it and then revalidates in background.
 */
export function restoreRoxQueryCache(client: QueryClient, record: PersistedRoxQueryCache, now = Date.now()): void {
  const queries = record.state.queries.filter(query => isFreshPersistedEntry(query.state.dataUpdatedAt, now))
  hydrate(client, { ...record.state, queries })
  for (const restored of queries) {
    const state = client.getQueryState(restored.queryKey)
    if (state && state.dataUpdatedAt === restored.state.dataUpdatedAt) {
      void client.invalidateQueries({ queryKey: restored.queryKey, exact: true, refetchType: 'none' })
    }
  }
}

export interface RoxQueryPersistence {
  /** Settles once the stored record was read (and restored when valid). */
  readonly ready: Promise<void>
  /**
   * The principal changed (or became unknown): drop the previous principal's
   * stored record and any pending write, and open a new identity epoch for
   * `principal` (read now when omitted).
   */
  clear(principal?: Promise<string | null>): Promise<void>
  /**
   * The identity was re-checked after a fence and the principal is unchanged:
   * open a new epoch for the same principal without touching the stored record.
   */
  reopen(principal?: Promise<string | null>): void
  stop(): void
}

type IdleScheduler = (run: () => void) => () => void

const defaultIdle: IdleScheduler = run => {
  const w = typeof window !== 'undefined' ? window as Window & typeof globalThis : undefined
  if (w?.requestIdleCallback) {
    const id = w.requestIdleCallback(() => run(), { timeout: 10_000 })
    return () => w.cancelIdleCallback(id)
  }
  const id = setTimeout(run, 0)
  return () => clearTimeout(id)
}

export function startRoxQueryPersistence(client: QueryClient, storage: RoxQueryStorage, options: {
  idle?: IdleScheduler
  debounceMs?: number
  now?: () => number
  /**
   * Reads the current principal. It is captured once when an identity epoch
   * opens (start, and clear() on the identity event) and labels every record
   * written in that epoch; at write time it is only re-read to check that
   * main has not switched accounts ahead of the renderer's identity event.
   * `null` (unknown) disables restore and writes for that epoch.
   */
  principal?: () => Promise<string | null>
  /** The first epoch's principal, when the caller already started that read (shared with the event bridge). */
  initialPrincipal?: Promise<string | null>
} = {}): RoxQueryPersistence {
  const idle = options.idle ?? defaultIdle
  const debounceMs = options.debounceMs ?? ROX_QUERY_PERSIST_DEBOUNCE_MS
  const now = options.now ?? Date.now
  const principal = options.principal ?? (() => Promise.resolve<string | null>('local'))
  const readPrincipal = () => principal().then(value => value || null, () => null)
  let stopped = false
  let restored = false
  /** True once a new read succeeded after restore, so an untouched restore is never re-saved. */
  let dirty = false
  let lastWorkspace: string | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let cancelIdle: (() => void) | null = null
  let generation = 0

  /**
   * The identity epoch this persistence instance writes for: the shared
   * cache's write epoch and the principal captured when it opened. Data in
   * the cache was read in this epoch (identity changes clear the cache and
   * reopen the epoch), so this principal, never one read fresh at write
   * time, is what the record is bound to.
   */
  interface IdentityEpoch { generation: number; writeEpoch: number; principal: Promise<string | null> }
  const openEpoch = (known?: Promise<string | null>): IdentityEpoch => ({
    generation, writeEpoch: cacheWriteEpoch(), principal: known ? known.then(value => value || null, () => null) : readPrincipal(),
  })
  let epoch = openEpoch(options.initialPrincipal)
  const epochIsCurrent = (opened: IdentityEpoch) => opened === epoch && opened.generation === generation && opened.writeEpoch === cacheWriteEpoch()

  const cancelPending = () => {
    if (debounce) clearTimeout(debounce)
    debounce = null
    cancelIdle?.()
    cancelIdle = null
  }

  const write = () => {
    cancelIdle = null
    if (stopped || !lastWorkspace || !dirty) return
    const opened = epoch
    if (!epochIsCurrent(opened)) return
    const writeGeneration = generation
    const workspaceId = lastWorkspace
    void Promise.all([opened.principal, readPrincipal()]).then(([owner, current]) => {
      // The identity epoch changed (identity event, clear()) or stop() meanwhile.
      if (stopped || writeGeneration !== generation || !epochIsCurrent(opened)) return
      // Main switched accounts but the renderer's identity event has not
      // arrived yet: the cache may hold either principal's data. Drop the write;
      // the event clears the cache and opens a new epoch.
      if (!owner || current !== owner) return
      const record = buildPersistedRoxQueryCache(client, workspaceId, owner, now())
      if (!record) {
        // Over the size cap (or nothing left): the older record must not stay on disk.
        return storage.remove(owner).catch(() => {})
      }
      return storage.write(record).catch(() => { /* best effort: the cache is an optimisation */ }).then(() => {
        // A clear() that raced this write wins.
        if (writeGeneration !== generation) void storage.remove(owner).catch(() => {})
      })
    }, () => {})
  }

  const schedule = () => {
    if (stopped || !restored) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      cancelIdle?.()
      cancelIdle = idle(write)
    }, debounceMs)
  }

  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const workspaceId = queryKeyWorkspace(event.query.queryKey)
    if (!workspaceId || !isPersistedKey(event.query.queryKey, workspaceId)) return
    // A success outside the open epoch (identity reset not yet followed by clear()) is never persisted.
    if (!epochIsCurrent(epoch)) return
    dirty = true
    lastWorkspace = workspaceId
    schedule()
  })

  const readGeneration = generation
  const startEpoch = epoch
  const ready = startEpoch.principal.then(async owner => {
    // Unknown principal: nothing is read, restored or pruned.
    if (!owner) return
    const value = await storage.read(owner)
    // stop() or clear() (identity change) before the read finished: never restore.
    if (stopped || readGeneration !== generation || !epochIsCurrent(startEpoch)) return
    const record = value as Partial<PersistedRoxQueryCache> | null | undefined
    if (isRestorableRoxQueryCache(value, now()) && record?.principal === owner) {
      restoreRoxQueryCache(client, value, now())
      lastWorkspace ??= value.workspaceId
    } else if (value !== undefined && value !== null) {
      // Unreadable, expired, or bound to a different principal.
      void storage.remove(owner).catch(() => {})
    }
    void storage.prune?.(owner, now()).catch(() => {})
  }).catch(() => { /* unreadable store: start empty */ }).finally(() => {
    restored = true
    // Only a read that succeeded after start is worth a write; an untouched
    // restore is never re-saved.
    if (dirty && lastWorkspace) schedule()
  })

  return {
    ready,
    async clear(next) {
      const previous = epoch.principal
      generation++
      cancelPending()
      lastWorkspace = null
      dirty = false
      // The new epoch's principal is captured now (or handed in by the bridge).
      epoch = openEpoch(next)
      const owner = await previous
      if (owner) await storage.remove(owner).catch(() => {})
    },
    reopen(next) {
      // Same principal, new write epoch: pending changes are written under it.
      epoch = openEpoch(next)
      if (dirty && lastWorkspace) schedule()
    },
    stop() {
      stopped = true
      cancelPending()
      unsubscribe()
    },
  }
}

const RECORD_PREFIX = 'principal:'
/** The single shared key used before records were per principal. */
const LEGACY_KEY = 'last-workspace'

/**
 * Keys of other principals' records to delete: expired ones, then all but the
 * newest ROX_QUERY_CACHE_MAX_RECORDS. The current principal's record and
 * unrelated keys are never touched (the legacy shared key always goes).
 */
export function staleRoxQueryRecordKeys(entries: ReadonlyArray<readonly [unknown, unknown]>, keepPrincipal: string, now = Date.now()): string[] {
  const keep = RECORD_PREFIX + keepPrincipal
  const drop: string[] = []
  const others: Array<{ key: string; savedAt: number }> = []
  for (const [key, value] of entries) {
    if (key === LEGACY_KEY) { drop.push(key); continue }
    if (typeof key !== 'string' || !key.startsWith(RECORD_PREFIX) || key === keep) continue
    const savedAt = value && typeof value === 'object' ? (value as { savedAt?: unknown }).savedAt : undefined
    if (typeof savedAt !== 'number' || now - savedAt > ROX_QUERY_CACHE_MAX_AGE_MS) drop.push(key)
    else others.push({ key, savedAt })
  }
  others.sort((a, b) => b.savedAt - a.savedAt)
  for (const stale of others.slice(ROX_QUERY_CACHE_MAX_RECORDS)) drop.push(stale.key)
  return drop
}

/** IndexedDB storage via idb-keyval (loaded lazily, off the startup path), one record per principal. */
export function idbRoxQueryStorage(): RoxQueryStorage {
  const store = import('idb-keyval').then(idb => ({ idb, store: idb.createStore('rox-query-cache', 'entries') }))
  return {
    read: async principal => { const { idb, store: s } = await store; return idb.get(RECORD_PREFIX + principal, s) },
    write: async value => { const { idb, store: s } = await store; await idb.set(RECORD_PREFIX + value.principal, value, s) },
    remove: async principal => { const { idb, store: s } = await store; await idb.del(RECORD_PREFIX + principal, s) },
    prune: async (keepPrincipal, now) => {
      const { idb, store: s } = await store
      const stale = staleRoxQueryRecordKeys(await idb.entries(s), keepPrincipal, now)
      if (stale.length > 0) await idb.delMany(stale, s)
    },
  }
}
