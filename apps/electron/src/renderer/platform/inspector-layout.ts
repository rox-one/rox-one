/**
 * Right inspector sizing for the one-surface shell.
 *
 * Priorities (widest-first): the session/center column keeps
 * `CENTER_MIN_WIDTH`; the right inspector panel yields first. The inspector
 * panel is also collapsed by default while its section is the session Files
 * list and that list is empty. An explicit user toggle always wins: the panel
 * then opens (at its minimum width if space is tight).
 *
 * Nothing here writes persisted state: a squeezed or empty-collapsed panel is
 * a display decision, so the user's saved visibility/width survive untouched.
 */

export interface InspectorLayoutInput {
  /** Persisted panel visibility (inspectorVisibleAtom). */
  visible: boolean
  /** The user explicitly opened the panel in this context (session). */
  userOpened: boolean
  /** Session harness inspector (files/git/browser/context sections). */
  sessionMode: boolean
  activeSection: string
  /** Files in the focused session; null while unknown. */
  fileCount: number | null
  /** Side terminal replaces the section body. */
  terminalOpen: boolean
  /** Width the panel may take without squeezing the center below its min. */
  availableWidth: number
  /** Persisted panel width. */
  storedWidth: number
  minWidth: number
  maxWidth: number
  /** Hard viewport cap (e.g. 72% of the window). */
  viewportCap: number
}

export interface InspectorLayout {
  /** Whether the panel (not the section rail) renders. */
  panelShown: boolean
  /** Why a persisted-visible panel is hidden, for data attributes / tests. */
  collapsedReason: 'empty-files' | 'squeezed' | null
  width: number
}

export function isEmptyFilesSection(input: Pick<InspectorLayoutInput, 'sessionMode' | 'activeSection' | 'fileCount' | 'terminalOpen'>): boolean {
  return input.sessionMode
    && !input.terminalOpen
    && input.activeSection === 'files'
    && input.fileCount === 0
}

export function resolveInspectorLayout(input: InspectorLayoutInput): InspectorLayout {
  const cap = Math.max(input.minWidth, Math.min(input.maxWidth, input.viewportCap))
  const preferred = Math.min(cap, Math.max(input.minWidth, input.storedWidth))

  if (!input.visible) {
    return { panelShown: false, collapsedReason: null, width: preferred }
  }

  if (!input.userOpened && isEmptyFilesSection(input)) {
    return { panelShown: false, collapsedReason: 'empty-files', width: preferred }
  }

  const available = Number.isFinite(input.availableWidth) ? Math.floor(input.availableWidth) : Number.POSITIVE_INFINITY
  if (available < input.minWidth) {
    if (input.userOpened) {
      return { panelShown: true, collapsedReason: null, width: input.minWidth }
    }
    return { panelShown: false, collapsedReason: 'squeezed', width: preferred }
  }

  return {
    panelShown: true,
    collapsedReason: null,
    width: Math.max(input.minWidth, Math.min(preferred, available)),
  }
}

/** Count files (not directories) in a session file tree. */
export function countSessionFiles(entries: ReadonlyArray<{ type?: string; children?: ReadonlyArray<unknown> }> | null | undefined): number {
  if (!entries) return 0
  let count = 0
  for (const entry of entries) {
    if (entry.type === 'directory') {
      count += countSessionFiles(entry.children as ReadonlyArray<{ type?: string; children?: ReadonlyArray<unknown> }> | undefined)
    } else {
      count += 1
    }
  }
  return count
}
