/**
 * DOM render budgets measured in a real Chromium page (W3.4c, D7).
 *
 * The Bun harness in `runner.ts` measures pure-JS surface simulations with no
 * React or DOM (PERF-03). These marks close that gap: they are produced by
 * `tests/perf/dom-renderer.spec.ts` mounting the real list primitives against
 * large fixtures, and consumed by the same percentile math as the Bun gates.
 *
 * Only `ciGate: true` rows fail CI. Thresholds are anchored to the observed
 * "before" numbers (see `thresholdNote`) with deliberate headroom so a warm CI
 * run does not flake while a real regression still trips the gate.
 */

export const DOM_PERF_MARK_NAMES = [
  'dom_session_list_first_render',
  'dom_session_list_unvirtualized_first_render',
  'dom_session_list_scroll',
  'dom_notes_navigator_first_render',
  'dom_notes_navigator_switch',
] as const

export type DomPerfMarkName = (typeof DOM_PERF_MARK_NAMES)[number]

/** Fixture volumes the DOM budgets are declared against. */
export const DOM_PERF_FIXTURE = {
  /** Rows rendered through EntityList + EntityRow (the session list primitive). */
  sessionRows: 2000,
  /** Notes rendered through the production NotesNavigationSidebar. */
  vaultNotes: 5000,
  /** Remounts measured per mark; the p95 is taken over all warm samples. */
  iterations: 8,
} as const

export interface DomBudgetDefinition {
  name: DomPerfMarkName
  /** p95 latency budget in milliseconds. */
  p95Ms: number
  ciGate: boolean
  /** What the mark measures, in one line. */
  measures: string
  /** Why this threshold: the observed "before" value and headroom policy. */
  thresholdNote: string
}

export const DOM_PERF_BUDGETS: Record<DomPerfMarkName, DomBudgetDefinition> = {
  dom_session_list_first_render: {
    name: 'dom_session_list_first_render',
    p95Ms: 600,
    ciGate: true,
    measures:
      'commit + first paint of 2,000 session rows through the virtualizing EntityList + EntityRow, warm repeat mount',
    thresholdNote:
      'Observed across two runs: unvirtualized 3167-3409ms vs virtualized warm p95 70-87ms (p50 69-74). Threshold 600ms sits ~7x above the virtualized number and ~5x below the unvirtualized one, so losing virtualization (or a too-large window) trips while CI jitter passes.',
  },
  dom_session_list_unvirtualized_first_render: {
    name: 'dom_session_list_unvirtualized_first_render',
    p95Ms: 6000,
    ciGate: false,
    measures:
      'reference "before": commit + first paint of 2,000 session rows with EntityList virtualization off (all rows mounted)',
    thresholdNote:
      'Observed 3167-3409ms. Informational ceiling only: it exists so the gated virtualized mark has a same-run contrast; the gap between the two is the virtualization win.',
  },
  dom_session_list_scroll: {
    name: 'dom_session_list_scroll',
    p95Ms: 150,
    ciGate: false,
    measures: 'p95 per-step frame time while scrolling the 2,000-row virtualized list viewport top-to-bottom',
    thresholdNote:
      'Observed p95 74-82ms (p50 71-76) with per-step windowed re-render. Informational: only a gross scroll regression should matter, so the ceiling is loose.',
  },
  dom_notes_navigator_first_render: {
    name: 'dom_notes_navigator_first_render',
    p95Ms: 300,
    ciGate: true,
    measures:
      'commit + first paint of a 5,000-note production NotesNavigationSidebar (windowed vault tree: mounted slice + overscan inside the list viewport), warm repeat mount',
    thresholdNote:
      'Observed p95 56-84ms (p50 54-57; first mount ~84ms) with WindowedTreeList + a viewportRef. Threshold 300ms is ~4x observed: it catches a full-tree blow-up (windowing lost) while absorbing CI jitter.',
  },
  dom_notes_navigator_switch: {
    name: 'dom_notes_navigator_switch',
    p95Ms: 200,
    ciGate: false,
    measures:
      'p95 time from clicking a note row to the next painted frame (active-note switch across the 5,000-note tree)',
    thresholdNote:
      'Observed p95 30-32ms (p50 17-20) after a warm-up click; occasional GC spikes push single samples higher. Informational: large values indicate whole-tree reconciliation cost.',
  },
}

export const DOM_SESSION_LIST_FIRST_RENDER_P95_MS =
  DOM_PERF_BUDGETS.dom_session_list_first_render.p95Ms
export const DOM_NOTES_NAVIGATOR_FIRST_RENDER_P95_MS =
  DOM_PERF_BUDGETS.dom_notes_navigator_first_render.p95Ms