/**
 * Лента — feed aggregator with four tabs: «Действия агентов» (sessions +
 * automation runs), «Команда» (local-first team activity; honest state when
 * there is no org), «Новости» (user sources polled in the background:
 * RSS/Atom → autodiscovery → page diff) and «Подписки» (X home timeline via
 * the official API with a user token — never browser cookies). Data comes
 * from the feed:list server aggregator; «Источники ленты» is a gallery of
 * source cards with a preview-before-save add flow.
 *
 * Items carry user labels persisted in feed-state (feed:items:annotate):
 * color, free-form tags, star and read state. The toolbar filters by color,
 * tag, source, type and text, sorts newest/oldest with a per-day override,
 * and switches list/cards density. The reading pane sends items to Tasks
 * and Notes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useStore } from 'jotai'
import {
  FEED_TABS,
  type FeedAnnotationPatch,
  type FeedColor,
  type FeedItemAnnotation,
  type FeedListResult,
  type FeedTab,
  type XConnectionStatus,
} from '@rox/shared/feed'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CheckCheck,
  ExternalLink,
  LayoutGrid,
  List as ListIcon,
  ListTodo,
  NotebookPen,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { usePanelKeyboardGuard } from '@/lib/usePanelKeyboardGuard'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '@/lib/open-workspace-tool'
import { workspaceProjectContextsAtom } from '@/atoms/workspace-context'
import { cn } from '@/lib/utils'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAutomations } from '@/hooks/useAutomations'
import { useTeamState } from '@/components/team/team-store'
import { useTeamRoster } from '@/components/team/use-team-roster'
import { activityText } from '@/components/team/team-labels'
import { createPersonalTask } from '@/lib/extra-screens/personal-task-bridge'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ModeScreenLayout,
  SectionLabel,
  useListKeys,
  type Tone,
} from '@/components/mode-screen/ModeScreen'
import {
  TAB_CHIPS,
  applyAnnotations,
  attentionCount,
  buildTeamItems,
  filterView,
  groupOrdered,
  sourceLabel,
  suggestTags,
  tabCounts,
  tagsInUse,
  visibleMarkCounts,
  type FeedChip,
  type FeedMark,
  type FeedOrder,
  type FeedViewItem,
} from './feed/feed-model'
import { ColorFilter, ColorPicker, FEED_COLOR_HEX, SourceIcon, TagChip, TagEditor } from './feed/FeedParts'
import { SourceEditor, SourcesView } from './feed/FeedSources'
import { FeedSidebar, type FeedView } from './feed/FeedSidebar'

type View = FeedView
type Density = 'list' | 'cards'

const KIND_GLYPH: Record<FeedViewItem['kind'], string> = {
  session: '◧',
  'automation-run': '↻',
  'team-activity': '☺',
  news: '▤',
  'page-change': '△',
  'x-post': '𝕏',
}

const STATUS_TONE: Record<NonNullable<FeedViewItem['status']>, Tone> = {
  ok: 'success',
  error: 'danger',
  running: 'accent',
  waiting: 'warning',
}

const EMPTY: FeedListResult = { items: [], sources: [], x: { state: 'not-connected' }, generatedAt: 0, annotations: {} }
const PREFS_KEY = 'rox.feed.view.v1'
/** Read/unread styling only makes sense for external content. */
const READABLE_TABS: ReadonlySet<FeedTab> = new Set(['news', 'subscriptions'])
const STAR = FEED_COLOR_HEX.yellow

interface FeedPagePrefs {
  view: View
  chip: FeedChip
  sourceFilter: string | null
  query: string
  colors: FeedColor[]
  tagFilter: string | null
  mark: FeedMark
  order: FeedOrder
  density: Density
}

function prefsKey(workspaceId: string | null): string {
  return `${PREFS_KEY}:${workspaceId ?? 'unscoped'}`
}

function loadPrefs(workspaceId: string | null): FeedPagePrefs {
  const defaults: FeedPagePrefs = {
    view: 'agents', chip: 'all', sourceFilter: null, query: '', colors: [], tagFilter: null,
    mark: 'all', order: 'newest', density: 'list',
  }
  try {
    const raw = localStorage.getItem(prefsKey(workspaceId))
    const legacy = raw === null && workspaceId ? localStorage.getItem(PREFS_KEY) : null
    const stored = JSON.parse(raw ?? legacy ?? '{}') as Partial<FeedPagePrefs>
    const storedView = stored.view
    const chips = Object.values(TAB_CHIPS).flat()
    return {
      view: storedView === 'sources' ? 'sources' : FEED_TABS.includes(storedView as FeedTab) ? storedView as FeedTab : defaults.view,
      chip: chips.includes(stored.chip as FeedChip) ? stored.chip as FeedChip : defaults.chip,
      sourceFilter: typeof stored.sourceFilter === 'string' ? stored.sourceFilter : null,
      query: typeof stored.query === 'string' ? stored.query : '',
      colors: Array.isArray(stored.colors) ? stored.colors.filter((color): color is FeedColor => color in FEED_COLOR_HEX) : [],
      tagFilter: typeof stored.tagFilter === 'string' ? stored.tagFilter : null,
      mark: stored.mark === 'unread' || stored.mark === 'starred' ? stored.mark : defaults.mark,
      order: stored.order === 'oldest' ? 'oldest' : defaults.order,
      density: stored.density === 'cards' ? 'cards' : defaults.density,
    }
  } catch {
    return defaults
  }
}

