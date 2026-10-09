/**
 * Probe contract shared by the DOM perf fixture entry (`perf-dom.tsx`) and the
 * Playwright spec that drives it (`tests/perf/dom-renderer.spec.ts`).
 *
 * Single source of truth so the `window.__ROX_PERF_DOM__` global augmentation
 * is declared once and both TS programs agree on the shape.
 */
export interface RoxPerfDomWarmup {
  sessions: number
  notes: number
}

export interface RoxPerfDomProbe {
  fixture: { sessionRows: number; vaultNotes: number }
  /** Cold (warm-up) mount timings, informational only. */
  warmup: RoxPerfDomWarmup
  remount(iterations: number): Promise<{ sessions: number[]; notes: number[] }>
  measureUnvirtualizedSessions(): Promise<number>
  scrollSessions(steps: number): Promise<number[]>
  switchNotes(steps: number): Promise<number[]>
}

declare global {
  interface Window {
    __ROX_PERF_DOM__?: RoxPerfDomProbe
  }
}