import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'

/**
 * PERF-09 (#1576): the newest workspace-work revision the server announced
 * per workspace (onWorkspaceWorkChanged), recorded by the event bridge
 * whether or not an entry exists. A snapshot older than it is never treated
 * as current and never replaces a cached one: a read that was in flight when
 * the change was announced cannot clear the invalidation it raced with.
 */
const announced = new Map<string, number>()

export function announceWorkspaceWorkRevision(workspaceId: string, revision: number): void {
  if (!workspaceId || !Number.isFinite(revision)) return
  if (revision > (announced.get(workspaceId) ?? -Infinity)) announced.set(workspaceId, revision)
}

export function announcedWorkspaceWorkRevision(workspaceId: string): number | undefined {
  return announced.get(workspaceId)
}

/** A snapshot is acceptable as the cache entry when no newer revision was announced. */
export function meetsAnnouncedRevision(snapshot: Pick<WorkspaceWorkSnapshot, 'workspaceId' | 'revision'>): boolean {
  const minimum = announced.get(snapshot.workspaceId)
  return minimum === undefined || snapshot.revision >= minimum
}

/** Identity change: revisions announced to the previous principal no longer apply. */
export function resetAnnouncedWorkspaceWorkRevisions(): void {
  announced.clear()
}
