/**
 * W1-07 (#1504) — React bindings for the slot registry.
 *
 * Re-renders when contributions change or a shell flag flips. Visibility is
 * decided by `isSlotContributionVisible` (flags + `when`).
 */
import { useMemo, useSyncExternalStore } from 'react'
import { useAtomValue } from 'jotai'
import type { ContextKeys } from '@rox/core/platform'
import { enabledShellFlagsAtom, flagContextKeys } from './unified-flags'
import { getSlotRegistry, type SlotContribution, type SlotId, type SlotRegistry } from './slots'

let version = 0
const versionListeners = new Set<() => void>()
let watched: SlotRegistry | null = null

function subscribe(listener: () => void): () => void {
  const registry = getSlotRegistry()
  if (watched !== registry) {
    watched = registry
    registry.onDidChange(() => {
      version++
      for (const notify of versionListeners) notify()
    })
  }
  versionListeners.add(listener)
  return () => versionListeners.delete(listener)
}

function getVersion(): number {
  return version
}

/** Visible contributions of `slot` for the current flags (+ optional context keys). */
export function useSlotContributions<P = unknown>(slot: SlotId, keys?: ContextKeys): SlotContribution<P>[] {
  const flags = useAtomValue(enabledShellFlagsAtom)
  const tick = useSyncExternalStore(subscribe, getVersion, getVersion)
  return useMemo(
    () => getSlotRegistry().list<P>(slot, { flags, keys: { ...flagContextKeys(flags), ...keys } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick invalidates on registry change
    [slot, flags, keys, tick],
  )
}
