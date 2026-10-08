/**
 * W1-15 (#1512) — the pure right-dock layout function (TECH-SPEC §18.4,
 * UI-SPEC §25.5).
 *
 * The right side of the window is ONE right dock: the inspector column, the
 * agent column, then the existing right action rail. This module decides the
 * mode and the widths from the window width and the open panels — pure, so it
 * can be table-tested, and read only while `agent.panel.v1` is on (with the
 * flag off the shell keeps using `inspector-layout.ts` unchanged).
 *
 * Rules (§18.4, §25.5), in order:
 *   1. side-by-side when W ≥ rail 48 + sidebar + MAIN 640 + inspector + agent
 *      + action rail 44 — the formula is exactly MAIN ≥ 640;
 *   2. failed that, auto-collapse the sidebar to 56 and try again (tried before
 *      the agent is allowed to shrink MAIN; §26.4 can turn this off);
 *   3. failed that, the shared dock at W ≥ 1280: inspector and agent share one
 *      column (32 px tab strip) at the pre-collapse sidebar width. W1-10's
 *      #1507 review-2 owner decision resolves §25.5 rules 2 and 3 this way, so
 *      `computeDockMode` and the harness `dock-layout` table agree row for row;
 *   4. overlay otherwise (W < 1280): the panel floats over MAIN and takes no
 *      layout width, so the shell never reflows for it.
 */

/** Mode rail (UI-SPEC §26.1 window anatomy). */
export const RAIL_WIDTH = 48
/** Right action rail (`InspectorActionRail`). */
export const ACTION_RAIL_WIDTH = 44
/** MAIN never renders narrower than this while the dock holds width. */
export const MAIN_MIN_WIDTH = 640
/** Sidebar widths: default range 220–360, collapsed 56 (§26.1 «Width»). */
export const SIDEBAR_COLLAPSED_WIDTH = 56
/** Quick panels (Docs / Tasks / Calendar / Contacts). */
export const QUICK_PANEL_WIDTH = 328
/** Collaboration panels (Comments · Tasks · …). */
export const COMMENTS_PANEL_WIDTH = 360
/** Operately task detail keeps its own width even in the shared dock. */
export const TASK_DETAIL_WIDTH = 560
/** Shared-dock tab strip height (§25.5 rule 2). */
export const SHARED_DOCK_TAB_STRIP_HEIGHT = 32
/** Below this window width the shared dock is not offered at all (§18.4). */
export const SHARED_DOCK_MIN_WINDOW_WIDTH = 1280
/** Agent panel width range (§25.3); default 380. */
export const AGENT_WIDTH_MIN = 320
export const AGENT_WIDTH_MAX = 560
export const AGENT_WIDTH_DEFAULT = 380

export const RIGHT_DOCK_MODES = ['sideBySide', 'sharedDock', 'overlay'] as const
export type RightDockMode = (typeof RIGHT_DOCK_MODES)[number]

/** The inspector's preferred width, from the panel that owns it. */
export type InspectorKind = 'none' | 'quick' | 'comments' | 'task-detail' | 'custom'

export const INSPECTOR_WIDTHS: Readonly<Record<InspectorKind, number>> = {
  none: 0,
  quick: QUICK_PANEL_WIDTH,
  comments: COMMENTS_PANEL_WIDTH,
  'task-detail': TASK_DETAIL_WIDTH,
  custom: QUICK_PANEL_WIDTH,
}

export interface RightDockInput {
  windowWidth: number
  /** Sidebar width the user last set (expanded). */
  sidebarWidth: number
  /** The user collapsed the sidebar manually (⌘B) — auto-collapse must not fight it. */
  sidebarCollapsed: boolean
  /** Whether the sidebar may auto-collapse to save width for the agent (§25.5 rule 4). */
  allowSidebarAutoCollapse: boolean
  /** Agent panel state: `minimised` lives as a pill in the action rail (no width). */
  agent: { open: boolean; minimised?: boolean; width: number }
  inspector: { kind: InspectorKind; open: boolean; width?: number }
}

export interface RightDockLayout {
  mode: RightDockMode
  /** The sidebar state the shell should render (auto-collapse included). */
  sidebarCollapsed: boolean
  sidebarWidth: number
  /** MAIN width after the dock took its share. */
  mainWidth: number
  inspectorWidth: number
  /** Agent panel width wherever it renders (0 while it is closed or minimised). */
  agentWidth: number
  /** Shared dock: one column holding both panels. */
  columnWidth: number
  /** True only while the agent column occupies layout width (never in an overlay). */
  docksAgent: boolean
  /** Panel is open (docked, shared or floating) — the shell renders it. */
  agentVisible: boolean
  /** 📌 is offered while the panel can dock; disabled in the overlay (§25.5 rule 3). */
  canPin: boolean
  /** Shared-dock tab strip: the agent tab is always first. */
  tabStrip: { height: number; agentFirst: true; agentVisible: boolean } | null
}

/** MAIN width when only the inspector is considered (the base shell layout). */
export function mainWidthWithoutAgent(input: RightDockInput): number {
  const inspector = input.inspector.open ? inspectorWidth(input) : 0
  const sidebar = input.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : input.sidebarWidth
  return input.windowWidth - RAIL_WIDTH - sidebar - inspector - ACTION_RAIL_WIDTH
}

