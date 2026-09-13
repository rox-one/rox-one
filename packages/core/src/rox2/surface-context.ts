/**
 * Surface context for a session opened to the right of a working screen
 * (ROX-AUD-061 / #338). Extends Rox2Context; does not add a second contract.
 */

import type { Rox2Context, Rox2Permission } from './platform-contract.ts'

export type Rox2SnapshotPolicy = 'snapshot' | 'live'

export type Rox2ContextBinding = {
  snapshotPolicy: Rox2SnapshotPolicy
  revisionByEntityId: Record<string, string>
  selection?: { surfaceId: string; blockIds?: readonly string[] }
  tokenEstimate?: number
  acceptedOutcomeIds?: readonly string[]
}

export type SurfaceContextInput = {
  workspaceId: string
  sessionId?: string
  surfaceId: string
  entityRefs: readonly string[]
  revisionByEntityId?: Record<string, string>
  snapshotPolicy?: Rox2SnapshotPolicy
  permissionMode: Rox2Context['permissionMode']
  selection?: Rox2ContextBinding['selection']
  tokenEstimate?: number
  acceptedOutcomeIds?: readonly string[]
}

export function bindSurfaceContext(input: SurfaceContextInput): Rox2Context {
  if (!input.workspaceId) throw new Error('workspace id is empty')
  if (!input.surfaceId) throw new Error('surface id is empty')
  const refs = [...new Set(input.entityRefs.filter(Boolean))]
  return {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    surfaceId: input.surfaceId,
    entityRefs: refs,
    permissionMode: input.permissionMode,
    binding: {
      snapshotPolicy: input.snapshotPolicy ?? 'snapshot',
      revisionByEntityId: { ...(input.revisionByEntityId ?? {}) },
      selection: input.selection,
      tokenEstimate: input.tokenEstimate,
      acceptedOutcomeIds: input.acceptedOutcomeIds,
    },
  }
}

export function visibleContextEntityRefs(
  context: Rox2Context,
  readableEntityIds: ReadonlySet<string>,
): string[] {
  return context.entityRefs.filter((id) => readableEntityIds.has(id))
}

export function sameContextSnapshot(a: Rox2Context, b: Rox2Context): boolean {
  if (a.workspaceId !== b.workspaceId || a.surfaceId !== b.surfaceId || a.sessionId !== b.sessionId) {
    return false
  }
  if (a.entityRefs.length !== b.entityRefs.length) return false
  for (let i = 0; i < a.entityRefs.length; i += 1) {
    if (a.entityRefs[i] !== b.entityRefs[i]) return false
  }
  const aRev = a.binding?.revisionByEntityId ?? {}
  const bRev = b.binding?.revisionByEntityId ?? {}
  const keys = new Set([...Object.keys(aRev), ...Object.keys(bRev)])
  for (const key of keys) {
    if (aRev[key] !== bRev[key]) return false
  }
  return true
}

/** Snapshot policy: a new document revision is a new binding, not a silent mutate. */
export function rebaseLiveContext(
  current: Rox2Context,
  nextRevisionByEntityId: Record<string, string>,
): Rox2Context {
  if (current.binding?.snapshotPolicy !== 'live') return current
  return {
    ...current,
    binding: {
      snapshotPolicy: 'live',
      revisionByEntityId: { ...nextRevisionByEntityId },
      selection: current.binding.selection,
      tokenEstimate: current.binding.tokenEstimate,
      acceptedOutcomeIds: current.binding.acceptedOutcomeIds,
    },
  }
}

export function requiresContextGrant(permission: Rox2Permission, granted: boolean): boolean {
  if (permission === 'read' || permission === 'write') return false
  return !granted
}
