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
import { getEntityDataSource, unavailableEntityPreview, type EntityChangeEvent } from './entity-data-source'

export type EntityPreviewView = PreviewModel | RestrictedPreview

export type EntityPreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: EntityPreviewView }

const IDLE: EntityPreviewState = { status: 'idle' }
const LOADING: EntityPreviewState = { status: 'loading' }
const MAX_BATCH = 500
/** First retry delay after a failed `entities:resolve` call (transient bridge errors). */
export const ENTITY_PREVIEW_RETRY_MS = 15_000
/** Retry delays double per consecutive failure up to this cap. */
export const ENTITY_PREVIEW_RETRY_MAX_MS = 5 * 60_000
/** A ready preview older than this is revalidated on the next retain()/hover-open. */
export const ENTITY_PREVIEW_TTL_MS = 60_000

export interface EntityPreviewStoreOptions {
  retryMs?: number
  retryMaxMs?: number
  ttlMs?: number
  now?: () => number
}

/** Backoff delay for the `failures`-th consecutive failure (1-based). */
export function entityPreviewRetryDelay(failures: number, retryMs = ENTITY_PREVIEW_RETRY_MS, retryMaxMs = ENTITY_PREVIEW_RETRY_MAX_MS): number {
  const exponent = Math.max(0, Math.min(failures - 1, 30))
  return Math.min(retryMs * 2 ** exponent, retryMaxMs)
}

/**
 * Per-workspace preview cache.
 *
 * - Mounted chips `retain()` their key; `invalidate()` re-requests retained
 *   keys while keeping their last preview (stale-while-revalidate, so titles
 *   never blank out) and drops the rest.
 * - Ready previews older than `ttlMs` are revalidated in the background on
 *   the next `retain()` or hover-open (`revalidate()`), keeping the old value
 *   until the new one arrives. A deleted entity then shows its tombstone.
 * - While anything is subscribed the store listens to `onLinksChanged` for
 *   its workspace (invalidates everything) and to entity change events
 *   (note/task updated or deleted: revalidates the matching retained keys).
 * - A failed resolve shows the `unavailable` placeholder but is not cached:
 *   the key is requested again after an exponential backoff (`retryMs`,
 *   doubling, capped at `retryMaxMs`), or dropped if unused. Success or
 *   `linksChanged` resets the backoff.
 */
class EntityPreviewStore {
  private readonly states = new Map<string, EntityPreviewState>()
  private readonly listeners = new Set<() => void>()
  private readonly retained = new Map<string, { ref: EntityRef; count: number }>()
  private readonly failed = new Set<string>()
  private readonly failureCounts = new Map<string, number>()
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly fetchedAt = new Map<string, number>()
  /** Keys queued or in flight (TTL revalidation never doubles a request). */
  private readonly pending = new Set<string>()
  private queue = new Map<string, EntityRef>()
  private scheduled = false
  private unlisteners: Array<() => void> = []
  private readonly retryMs: number
  private readonly retryMaxMs: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(private readonly workspaceId: string, options: EntityPreviewStoreOptions = {}) {
    this.retryMs = options.retryMs ?? ENTITY_PREVIEW_RETRY_MS
    this.retryMaxMs = options.retryMaxMs ?? ENTITY_PREVIEW_RETRY_MAX_MS
    this.ttlMs = options.ttlMs ?? ENTITY_PREVIEW_TTL_MS
    this.now = options.now ?? Date.now
  }

