/**
 * W1-10 (#1507) — right-dock layout table fixture (TECH-SPEC §18.4).
 *
 * `mode = sideBySide if W ≥ 48 + S + 640 + I + A + 44, sharedDock if W ≥ 1280,
 * overlay otherwise`. S = sidebar width (or 56 if auto-collapsed), I =
 * inspector width (0/328/360/560), A = agent width. MAIN is always ≥ 640.
 * Shipped as data plus pending tests; W1-15 (`right-dock.ts`) owns the
 * production implementation — the dock gate cross-checks it when present.
 */

export type DockMode = 'sideBySide' | 'sharedDock' | 'overlay'

export interface DockCase {
  width: number
  sidebar: number
  inspector: 0 | 328 | 360 | 560
  agent: number
  collapsed: boolean
  expected: DockMode
}

/** Reference evaluator of the §18.4 formula (single source for table + gate). */
export function referenceDockMode(width: number, sidebar: number, inspector: number, agent: number): DockMode {
  if (width >= 48 + sidebar + 640 + inspector + agent + 44) return 'sideBySide'
  if (width >= 1280) return 'sharedDock'
  return 'overlay'
}

const WIDTHS = [960, 1100, 1280, 1440, 1600, 1920, 2560]

export function buildDockTable(): Array<DockCase & { mainWidth: number }> {
  const rows: Array<DockCase & { mainWidth: number }> = []
  for (const width of WIDTHS) {
    for (const inspector of [0, 328, 360, 560] as const) {
      for (const agent of [0, 360]) {
        for (const collapsed of [false, true]) {
          const sidebar = collapsed ? 56 : 280
          const expected = referenceDockMode(width, sidebar, inspector, agent)
          const mainWidth = width - 48 - sidebar - inspector - agent - 44
          rows.push({ width, sidebar, inspector, agent, collapsed, expected, mainWidth })
        }
      }
    }
  }
  return rows
}

/** The gate asserts MAIN ≥ 640 only for sideBySide rows (other modes overlay). */
export function dockTableInvariantHolds(): boolean {
  return buildDockTable()
    .filter((r) => r.expected === 'sideBySide')
    .every((r) => r.mainWidth >= 640)
}
