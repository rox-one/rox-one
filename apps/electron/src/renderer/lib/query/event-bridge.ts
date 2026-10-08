import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import type { ElectronAPI } from '../../../shared/types'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { queryKeyDomain, queryKeyWorkspace, roxKeys, type InboxQuerySource, type RoxQueryDomain } from './keys'
import { invalidateRoxQueries, resetSharedReads } from './shared-read'
import { announceWorkspaceWorkRevision, resetAnnouncedWorkspaceWorkRevisions } from './workspace-work-revision'

export type RoxQueryEventAPI = Partial<Pick<ElectronAPI,
  | 'onWorkspaceWorkChanged'
  | 'onNotesChanged'
  | 'onSourcesChanged'
  | 'onSkillsChanged'
  | 'onFeedChanged'
  | 'onMemoryChanged'
  | 'onSkillsPendingChanged'
  | 'onMessagingPendingChanged'
  | 'onReconnected'
  | 'onIdentityChanged'
>>

function invalidateDomain(client: QueryClient, domain: RoxQueryDomain, workspaceId: string | null, extra?: (key: readonly unknown[]) => boolean): void {
  void invalidateRoxQueries(client, {
    predicate: query => queryKeyDomain(query.queryKey) === domain
      && (workspaceId === null || queryKeyWorkspace(query.queryKey) === workspaceId)
      && (extra ? extra(query.queryKey) : true),
  })
}

const inboxSource = (source: InboxQuerySource) => (key: readonly unknown[]) => key[3] === source

/**
 * Domains whose keys carry the caller (inbox actor, feed caller): another
 * principal can never read them, so they stay visible while a reconnect
 * re-checks the principal. Every other entry is keyed by workspace alone.
 */
const PRINCIPAL_KEYED_DOMAINS: ReadonlySet<RoxQueryDomain> = new Set<RoxQueryDomain>(['feed', 'inbox'])
const isWorkspaceOnlyKey = (key: readonly unknown[]) => {
  const domain = queryKeyDomain(key)
  return !(domain && PRINCIPAL_KEYED_DOMAINS.has(domain))
}

/**
 * PERF-09 (#1576): server push events → cache invalidation, for every
 * workspace and whether or not the surface is mounted. A surface that is
 * mounted keeps its own subscription; this bridge makes sure the entry it
 * left behind is revalidated on the next visit instead of trusted.
 *
 * Principal changes. `identity:changed` also fires for profile edits,
 * provider connect/disconnect and Accounts refreshes, and a real account
 * switch usually arrives as a reconnect (the native principal is bound at
 * the WebSocket handshake). Both fence every in-flight write at once, then
 * re-read the principal key: only when it differs from the epoch's
 * principal (or is unknown) is the cache dropped (memory here, disk via
 * `onIdentityChanged`); otherwise `onIdentityConfirmed` reopens the epoch
 * and nothing is cold-started. While a reconnect's check is pending,
 * workspace-only-keyed entries are parked out of the cache so a revisit
 * cannot paint another principal's data; they come back on a match.
 *
 * Without `principal` (tests, legacy callers) every identity event clears.
 */
