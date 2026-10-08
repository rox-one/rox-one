/**
 * W1-02 — Resolver host.
 *
 * Fans a batch of refs across registered local resolvers, batches workspace
 * kinds through an injected remote fetch (the W2 `GET .../entities/resolve`
 * endpoint), caches by `etag` in a bounded LRU and preserves input order.
 */

import {
  EntityResolutionCache,
  type Actor,
  type EntityPreview,
  type EntityRef,
  type EntityKind,
  type Resolver,
  type ResolverHost,
} from '@rox/core/entities'
import { entityRefKey } from '@rox/core/entities'

export interface ResolverHostOptions {
  /** Optional remote fan-out for workspace-owned kinds. */
  remoteResolve?: (refs: EntityRef[], actor: Actor) => Promise<EntityPreview[]>
  /** LRU capacity (default 5000). */
  cacheCapacity?: number
  /** Max refs per resolver call (default 100). */
  batchSize?: number
}

function unavailablePreview(ref: EntityRef): EntityPreview {
  return {
    ref,
    status: 'unavailable',
    title: '',
    kindLabel: `entities.kind.${ref.kind}`,
    icon: 'link',
    authority: 'local',
    etag: '',
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export class DefaultResolverHost implements ResolverHost {
  private readonly byKind = new Map<EntityKind, Resolver>()
  private readonly cache: EntityResolutionCache
  private readonly remoteResolve?: (refs: EntityRef[], actor: Actor) => Promise<EntityPreview[]>
  private readonly batchSize: number

  constructor(options: ResolverHostOptions = {}) {
    this.cache = new EntityResolutionCache(options.cacheCapacity ?? 5000)
    this.remoteResolve = options.remoteResolve
    this.batchSize = options.batchSize ?? 100
  }

  register(resolver: Resolver): void {
    for (const kind of resolver.kinds) this.byKind.set(kind, resolver)
  }

  async resolve(refs: EntityRef[], actor: Actor): Promise<EntityPreview[]> {
    const results = new Map<string, EntityPreview>()
    const order: string[] = []
    const missing: EntityRef[] = []
    const queued = new Set<string>()

    for (const ref of refs) {
      const key = entityRefKey(ref)
      order.push(key)
      const cached = this.cache.get(key)
      if (cached) {
        results.set(key, cached)
        continue
      }
      if (queued.has(key)) continue
      queued.add(key)
      missing.push(ref)
    }

    if (missing.length > 0) {
      const grouped = new Map<Resolver, EntityRef[]>()
      const remote: EntityRef[] = []
      for (const ref of missing) {
        const resolver = this.byKind.get(ref.kind)
        if (resolver) {
          const list = grouped.get(resolver)
          if (list) list.push(ref)
          else grouped.set(resolver, [ref])
        } else {
          remote.push(ref)
        }
      }

      const jobs: Array<Promise<void>> = []
      for (const [resolver, list] of grouped) {
        for (const batch of chunk(list, this.batchSize)) {
          jobs.push(
            resolver.resolve(batch, actor).then(previews => {
              for (const preview of previews) {
                const key = entityRefKey(preview.ref)
                this.cache.set(key, preview)
                results.set(key, preview)
              }
            }),
          )
        }
      }
      if (this.remoteResolve && remote.length > 0) {
        for (const batch of chunk(remote, this.batchSize)) {
          jobs.push(
            this.remoteResolve(batch, actor).then(previews => {
              for (const preview of previews) {
                const key = entityRefKey(preview.ref)
                this.cache.set(key, preview)
                results.set(key, preview)
              }
            }),
          )
        }
      }
      await Promise.all(jobs)

      for (const ref of missing) {
        const key = entityRefKey(ref)
        if (!results.has(key)) results.set(key, unavailablePreview(ref))
      }
    }

    return order.map(key => results.get(key)!)
  }

  invalidate(ref: EntityRef): void {
    this.cache.delete(entityRefKey(ref))
  }

  clear(): void {
    this.cache.clear()
  }

  /** Exposed for metrics/tests. */
  get cacheSize(): number {
    return this.cache.size
  }
}