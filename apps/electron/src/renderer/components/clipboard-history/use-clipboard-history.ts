/**
 * Data hook for the Rox History surface. Owns list paging (50/page with
 * prefetch near the end), 150 ms search debounce, the stale-response generation
 * counter, the `onClipboardChanged` subscription, optimistic star/tag updates
 * with rollback, and the settings/tag-count/stats reads.
 *
 * The transport is `window.electronAPI` (wired by W0 in
 * `apps/electron/src/shared/types.ts`); this module never defines channels.
 */
import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type {
  ClipChangedPayload,
  ClipCounts,
  ClipEntryDetail,
  ClipEntrySummary,
  ClipListResult,
  ClipSettings,
  ClipStats,
  ClipTagCount,
} from '@rox/shared/clipboard-history'
import {
  CLIPBOARD_PAGE_SIZE,
  clipboardFiltersReducer,
  EMPTY_CLIPBOARD_FILTERS,
  type ClipboardFilterAction,
  type ClipboardFilters,
  type ClipboardTab,
} from './clipboard-history-model'

const EMPTY_COUNTS: ClipCounts = { total: 0, starred: 0, text: 0, image: 0 }
const SEARCH_DEBOUNCE_MS = 150

function isUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return /unavailable|capability_unavailable|not\s*available/i.test(`${code} ${message}`)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string' && error.message.trim()) return error.message
    if ('code' in error && typeof error.code === 'string') return error.code
  }
  return String(error)
}

export interface ClipboardHistoryController {
  filters: ClipboardFilters
  dispatch: React.Dispatch<ClipboardFilterAction>
  entries: ClipEntrySummary[]
  total: number
  counts: ClipCounts
  hasMore: boolean
  tagCounts: ClipTagCount[]
  stats: ClipStats | null
  settings: ClipSettings | null
  savingSettings: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  selectedId: number | null
  quickLookId: number | null
  detail: ClipEntryDetail | null
  quickLookLoading: boolean
  now: number
  setSelectedId: (id: number | null) => void
  refresh: () => void
  loadMore: () => void
  toggleStar: (entry: ClipEntrySummary) => void
  setTags: (id: number, tags: string[]) => void
  remove: (id: number) => void
  clear: (keepStarred: boolean) => void
  copy: (id: number) => void
  openQuickLook: (id: number) => void
  closeQuickLook: () => void
  updateSettings: (patch: Partial<ClipSettings>) => void
}

