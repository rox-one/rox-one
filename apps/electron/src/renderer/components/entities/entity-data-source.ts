/**
 * W1-08 (#1505) — the single adapter between entity UI and its data.
 *
 * Every component in this folder reads previews, backlinks and search results
 * through `getEntityDataSource()`. The default implementation calls the W1-02
 * RPCs (`entities:resolve`, `entities:links`) through `window.electronAPI`.
 * Tests and later waves swap it with `setEntityDataSource()`.
 */
import type { EntityKind, EntityLink, EntityPreview, EntityRef } from '@rox/core/entities'
import { formatEntityRef, kindDescriptor } from '@rox/core/entities'

export interface EntitySearchHit {
  ref: EntityRef
  title: string
}

export interface EntityBacklinksPage {
  links: EntityLink[]
  nextCursor?: string
}

export interface EntityDataSource {
  resolve(workspaceId: string, refs: EntityRef[]): Promise<EntityPreview[]>
  backlinks(workspaceId: string, ref: EntityRef, options?: { cursor?: string; limit?: number }): Promise<EntityBacklinksPage>
  search(workspaceId: string, query: string, options?: { kinds?: readonly EntityKind[]; limit?: number }): Promise<EntitySearchHit[]>
  onLinksChanged(callback: (workspaceId: string) => void): () => void
}

/** Placeholder preview used when the bridge is missing or the call failed. */
export function unavailableEntityPreview(ref: EntityRef): EntityPreview {
  const descriptor = kindDescriptor(ref.kind)
  return {
    ref,
    status: 'unavailable',
    title: '',
    kindLabel: ref.kind,
    icon: descriptor?.icon ?? 'link',
    authority: descriptor?.authorities[0] ?? 'local',
    etag: `unavailable:${formatEntityRef(ref)}`,
  }
}

interface EntitiesBridge {
  entitiesResolve?: (workspaceId: string, input: { refs: EntityRef[] }) => Promise<EntityPreview[]>
  entitiesLinks?: (workspaceId: string, input: unknown) => Promise<unknown>
  onEntitiesLinksChanged?: (callback: (workspaceId: string) => void) => () => void
}

function bridge(): EntitiesBridge | null {
  if (typeof window === 'undefined') return null
  return ((window as unknown as { electronAPI?: EntitiesBridge }).electronAPI) ?? null
}

/** Default data source backed by the W1-02 RPCs. */
export const electronEntityDataSource: EntityDataSource = {
  async resolve(workspaceId, refs) {
    const api = bridge()
    if (!api?.entitiesResolve || refs.length === 0) return refs.map(unavailableEntityPreview)
    const previews = await api.entitiesResolve(workspaceId, { refs })
    return Array.isArray(previews) ? previews : refs.map(unavailableEntityPreview)
  },
  async backlinks(workspaceId, ref, options = {}) {
    const api = bridge()
    if (!api?.entitiesLinks) return { links: [] }
    const result = await api.entitiesLinks(workspaceId, { op: 'backlinks', ref, ...options }) as
      | { ok: true; op: 'backlinks'; links: EntityLink[]; nextCursor?: string }
      | { ok: false }
      | undefined
    if (!result || result.ok !== true || !Array.isArray(result.links)) return { links: [] }
    return result.nextCursor ? { links: result.links, nextCursor: result.nextCursor } : { links: result.links }
  },
  // STUB(#1504): W1-07 owns the global search provider. Until it registers one
  // through setEntityDataSource(), search returns nothing and the picker
  // offers recents plus literal `kind:id` refs typed by the user.
  async search() {
    return []
  },
  onLinksChanged(callback) {
    const api = bridge()
    return api?.onEntitiesLinksChanged ? api.onEntitiesLinksChanged(callback) : () => {}
  },
}

let current: EntityDataSource = electronEntityDataSource

export function getEntityDataSource(): EntityDataSource {
  return current
}

/** Replace the data source (tests, or a later wave's search provider). Pass null to reset. */
export function setEntityDataSource(source: EntityDataSource | null): void {
  current = source ?? electronEntityDataSource
}

// Recently linked refs (in memory, per workspace) feed the picker's "Recent" group.
const RECENT_LIMIT = 8
const recents = new Map<string, EntitySearchHit[]>()

export function rememberRecentEntity(workspaceId: string, hit: EntitySearchHit): void {
  const key = formatEntityRef(hit.ref)
  const list = (recents.get(workspaceId) ?? []).filter((item) => formatEntityRef(item.ref) !== key)
  list.unshift(hit)
  recents.set(workspaceId, list.slice(0, RECENT_LIMIT))
}

export function recentEntities(workspaceId: string): EntitySearchHit[] {
  return [...(recents.get(workspaceId) ?? [])]
}

export function clearRecentEntities(): void {
  recents.clear()
}
