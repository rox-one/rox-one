/**
 * PERF-09 (#1576): query keys for the shared renderer cache.
 *
 * Every key starts with the workspace id, so one workspace can never read
 * another workspace's entry, and the persister can keep exactly one
 * workspace on disk. Keys that depend on who is asking (inbox actor, feed
 * caller) carry that identity as well.
 */
export type RoxQueryDomain =
  | 'workspace-work'
  | 'notes-list'
  | 'notes-tasks'
  | 'agents-catalog'
  | 'feed'
  | 'inbox'

export type RoxQueryKey = readonly [workspaceId: string, domain: RoxQueryDomain, ...rest: readonly (string | null)[]]

export type InboxQuerySource = 'memory' | 'skills' | 'senders'

export const roxKeys = {
  /** Prefix that matches every entry of one workspace. */
  workspace: (workspaceId: string) => [workspaceId] as const,
  workspaceWork: (workspaceId: string): RoxQueryKey => [workspaceId, 'workspace-work'],
  notesList: (workspaceId: string): RoxQueryKey => [workspaceId, 'notes-list'],
  notesTasks: (workspaceId: string): RoxQueryKey => [workspaceId, 'notes-tasks'],
  agentsCatalog: (workspaceId: string): RoxQueryKey => [workspaceId, 'agents-catalog'],
  feed: (workspaceId: string, callerKey: string): RoxQueryKey => [workspaceId, 'feed', callerKey],
  inbox: (workspaceId: string, actorKey: string, source: InboxQuerySource): RoxQueryKey => [workspaceId, 'inbox', actorKey, source],
} as const

export function queryKeyWorkspace(key: readonly unknown[]): string | null {
  return typeof key[0] === 'string' && key[0] ? key[0] : null
}

export function queryKeyDomain(key: readonly unknown[]): RoxQueryDomain | null {
  return typeof key[1] === 'string' ? key[1] as RoxQueryDomain : null
}
