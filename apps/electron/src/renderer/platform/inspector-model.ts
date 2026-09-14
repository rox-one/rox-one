/**
 * InspectorHost model (W1) — pure state transitions for the right inspector.
 * Behavior contract (S-03 §3.3): clicking an inactive section icon opens the
 * panel with that section; clicking the icon of the section already shown
 * hides the panel; the section rail remains available while chrome is expanded.
 */
import type { InspectorSectionId } from '@/atoms/unified-shell'
import type { ResizeBounds } from '@/components/app-shell/resize-controller'
import { KEYBOARD_RESIZE_LARGE_STEP, KEYBOARD_RESIZE_STEP } from '@/components/app-shell/resize-math'

export const INSPECTOR_DEFAULT_WIDTH = 336
export const INSPECTOR_MIN_WIDTH = 280
export const INSPECTOR_MAX_WIDTH = 1400

/** Fresh installs start quiet; either legacy preference is an explicit choice. */
export function resolveInspectorDefaults(saved: { visible?: unknown; chromeCollapsed?: unknown }) {
  const hasVisibility = typeof saved.visible === 'boolean'
  const hasChrome = typeof saved.chromeCollapsed === 'boolean'
  return {
    visible: hasVisibility ? saved.visible as boolean : hasChrome && saved.chromeCollapsed === false,
    chromeCollapsed: hasChrome ? saved.chromeCollapsed as boolean : !hasVisibility,
  }
}

/** Keep useful room for the workspace, including after a window is narrowed. */
export function inspectorWidthLimits(viewportWidth: number) {
  const viewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280
  const max = Math.min(INSPECTOR_MAX_WIDTH, Math.floor(viewport * 0.6))
  return { min: Math.min(INSPECTOR_MIN_WIDTH, max), max }
}

export function normalizeInspectorWidth(value: unknown, viewportWidth: number): number {
  const { min, max } = inspectorWidthLimits(viewportWidth)
  const width = typeof value === 'number' && Number.isFinite(value) ? value : INSPECTOR_DEFAULT_WIDTH
  return Math.min(max, Math.max(min, width))
}

/** The inspector is the right-hand (B) side of the shared splitter. */
export function inspectorResizeBounds(width: number, viewportWidth: number): ResizeBounds {
  const limits = inspectorWidthLimits(viewportWidth)
  const sizeB = normalizeInspectorWidth(width, viewportWidth)
  return {
    leftId: 'workspace', rightId: 'inspector',
    total: viewportWidth, sizeA: viewportWidth - sizeB, sizeB,
    minA: viewportWidth - limits.max, maxA: viewportWidth - limits.min,
    minB: limits.min, maxB: limits.max,
  }
}

export function inspectorSectionNeedsSession(section: InspectorSectionId): boolean {
  return section === 'files' || section === 'git' || section === 'context'
}

/** Empty catalogs never reserve a large panel for missing session content. */
export function isInspectorPanelVisible(state: {
  visible: boolean
  chromeCollapsed: boolean
  section: InspectorSectionId
  hasSession: boolean
  terminalOpen?: boolean
}): boolean {
  return state.visible && !state.chromeCollapsed && (
    state.terminalOpen === true || !inspectorSectionNeedsSession(state.section) || state.hasSession
  )
}

/** Physical arrow direction follows the inspector's left edge; Home/End set width. */
export function inspectorResizeWidthForKey(
  key: string,
  shiftKey: boolean,
  width: number,
  viewportWidth: number,
): number | null {
  const { min, max } = inspectorWidthLimits(viewportWidth)
  const step = shiftKey ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP
  switch (key) {
    case 'ArrowLeft': return normalizeInspectorWidth(width + step, viewportWidth)
    case 'ArrowRight': return normalizeInspectorWidth(width - step, viewportWidth)
    case 'Home': return min
    case 'End': return max
    default: return null
  }
}

export const KNOWLEDGE_INSPECTOR_SECTION_IDS: readonly InspectorSectionId[] = [
  'info',
  'agent',
  'outline',
  'backlinks',
  'browser',
]

export const SESSION_INSPECTOR_SECTION_IDS: readonly InspectorSectionId[] = [
  'files',
  'git',
  'browser',
  'context',
]

export const INSPECTOR_SECTION_IDS: readonly InspectorSectionId[] = [
  'info',
  'agent',
  'outline',
  'backlinks',
  'files',
  'git',
  'browser',
  'context',
]

/** Knowledge sections rendered by InfoSection; browser is handled directly by InspectorHost. */
export const INSPECTOR_LIVE_SECTIONS: readonly InspectorSectionId[] = ['info']

export const SESSION_INSPECTOR_LIVE_SECTIONS: readonly InspectorSectionId[] = [
  'files',
  'git',
  'browser',
  'context',
]

export function inspectorSectionsForMode(mode: 'knowledge' | 'session'): readonly InspectorSectionId[] {
  return mode === 'session' ? SESSION_INSPECTOR_SECTION_IDS : KNOWLEDGE_INSPECTOR_SECTION_IDS
}

export function isSessionInspectorSection(
  value: InspectorSectionId,
): value is Extract<InspectorSectionId, 'files' | 'git' | 'browser' | 'context'> {
  return (SESSION_INSPECTOR_SECTION_IDS as readonly string[]).includes(value)
}

export function isInspectorSectionId(value: unknown): value is InspectorSectionId {
  return typeof value === 'string' && (INSPECTOR_SECTION_IDS as readonly string[]).includes(value)
}

/** Persisted values can be arbitrary (older builds); fall back to `info`. */
export function normalizeInspectorSection(value: unknown): InspectorSectionId {
  return isInspectorSectionId(value) ? value : 'info'
}

export interface InspectorUiState {
  visible: boolean
  section: InspectorSectionId
}

export interface InspectorTerminalUiState {
  bottomOpen: boolean
  sideOpen: boolean
}

export function resolveInspectorToggle(
  prev: InspectorUiState,
  clicked: InspectorSectionId,
): InspectorUiState {
  // Click on the already-shown section hides the panel; anything else shows it.
  if (prev.visible && prev.section === clicked) {
    return { visible: false, section: clicked }
  }
  return { visible: true, section: clicked }
}

/** A normal rail click owns the bottom dock and closes the side alternate. */
export function resolveBottomTerminalToggle(
  prev: InspectorTerminalUiState,
): InspectorTerminalUiState {
  return {
    bottomOpen: !prev.bottomOpen,
    sideOpen: false,
  }
}
