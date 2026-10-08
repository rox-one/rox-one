/**
 * Renderer side of the `entities.links.v1` flag.
 *
 * The renderer owns the persisted user toggle (`featureEntitiesLinksV1Atom`,
 * localStorage); main owns the EFFECTIVE state (env override
 * `CRAFT_FEATURE_ENTITIES_LINKS` > toggle), because the context-isolated
 * renderer cannot read the env. This module keeps one module-level copy of
 * the effective state and feeds it into the shared route gate
 * (`setEntityRoutesEnabled`), so the renderer, the main deep-link parser and
 * the entity RPC always agree.
 *
 * Ordering (review 3 #1): `seedEntitiesLinksGate()` runs in `main.tsx`
 * before `createRoot`, synchronously reporting the persisted toggle to main
 * and applying the returned effective state, so restored `docs/…`/`goals/…`
 * tabs and persisted `entity/…` keys resolve correctly on the very first
 * render. Navigation re-resolves when the state changes because
 * `NavigationContext` depends on `useEntitiesLinksEffectiveState()`.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  resolveEntitiesLinksEffectiveState,
  type EntitiesLinksEffectiveState,
} from '@rox/shared/feature-flags'
import { setEntityRoutesEnabled } from '../../shared/route-parser'
import * as storage from './local-storage'

type Bridge = Partial<Pick<NonNullable<Window['electronAPI']>, 'setEntitiesLinksEnabled' | 'syncEntitiesLinksState' | 'onEntitiesLinksStateChanged'>>

const DEFAULT_STATE: EntitiesLinksEffectiveState = { enabled: false, persisted: false, envOverride: undefined }

let effective: EntitiesLinksEffectiveState = DEFAULT_STATE
/** True once main has acknowledged a report (sync seed or async push). */
let reportedToMain = false
const listeners = new Set<() => void>()
/** The latest `setEntitiesLinksEnabled` round trip, until main answers. */
let inFlightPush: Promise<unknown> | null = null

function bridge(): Bridge | undefined {
  try {
    return typeof window === 'undefined' ? undefined : (window.electronAPI as Bridge | undefined)
  } catch {
    return undefined
  }
}

function isEffectiveState(value: unknown): value is EntitiesLinksEffectiveState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.enabled === 'boolean'
    && typeof record.persisted === 'boolean'
    && (record.envOverride === undefined || typeof record.envOverride === 'boolean')
}

/** Apply an effective state to the route gate and notify subscribers. */
export function applyEntitiesLinksEffectiveState(next: EntitiesLinksEffectiveState): void {
  setEntityRoutesEnabled(next.enabled)
  if (
    next.enabled === effective.enabled
    && next.persisted === effective.persisted
    && next.envOverride === effective.envOverride
  ) return
  effective = { enabled: next.enabled, persisted: next.persisted, envOverride: next.envOverride }
  for (const listener of [...listeners]) listener()
}

export function getEntitiesLinksEffectiveState(): EntitiesLinksEffectiveState {
  return effective
}

export function subscribeEntitiesLinksEffectiveState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The persisted toggle as stored by `featureEntitiesLinksV1Atom` (default OFF). */
export function readPersistedEntitiesLinksFlag(): boolean {
  return storage.get<unknown>(storage.KEYS.featureEntitiesLinksV1, false) === true
}

/**
 * Bootstrap (before the first render): report the persisted toggle to main
 * synchronously and apply the effective state it returns. Without a bridge
 * (tests, web host) the toggle alone decides — that host has no env override.
 */
export function seedEntitiesLinksGate(persisted: boolean = readPersistedEntitiesLinksFlag()): EntitiesLinksEffectiveState {
  let fromMain: unknown = null
  try {
    fromMain = bridge()?.syncEntitiesLinksState?.(persisted) ?? null
  } catch (error) {
    console.error('[entities] failed to sync entities.links.v1 with main:', error)
  }
  reportedToMain = isEffectiveState(fromMain)
  applyEntitiesLinksEffectiveState(isEffectiveState(fromMain) ? fromMain : resolveEntitiesLinksEffectiveState(persisted, undefined))
  return effective
}

/**
 * Report a toggle change. The route gate follows immediately (keeping a
 * known env override), then adopts main's authoritative answer. IPC
 * failures are logged, never swallowed.
 */
export function pushEntitiesLinksFlag(enabled: boolean): Promise<EntitiesLinksEffectiveState> {
  applyEntitiesLinksEffectiveState(resolveEntitiesLinksEffectiveState(enabled, effective.envOverride))
  let pending: Promise<EntitiesLinksEffectiveState> | undefined
  try {
    pending = bridge()?.setEntitiesLinksEnabled?.(enabled)
  } catch (error) {
    console.error('[entities] failed to push entities.links.v1 to main:', error)
    return Promise.resolve(effective)
  }
  if (!pending) return Promise.resolve(effective)
  const result = pending.then(
    (state) => {
      if (isEffectiveState(state)) {
        reportedToMain = true
        applyEntitiesLinksEffectiveState(state)
      } else console.error('[entities] main returned an invalid entities.links.v1 state:', state)
      return effective
    },
    (error: unknown) => {
      console.error('[entities] failed to push entities.links.v1 to main:', error)
      return effective
    },
  )
  inFlightPush = result
  const clear = () => { if (inFlightPush === result) inFlightPush = null }
  result.then(clear, clear)
  return result
}

/**
 * Resolves once main has answered the latest toggle push, or `null` when no
 * push is in flight. Main applies the toggle over ipcMain while entity RPCs
 * use the RPC transport, so callers that must observe main's new state (the
 * preview cache) re-check after this.
 */
export function entitiesLinksSettled(): Promise<void> | null {
  const pending = inFlightPush
  return pending ? pending.then(() => undefined, () => undefined) : null
}

/** Effective state for components (Settings toggle, navigation memo). */
export function useEntitiesLinksEffectiveState(): EntitiesLinksEffectiveState {
  return useSyncExternalStore(subscribeEntitiesLinksEffectiveState, getEntitiesLinksEffectiveState, getEntitiesLinksEffectiveState)
}

/**
 * Keep main in sync with the persisted atom and follow main's broadcasts
 * (other windows, env override).
 */
export function useEntitiesLinksFlagSync(persisted: boolean): void {
  useEffect(() => {
    if (persisted === effective.persisted && reportedToMain) return
    void pushEntitiesLinksFlag(persisted)
  }, [persisted])
  useEffect(() => {
    const subscribe = bridge()?.onEntitiesLinksStateChanged
    if (!subscribe) return
    return subscribe((state) => {
      if (isEffectiveState(state)) applyEntitiesLinksEffectiveState(state)
    })
  }, [])
}

/** Test seam. */
export function __resetEntitiesLinksSyncForTests(): void {
  effective = DEFAULT_STATE
  reportedToMain = false
  inFlightPush = null
  listeners.clear()
  setEntityRoutesEnabled(false)
}
