/**
 * W1-15 (#1512) acceptance — the right-dock table test (TECH-SPEC §18.4,
 * UI-SPEC §25.5).
 *
 * Over widths 960…2560 and every combination of inspector (none / quick 328 /
 * comments 360 / task detail 560) and agent width (closed / 320 / 380 / 560):
 *
 * - whenever the dock takes width, MAIN is at least 640;
 * - the sidebar auto-collapses before MAIN drops below 640;
 * - the mode only ever widens as the window grows (overlay → sharedDock →
 *   sideBySide), never regresses;
 * - the §18.4 formula is the side-by-side predicate it names.
 */
import { describe, expect, it } from 'bun:test'
import {
  ACTION_RAIL_WIDTH,
  AGENT_WIDTH_DEFAULT,
  AGENT_WIDTH_MAX,
  AGENT_WIDTH_MIN,
  COMMENTS_PANEL_WIDTH,
  MAIN_MIN_WIDTH,
  QUICK_PANEL_WIDTH,
  RAIL_WIDTH,
  RIGHT_DOCK_MODES,
  SHARED_DOCK_MIN_WINDOW_WIDTH,
  SHARED_DOCK_TAB_STRIP_HEIGHT,
  SIDEBAR_COLLAPSED_WIDTH,
  TASK_DETAIL_WIDTH,
  clampAgentWidth,
  computeDockMode,
  mainWidthWithoutAgent,
  resolveDock,
  rightDockLayout,
  sideBySideFits,
  type InspectorKind,
  type RightDockInput,
  type RightDockMode,
} from '../right-dock.ts'

/** §18.4 examples: the expanded-sidebar thresholds for the two named widths. */
const WIDTHS = [960, 1024, 1100, 1200, 1279, 1280, 1366, 1440, 1512, 1600, 1720, 1800, 1920, 1952, 2048, 2200, 2400, 2560]

const INSPECTORS: Array<{ kind: InspectorKind; open: boolean }> = [
  { kind: 'none', open: false },
  { kind: 'quick', open: true },
  { kind: 'comments', open: true },
  { kind: 'task-detail', open: true },
]

const AGENTS = [
  { label: 'closed', open: false, width: AGENT_WIDTH_DEFAULT },
  { label: 'minimised', open: true, minimised: true, width: AGENT_WIDTH_DEFAULT },
  { label: '320', open: true, width: AGENT_WIDTH_MIN },
  { label: '380', open: true, width: AGENT_WIDTH_DEFAULT },
  { label: '560', open: true, width: AGENT_WIDTH_MAX },
]

const SIDEBARS = [220, 224, 240, 260, 280, SIDEBAR_COLLAPSED_WIDTH]

function input(windowWidth: number, inspector: (typeof INSPECTORS)[number], agent: (typeof AGENTS)[number], sidebarWidth: number, sidebarCollapsed = false): RightDockInput {
  return {
    windowWidth,
    sidebarWidth,
    sidebarCollapsed,
    allowSidebarAutoCollapse: true,
    agent: { open: agent.open, minimised: (agent as { minimised?: boolean }).minimised, width: agent.width },
    inspector: { kind: inspector.kind, open: inspector.open },
  }
}

describe('W1-15 right dock — the §18.4 width table', () => {
  it('leaves MAIN untouched in the overlay: the panel floats and takes no layout width', () => {
    const layouts = WIDTHS.map((windowWidth) => {
      const base = input(windowWidth, { kind: 'quick', open: true }, AGENTS[3]!, 280)
      return { windowWidth, layout: rightDockLayout(base), without: mainWidthWithoutAgent(base) }
    })
    for (const { windowWidth, layout, without } of layouts) {
      if (layout.mode !== 'overlay') continue
      expect({ windowWidth, mainWidth: layout.mainWidth }).toEqual({ windowWidth, mainWidth: without })
      expect(layout.agentWidth).toBe(AGENT_WIDTH_DEFAULT)
      expect(layout.columnWidth).toBe(0)
      expect(layout.canPin).toBe(false)
    }
  })

  it('never lets a side-by-side dock put MAIN below the minimum', () => {
    const violations: Array<Record<string, unknown>> = []
    for (const windowWidth of WIDTHS) {
      for (const inspector of INSPECTORS) {
        for (const agent of AGENTS) {
          const layout = rightDockLayout(input(windowWidth, inspector, agent, 280))
          // The §18.4 formula guarantees MAIN ≥ 640 exactly in side-by-side;
          // the shared dock is the W ≥ 1280 fallback (W1-10 `dock-layout`
          // asserts MAIN ≥ 640 for sideBySide rows only).
          if (layout.mode === 'sideBySide' && layout.mainWidth < MAIN_MIN_WIDTH) {
            violations.push({ windowWidth, inspector: inspector.kind, agent: agent.label, mainWidth: layout.mainWidth })
          }
          // An overlay never takes layout width: MAIN is exactly the base width.
          if (layout.mode === 'overlay') {
            expect({ windowWidth, main: layout.mainWidth }).toEqual({ windowWidth, main: mainWidthWithoutAgent(input(windowWidth, inspector, agent, 280)) })
          }
        }
      }
    }
    expect(violations).toEqual([])
  })
})

