/**
 * W1-07 (#1504) — renderer side of the unified-programme workbench flags.
 *
 * Every flag registered in `packages/core/src/platform/workbench/flags.ts`
 * with `defaultValue: false` and no dedicated legacy atom gets a storage-backed
 * atom here, keyed `craft-workbench-flag:<id>` — so wave-2 packages get a
 * renderer flag simply by registering it in `flags.ts`, without touching shell
 * code. `enabledShellFlagsAtom` is the set the shell hands to the mode
 * registry (`when`), the slot registry (`flag`) and the route gate.
 *
 * With nothing stored, every flag here is OFF and the shell is identical to
 * the baseline.
 */
import { atom, type WritableAtom } from 'jotai'
import { atomWithStorage, RESET } from 'jotai/utils'
import {
  WORKBENCH_FEATURE_FLAGS,
  WORKBENCH_FLAG,
  resolveEnabledFlags,
  type ContextKeyProvider,
} from '@rox/core/platform'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { MODE_SCREEN_FLAG_IDS, modeScreenFlagsAtom, type ModeScreenId } from '@/atoms/mode-flags'
import {
  UNIFIED_SURFACE_FLAGS,
  UNIFIED_SURFACE_IDS,
  setUnifiedSurfaceRoutesEnabled,
  type UnifiedSurfaceId,
} from '../../shared/surface-routes'
import { isSurfaceActive } from './surface-activity'
import { getShellStore, isShellStoreConnected, setShellStore, type ShellStore } from './shell-store'

/** Flags owned by W1-07; all default OFF. */
export const W1_07_FLAG_IDS = [
  WORKBENCH_FLAG.modeMessengerV1,
  WORKBENCH_FLAG.modeCalendarV1,
  WORKBENCH_FLAG.modeGoalsV1,
  WORKBENCH_FLAG.modeContactsV1,
  WORKBENCH_FLAG.docsSharedV1,
] as const

/**
 * Default-OFF flags that already own a dedicated renderer atom / key (or whose
 * owner package wires one), so the generic store must not shadow them.
 */
const DEDICATED_ATOM_FLAG_IDS: ReadonlySet<string> = new Set([
  WORKBENCH_FLAG.conationShell,
  WORKBENCH_FLAG.conationInspector,
  WORKBENCH_FLAG.conationSurfacesSkill,
  WORKBENCH_FLAG.conationSoupClient,
  WORKBENCH_FLAG.conationNotesBridge,
  WORKBENCH_FLAG.conationDriveRead,
  WORKBENCH_FLAG.conationCanvas,
  WORKBENCH_FLAG.conationBoard,
  WORKBENCH_FLAG.conationMail,
  WORKBENCH_FLAG.conationCal,
  WORKBENCH_FLAG.conationDssClient,
  WORKBENCH_FLAG.conationSessionApply,
  // Owned by W1-02 (#1499), which wires its own Settings toggle.
  WORKBENCH_FLAG.entitiesLinksV1,
])

/** Flag ids served by the generic store (default-OFF, no dedicated atom). */
export function genericFlagIds(): string[] {
  return WORKBENCH_FEATURE_FLAGS
    .filter((definition) => definition.defaultValue === false && !DEDICATED_ATOM_FLAG_IDS.has(definition.id))
    .map((definition) => definition.id)
}

type FlagAtom = WritableAtom<boolean, [boolean | typeof RESET], void>
const flagAtoms = new Map<string, FlagAtom>()

/** Storage-backed atom for one generic flag (default from its definition, else OFF). */
export function workbenchFlagAtom(id: string): FlagAtom {
  let flagAtom = flagAtoms.get(id)
  if (!flagAtom) {
    const definition = WORKBENCH_FEATURE_FLAGS.find((candidate) => candidate.id === id)
    flagAtom = atomWithStorage<boolean>(
      getKeyString(KEYS.workbenchFlag, id),
      definition?.defaultValue === true,
      undefined,
      { getOnInit: true },
    )
    flagAtoms.set(id, flagAtom)
  }
  return flagAtom
}

/**
 * Pure resolution: generic flag values + legacy mode-screen flags → the
 * enabled set (dependencies honoured through `resolveEnabledFlags`).
 */
export function resolveShellFlags(
  generic: Readonly<Record<string, boolean>>,
  modeScreens: Partial<Record<ModeScreenId, boolean>> = {},
): ReadonlySet<string> {
  const requested = new Set<string>()
  for (const [id, on] of Object.entries(generic)) if (on) requested.add(id)
  for (const [screen, flagId] of Object.entries(MODE_SCREEN_FLAG_IDS) as Array<[ModeScreenId, string]>) {
    // Legacy mode screens default ON (undefined = on), like resolveSeededModes.
    if (modeScreens[screen] !== false) requested.add(flagId)
  }
  return resolveEnabledFlags(requested)
}

