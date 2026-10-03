/** A bounded renderer hint. Native Knowledge RPC remains the authority. */
export interface KernelAvailabilityProbe {
  engineStatus?(args: { workspaceId?: string; connectionId?: string }): Promise<{ running: boolean; version?: string }>
  onChanged?(callback: () => void): () => void
}

export interface KernelAvailability {
  running: boolean
  version?: string
  checkedAt: number
  /** A timeout/missing channel/error is unknown, rather than evidence of absence. */
  status: 'confirmed' | 'unknown'
}

export interface KernelAvailabilityOptions {
  workspaceId?: string
  connectionId?: string
  ttlMs?: number
  timeoutMs?: number
  now?: () => number
}

export const KERNEL_AVAILABILITY_TTL_MS = 30_000
export const KERNEL_AVAILABILITY_TIMEOUT_MS = 3_000
export const KERNEL_AVAILABILITY_UNKNOWN_TTL_MS = 1_000

interface Entry {
  pending?: Promise<KernelAvailability>
  verdict?: KernelAvailability
}
let caches = new WeakMap<KernelAvailabilityProbe, Map<string, Entry>>()
const observers = new WeakMap<KernelAvailabilityProbe, {
  listeners: Set<() => void>
  unsubscribe: () => void
}>()

const keyFor = (opts: KernelAvailabilityOptions) => JSON.stringify([opts.workspaceId, opts.connectionId ?? null])
const duration = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? Math.min(value, 2_147_483_647) : fallback

async function probeOnce(api: KernelAvailabilityProbe | null | undefined, opts: KernelAvailabilityOptions): Promise<KernelAvailability> {
  const now = opts.now ?? Date.now
  const unknown = (): KernelAvailability => ({ running: false, status: 'unknown', checkedAt: now() })
  if (typeof api?.engineStatus !== 'function') return unknown()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), duration(opts.timeoutMs, KERNEL_AVAILABILITY_TIMEOUT_MS))
    })
    const response = await Promise.race([api.engineStatus({
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      ...(opts.connectionId ? { connectionId: opts.connectionId } : {}),
    }), timeout])
    if (!response || typeof response.running !== 'boolean') return unknown()
    return { running: response.running, status: 'confirmed', checkedAt: now(),
      ...(typeof response.version === 'string' ? { version: response.version } : {}) }
  } catch {
    return unknown()
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Explicit workspace + connection + API identity prevents cross-window reuse. */
export function getKernelAvailability(api: KernelAvailabilityProbe | null | undefined, opts: KernelAvailabilityOptions = {}): Promise<KernelAvailability> {
  // An implicit actor workspace can change without a stable cache key.
  if (!api || !opts.workspaceId) return probeOnce(api, opts)
  let cache = caches.get(api)
  if (!cache) { cache = new Map(); caches.set(api, cache) }
  const key = keyFor(opts)
  let entry = cache.get(key)
  const verdict = entry?.verdict
  if (verdict) {
    const age = (opts.now ?? Date.now)() - verdict.checkedAt
    const ttl = Math.min(duration(opts.ttlMs, KERNEL_AVAILABILITY_TTL_MS),
      verdict.status === 'unknown' ? KERNEL_AVAILABILITY_UNKNOWN_TTL_MS : Infinity)
    if (age >= 0 && age < ttl) return Promise.resolve({ ...verdict })
  }
  if (entry?.pending) return entry.pending.then(value => ({ ...value }))
  entry = {}
  cache.set(key, entry)
  const owner = entry
  entry.pending = probeOnce(api, opts).then(value => {
    // Invalidation deletes this entry. An older probe cannot repopulate it or
    // clear a replacement request after A→B→A / a connection-change event.
    if (cache.get(key) === owner) { owner.verdict = value; owner.pending = undefined }
    return value
  })
  return entry.pending.then(value => ({ ...value }))
}

export function invalidateKernelAvailability(api: KernelAvailabilityProbe, workspaceId?: string): void {
  const cache = caches.get(api)
  if (!cache) return
  if (!workspaceId) { cache.clear(); return }
  for (const key of cache.keys()) if (JSON.parse(key)[0] === workspaceId) cache.delete(key)
}

/** One invalidation per native event, then all mounted consumers share the fresh probe. */
export function observeKernelAvailability(api: KernelAvailabilityProbe, refresh: () => void): () => void {
  if (typeof api.onChanged !== 'function') return () => {}
  let observer = observers.get(api)
  if (!observer) {
    const listeners = new Set<() => void>()
    const unsubscribe = api.onChanged(() => {
      invalidateKernelAvailability(api)
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue
        try { listener() } catch { /* One disposed consumer cannot block other current readers. */ }
      }
    })
    observer = { listeners, unsubscribe }
    observers.set(api, observer)
  }
  observer.listeners.add(refresh)
  const owner = observer
  return () => {
    owner.listeners.delete(refresh)
    if (owner.listeners.size === 0 && observers.get(api) === owner) {
      observers.delete(api)
      owner.unsubscribe()
    }
  }
}

/** Test isolation only; production invalidation uses the native event subscription. */
export function __resetKernelAvailabilityForTests(): void { caches = new WeakMap() }
