/**
 * Mode-screen flags `workbench.mode.<id>.v1` (ADR-0001 pattern: WORKBENCH_FLAG
 * + atomWithStorage + KEYS). Default ON; off hides the titlebar pill entry and
 * its ⌥⌘ hotkey (the seed nulls rootRoute) without touching any data.
 */
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@craft-agent/core/platform'
import { KEYS, getKeyString } from '@/lib/local-storage'

export type ModeScreenId = 'tasks' | 'meetings' | 'inbox' | 'feed'

export const MODE_SCREEN_FLAG_IDS: Record<ModeScreenId, string> = {
  tasks: WORKBENCH_FLAG.modeTasksV1,
  meetings: WORKBENCH_FLAG.modeMeetingsV1,
  inbox: WORKBENCH_FLAG.modeInboxV1,
  feed: WORKBENCH_FLAG.modeFeedV1,
}

const opts = { getOnInit: true } as const

export const featureWorkbenchModeTasksV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchModeTasksV1), true, undefined, opts,
)
export const featureWorkbenchModeMeetingsV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchModeMeetingsV1), true, undefined, opts,
)
export const featureWorkbenchModeInboxV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchModeInboxV1), true, undefined, opts,
)
export const featureWorkbenchModeFeedV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureWorkbenchModeFeedV1), true, undefined, opts,
)

export const MODE_SCREEN_FLAG_ATOMS = {
  tasks: featureWorkbenchModeTasksV1Atom,
  meetings: featureWorkbenchModeMeetingsV1Atom,
  inbox: featureWorkbenchModeInboxV1Atom,
  feed: featureWorkbenchModeFeedV1Atom,
} as const

/** Mode screens that are actually built (Settings shows toggles only for these). */
export const BUILT_MODE_SCREENS: readonly ModeScreenId[] = ['tasks', 'meetings', 'inbox', 'feed']

export type ModeScreenFlags = Record<ModeScreenId, boolean>

export const modeScreenFlagsAtom = atom<ModeScreenFlags>((get) => ({
  tasks: get(featureWorkbenchModeTasksV1Atom),
  meetings: get(featureWorkbenchModeMeetingsV1Atom),
  inbox: get(featureWorkbenchModeInboxV1Atom),
  feed: get(featureWorkbenchModeFeedV1Atom),
}))