  get(ref: EntityRef): EntityPreviewState {
    return this.states.get(entityRefKey(ref)) ?? IDLE
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1 && this.unlisteners.length === 0) this.listen()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.unlisten()
    }
  }

  /** Keep `ref` fresh while a component shows it. Returns the release function. */
  retain(ref: EntityRef): () => void {
    const key = entityRefKey(ref)
    const entry = this.retained.get(key)
    if (entry) entry.count += 1
    else this.retained.set(key, { ref, count: 1 })
    this.request(ref)
    this.revalidate(ref)
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

  /**
   * Background refetch of a ready preview older than the TTL (hover-open,
   * retain). The old value stays visible until the new one arrives. Failed
   * keys are left to their backoff timer.
   */
  revalidate(ref: EntityRef): void {
    const key = entityRefKey(ref)
    if (this.pending.has(key) || this.failed.has(key)) return
    if (this.states.get(key)?.status !== 'ready') return
    const at = this.fetchedAt.get(key)
    if (at !== undefined && this.now() - at < this.ttlMs) return
    this.enqueue(key, ref)
  }

  /** Drop cached previews; retained keys are refetched and keep their last value meanwhile. */
  invalidate(): void {
    // A links change is a fresh start for failing keys: reset their backoff.
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    this.failureCounts.clear()
    for (const key of [...this.states.keys()]) {
      const kept = this.retained.get(key)
      if (kept) this.enqueue(key, kept.ref)
      else { this.states.delete(key); this.fetchedAt.delete(key); this.failed.delete(key) }
    }
    for (const [key, { ref }] of this.retained) {
      if (!this.states.has(key)) { this.states.set(key, LOADING); this.enqueue(key, ref) }
    }
    this.emit()
  }

  /** An entity changed (renamed, status, deleted): refetch matching retained keys, forget the rest. */
  entityChanged(event: EntityChangeEvent): void {
    if (event.workspaceId && event.workspaceId !== this.workspaceId) return
    const ids = event.ids && event.ids.length > 0 ? new Set(event.ids) : null
    for (const [key, state] of [...this.states]) {
      const kept = this.retained.get(key)
      const ref = kept?.ref ?? (state.status === 'ready' ? state.preview.ref : null)
      if (!ref || ref.kind !== event.kind || (ids && !ids.has(ref.id))) continue
      if (!kept) {
        // Not shown anywhere: forget it; the next use fetches it fresh.
        if (state.status === 'ready') { this.states.delete(key); this.fetchedAt.delete(key) }
        continue
      }
      if (this.failed.has(key) || this.pending.has(key)) continue
      this.enqueue(key, ref)
    }
  }

  /** Test/teardown helper: cancel retry timers and event listeners. */
  dispose(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    this.unlisten()
  }

  private listen(): void {
    const source = getEntityDataSource()
    try {
      this.unlisteners.push(source.onLinksChanged((workspaceId) => {
        if (workspaceId === this.workspaceId) this.invalidate()
      }))
    } catch { /* bridge missing: no live invalidation */ }
    try {
      const off = source.onEntitiesChanged?.((event) => this.entityChanged(event))
      if (off) this.unlisteners.push(off)
    } catch { /* optional */ }
  }

  private unlisten(): void {
    const unlisteners = this.unlisteners
    this.unlisteners = []
    for (const off of unlisteners) {
      try { off() } catch { /* ignore */ }
    }
  }

  private enqueue(key: string, ref: EntityRef): void {
    this.pending.add(key)
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
      this.settle(batch)
      this.markFailed(batch)
      return
    }
    this.settle(batch)
    const byKey = new Map(previews.map((preview) => [entityRefKey(preview.ref), preview]))
    const at = this.now()
    for (const ref of batch) {
      const key = entityRefKey(ref)
      this.clearFailure(key)
      const preview = byKey.get(key) ?? unavailableEntityPreview(ref)
      this.states.set(key, { status: 'ready', preview: applyPreviewRedaction(preview) })
      this.fetchedAt.set(key, at)
    }
    this.emit()
  }

  /** The batch's requests are done unless a newer request for the key was queued meanwhile. */
  private settle(batch: EntityRef[]): void {
    for (const ref of batch) {
      const key = entityRefKey(ref)
      if (!this.queue.has(key)) this.pending.delete(key)
    }
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
      const failures = (this.failureCounts.get(key) ?? 0) + 1
      this.failureCounts.set(key, failures)
      const existing = this.retryTimers.get(key)
      if (existing) clearTimeout(existing)
      this.retryTimers.set(key, setTimeout(() => {
        this.retryTimers.delete(key)
        if (!this.failed.has(key)) return
        const kept = this.retained.get(key)
        if (kept) this.enqueue(key, kept.ref)
        else {
          this.failed.delete(key)
          this.failureCounts.delete(key)
          this.states.delete(key)
          this.fetchedAt.delete(key)
          this.emit()
        }
      }, entityPreviewRetryDelay(failures, this.retryMs, this.retryMaxMs)))
    }
    this.emit()
  }

  private clearFailure(key: string): void {
    this.failed.delete(key)
    this.failureCounts.delete(key)
    const timer = this.retryTimers.get(key)
    if (timer) { clearTimeout(timer); this.retryTimers.delete(key) }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

const stores = new Map<string, EntityPreviewStore>()
let storeOptions: EntityPreviewStoreOptions = {}

export function entityPreviewStore(workspaceId: string): EntityPreviewStore {
  let store = stores.get(workspaceId)
  if (!store) { store = new EntityPreviewStore(workspaceId, storeOptions); stores.set(workspaceId, store) }
  return store
}

/** Hover-open: refetch `ref` in the background when its preview is older than the TTL. */
export function revalidateEntityPreview(workspaceId: string | null | undefined, ref: EntityRef | null): void {
  if (!workspaceId || !ref) return
  stores.get(workspaceId)?.revalidate(ref)
}

/** Drop cached previews (all workspaces, or one). Mounted chips refetch. */
export function invalidateEntityPreviews(workspaceId?: string): void {
  if (workspaceId) stores.get(workspaceId)?.invalidate()
  else for (const store of stores.values()) store.invalidate()
}

/** Test helper; options override retry/backoff/TTL timing (and the clock) for new stores. */
export function resetEntityPreviewStores(options: EntityPreviewStoreOptions = {}): void {
  for (const store of stores.values()) store.dispose()
  stores.clear()
  storeOptions = { ...options }
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
