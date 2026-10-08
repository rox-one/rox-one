import { QueryClient } from '@tanstack/react-query'

/** Entries without observers stay in memory this long (PERF-UI-PLAN §2.4: ≥ 30 min). */
export const ROX_QUERY_GC_MS = 30 * 60_000

/**
 * PERF-09 (#1576): one query client for the renderer.
 *
 * - `staleTime: Infinity`: entries are refreshed by change events (see
 *   `event-bridge.ts`) or by the surface's own revalidation, never by a timer.
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
