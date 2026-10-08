import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import { queryKeyDomain, queryKeyWorkspace, type RoxQueryDomain } from './keys'

/**
 * PERF-09 (#1576): persist a small, safe slice of the query cache so the
 * first visit after a restart paints from disk while the surface revalidates.
 *
 * Only the last-used workspace is stored, and only domains that hold
 * metadata: no chat or message bodies, no source/automation configs (they
 * can carry tokens or headers), no inbox data (memory proposals quote
 * sessions), and no workspace-work snapshot (that client promises no
 * renderer persistence).
 */
export const PERSISTED_DOMAINS: ReadonlySet<RoxQueryDomain> = new Set<RoxQueryDomain>(['notes-list', 'agents-catalog'])
/** Bump when a persisted shape changes; older records are discarded. */
export const ROX_QUERY_CACHE_BUSTER = 'rox-query-v1'
export const ROX_QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000
export const ROX_QUERY_CACHE_MAX_CHARS = 4_000_000
/** Writes wait for quiet time: a debounce, then an idle callback. */
export const ROX_QUERY_PERSIST_DEBOUNCE_MS = 2_000

export interface PersistedRoxQueryCache {
  buster: string
  workspaceId: string
  savedAt: number
  state: DehydratedState
}

export interface RoxQueryStorage {
  read(): Promise<unknown>
  write(value: PersistedRoxQueryCache): Promise<void>
  remove(): Promise<void>
}

function isPersistedKey(key: readonly unknown[], workspaceId: string): boolean {
  const domain = queryKeyDomain(key)
  return queryKeyWorkspace(key) === workspaceId && domain !== null && PERSISTED_DOMAINS.has(domain)
}

/** The record for one workspace, or null when there is nothing (or too much) to store. */
export function buildPersistedRoxQueryCache(client: QueryClient, workspaceId: string, now = Date.now()): PersistedRoxQueryCache | null {
  const state = dehydrate(client, {
    shouldDehydrateQuery: query => query.state.status === 'success' && isPersistedKey(query.queryKey, workspaceId),
    shouldDehydrateMutation: () => false,
  })
  if (state.queries.length === 0) return null
  if (JSON.stringify(state).length > ROX_QUERY_CACHE_MAX_CHARS) return null
  return { buster: ROX_QUERY_CACHE_BUSTER, workspaceId, savedAt: now, state }
}

export function isRestorableRoxQueryCache(value: unknown, now = Date.now()): value is PersistedRoxQueryCache {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PersistedRoxQueryCache>
  if (record.buster !== ROX_QUERY_CACHE_BUSTER || typeof record.workspaceId !== 'string' || !record.workspaceId) return false
  if (typeof record.savedAt !== 'number' || now - record.savedAt > ROX_QUERY_CACHE_MAX_AGE_MS || record.savedAt > now + 60_000) return false
  const queries = record.state?.queries
  if (!Array.isArray(queries) || (record.state?.mutations?.length ?? 0) > 0) return false
  // Defence in depth: a record never smuggles another workspace or domain in.
  return queries.every(query => Array.isArray(query?.queryKey) && isPersistedKey(query.queryKey, record.workspaceId!))
}

/**
 * Hydrate a restored record. Restored entries are marked invalidated, so the
 * first surface that reads one paints it and then revalidates in background.
 */
export function restoreRoxQueryCache(client: QueryClient, record: PersistedRoxQueryCache): void {
  hydrate(client, record.state)
  for (const restored of record.state.queries) {
    const state = client.getQueryState(restored.queryKey)
    if (state && state.dataUpdatedAt === restored.state.dataUpdatedAt) {
      void client.invalidateQueries({ queryKey: restored.queryKey, exact: true, refetchType: 'none' })
    }
  }
}

export interface RoxQueryPersistence {
  /** Settles once the stored record was read (and restored when valid). */
  readonly ready: Promise<void>
  /** Drop the stored record and any pending write (identity change, logout). */
  clear(): Promise<void>
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
} = {}): RoxQueryPersistence {
  const idle = options.idle ?? defaultIdle
  const debounceMs = options.debounceMs ?? ROX_QUERY_PERSIST_DEBOUNCE_MS
  const now = options.now ?? Date.now
  let stopped = false
  let restored = false
  let lastWorkspace: string | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let cancelIdle: (() => void) | null = null
  let generation = 0

  const cancelPending = () => {
    if (debounce) clearTimeout(debounce)
    debounce = null
    cancelIdle?.()
    cancelIdle = null
  }

  const write = () => {
    cancelIdle = null
    if (stopped || !lastWorkspace) return
    const writeGeneration = generation
    const record = buildPersistedRoxQueryCache(client, lastWorkspace, now())
    if (!record) return
    void storage.write(record).catch(() => { /* best effort: the cache is an optimisation */ }).then(() => {
      // A clear() that raced this write wins.
      if (writeGeneration !== generation) void storage.remove().catch(() => {})
    })
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
    lastWorkspace = workspaceId
    schedule()
  })

  const readGeneration = generation
  const ready = storage.read().then(value => {
    // stop() or clear() (identity change) before the read finished: never restore.
    if (stopped || readGeneration !== generation) return
    if (isRestorableRoxQueryCache(value, now())) {
      restoreRoxQueryCache(client, value)
      lastWorkspace ??= value.workspaceId
    } else if (value !== undefined && value !== null) {
      void storage.remove().catch(() => {})
    }
  }, () => { /* unreadable store: start empty */ }).finally(() => {
    restored = true
    if (lastWorkspace) schedule()
  })

  return {
    ready,
    async clear() {
      generation++
      cancelPending()
      lastWorkspace = null
      await storage.remove().catch(() => {})
    },
    stop() {
      stopped = true
      cancelPending()
      unsubscribe()
    },
  }
}

/** IndexedDB storage via idb-keyval (loaded lazily, off the startup path). */
export function idbRoxQueryStorage(): RoxQueryStorage {
  const KEY = 'last-workspace'
  const store = import('idb-keyval').then(idb => ({ idb, store: idb.createStore('rox-query-cache', 'entries') }))
  return {
    read: async () => { const { idb, store: s } = await store; return idb.get(KEY, s) },
    write: async value => { const { idb, store: s } = await store; await idb.set(KEY, value, s) },
    remove: async () => { const { idb, store: s } = await store; await idb.del(KEY, s) },
  }
}
