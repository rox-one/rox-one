import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import type { ElectronAPI } from '../../../shared/types'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { queryKeyDomain, queryKeyWorkspace, roxKeys, type InboxQuerySource, type RoxQueryDomain } from './keys'
import { resetSharedReads } from './shared-read'
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
  void client.invalidateQueries({
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
  let known: Promise<string | null> | null = readPrincipal ? (options.initialPrincipal ?? readPrincipal()) : null
  let check = 0
  let parked: DehydratedState['queries'] = []
  let reconnectPending = false
  let stopped = false

  const clearForNewPrincipal = (principal?: Promise<string | null>) => {
    resetSharedReads(client)
    resetAnnouncedWorkspaceWorkRevisions()
    client.clear()
    options.onIdentityChanged?.(principal)
  }

  const park = () => {
    const state = dehydrate(client, { shouldDehydrateQuery: query => query.state.status === 'success' && isWorkspaceOnlyKey(query.queryKey) })
    parked = [...parked, ...state.queries]
    client.removeQueries({ predicate: query => isWorkspaceOnlyKey(query.queryKey) })
  }

  const recheck = (reason: 'identity' | 'reconnect') => {
    // Fence first: nothing read before this point writes into the cache.
    resetSharedReads(client)
    if (!readPrincipal || !known) {
      parked = []
      clearForNewPrincipal()
      return
    }
    if (reason === 'reconnect') { reconnectPending = true; park() }
    const token = ++check
    const before = known
    const after = readPrincipal()
    known = after
    void Promise.all([before, after]).then(([previous, current]) => {
      // A newer event re-checks (and owns the parked entries).
      if (stopped || token !== check) return
      const restore = parked
      const reconnected = reconnectPending
      parked = []
      reconnectPending = false
      if (previous && current && previous === current) {
        // Hydrate keeps anything newer read since; restored entries revalidate.
        if (restore.length > 0) {
          hydrate(client, { mutations: [], queries: restore })
          for (const query of restore) void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' })
        }
        if (reconnected) void client.invalidateQueries()
        options.onIdentityConfirmed?.(after)
      } else {
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
    if (!cached || !(cached.revision >= revision)) void client.invalidateQueries({ queryKey: key, exact: true })
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
    else void client.invalidateQueries()
  })
  on(api.onIdentityChanged, () => recheck('identity'))

  return () => { stopped = true; for (const off of offs) off?.() }
}
