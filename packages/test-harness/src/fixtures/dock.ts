/**
 * W1-10 (#1507) — right-dock layout table fixture (TECH-SPEC §18.4).
 *
 *   mode = sideBySide  if W ≥ 48 + S + 640 + I + A + 44
 *          sharedDock  if W ≥ 1280
 *          overlay     otherwise
 *
 * S = sidebar width (or 56 if auto-collapsed), I = inspector width
 * (0/328/360/560), A = agent width; "auto-collapse of the sidebar is tried
 * first". Owner decision (#1507 review 2): the `sidebar` argument is the
 * PRE-collapse width. The reference therefore tries the expanded sidebar,
 * then the auto-collapsed one (56), before falling back to sharedDock /
 * overlay. Example: W=1280, S=280, I=328, A=0 → expanded needs 1340, the
 * collapsed sidebar needs 1116 → `sideBySide` (sidebar auto-collapsed).
 * MAIN is always ≥ 640 in sideBySide. W1-15 (`right-dock.ts`) owns the
 * production implementation; the dock gate cross-checks it when present.
 */

export type DockMode = 'sideBySide' | 'sharedDock' | 'overlay'

/** Width of the auto-collapsed sidebar rail. */
export const COLLAPSED_SIDEBAR = 56

export interface DockCase {
  width: number
  /** Pre-collapse sidebar width (56 when the user already collapsed it). */
  sidebar: number
  inspector: 0 | 328 | 360 | 560
  agent: number
  /** The user collapsed the sidebar manually (sidebar = 56). */
  collapsed: boolean
  expected: DockMode
}

export interface DockResolution {
  mode: DockMode
  /** The engine collapsed the sidebar to reach sideBySide. */
  autoCollapsed: boolean
  /** Sidebar width actually used. */
  sidebarUsed: number
}

function fits(width: number, sidebar: number, inspector: number, agent: number): boolean {
  return width >= 48 + sidebar + 640 + inspector + agent + 44
}

/** Reference evaluator of §18.4 with auto-collapse tried first (single source for table + gate). */
export function resolveReferenceDock(width: number, sidebar: number, inspector: number, agent: number): DockResolution {
  if (fits(width, sidebar, inspector, agent)) return { mode: 'sideBySide', autoCollapsed: false, sidebarUsed: sidebar }
  if (sidebar > COLLAPSED_SIDEBAR && fits(width, COLLAPSED_SIDEBAR, inspector, agent)) {
    return { mode: 'sideBySide', autoCollapsed: true, sidebarUsed: COLLAPSED_SIDEBAR }
  }
  return { mode: width >= 1280 ? 'sharedDock' : 'overlay', autoCollapsed: false, sidebarUsed: sidebar }
}

export function referenceDockMode(width: number, sidebar: number, inspector: number, agent: number): DockMode {
  return resolveReferenceDock(width, sidebar, inspector, agent).mode
}

const WIDTHS = [960, 1100, 1280, 1440, 1600, 1920, 2560]

export function buildDockTable(): Array<DockCase & { mainWidth: number; autoCollapsed: boolean }> {
  const rows: Array<DockCase & { mainWidth: number; autoCollapsed: boolean }> = []
  for (const width of WIDTHS) {
    for (const inspector of [0, 328, 360, 560] as const) {
      for (const agent of [0, 360]) {
        for (const collapsed of [false, true]) {
          const sidebar = collapsed ? COLLAPSED_SIDEBAR : 280
          const r = resolveReferenceDock(width, sidebar, inspector, agent)
          const mainWidth = width - 48 - r.sidebarUsed - inspector - agent - 44
          rows.push({ width, sidebar, inspector, agent, collapsed, expected: r.mode, mainWidth, autoCollapsed: r.autoCollapsed })
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