describe('W1-15 right dock — modes', () => {
  it('is side-by-side at the §18.4 thresholds the spec names', () => {
    // ≥ 1720 with a 328 quick panel, expanded 280 sidebar, 380 agent.
    expect(sideBySideFits(1720, 280, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe(true)
    expect(sideBySideFits(1719, 280, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe(false)
    // ≥ 1952 with the 560 task detail.
    expect(sideBySideFits(1952, 280, TASK_DETAIL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe(true)
    expect(sideBySideFits(1951, 280, TASK_DETAIL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe(false)
    expect(1720).toBe(RAIL_WIDTH + 280 + MAIN_MIN_WIDTH + QUICK_PANEL_WIDTH + AGENT_WIDTH_DEFAULT + ACTION_RAIL_WIDTH)
    expect(1952).toBe(RAIL_WIDTH + 280 + MAIN_MIN_WIDTH + TASK_DETAIL_WIDTH + AGENT_WIDTH_DEFAULT + ACTION_RAIL_WIDTH)
  })

  it('reaches side-by-side once MAIN fits without collapsing the sidebar', () => {
    const layout = rightDockLayout(input(1720, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect(layout.mode).toBe('sideBySide')
    expect(layout.sidebarCollapsed).toBe(false)
    expect(layout.mainWidth).toBe(MAIN_MIN_WIDTH)
    expect(layout.canPin).toBe(true)
    expect(layout.tabStrip).toBeNull()
  })

  it('auto-collapses the sidebar to 56 before the agent shrinks MAIN (§25.5 rule 4)', () => {
    // 1496 = 48 + 56 + 640 + 328 + 380 + 44: side-by-side once the sidebar is 56.
    const tight = rightDockLayout(input(1496, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect(tight.mode).toBe('sideBySide')
    expect(tight.sidebarCollapsed).toBe(true)
    expect(tight.sidebarWidth).toBe(SIDEBAR_COLLAPSED_WIDTH)
    expect(tight.mainWidth).toBe(MAIN_MIN_WIDTH)

    // A manually collapsed sidebar is never re-expanded by the dock.
    const manual = rightDockLayout(input(1496, { kind: 'quick', open: true }, AGENTS[3]!, 280, true))
    expect(manual.sidebarCollapsed).toBe(true)
    expect(manual.mode).toBe('sideBySide')
  })

  it('does not auto-collapse when the surface forbids it', () => {
    const layout = rightDockLayout({ ...input(1496, { kind: 'quick', open: true }, AGENTS[3]!, 280), allowSidebarAutoCollapse: false })
    expect(layout.mode).toBe('sharedDock')
    expect(layout.sidebarCollapsed).toBe(false)
    expect(layout.mainWidth).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH)
  })

  it('shares one column at ≥ 1280 and puts the agent tab first', () => {
    const layout = rightDockLayout(input(1280, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect(layout.mode).toBe('sharedDock')
    expect(layout.columnWidth).toBe(Math.max(QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT))
    expect(layout.tabStrip).toEqual({ height: SHARED_DOCK_TAB_STRIP_HEIGHT, agentFirst: true, agentVisible: true })
    expect(layout.sidebarCollapsed).toBe(false)
    expect(layout.mainWidth).toBe(1280 - RAIL_WIDTH - 280 - Math.max(QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT) - ACTION_RAIL_WIDTH)

    // The task detail keeps its own 560 in the shared column.
    const detail = rightDockLayout(input(1440, { kind: 'task-detail', open: true }, AGENTS[3]!, 280))
    expect(detail.mode).toBe('sharedDock')
    expect(detail.columnWidth).toBe(TASK_DETAIL_WIDTH)
    const narrowDetail = rightDockLayout(input(1280, { kind: 'task-detail', open: true }, AGENTS[3]!, 280))
    expect(narrowDetail.mode).toBe('sharedDock')

    // Collaboration panels use 360.
    const comments = rightDockLayout(input(1366, { kind: 'comments', open: true }, AGENTS[3]!, 280))
    expect(comments.mode).toBe('sharedDock')
    expect(comments.columnWidth).toBe(Math.max(COMMENTS_PANEL_WIDTH, AGENT_WIDTH_DEFAULT))
  })

  it('falls back to an overlay when MAIN would drop below 640', () => {
    // Below 1280 with a sidebar that cannot be collapsed away: overlay.
    for (const windowWidth of [960, 1024, 1100]) {
      const base = input(windowWidth, { kind: 'none', open: false }, AGENTS[3]!, 280)
      const layout = rightDockLayout(base)
      expect({ windowWidth, mode: layout.mode }).toEqual({ windowWidth, mode: 'overlay' })
      expect(layout.canPin).toBe(false)
      expect(layout.mainWidth).toBe(mainWidthWithoutAgent(base))
    }

    // 1200 and 1279 still dock: the sidebar auto-collapses to 56 (§25.5 rule 4).
    for (const windowWidth of [1200, 1279]) {
      const layout = rightDockLayout(input(windowWidth, { kind: 'none', open: false }, AGENTS[3]!, 280))
      expect({ windowWidth, mode: layout.mode, collapsed: layout.sidebarCollapsed })
        .toEqual({ windowWidth, mode: 'sideBySide', collapsed: true })
    }

    // A wide agent beside the 560 task detail at 1300 still shares the column
    // (the shared dock is the W ≥ 1280 fallback).
    const layout = rightDockLayout(input(1300, { kind: 'task-detail', open: true }, AGENTS[4]!, 280))
    expect(layout.mode).toBe('sharedDock')
    expect(layout.columnWidth).toBe(TASK_DETAIL_WIDTH)

    // With auto-collapse forbidden the same window still shares the column
    // (auto-collapse is only an optimisation for side-by-side).
    const noCollapse = rightDockLayout({ ...input(1300, { kind: 'task-detail', open: true }, AGENTS[3]!, 280), allowSidebarAutoCollapse: false })
    expect(noCollapse.mode).toBe('sharedDock')
    expect(noCollapse.sidebarCollapsed).toBe(false)
    // …and the wider window goes side-by-side once the formula fits.
    const wide = rightDockLayout({ ...input(1952, { kind: 'task-detail', open: true }, AGENTS[3]!, 280), allowSidebarAutoCollapse: false })
    expect(wide.mode).toBe('sideBySide')
    expect(wide.sidebarCollapsed).toBe(false)
  })

  it('is inert without an agent: no column, no tab strip, MAIN keeps the base width', () => {
    for (const agent of [AGENTS[0]!, AGENTS[1]!]) {
      const base = input(1440, { kind: 'quick', open: true }, agent, 280)
      const layout = rightDockLayout(base)
      expect({ agent: agent.label, docksAgent: layout.docksAgent, agentWidth: layout.agentWidth, tabStrip: layout.tabStrip })
        .toEqual({ agent: agent.label, docksAgent: false, agentWidth: 0, tabStrip: null })
      // `canPin` describes the layout, not the panel: the column could dock here.
      expect({ agent: agent.label, canPin: layout.canPin, mode: layout.mode })
        .toEqual({ agent: agent.label, canPin: layout.mode !== 'overlay', mode: layout.mode })
      expect(layout.mainWidth).toBe(mainWidthWithoutAgent(base))
    }
    // In an overlay (below 1280 here) 📌 is refused at any panel state.
    const overlay = rightDockLayout(input(960, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect({ mode: overlay.mode, canPin: overlay.canPin }).toEqual({ mode: 'overlay', canPin: false })
  })
})

describe('W1-15 right dock — monotonic in window width', () => {
  it('never regresses from side-by-side to shared to overlay as the window grows', () => {
    const rank: Record<RightDockMode, number> = { overlay: 0, sharedDock: 1, sideBySide: 2 }
    for (const sidebarWidth of SIDEBARS) {
      for (const inspector of INSPECTORS) {
        for (const agent of AGENTS) {
          let previous = -1
          for (const windowWidth of WIDTHS) {
            const layout = rightDockLayout(input(windowWidth, inspector, agent, sidebarWidth))
            const value = layout.docksAgent ? rank[layout.mode] : rank.overlay
            expect({ windowWidth, sidebarWidth, inspector: inspector.kind, agent: agent.label, monotonic: value >= previous })
              .toEqual({ windowWidth, sidebarWidth, inspector: inspector.kind, agent: agent.label, monotonic: true })
            previous = value
          }
        }
      }
    }
    expect(RIGHT_DOCK_MODES).toEqual(['sideBySide', 'sharedDock', 'overlay'])
  })

  it('exposes the W1-10 `dock-layout` contract: computeDockMode over the table', () => {
    // The harness table: widths × inspector × agent × collapsed, pre-collapse
    // sidebar. `computeDockMode` must agree with §18.4 for every row.
    const fits = (width: number, sidebar: number, inspector: number, agent: number) =>
      width >= RAIL_WIDTH + sidebar + MAIN_MIN_WIDTH + inspector + agent + ACTION_RAIL_WIDTH
    const reference = (width: number, sidebar: number, inspector: number, agent: number): RightDockMode => {
      if (fits(width, sidebar, inspector, agent)) return 'sideBySide'
      if (sidebar > SIDEBAR_COLLAPSED_WIDTH && fits(width, SIDEBAR_COLLAPSED_WIDTH, inspector, agent)) return 'sideBySide'
      return width >= SHARED_DOCK_MIN_WINDOW_WIDTH ? 'sharedDock' : 'overlay'
    }
    const mismatches: Array<Record<string, unknown>> = []
    for (const width of [960, 1100, 1280, 1440, 1600, 1920, 2560]) {
      for (const inspector of [0, 328, 360, 560]) {
        for (const agent of [0, 360]) {
          for (const sidebar of [280, SIDEBAR_COLLAPSED_WIDTH]) {
            const got = computeDockMode(width, sidebar, inspector, agent)
            const want = reference(width, sidebar, inspector, agent)
            if (got !== want) mismatches.push({ width, sidebar, inspector, agent, got, want })
          }
        }
      }
    }
    expect(mismatches).toEqual([])
    expect(computeDockMode(1720, 280, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe('sideBySide')
    // 1496 = 48 + 56 + 640 + 328 + 380 + 44: side-by-side only after the collapse.
    expect(computeDockMode(1719, 280, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe('sideBySide')
    expect(computeDockMode(1280, 560, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe('sharedDock')
    expect(computeDockMode(1279, 56, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe('overlay')
    // An already-collapsed sidebar cannot collapse further: 1280 shares the column.
    expect(computeDockMode(1280, 56, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe('sharedDock')
    expect(computeDockMode(1496, 56, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe('sideBySide')
  })

  it('exposes the same decision through rightDockLayout and resolveDock', () => {
    const layout = rightDockLayout(input(1440, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    const resolved = resolveDock({ windowWidth: 1440, sidebarWidth: 280, inspectorWidth: QUICK_PANEL_WIDTH, agentWidth: AGENT_WIDTH_DEFAULT, allowAutoCollapse: true })
    expect(layout.mode).toBe(resolved.mode)
    expect(computeDockMode(1440, 280, QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT)).toBe(layout.mode)
    expect(resolved.autoCollapsed).toBe(layout.sidebarCollapsed)
    expect(resolved.columnWidth).toBe(layout.columnWidth)
  })

  it('computes MAIN with the §18.4 arithmetic in every mode', () => {
    // side-by-side: MAIN = W − rail − sidebar − inspector − agent − action rail.
    const sbs = rightDockLayout(input(1720, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect(sbs.mode).toBe('sideBySide')
    expect(sbs.mainWidth).toBe(1720 - RAIL_WIDTH - 280 - QUICK_PANEL_WIDTH - AGENT_WIDTH_DEFAULT - ACTION_RAIL_WIDTH)

    // shared dock: one column of max(inspector, agent) at the user's sidebar width.
    const shared = rightDockLayout(input(1280, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect(shared.mode).toBe('sharedDock')
    expect(shared.sidebarCollapsed).toBe(false)
    expect(shared.mainWidth).toBe(1280 - RAIL_WIDTH - 280 - Math.max(QUICK_PANEL_WIDTH, AGENT_WIDTH_DEFAULT) - ACTION_RAIL_WIDTH)

    // overlay: the panel takes no layout width at all.
    const overlay = rightDockLayout(input(960, { kind: 'quick', open: true }, AGENTS[3]!, 280))
    expect(overlay.mode).toBe('overlay')
    expect(overlay.mainWidth).toBe(960 - RAIL_WIDTH - 280 - QUICK_PANEL_WIDTH - ACTION_RAIL_WIDTH)
  })
})

describe('W1-15 right dock — inputs', () => {
  it('clamps a persisted or dragged width into the §25.3 range', () => {
    expect(clampAgentWidth(380)).toBe(380)
    expect(clampAgentWidth(1)).toBe(AGENT_WIDTH_MIN)
    expect(clampAgentWidth(9999)).toBe(AGENT_WIDTH_MAX)
    expect(clampAgentWidth(Number.NaN)).toBe(AGENT_WIDTH_DEFAULT)
    const layout = rightDockLayout({ ...input(2560, { kind: 'none', open: false }, AGENTS[4]!, 280), agent: { open: true, width: 40 } })
    expect(layout.agentWidth).toBe(AGENT_WIDTH_MIN)
    expect(layout.mainWidth).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH)
  })

  it('treats a huge window as side-by-side with the sidebar expanded', () => {
    const layout = rightDockLayout(input(3840, { kind: 'task-detail', open: true }, AGENTS[4]!, 360))
    expect(layout.mode).toBe('sideBySide')
    expect(layout.mainWidth).toBe(3840 - RAIL_WIDTH - 360 - TASK_DETAIL_WIDTH - AGENT_WIDTH_MAX - ACTION_RAIL_WIDTH)
  })
})