export function useClipboardHistory(): ClipboardHistoryController {
  const { t } = useTranslation()
  const [filters, dispatch] = React.useReducer(clipboardFiltersReducer, EMPTY_CLIPBOARD_FILTERS)
  const [debouncedQuery, setDebouncedQuery] = React.useState(filters.query)
  const [entries, setEntries] = React.useState<ClipEntrySummary[]>([])
  const [counts, setCounts] = React.useState<ClipCounts>(EMPTY_COUNTS)
  const [total, setTotal] = React.useState(0)
  const [hasMore, setHasMore] = React.useState(false)
  const [tagCounts, setTagCounts] = React.useState<ClipTagCount[]>([])
  const [stats, setStats] = React.useState<ClipStats | null>(null)
  const [settings, setSettings] = React.useState<ClipSettings | null>(null)
  const [savingSettings, setSavingSettings] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [quickLookId, setQuickLookId] = React.useState<number | null>(null)
  const [detail, setDetail] = React.useState<ClipEntryDetail | null>(null)
  const [quickLookLoading, setQuickLookLoading] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())

  const generation = React.useRef(0)
  const alive = React.useRef(true)
  const detailCache = React.useRef(new Map<number, ClipEntryDetail | null>())
  /** Latest quick-look id: late detail responses for a superseded id are ignored. */
  const activeQuickLookIdRef = React.useRef<number | null>(null)
  /** Depth the list has been paged to; a reload restores it instead of resetting. */
  const loadedDepthRef = React.useRef(0)
  /** At most one in-flight page request per generation. */
  const loadingMoreRef = React.useRef(false)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // ── search debounce ───────────────────────────────────────────────────────
  React.useEffect(() => {
    if (filters.query === debouncedQuery) return
    const timer = setTimeout(() => setDebouncedQuery(filters.query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters.query, debouncedQuery])

  // A filter or query change invalidates the accumulated pages: the next load
  // starts from the first page again.
  React.useEffect(() => {
    loadedDepthRef.current = CLIPBOARD_PAGE_SIZE
    setSelectedId(null)
  }, [debouncedQuery, filters.tab, filters.kind, filters.tag])

  const refreshAux = React.useCallback(async () => {
    const api = window.electronAPI
    if (!api?.getClipboardTagCounts) return
    try {
      const [nextTags, nextStats] = await Promise.all([
        api.getClipboardTagCounts(),
        api.getClipboardStats ? api.getClipboardStats() : Promise.resolve(null),
      ])
      if (!alive.current) return
      setTagCounts(nextTags ?? [])
      if (nextStats) setStats(nextStats)
    } catch {
      // Tag counts/stats are secondary: a failure must not blank the list.
    }
  }, [])

  const load = React.useCallback(async () => {
    const api = window.electronAPI
    if (typeof api?.listClipboardEntries !== 'function') {
      setUnavailable(true)
      setLoading(false)
      return
    }
    const request = ++generation.current
    const query = {
      q: debouncedQuery.trim() || undefined,
      kind: filters.kind,
      starredOnly: filters.tab === 'starred',
      tag: filters.tag ?? undefined,
    }
    // Restore the depth the user had paged to (a refresh must not collapse the
    // list back to its first page). Every request pages by a real `offset`
    // instead of growing `limit`, which the store clamps.
    const targetDepth = Math.max(loadedDepthRef.current, CLIPBOARD_PAGE_SIZE)
    try {
      const first: ClipListResult = await api.listClipboardEntries({
        ...query,
        limit: CLIPBOARD_PAGE_SIZE,
        offset: 0,
      })
      if (request !== generation.current || !alive.current) return
      const collected = [...first.entries]
      let hasMorePages = first.hasMore
      let counts = first.counts
      let total = first.total
      while (hasMorePages && collected.length < targetDepth) {
        const page: ClipListResult = await api.listClipboardEntries({
          ...query,
          limit: CLIPBOARD_PAGE_SIZE,
          offset: collected.length,
        })
        if (request !== generation.current || !alive.current) return
        if (page.entries.length === 0) { hasMorePages = false; break }
        collected.push(...page.entries)
        counts = page.counts
        total = page.total
        hasMorePages = page.hasMore && page.entries.length === CLIPBOARD_PAGE_SIZE
      }
      setEntries(collected)
      setCounts(counts)
      setTotal(total)
      setHasMore(hasMorePages)
      setError(null)
      setUnavailable(false)
      setNow(Date.now())
    } catch (cause) {
      if (request !== generation.current || !alive.current) return
      if (isUnavailableError(cause)) setUnavailable(true)
      else setError(errorText(cause))
    } finally {
      if (request === generation.current && alive.current) setLoading(false)
    }
  }, [debouncedQuery, filters.kind, filters.tab, filters.tag])

  React.useEffect(() => { void load() }, [load])

  const refreshRef = React.useRef<() => void>(() => {})
  React.useEffect(() => {
    refreshRef.current = () => { void load(); void refreshAux() }
  }, [load, refreshAux])

  React.useEffect(() => {
    const api = window.electronAPI
    if (typeof api?.onClipboardChanged !== 'function') return
    const dispose = api.onClipboardChanged((_payload: ClipChangedPayload) => refreshRef.current())
    return () => { if (typeof dispose === 'function') dispose() }
  }, [])

  React.useEffect(() => { void refreshAux() }, [refreshAux])

  React.useEffect(() => {
    const api = window.electronAPI
    if (typeof api?.getClipboardSettings !== 'function') return
    let cancelled = false
    void api.getClipboardSettings().then(
      (next) => { if (!cancelled) setSettings(next) },
      () => { /* settings stay null; the panel falls back to defaults */ },
    )
    return () => { cancelled = true }
  }, [])

  const refresh = React.useCallback(() => { void load(); void refreshAux() }, [load, refreshAux])

  const loadMore = React.useCallback(() => {
    if (!hasMore || loadingMoreRef.current) return
    const api = window.electronAPI
    if (typeof api?.listClipboardEntries !== 'function') return
    loadingMoreRef.current = true
    const request = generation.current
    // A real offset: the next page starts after everything already loaded.
    void api.listClipboardEntries({
      q: debouncedQuery.trim() || undefined,
      kind: filters.kind,
      starredOnly: filters.tab === 'starred',
      tag: filters.tag ?? undefined,
      limit: CLIPBOARD_PAGE_SIZE,
      offset: entries.length,
    }).then(
      (result: ClipListResult) => {
        if (request !== generation.current || !alive.current) return
        setEntries((prev) => {
          const seen = new Set(prev.map((entry) => entry.id))
          const next = [...prev]
          for (const entry of result.entries) {
            if (seen.has(entry.id)) continue
            seen.add(entry.id)
            next.push(entry)
          }
          return next
        })
        setCounts(result.counts)
        setTotal(result.total)
        // A short/empty page (or an explicit `hasMore: false`) ends the sentinel
        // honestly instead of looping on a flag that will never resolve.
        setHasMore(result.hasMore && result.entries.length === CLIPBOARD_PAGE_SIZE)
        setNow(Date.now())
      },
      () => { /* a failed page keeps the loaded list and the sentinel */ },
    ).finally(() => { loadingMoreRef.current = false })
  }, [hasMore, entries, debouncedQuery, filters.kind, filters.tab, filters.tag])

  // Keep the paging depth in step with what is actually on screen; a reload
  // (refresh / clipboard change) restores it instead of collapsing to page one.
  React.useEffect(() => {
    loadedDepthRef.current = Math.max(entries.length, CLIPBOARD_PAGE_SIZE)
  }, [entries.length])

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // ── optimistic mutations ──────────────────────────────────────────────────
  const toggleStar = React.useCallback((entry: ClipEntrySummary) => {
    const api = window.electronAPI
    if (typeof api?.setClipboardEntryStarred !== 'function') return
    const next = !entry.starred
    const beforeEntries = entries
    const beforeCounts = counts
    const starredOnly = filters.tab === 'starred'
    setEntries((list) => {
      if (starredOnly && !next) return list.filter((item) => item.id !== entry.id)
      return list.map((item) => (item.id === entry.id ? { ...item, starred: next } : item))
    })
    setCounts((current) => ({ ...current, starred: Math.max(0, current.starred + (next ? 1 : -1)) }))
    if (starredOnly && !next) setTotal((value) => Math.max(0, value - 1))
    void api.setClipboardEntryStarred(entry.id, next).then(
      () => { void refreshAux() },
      () => {
        if (!alive.current) return
        setEntries(beforeEntries)
        setCounts(beforeCounts)
        toast.error(t('clipboard.error'))
        void load()
      },
    )
  }, [entries, counts, filters.tab, refreshAux, load, t])

  const setTags = React.useCallback((id: number, tags: string[]) => {
    const api = window.electronAPI
    if (typeof api?.setClipboardEntryTags !== 'function') return
    const beforeEntries = entries
    const beforeDetail = detail
    setEntries((list) => list.map((item) => (item.id === id ? { ...item, tags } : item)))
    setDetail((current) => (current && current.id === id ? { ...current, tags } : current))
    void api.setClipboardEntryTags(id, tags).then(
      () => { void refreshAux() },
      () => {
        if (!alive.current) return
        setEntries(beforeEntries)
        setDetail(beforeDetail)
        toast.error(t('clipboard.error'))
      },
    )
  }, [entries, detail, refreshAux, t])

  const remove = React.useCallback((id: number) => {
    const api = window.electronAPI
    if (typeof api?.deleteClipboardEntry !== 'function') return
    void api.deleteClipboardEntry(id).then(
      () => {
        if (!alive.current) return
        detailCache.current.delete(id)
        setEntries((list) => list.filter((item) => item.id !== id))
        setTotal((value) => Math.max(0, value - 1))
        setSelectedId((current) => (current === id ? null : current))
        if (activeQuickLookIdRef.current === id) { activeQuickLookIdRef.current = null; setDetail(null) }
        setQuickLookId((current) => (current === id ? null : current))
        toast.success(t('clipboard.deleted'))
        void refreshAux()
      },
      () => { if (alive.current) toast.error(t('clipboard.error')) },
    )
  }, [refreshAux, t])

  const clear = React.useCallback((keepStarred: boolean) => {
    const api = window.electronAPI
    if (typeof api?.clearClipboardHistory !== 'function') return
    void api.clearClipboardHistory(keepStarred).then(
      (result) => {
        if (!alive.current) return
        toast.success(t('clipboard.cleared', { count: result.removed }))
        setSelectedId(null)
        activeQuickLookIdRef.current = null
        setQuickLookId(null)
        detailCache.current.clear()
        void load()
        void refreshAux()
      },
      () => { if (alive.current) toast.error(t('clipboard.error')) },
    )
  }, [load, refreshAux, t])

  const copy = React.useCallback((id: number) => {
    const api = window.electronAPI
    if (typeof api?.copyClipboardEntry !== 'function') return
    void api.copyClipboardEntry(id).then(
      () => { if (alive.current) toast.success(t('clipboard.copied')) },
      () => { if (alive.current) toast.error(t('clipboard.error')) },
    )
  }, [t])

  const openQuickLook = React.useCallback((id: number) => {
    activeQuickLookIdRef.current = id
    setQuickLookId(id)
    const cached = detailCache.current.get(id)
    if (cached !== undefined) { setDetail(cached); setQuickLookLoading(false); return }
    // Drop the previous entry's detail so the modal never shows a stale record
    // while the requested one is in flight.
    setDetail(null)
    const api = window.electronAPI
    if (typeof api?.getClipboardEntry !== 'function') { setQuickLookLoading(false); return }
    setQuickLookLoading(true)
    void api.getClipboardEntry(id).then(
      (result) => {
        detailCache.current.set(id, result)
        if (!alive.current || activeQuickLookIdRef.current !== id) return
        setDetail(result)
        setQuickLookLoading(false)
      },
      () => {
        if (!alive.current || activeQuickLookIdRef.current !== id) return
        setDetail(null)
        setQuickLookLoading(false)
      },
    )
  }, [])

  const closeQuickLook = React.useCallback(() => {
    activeQuickLookIdRef.current = null
    setQuickLookId(null)
    setDetail(null)
    setQuickLookLoading(false)
  }, [])

  const updateSettings = React.useCallback((patch: Partial<ClipSettings>) => {
    const api = window.electronAPI
    if (typeof api?.saveClipboardSettings !== 'function') return
    setSavingSettings(true)
    void api.saveClipboardSettings(patch).then(
      (next) => {
        if (!alive.current) return
        setSettings(next)
        setSavingSettings(false)
        toast.success(t('clipboard.settings.saved'))
      },
      () => {
        if (!alive.current) return
        setSavingSettings(false)
        toast.error(t('clipboard.error'))
      },
    )
  }, [t])

  return {
    filters,
    dispatch,
    entries,
    total,
    counts,
    hasMore,
    tagCounts,
    stats,
    settings,
    savingSettings,
    loading,
    error,
    unavailable,
    selectedId,
    quickLookId,
    detail,
    quickLookLoading,
    now,
    setSelectedId,
    refresh,
    loadMore,
    toggleStar,
    setTags,
    remove,
    clear,
    copy,
    openQuickLook,
    closeQuickLook,
    updateSettings,
  }
}

export type { ClipboardTab }