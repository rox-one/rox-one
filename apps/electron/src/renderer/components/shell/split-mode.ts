/**
 * Split mode (top50 #13). The panel strip already puts screens side by side
 * (each opened screen is a panel in one scrolling row); split adds the
 * one-gesture "two screens, half and half" on top of it:
 *
 * - one panel open → opens a companion screen next to it (Sessions, or Notes
 *   when Sessions is the current one) and fits both to the viewport;
 * - two or more open → pairs the focused panel with its neighbour and fits
 *   the pair to the viewport;
 * - toggle again → leaves split; a companion split opened itself is closed
 *   only while the user has not navigated or interacted in it, otherwise it
 *   is kept like any panel the user opened.
 *
 * Widths while split are display-only: per-screen strip widths are untouched,
 * and dragging a split panel's sash leaves split and resizes as usual.
 */
import { atom } from 'jotai'
import { closePanelAtom, focusedPanelIdAtom, panelStackAtom } from '@/atoms/panel-stack'
import { routes } from '@/lib/navigate'
import type { ViewRoute } from '../../../shared/routes'
import { openScreenPanelAtom, stripScreenKey, STRIP_MIN_WIDTH } from './panel-strip'

export interface SplitState {
  /** The pair, in strip order. */
  ids: readonly [string, string]
  /** Panel split opened itself (closed when split ends, if untouched), or null. */
  openedId: string | null
  /** Route the companion was opened on; a different route means the user navigated. */
  openedRoute: string | null
  /** The user clicked or typed inside the companion. */
  touched: boolean
}

export const splitStateAtom = atom<SplitState | null>(null)

/** Split counts only while both panels are still open. */
export const activeSplitIdsAtom = atom<readonly [string, string] | null>((get) => {
  const state = get(splitStateAtom)
  if (!state) return null
  const ids = new Set(get(panelStackAtom).filter((entry) => !entry.tool).map((entry) => entry.id))
  return ids.has(state.ids[0]) && ids.has(state.ids[1]) ? state.ids : null
})

export function splitCompanionRoute(currentRoute: string | null | undefined): ViewRoute {
  const sessions = routes.view.allSessions() as string
  return (stripScreenKey(currentRoute ?? '') === stripScreenKey(sessions) ? routes.view.notes() : sessions) as ViewRoute
}

/** Half of the strip viewport for each split panel, never below the strip minimum. */
export function splitPanelWidth(viewportWidth: number, gap: number): number {
  return Math.max(STRIP_MIN_WIDTH, Math.floor((viewportWidth - gap) / 2))
}

export const toggleSplitAtom = atom(null, (get, set) => {
  const current = get(splitStateAtom)
  if (current && get(activeSplitIdsAtom)) {
    set(splitStateAtom, null)
    const companion = current.openedId ? get(panelStackAtom).find((entry) => entry.id === current.openedId) : undefined
    if (companion && !current.touched && companion.route === current.openedRoute) {
      set(closePanelAtom, companion.id)
    }
    return false
  }
  const screens = get(panelStackAtom).filter((entry) => !entry.tool)
  if (screens.length === 0) return false
  const focusedId = get(focusedPanelIdAtom)
  const index = Math.max(0, screens.findIndex((entry) => entry.id === focusedId))
  const focused = screens[index]!
  if (screens.length >= 2) {
    const partner = screens[index + 1] ?? screens[index - 1]!
    const ordered = screens.indexOf(partner) > index ? [focused.id, partner.id] as const : [partner.id, focused.id] as const
    set(splitStateAtom, { ids: ordered, openedId: null, openedRoute: null, touched: false })
    return true
  }
  // The strip opens a new screen on the left of the current one.
  const openedId = set(openScreenPanelAtom, { route: splitCompanionRoute(focused.route) })
  if (openedId === focused.id) return false
  const openedRoute = get(panelStackAtom).find((entry) => entry.id === openedId)?.route ?? null
  set(splitStateAtom, { ids: [openedId, focused.id], openedId, openedRoute, touched: false })
  return true
})

/** Leave split without closing anything (e.g. the user starts resizing). */
export const exitSplitAtom = atom(null, (_get, set) => { set(splitStateAtom, null) })

/** The user interacted inside a panel; marks the split companion as kept. */
export const markSplitPanelTouchedAtom = atom(null, (get, set, panelId: string) => {
  const state = get(splitStateAtom)
  if (state && !state.touched && state.openedId === panelId) set(splitStateAtom, { ...state, touched: true })
})
