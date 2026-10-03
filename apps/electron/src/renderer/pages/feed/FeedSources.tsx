/**
 * «Источники ленты» — gallery of source cards with live health, and an
 * add-source flow that previews the first items BEFORE saving (dry-run
 * feed:sources:preview), so it is obvious a link works. Presets only fill
 * the input; the user confirms with «Добавить». The side pane edits one
 * source: name, color, default tags, interval, pause, check now, delete.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  FEED_DEFAULT_INTERVAL_MIN,
  FEED_INTERVALS_MIN,
  detectFeedSource,
  type FeedColor,
  type FeedItem,
  type FeedPreviewResult,
  type FeedSource,
  type FeedSourcePatch,
  type XConnectionStatus,
} from '@rox/shared/feed'
import { ExternalLink, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge, Button, ListHeader, SectionLabel } from '@/components/mode-screen/ModeScreen'
import { ColorDot, ColorPicker, HealthDot, SourceIcon, Sparkline, TagEditor } from './FeedParts'
import { itemsPerDay, sourceErrorText, sourceHealth, sourceHost, sourceLabel } from './feed-model'

export interface FeedPreset {
  id: 'github' | 'youtube' | 'blog' | 'hn' | 'habr' | 'x'
  url: string
  /** Part of the URL to pre-select so the user can type over it. */
  select?: string
}

export const FEED_PRESETS: readonly FeedPreset[] = [
  { id: 'github', url: 'https://github.com/oven-sh/bun/releases', select: 'oven-sh/bun' },
  { id: 'youtube', url: 'https://www.youtube.com/@Fireship', select: 'Fireship' },
  { id: 'blog', url: 'https://blog.cloudflare.com/rss/' },
  { id: 'hn', url: 'https://news.ycombinator.com/rss' },
  { id: 'habr', url: 'https://habr.com/ru/rss/articles/' },
  { id: 'x', url: 'https://x.com/', select: '' },
] as const

type Api = NonNullable<Window['electronAPI']>
type T = (key: string, opts?: Record<string, unknown>) => string

export function intervalLabel(m: number, t: T): string {
  return m < 60 ? t('feed.interval.minutes', { count: m }) : m < 1440 ? t('feed.interval.hours', { count: m / 60 }) : t('feed.interval.days', { count: m / 1440 })
}

function intervalOptions(value: number): readonly number[] {
  return FEED_INTERVALS_MIN.includes(value) ? FEED_INTERVALS_MIN : [...FEED_INTERVALS_MIN, value].sort((a, b) => a - b)
}

const SPARK_DAYS = 30

const INPUT = 'h-7 min-w-0 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]'

function previewErrorText(code: string, t: T): string {
  if (code === 'invalid-url') return t('feed.sources.addError.invalid-url')
  if (code === 'x-no-handle') return t('feed.add.xNoHandle')
  return sourceErrorText(code, t) ?? code
}

// ── add flow ────────────────────────────────────────────────────────────────

