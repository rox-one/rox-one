/**
 * PERF-10 (#1577) — keep-alive surface host.
 *
 * `MainContentPanel` used to build exactly one surface per render, so every
 * route change unmounted the outgoing one (state, scroll, subscriptions and
 * loaded chunks were thrown away and paid for again on the way back). The host
 * here retains the last few visited surfaces: the active one renders normally,
 * retired ones stay mounted inside a pane marked `hidden` +
 * `content-visibility: hidden`, and a revisit restores the live tree instead of
 * mounting a new one.
 *
 * The retention policy (`advanceRetention`) is a pure LRU so both unit tests
 * and the CI bench drive exactly the code the shell runs. `useSurfaceActive()`
 * is the contract pages use to pause timers/subscriptions while hidden;
 * `useEffectiveVisible()` covers the polling case.
 */
import * as React from 'react'

/** Retained surfaces by default (owner decision D2). */
export const SURFACE_KEEPALIVE_CAPACITY = 5
/** Retained surfaces on a low-memory machine. */
export const SURFACE_KEEPALIVE_LOW_MEMORY_CAPACITY = 3

export interface RetentionState {
  /** LRU order: least recently used first, the active key last. */
  readonly keys: readonly string[]
  /** Snapshots of retired keys; never contains the active key. */
  readonly snapshots: ReadonlyMap<string, React.ReactNode>
}

export const EMPTY_RETENTION: RetentionState = { keys: [], snapshots: new Map() }

function orderedCapacity(capacity: number): number {
  return Math.max(1, Math.floor(capacity))
}

/**
 * Advance the retained set when `activeKey` becomes the visible surface.
 * `outgoing` is the surface that was active in the previous render (its node
 * is snapshotted so its mounted tree survives); evictions drop the oldest
 * retired surface and never the active one.
 */
export function advanceRetention(
  state: RetentionState,
  outgoing: { key: string; node: React.ReactNode } | null,
  activeKey: string,
  capacity: number,
): RetentionState {
  const snapshots = new Map(state.snapshots)
  const order = state.keys.filter(key => key !== activeKey)
  if (outgoing && outgoing.key !== activeKey) {
    snapshots.set(outgoing.key, outgoing.node)
    const existing = order.indexOf(outgoing.key)
    if (existing >= 0) order.splice(existing, 1)
    order.push(outgoing.key)
  }
  order.push(activeKey)
  const limit = orderedCapacity(capacity)
  while (order.length > limit) {
    const dropped = order.shift()
    if (dropped !== undefined) snapshots.delete(dropped)
  }
  snapshots.delete(activeKey)
  return { keys: order, snapshots }
}

/** `navigator.deviceMemory` is Chromium-only; absent means "unknown, assume enough". */
export function detectKeepAliveCapacity(deviceMemoryGb?: number): number {
  const memory = deviceMemoryGb
    ?? (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined)
  return typeof memory === 'number' && Number.isFinite(memory) && memory <= 4
    ? SURFACE_KEEPALIVE_LOW_MEMORY_CAPACITY
    : SURFACE_KEEPALIVE_CAPACITY
}

const SurfaceActiveContext = React.createContext(true)

let capacityOverride: number | null = null

/** Test hook: force a capacity (or `null` to read the machine again). */
export function setSurfaceKeepAliveForTests(capacity: number | null): void {
  capacityOverride = capacity
}

/**
 * Retention the shell runs with: `rox:surface-keepalive = off` keeps exactly
 * one surface (the previous, unmount-on-leave behaviour); otherwise the
 * machine's memory decides between five and three.
 */
export function surfaceKeepAliveCapacity(): number {
  if (capacityOverride !== null) return capacityOverride
  if (typeof localStorage !== 'undefined') {
    try {
      if (localStorage.getItem('rox:surface-keepalive') === 'off') return 1
    } catch {
      // Storage denied: fall through to the memory-based policy.
    }
  }
  return detectKeepAliveCapacity()
}

