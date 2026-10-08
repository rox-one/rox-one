import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

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
 */
export interface SharedReadOptions<T> {
  join?: boolean
  replaces?: (next: T, cached: T | undefined) => boolean
}

interface KeyState {
  started: number
  written: number
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

export function sharedRead<T>(client: QueryClient, queryKey: QueryKey, read: () => Promise<T>, options: SharedReadOptions<T> = {}): Promise<T> {
  const hash = hashKey(queryKey)
  let byKey = states.get(client)
  if (!byKey) states.set(client, byKey = new Map())
  const scope = byKey
  let state = scope.get(hash)
  if (!state) scope.set(hash, state = { started: 0, written: 0, inflight: null })
  const entry = state
  if (options.join && entry.inflight) return entry.inflight.promise as Promise<T>
  const seq = ++entry.started
  const epoch = writeEpoch
  const promise = (async () => {
    try {
      const value = await read()
      if (epoch === writeEpoch && states.get(client) === scope && seq > entry.written
        && (options.replaces ? options.replaces(value, client.getQueryData<T>(queryKey)) : true)) {
        entry.written = seq
        fencedSetQueryData(client, queryKey, value, epoch)
      }
      return value
    } finally {
      if (entry.inflight?.seq === seq) entry.inflight = null
    }
  })()
  entry.inflight = { seq, promise }
  return promise
}

export function resetSharedReads(client: QueryClient): void {
  writeEpoch++
  states.delete(client)
}