const INPUT = 'h-7 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]'

export default function FeedPage({ selectedId }: { selectedId?: string | null }) {
  const { t, i18n } = useTranslation()
  const canHandleKeyboard = usePanelKeyboardGuard()
  const shell = useOptionalAppShellContext()
  const store = useStore()
  const workspaceId = shell?.activeWorkspaceId ?? null
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined

  const [data, setData] = useState<FeedListResult>(EMPTY)
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null | undefined>()
  const [sourceDataWorkspaceId, setSourceDataWorkspaceId] = useState<string | null | undefined>()
  const loaded = loadedWorkspaceId !== undefined && loadedWorkspaceId === workspaceId
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialPrefs] = useState(() => loadPrefs(workspaceId))
  const [view, setView] = useState<View>(initialPrefs.view)
  const [chip, setChip] = useState<FeedChip>(initialPrefs.chip)
  const [sourceFilter, setSourceFilter] = useState<string | null>(initialPrefs.sourceFilter)
  const [query, setQuery] = useState(initialPrefs.query)
  const [colors, setColors] = useState<ReadonlySet<FeedColor>>(() => new Set(initialPrefs.colors))
  const [tagFilter, setTagFilter] = useState<string | null>(initialPrefs.tagFilter)
  const [mark, setMark] = useState<FeedMark>(initialPrefs.mark)
  const [prefs, setPrefs] = useState(() => ({ order: initialPrefs.order, density: initialPrefs.density }))
  const [prefsWorkspaceId, setPrefsWorkspaceId] = useState(workspaceId)
  const [perDay, setPerDay] = useState<Record<string, FeedOrder>>({})
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ itemId: string; kind: 'task' | 'note'; id: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setData(EMPTY)
    setLoadedWorkspaceId(undefined)
    setSourceDataWorkspaceId(undefined)
    setLoadError(null)
    const stored = loadPrefs(workspaceId)
    setView(stored.view)
    setChip(stored.chip)
    setSourceFilter(stored.sourceFilter)
    setQuery(stored.query)
    setColors(new Set(stored.colors))
    setTagFilter(stored.tagFilter)
    setMark(stored.mark)
    setPrefs({ order: stored.order, density: stored.density })
    setPerDay({})
    setPrefsWorkspaceId(workspaceId)
  }, [workspaceId])

  useEffect(() => {
    if (prefsWorkspaceId !== workspaceId) return
    try {
      localStorage.setItem(prefsKey(workspaceId), JSON.stringify({
        view, chip, sourceFilter, query, colors: [...colors], tagFilter, mark, ...prefs,
      }))
    } catch { /* private mode */ }
  }, [workspaceId, prefsWorkspaceId, view, chip, sourceFilter, query, colors, tagFilter, mark, prefs])

  const routeBound = selectedId !== undefined
  const currentId = routeBound ? selectedId ?? null : localSelected
  const select = useCallback((id: string | null) => {
    if (routeBound) navigate(routes.view.feed(id ?? undefined))
    else setLocalSelected(id)
  }, [routeBound])

  // ── data ─────────────────────────────────────────────────────────────────
  const loadGeneration = useRef(0)
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    if (!api?.feedList) {
      setLoadedWorkspaceId(workspaceId)
      setLoadError('unavailable')
      return
    }
    try {
      const res = await api.feedList(workspaceId)
      if (generation !== loadGeneration.current) return
      setData(res ?? EMPTY)
      setSourceDataWorkspaceId(workspaceId)
      setLoadError(null)
    } catch (e) {
      if (generation === loadGeneration.current) setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      if (generation === loadGeneration.current) {
        setLoadedWorkspaceId(workspaceId)
        setNow(Date.now())
      }
    }
  }, [api, workspaceId])

  useEffect(() => {
    void load()
    return () => { loadGeneration.current++ }
  }, [load])
  useEffect(() => api?.onFeedChanged?.(() => { void load() }), [api, load])
  useEffect(() => {
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (loaded && sourceDataWorkspaceId === workspaceId && sourceFilter && !data.sources.some((source) => source.id === sourceFilter)) setSourceFilter(null)
  }, [loaded, sourceDataWorkspaceId, workspaceId, sourceFilter, data.sources])
  // Session activity changes → debounced re-aggregate.
  const sessionMap = useAtomValue(sessionMetaMapAtom)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(), 1500)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [sessionMap, load])

  // Team («Команда») — renderer-side local-first store.
  const team = useTeamState()
  const roster = useTeamRoster()
  const teamItems = useMemo(
    () => buildTeamItems(team.activity ?? [], (e) => activityText(e, roster.members, roster.selfUserId, t)),
    [team.activity, roster.members, roster.selfUserId, t],
  )
  const sourceById = useMemo(() => new Map(data.sources.map((s) => [s.id, s])), [data.sources])
  const annotations = data.annotations
  const allItems = useMemo(
    () => applyAnnotations([...data.items, ...teamItems], annotations ?? {}, sourceById),
    [data.items, teamItems, annotations, sourceById],
  )

  const automations = useAutomations(workspaceId)
  const automationNames = useMemo(() => new Map(automations.automations.map((a) => [a.id, a.name])), [automations.automations])

  const tab: FeedTab = view === 'sources' ? 'news' : view
  const readable = READABLE_TABS.has(tab)
  const counts = useMemo(() => tabCounts(allItems), [allItems])
  const attention = useMemo(() => attentionCount(allItems), [allItems])
  const tabItems = useMemo(() => allItems.filter((i) => i.tab === tab), [allItems, tab])
  const tabTags = useMemo(() => tagsInUse(tabItems), [tabItems])
  const visible = useMemo(
    () => filterView(allItems, { tab, chip, sourceId: tab === 'news' ? sourceFilter : null, query, colors, tag: tagFilter, mark }, now, data.sources),
    [allItems, tab, chip, sourceFilter, query, colors, tagFilter, mark, now, data.sources],
  )
  const colorCounts = useMemo(() => {
    const out: Partial<Record<FeedColor, number>> = {}
    for (const i of visible) if (i.color) out[i.color] = (out[i.color] ?? 0) + 1
    return out
  }, [visible])
  const visibleCounts = useMemo(() => visibleMarkCounts(visible), [visible])
  const unreadCount = readable ? visibleCounts.unread : 0
  const starredCount = visibleCounts.starred
  const groups = useMemo(() => groupOrdered(visible, now, prefs.order, perDay), [visible, now, prefs.order, perDay])
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const selected = useMemo(() => allItems.find((i) => i.id === currentId) ?? null, [allItems, currentId])
  const suggestions = useMemo(() => suggestTags(allItems, data.sources, [], 10, t('feed.tags.defaults').split(',').map((x) => x.trim()).filter(Boolean)), [allItems, data.sources, t])
  const filtersActive = !!(query || chip !== 'all' || sourceFilter || colors.size || tagFilter || mark !== 'all')

  const locale = i18n.resolvedLanguage || i18n.language
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }), [locale])
  const longFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), [locale])
  const when = useCallback((at: number) => (new Date(at).toDateString() === new Date(now).toDateString() ? timeFmt.format(at) : dateFmt.format(at)), [now, timeFmt, dateFmt])

  const resetFilters = () => { setChip('all'); setQuery(''); setSourceFilter(null); setColors(new Set()); setTagFilter(null); setMark('all') }
  const switchView = (next: View) => {
    setView(next)
    setChip('all')
    setActionError(null)
    setTagFilter(null)
    setMark('all')
    if (next !== 'news') setSourceFilter(null)
  }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Optimistic annotations: apply locally, persist, feed:changed reloads.
  const annotate = useCallback((ids: string[], patch: FeedAnnotationPatch) => {
    if (!ids.length) return
    setData((d) => {
      const next: Record<string, FeedItemAnnotation> = { ...(d.annotations ?? {}) }
      for (const id of ids) {
        const cur: FeedItemAnnotation = { ...(next[id] ?? {}) }
        if (patch.tags !== undefined) { if (patch.tags.length) cur.tags = patch.tags; else delete cur.tags }
        if (patch.color === null) delete cur.color
        else if (patch.color) cur.color = patch.color
        if (patch.starred !== undefined) { if (patch.starred) cur.starred = true; else delete cur.starred }
        if (patch.read === true) cur.readAt = cur.readAt ?? Date.now()
        else if (patch.read === false) delete cur.readAt
        if (Object.keys(cur).length) next[id] = cur
        else delete next[id]
      }
      return { ...d, annotations: next }
    })
    if (api?.feedAnnotate) void api.feedAnnotate(ids, patch).catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
  }, [api])

  // Opening an item in the reading pane marks it read (external content only).
  useEffect(() => {
    if (selected && READABLE_TABS.has(selected.tab) && !selected.read) {
      const id = selected.id
      const timer = setTimeout(() => annotate([id], { read: true }), 600)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const titleOf = (item: FeedViewItem) => {
    if (item.kind === 'automation-run' && item.automationId && automationNames.get(item.automationId)) return automationNames.get(item.automationId)!
    return item.title || (item.kind === 'session' ? t('feed.untitledSession') : item.url ?? '')
  }

  const openAutomation = (automationId: string) => {
    if (!workspaceId) return
    const rule = automations.automations.find(item => item.id === automationId)
    const projectId = rule?.context?.projectId ?? store.get(workspaceProjectContextsAtom)[workspaceId] ?? undefined
    const intent = captureWorkspaceToolOpen(store, { workspaceId, projectId, tool: 'automations', originPanelId: shell?.panelId })
    if (intent) openWorkspaceTool(store, intent, routes.view.automations({ automationId }))
  }

  const openItem = (item: FeedViewItem) => {
    if (item.ref?.type === 'session' || (item.kind !== 'automation-run' && item.sessionId)) {
      navigate(routes.view.allSessions(item.sessionId ?? item.ref!.id))
    } else if (item.ref?.type === 'automation') {
      openAutomation(item.ref.id)
    } else if (item.url) {
      void api?.openUrl?.(item.url)
    }
  }

  const toTask = (item: FeedViewItem) => void run(`task:${item.id}`, async () => {
    const notes = [item.summary, item.url, item.sourceTitle ? t('feed.reader.fromSource', { source: item.sourceTitle }) : undefined].filter(Boolean).join('\n\n')
    const task = createPersonalTask({ title: titleOf(item).slice(0, 200), notes })
    setSent({ itemId: item.id, kind: 'task', id: task.id })
  })

  const toNote = (item: FeedViewItem) => void run(`note:${item.id}`, async () => {
    if (!workspaceId || !api?.createNote) throw new Error(t('feed.reader.noWorkspace'))
    const title = titleOf(item).replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || t('feed.title')
    const created = await api.createNote(workspaceId, title)
    const body = [
      created.content?.trimEnd() || `# ${title}`,
      item.summary ?? '',
      item.url ? `[${t('feed.reader.original')}](${item.url})` : '',
      [item.sourceTitle ?? item.author, dateFmt.format(item.at)].filter(Boolean).join(' · '),
      item.tags.length ? item.tags.map((x) => `#${x.replace(/\s+/g, '-')}`).join(' ') : '',
    ].filter(Boolean).join('\n\n')
    await api.saveNote(workspaceId, created.id, `${body}\n`)
    setSent({ itemId: item.id, kind: 'note', id: created.id })
  })

  const handleListKeys = useListKeys(ordered, selected && ordered.includes(selected) ? selected : null, (i) => select(i.id), openItem)
  const onListKeys: typeof handleListKeys = event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || !canHandleKeyboard(event.target)) return
    handleListKeys(event)
  }

  // ── navigator ────────────────────────────────────────────────────────────
  const xConnected = data.x.state === 'connected'
  const navigator = (
    <FeedSidebar
      view={view} sourceFilter={sourceFilter} tagFilter={tagFilter}
      sources={data.sources} tags={tabTags} counts={counts} visibleCount={visible.length} attention={attention}
      x={data.x} hasTeam={Boolean(roster.org)} teamName={roster.org ? roster.org.name ?? t('feed.nav.teamLocal') : t('feed.nav.teamNoOrg')}
      onViewSelect={(next) => { switchView(next); if (next !== 'sources') setSourceFilter(null) }}
      onSourceSelect={(id) => { switchView('news'); setSourceFilter(id) }}
      onTagSelect={setTagFilter}
    />
  )

  // ── list: feed tabs ──────────────────────────────────────────────────────
  const metaOf = (item: FeedViewItem) => {
    const src = item.sourceId ? sourceById.get(item.sourceId) : undefined
    return item.kind === 'automation-run'
      ? t('feed.kind.automation-run')
      : item.kind === 'session'
        ? t('feed.kind.session')
        : item.author ?? (src ? sourceLabel(src) : item.sourceTitle) ?? t(`feed.kind.${item.kind}`)
  }

  const leading = (item: FeedViewItem, size: number) => {
    const src = item.sourceId ? sourceById.get(item.sourceId) : undefined
    return src
      ? <SourceIcon source={src} size={size} />
      : <span aria-hidden className="grid shrink-0 place-items-center rounded-[6px] bg-foreground/[0.05] text-text-muted" style={{ width: size, height: size }}>{KIND_GLYPH[item.kind]}</span>
  }

  const starIcon = (on: boolean, cls = 'size-3') => <Star aria-hidden className={cn(cls, on && 'fill-current')} style={on ? { color: STAR } : undefined} />

  const row = (item: FeedViewItem) => {
    const unread = readable && !item.read
    const isSel = item.id === currentId
    const colorBar = item.color ? <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full" style={{ background: FEED_COLOR_HEX[item.color] }} /> : null
    const unreadDot = unread ? <span role="img" aria-label={t('feed.mark.unread')} className="size-1.5 shrink-0 rounded-full bg-accent" /> : null
    if (prefs.density === 'cards') {
      return (
        <div
          key={item.id}
          role="option"
          aria-selected={isSel}
          tabIndex={isSel ? 0 : -1}
          data-testid={`feed-row-${item.kind}`}
          data-color={item.color}
          onClick={() => select(item.id)}
          className={cn(
            'relative mx-2 mb-2 flex cursor-default gap-3 rounded-[8px] py-3 pl-4 pr-3 outline-none',
            isSel ? 'bg-foreground/[0.09] ring-2 ring-inset ring-accent' : 'bg-foreground/[0.04] hover:bg-foreground/[0.07]',
          )}
        >
          {colorBar}
          {leading(item, 28)}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-text-muted">
              {unreadDot}
              <span className="truncate">{metaOf(item)}</span>
              <span className="ml-auto shrink-0 tabular-nums">{when(item.at)}</span>
            </span>
            <span className={cn('line-clamp-2 text-[14px] leading-5', unread && 'font-semibold', item.status === 'error' && 'text-destructive')}>{titleOf(item)}</span>
            {item.summary ? <span className="line-clamp-3 text-[12px] leading-4 text-text-secondary">{item.summary}</span> : null}
            {item.tags.length || item.starred || (item.status && item.status !== 'ok') ? (
              <span className="flex min-w-0 flex-wrap items-center gap-1 pt-1">
                {item.starred ? <span role="img" aria-label={t('feed.mark.starred')}>{starIcon(true)}</span> : null}
                {item.status && item.status !== 'ok' ? <Badge tone={STATUS_TONE[item.status]}>{t(`feed.status.${item.status}`)}</Badge> : null}
                {item.tags.slice(0, 5).map((x) => <TagChip key={x} tag={x} muted={!item.ownTags.includes(x)} />)}
              </span>
            ) : null}
          </span>
        </div>
      )
    }
    return (
      <div
        key={item.id}
        role="option"
        aria-selected={isSel}
        tabIndex={isSel ? 0 : -1}
        data-testid={`feed-row-${item.kind}`}
        data-color={item.color}
        onClick={() => select(item.id)}
        className={cn(
          'relative mx-1 flex cursor-default items-start gap-2 rounded-[6px] py-2 pl-3 pr-2 outline-none',
          isSel ? 'bg-foreground/[0.08] ring-1 ring-inset ring-accent' : 'hover:bg-foreground/[0.04]',
        )}
      >
        {colorBar}
        {leading(item, 20)}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-text-muted">
            {unreadDot}
            <span className="truncate">{metaOf(item)}</span>
            {item.tags.slice(0, 2).map((x) => <span key={x} className="max-w-[96px] shrink-0 truncate">#{x}</span>)}
          </span>
          <span className={cn('block truncate text-[13px]', unread && 'font-semibold', item.status === 'error' && 'text-destructive')}>{titleOf(item)}</span>
          {item.summary ? <span className="block truncate text-[12px] text-text-secondary">{item.summary}</span> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] tabular-nums text-text-muted">{when(item.at)}</span>
          <span className="flex items-center gap-1">
            {item.starred ? <span role="img" aria-label={t('feed.mark.starred')}>{starIcon(true)}</span> : null}
            {item.status && item.status !== 'ok' ? <Badge tone={STATUS_TONE[item.status]}>{t(`feed.status.${item.status}`)}</Badge> : null}
          </span>
        </span>
      </div>
    )
  }

  const emptyForTab = () => {
    if (!loaded) return <EmptyState title={t('feed.loading')} />
    if (filtersActive) return <EmptyState testId="feed-empty" title={t('feed.empty.filteredTitle')} action={<Button onClick={resetFilters}>{t('feed.empty.resetFilters')}</Button>} />
    switch (tab) {
      case 'agents':
        return <EmptyState testId="feed-empty" title={t('feed.empty.agentsTitle')} body={t('feed.empty.agentsBody')} />
      case 'team':
        return roster.org
          ? <EmptyState testId="feed-empty-team" title={t('feed.empty.teamTitle')} body={t('feed.empty.teamBody')} />
          : <EmptyState testId="feed-empty-team" title={t('feed.empty.noOrgTitle')} body={t('feed.empty.noOrgBody')} />
      case 'news':
        return <EmptyState testId="feed-empty-news" title={data.sources.length ? t('feed.empty.newsWaitingTitle') : t('feed.empty.newsTitle')} body={data.sources.length ? t('feed.empty.newsWaitingBody') : t('feed.empty.newsBody')} action={<Button variant="primary" onClick={() => switchView('sources')}>{t('feed.sources.add')}</Button>} />
      case 'subscriptions':
        return xConnected
          ? <EmptyState testId="feed-empty-subs" title={t('feed.empty.subsTitle')} body={data.x.message ? t('feed.x.lastError', { message: data.x.message }) : t('feed.empty.subsBody')} />
          : <EmptyState testId="feed-empty-subs" title={t('feed.x.connectTitle')} body={t('feed.x.connectBody')} action={<Button variant="primary" onClick={() => switchView('sources')}>{t('feed.x.connect')}</Button>} />
    }
  }

  const refreshTarget = tab === 'subscriptions' ? 'x' : tab === 'news' ? sourceFilter : undefined
  const feedList = (
    <>
      <header className="flex min-h-[44px] shrink-0 items-center gap-2 px-3 pt-2">
        <h2 className="min-w-0 truncate text-[15px] font-semibold">{sourceFilter && sourceById.get(sourceFilter) ? sourceLabel(sourceById.get(sourceFilter)!) : t(`feed.tab.${tab}`)}</h2>
        {data.generatedAt ? <span className="hidden shrink-0 text-[11px] text-text-muted min-[1600px]:inline">{t('feed.updatedAt', { time: timeFmt.format(data.generatedAt) })}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {readable && unreadCount ? (
            <Button variant="ghost" className="px-2" title={t('feed.markAllRead')} aria-label={t('feed.markAllRead')} onClick={() => annotate(visible.filter((i) => !i.read).map((i) => i.id), { read: true })} data-testid="feed-mark-all-read">
              <CheckCheck aria-hidden className="size-3.5" />
            </Button>
          ) : null}
          <div role="group" aria-label={t('feed.density.label')} className="flex items-center rounded-[6px] bg-foreground/[0.05]">
            {(['list', 'cards'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={prefs.density === d}
                aria-label={t(`feed.density.${d}`)}
                title={t(`feed.density.${d}`)}
                data-testid={`feed-density-${d}`}
                onClick={() => setPrefs((p) => ({ ...p, density: d }))}
                className={cn('grid h-7 w-7 place-items-center rounded-[6px] outline-none', prefs.density === d ? 'bg-accent/15 text-foreground' : 'text-text-muted hover:text-foreground')}
              >
                {d === 'list' ? <ListIcon aria-hidden className="size-3.5" /> : <LayoutGrid aria-hidden className="size-3.5" />}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="px-2"
            disabled={busy === 'refresh'}
            title={t('feed.refresh')}
            aria-label={t('feed.refresh')}
            onClick={() => void run('refresh', async () => { if (refreshTarget !== undefined) await api?.feedRefresh(refreshTarget); await load() })}
          >
            <RefreshCw aria-hidden className={cn('size-3.5', busy === 'refresh' && 'animate-spin')} />
          </Button>
        </div>
      </header>
      <div className="flex flex-col gap-2 px-3 pb-2" data-testid="feed-toolbar">
        <div className="flex items-center gap-2">
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('feed.searchContent')}
              aria-label={t('feed.searchContent')}
              data-testid="feed-search"
              className={cn(INPUT, 'w-full pl-7')}
            />
          </label>
          <Button
            variant="secondary"
            data-testid="feed-sort"
            aria-label={t('feed.sort.label')}
            title={t('feed.sort.label')}
            onClick={() => { setPrefs((p) => ({ ...p, order: p.order === 'newest' ? 'oldest' : 'newest' })); setPerDay({}) }}
          >
            {prefs.order === 'newest' ? <ArrowDownWideNarrow aria-hidden className="size-3.5" /> : <ArrowUpNarrowWide aria-hidden className="size-3.5" />}
            {t(`feed.sort.${prefs.order}`)}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {TAB_CHIPS[tab].map((c) => (
            <Chip key={c} active={chip === c} onClick={() => setChip(c)}>{t(`feed.chip.${c}`)}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ColorFilter value={colors} counts={colorCounts} onToggle={(c) => setColors((cur) => { const n = new Set(cur); if (n.has(c)) n.delete(c); else n.add(c); return n })} />
          <div role="group" aria-label={t('feed.mark.label')} className="flex items-center gap-1">
            {readable ? <Chip active={mark === 'unread'} onClick={() => setMark(mark === 'unread' ? 'all' : 'unread')}>{t('feed.mark.unread')}{unreadCount ? ` · ${unreadCount}` : ''}</Chip> : null}
            <Chip active={mark === 'starred'} onClick={() => setMark(mark === 'starred' ? 'all' : 'starred')}>
              <span className="inline-flex items-center gap-1">{starIcon(mark === 'starred')}{t('feed.mark.starred')}{starredCount ? ` · ${starredCount}` : ''}</span>
            </Chip>
          </div>
          {tabTags.length ? (
            <select aria-label={t('feed.filter.tag')} value={tagFilter ?? ''} onChange={(e) => setTagFilter(e.target.value || null)} className={cn(INPUT, 'h-6 max-w-[140px] px-1')} data-testid="feed-tag-filter">
              <option value="">{t('feed.filter.anyTag')}</option>
              {tabTags.map((x) => <option key={x.tag} value={x.tag}>#{x.tag} · {x.count}</option>)}
            </select>
          ) : null}
          {tab === 'news' && data.sources.length > 1 ? (
            <select aria-label={t('feed.filter.source')} value={sourceFilter ?? ''} onChange={(e) => setSourceFilter(e.target.value || null)} className={cn(INPUT, 'h-6 max-w-[140px] px-1')} data-testid="feed-source-filter">
              <option value="">{t('feed.filter.anySource')}</option>
              {data.sources.map((s) => <option key={s.id} value={s.id}>{sourceLabel(s)}</option>)}
            </select>
          ) : null}
          {filtersActive ? <button type="button" onClick={resetFilters} className="ml-auto text-[11px] text-text-muted underline-offset-2 outline-none hover:text-foreground hover:underline">{t('feed.empty.resetFilters')}</button> : null}
        </div>
      </div>
      {loadError ? <div role="alert" className="mx-3 mb-1 rounded-[6px] bg-destructive/10 px-2 py-1 text-[12px] text-destructive">{t('feed.loadError')}</div> : null}
      <div role="listbox" aria-label={t(`feed.tab.${tab}`)} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeys} data-testid="feed-list" data-density={prefs.density}>
        {visible.length === 0 ? emptyForTab() : groups.map((g) => (
          <div key={g.key}>
            <div className="flex items-center gap-2 px-3 pb-1 pt-3 text-[11px] uppercase tracking-wide text-text-muted" data-testid="feed-day">
              <span className="truncate">{g.label === 'earlier' ? dayFmt.format(g.day) : t(`feed.day.${g.label}`)}</span>
              <span className="tabular-nums">{g.items.length}</span>
              {g.items.length > 1 ? (
                <button
                  type="button"
                  data-testid="feed-day-order"
                  aria-label={t('feed.sort.dayToggle', { order: t(`feed.sort.${g.order === 'newest' ? 'oldest' : 'newest'}`) })}
                  title={t('feed.sort.dayToggle', { order: t(`feed.sort.${g.order === 'newest' ? 'oldest' : 'newest'}`) })}
                  onClick={() => setPerDay((m) => ({ ...m, [g.key]: g.order === 'newest' ? 'oldest' : 'newest' }))}
                  className="ml-auto inline-flex h-5 items-center gap-1 rounded-[4px] px-1 normal-case tracking-normal outline-none hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  {g.order === 'newest' ? <ArrowDownWideNarrow aria-hidden className="size-3" /> : <ArrowUpNarrowWide aria-hidden className="size-3" />}
                  {t(`feed.sort.short.${g.order}`)}
                </button>
              ) : null}
            </div>
            {g.items.map(row)}
          </div>
        ))}
      </div>
    </>
  )

  // ── X connection panel (sources side pane) ───────────────────────────────
  const [xToken, setXToken] = useState('')
  const [xResult, setXResult] = useState<XConnectionStatus | null>(null)
  const xPanel = (
    <div data-testid="feed-x">
      <Card>
        {xConnected ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px]">{t('feed.x.connectedAs', { username: data.x.username ?? '' })}</span>
            <Button variant="danger" disabled={busy === 'x'} onClick={() => void run('x', async () => { setXResult(await api!.feedClearX()); await load() })}>{t('feed.x.disconnect')}</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run('x', async () => { const r = await api!.feedSetXToken(xToken); setXResult(r); if (r.state === 'connected') setXToken(''); await load() }) }}>
            <p className="text-[12px] text-text-secondary">{t('feed.x.connectBody')}</p>
            <div className="flex gap-1">
              <input type="password" autoComplete="off" value={xToken} onChange={(e) => setXToken(e.target.value)} placeholder={t('feed.x.tokenPlaceholder')} aria-label={t('feed.x.tokenPlaceholder')} className={cn(INPUT, 'min-w-0 flex-1')} />
              <Button type="submit" variant="primary" disabled={!xToken.trim() || busy === 'x' || !api?.feedSetXToken}>{busy === 'x' ? t('feed.x.checking') : t('feed.x.connectShort')}</Button>
            </div>
            <p className="text-[11px] text-text-muted">{t('feed.x.privacy')}</p>
          </form>
        )}
        {xResult?.state === 'error' ? <p role="alert" className="pt-2 text-[12px] text-destructive">{t('feed.x.error', { message: xResult.message ?? '' })}</p> : null}
      </Card>
    </div>
  )

  // ── reading pane ─────────────────────────────────────────────────────────
  const retryState = selected?.automationId ? automations.automationTestResults[selected.automationId]?.state : undefined
  const selSource = selected?.sourceId ? sourceById.get(selected.sourceId) : undefined
  const itemDetail = selected ? (
    <div className="flex flex-col px-6 py-4" data-testid="feed-detail" data-kind={selected.kind}>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-muted">
        {selSource ? <SourceIcon source={selSource} size={20} /> : null}
        <span className="min-w-0 truncate">{selected.author ?? (selSource ? sourceLabel(selSource) : selected.sourceTitle) ?? ''}</span>
        <Badge tone={selected.status ? STATUS_TONE[selected.status] : 'muted'}>{t(`feed.kind.${selected.kind}`)}</Badge>
        {selected.status && selected.status !== 'ok' ? <Badge tone={STATUS_TONE[selected.status]}>{t(`feed.status.${selected.status}`)}</Badge> : null}
        <span className="ml-auto shrink-0 tabular-nums">{longFmt.format(selected.at)}</span>
      </div>
      <h2 className="max-w-[720px] pt-3 text-[20px] font-semibold leading-7">{titleOf(selected)}</h2>

      <div className="flex flex-wrap items-center gap-1 pt-3" data-testid="feed-reader-actions">
        {selected.url ? (
          <Button variant="primary" onClick={() => void api?.openUrl?.(selected.url!)} data-testid="feed-open-original"><ExternalLink aria-hidden className="size-3.5" />{t('feed.reader.openOriginal')}</Button>
        ) : null}
        {selected.kind === 'session' || (selected.kind === 'team-activity' && selected.sessionId) ? (
          <Button variant={selected.url ? 'secondary' : 'primary'} onClick={() => openItem(selected)}>{t('feed.openSession')}</Button>
        ) : null}
        <Button disabled={busy === `task:${selected.id}`} onClick={() => toTask(selected)} data-testid="feed-to-task"><ListTodo aria-hidden className="size-3.5" />{t('feed.reader.toTask')}</Button>
        <Button disabled={busy === `note:${selected.id}` || !workspaceId} onClick={() => toNote(selected)} data-testid="feed-to-note"><NotebookPen aria-hidden className="size-3.5" />{t('feed.reader.toNote')}</Button>
        <Button variant="ghost" aria-pressed={selected.starred} data-testid="feed-star" onClick={() => annotate([selected.id], { starred: !selected.starred })}>
          {starIcon(selected.starred, 'size-3.5')}
          {selected.starred ? t('feed.reader.unstar') : t('feed.reader.star')}
        </Button>
        {READABLE_TABS.has(selected.tab) ? (
          <Button variant="ghost" onClick={() => annotate([selected.id], { read: !selected.read })} data-testid="feed-toggle-read">
            {selected.read ? t('feed.reader.markUnread') : t('feed.reader.markRead')}
          </Button>
        ) : null}
      </div>
      {sent && sent.itemId === selected.id ? (
        <p className="pt-2 text-[12px] text-success" role="status" data-testid="feed-sent">
          {sent.kind === 'task' ? t('feed.reader.taskCreated') : t('feed.reader.noteCreated')}{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => navigate(sent.kind === 'task' ? routes.view.tasks(sent.id) : routes.view.notes(sent.id))}>
            {sent.kind === 'task' ? t('feed.reader.openTask') : t('feed.reader.openNote')}
          </button>
        </p>
      ) : null}

      <div className="grid max-w-[720px] grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 pt-4 text-[12px]" data-testid="feed-labels">
        <span className="pt-0.5 text-text-muted">{t('feed.color.label')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <ColorPicker value={selected.ownColor} onChange={(c) => annotate([selected.id], { color: c })} testId="feed-item-color" />
          {!selected.ownColor && selected.color ? <span className="text-[11px] text-text-muted">{t('feed.color.inherited', { color: t(`feed.color.${selected.color}`) })}</span> : null}
        </div>
        <span className="pt-1 text-text-muted">{t('feed.tags.label')}</span>
        <TagEditor value={selected.ownTags} inherited={selSource?.tags} onChange={(tags) => annotate([selected.id], { tags })} suggestions={suggestions} testId="feed-item-tags" />
      </div>

      {selected.summary ? (
        <div className="max-w-[720px] pt-4">
          <SectionLabel>{t('feed.reader.summary')}</SectionLabel>
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-foreground">{selected.summary}</p>
        </div>
      ) : selected.url ? (
        <p className="max-w-[720px] pt-4 text-[12px] text-text-muted">{t('feed.reader.noSummary')}</p>
      ) : null}
      {selected.error ? <pre className="mt-2 max-w-[720px] overflow-x-auto whitespace-pre-wrap rounded-[6px] bg-destructive/10 p-2 font-mono text-[12px] text-destructive">{selected.error}</pre> : null}
      {selected.url ? <p className="max-w-[720px] break-all pt-3 text-[11px] text-text-muted">{selected.url}</p> : null}

      {selected.kind === 'automation-run' ? (
        <div className="flex flex-wrap gap-1 pt-4">
          {selected.status === 'error' ? (
            <Button
              variant="primary"
              data-testid="feed-retry"
              disabled={!selected.automationId || !automationNames.has(selected.automationId) || retryState === 'running'}
              onClick={() => automations.handleTestAutomation(selected.automationId!)}
            >
              {retryState === 'running' ? t('feed.retrying') : t('feed.retry')}
            </Button>
          ) : null}
          {selected.sessionId ? <Button onClick={() => navigate(routes.view.allSessions(selected.sessionId!))}>{t('feed.openSession')}</Button> : null}
          <Button variant="ghost" onClick={() => openAutomation(selected.automationId!)}>{t('feed.openAutomation')}</Button>
        </div>
      ) : null}
      {selSource ? (
        <div className="pt-4">
          <Button variant="ghost" onClick={() => { switchView('sources'); setSelectedSource(selSource.id) }}>{t('feed.reader.sourceSettings')}</Button>
        </div>
      ) : null}
      {retryState === 'success' ? <p className="pt-2 text-[12px] text-success">{t('feed.retryOk')}</p> : retryState === 'error' ? <p role="alert" className="pt-2 text-[12px] text-destructive">{t('feed.retryFailed')}</p> : null}
      {selected.kind === 'automation-run' && selected.automationId && !automationNames.has(selected.automationId) ? <p className="pt-2 text-[12px] text-text-muted">{t('feed.automationGone')}</p> : null}
      {actionError ? <p role="alert" className="pt-2 text-[12px] text-destructive">{actionError}</p> : null}
      <p className="pt-6 text-[11px] text-text-muted">{t('feed.reader.keys')}</p>
    </div>
  ) : (
    <EmptyState title={t('feed.selectTitle')} body={t('feed.reader.keys')} />
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !canHandleKeyboard(event.target)) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (view === 'sources') return
      if (event.key === 'Escape' && selected) select(null)
      else if (event.key === 's' && selected) annotate([selected.id], { starred: !selected.starred })
      else if (event.key === 'u' && selected && READABLE_TABS.has(selected.tab)) annotate([selected.id], { read: !selected.read })
      else if (event.key === 'o' && selected?.url) void api?.openUrl?.(selected.url)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const status = (
    <>
      <span>{t('feed.status.sources', { count: data.sources.length })}</span>
      <span aria-hidden>·</span>
      <span>{xConnected ? t('feed.x.connectedAs', { username: data.x.username ?? '' }) : t('feed.x.notConnected')}</span>
      <span aria-hidden>·</span>
      <span>{roster.org ? roster.org.name ?? t('feed.tab.team') : t('feed.status.noOrg')}</span>
    </>
  )

  const source = selectedSource ? sourceById.get(selectedSource) ?? null : null
  const showItems = (id: string) => { switchView('news'); setSourceFilter(id) }
  return (
    <ModeScreenLayout
      testId="feed-page"
      navigator={navigator}
      wideList={view === 'sources'}
      list={view === 'sources' ? (
        <SourcesView
          api={api}
          sources={data.sources}
          items={data.items}
          now={now}
          x={data.x}
          suggestions={suggestions}
          selectedId={selectedSource}
          onSelect={setSelectedSource}
          onShowItems={showItems}
          reload={load}
          fmt={when}
        />
      ) : feedList}
      detail={view === 'sources' ? (
        <SourceEditor
          api={api}
          source={source}
          suggestions={suggestions}
          reload={load}
          onShowItems={showItems}
          onRemoved={() => setSelectedSource(null)}
          fmt={when}
          xPanel={xPanel}
        />
      ) : itemDetail}
      status={status}
    />
  )
}