/** Marks the subtree as the active surface (or a retired one). */
export function SurfaceActiveProvider({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <SurfaceActiveContext.Provider value={active}>{children}</SurfaceActiveContext.Provider>
}

/** True while the enclosing surface is the visible one. Defaults to true outside a host. */
export function useSurfaceActive(): boolean {
  return React.useContext(SurfaceActiveContext)
}

/**
 * Effective visibility for polling: the window is visible AND the enclosing
 * surface is active. Timers/subscriptions behind this stop for a hidden
 * surface even though the window itself is visible.
 */
export function useEffectiveVisible(): boolean {
  const active = useSurfaceActive()
  const [windowVisible, setWindowVisible] = React.useState(() => {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden'
  })
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => setWindowVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return active && windowVisible
}

export interface RetainedSurfacePaneProps {
  active: boolean
  children: React.ReactNode
}

/**
 * A retained surface's pane. The active pane is `display: contents` (it adds
 * no layout box); a retired one is `hidden` + `content-visibility: hidden`,
 * inert (no focus, no AT) and provides `active: false` to its subtree.
 */
export function RetainedSurfacePane({ active, children }: RetainedSurfacePaneProps) {
  const container = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    element.inert = !active
    if (!active && element.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur()
    }
  }, [active])
  return (
    <div
      ref={container}
      hidden={!active}
      aria-hidden={!active || undefined}
      data-surface-active={active ? 'true' : 'false'}
      data-surface-retained="true"
      style={{
        display: active ? 'contents' : 'none',
        contentVisibility: active ? undefined : 'hidden',
      }}
    >
      <SurfaceActiveProvider active={active}>{children}</SurfaceActiveProvider>
    </div>
  )
}

export interface RetainedSurfaceEntry {
  key: string
  node: React.ReactNode
}

/**
 * Retain the last `capacity` surfaces. Every render the active key's node is
 * refreshed; retired keys keep the element they had when they were active, so
 * their mounted trees (state, scroll, subscriptions) survive.
 */
export function useKeepAliveSurfaces(
  activeKey: string,
  activeNode: React.ReactNode,
  capacity: number,
): readonly RetainedSurfaceEntry[] {
  const [state, setState] = React.useState<RetentionState>(
    () => advanceRetention(EMPTY_RETENTION, null, activeKey, capacity),
  )
  // Outgoing surface of the previous render; its node is snapshotted when the
  // active key moves so its mounted tree survives.
  const lastRender = React.useRef<{ key: string; node: React.ReactNode } | null>(null)

  const previous = lastRender.current
  lastRender.current = { key: activeKey, node: activeNode }

  // Derive the adjustment from the COMMITTED state: the retention set is
  // already correct exactly when it contains this render's active key. The
  // previous `applied` ref guarded this with a value mutated during render;
  // when React discards and re-invokes a render (StrictMode) it advanced ahead
  // of the committed state, every later render skipped the correction and the
  // active key's snapshot was evicted, leaving an empty entry list. Reading
  // only committed state makes the derivation identical in every invocation,
  // so a discarded render can never produce an empty entry list.
  const stale = !state.keys.includes(activeKey)
  const current = stale ? advanceRetention(state, previous, activeKey, capacity) : state
  if (stale) {
    // Render-phase adjustment (React's "adjust state while rendering"): the
    // outgoing surface must be snapshotted before this render commits,
    // otherwise its tree would be unmounted for one commit and lose the state
    // keep-alive exists to preserve. React re-runs this component with the new
    // state before committing, so the stale pass is discarded.
    setState(current)
  }

  const entries: RetainedSurfaceEntry[] = []
  for (const key of current.keys) {
    if (key === activeKey) {
      entries.push({ key, node: activeNode })
      continue
    }
    const node = current.snapshots.get(key)
    if (node === undefined) continue
    entries.push({ key, node })
  }
  return entries
}