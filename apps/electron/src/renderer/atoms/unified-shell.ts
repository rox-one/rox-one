/**
 * Unified Shell (W1) + Workbench v2 chrome flags.
 *
 * W1 master: `featureUnifiedShellAtom` (localStorage `craft-feature-unified-shell`,
 * default ON) gates ActivityRail + SurfaceTabs + InspectorHost together with
 * the Workbench preference.
 *
 * Workbench v2 splits further chrome behind granular `workbench.*` flags
 * (ADR-0001) so Mode Bar, TabGroups, browser-as-surface and Status Bar can
 * ship independently. Unified shell / inspector / workbench default ON.
 */
import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'

/** Wave flag: unified shell chrome (ActivityRail + SurfaceTabs + InspectorHost). */
export const featureUnifiedShellAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureUnifiedShell),
  true,
  undefined,
  { getOnInit: true },
)


/** Explicit Workbench user preference; operator policy is evaluated elsewhere. */
export const featureWorkbenchAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.workbenchEnabled),
  true,
  undefined,
  { getOnInit: true },
)


export const featureWorkbenchModeRegistryV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchModeRegistryV1),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchTopChromeV2Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchTopChromeV2),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchTabGroupsV2Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchTabGroupsV2),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchBrowserSurfaceV2Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchBrowserSurfaceV2),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchStatusBarV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchStatusBarV1),
  false,
  undefined,
  { getOnInit: true },
)

/** Session inspector tabs (files / git / browser). Independent of unified-shell master. */
export const featureWorkbenchHarnessInspectorV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessInspectorV1),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessChatChromeV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessChatChromeV1),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessAgentIntelV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessAgentIntelV1),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessExtCenterV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessExtCenterV1),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchHarnessAgentTeamsAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchHarnessAgentTeams),
  false,
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

/** Activity rail collapsed (destinations hidden, expand chevron stays). */
export const activityRailCollapsedAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.activityRailCollapsed),
  false,
  undefined,
  { getOnInit: true },
)

/** Inspector panel visibility (the 48px section rail itself always renders). */
export const inspectorVisibleAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.inspectorVisible),
  true,
  undefined,
  { getOnInit: true },
)

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
export const inspectorPanelWidthAtom = atomWithStorage<number>(
  getKeyString(KEYS.inspectorPanelWidth),
  420,
  undefined,
  { getOnInit: true },
)

/** Terminal docked under the main column (stacks with the right inspector). */
export const bottomTerminalOpenAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.bottomTerminalOpen),
  false,
  undefined,
  { getOnInit: true },
)

/** Bottom terminal dock height in px. */
export const bottomDockHeightAtom = atomWithStorage<number>(
  getKeyString(KEYS.bottomDockHeight),
  240,
  undefined,
  { getOnInit: true },
)
