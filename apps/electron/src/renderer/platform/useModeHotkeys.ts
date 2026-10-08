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
import { enabledShellFlagsAtom, flagContextKeys } from './unified-flags'

export function useModeHotkeys(): void {
  const flags = useAtomValue(modeScreenFlagsAtom)
  // W1-07: unified modes join the pill order only while their flag is on.
  const shellFlags = useAtomValue(enabledShellFlagsAtom)
  const go = (slot: number) => () => {
    const modes = resolveSeededModes(getModeRegistry().list(flagContextKeys(shellFlags)), flags, shellFlags)
    const mode = modeForSlot(modes, slot)
    if (mode?.rootRoute) navigate(mode.rootRoute as Route)
  }
  useAction('mode.slot1', go(1), undefined, [flags, shellFlags])
  useAction('mode.slot2', go(2), undefined, [flags, shellFlags])
  useAction('mode.slot3', go(3), undefined, [flags, shellFlags])
  useAction('mode.slot4', go(4), undefined, [flags, shellFlags])
  useAction('mode.slot5', go(5), undefined, [flags, shellFlags])
  useAction('mode.slot6', go(6), undefined, [flags, shellFlags])
  useAction('mode.slot7', go(7), undefined, [flags, shellFlags])
}
