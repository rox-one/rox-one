/**
 * W1-08 (#1505) — batched, cached entity previews for chips and cards.
 *
 * Requests made in the same tick are sent as one `entities:resolve` call.
 * Each preview goes through `applyPreviewRedaction` (#1499) before any
 * component sees it, so a `no_access` / `tombstone` / `unavailable` entity
 * never exposes its title.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  applyPreviewRedaction,
  entityRefKey,
  type EntityRef,
  type PreviewModel,
  type RestrictedPreview,
} from '@rox/core/entities'
import { getEntityDataSource, unavailableEntityPreview } from './entity-data-source'

export type EntityPreviewView = PreviewModel | RestrictedPreview

export type EntityPreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: EntityPreviewView }

const IDLE: EntityPreviewState = { status: 'idle' }
const LOADING: EntityPreviewState = { status: 'loading' }
const MAX_BATCH = 500

class EntityPreviewStore {
  private readonly states = new Map<string, EntityPreviewState>()
  private readonly listeners = new Set<() => void>()
  private queue = new Map<string, EntityRef>()
  private scheduled = false

  constructor(private readonly workspaceId: string) {}

  get(ref: EntityRef): EntityPreviewState {
    return this.states.get(entityRefKey(ref)) ?? IDLE
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  request(ref: EntityRef): void {
    const key = entityRefKey(ref)
    const state = this.states.get(key)
    if (state && state.status !== 'idle') return
    this.states.set(key, LOADING)
    this.queue.set(key, ref)
    this.emit()
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { void this.flush() })
  }

  invalidate(): void {
    this.states.clear()
    this.emit()
  }

  private async flush(): Promise<void> {
    this.scheduled = false
    const batch = [...this.queue.values()].slice(0, MAX_BATCH)
    for (const ref of batch) this.queue.delete(entityRefKey(ref))
    if (this.queue.size > 0) { this.scheduled = true; queueMicrotask(() => { void this.flush() }) }
    if (batch.length === 0) return
    let previews
    try {
      previews = await getEntityDataSource().resolve(this.workspaceId, batch)
    } catch {
      previews = batch.map(unavailableEntityPreview)
    }
    const byKey = new Map(previews.map((preview) => [entityRefKey(preview.ref), preview]))
    for (const ref of batch) {
      const key = entityRefKey(ref)
      const preview = byKey.get(key) ?? unavailableEntityPreview(ref)
      this.states.set(key, { status: 'ready', preview: applyPreviewRedaction(preview) })
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

const stores = new Map<string, EntityPreviewStore>()

export function entityPreviewStore(workspaceId: string): EntityPreviewStore {
  let store = stores.get(workspaceId)
  if (!store) { store = new EntityPreviewStore(workspaceId); stores.set(workspaceId, store) }
  return store
}

/** Drop cached previews (all workspaces, or one). */
export function invalidateEntityPreviews(workspaceId?: string): void {
  if (workspaceId) stores.get(workspaceId)?.invalidate()
  else for (const store of stores.values()) store.invalidate()
}

/** Test helper. */
export function resetEntityPreviewStores(): void {
  stores.clear()
}

const noopSubscribe = () => () => {}

/**
 * Preview for `ref`. Returns `{status:'idle'}` and makes no request while
 * `enabled` is false or there is no workspace (flag-off inertness).
 */
export function useEntityPreview(ref: EntityRef | null, workspaceId: string | null | undefined, enabled: boolean): EntityPreviewState {
  const store = enabled && workspaceId && ref ? entityPreviewStore(workspaceId) : null
  const state = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    () => (store && ref ? store.get(ref) : IDLE),
    () => IDLE,
  )
  const key = ref ? entityRefKey(ref) : ''
  useEffect(() => {
    if (store && ref) store.request(ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key])
  return state
}
