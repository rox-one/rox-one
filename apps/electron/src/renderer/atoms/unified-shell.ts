/**
 * Unified Shell (W1) + Workbench v2 chrome flags.
 *
 * W1 master: `featureUnifiedShellAtom` (localStorage `craft-feature-unified-shell`,
 * default OFF) still gates ActivityRail + SurfaceTabs + InspectorHost together.
 *
 * Workbench v2 splits further chrome behind granular `workbench.*` flags
 * (ADR-0001) so Mode Bar, TabGroups, browser-as-surface and Status Bar can
 * ship independently. All default OFF.
 */
import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'

/** Wave flag: unified shell chrome (ActivityRail + SurfaceTabs + InspectorHost). */
export const featureUnifiedShellAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureUnifiedShell),
  false,
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
  false,
  undefined,
  { getOnInit: true },
)

/** Inspector sections shipped in W1; `info` is live, the rest are stub sections. */
export type InspectorSectionId = 'info' | 'agent' | 'outline' | 'backlinks'

/** Active inspector section (persisted; validated on read by `inspector-model.ts`). */
export const inspectorSectionAtom = atomWithStorage<InspectorSectionId>(
  getKeyString(KEYS.inspectorSection),
  'info',
  undefined,
  { getOnInit: true },
)