export function startRoxQueryEventBridge(client: QueryClient, api: RoxQueryEventAPI | undefined, options: {
  /** The principal changed or is unknown: the memory cache was cleared; drop the disk record too. */
  onIdentityChanged?: (principal?: Promise<string | null>) => void
  /** The principal was re-checked and is unchanged: writes may resume under the new epoch. */
  onIdentityConfirmed?: (principal: Promise<string | null>) => void
  /** Reads the current principal key (`null` when unknown). */
  principal?: () => Promise<string | null>
  /** The epoch's principal when the caller already started that read. */
  initialPrincipal?: Promise<string | null>
} = {}): () => void {
  if (!api) return () => {}
  const readPrincipal = options.principal
    ? () => options.principal!().then(value => value || null, () => null)
    : null
  /**
   * The epoch's principal: only a resolved chain of matching checks keeps it,
   * and only a clear for a new principal replaces it. Every check compares
   * its own fresh read against this, never against another pending read.
   */
  let confirmed: Promise<string | null> | null = readPrincipal ? (options.initialPrincipal ?? readPrincipal()) : null
  let check = 0
  /** Checks resolve in order; the newest one decides for the whole chain. */
  let chain: Promise<unknown> = Promise.resolve()
  /** Some check in the pending chain saw a different or unreadable principal. */
  let chainDiffers = false
  let parked: DehydratedState['queries'] = []
  let reconnectPending = false
  let stopped = false

  const clearForNewPrincipal = (principal?: Promise<string | null>) => {
    resetSharedReads(client)
    resetAnnouncedWorkspaceWorkRevisions()
    client.clear()
    options.onIdentityChanged?.(principal)
  }

  /**
   * Take workspace-only entries out of view. Unobserved ones are removed;
   * observed ones (a mounted useQuery) are reset in place, so the observer
   * stays bound to its query and refetches over the new connection instead
   * of holding a destroyed one.
   */
  const park = () => {
    const state = dehydrate(client, { shouldDehydrateQuery: query => query.state.status === 'success' && isWorkspaceOnlyKey(query.queryKey) })
    parked = [...parked, ...state.queries]
    client.removeQueries({ predicate: query => isWorkspaceOnlyKey(query.queryKey) && query.getObserversCount() === 0 })
    void client.resetQueries({ predicate: query => isWorkspaceOnlyKey(query.queryKey) && query.getObserversCount() > 0 }).catch(() => {})
  }

  const recheck = (reason: 'identity' | 'reconnect') => {
    // Fence first: nothing read before this point writes into the cache.
    resetSharedReads(client)
    if (!readPrincipal || !confirmed) {
      parked = []
      clearForNewPrincipal()
      return
    }
    if (reason === 'reconnect') { reconnectPending = true; park() }
    const token = ++check
    const after = readPrincipal()
    const compared = Promise.all([confirmed, after]).then(([previous, current]) => {
      // Recorded even if a newer check supersedes this one: A→B→A still clears.
      if (!(previous && current && previous === current)) chainDiffers = true
    })
    chain = chain.then(() => compared).then(() => {
      // A newer event re-checks (and owns the parked entries and the outcome).
      if (stopped || token !== check) return
      const differs = chainDiffers
      const restore = parked
      const reconnected = reconnectPending
      chainDiffers = false
      parked = []
      reconnectPending = false
      if (!differs) {
        // Hydrate keeps anything newer read since; the reconnect invalidation
        // below marks the restored entries for revalidation.
        if (restore.length > 0) hydrate(client, { mutations: [], queries: restore })
        if (reconnected) void invalidateRoxQueries(client)
        options.onIdentityConfirmed?.(after)
      } else {
        confirmed = after
        clearForNewPrincipal(after)
      }
    })
  }

  const offs: Array<(() => void) | undefined> = []
  const on = <T extends unknown[]>(subscribe: ((callback: (...args: T) => void) => () => void) | undefined, handler: (...args: T) => void) => {
    if (typeof subscribe !== 'function') return
    try { offs.push(subscribe.call(api, handler)) } catch { /* channel unavailable in this runtime */ }
  }

  on(api.onWorkspaceWorkChanged, (workspaceId: string, revision: number) => {
    // Remembered even without an entry: a read already in flight that
    // resolves with an older revision must not become "current".
    announceWorkspaceWorkRevision(workspaceId, revision)
    const key = roxKeys.workspaceWork(workspaceId)
    const cached = client.getQueryData<WorkspaceWorkSnapshot>(key)
    if (!cached || !(cached.revision >= revision)) void invalidateRoxQueries(client, { queryKey: key, exact: true })
  })
  on(api.onNotesChanged, (payload: unknown) => {
    const workspaceId = typeof payload === 'string' ? payload
      : payload && typeof payload === 'object' && typeof (payload as { workspaceId?: unknown }).workspaceId === 'string'
        ? (payload as { workspaceId: string }).workspaceId : null
    invalidateDomain(client, 'notes-list', workspaceId)
  })
  on(api.onSourcesChanged, (workspaceId: string) => invalidateDomain(client, 'agents-catalog', workspaceId || null))
  on(api.onSkillsChanged, (workspaceId: string) => invalidateDomain(client, 'agents-catalog', workspaceId || null))
  on(api.onFeedChanged, () => invalidateDomain(client, 'feed', null))
  on(api.onMemoryChanged, (workspaceId: string | null) => invalidateDomain(client, 'inbox', workspaceId || null, inboxSource('memory')))
  on(api.onSkillsPendingChanged, (workspaceId: string) => invalidateDomain(client, 'inbox', workspaceId || null, inboxSource('skills')))
  // Pending senders are read without a workspace argument: invalidate them everywhere.
  on(api.onMessagingPendingChanged, () => invalidateDomain(client, 'inbox', null, inboxSource('senders')))
  on(api.onReconnected, () => {
    if (readPrincipal) recheck('reconnect')
    else void invalidateRoxQueries(client)
  })
  on(api.onIdentityChanged, () => recheck('identity'))

  return () => { stopped = true; for (const off of offs) off?.() }
}
