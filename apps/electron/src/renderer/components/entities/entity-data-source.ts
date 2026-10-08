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

/**
 * An entity of `kind` changed (renamed, status changed, deleted). `ids`
 * narrows it to specific entities; `workspaceId` to one workspace. Absent
 * fields mean "any".
 */
export interface EntityChangeEvent {
  kind: EntityKind
  workspaceId?: string
  ids?: string[]
}

export interface EntityDataSource {
  resolve(workspaceId: string, refs: EntityRef[]): Promise<EntityPreview[]>
  backlinks(workspaceId: string, ref: EntityRef, options?: { cursor?: string; limit?: number }): Promise<EntityBacklinksPage>
  search(workspaceId: string, query: string, options?: { kinds?: readonly EntityKind[]; limit?: number }): Promise<EntitySearchHit[]>
  onLinksChanged(callback: (workspaceId: string) => void): () => void
  /** Optional: entity change events, so mounted previews refresh after a rename/delete. */
  onEntitiesChanged?(callback: (event: EntityChangeEvent) => void): () => void
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
  // Existing change broadcasts reused for preview freshness (no new channels).
  onNotesChanged?: (callback: (payload: { workspaceId?: string; noteId?: string } | string) => void) => () => void
  onPersonalTasksChanged?: (callback: (payload: unknown) => void) => () => void
}

/** Map an existing `notes:changed` payload to an entity change event. */
export function noteChangeToEntityEvent(payload: { workspaceId?: string; noteId?: string } | string | null | undefined): EntityChangeEvent {
  if (typeof payload === 'string') return payload ? { kind: 'note', workspaceId: payload } : { kind: 'note' }
  const event: EntityChangeEvent = { kind: 'note' }
  if (payload?.workspaceId) event.workspaceId = payload.workspaceId
  if (payload?.noteId) event.ids = [payload.noteId]
  return event
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
  onEntitiesChanged(callback) {
    const api = bridge()
    const offs: Array<() => void> = []
    if (api?.onNotesChanged) offs.push(api.onNotesChanged((payload) => callback(noteChangeToEntityEvent(payload))))
    // Personal tasks broadcast carries no workspace or ids: refresh every task preview.
    if (api?.onPersonalTasksChanged) offs.push(api.onPersonalTasksChanged(() => callback({ kind: 'task' })))
    return () => { for (const off of offs) off() }
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