function AddSource({ api, sources, suggestions, xConnected, onAdded, fmt }: {
  api: Api | undefined
  sources: FeedSource[]
  suggestions: string[]
  xConnected: boolean
  onAdded: (id: string) => void
  fmt: (at: number) => string
}) {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [url, setUrl] = React.useState('')
  const [preview, setPreview] = React.useState<FeedPreviewResult | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [name, setName] = React.useState('')
  const [nameTouched, setNameTouched] = React.useState(false)
  const [color, setColor] = React.useState<FeedColor | null>(null)
  const [tags, setTags] = React.useState<string[]>([])
  const [interval, setIntervalMin] = React.useState<number>(FEED_DEFAULT_INTERVAL_MIN)
  const [adding, setAdding] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const detected = React.useMemo(() => (url.trim() ? detectFeedSource(url) : null), [url])
  const reqId = React.useRef(0)

  // Live dry run, debounced. Nothing is saved until «Добавить».
  React.useEffect(() => {
    setPreview(null)
    setError(null)
    if (!detected || !api?.feedPreviewSource) { setChecking(false); return }
    if (detected.kind === 'x' && !detected.handle) { setChecking(false); return }
    const id = ++reqId.current
    setChecking(true)
    const timer = setTimeout(() => {
      api.feedPreviewSource(url)
        .then((res) => { if (reqId.current === id) setPreview(res) })
        .catch((e) => { if (reqId.current === id) setPreview({ ok: false, error: e instanceof Error ? e.message : String(e) }) })
        .finally(() => { if (reqId.current === id) setChecking(false) })
    }, 450)
    return () => clearTimeout(timer)
  }, [detected?.url, detected?.kind, api]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (nameTouched) return
    setName(preview?.ok ? preview.title ?? '' : detected?.title ?? '')
  }, [preview, detected?.title, nameTouched])

  const reset = () => {
    setUrl('')
    setPreview(null)
    setName('')
    setNameTouched(false)
    setColor(null)
    setTags([])
    setError(null)
  }

  const applyPreset = (p: FeedPreset) => {
    setUrl(p.url)
    setNameTouched(false)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      if (p.select !== undefined) {
        const start = p.select ? p.url.indexOf(p.select) : p.url.length
        el.setSelectionRange(start, start + p.select.length)
      }
    })
  }

  const duplicate = !!(preview && preview.duplicate)
  const canAdd = !!detected && !adding && !duplicate && !!api?.feedAddSource && !checking

  const submit = async () => {
    if (!canAdd || !api) return
    setAdding(true)
    setError(null)
    try {
      const res = await api.feedAddSource(url, interval, {
        ...(name.trim() ? { title: name.trim() } : {}),
        ...(color ? { color } : {}),
        ...(tags.length ? { tags } : {}),
      })
      if (!res.ok) { setError(t(`feed.sources.addError.${res.error}`)); return }
      reset()
      onAdded(res.source.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const kindLabel = (k: string) => t(`feed.sourceKind.${k}`)
  const status = (() => {
    if (!url.trim()) return <span className="text-text-muted">{t('feed.add.hint')}</span>
    if (!detected) return <span className="text-destructive">{t('feed.sources.addError.invalid-url')}</span>
    if (detected.kind === 'x' && !detected.handle) return <span className="text-text-muted">{t('feed.add.xNoHandle')}</span>
    if (checking) return <span className="text-text-secondary"><span aria-hidden className="mr-1 inline-block size-2 animate-pulse rounded-full bg-accent align-middle" />{t('feed.add.checking', { kind: kindLabel(detected.kind) })}</span>
    if (!preview) return null
    if (duplicate) return <span className="text-[var(--warning,#d9a13b)]">{t('feed.sources.addError.duplicate')}</span>
    if (!preview.ok) return <span className="text-destructive">{t('feed.add.failed', { reason: previewErrorText(preview.error, t) })}</span>
    const via = t(`feed.add.via.${preview.via}`)
    return <span className="text-success">{preview.via === 'page' ? t('feed.add.okPage') : t('feed.add.ok', { count: preview.itemCount, kind: kindLabel(preview.kind), via })}</span>
  })()

  return (
    <div className="mx-3 rounded-[10px] bg-foreground/[0.04] p-4" data-testid="feed-add">
      <div className="flex items-baseline gap-2">
        <h3 className="shrink-0 whitespace-nowrap text-[14px] font-semibold">{t('feed.add.title')}</h3>
        <span className="truncate text-[12px] text-text-muted">{t('feed.add.subtitle')}</span>
      </div>
      <form className="flex gap-2 pt-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <input
          ref={inputRef}
          data-testid="feed-source-url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setNameTouched(false) }}
          placeholder={t('feed.sources.placeholder')}
          aria-label={t('feed.sources.placeholder')}
          className={cn(INPUT, 'h-8 flex-1 text-[13px]')}
        />
        <Button type="submit" variant="primary" className="h-8" disabled={!canAdd} data-testid="feed-add-submit">
          <Plus aria-hidden className="size-3.5" />{adding ? t('feed.add.adding') : t('feed.add.submit')}
        </Button>
      </form>
      <p className="min-h-[20px] pt-1 text-[12px]" role="status" data-testid="feed-add-status">{status}</p>

      {!url.trim() ? (
        <div className="flex flex-wrap items-center gap-1 pt-2" data-testid="feed-presets">
          <span className="pr-1 text-[11px] uppercase tracking-wide text-text-muted">{t('feed.presets.title')}</span>
          {FEED_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`feed-preset-${p.id}`}
              onClick={() => applyPreset(p)}
              title={p.url}
              className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-foreground/[0.06] px-2 text-[12px] text-text-secondary outline-none hover:bg-foreground/[0.1] hover:text-foreground"
            >
              <SourceIcon source={{ url: p.url, kind: detectFeedSource(p.url)?.kind ?? 'unknown' }} size={16} />
              {t(`feed.presets.${p.id}`)}
              {p.id === 'x' && !xConnected ? <span className="text-text-muted">· {t('feed.presets.needsToken')}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {preview?.ok && preview.items.length ? (
        <div className="mt-2 rounded-[8px] bg-background/60 p-2" data-testid="feed-add-preview">
          <div className="flex items-center gap-2 px-1 pb-1">
            <SourceIcon source={{ url: preview.url, kind: preview.kind }} size={20} />
            <span className="min-w-0 flex-1 truncate font-semibold">{preview.title ?? preview.url}</span>
            <Badge tone="muted">{kindLabel(preview.kind)}</Badge>
          </div>
          <ol className="flex flex-col">
            {preview.items.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2 rounded-[4px] px-1 py-1 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                {it.at ? <span className="shrink-0 tabular-nums text-text-muted">{fmt(it.at)}</span> : null}
              </li>
            ))}
          </ol>
          {preview.via === 'page' ? <p className="px-1 pt-1 text-[11px] text-text-muted">{t('feed.sources.pageDiffNote')}</p> : null}
        </div>
      ) : null}

      {detected && !checking && preview && !duplicate ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 pt-3 text-[12px]" data-testid="feed-add-options">
          <span className="text-text-muted">{t('feed.add.name')}</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true) }} placeholder={detected.url} aria-label={t('feed.add.name')} className={cn(INPUT, 'w-full')} />
          <span className="text-text-muted">{t('feed.color.label')}</span>
          <ColorPicker value={color} onChange={setColor} />
          <span className="self-start pt-1 text-text-muted">{t('feed.tags.default')}</span>
          <TagEditor value={tags} onChange={setTags} suggestions={suggestions} />
          <span className="text-text-muted">{t('feed.sources.interval')}</span>
          <select aria-label={t('feed.sources.interval')} value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))} className={cn(INPUT, 'w-44 px-1')}>
            {FEED_INTERVALS_MIN.map((m) => <option key={m} value={m}>{intervalLabel(m, t)}</option>)}
          </select>
          {!preview.ok ? <span /> : null}
          {!preview.ok ? <p className="text-[11px] text-text-muted">{t('feed.add.addAnyway')}</p> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="pt-2 text-[12px] text-destructive">{error}</p> : null}
    </div>
  )
}

