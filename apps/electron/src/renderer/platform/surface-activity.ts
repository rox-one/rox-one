/**
 * W1-07 (#1504) — which unified surface is the active one right now.
 *
 * "Active" means the focused panel shows that surface's mode root. Unfocused
 * panels stay mounted (hidden in single-panel mode, dimmed in split view), so
 * "mounted" is not enough: the ⌃1…4 quick panels are Messenger-only
 * (UI-SPEC §15) and must not fire after the user leaves Messenger.
 *
 * Read synchronously by keybinding `when` clauses and the Omnibox context
 * provider — no React state, no re-renders.
 */
import { getDefaultStore } from 'jotai'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'
import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { UnifiedSurfaceId } from '../../shared/surface-routes'

type StoreReader = Pick<ReturnType<typeof getDefaultStore>, 'get'>

/** True while the focused panel's route resolves to `surface`'s mode root. */
export function isSurfaceActive(surface: UnifiedSurfaceId, store: StoreReader = getDefaultStore()): boolean {
  const route = store.get(focusedPanelRouteAtom)
  if (!route) return false
  const navState = parseRouteToNavigationState(route)
  return navState?.navigator === 'surface' && navState.surface === surface
}
