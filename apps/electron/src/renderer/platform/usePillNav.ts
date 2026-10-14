/**
 * WP6 shared pill selector: ModeBar, the ⌘-slot hotkeys, the sidebar and the
 * rail all read the SAME resolved pill (scene, flags, non-navigable modes,
 * browser availability, TopBar compact), so a pill-placed surface the pill
 * does not render falls back to the sidebar/rail instead of vanishing.
 */
import { useMemo } from 'react'
import { resolveNavSurfaces } from '../components/app-shell/primary-nav'
import { useNavPlacements } from '../components/app-shell/nav-placement'
import { resolvePillModel, usePillPreferences, type PillModel, type PillNavPlacement } from './pill-composition'
import { canOpenPillBrowser } from './pill-activate'
import { activeScene, useScenes } from './scenes'
import { useShellModes } from './useModes'
import { usePills } from '../components/shell/shell-prefs'

export function usePillNav(shellFlags: ReadonlySet<string>): PillNavPlacement {
  const placements = useNavPlacements()
  // Subscribe to the pill order so a pure reorder (Settings/onboarding) re-renders ModeBar live.
  const pillOrder = usePills()
  return useMemo(() => ({ surfaces: resolveNavSurfaces({ shellFlags, placements }), placements, pillOrder }), [shellFlags, placements, pillOrder])
}

/** `pillShown`: the TopBar renders the pill (`modePillShown`). */
export function usePillModel(pillShown: boolean): PillModel & { nav: PillNavPlacement } {
  const { modes, shellFlags } = useShellModes()
  const prefs = usePillPreferences()
  const sceneState = useScenes()
  const scene = useMemo(() => activeScene(sceneState), [sceneState])
  const nav = usePillNav(shellFlags)
  const browserAvailable = canOpenPillBrowser()
  return useMemo(
    () => ({ ...resolvePillModel({ modes, prefs, scene, nav, browserAvailable, pillShown }), nav }),
    [modes, prefs, scene, nav, browserAvailable, pillShown],
  )
}
