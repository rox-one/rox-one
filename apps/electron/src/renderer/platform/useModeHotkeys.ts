/**
 * ⌘/Ctrl 1…7 — jump to the n-th titlebar mode (pill order). Disabled modes
 * (rootRoute null, e.g. flag off) are a no-op.
 */
import { useAtomValue } from 'jotai'
import { useAction } from '@/actions'
import { modeScreenFlagsAtom } from '@/atoms/mode-flags'
import { navigate } from '@/lib/navigate'
import type { Route } from '../../shared/routes'
import { getModeRegistry } from './mode-registry-bootstrap'
import { modeForSlot, resolveSeededModes } from './modes-seed'

export function useModeHotkeys(): void {
  const flags = useAtomValue(modeScreenFlagsAtom)
  const go = (slot: number) => () => {
    const mode = modeForSlot(resolveSeededModes(getModeRegistry().list(), flags), slot)
    if (mode?.rootRoute) navigate(mode.rootRoute as Route)
  }
  useAction('mode.slot1', go(1), undefined, [flags])
  useAction('mode.slot2', go(2), undefined, [flags])
  useAction('mode.slot3', go(3), undefined, [flags])
  useAction('mode.slot4', go(4), undefined, [flags])
  useAction('mode.slot5', go(5), undefined, [flags])
  useAction('mode.slot6', go(6), undefined, [flags])
  useAction('mode.slot7', go(7), undefined, [flags])
}
