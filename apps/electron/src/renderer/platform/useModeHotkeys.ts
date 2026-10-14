/**
 * ⌘/Ctrl 1…7 — jump to the n-th VISIBLE pill surface (composition order, pins
 * and the session-frozen frequency order), matching what the user sees in the
 * titlebar pill. Disabled / absent surfaces are skipped by the composition, so
 * a slot may map to nothing. WP6: the icon-only Главная is not numbered.
 */
import { useAction } from '@/actions'
import { navigate } from '@/lib/navigate'
import { usePillModel } from './usePillNav'
import { activatePillSurface, pillSurfaceForSlot, recordPillActivation } from './pill-composition'
import { useOpenPillBrowser } from './pill-activate'

export function useModeHotkeys(): void {
  const openBrowser = useOpenPillBrowser()
  // WP6: Главная leads the pill but is not numbered — ⌘1…7 keep their slots.
  const { slots: surfaces } = usePillModel(true)
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