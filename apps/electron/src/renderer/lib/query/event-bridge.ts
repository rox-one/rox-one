import type { QueryClient } from '@tanstack/react-query'
import type { ElectronAPI } from '../../../shared/types'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { queryKeyDomain, queryKeyWorkspace, roxKeys, type InboxQuerySource, type RoxQueryDomain } from './keys'

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
 * PERF-09 (#1576): server push events → cache invalidation, for every
 * workspace and whether or not the surface is mounted. A surface that is
 * mounted keeps its own subscription; this bridge makes sure the entry it
 * left behind is revalidated on the next visit instead of trusted.
 *
 * An identity change drops the whole cache (memory and disk): nothing read
 * as one principal is shown to another.
 */
export function startRoxQueryEventBridge(client: QueryClient, api: RoxQueryEventAPI | undefined, options: {
  onIdentityChanged?: () => void
} = {}): () => void {
  if (!api) return () => {}
  const offs: Array<(() => void) | undefined> = []
  const on = <T extends unknown[]>(subscribe: ((callback: (...args: T) => void) => () => void) | undefined, handler: (...args: T) => void) => {
    if (typeof subscribe !== 'function') return
    try { offs.push(subscribe.call(api, handler)) } catch { /* channel unavailable in this runtime */ }
  }

  on(api.onWorkspaceWorkChanged, (workspaceId: string, revision: number) => {
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
  on(api.onReconnected, () => { void client.invalidateQueries() })
  on(api.onIdentityChanged, () => {
    client.clear()
    options.onIdentityChanged?.()
  })

  return () => { for (const off of offs) off?.() }
}
