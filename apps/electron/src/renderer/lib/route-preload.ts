/**
 * PERF-10 (#1577) — memoized route-chunk preloading.
 *
 * `React.lazy` resolves a page from the module cache only after the dynamic
 * import ran once, so warm-up and hover/focus prefetch must ask for the same
 * promise the lazy page will ask for. The preloader keeps exactly one promise
 * per route, never re-imports a loaded chunk and drops a failed attempt so the
 * route error boundary's retry can try again.
 */
export interface RoutePreloader<Name extends string> {
  /** Load the chunk now; repeat calls share the first promise. */
  preload(name: Name): Promise<unknown>
  /** Routes already asked for (report/introspection). */
  preloaded(): readonly Name[]
  /** A failed preload is forgotten; successful ones stay. */
  failed(): readonly Name[]
  /** Forget every preload (tests only). */
  reset(): void
}

export function createRoutePreloader<Name extends string>(
  loaders: Record<Name, () => Promise<unknown>>,
): RoutePreloader<Name> {
  const preloads = new Map<Name, Promise<unknown>>()
  const failures = new Set<Name>()
  return {
    preload(name: Name): Promise<unknown> {
      const existing = preloads.get(name)
      if (existing) return existing
      failures.delete(name)
      const promise = Promise.resolve(loaders[name]()).catch((error: unknown) => {
        preloads.delete(name)
        failures.add(name)
        throw error
      })
      preloads.set(name, promise)
      return promise
    },
    preloaded(): readonly Name[] {
      return [...preloads.keys()]
    },
    failed(): readonly Name[] {
      return [...failures]
    },
    reset(): void {
      preloads.clear()
      failures.clear()
    },
  }
}