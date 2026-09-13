/**
 * ROX2-035: native viewer share surface.
 * Share viewer stays native. Conation is not this surface. Drive/Mail are not live.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  queuedResult,
  type Rox2Entity,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const VIEWER_SURFACE_ID = 'viewer' as const

/** Viewer is reachable without Conation flags. */
export const VIEWER_REQUIRES_CONATION_FLAG = false as const

export function bindNativeSharedSession(input: {
  id: string
  title: string
  workspaceId: string
  updatedAt: number
}): Rox2Entity {
  if (!input.id) throw new Error('session id is empty')
  return {
    id: formatRox2EntityId('session', input.id),
    kind: 'session',
    displayName: input.title || input.id,
    workspaceId: input.workspaceId,
    source: 'native',
    permissions: ['read'],
    updatedAt: input.updatedAt,
  }
}

export function viewerSurfaceResult(source: 'native' | 'fixture' | 'conation'): Rox2Result {
  if (source === 'fixture') {
    return fixtureResult('viewer.fixture', 'Playground viewer stories are fixture, not live')
  }
  if (source === 'conation') {
    return queuedResult('viewer.conation', 'Conation is not the native share viewer')
  }
  return { ok: true, state: 'live', entityId: formatRox2EntityId('session', 'viewer-surface') }
}
