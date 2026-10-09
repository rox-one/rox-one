import { QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * Entries are dropped from memory after 30 min without observers
 * (PERF-UI-PLAN §2.4 asks for ≥ 30 min). Most entries are written with
 * setQueryData, which in query-core v5 never reschedules gc: such an entry
 * only takes a gc timer once an observer unsubscribes, so refreshing it
 * through setQueryData neither resets nor removes it (the notes task cache
 * survives while Notes holds it). Every key is bounded (one per workspace ×
 * domain × verified actor), and an identity change clears the whole cache.
 */
export const ROX_QUERY_GC_MS = 30 * 60_000

/**
 * Stale-while-revalidate window: a revisit paints from cache and starts a
 * background read unless the entry was read successfully less than this ago
 * (and nothing invalidated it since).
 */
export const ROX_REVALIDATE_AFTER_MS = 10_000

/** True when the entry was read successfully within the SWR window and is not invalidated. */
export function isRecentlyRead(client: QueryClient, queryKey: QueryKey, now = Date.now()): boolean {
  const state = client.getQueryState(queryKey)
  return !!state && state.status === 'success' && !state.isInvalidated && now - state.dataUpdatedAt < ROX_REVALIDATE_AFTER_MS
}

/**
 * PERF-09 (#1576): one query client for the renderer.
 *
 * - `staleTime: Infinity`: entries are refreshed by change events (see
 *   `event-bridge.ts`) or by the surface's own revalidation on revisit
 *   (stale-while-revalidate, see ROX_REVALIDATE_AFTER_MS), never by a timer.
 * - `networkMode: 'always'`: the "network" is the local RPC transport, so
 *   `navigator.onLine` must not pause queries.
 * - No retries and no focus/reconnect refetches here: surfaces keep their
 *   existing error and refresh behaviour, and reconnects go through the bridge.
 */
export function createRoxQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: ROX_QUERY_GC_MS,
        networkMode: 'always',
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { networkMode: 'always', retry: false },
    },
  })
}

let shared: QueryClient | null = null

/** The renderer-wide client (created on first use). */
export function roxQueryClient(): QueryClient {
  shared ??= createRoxQueryClient()
  return shared
}

/** Tests only: swap in a fresh client. */
export function resetRoxQueryClientForTests(client: QueryClient | null = null): void {
  shared = client
}
