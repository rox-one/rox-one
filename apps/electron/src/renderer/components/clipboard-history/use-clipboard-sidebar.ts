import * as React from 'react'
import { RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClipEntrySummary } from '@rox/shared/clipboard-history'
import { useScreenSidebar, type ScreenSidebarConfig } from '@/components/shell/screen-sidebar'
import type { ClipboardHistoryController } from './use-clipboard-history'
import { buildClipboardSidebarGroups, PINNED_LIMIT, RECENT_FETCH, startOfLocalDay } from './clipboard-sidebar'

interface SidebarWindow {
  pinned: ClipEntrySummary[]
  recent: ClipEntrySummary[]
  more: { pinned: boolean; recent: boolean }
  loading: boolean
  error: string | null
}

const EMPTY_WINDOW: SidebarWindow = { pinned: [], recent: [], more: { pinned: false, recent: false }, loading: true, error: null }

/**
 * Unfiltered pinned + recent windows for the sidebar. Independent of the
 * panel's search/kind/tab/tag filters; refetches on every clipboard change.
 */
function useSidebarWindow(enabled: boolean): SidebarWindow & { reload(): void } {
  const [state, setState] = React.useState<SidebarWindow>(EMPTY_WINDOW)
  const gen = React.useRef(0)
  const reload = React.useCallback(() => {
    const api = window.electronAPI
    if (!enabled || typeof api?.listClipboardEntries !== 'function') return
    const request = ++gen.current
    setState((s) => ({ ...s, loading: true }))
    void Promise.all([
      api.listClipboardEntries({ starredOnly: true, limit: PINNED_LIMIT + 1, offset: 0 }),
      api.listClipboardEntries({ limit: RECENT_FETCH + PINNED_LIMIT + 1, offset: 0 }),
    ]).then(([pinned, recent]) => {
      if (request !== gen.current) return
      const unpinned = recent.entries.filter((e) => !e.starred)
      setState({
        pinned: pinned.entries.slice(0, PINNED_LIMIT),
        recent: unpinned.slice(0, RECENT_FETCH),
        more: { pinned: pinned.entries.length > PINNED_LIMIT, recent: unpinned.length > RECENT_FETCH || recent.hasMore },
        loading: false,
        error: null,
      })
    }, (cause: unknown) => {
      if (request !== gen.current) return
      setState((s) => ({ ...s, loading: false, error: cause instanceof Error ? cause.message : String(cause) }))
    })
  }, [enabled])
  React.useEffect(() => {
    reload()
    const api = window.electronAPI
    if (!enabled || typeof api?.onClipboardChanged !== 'function') return undefined
    return api.onClipboardChanged(() => reload())
  }, [enabled, reload])
  return { ...state, reload }
}

/** Select → scroll the card into view and move focus to it (Space then opens Quick Look). */
export function focusEntryCard(id: number, root?: ParentNode | null): void {
  if (typeof requestAnimationFrame !== 'function') return
  // Two frames: the first lets a widened filter re-render the list.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const card = (root ?? document).querySelector<HTMLElement>(`[data-testid="clipboard-card"][data-entry-id="${id}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'nearest' })
    card.focus({ preventScroll: true })
  }))
}

/** Publishes the Буфер обмена second sidebar, bound to the live controller. */
export function useClipboardSidebar(
  h: ClipboardHistoryController,
  actions: { openSettings(): void; openClear(): void; rootRef?: React.RefObject<HTMLElement | null> },
): void {
  const { t } = useTranslation()
  const { setSelectedId, dispatch, refresh } = h
  const { openSettings, openClear, rootRef } = actions
  const win = useSidebarWindow(!h.unavailable)
  const { reload } = win
  // Latest-ref callbacks: controller callbacks change with filters, groups must not.
  const latest = React.useRef({ refresh, reload })
  latest.current = { refresh, reload }
  const retry = React.useCallback(() => { latest.current.refresh(); latest.current.reload() }, [])
  const historyEmpty = h.counts.total === 0 && win.pinned.length + win.recent.length === 0
  const dayStart = startOfLocalDay(h.now)
  const { entries } = h
  const entriesRef = React.useRef(entries)
  entriesRef.current = entries
  const openEntry = React.useCallback((id: number, starred: boolean) => {
    // The entry may be filtered out of the panel list: widen to the unfiltered tab first.
    if (!entriesRef.current.some((e) => e.id === id)) {
      dispatch({ type: 'tab', tab: starred ? 'starred' : 'history' })
      dispatch({ type: 'reset' })
    }
    setSelectedId(id)
    // Scoped to this panel so a retained (keep-alive) clipboard panel is never targeted.
    focusEntryCard(id, rootRef?.current)
  }, [dispatch, setSelectedId, rootRef])
  const starredIds = React.useMemo(() => new Set(win.pinned.map((e) => e.id)), [win.pinned])
  const labels = React.useMemo(() => ({
    pinned: t('screenSidebar.clipboard.pinned'),
    today: t('screenSidebar.clipboard.today'),
    earlier: t('screenSidebar.clipboard.earlier'),
    types: t('screenSidebar.clipboard.types'),
    image: t('screenSidebar.clipboard.image'),
    text: t('screenSidebar.clipboard.text'),
    images: t('screenSidebar.clipboard.images'),
    empty: t('screenSidebar.clipboard.empty'),
    error: t('screenSidebar.clipboard.error'),
    unavailable: t('screenSidebar.clipboard.unavailable'),
    enable: t('screenSidebar.clipboard.enable'),
    showAll: t('screenSidebar.clipboard.showAll'),
    retry: t('screenSidebar.clipboard.retry'),
  }), [t])
  const panelError = h.error
  const { counts, selectedId, unavailable } = h
  const activeKind = h.filters.kind
  // Groups do not depend on the query or the minute tick: typing in search or
  // the clock only rebuilds the (cheap) config shell, not the groups.
  const groups = React.useMemo(() => buildClipboardSidebarGroups({
    pinned: win.pinned,
    recent: win.recent,
    more: win.more,
    unavailable,
    counts,
    dayStart,
    panelAlerting: panelError !== null,
    selectedId,
    activeKind,
    loading: win.loading,
    error: win.error ?? panelError,
    labels,
    onOpenEntry: (id) => openEntry(id, starredIds.has(id)),
    onFilterKind: (kind) => dispatch({ type: 'kind', kind }),
    onRetry: retry,
    onOpenSettings: openSettings,
    onShowAll: (tab) => { dispatch({ type: 'tab', tab }); dispatch({ type: 'reset' }) },
  }), [win.pinned, win.recent, win.more, win.loading, win.error, unavailable, counts, dayStart, panelError, selectedId, activeKind, labels, openEntry, starredIds, dispatch, retry, openSettings])
  const query = h.filters.query
  const config = React.useMemo<ScreenSidebarConfig>(() => ({
    screenId: 'clipboard',
    title: t('clipboard.title'),
    search: {
      placeholder: t('clipboard.search.placeholder'),
      value: query,
      onChange: (next: string) => dispatch({ type: 'query', query: next }),
    },
    headerActions: [
      { id: 'refresh', label: t('clipboard.action.refresh'), icon: RefreshCw, disabled: unavailable, onSelect: retry },
      { id: 'settings', label: t('clipboard.action.settings'), icon: Settings, onSelect: openSettings },
      { id: 'clear', label: t('clipboard.action.clearAll'), icon: Trash2, destructive: true, disabled: unavailable || historyEmpty, onSelect: openClear },
    ],
    groups,
  }), [groups, query, unavailable, historyEmpty, t, dispatch, retry, openSettings, openClear])
  useScreenSidebar(config)
}
