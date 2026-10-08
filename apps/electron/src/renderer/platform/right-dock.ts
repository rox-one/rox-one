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
 * Rules (§25.5), in order:
 *   1. side-by-side when W ≥ rail 48 + sidebar + MAIN 640 + inspector + agent
 *      + action rail 44 (the §18.4 formula);
 *   2. shared dock when that does not fit but W ≥ 1280: inspector and agent
 *      share one column with a 32 px tab strip on top;
 *   3. overlay when W < 1280 or MAIN would drop below 640 — the panel floats
 *      and takes no layout width;
 *   4. before the agent shrinks MAIN, the left sidebar auto-collapses to 56.
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

/** §18.4 rule 1, with an explicit sidebar width. */
export function sideBySideFits(windowWidth: number, sidebarWidth: number, inspectorWidth: number, agentWidth: number): boolean {
  return windowWidth >= RAIL_WIDTH + sidebarWidth + MAIN_MIN_WIDTH + inspectorWidth + agentWidth + ACTION_RAIL_WIDTH
}

/** Clamp a persisted / dragged agent width into the §25.3 range. */
export function clampAgentWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_WIDTH_DEFAULT
  return Math.min(AGENT_WIDTH_MAX, Math.max(AGENT_WIDTH_MIN, Math.round(width)))
}

export function rightDockLayout(input: RightDockInput): RightDockLayout {
  const agentWidth = clampAgentWidth(input.agent.width)
  const agentVisible = input.agent.open && input.agent.minimised !== true
  const inspector = input.inspector.open ? inspectorWidth(input) : 0
  const userSidebar = input.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : input.sidebarWidth
  const collapsedWidth = Math.min(userSidebar, SIDEBAR_COLLAPSED_WIDTH)
  const mayAutoCollapse = input.allowSidebarAutoCollapse || input.sidebarCollapsed

  const layout = (
    mode: RightDockMode,
    sidebarCollapsed: boolean,
    sidebarWidth: number,
    dockWidth: number,
    options: { columnWidth?: number; tabStrip?: RightDockLayout['tabStrip'] } = {},
  ): RightDockLayout => ({
    mode,
    sidebarCollapsed,
    sidebarWidth,
    mainWidth: input.windowWidth - RAIL_WIDTH - sidebarWidth - dockWidth - ACTION_RAIL_WIDTH,
    inspectorWidth: inspector,
    agentWidth: agentVisible ? agentWidth : 0,
    columnWidth: options.columnWidth ?? 0,
    docksAgent: agentVisible && mode !== 'overlay',
    agentVisible,
    canPin: mode !== 'overlay',
    tabStrip: options.tabStrip ?? null,
  })

  // No agent column: MAIN is whatever the base layout gives it.
  if (!agentVisible) {
    return {
      ...layout('overlay', input.sidebarCollapsed, userSidebar, inspector),
      docksAgent: false,
      tabStrip: null,
    }
  }

  // Rule 1 with the sidebar as the user left it.
  if (sideBySideFits(input.windowWidth, userSidebar, inspector, agentWidth)) {
    return layout('sideBySide', input.sidebarCollapsed, userSidebar, inspector + agentWidth)
  }

  // Rule 4: auto-collapse the sidebar before the agent shrinks MAIN.
  if (mayAutoCollapse && sideBySideFits(input.windowWidth, collapsedWidth, inspector, agentWidth)) {
    return layout('sideBySide', true, collapsedWidth, inspector + agentWidth)
  }

  // Rule 2: shared dock — one column, the wider of the two preferred widths.
  const columnWidth = Math.max(inspector, agentWidth)
  if (input.windowWidth >= SHARED_DOCK_MIN_WINDOW_WIDTH) {
    const tabStrip = { height: SHARED_DOCK_TAB_STRIP_HEIGHT, agentFirst: true as const, agentVisible: true }
    for (const sidebar of [userSidebar, collapsedWidth]) {
      if (sidebar === collapsedWidth && !mayAutoCollapse) continue
      if (input.windowWidth - RAIL_WIDTH - sidebar - columnWidth - ACTION_RAIL_WIDTH >= MAIN_MIN_WIDTH) {
        return layout('sharedDock', sidebar === collapsedWidth, sidebar, columnWidth, { columnWidth, tabStrip })
      }
    }
  }

  // Rule 3: overlay — the panel floats and takes no layout width.
  return layout('overlay', input.sidebarCollapsed, userSidebar, inspector)
}