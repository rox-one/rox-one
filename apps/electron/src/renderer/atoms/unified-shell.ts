/**
 * Unified Shell (W1) — feature flag + chrome state atoms.
 *
 * Wave gate: `featureUnifiedShellAtom`. Additive `workbench.*` chrome
 * (status bar, tab-group persist) OR-falls back to that atom
 * (ADR-0001 addendum). Mode-registry / top-chrome / browser-surface
 * and domain/workgraph flags do not.
 */
import { useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  createWorkbenchFeatureFlagRegistry,
  resolveFlagWithUnifiedShellFallback,
  type FeatureFlagOverrides,
  type FeatureFlagRegistry,
} from '@craft-agent/core/platform'
import { KEYS, getKeyString } from '@/lib/local-storage'

/** Wave flag: unified shell chrome (ActivityRail + SurfaceTabs + InspectorHost). */
export const featureUnifiedShellAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureUnifiedShell),
  false,
  undefined,
  { getOnInit: true },
)

export const featureFlagOverridesAtom = atomWithStorage<FeatureFlagOverrides>(
  getKeyString(KEYS.featureFlagOverrides),
  {},
  undefined,
  { getOnInit: true },
)

let workbenchFlagRegistry: FeatureFlagRegistry | null = null

export function getWorkbenchFlagRegistry(): FeatureFlagRegistry {
  if (!workbenchFlagRegistry) {
    workbenchFlagRegistry = createWorkbenchFeatureFlagRegistry()
  }
  return workbenchFlagRegistry
}

export function useWorkbenchFlag(id: string): boolean {
  const unifiedShell = useAtomValue(featureUnifiedShellAtom)
  const overrides = useAtomValue(featureFlagOverridesAtom)
  return resolveFlagWithUnifiedShellFallback(
    getWorkbenchFlagRegistry(),
    id,
    overrides,
    unifiedShell,
  )
}

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
