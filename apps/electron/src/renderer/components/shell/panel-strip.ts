/**
 * Panel strip (shell-layout §2): screens open as panels in one horizontally
 * scrollable row. A newly opened screen lands on the left and the previous
 * ones shift right; widths are per screen and persisted; heavy panels that sit
 * off-screen long enough are hibernated (unmounted) and remount on return.
 *
 * Built on the existing panel-stack atoms: ⌘W (useWindowCloseHandler) closes
 * the focused panel, ⌘⌥←/→ (panel.focusLeft/Right) move focus.
 */
import * as React from 'react'
import { atom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  closePanelAtom,
  getPanelTypeFromRoute,
  type PanelStackEntry,
  type PanelType,
} from '@/atoms/panel-stack'
import type { ViewRoute } from '../../../shared/routes'
import * as storage from '@/lib/local-storage'

export const STRIP_MIN_WIDTH = 320
export const STRIP_MAX_WIDTH = 1400
export const STRIP_DEFAULT_WIDTH = 640
export const HIBERNATE_AFTER_MS = 30_000
/** Panel types whose host keeps instance state outside React (unmount is safe). */
export const HEAVY_PANEL_TYPES: ReadonlySet<PanelType> = new Set(['browser', 'knowledge'])

export const clampStripWidth = (width: number): number =>
  Math.round(Math.min(STRIP_MAX_WIDTH, Math.max(STRIP_MIN_WIDTH, Number.isFinite(width) ? width : STRIP_DEFAULT_WIDTH)))

