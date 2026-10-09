/**
 * ⌘/Ctrl 1…7 — jump to the n-th VISIBLE pill surface (composition order, pins
 * and the session-frozen frequency order), matching what the user sees in the
 * titlebar pill. Disabled / absent surfaces are skipped by the composition, so
 * a slot may map to nothing.
 */
import { useMemo } from 'react'
import { useAction } from '@/actions'
import { navigate } from '@/lib/navigate'
import { useShellModes } from './useModes'
import {
  activatePillSurface,
  pillSurfaceForSlot,
  recordPillActivation,
  usePillPreferences,
  visiblePillSurfaces,
} from './pill-composition'
import { useOpenPillBrowser } from './pill-activate'
import { activeScene, useScenes } from './scenes'

export function useModeHotkeys(): void {
  const { modes } = useShellModes()
  const prefs = usePillPreferences()
  const scenes = useScenes()
  const scene = useMemo(() => activeScene(scenes), [scenes])
  const openBrowser = useOpenPillBrowser()
  const surfaces = useMemo(() => visiblePillSurfaces(modes, prefs, scene), [modes, prefs, scene])
  const go = (slot: number) => () => {
    const surface = pillSurfaceForSlot(surfaces, slot)
    if (!surface) return
    recordPillActivation(surface.id)
    activatePillSurface(surface, { navigate, openBrowser })
  }
  const deps = [surfaces, openBrowser]
  useAction('mode.slot1', go(1), undefined, deps)
  useAction('mode.slot2', go(2), undefined, deps)
  useAction('mode.slot3', go(3), undefined, deps)
  useAction('mode.slot4', go(4), undefined, deps)
  useAction('mode.slot5', go(5), undefined, deps)
  useAction('mode.slot6', go(6), undefined, deps)
  useAction('mode.slot7', go(7), undefined, deps)
}