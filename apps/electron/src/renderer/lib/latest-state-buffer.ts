/**
 * Subscribe to a pushed-state source now and remember the latest value, so a
 * consumer that mounts later (standalone entries wait for their locale chunk
 * before the first render) still sees a state pushed in the meantime. The main
 * process pushes some states only once (e.g. the browser toolbar's state on
 * did-finish-load), so a late subscriber would otherwise miss it.
 */
export type StateSource<T> = (callback: (value: T) => void) => () => void

export interface LatestStateBuffer<T> {
  /** Replays the latest value (if any) synchronously, then forwards live values. */
  subscribe: StateSource<T>
  latest(): T | undefined
  dispose(): void
}

export function createLatestStateBuffer<T>(source: StateSource<T> | undefined): LatestStateBuffer<T> {
  let hasValue = false
  let value: T | undefined
  const listeners = new Set<(value: T) => void>()
  const unsubscribe = source?.(next => {
    hasValue = true
    value = next
    for (const listener of [...listeners]) listener(next)
  })
  return {
    subscribe(callback) {
      listeners.add(callback)
      if (hasValue) callback(value as T)
      return () => { listeners.delete(callback) }
    },
    latest: () => value,
    dispose() {
      listeners.clear()
      unsubscribe?.()
    },
  }
}