// ── gallery ─────────────────────────────────────────────────────────────────

function SourceCard({ source, items, now, selected, onSelect, onCheck, onTogglePause, onShowItems, fmt }: {
  source: FeedSource
  items: FeedItem[]
  now: number
  selected: boolean
  onSelect: () => void
  onCheck: () => void
  onTogglePause: () => void
  onShowItems: () => void
  fmt: (at: number) => string
}) {
  const { t } = useTranslation()
  const health = sourceHealth(source)
  const perDay = React.useMemo(() => itemsPerDay(items, source.id, now, SPARK_DAYS), [items, source.id, now])
  const recent = perDay.reduce((a, b) => a + b, 0)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-testid="feed-source-card"
      data-health={health}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={cn(
        'group flex min-w-0 flex-col gap-2 rounded-[10px] p-3 outline-none',
        selected ? 'bg-accent/10 ring-2 ring-inset ring-accent' : 'bg-foreground/[0.04] hover:bg-foreground/[0.07]',
        source.paused && 'opacity-70',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SourceIcon source={source} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <ColorDot color={source.color} />
            <span className="truncate text-[13px] font-semibold">{sourceLabel(source)}</span>
          </div>
          <div className="truncate text-[11px] text-text-muted">{sourceHost(source) ?? source.url}</div>
        </div>
        <HealthDot health={health} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-text-secondary">
        <Badge tone="muted">{t(`feed.sourceKind.${source.kind}`)}</Badge>
        <span>{t('feed.sources.items', { count: source.itemCount ?? 0 })}</span>
        <span aria-hidden className="text-text-muted">·</span>
        <span>{intervalLabel(source.intervalMin, t)}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <Sparkline values={perDay} width={120} label={t('feed.sources.sparkline', { count: recent, days: SPARK_DAYS })} />
        <span className="truncate text-right text-[11px] tabular-nums text-text-muted">
          {source.lastFetchAt ? t('feed.sources.checkedAt', { time: fmt(source.lastFetchAt) }) : t('feed.sources.neverFetched')}
        </span>
      </div>
      {source.lastError && (health === 'error' || health === 'needs-x') ? (
        <p role="alert" className="line-clamp-2 text-[11px] text-destructive">{sourceErrorText(source.lastError, t)}</p>
      ) : null}
      {source.tags?.length ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {source.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-[4px] bg-foreground/[0.06] px-1 text-[11px] text-text-secondary">#{tag}</span>)}
        </div>
      ) : null}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" className="h-6 px-2" disabled={health === 'checking'} onClick={onCheck} data-testid="feed-source-check">
          <RefreshCw aria-hidden className={cn('size-3', health === 'checking' && 'animate-spin')} />{t('feed.sources.check')}
        </Button>
        <Button variant="ghost" className="h-6 px-2" onClick={onTogglePause}>
          {source.paused ? <Play aria-hidden className="size-3" /> : <Pause aria-hidden className="size-3" />}
          {source.paused ? t('feed.sources.resume') : t('feed.sources.pause')}
        </Button>
        <Button variant="ghost" className="ml-auto h-6 px-2" disabled={!source.itemCount} onClick={onShowItems}>{t('feed.sources.showItems')}</Button>
      </div>
    </div>
  )
}

export function SourcesView({ api, sources, items, now, x, suggestions, selectedId, onSelect, onShowItems, reload, fmt }: {
  api: Api | undefined
  sources: FeedSource[]
  items: FeedItem[]
  now: number
  x: XConnectionStatus
  suggestions: string[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShowItems: (id: string) => void
  reload: () => Promise<void>
  fmt: (at: number) => string
}) {
  const { t } = useTranslation()
  const [busyAll, setBusyAll] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (operation: () => Promise<unknown>) => {
    setError(null)
    try { await operation(); await reload() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const update = (id: string, patch: FeedSourcePatch) => run(async () => api?.feedUpdateSource(id, patch))
  const check = (id: string) => run(async () => api?.feedRefresh(id))
  const errors = sources.filter((s) => s.lastStatus === 'error').length
  return (
    <>
      <ListHeader
        title={<span className="whitespace-nowrap">{t('feed.sources.title')}</span>}
        subtitle={sources.length ? `${t('feed.sources.subtitle', { count: sources.length })}${errors ? ` · ${t('feed.sources.withErrors', { count: errors })}` : ''}` : undefined}
        actions={sources.length ? (
          <Button variant="ghost" disabled={busyAll} onClick={() => { setBusyAll(true); void run(async () => api?.feedRefresh(null)).finally(() => setBusyAll(false)) }}>
            <RefreshCw aria-hidden className={cn('size-3', busyAll && 'animate-spin')} />{busyAll ? t('feed.refreshing') : t('feed.sources.refreshAll')}
          </Button>
        ) : null}
      />
      {error ? <p role="alert" className="px-3 pt-2 text-[12px] text-destructive">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4" data-testid="feed-sources">
        <AddSource api={api} sources={sources} suggestions={suggestions} xConnected={x.state === 'connected'} onAdded={(id) => { onSelect(id); void reload() }} fmt={fmt} />
        {sources.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-2 px-3 pt-4" data-testid="feed-source-grid">
            {sources.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                items={items}
                now={now}
                selected={selectedId === s.id}
                onSelect={() => onSelect(s.id)}
                onCheck={() => void check(s.id)}
                onTogglePause={() => void update(s.id, { paused: !s.paused })}
                onShowItems={() => onShowItems(s.id)}
                fmt={fmt}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 pt-4" data-testid="feed-sources-empty">
            <div className="rounded-[10px] bg-foreground/[0.025] p-4">
              <h3 className="text-[14px] font-semibold">{t('feed.sources.emptyTitle')}</h3>
              <ol className="flex flex-col gap-2 pt-3 text-[12px] text-text-secondary">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{n}</span>
                    <span className="pt-0.5">{t(`feed.sources.emptyStep${n}`)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── side pane: one source ───────────────────────────────────────────────────

export function SourceEditor({ api, source, suggestions, reload, onShowItems, onRemoved, fmt, xPanel }: {
  api: Api | undefined
  source: FeedSource | null
  suggestions: string[]
  reload: () => Promise<void>
  onShowItems: (id: string) => void
  onRemoved: () => void
  fmt: (at: number) => string
  xPanel: React.ReactNode
}) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => { setName(source ? sourceLabel(source) : ''); setConfirm(false); setErr(null) }, [source?.id, source?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setErr(null)
    try { await fn(); await reload() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  if (!source) {
    return (
      <div className="flex flex-col px-4 py-4" data-testid="feed-source-help">
        <h2 className="text-[15px] font-semibold">{t('feed.help.title')}</h2>
        <ul className="flex flex-col gap-2 pt-2 text-[12px] text-text-secondary">
          <li>{t('feed.help.detect')}</li>
          <li>{t('feed.help.health')}</li>
          <li>{t('feed.help.labels')}</li>
        </ul>
        <SectionLabel>{t('feed.x.title')}</SectionLabel>
        {xPanel}
      </div>
    )
  }

  const health = sourceHealth(source)
  const patch = (p: FeedSourcePatch) => void run('patch', () => api!.feedUpdateSource(source.id, p))
  const saveName = () => { const v = name.trim(); if (v && v !== sourceLabel(source)) patch({ title: v }) }
  return (
    <div className="flex flex-col px-4 py-4" data-testid="feed-source-detail">
      <div className="flex items-center gap-2">
        <SourceIcon source={source} size={32} />
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
            aria-label={t('feed.sources.rename')}
            title={t('feed.sources.rename')}
            data-testid="feed-source-name"
            className="h-7 w-full rounded-[6px] bg-transparent px-1 text-[15px] font-semibold outline-none hover:bg-foreground/[0.05] focus:bg-foreground/[0.08]"
          />
          <p className="truncate px-1 text-[11px] text-text-muted" title={source.url}>{source.url}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-3">
        <HealthDot health={health} />
        <Badge tone="muted">{t(`feed.sourceKind.${source.kind}`)}</Badge>
        <span className="text-[11px] text-text-muted">{t('feed.sources.items', { count: source.itemCount ?? 0 })}</span>
      </div>
      <p className="pt-2 text-[12px] text-text-secondary">
        {source.lastFetchAt ? t('feed.sources.lastFetch', { time: fmt(source.lastFetchAt) }) : t('feed.sources.neverFetched')}
        {source.lastOkAt && source.lastStatus === 'error' ? ` · ${t('feed.sources.lastOk', { time: fmt(source.lastOkAt) })}` : ''}
      </p>
      {source.lastError ? <p role="alert" className="pt-1 text-[12px] text-destructive">{sourceErrorText(source.lastError, t)}</p> : null}
      {source.kind === 'page' ? <p className="pt-1 text-[11px] text-text-muted">{t('feed.sources.pageDiffNote')}</p> : null}
      {source.feedUrl && source.feedUrl !== source.url ? <p className="break-all pt-1 text-[11px] text-text-muted">{t('feed.sources.feedUrl')}: {source.feedUrl}</p> : null}

      <div className="flex flex-wrap gap-1 pt-3">
        <Button variant="primary" disabled={health === 'checking' || busy === 'check'} onClick={() => void run('check', () => api!.feedRefresh(source.id))} data-testid="feed-source-check-now">
          <RefreshCw aria-hidden className={cn('size-3', (health === 'checking' || busy === 'check') && 'animate-spin')} />
          {health === 'checking' || busy === 'check' ? t('feed.refreshing') : t('feed.sources.checkNow')}
        </Button>
        <Button onClick={() => patch({ paused: !source.paused })}>
          {source.paused ? <Play aria-hidden className="size-3" /> : <Pause aria-hidden className="size-3" />}
          {source.paused ? t('feed.sources.resume') : t('feed.sources.pause')}
        </Button>
        <Button variant="ghost" disabled={!source.itemCount} onClick={() => onShowItems(source.id)}>{t('feed.sources.showItems')}</Button>
        <Button variant="ghost" onClick={() => void api?.openUrl?.(source.url)}><ExternalLink aria-hidden className="size-3" />{t('feed.sources.openSite')}</Button>
      </div>

      <SectionLabel>{t('feed.color.label')}</SectionLabel>
      <ColorPicker value={source.color} onChange={(c) => patch({ color: c })} testId="feed-source-color" />
      <p className="pt-1 text-[11px] text-text-muted">{t('feed.color.sourceHint')}</p>

      <SectionLabel>{t('feed.tags.default')}</SectionLabel>
      <TagEditor value={source.tags ?? []} onChange={(tags) => patch({ tags })} suggestions={suggestions} testId="feed-source-tags" />

      <SectionLabel>{t('feed.sources.interval')}</SectionLabel>
      <select
        aria-label={t('feed.sources.interval')}
        value={source.intervalMin}
        onChange={(e) => patch({ intervalMin: Number(e.target.value) })}
        className={cn(INPUT, 'w-44 px-1')}
      >
        {intervalOptions(source.intervalMin).map((m) => <option key={m} value={m}>{intervalLabel(m, t)}</option>)}
      </select>
      {source.paused ? <p className="pt-1 text-[11px] text-text-muted">{t('feed.sources.pausedNote')}</p> : null}

      <div className="pt-6">
        {confirm ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-text-secondary">{t('feed.sources.removeConfirm')}</span>
            <Button variant="danger" data-testid="feed-source-remove-confirm" onClick={() => void run('rm', async () => { await api!.feedRemoveSource(source.id); onRemoved() })}>{t('feed.sources.remove')}</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>{t('feed.cancel')}</Button>
          </div>
        ) : (
          <Button variant="danger" data-testid="feed-source-remove" onClick={() => setConfirm(true)}><Trash2 aria-hidden className="size-3" />{t('feed.sources.remove')}</Button>
        )}
      </div>
      {err ? <p role="alert" className="pt-2 text-[12px] text-destructive">{err}</p> : null}
    </div>
  )
}
