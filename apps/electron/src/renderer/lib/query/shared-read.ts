import { hashKey, type InvalidateQueryFilters, type QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * PERF-09 (#1576): read-through writes into the shared cache with the
 * ordering guarantees the surfaces already had.
 *
 * - `join: true` (mount/poll reads) shares a read of the key that is already
 *   in flight, so two views opening the same surface cost one RPC.
 * - `join: false` (change events, explicit refresh, after a mutation) always
 *   starts its own read: a read that began before the change must not answer
 *   for it.
 * - An older-started read never overwrites the entry written by a newer one,
 *   and `replaces` can add a domain check (e.g. revisions).
 * - `resetSharedReads` (identity change) fences every read still in flight:
 *   they resolve for their caller but never write into the new cache.
 * - A read that started before a change event (`invalidateRoxQueries`) still
 *   writes its value, but the entry stays invalidated: it must not look
 *   freshly read and let mount reads skip revalidation.
 */
export interface SharedReadOptions<T> {
  join?: boolean
  replaces?: (next: T, cached: T | undefined) => boolean
  /** What goes into the cache (e.g. a metadata projection); the caller still gets the raw value. */
  store?: (value: T) => unknown
}

interface KeyState {
  queryKey: QueryKey
  started: number
  written: number
  /** Bumped by every invalidateRoxQueries request that matches the key. */
  invalidations: number
  inflight: { seq: number; promise: Promise<unknown> } | null
}

const states = new WeakMap<QueryClient, Map<string, KeyState>>()

/**
 * Identity fence for every cache write, not only sharedRead's. An identity
 * change bumps the epoch (resetSharedReads); a write captured before the
 * change then no-ops, so the previous principal's data never lands in the
 * freshly cleared cache.
 */
let writeEpoch = 0

export function cacheWriteEpoch(): number {
  return writeEpoch
}

/** setQueryData that drops the write when the identity changed since `epoch`. */
export function fencedSetQueryData<T>(client: QueryClient, queryKey: QueryKey, value: T, epoch = writeEpoch): boolean {
  if (epoch !== writeEpoch) return false
  client.setQueryData(queryKey, value)
  return true
}

/**
 * Write a local mutation result (optimistic or confirmed) through to an
 * existing entry, fenced like every other write. The entry keeps its read
 * time and its invalidation, so a patch never makes an entry look freshly
 * read: the SWR window and change events still decide when it is re-read.
 * Nothing is written when there is no entry (nothing to keep warm).
 */
export function fencedPatchQueryData<T>(client: QueryClient, queryKey: QueryKey, update: (cached: T) => T, epoch = writeEpoch): boolean {
  if (epoch !== writeEpoch) return false
  const state = client.getQueryState<T>(queryKey)
  if (!state || state.status !== 'success' || state.data === undefined) return false
  const next = update(state.data)
  if (next === state.data) return false
  client.setQueryData<T>(queryKey, next, { updatedAt: state.dataUpdatedAt })
  if (state.isInvalidated) void client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
  return true
}

export function sharedRead<T>(client: QueryClient, queryKey: QueryKey, read: () => Promise<T>, options: SharedReadOptions<T> = {}): Promise<T> {
  const hash = hashKey(queryKey)
  let byKey = states.get(client)
  if (!byKey) states.set(client, byKey = new Map())
  const scope = byKey
  let state = scope.get(hash)
  if (!state) scope.set(hash, state = { queryKey, started: 0, written: 0, invalidations: 0, inflight: null })
  const entry = state
  if (options.join && entry.inflight) return entry.inflight.promise as Promise<T>
  const seq = ++entry.started
  const epoch = writeEpoch
  const invalidations = entry.invalidations
  const promise = (async () => {
    try {
      const value = await read()
      if (epoch === writeEpoch && states.get(client) === scope && seq > entry.written
        && (options.replaces ? options.replaces(value, client.getQueryData<T>(queryKey)) : true)) {
        entry.written = seq
        const wrote = fencedSetQueryData(client, queryKey, options.store ? options.store(value) : value, epoch)
        // A change event arrived while this read was in flight: the value may
        // predate it, so the entry stays invalidated (the next mount revalidates).
        if (wrote && entry.invalidations !== invalidations) void client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
      }
      return value
    } finally {
      if (entry.inflight?.seq === seq) entry.inflight = null
    }
  })()
  entry.inflight = { seq, promise }
  return promise
}

/**
 * Invalidate entries for a change event (or reconnect) and remember it for
 * every matching read in flight, so their later write keeps the entry
 * invalidated. TanStack's own invalidate is a no-op on an already
 * invalidated entry, so the request itself is counted.
 */
export function invalidateRoxQueries(client: QueryClient, filters: InvalidateQueryFilters & { predicate?: (query: { queryKey: QueryKey }) => boolean } = {}): Promise<void> {
  const byKey = states.get(client)
  if (byKey) {
    const target = filters.queryKey ? hashKey(filters.queryKey) : null
    for (const [hash, state] of byKey) {
      if (target !== null && (filters.exact ? hash !== target : !partialKeyMatch(state.queryKey, filters.queryKey!))) continue
      if (filters.predicate && !filters.predicate({ queryKey: state.queryKey })) continue
      state.invalidations++
    }
  }
  return client.invalidateQueries(filters as InvalidateQueryFilters)
}

function partialKeyMatch(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.length <= key.length && prefix.every((part, index) => hashKey([part]) === hashKey([key[index]]))
}

export function resetSharedReads(client: QueryClient): void {
  writeEpoch++
  states.delete(client)
}
