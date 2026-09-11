/**
 * Conation shell / inspector opt-in atoms (default false).
 * Parallel to harness AgentTeams — not under workbench.harness.*.
 */
import { atomWithStorage } from 'jotai/utils'
import { getKeyString, KEYS } from '@/lib/local-storage'

export const featureWorkbenchConationShellAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationShell),
  false,
  undefined,
  { getOnInit: true },
)

export const featureWorkbenchConationInspectorAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchConationInspector),
  false,
  undefined,
  { getOnInit: true },
)

export const featureSkillsConationSurfacesAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureSkillsConationSurfaces),
  false,
  undefined,
  { getOnInit: true },
)

/** Both shell + inspector must be on for the empty Conation host to contribute. */
export function isConationInspectorEnabled(
  shellEnabled: boolean,
  inspectorEnabled: boolean,
): boolean {
  return shellEnabled === true && inspectorEnabled === true
}
