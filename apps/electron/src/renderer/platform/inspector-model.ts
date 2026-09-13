/**
 * InspectorHost model (W1) — pure state transitions for the right inspector.
 * Behavior contract (S-03 §3.3): clicking an inactive section icon opens the
 * panel with that section; clicking the icon of the section already shown
 * hides the panel; the icon rail itself is always visible.
 */
import type { InspectorSectionId } from '@/atoms/unified-shell'

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
