/**
 * ⌘/Ctrl 1…7 — jump to the n-th titlebar mode (pill order). Disabled modes
 * (rootRoute null, e.g. flag off) are a no-op.
 */
import { useAction } from '@/actions'
import { navigate } from '@/lib/navigate'
import type { Route } from '../../shared/routes'
import { modeForSlot } from './modes-seed'
// W1-07 (#1504): same resolved list as the pill; follows late registrations.
import { useShellModes } from './useModes'

export function useModeHotkeys(): void {
  const { modes } = useShellModes()
  const go = (slot: number) => () => {
    const mode = modeForSlot(modes, slot)
    if (mode?.rootRoute) navigate(mode.rootRoute as Route)
  }
  useAction('mode.slot1', go(1), undefined, [modes])
  useAction('mode.slot2', go(2), undefined, [modes])
  useAction('mode.slot3', go(3), undefined, [modes])
  useAction('mode.slot4', go(4), undefined, [modes])
  useAction('mode.slot5', go(5), undefined, [modes])
  useAction('mode.slot6', go(6), undefined, [modes])
  useAction('mode.slot7', go(7), undefined, [modes])
}