/** Width key: the screen a route belongs to (first path segment), so a screen keeps its width across items. */
export function stripScreenKey(route: string): string {
  const clean = route.replace(/^\/+/, '').split(/[/?#]/)[0]
  return clean || 'home'
}

type Widths = Record<string, number>
function readWidths(): Widths {
  const raw = storage.get<unknown>(storage.KEYS.shellPanels, null)
  const out: Widths = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const widths = (raw as { widths?: unknown }).widths
    if (widths && typeof widths === 'object') {
      for (const [key, value] of Object.entries(widths as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampStripWidth(value)
      }
    }
  }
  return out
}

/** Persisted per-screen widths (px). */
export const stripWidthsAtom = atom<Widths>(readWidths())
export const setStripWidthAtom = atom(null, (get, set, { route, width }: { route: string; width: number }) => {
  const next = { ...get(stripWidthsAtom), [stripScreenKey(route)]: clampStripWidth(width) }
  set(stripWidthsAtom, next)
  storage.set(storage.KEYS.shellPanels, { widths: next })
})

export function stripWidthFor(widths: Widths, route: string): number {
  return widths[stripScreenKey(route)] ?? STRIP_DEFAULT_WIDTH
}

/**
 * Open a screen: focus the panel already showing that screen, otherwise insert
 * a new panel at index 0 (previous panels shift right). `replace` swaps the
 * focused panel's route instead (sidebar-style navigation).
 */
export const openScreenPanelAtom = atom(null, (get, set, { route, replace }: { route: ViewRoute; replace?: boolean }): string => {
  const stack = get(panelStackAtom)
  const key = stripScreenKey(route)
  const existing = stack.find((entry) => !entry.tool && (entry.route === route || stripScreenKey(entry.route) === key))
  if (existing) {
    if (existing.route !== route) set(panelStackAtom, stack.map((entry) => entry.id === existing.id ? { ...entry, route, panelType: getPanelTypeFromRoute(route) } : entry))
    set(focusedPanelIdAtom, existing.id)
    return existing.id
  }
  const focusedId = get(focusedPanelIdAtom)
  if (replace && focusedId) {
    set(panelStackAtom, stack.map((entry) => entry.id === focusedId ? { ...entry, route, panelType: getPanelTypeFromRoute(route) } : entry))
    return focusedId
  }
  const share = stack.length ? 1 / (stack.length + 1) : 1
  const entry: PanelStackEntry = {
    id: `panel-strip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    route,
    proportion: share,
    panelType: getPanelTypeFromRoute(route),
    laneId: 'main',
  } as PanelStackEntry
  const scaled = stack.map((panel) => ({ ...panel, proportion: panel.proportion * (1 - share) }))
  set(panelStackAtom, [entry, ...scaled])
  set(focusedPanelIdAtom, entry.id)
  return entry.id
})

export interface StripPanel { id: string; route: string; width: number; hibernated: boolean }

/** Public hook (shell-api.md §2). */
export function usePanelStrip() {
  const stack = useAtomValue(panelStackAtom)
  const activeId = useAtomValue(focusedPanelIdAtom)
  const widths = useAtomValue(stripWidthsAtom)
  const hibernated = useAtomValue(hibernatedPanelIdsAtom)
  const openScreen = useSetAtom(openScreenPanelAtom)
  const closePanel = useSetAtom(closePanelAtom)
  const setFocused = useSetAtom(focusedPanelIdAtom)
  const setWidth = useSetAtom(setStripWidthAtom)
  const store = useStore()
  const panels = React.useMemo<StripPanel[]>(() => stack.map((entry) => ({
    id: entry.id, route: entry.route, width: stripWidthFor(widths, entry.route), hibernated: hibernated.has(entry.id),
  })), [stack, widths, hibernated])
  return {
    panels,
    activeId,
    open: React.useCallback((route: string, opts?: { replace?: boolean }) => { openScreen({ route: route as ViewRoute, replace: opts?.replace }) }, [openScreen]),
    close: closePanel,
    focus: setFocused,
    resize: React.useCallback((id: string, width: number) => {
      const entry = store.get(panelStackAtom).find((panel) => panel.id === id)
      if (entry) setWidth({ route: entry.route, width })
    }, [store, setWidth]),
  }
}

/**
 * Per-screen pause policy. Default: only HEAVY_PANEL_TYPES pause. A screen
 * calls `usePanelOptions('<screenKey>', { hibernate: false })` to opt out
 * (e.g. a live call) or `{ hibernate: true }` to opt in. The registration lives
 * while the screen is mounted.
 */
export interface PanelOptions { hibernate?: boolean }
export const panelOptionsAtom = atom<Readonly<Record<string, PanelOptions>>>({})
const setPanelOptionsAtom = atom(null, (get, set, { key, options }: { key: string; options: PanelOptions | null }) => {
  const next = { ...get(panelOptionsAtom) }
  if (options) next[key] = options
  else delete next[key]
  set(panelOptionsAtom, next)
})
export function usePanelOptions(screenKey: string, options: PanelOptions): void {
  const set = useSetAtom(setPanelOptionsAtom)
  const hibernate = options.hibernate
  React.useEffect(() => {
    set({ key: screenKey, options: { hibernate } })
    return () => set({ key: screenKey, options: null })
  }, [set, screenKey, hibernate])
}
export function canHibernate(entry: Pick<PanelStackEntry, 'route' | 'panelType'>, options: Readonly<Record<string, PanelOptions>>): boolean {
  const own = options[stripScreenKey(entry.route)]?.hibernate
  return own ?? HEAVY_PANEL_TYPES.has(entry.panelType)
}

/** Ids of panels currently hibernated (unmounted while off-screen). */
export const hibernatedPanelIdsAtom = atom<ReadonlySet<string>>(new Set<string>())

/**
 * Track which heavy panels have been fully off-screen for HIBERNATE_AFTER_MS.
 * The focused panel is never hibernated; a panel wakes as soon as any part of
 * it scrolls back into the viewport.
 */
export function useStripHibernation(viewport: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  const stack = useAtomValue(panelStackAtom)
  const focusedId = useAtomValue(focusedPanelIdAtom)
  const setHibernated = useSetAtom(hibernatedPanelIdsAtom)
  const options = useAtomValue(panelOptionsAtom)
  const heavyIds = React.useMemo(() => stack.filter((entry) => canHibernate(entry, options)).map((entry) => entry.id).join('|'), [stack, options])

  React.useEffect(() => {
    const root = viewport.current
    if (!enabled || !root || typeof IntersectionObserver === 'undefined' || !heavyIds) { setHibernated((prev) => prev.size ? new Set() : prev); return }
    const ids = new Set(heavyIds.split('|'))
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const wake = (id: string) => setHibernated((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        const id = (record.target as HTMLElement).dataset.panelId
        if (!id || !ids.has(id)) continue
        clearTimeout(timers.get(id)); timers.delete(id)
        if (record.isIntersecting || id === focusedId) { wake(id); continue }
        timers.set(id, setTimeout(() => setHibernated((prev) => { const next = new Set(prev); next.add(id); return next }), HIBERNATE_AFTER_MS))
      }
    }, { root, threshold: 0 })
    for (const element of root.querySelectorAll<HTMLElement>('[data-panel-id]')) if (ids.has(element.dataset.panelId ?? '')) observer.observe(element)
    // Drop ids of panels that left the stack or stopped being heavy.
    setHibernated((prev) => { const next = new Set([...prev].filter((id) => ids.has(id) && id !== focusedId)); return next.size === prev.size ? prev : next })
    return () => { observer.disconnect(); for (const timer of timers.values()) clearTimeout(timer) }
  }, [viewport, enabled, heavyIds, focusedId, setHibernated])
}

/** Bring the focused panel into view in the strip. */
export function useScrollFocusedIntoView(viewport: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  const focusedId = useAtomValue(focusedPanelIdAtom)
  React.useEffect(() => {
    if (!enabled || !focusedId) return
    const element = viewport.current?.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(focusedId)}"]`)
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [viewport, enabled, focusedId])
}

/** Open a screen through the strip (rail, pills, ⌘1…7): new panel on the left or focus the open one. */
export function useOpenScreen(): (route: string) => void {
  const openScreen = useSetAtom(openScreenPanelAtom)
  return React.useCallback((route: string) => { openScreen({ route: route as ViewRoute }) }, [openScreen])
}
