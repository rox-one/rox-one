/**
 * WAVE 1 native surfaces after sessions/notes/settings (ROX2-022..027, 029, 030, 032).
 * Playground stays fixture (ROX2-015). Conation panes are not these surfaces.
 * Drive/Mail/CRM are not claimed live here.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  queuedResult,
  type Rox2Entity,
  type Rox2EntityKind,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const NATIVE_RAIL_SURFACE_IDS = [
  'projects',
  'pages',
  'memory',
  'tasks',
  'sources',
  'skills',
  'automations',
  'connections',
] as const

export const BROWSER_SURFACE_ID = 'browser' as const

export type NativeRailSurfaceId = (typeof NATIVE_RAIL_SURFACE_IDS)[number]

const SURFACE_KIND: Record<NativeRailSurfaceId, Rox2EntityKind> = {
  projects: 'project',
  pages: 'page',
  memory: 'memory',
  tasks: 'task',
  sources: 'source',
  skills: 'skill',
  automations: 'automation',
  connections: 'connection',
}

/** Native rail destinations are not gated on Conation flags. */
export const NATIVE_SURFACE_REQUIRES_CONATION_FLAG = false as const

export function kindForNativeSurface(surfaceId: NativeRailSurfaceId): Rox2EntityKind {
  return SURFACE_KIND[surfaceId]
}

export function bindNativeSurfaceEntity(
  surfaceId: NativeRailSurfaceId,
  input: { id: string; title: string; workspaceId: string; updatedAt: number },
): Rox2Entity {
  if (!input.id) throw new Error(`${surfaceId} id is empty`)
  const kind = kindForNativeSurface(surfaceId)
  return {
    id: formatRox2EntityId(kind, input.id),
    kind,
    displayName: input.title || input.id,
    workspaceId: input.workspaceId,
    source: 'native',
    permissions: ['read', 'write'],
    updatedAt: input.updatedAt,
  }
}

export function nativeSurfaceListResult(
  surfaceId: NativeRailSurfaceId,
  entities: readonly Rox2Entity[],
): Rox2Result {
  const kind = kindForNativeSurface(surfaceId)
  return {
    ok: true,
    state: 'live',
    entityId: entities[0]?.id ?? formatRox2EntityId(kind, 'empty-list'),
  }
}

export function nativeSurfaceResult(
  surfaceId: NativeRailSurfaceId | typeof BROWSER_SURFACE_ID,
  source: 'native' | 'fixture' | 'conation',
): Rox2Result {
  if (source === 'fixture') {
    return fixtureResult(`${surfaceId}.fixture`, `Playground ${surfaceId} rows are fixture, not live`)
  }
  if (source === 'conation') {
    return queuedResult(`${surfaceId}.conation`, `Conation is not the native ${surfaceId} surface`)
  }
  const kind = surfaceId === 'browser' ? 'file' : kindForNativeSurface(surfaceId)
  return { ok: true, state: 'live', entityId: formatRox2EntityId(kind, 'surface') }
}
