/**
 * W1-02 — Resolver contracts and resolution cache.
 *
 * A `Resolver` owns one or more kinds and resolves refs in batches. The
 * resolver host fans a batch across registered resolvers, caches by `etag`
 * (so `entity.changed` invalidates precisely) and applies an in-memory LRU.
 */

import type { EntityKind } from './kinds.ts'
import type { EntityRef } from './refs.ts'
import type { EntityPreview } from './preview.ts'

export interface Actor {
  id: string
  kind: 'user' | 'system' | 'agent'
}

/** One resolver query for the host fan-out. */
export interface EntityResolutionRequest {
  refs: EntityRef[]
  actor: Actor
  /** Optional preview hints (e.g. which kinds to allow). */
  kinds?: EntityKind[]
}

export interface Resolver {
  /** Kinds this resolver can serve. */
  kinds: EntityKind[]
  /** Resolve a batch; MUST return one preview per input ref, in order. */
  resolve(refs: EntityRef[], actor: Actor): Promise<EntityPreview[]>
}

export interface ResolverHost {
  /** Register a resolver for its kinds (later registrations win per kind). */
  register(resolver: Resolver): void
  /** Resolve a batch across registered resolvers, using the cache. */
  resolve(refs: EntityRef[], actor: Actor): Promise<EntityPreview[]>
  /** Drop cached entries for a ref (realtime `entity.changed`). */
  invalidate(ref: EntityRef): void
  /** Drop all cached entries. */
  clear(): void
}

interface CacheEntry {
  etag: string
  preview: EntityPreview
}

/**
 * Bounded LRU keyed by `entityRefKey`, storing the last preview + etag per
 * ref. Entries are evicted least-recently-used first.
 */
export class EntityResolutionCache {
  private readonly capacity: number
  private readonly map = new Map<string, CacheEntry>()

  constructor(capacity = 5000) {
    this.capacity = capacity
  }

  get size(): number {
    return this.map.size
  }

  get(key: string): EntityPreview | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    // Refresh recency.
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.preview
  }

  set(key: string, preview: EntityPreview): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { etag: preview.etag, preview })
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next()
      if (!oldest.done) this.map.delete(oldest.value)
    }
  }

  /** Store a preview only when its etag differs from the cached one. */
  setIfEtagChanged(key: string, preview: EntityPreview): boolean {
    const existing = this.map.get(key)
    if (existing && existing.etag === preview.etag) return false
    this.set(key, preview)
    return true
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  /** Delete every entry whose key ends with `suffix` (actor-scoped invalidation). */
  deleteBySuffix(suffix: string): void {
    for (const key of [...this.map.keys()]) {
      if (key.endsWith(suffix)) this.map.delete(key)
    }
  }

  clear(): void {
    this.map.clear()
  }
}