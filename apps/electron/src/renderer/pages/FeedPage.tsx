/**
 * Лента — feed aggregator with four tabs: «Действия агентов» (sessions +
 * automation runs), «Команда» (local-first team activity; honest state when
 * there is no org), «Новости» (user sources polled in the background:
 * RSS/Atom → autodiscovery → page diff) and «Подписки» (X home timeline via
 * the official API with a user token — never browser cookies). Data comes
 * from the feed:list server aggregator; «Источники ленты» manages sources.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import {
  FEED_DEFAULT_INTERVAL_MIN,
  FEED_INTERVALS_MIN,
  FEED_TABS,
  detectFeedSource,
  type FeedItem,
  type FeedListResult,
  type FeedSource,
  type FeedTab,
  type XConnectionStatus,
} from '@craft-agent/shared/feed'
import { navigate, routes } from '@/lib/navigate'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAutomations } from '@/hooks/useAutomations'
import { useTeamState } from '@/components/team/team-store'
import { useTeamRoster } from '@/components/team/use-team-roster'
import { activityText, syncStatusText } from '@/components/team/team-labels'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  GroupLabel,
  ListHeader,
  ListRow,
  ModeScreenLayout,
  NavItem,
  NavSection,
  NavTitle,
  SectionLabel,
  useListKeys,
  type Tone,
} from '@/components/mode-screen/ModeScreen'
import {
  TAB_CHIPS,
  attentionCount,
  buildTeamItems,
  filterFeed,
  groupByDay,
  sourceErrorText,
  sourceLabel,
  sourceTone,
  tabCounts,
  type FeedChip,
} from './feed/feed-model'

type View = FeedTab | 'sources'

const KIND_GLYPH: Record<FeedItem['kind'], string> = {
  session: '◧',
  'automation-run': '↻',
  'team-activity': '☺',
  news: '▤',
  'page-change': '△',
  'x-post': '𝕏',
}

const STATUS_TONE: Record<NonNullable<FeedItem['status']>, Tone> = {
  ok: 'success',
  error: 'danger',
  running: 'accent',
  waiting: 'warning',
}

const EMPTY: FeedListResult = { items: [], sources: [], x: { state: 'not-connected' }, generatedAt: 0 }

export default function FeedPage({ selectedId }: { selectedId?: string | null }) {
  const { t, i18n } = useTranslation()
  const shell = useOptionalAppShellContext()
  const workspaceId = shell?.activeWorkspaceId ?? null
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined

  const [data, setData] = useState<FeedListResult>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>('agents')
  const [chip, setChip] = useState<FeedChip>('all')
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const routeBound = selectedId !== undefined
  const currentId = routeBound ? selectedId ?? null : localSelected
  const select = useCallback((id: string | null) => {
    if (routeBound) navigate(routes.view.feed(id ?? undefined))
    else setLocalSelected(id)
  }, [routeBound])

  // ── data ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!api?.feedList) {
      setLoaded(true)
      setLoadError('unavailable')
      return
    }
    try {
      const res = await api.feedList(workspaceId)
      setData(res ?? EMPTY)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
      setNow(Date.now())
    }
  }, [api, workspaceId])

  useEffect(() => { void load() }, [load])
  useEffect(() => api?.onFeedChanged?.(() => { void load() }), [api, load])
  useEffect(() => {
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])
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
  const allItems = useMemo(() => [...data.items, ...teamItems], [data.items, teamItems])

  const automations = useAutomations(workspaceId)
  const automationNames = useMemo(() => new Map(automations.automations.map((a) => [a.id, a.name])), [automations.automations])

  const tab: FeedTab = view === 'sources' ? 'news' : view
  const counts = useMemo(() => tabCounts(allItems), [allItems])
  const attention = useMemo(() => attentionCount(allItems), [allItems])
  const visible = useMemo(
    () => filterFeed(allItems, { tab, chip, sourceId: tab === 'news' ? sourceFilter : null, query }, now, data.sources),
    [allItems, tab, chip, sourceFilter, query, now, data.sources],
  )
  const groups = useMemo(() => groupByDay(visible, now), [visible, now])
  const selected = useMemo(() => allItems.find((i) => i.id === currentId) ?? null, [allItems, currentId])
  const sourceById = useMemo(() => new Map(data.sources.map((s) => [s.id, s])), [data.sources])

  const locale = i18n.resolvedLanguage || i18n.language
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }), [locale])
  const when = (at: number) => (new Date(at).toDateString() === new Date(now).toDateString() ? timeFmt.format(at) : dateFmt.format(at))

  const switchView = (next: View) => {
    setView(next)
    setChip('all')
    setActionError(null)
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

  const titleOf = (item: FeedItem) => {
    if (item.kind === 'automation-run' && item.automationId && automationNames.get(item.automationId)) return automationNames.get(item.automationId)!
    return item.title || (item.kind === 'session' ? t('feed.untitledSession') : item.url ?? '')
  }

  const openItem = (item: FeedItem) => {
    if (item.ref?.type === 'session' || (item.kind !== 'automation-run' && item.sessionId)) {
      navigate(routes.view.allSessions(item.sessionId ?? item.ref!.id))
    } else if (item.ref?.type === 'automation') {
      navigate(routes.view.automations({ automationId: item.ref.id }))
    } else if (item.url) {
      void api?.openUrl?.(item.url)
    }
  }

  const onListKeys = useListKeys(visible, selected && visible.includes(selected) ? selected : null, (i) => select(i.id), openItem)

  // ── navigator ────────────────────────────────────────────────────────────
  const xConnected = data.x.state === 'connected'
  const navigator = (
    <>
      <NavTitle>{t('feed.title')}</NavTitle>
      {FEED_TABS.map((id) => (
        <NavItem
          key={id}
          testId={`feed-nav-${id}`}
          label={t(`feed.tab.${id}`)}
          count={counts[id] || null}
          dot={id === 'agents' && attention ? 'warning' : id === 'subscriptions' && !xConnected ? 'muted' : undefined}
          active={view === id && !(id === 'news' && sourceFilter)}
          onClick={() => { switchView(id); setSourceFilter(null) }}
        />
      ))}
      <NavSection title={t('feed.nav.sources')}>
        {data.sources.map((s) => (
          <NavItem
            key={s.id}
            label={sourceLabel(s)}
            count={s.itemCount || null}
            dot={sourceTone(s)}
            active={view === 'news' && sourceFilter === s.id}
            onClick={() => { switchView('news'); setSourceFilter(s.id) }}
          />
        ))}
        <NavItem testId="feed-nav-sources" label={t('feed.nav.manageSources')} active={view === 'sources'} onClick={() => switchView('sources')} />
      </NavSection>
      <NavSection title={t('feed.nav.connections')}>
        <NavItem
          label={xConnected ? t('feed.x.connectedAs', { username: data.x.username ?? '' }) : t('feed.x.connect')}
          dot={xConnected ? 'success' : data.x.state === 'error' ? 'danger' : 'muted'}
          onClick={() => switchView('sources')}
        />
        <NavItem
          label={syncStatusText(roster.sync, team.outbox?.length ?? 0, t)}
          dot={roster.org ? 'warning' : 'muted'}
          onClick={() => switchView('team')}
        />
      </NavSection>
    </>
  )

  // ── list: feed tabs ──────────────────────────────────────────────────────
  const row = (item: FeedItem) => {
    const src = item.sourceId ? sourceById.get(item.sourceId) : undefined
    const meta = item.kind === 'automation-run'
      ? t('feed.kind.automation-run')
      : item.kind === 'session'
        ? t('feed.kind.session')
        : item.author ?? (src ? sourceLabel(src) : item.sourceTitle) ?? t(`feed.kind.${item.kind}`)
    return (
      <ListRow key={item.id} testId={`feed-row-${item.kind}`} selected={item.id === currentId} onClick={() => select(item.id)}>
        <span aria-hidden className="w-4 shrink-0 pt-px text-center text-text-muted">{KIND_GLYPH[item.kind]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-text-muted">{meta}</span>
          <span className={`block truncate ${item.status === 'error' ? 'text-destructive' : ''}`}>{titleOf(item)}</span>
          {item.summary ? <span className="block truncate text-[12px] text-text-secondary">{item.summary}</span> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-[11px] tabular-nums text-text-muted">{when(item.at)}</span>
          {item.status && item.status !== 'ok' ? <Badge tone={STATUS_TONE[item.status]}>{t(`feed.status.${item.status}`)}</Badge> : null}
        </span>
      </ListRow>
    )
  }

  const emptyForTab = () => {
    if (!loaded) return <EmptyState title={t('feed.loading')} />
    if (query || chip !== 'all' || sourceFilter) return <EmptyState testId="feed-empty" title={t('feed.empty.filteredTitle')} action={<Button onClick={() => { setChip('all'); setQuery(''); setSourceFilter(null) }}>{t('feed.empty.resetFilters')}</Button>} />
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

  const feedList = (
    <>
      <ListHeader
        title={sourceFilter && sourceById.get(sourceFilter) ? sourceLabel(sourceById.get(sourceFilter)!) : t(`feed.tab.${tab}`)}
        subtitle={data.generatedAt ? t('feed.updatedAt', { time: timeFmt.format(data.generatedAt) }) : undefined}
        actions={
          <>
            {tab === 'news' || tab === 'subscriptions' ? (
              <Button variant="ghost" disabled={busy === 'refresh'} onClick={() => void run('refresh', async () => { await api?.feedRefresh(tab === 'subscriptions' ? 'x' : sourceFilter); await load() })}>
                {busy === 'refresh' ? t('feed.refreshing') : t('feed.refresh')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void load()}>{t('feed.refresh')}</Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
        {TAB_CHIPS[tab].map((c) => (
          <Chip key={c} active={chip === c} onClick={() => setChip(c)}>{t(`feed.chip.${c}`)}</Chip>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('feed.search')}
          aria-label={t('feed.search')}
          className="ml-auto h-6 w-32 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
        />
      </div>
      {loadError ? <div role="alert" className="mx-3 mb-1 rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{t('feed.loadError')}</div> : null}
      <div role="listbox" aria-label={t(`feed.tab.${tab}`)} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeys} data-testid="feed-list">
        {visible.length === 0 ? emptyForTab() : groups.map((g) => (
          <div key={g.key}>
            <GroupLabel>{g.label === 'earlier' ? dayFmt.format(g.day) : t(`feed.day.${g.label}`)}</GroupLabel>
            {g.items.map(row)}
          </div>
        ))}
      </div>
    </>
  )

  // ── list: «Источники ленты» ──────────────────────────────────────────────
  const [newUrl, setNewUrl] = useState('')
  const [newInterval, setNewInterval] = useState<number>(FEED_DEFAULT_INTERVAL_MIN)
  const [addError, setAddError] = useState<string | null>(null)
  const [xToken, setXToken] = useState('')
  const [xResult, setXResult] = useState<XConnectionStatus | null>(null)
  const detected = useMemo(() => (newUrl.trim() ? detectFeedSource(newUrl) : null), [newUrl])

  const addSource = () => void run('add', async () => {
    setAddError(null)
    const res = await api!.feedAddSource(newUrl, newInterval)
    if (!res.ok) { setAddError(t(`feed.sources.addError.${res.error}`)); return }
    setNewUrl('')
    setSelectedSource(res.source.id)
    await load()
  })

  const intervalLabel = (m: number) => (m < 60 ? t('feed.interval.minutes', { count: m }) : m < 1440 ? t('feed.interval.hours', { count: m / 60 }) : t('feed.interval.days', { count: m / 1440 }))
  const intervalOptions = (value: number) => (FEED_INTERVALS_MIN.includes(value) ? FEED_INTERVALS_MIN : [...FEED_INTERVALS_MIN, value].sort((a, b) => a - b))

  const sourcesList = (
    <>
      <ListHeader
        title={t('feed.sources.title')}
        subtitle={t('feed.sources.subtitle', { count: data.sources.length })}
        actions={<Button variant="ghost" disabled={busy === 'refresh-all' || !data.sources.length} onClick={() => void run('refresh-all', async () => { await api?.feedRefresh(null); await load() })}>{busy === 'refresh-all' ? t('feed.refreshing') : t('feed.sources.refreshAll')}</Button>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-3" data-testid="feed-sources">
        <form className="flex flex-col gap-1.5 px-3 pb-3" onSubmit={(e) => { e.preventDefault(); if (detected) addSource() }}>
          <div className="flex gap-1.5">
            <input
              data-testid="feed-source-url"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setAddError(null) }}
              placeholder={t('feed.sources.placeholder')}
              aria-label={t('feed.sources.placeholder')}
              className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
            />
            <select aria-label={t('feed.sources.interval')} value={newInterval} onChange={(e) => setNewInterval(Number(e.target.value))} className="h-7 rounded-[6px] bg-foreground/[0.05] px-1.5 text-[12px] outline-none">
              {FEED_INTERVALS_MIN.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
            </select>
            <Button type="submit" variant="primary" disabled={!detected || busy === 'add' || !api?.feedAddSource}>{t('feed.sources.add')}</Button>
          </div>
          <p className="text-[11px] text-text-muted">
            {newUrl.trim()
              ? detected ? t('feed.sources.detected', { kind: t(`feed.sourceKind.${detected.kind}`) }) : t('feed.sources.addError.invalid-url')
              : t('feed.sources.hint')}
          </p>
          {addError ? <p role="alert" className="text-[12px] text-destructive">{addError}</p> : null}
        </form>

        {data.sources.length ? <GroupLabel>{t('feed.sources.tracked')}</GroupLabel> : null}
        {data.sources.map((s) => (
          <ListRow key={s.id} testId="feed-source-row" selected={selectedSource === s.id} onClick={() => setSelectedSource(s.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{sourceLabel(s)}</span>
              <span className="block truncate text-[12px] text-text-muted">{s.url}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <Badge tone="muted">{t(`feed.sourceKind.${s.kind}`)}</Badge>
              <span className="text-[11px] text-text-muted">
                <Badge tone={sourceTone(s)}>{t(`feed.sourceStatus.${s.lastStatus}`)}</Badge>{' '}
                {s.lastFetchAt ? when(s.lastFetchAt) : ''} · {intervalLabel(s.intervalMin)}
              </span>
            </span>
          </ListRow>
        ))}

        <GroupLabel>{t('feed.x.title')}</GroupLabel>
        <div className="px-3" data-testid="feed-x">
          <Card>
            {xConnected ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13px]">{t('feed.x.connectedAs', { username: data.x.username ?? '' })}</span>
                <Button variant="danger" disabled={busy === 'x'} onClick={() => void run('x', async () => { setXResult(await api!.feedClearX()); await load() })}>{t('feed.x.disconnect')}</Button>
              </div>
            ) : (
              <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); void run('x', async () => { const r = await api!.feedSetXToken(xToken); setXResult(r); if (r.state === 'connected') setXToken(''); await load() }) }}>
                <p className="text-[12px] text-text-secondary">{t('feed.x.connectBody')}</p>
                <div className="flex gap-1.5">
                  <input type="password" autoComplete="off" value={xToken} onChange={(e) => setXToken(e.target.value)} placeholder={t('feed.x.tokenPlaceholder')} aria-label={t('feed.x.tokenPlaceholder')} className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]" />
                  <Button type="submit" variant="primary" disabled={!xToken.trim() || busy === 'x' || !api?.feedSetXToken}>{busy === 'x' ? t('feed.x.checking') : t('feed.x.connect')}</Button>
                </div>
                <p className="text-[11px] text-text-muted">{t('feed.x.privacy')}</p>
              </form>
            )}
            {xResult?.state === 'error' ? <p role="alert" className="pt-1.5 text-[12px] text-destructive">{t('feed.x.error', { message: xResult.message ?? '' })}</p> : null}
          </Card>
        </div>
      </div>
    </>
  )

  // ── detail ───────────────────────────────────────────────────────────────
  const source = selectedSource ? sourceById.get(selectedSource) ?? null : null
  const sourceDetail = source ? (
    <div className="flex flex-col px-5 py-4" data-testid="feed-source-detail">
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Badge tone="muted">{t(`feed.sourceKind.${source.kind}`)}</Badge>
        <Badge tone={sourceTone(source)}>{t(`feed.sourceStatus.${source.lastStatus}`)}</Badge>
      </div>
      <h2 className="pt-2 text-[17px] font-semibold">{sourceLabel(source)}</h2>
      <p className="break-all pt-1 text-[12px] text-text-muted">{source.url}</p>
      {source.feedUrl && source.feedUrl !== source.url ? <p className="break-all text-[12px] text-text-muted">{t('feed.sources.feedUrl')}: {source.feedUrl}</p> : null}
      <SectionLabel>{t('feed.sources.state')}</SectionLabel>
      <p className="text-[13px] text-text-secondary">
        {source.lastFetchAt ? t('feed.sources.lastFetch', { time: when(source.lastFetchAt) }) : t('feed.sources.neverFetched')}
        {' · '}{t('feed.sources.items', { count: source.itemCount ?? 0 })}
      </p>
      {source.kind === 'page' ? <p className="pt-1 text-[12px] text-text-muted">{t('feed.sources.pageDiffNote')}</p> : null}
      {source.lastError ? <p role="alert" className="pt-1 text-[12px] text-destructive">{sourceErrorText(source.lastError, t)}</p> : null}
      <SectionLabel>{t('feed.sources.interval')}</SectionLabel>
      <select
        aria-label={t('feed.sources.interval')}
        value={source.intervalMin}
        onChange={(e) => void run('interval', async () => { await api?.feedUpdateSource(source.id, { intervalMin: Number(e.target.value) }); await load() })}
        className="h-7 w-40 rounded-[6px] bg-foreground/[0.05] px-1.5 text-[12px] outline-none"
      >
        {intervalOptions(source.intervalMin).map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
      </select>
      <div className="flex flex-wrap gap-1.5 pt-4">
        <Button variant="primary" disabled={busy === `poll:${source.id}`} onClick={() => void run(`poll:${source.id}`, async () => { await api?.feedRefresh(source.id); await load() })}>{busy === `poll:${source.id}` ? t('feed.refreshing') : t('feed.sources.checkNow')}</Button>
        <Button onClick={() => { switchView('news'); setSourceFilter(source.id) }}>{t('feed.sources.showItems')}</Button>
        <Button variant="ghost" onClick={() => void api?.openUrl?.(source.url)}>{t('feed.openLink')}</Button>
        <Button variant="danger" disabled={busy === `rm:${source.id}`} onClick={() => void run(`rm:${source.id}`, async () => { await api?.feedRemoveSource(source.id); setSelectedSource(null); await load() })}>{t('feed.sources.remove')}</Button>
      </div>
      {actionError ? <p role="alert" className="pt-2 text-[12px] text-destructive">{actionError}</p> : null}
    </div>
  ) : (
    <EmptyState title={t('feed.sources.selectTitle')} body={t('feed.sources.selectBody')} />
  )

  const retryState = selected?.automationId ? automations.automationTestResults[selected.automationId]?.state : undefined
  const itemDetail = selected ? (
    <div className="flex flex-col px-5 py-4" data-testid="feed-detail" data-kind={selected.kind}>
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Badge tone={selected.status ? STATUS_TONE[selected.status] : 'muted'}>{t(`feed.kind.${selected.kind}`)}</Badge>
        {selected.status && selected.status !== 'ok' ? <Badge tone={STATUS_TONE[selected.status]}>{t(`feed.status.${selected.status}`)}</Badge> : null}
        <span className="truncate">{selected.author ?? selected.sourceTitle ?? ''}</span>
        <span className="ml-auto tabular-nums">{dateFmt.format(selected.at)}</span>
      </div>
      <h2 className="pt-2 text-[17px] font-semibold">{titleOf(selected)}</h2>
      {selected.summary ? <p className="whitespace-pre-wrap pt-2 text-[13px] text-text-secondary">{selected.summary}</p> : null}
      {selected.error ? <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[6px] bg-destructive/10 p-2.5 font-mono text-[12px] text-destructive">{selected.error}</pre> : null}
      {selected.url ? <p className="break-all pt-2 text-[12px] text-text-muted">{selected.url}</p> : null}
      <div className="flex flex-wrap gap-1.5 pt-4">
        {selected.kind === 'session' || (selected.kind === 'team-activity' && selected.sessionId) ? (
          <Button variant="primary" onClick={() => openItem(selected)}>{t('feed.openSession')}</Button>
        ) : null}
        {selected.kind === 'automation-run' ? (
          <>
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
            <Button variant="ghost" onClick={() => navigate(routes.view.automations({ automationId: selected.automationId! }))}>{t('feed.openAutomation')}</Button>
          </>
        ) : null}
        {selected.url ? <Button variant={selected.tab === 'news' || selected.tab === 'subscriptions' ? 'primary' : 'secondary'} onClick={() => void api?.openUrl?.(selected.url!)}>{t('feed.openLink')}</Button> : null}
        {selected.sourceId && sourceById.has(selected.sourceId) ? <Button variant="ghost" onClick={() => { switchView('sources'); setSelectedSource(selected.sourceId!) }}>{t('feed.source')}</Button> : null}
      </div>
      {retryState === 'success' ? <p className="pt-2 text-[12px] text-success">{t('feed.retryOk')}</p> : retryState === 'error' ? <p role="alert" className="pt-2 text-[12px] text-destructive">{t('feed.retryFailed')}</p> : null}
      {selected.kind === 'automation-run' && selected.automationId && !automationNames.has(selected.automationId) ? <p className="pt-2 text-[12px] text-text-muted">{t('feed.automationGone')}</p> : null}
      {actionError ? <p role="alert" className="pt-2 text-[12px] text-destructive">{actionError}</p> : null}
    </div>
  ) : (
    <EmptyState title={t('feed.selectTitle')} body={t('feed.selectBody')} />
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape' && selected) select(null)
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

  return (
    <ModeScreenLayout
      testId="feed-page"
      navigator={navigator}
      list={view === 'sources' ? sourcesList : feedList}
      detail={view === 'sources' ? sourceDetail : itemDetail}
      status={status}
    />
  )
}
