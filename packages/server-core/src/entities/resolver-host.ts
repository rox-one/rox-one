/**
 * W1-02 — Resolver host.
 *
 * Fans a batch of refs across registered local resolvers, batches workspace
 * kinds through an injected remote fetch (the W2 `GET .../entities/resolve`
 * endpoint), caches per actor + ref in a bounded LRU and preserves input
 * order. Each resolver batch is isolated: a rejecting resolver marks only
 * its own refs `unavailable` instead of failing the whole batch.
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
import { resolveWithAcl, type EntityAclGate } from './acl-gate.ts'

export interface ResolverHostOptions {
  /** Optional remote fan-out for workspace-owned kinds. */
  remoteResolve?: (refs: EntityRef[], actor: Actor) => Promise<EntityPreview[]>
  /** LRU capacity (default 5000). */
  cacheCapacity?: number
  /** Preview TTL in ms (default 60s; 0 disables expiry). */
  cacheTtlMs?: number
  /** Max refs per resolver call (default 100). */
  batchSize?: number
  /**
   * W1-04 (#1501): ACL gate (or a pending one — the injected runtime may be
   * async); every resolve is checked per ref via `acl.evaluate`.
   */
  acl?: EntityAclGate | Promise<EntityAclGate>
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

function chunkWithIndices<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Actor-scoped cache key so one user's preview never leaks to another. */
export function resolverCacheKey(actor: Actor, ref: EntityRef): string {
  return `${actor.kind}:${actor.id}\0${entityRefKey(ref)}`
}

export class DefaultResolverHost implements ResolverHost {
  private readonly byKind = new Map<EntityKind, Resolver>()
  private readonly cache: EntityResolutionCache
  private readonly remoteResolve?: (refs: EntityRef[], actor: Actor) => Promise<EntityPreview[]>
  private readonly batchSize: number
  private readonly aclGate?: EntityAclGate | Promise<EntityAclGate>

  constructor(options: ResolverHostOptions = {}) {
    this.cache = new EntityResolutionCache(options.cacheCapacity ?? 5000, options.cacheTtlMs ?? 60_000)
    this.remoteResolve = options.remoteResolve
    this.batchSize = options.batchSize ?? 100
    this.aclGate = options.acl
  }

  register(resolver: Resolver): void {
    for (const kind of resolver.kinds) this.byKind.set(kind, resolver)
  }

  /** Drop a single kind registration (tests + owner-module teardown). */
  unregisterKind(kind: EntityKind): void {
    this.byKind.delete(kind)
  }

  /** Drop all registrations and cached previews. */
  reset(): void {
    this.byKind.clear()
    this.cache.clear()
  }

  async resolve(refs: EntityRef[], actor: Actor): Promise<EntityPreview[]> {
    // W1-04 (#1501): previews are computed with the viewer's rights. Denied
    // refs never reach a resolver; the cache below only ever sees allowed refs.
    if (this.aclGate) return resolveWithAcl(await this.aclGate, refs, actor, allowed => this.resolveUnchecked(allowed, actor))
    return this.resolveUnchecked(refs, actor)
  }

  private async resolveUnchecked(refs: EntityRef[], actor: Actor): Promise<EntityPreview[]> {
    const out: (EntityPreview | undefined)[] = new Array(refs.length)
    const cacheKeys = refs.map(ref => resolverCacheKey(actor, ref))
    // Dedupe identical refs (same actor + ref) to a single resolver call.
    const indicesByKey = new Map<string, number[]>()
    const firstRefByKey = new Map<string, EntityRef>()
    for (let i = 0; i < refs.length; i++) {
      const key = cacheKeys[i]!
      const cached = this.cache.get(key)
      if (cached) {
        out[i] = cached
        continue
      }
      if (!indicesByKey.has(key)) {
        indicesByKey.set(key, [])
        firstRefByKey.set(key, refs[i]!)
      }
      indicesByKey.get(key)!.push(i)
    }

    const missingKeys = [...indicesByKey.keys()]
    if (missingKeys.length > 0) {
      const missingRefs = missingKeys.map(key => firstRefByKey.get(key)!)
      const grouped = new Map<Resolver, { refs: EntityRef[]; keys: string[] }>()
      const remoteRefs: EntityRef[] = []
      const remoteKeys: string[] = []
      for (let i = 0; i < missingRefs.length; i++) {
        const ref = missingRefs[i]!
        const key = missingKeys[i]!
        const resolver = this.byKind.get(ref.kind)
        if (resolver) {
          let entry = grouped.get(resolver)
          if (!entry) {
            entry = { refs: [], keys: [] }
            grouped.set(resolver, entry)
          }
          entry.refs.push(ref)
          entry.keys.push(key)
        } else {
          remoteRefs.push(ref)
          remoteKeys.push(key)
        }
      }

      const assign = (key: string, preview: EntityPreview, cacheable = true): void => {
        if (cacheable) this.cache.set(key, preview)
        for (const index of indicesByKey.get(key) ?? []) out[index] = preview
      }

      const assignBatch = (batchRefs: EntityRef[], batchKeys: string[], previews: EntityPreview[] | undefined): void => {
        for (let i = 0; i < batchRefs.length; i++) {
          const inputRef = batchRefs[i]!
          const key = batchKeys[i]!
          const preview = previews?.[i]
          if (preview) assign(key, preview, true)
          else assign(key, unavailablePreview(inputRef), false)
        }
      }

      const jobs: Array<Promise<void>> = []
      for (const [resolver, entry] of grouped) {
        const batchesRefs = chunkWithIndices(entry.refs, this.batchSize)
        // Keep keys aligned with refs when chunking.
        let offset = 0
        for (const batchRefs of batchesRefs) {
          const batchKeys = entry.keys.slice(offset, offset + batchRefs.length)
          offset += batchRefs.length
          jobs.push(
            (async (): Promise<void> => {
              try {
                const previews = await resolver.resolve(batchRefs, actor)
                assignBatch(batchRefs, batchKeys, previews)
              } catch {
                assignBatch(batchRefs, batchKeys, undefined)
              }
            })(),
          )
        }
      }
      if (this.remoteResolve && remoteRefs.length > 0) {
        let offset = 0
        for (const batchRefs of chunkWithIndices(remoteRefs, this.batchSize)) {
          const batchKeys = remoteKeys.slice(offset, offset + batchRefs.length)
          offset += batchRefs.length
          const remote = this.remoteResolve
          jobs.push(
            (async (): Promise<void> => {
              try {
                const previews = await remote(batchRefs, actor)
                assignBatch(batchRefs, batchKeys, previews)
              } catch {
                assignBatch(batchRefs, batchKeys, undefined)
              }
            })(),
          )
        }
      } else if (remoteRefs.length > 0) {
        for (let i = 0; i < remoteRefs.length; i++) {
          assign(remoteKeys[i]!, unavailablePreview(remoteRefs[i]!), false)
        }
      }
      await Promise.all(jobs)

      for (let i = 0; i < out.length; i++) {
        if (!out[i]) {
          out[i] = unavailablePreview(refs[i]!)
        }
      }
    }

    return out as EntityPreview[]
  }

  invalidate(ref: EntityRef): void {
    this.cache.deleteBySuffix(`\0${entityRefKey(ref)}`)
  }

  clear(): void {
    this.cache.clear()
  }

  /** Exposed for metrics/tests. */
  get cacheSize(): number {
    return this.cache.size
  }
}
