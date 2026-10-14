/**
 * Retained-surface node budget gate (2026-10-13 audit, S6-03 / S9-02).
 *
 * The Bun harness measures a pure-JS model: no React, no DOM, so it cannot
 * observe how large the retained set actually is — which is why the gate stayed
 * green while the running application reached 227 318 nodes and 803 MB of
 * renderer heap. What the harness *can* do is enforce the retention policy
 * against the node counts a real renderer produces. The weights below are the
 * audit's measurements of the running application, used verbatim, so the gate
 * fails for the same reason the application did.
 *
 * `simulateSurfaceKeepAlive` drives the same `advanceRetention`; the difference
 * here is that weight is supplied, because weight is what the count cap missed.
 */
import {
  EMPTY_RETENTION,
  SURFACE_KEEPALIVE_NODE_BUDGET,
  advanceRetention,
  type RetentionState,
} from '../lib/surface-keepalive'

/**
 * Node counts measured in the running renderer.
 * Source: E2E audit 2026-10-13, `evidence/surfaces.json` (`dom` per route) and
 * `evidence/skills-bench.json`. Ordinary surfaces cluster at 1 417–4 113;
 * catalogs are two orders of magnitude larger, and that spread is the bug.
 */
export const MEASURED_SURFACE_NODE_WEIGHTS: Record<string, number> = {
  connections: 1_417,
  sessions: 4_113,
  notes: 4_113,
  feed: 3_000,
  home: 2_726,
  sources: 80_936,
  skills: 177_703,
  'settings/extensions': 226_741,
  'settings/marketplace': 227_318,
}

/** A route with no measurement is treated as an ordinary surface, never as free. */
const UNMEASURED_SURFACE_NODES = 4_000

export function surfaceNodeWeight(key: string): number {
  return MEASURED_SURFACE_NODE_WEIGHTS[key] ?? UNMEASURED_SURFACE_NODES
}

/**
 * The route walk that produced the audit's 227 318-node observation: a few
 * ordinary surfaces, then the catalogs, then back to a light one.
 */
export const AUDIT_ROUTE_WALK: readonly string[] = [
  'connections',
  'skills',
  'sources',
  'settings/extensions',
  'settings/marketplace',
  'notes',
  'sessions',
  'feed',
]

export interface RetainedNodeBudgetVerdict {
  /** Surfaces still mounted at the end of the walk. */
  retainedKeys: readonly string[]
  /** Summed node weight of that set. */
  nodeWeight: number
  /** Heaviest single retained surface. */
  heaviest: { key: string; nodes: number } | null
  budget: number
  capacity: number
  passed: boolean
  reasons: string[]
}

export interface RetainedNodeBudgetOptions {
  /** Budget the retained set is judged against. Defaults to the runtime budget. */
  nodeBudget?: number
  /**
   * `true` (default) replays the weight-aware policy. `false` replays the
   * pre-fix policy — LRU by count, weight invisible — which is the negative
   * control: it must fail this same budget.
   */
  weightAware?: boolean
}

/**
 * Replay `visits` through the retention policy and report the node weight of
 * what stayed mounted. The verdict is always judged against the runtime budget,
 * so switching `weightAware` off changes the policy, never the yardstick.
 */
export function evaluateRetainedNodeBudget(
  visits: readonly string[] = AUDIT_ROUTE_WALK,
  capacity: number,
  options: RetainedNodeBudgetOptions = {},
): RetainedNodeBudgetVerdict {
  const nodeBudget = options.nodeBudget ?? SURFACE_KEEPALIVE_NODE_BUDGET
  const weightAware = options.weightAware ?? true
  let state: RetentionState = EMPTY_RETENTION
  let outgoing: { key: string; node: null } | null = null
  for (const key of visits) {
    state = advanceRetention(
      state,
      outgoing,
      key,
      capacity,
      weightAware ? { nodeBudget, weightOf: surfaceNodeWeight } : undefined,
    )
    outgoing = { key, node: null }
  }

  let nodeWeight = 0
  let heaviest: { key: string; nodes: number } | null = null
  for (const key of state.keys) {
    const nodes = surfaceNodeWeight(key)
    nodeWeight += nodes
    if (!heaviest || nodes > heaviest.nodes) heaviest = { key, nodes }
  }

  const reasons: string[] = []
  if (nodeWeight > nodeBudget) {
    reasons.push(
      `retained set ${nodeWeight} nodes > budget ${nodeBudget} (heaviest: ${heaviest?.key} ${heaviest?.nodes})`,
    )
  }
  if (state.keys.length > capacity) {
    reasons.push(`retained ${state.keys.length} surfaces > capacity ${capacity}`)
  }

  return {
    retainedKeys: state.keys,
    nodeWeight,
    heaviest,
    budget: nodeBudget,
    capacity,
    passed: reasons.length === 0,
    reasons,
  }
}

/** The gate the CI report runs: audit walk, default capacity, runtime budget. */
export function evaluateRetainedNodeBudgetGate(
  capacity: number,
  nodeBudget = SURFACE_KEEPALIVE_NODE_BUDGET,
): RetainedNodeBudgetVerdict {
  return evaluateRetainedNodeBudget(AUDIT_ROUTE_WALK, capacity, { nodeBudget })
}

export function formatRetainedNodeReport(verdict: RetainedNodeBudgetVerdict): string {
  const retained = verdict.retainedKeys
    .map((key) => `${key}=${surfaceNodeWeight(key)}`)
    .join(', ')
  return [
    `retained-set nodes: ${verdict.nodeWeight} (budget ${verdict.budget})`,
    `  retained: ${retained || '(none)'}`,
    `  heaviest: ${verdict.heaviest ? `${verdict.heaviest.key} ${verdict.heaviest.nodes}` : '(none)'}`,
    `  verdict:  ${verdict.passed ? 'pass' : `FAIL — ${verdict.reasons.join('; ')}`}`,
  ].join('\n')
}
