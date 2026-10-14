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

/**
 * Node budget for the whole retained set (every pane together).
 *
 * Provenance: the 2026-10-13 E2E audit measured the retained set at 227 318
 * nodes / 803 MB renderer heap after 13 rail surfaces — the count cap alone is
 * not a bound, because weight varies by two orders of magnitude: ordinary
 * surfaces stay in the 1.4–4 k range, while `settings/extensions` renders
 * 226 741 nodes and `skills` 177 703. Five catalogs therefore fit inside
 * `SURFACE_KEEPALIVE_CAPACITY` and still exhaust the renderer.
 *
 * Eviction is consequently weight-aware: after the count cap, the LRU set is
 * trimmed until the summed node weight of the retained surfaces fits here.
 */
export const SURFACE_KEEPALIVE_NODE_BUDGET = 20_000

/** Node weight of a retained surface: descendants of its pane, DOM-only and cheap. */
export function surfaceNodeWeight(root: Element | null | undefined): number {
  if (!root) return 0
  return root.querySelectorAll('*').length
}

/** Weight-aware companion to the count cap; when omitted, weight bounds nothing. */
export interface RetentionBudget {
  /** Maximum summed node weight of the retained set. */
  readonly nodeBudget: number
  /** Weight of a retained surface; `0` while it has not been measured yet. */
  readonly weightOf: (key: string) => number
}

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
  budget?: RetentionBudget,
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
  // Weight cap second: a surface small enough to survive the count cap can still
  // be a 200 k-node catalog, and five of those are what exhausted the renderer.
  if (budget) {
    let total = 0
    for (const key of order) total += budget.weightOf(key)
    while (total > budget.nodeBudget && order.length > 1) {
      const oldestRetired = order.findIndex(key => key !== activeKey)
      if (oldestRetired < 0) break
      const [dropped] = order.splice(oldestRetired, 1)
      snapshots.delete(dropped)
      total -= budget.weightOf(dropped)
    }
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
  /**
   * Called with the pane's node weight once it is retired. The host needs it
   * before the next eviction decides which surface is too heavy to retain.
   */
  onWeight?: (weight: number) => void
}

/**
 * A retained surface's pane. The active pane is `display: contents` (it adds
 * no layout box); a retired one is `hidden` + `content-visibility: hidden`,
 * inert (no focus, no AT) and provides `active: false` to its subtree.
 */
export function RetainedSurfacePane({ active, children, onWeight }: RetainedSurfacePaneProps) {
  const container = React.useRef<HTMLDivElement>(null)
  const reportWeight = React.useRef(onWeight)
  reportWeight.current = onWeight
  React.useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    element.inert = !active
    if (active) return
    if (element.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur()
    }
    // Measured on the way out: the retained tree keeps its DOM, so this is the
    // cost the host must weigh before retaining one more surface alongside it.
    reportWeight.current?.(surfaceNodeWeight(element))
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
  /** Stable per key — hand it to `RetainedSurfacePane.onWeight`. */
  reportWeight: (weight: number) => void
}

/** The retention the host has already applied, plus the key/capacity it belongs to. */
interface AppliedRetention {
  key: string
  capacity: number
  retention: RetentionState
}

/**
 * Retain the last `capacity` surfaces. Every render the active key's node is
 * refreshed; retired keys keep the element they had when they were active, so
 * their mounted trees (state, scroll, subscriptions) survive.
 *
 * The adjustment is a render-phase state update (the outgoing surface must be
 * snapshotted before this render commits, or its tree is unmounted for one
 * commit and loses the state keep-alive exists to preserve). Both the decision
 * and the outgoing node come from *committed* data — the `applied` state and a
 * ref written in a layout effect — because a render React discards (StrictMode's
 * double render, a concurrent restart) must not advance the bookkeeping: a ref
 * mutated during render would swallow the update and the host would commit no
 * surface at all.
 */
export function useKeepAliveSurfaces(
  activeKey: string,
  activeNode: React.ReactNode,
  capacity: number,
  options?: { nodeBudget?: number },
): readonly RetainedSurfaceEntry[] {
  const [applied, setApplied] = React.useState<AppliedRetention>(() => ({
    key: activeKey,
    capacity,
    retention: advanceRetention(EMPTY_RETENTION, null, activeKey, capacity),
  }))
  // Written only on commit, so it always names the surface that is actually
  // mounted when the next route change needs to snapshot it.
  const committed = React.useRef<{ key: string; node: React.ReactNode } | null>(null)
  // Weights and reporters are plain refs: a measurement must never trigger a
  // render, and both are read only where the next eviction is decided.
  const weights = React.useRef(new Map<string, number>())
  const reporters = React.useRef(new Map<string, (weight: number) => void>())
  const nodeBudget = options?.nodeBudget ?? SURFACE_KEEPALIVE_NODE_BUDGET
  const budget = React.useMemo<RetentionBudget>(() => ({
    nodeBudget,
    weightOf: (key: string) => weights.current.get(key) ?? 0,
  }), [nodeBudget])
  React.useLayoutEffect(() => {
    committed.current = { key: activeKey, node: activeNode }
    // Drop measurements of evicted surfaces so the maps track the retained set.
    const retained = new Set(applied.retention.keys)
    for (const key of weights.current.keys()) {
      if (retained.has(key)) continue
      weights.current.delete(key)
      reporters.current.delete(key)
    }
  })

  if (applied.key !== activeKey || applied.capacity !== capacity) {
    setApplied({
      key: activeKey,
      capacity,
      retention: advanceRetention(applied.retention, committed.current, activeKey, capacity, budget),
    })
  }

  const reporterFor = (key: string): ((weight: number) => void) => {
    const existing = reporters.current.get(key)
    if (existing) return existing
    const reporter = (weight: number) => { weights.current.set(key, weight) }
    reporters.current.set(key, reporter)
    return reporter
  }

  const entries: RetainedSurfaceEntry[] = []
  for (const key of applied.retention.keys) {
    if (key === activeKey) {
      entries.push({ key, node: activeNode, reportWeight: reporterFor(key) })
      continue
    }
    const node = applied.retention.snapshots.get(key)
    if (node === undefined) continue
    entries.push({ key, node, reportWeight: reporterFor(key) })
  }
  return entries
}