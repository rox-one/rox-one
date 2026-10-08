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
/** Retry delay after a failed `entities:resolve` call (transient bridge errors). */
export const ENTITY_PREVIEW_RETRY_MS = 15_000

/**
 * Per-workspace preview cache.
 *
 * - Mounted chips `retain()` their key; `invalidate()` re-requests retained
 *   keys while keeping their last preview (stale-while-revalidate, so titles
 *   never blank out) and drops the rest.
 * - The store listens to `onLinksChanged` for its workspace while anything is
 *   subscribed and invalidates on each event.
 * - A failed resolve shows the `unavailable` placeholder but is not cached:
 *   after `retryMs` the key is requested again (or dropped if unused).
 */
class EntityPreviewStore {
  private readonly states = new Map<string, EntityPreviewState>()
  private readonly listeners = new Set<() => void>()
  private readonly retained = new Map<string, { ref: EntityRef; count: number }>()
  private readonly failed = new Set<string>()
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private queue = new Map<string, EntityRef>()
  private scheduled = false
  private unlistenLinksChanged: (() => void) | null = null

  constructor(private readonly workspaceId: string, private readonly retryMs: number = ENTITY_PREVIEW_RETRY_MS) {}

  get(ref: EntityRef): EntityPreviewState {
    return this.states.get(entityRefKey(ref)) ?? IDLE
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1 && !this.unlistenLinksChanged) {
      try {
        this.unlistenLinksChanged = getEntityDataSource().onLinksChanged((workspaceId) => {
          if (workspaceId === this.workspaceId) this.invalidate()
        })
      } catch {
        this.unlistenLinksChanged = null
      }
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.unlistenLinksChanged) {
        const unlisten = this.unlistenLinksChanged
        this.unlistenLinksChanged = null
        unlisten()
      }
    }
  }

  /** Keep `ref` fresh while a component shows it. Returns the release function. */
  retain(ref: EntityRef): () => void {
    const key = entityRefKey(ref)
    const entry = this.retained.get(key)
    if (entry) entry.count += 1
    else this.retained.set(key, { ref, count: 1 })
    this.request(ref)
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.retained.get(key)
      if (!current) return
      current.count -= 1
      if (current.count <= 0) this.retained.delete(key)
    }
  }

  request(ref: EntityRef): void {
    const key = entityRefKey(ref)
    const state = this.states.get(key)
    if (state && state.status !== 'idle') return
    this.states.set(key, LOADING)
    this.enqueue(key, ref)
    this.emit()
  }

  /** Drop cached previews; retained keys are refetched and keep their last value meanwhile. */
  invalidate(): void {
    for (const key of [...this.states.keys()]) {
      const kept = this.retained.get(key)
      if (kept) this.enqueue(key, kept.ref)
      else this.states.delete(key)
    }
    for (const [key, { ref }] of this.retained) {
      if (!this.states.has(key)) { this.states.set(key, LOADING); this.enqueue(key, ref) }
    }
    this.emit()
  }

  /** Test/teardown helper: cancel retry timers and the linksChanged listener. */
  dispose(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    this.unlistenLinksChanged?.()
    this.unlistenLinksChanged = null
  }

  private enqueue(key: string, ref: EntityRef): void {
    this.queue.set(key, ref)
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { void this.flush() })
  }

  private async flush(): Promise<void> {
    this.scheduled = false
    const batch = [...this.queue.values()].slice(0, MAX_BATCH)
    for (const ref of batch) this.queue.delete(entityRefKey(ref))
    if (this.queue.size > 0) { this.scheduled = true; queueMicrotask(() => { void this.flush() }) }
    if (batch.length === 0) return
    let previews: Awaited<ReturnType<ReturnType<typeof getEntityDataSource>['resolve']>>
    try {
      previews = await getEntityDataSource().resolve(this.workspaceId, batch)
    } catch {
      this.markFailed(batch)
      return
    }
    const byKey = new Map(previews.map((preview) => [entityRefKey(preview.ref), preview]))
    for (const ref of batch) {
      const key = entityRefKey(ref)
      this.clearFailure(key)
      const preview = byKey.get(key) ?? unavailableEntityPreview(ref)
      this.states.set(key, { status: 'ready', preview: applyPreviewRedaction(preview) })
    }
    this.emit()
  }

  private markFailed(batch: EntityRef[]): void {
    for (const ref of batch) {
      const key = entityRefKey(ref)
      // Keep a previously resolved preview; otherwise show the placeholder.
      const previous = this.states.get(key)
      if (!previous || previous.status !== 'ready' || this.failed.has(key)) {
        this.states.set(key, { status: 'ready', preview: applyPreviewRedaction(unavailableEntityPreview(ref)) })
      }
      this.failed.add(key)
      const existing = this.retryTimers.get(key)
      if (existing) clearTimeout(existing)
      this.retryTimers.set(key, setTimeout(() => {
        this.retryTimers.delete(key)
        if (!this.failed.has(key)) return
        const kept = this.retained.get(key)
        if (kept) this.enqueue(key, kept.ref)
        else { this.failed.delete(key); this.states.delete(key); this.emit() }
      }, this.retryMs))
    }
    this.emit()
  }

  private clearFailure(key: string): void {
    this.failed.delete(key)
    const timer = this.retryTimers.get(key)
    if (timer) { clearTimeout(timer); this.retryTimers.delete(key) }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

const stores = new Map<string, EntityPreviewStore>()
let storeRetryMs = ENTITY_PREVIEW_RETRY_MS

export function entityPreviewStore(workspaceId: string): EntityPreviewStore {
  let store = stores.get(workspaceId)
  if (!store) { store = new EntityPreviewStore(workspaceId, storeRetryMs); stores.set(workspaceId, store) }
  return store
}

/** Drop cached previews (all workspaces, or one). Mounted chips refetch. */
export function invalidateEntityPreviews(workspaceId?: string): void {
  if (workspaceId) stores.get(workspaceId)?.invalidate()
  else for (const store of stores.values()) store.invalidate()
}

/** Test helper; `retryMs` overrides the failure retry delay for new stores. */
export function resetEntityPreviewStores(options: { retryMs?: number } = {}): void {
  for (const store of stores.values()) store.dispose()
  stores.clear()
  storeRetryMs = options.retryMs ?? ENTITY_PREVIEW_RETRY_MS
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
    if (!store || !ref) return undefined
    return store.retain(ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key])
  return state
}
