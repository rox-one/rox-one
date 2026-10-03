/**
 * Unified Shell (W1) + Workbench v2 chrome flags.
 *
 * W1 master: `featureUnifiedShellAtom` (localStorage `craft-feature-unified-shell`,
 * default OFF) gates ActivityRail + SurfaceTabs + InspectorHost together with
 * the Workbench preference.
 *
 * Workbench v2 splits further chrome behind granular `workbench.*` flags
 * (ADR-0001) so Mode Bar, TabGroups, browser-as-surface and Status Bar can
 * ship independently. Unified shell / workbench masters default OFF.
 * Granular workbench.* experimental flags default ON (P35-08). Conation stays off.
 */
import { atom } from 'jotai'
import { atomWithStorage, RESET } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { SIDE_PANEL_DEFAULT_WIDTH } from '@/lib/shell-layout-preferences'

export const INSPECTOR_PANEL_WIDTH_MIN = 280
export const INSPECTOR_PANEL_WIDTH_MAX = 1400
export const BOTTOM_DOCK_HEIGHT_MIN = 88
export const BOTTOM_DOCK_HEIGHT_MAX = 480

/** Keep corrupt/stale layout values from making shell controls inaccessible. */
export function clampPersistedLayoutSize(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

function boundedNumberStorage(min: number, max: number, fallback: number) {
  return {
    getItem(key: string, initialValue: number): number {
      try {
        if (typeof localStorage === 'undefined') return initialValue
        return clampPersistedLayoutSize(JSON.parse(localStorage.getItem(key) ?? 'null'), min, max, fallback)
      } catch {
        return fallback
      }
    },
    setItem(key: string, value: number): void {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, JSON.stringify(clampPersistedLayoutSize(value, min, max, fallback)))
        }
      } catch {
        // Resizing remains usable when storage is denied or its quota is full.
      }
    },
    removeItem(key: string): void {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
      } catch {
        // The live preference can still reset when persistence is unavailable.
      }
    },
    subscribe(key: string, callback: (value: number) => void): () => void {
      if (typeof window === 'undefined') return () => {}
      const onStorage = (event: StorageEvent) => {
        try {
          if (event.storageArea !== localStorage || (event.key !== key && event.key !== null)) return
          callback(this.getItem(key, fallback))
        } catch {
          callback(fallback)
        }
      }
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    },
  }
}

/** Normalize before Jotai publishes, including functional updates and RESET. */
function boundedLayoutAtom(key: string, min: number, max: number, fallback: number) {
  const persisted = atomWithStorage<number>(key, fallback, boundedNumberStorage(min, max, fallback), { getOnInit: true })
  return atom(
    (get) => get(persisted),
    (get, set, update: number | typeof RESET | ((previous: number) => number | typeof RESET)) => {
      const value = typeof update === 'function' ? update(get(persisted)) : update
      set(persisted, value === RESET ? RESET : clampPersistedLayoutSize(value, min, max, fallback))
    },
  )
}

/** Wave flag: unified shell chrome (ActivityRail + SurfaceTabs + InspectorHost). Master stays off. */
export const featureUnifiedShellAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureUnifiedShell),
  false,
  undefined,
  { getOnInit: true },
)


/** Explicit Workbench user preference; operator policy is evaluated elsewhere. */
export const featureWorkbenchAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.workbenchEnabled),
  false,
  undefined,
  { getOnInit: true },
)


export const featureWorkbenchModeRegistryV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchModeRegistryV1),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchTopChromeV2Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchTopChromeV2),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchTabGroupsV2Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchTabGroupsV2),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchBrowserSurfaceV2Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchBrowserSurfaceV2),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchStatusBarV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchStatusBarV1),
  true,
  undefined,
  { getOnInit: true },
)

/** Session inspector tabs (files / git / browser). Independent of unified-shell master. */
export const featureWorkbenchHarnessInspectorV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessInspectorV1),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessChatChromeV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessChatChromeV1),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessAgentIntelV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessAgentIntelV1),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessExtCenterV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessExtCenterV1),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessAgentTeamsAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessAgentTeams),
  true,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationSoupClientAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationSoupClient),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationNotesBridgeAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationNotesBridge),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationDriveReadAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationDriveRead),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationCanvasAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationCanvas),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationBoardAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationBoard),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationMailAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationMail),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationDssClientAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationDssClient),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationSessionApplyAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationSessionApply),
  false,
  undefined,
  { getOnInit: true },
)

/**
 * Activity rail collapsed to icons only (tooltips carry the labels).
 * Default false = expanded with icon + text labels. Existing saved preferences
 * remain authoritative; this upgrade does not reset an explicit collapse.
 */
export const activityRailCollapsedAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.activityRailCollapsed),
  false,
  undefined,
  { getOnInit: true },
)

/**
 * Not persisted: the user expanded the rail while the window is narrow enough
 * to auto-collapse it (see `useEffectiveRailCollapsed`).
 */
export const activityRailNarrowOverrideAtom = atom<boolean>(false)

/** Inspector panel visibility (the 48px section rail itself always renders). */
export const inspectorVisibleAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.inspectorVisible),
  true,
  undefined,
  { getOnInit: true },
)

/**
 * Session-scoped (not persisted): the user explicitly opened the inspector
 * panel. Overrides the one-surface auto-collapse (empty Files section or a
 * squeezed center column). InspectorHost resets it when the focused session
 * changes.
 */
export const inspectorUserOpenedAtom = atom<boolean>(false)

/**
 * Not persisted: InspectorHost is currently hiding a persisted-visible panel
 * (empty Files or squeezed center). TopBar's inspector toggle reads it so
 * "open" means actually open.
 */
export const inspectorAutoCollapsedAtom = atom<boolean>(false)

/**
 * DOM slot in the TopBar row that hosts the session/surface tab strip, so the
 * tabs sit in the title-bar row instead of a separate strip above the panels.
 * Null in compact mode (SurfaceTabs then renders inline).
 */
export const topBarSurfaceTabsSlotAtom = atom<HTMLElement | null>(null)

/** Entire inspector chrome (panel + section rail) collapsed to a restore strip. */
export const inspectorChromeCollapsedAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.inspectorChromeCollapsed),
  false,
  undefined,
  { getOnInit: true },
)

/** Inspector sections: W1 knowledge + H1 session harness tabs. */
export type InspectorSectionId =
  | 'info'
  | 'agent'
  | 'outline'
  | 'backlinks'
  | 'files'
  | 'git'
  | 'browser'
  | 'context'

/** Active inspector section (persisted; validated on read by `inspector-model.ts`). */
export const inspectorSectionAtom = atomWithStorage<InspectorSectionId>(
  getKeyString(KEYS.inspectorSection),
  'info',
  undefined,
  { getOnInit: true },
)

/** Inspector panel width in px (drag-resized). */
export const inspectorPanelWidthAtom = boundedLayoutAtom(
  getKeyString(KEYS.inspectorPanelWidth),
  INSPECTOR_PANEL_WIDTH_MIN,
  INSPECTOR_PANEL_WIDTH_MAX,
  SIDE_PANEL_DEFAULT_WIDTH,
)

/** Terminal docked under the main column (stacks with the right inspector). */
export const bottomTerminalOpenAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.bottomTerminalOpen),
  false,
  undefined,
  { getOnInit: true },
)

/** Bottom terminal dock height in px. */
export const bottomDockHeightAtom = boundedLayoutAtom(
  getKeyString(KEYS.bottomDockHeight),
  BOTTOM_DOCK_HEIGHT_MIN,
  BOTTOM_DOCK_HEIGHT_MAX,
  104,
)
