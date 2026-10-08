/**
 * W1-07 (#1504) — React bindings for the mode registry: re-render when a
 * mode is (un)registered late (`registerSeededMode` from a wave-2 package) or
 * when a flag flips.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { useAtomValue } from 'jotai'
import type { ModeContribution, ModeRegistry } from '@rox/core/platform'
import { modeScreenFlagsAtom } from '@/atoms/mode-flags'
import { getModeRegistry } from './mode-registry-bootstrap'
import { enabledShellFlagsAtom } from './unified-flags'
import { listShellModes } from './surface-shell'

let version = 0
const versionListeners = new Set<() => void>()
let watched: ModeRegistry | null = null

function subscribe(listener: () => void): () => void {
  const registry = getModeRegistry()
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

const getVersion = () => version

/** Bumps whenever the mode registry changes. */
export function useModeRegistryVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion)
}

export interface ShellModes {
  /** Pill / ⌘1…7 list: disabled legacy modes have `rootRoute: null`. */
  modes: ModeContribution[]
  /** Same modes and titles (Docs relabel) with every root kept — for titles. */
  titleModes: ModeContribution[]
  shellFlags: ReadonlySet<string>
}

/** The resolved modes (one list for the pill, ⌘1…7 and tab titles). */
export function useShellModes(): ShellModes {
  const modeFlags = useAtomValue(modeScreenFlagsAtom)
  const shellFlags = useAtomValue(enabledShellFlagsAtom)
  const tick = useModeRegistryVersion()
  return useMemo(
    () => ({
      modes: listShellModes(getModeRegistry(), modeFlags, shellFlags),
      titleModes: listShellModes(getModeRegistry(), {}, shellFlags),
      shellFlags,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick invalidates on registry change
    [modeFlags, shellFlags, tick],
  )
}

/** Test seam: the external store behind `useModeRegistryVersion`. */
export const modeRegistryStore = { subscribe, getSnapshot: getVersion }