/** Every enabled workbench flag the shell gates on (mode `when`, slot `flag`). */
export const enabledShellFlagsAtom = atom<ReadonlySet<string>>((get) => {
  const generic: Record<string, boolean> = {}
  for (const id of genericFlagIds()) generic[id] = get(workbenchFlagAtom(id))
  return resolveShellFlags(generic, get(modeScreenFlagsAtom))
})

/** Surfaces whose mode flag is on, in rail order. */
export function enabledUnifiedSurfaces(flags: ReadonlySet<string>): UnifiedSurfaceId[] {
  return UNIFIED_SURFACE_IDS.filter((surface) => flags.has(UNIFIED_SURFACE_FLAGS[surface]))
}

/** Context keys for `when` expressions: `{ '<flag id>': true }` per enabled flag. */
export function flagContextKeys(flags: ReadonlySet<string>): Record<string, boolean> {
  const keys: Record<string, boolean> = {}
  for (const id of flags) keys[id] = true
  return keys
}

/**
 * Omnibox context keys for the generic flags only (`<flag id>` → boolean), so
 * `when: <flag>` commands hide while the flag is off. Dedicated flags keep
 * their own providers (e.g. conation) and are never overridden here.
 */
export function createShellFlagContextKeyProvider(fixedStore?: ShellStore): ContextKeyProvider {
  const ids = genericFlagIds()
  return {
    keys: [...ids, 'messengerActive'],
    pull() {
      // Resolved per pull: the Provider store may connect after creation.
      const store = fixedStore ?? getShellStore()
      const enabled = store.get(enabledShellFlagsAtom)
      const values: Record<string, boolean> = {}
      for (const id of ids) values[id] = enabled.has(id)
      // Messenger-only commands (⌃1…4 quick panels) — same key as the keymap.
      values.messengerActive = isSurfaceActive('messenger', store)
      return values
    },
  }
}

/** Enabled flags in the shell store right now (keydown gates, takeovers). */
export function currentShellFlags(): ReadonlySet<string> {
  return getShellStore().get(enabledShellFlagsAtom)
}

let activeBridge: { store: ShellStore; dispose: () => void } | null = null

/**
 * Mirror the gate into the main process so `rox://<mode>` deep links follow
 * the same flags (main is default-closed). No-op outside Electron / in tests.
 */
export function pushSurfaceRoutesToMain(ids: Iterable<string>): void {
  const list = [...ids]
  const warn = (err: unknown) =>
    console.warn('[unified-flags] surface route gate push to main failed; rox://<mode> deep links stay closed', list, err)
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    api?.setUnifiedSurfaceRoutesEnabled?.(list)?.catch(warn)
  } catch (err) {
    // main stays default-closed
    warn(err)
  }
}

/**
 * Keep the shared route parser's surface gate (and main's copy) in sync with
 * the flag atoms of ONE store. Installing on another store moves the bridge
 * there, so a stale store can never push an outdated gate. Returns the
 * disposer. Runs at module load on the fallback store so the very first route
 * parse already sees persisted flags; `connectShellStore` then moves it to the
 * Provider store.
 */
export function installShellFlagBridges(store: ShellStore = getShellStore()): () => void {
  if (activeBridge?.store === store) return activeBridge.dispose
  activeBridge?.dispose()
  const sync = () => {
    const ids = enabledUnifiedSurfaces(store.get(enabledShellFlagsAtom))
    setUnifiedSurfaceRoutesEnabled(ids)
    pushSurfaceRoutesToMain(ids)
  }
  sync()
  const unsubscribe = store.sub(enabledShellFlagsAtom, sync)
  const entry = {
    store,
    dispose: () => {
      unsubscribe()
      if (activeBridge === entry) activeBridge = null
    },
  }
  activeBridge = entry
  return entry.dispose
}

/** Store currently driving the route gate (tests / diagnostics). */
export function shellFlagBridgeStore(): ShellStore | null {
  return activeBridge?.store ?? null
}

/**
 * Make `store` (the `<JotaiProvider>` store) the one every W1-07 gate reads,
 * and move the route-gate bridge onto it. Returns the disconnect function.
 */
export function connectShellStore(store: ShellStore): () => void {
  setShellStore(store)
  const dispose = installShellFlagBridges(store)
  return () => {
    dispose()
    if (isShellStoreConnected(store)) setShellStore(null)
  }
}

if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
  installShellFlagBridges()
}
