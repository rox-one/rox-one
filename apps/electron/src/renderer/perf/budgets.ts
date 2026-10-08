import type { BudgetDefinition, PerfMarkName } from './types'

/**
 * Declared p95 budgets for Wave 0. Only `ciGate: true` rows fail CI.
 * Cached session switch is the Issue 03 Gherkin gate; dropdown open is
 * reserved for Issue 04 consumers.
 */
export const PERF_BUDGETS: Record<PerfMarkName, BudgetDefinition> = {
  cold_ready: {
    name: 'cold_ready',
    p95Ms: 2500,
    maxCollectionReloads: 1,
    ciGate: false,
  },
  cached_session_switch: {
    name: 'cached_session_switch',
    p95Ms: 120,
    maxCollectionReloads: 0,
    maxIpcPerInteraction: {
      'sessions.list': 0,
      'sessions.permission': 1,
      'sessions.metadata': 1,
    },
    ciGate: true,
  },
  view_switch: {
    name: 'view_switch',
    p95Ms: 200,
    maxCollectionReloads: 0,
    ciGate: false,
  },
  notes_open: {
    name: 'notes_open',
    p95Ms: 300,
    maxCollectionReloads: 0,
    ciGate: false,
  },
  browser_chrome: {
    name: 'browser_chrome',
    p95Ms: 250,
    maxCollectionReloads: 0,
    ciGate: false,
  },
  dropdown_open: {
    name: 'dropdown_open',
    p95Ms: 80,
    maxCollectionReloads: 0,
    ciGate: false,
  },
  canvas_layout: {
    name: 'canvas_layout',
    p95Ms: 400,
    maxCollectionReloads: 0,
    ciGate: false,
  },
  /**
   * PERF-10 (#1577) owner decision D2: whole warmed surfaces, not requests.
   * The warm-up covers the rail surfaces' chunks and data, so a first visit
   * paints and a revisit among the five retained ones only repaints; paying a
   * cold read or losing a retained pane breaks the sample.
   */
  surface_revisit: {
    name: 'surface_revisit',
    p95Ms: 100,
    maxCollectionReloads: 0,
    maxIpcPerInteraction: { 'sessions.list': 0, 'sessions.messages': 0 },
    ciGate: true,
  },
  surface_first_warm: {
    name: 'surface_first_warm',
    p95Ms: 200,
    maxCollectionReloads: 0,
    maxIpcPerInteraction: { 'sessions.list': 0, 'sessions.messages': 0 },
    ciGate: true,
  },
}

export const CACHED_SESSION_SWITCH_P95_MS = PERF_BUDGETS.cached_session_switch.p95Ms
export const DROPDOWN_OPEN_P95_MS = PERF_BUDGETS.dropdown_open.p95Ms
