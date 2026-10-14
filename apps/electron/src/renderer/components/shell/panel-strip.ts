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
import { isLiteActive } from '@/lib/lite-mode'

export const STRIP_MIN_WIDTH = 320
export const STRIP_MAX_WIDTH = 1400
export const STRIP_DEFAULT_WIDTH = 640
export const HIBERNATE_AFTER_MS = 30_000
/** Lite / reduced-data mode pauses off-screen heavy panels sooner. */
export const HIBERNATE_AFTER_MS_LITE = 5_000
/**
 * Panel types whose host keeps instance state outside React (unmount is safe).
 * Only the browser qualifies: BrowserPanelPage persists and unmount just
 * detaches the native view. Knowledge keeps query/hits/scroll/diff review
 * state in React, so it is never hibernated.
 */
export const HEAVY_PANEL_TYPES: ReadonlySet<PanelType> = new Set(['browser'])
/** Maximum open screen panels; past this the least recently focused non-pinned one closes. */
export const MAX_OPEN_PANELS = 12

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
export const setStripWidthAtom = atom(null, (get, set, { route, width, persist = true }: { route: string; width: number; persist?: boolean }) => {
  const next = { ...get(stripWidthsAtom), [stripScreenKey(route)]: clampStripWidth(width) }
  set(stripWidthsAtom, next)
  if (persist) storage.set(storage.KEYS.shellPanels, { widths: next })
})
/** Write the current widths to storage (used on resize pointerup). */
export const persistStripWidthsAtom = atom(null, (get) => {
  storage.set(storage.KEYS.shellPanels, { widths: get(stripWidthsAtom) })
})

/** Panel ids the user pinned in the strip; never auto-closed by the cap. */
export const pinnedPanelIdsAtom = atom<ReadonlySet<string>>(new Set<string>())
/** Last focus time per panel id (LRU for the open-panel cap). */
export const panelFocusTimesAtom = atom<Record<string, number>>({})
let focusClock = 0
export const nextFocusTick = (): number => (focusClock = Math.max(Date.now(), focusClock + 1))
/** Focus a panel and record it for LRU. */
export const focusStripPanelAtom = atom(null, (get, set, id: string) => {
  set(panelFocusTimesAtom, { ...get(panelFocusTimesAtom), [id]: nextFocusTick() })
  set(focusedPanelIdAtom, id)
})

export function stripWidthFor(widths: Widths, route: string): number {
  return widths[stripScreenKey(route)] ?? STRIP_DEFAULT_WIDTH
}

/**
 * Open a screen: focus the panel already showing that screen (its current,
 * possibly deep, route and state are kept), otherwise insert a new panel at
 * index 0 (previous panels shift right). At most MAX_OPEN_PANELS screen panels
 * stay open; past that the least recently focused non-pinned one closes.
 * `replace` swaps the focused panel's route instead (sidebar-style navigation).
 */
export const openScreenPanelAtom = atom(null, (get, set, { route, replace }: { route: ViewRoute; replace?: boolean }): string => {
  const stack = get(panelStackAtom)
  const key = stripScreenKey(route)
  const existing = stack.find((entry) => !entry.tool && (entry.route === route || stripScreenKey(entry.route) === key))
  if (existing) {
    set(focusStripPanelAtom, existing.id)
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
  let next = [entry, ...stack.map((panel) => ({ ...panel, proportion: panel.proportion * (1 - share) }))]
  const pinned = get(pinnedPanelIdsAtom)
  const times = get(panelFocusTimesAtom)
  const evicted: string[] = []
  for (;;) {
    const screens = next.filter((panel) => !panel.tool)
    if (screens.length <= MAX_OPEN_PANELS) break
    const victim = screens
      .filter((panel) => panel.id !== entry.id && !pinned.has(panel.id))
      .sort((a, b) => (times[a.id] ?? 0) - (times[b.id] ?? 0))[0]
    if (!victim) break
    evicted.push(victim.id)
    next = next.filter((panel) => panel.id !== victim.id)
  }
  if (evicted.length) {
    const total = next.reduce((sum, panel) => sum + panel.proportion, 0) || 1
    next = next.map((panel) => ({ ...panel, proportion: panel.proportion / total }))
    const restTimes = { ...times }
    for (const id of evicted) delete restTimes[id]
    set(panelFocusTimesAtom, restTimes)
  }
  set(panelStackAtom, next)
  set(focusStripPanelAtom, entry.id)
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
  const setFocused = useSetAtom(focusStripPanelAtom)
  const setWidth = useSetAtom(setStripWidthAtom)
  const persistWidths = useSetAtom(persistStripWidthsAtom)
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
    resize: React.useCallback((id: string, width: number, opts?: { persist?: boolean }) => {
      const entry = store.get(panelStackAtom).find((panel) => panel.id === id)
      if (entry) setWidth({ route: entry.route, width, persist: opts?.persist })
    }, [store, setWidth]),
    persistWidths,
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
        timers.set(id, setTimeout(() => setHibernated((prev) => { const next = new Set(prev); next.add(id); return next }), isLiteActive() ? HIBERNATE_AFTER_MS_LITE : HIBERNATE_AFTER_MS))
      }
    }, { root, threshold: 0 })
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-panel-id]'))) if (ids.has(element.dataset.panelId ?? '')) observer.observe(element)
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