function inspectorWidth(input: RightDockInput): number {
  if (input.inspector.width !== undefined) return Math.max(0, input.inspector.width)
  return INSPECTOR_WIDTHS[input.inspector.kind]
}

/**
 * One surface's dock resolution, before the shell adds its own chrome. This is
 * the §18.4 algorithm with «auto-collapse of the sidebar is tried first», and
 * it is the single implementation `computeDockMode` (the W1-10 harness
 * contract) and `rightDockLayout` both use, so they cannot diverge.
 */
export interface DockFacts {
  windowWidth: number
  /** Sidebar width as the user left it (56 when already collapsed). */
  sidebarWidth: number
  /** Inspector width (0 / 328 / 360 / 560). */
  inspectorWidth: number
  /** Agent column width; 0 when the panel takes no width. */
  agentWidth: number
  /** Settings → «Сворачивать автоматически при открытии @rox» (§26.4, default on). */
  allowAutoCollapse: boolean
}

export interface DockResolution {
  mode: RightDockMode
  /** The dock collapsed the sidebar to reach side-by-side. */
  autoCollapsed: boolean
  sidebarWidth: number
  /** Shared dock: one column holding both panels. */
  columnWidth: number
}

/** §18.4 rule 1, with an explicit sidebar width. */
export function sideBySideFits(windowWidth: number, sidebarWidth: number, inspectorWidth: number, agentWidth: number): boolean {
  return windowWidth >= RAIL_WIDTH + sidebarWidth + MAIN_MIN_WIDTH + inspectorWidth + agentWidth + ACTION_RAIL_WIDTH
}

export function resolveDock(facts: DockFacts): DockResolution {
  const sidebar = facts.sidebarWidth
  if (sideBySideFits(facts.windowWidth, sidebar, facts.inspectorWidth, facts.agentWidth)) {
    return { mode: 'sideBySide', autoCollapsed: false, sidebarWidth: sidebar, columnWidth: 0 }
  }
  // «Auto-collapse of the sidebar is tried first» (§18.4 Order, §25.5 rule 4).
  if (facts.allowAutoCollapse && sidebar > SIDEBAR_COLLAPSED_WIDTH
    && sideBySideFits(facts.windowWidth, SIDEBAR_COLLAPSED_WIDTH, facts.inspectorWidth, facts.agentWidth)) {
    return { mode: 'sideBySide', autoCollapsed: true, sidebarWidth: SIDEBAR_COLLAPSED_WIDTH, columnWidth: 0 }
  }
  if (facts.windowWidth >= SHARED_DOCK_MIN_WINDOW_WIDTH) {
    return { mode: 'sharedDock', autoCollapsed: false, sidebarWidth: sidebar, columnWidth: Math.max(facts.inspectorWidth, facts.agentWidth) }
  }
  return { mode: 'overlay', autoCollapsed: false, sidebarWidth: sidebar, columnWidth: 0 }
}

/**
 * The W1-10 (#1507) harness contract (`dock-layout` gate): the §18.4 mode for
 * `(width, pre-collapse sidebar, inspector, agent)`. Auto-collapse to 56 is
 * tried first; the numbers are used as given, so the gate's table rows and
 * this function agree exactly.
 */
export function computeDockMode(
  windowWidth: number,
  sidebarWidth: number,
  inspectorWidth: number,
  agentWidth: number,
): RightDockMode {
  return resolveDock({ windowWidth, sidebarWidth, inspectorWidth, agentWidth, allowAutoCollapse: true }).mode
}

/** Clamp a persisted / dragged agent width into the §25.3 range. */
export function clampAgentWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_WIDTH_DEFAULT
  return Math.min(AGENT_WIDTH_MAX, Math.max(AGENT_WIDTH_MIN, Math.round(width)))
}

export function rightDockLayout(input: RightDockInput): RightDockLayout {
  const agentVisible = input.agent.open && input.agent.minimised !== true
  const agentWidth = agentVisible ? clampAgentWidth(input.agent.width) : 0
  const inspector = input.inspector.open ? inspectorWidth(input) : 0
  const sidebar = input.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : input.sidebarWidth

  const resolved = resolveDock({
    windowWidth: input.windowWidth,
    sidebarWidth: sidebar,
    inspectorWidth: inspector,
    agentWidth,
    allowAutoCollapse: input.allowSidebarAutoCollapse,
  })

  const shared = resolved.mode === 'sharedDock'
  const dockWidth = resolved.mode === 'sideBySide'
    ? inspector + agentWidth
    : shared
      ? resolved.columnWidth
      : inspector
  return {
    mode: resolved.mode,
    sidebarCollapsed: resolved.autoCollapsed || input.sidebarCollapsed,
    sidebarWidth: resolved.sidebarWidth,
    mainWidth: input.windowWidth - RAIL_WIDTH - resolved.sidebarWidth - dockWidth - ACTION_RAIL_WIDTH,
    inspectorWidth: inspector,
    agentWidth,
    columnWidth: resolved.columnWidth,
    // The agent column holds layout width in side-by-side and in the shared
    // dock; in the overlay the panel floats and MAIN keeps the base width.
    docksAgent: agentVisible && resolved.mode !== 'overlay',
    agentVisible,
    canPin: resolved.mode !== 'overlay',
    tabStrip: shared
      ? { height: SHARED_DOCK_TAB_STRIP_HEIGHT, agentFirst: true, agentVisible }
      : null,
  }
}