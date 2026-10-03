/**
 * Лента — small presentational parts: color labels, tag editor, sparkline,
 * source icon, health dot. Flat and borderless; colors never carry meaning
 * alone (every swatch has a name in aria-label/title, the selected one gets
 * a check glyph and a solid ring in high contrast).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FEED_COLORS, FEED_MAX_TAGS, normalizeFeedTags, type FeedColor, type FeedSource, type FeedSourceKind } from '@rox/shared/feed'
import { Check, Github, Globe, Rss, X as XIcon, Youtube, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sourceHost, type SourceHealth } from './feed-model'

/** Label hues, readable on both light and dark backgrounds. */
export const FEED_COLOR_HEX: Record<FeedColor, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#e2a336',
  green: '#30a46c',
  blue: '#0090ff',
  violet: '#8e4ec6',
  gray: '#8b8d98',
}

const HC_RING = '[html[data-contrast=high]_&]:ring-foreground'

export function ColorDot({ color, size = 8, className }: { color?: FeedColor; size?: number; className?: string }) {
  const { t } = useTranslation()
  if (!color) return null
  return (
    <span
      role="img"
      aria-label={t(`feed.color.${color}`)}
      title={t(`feed.color.${color}`)}
      className={cn('inline-block shrink-0 rounded-full ring-1 ring-foreground/20', HC_RING, className)}
      style={{ width: size, height: size, background: FEED_COLOR_HEX[color] }}
    />
  )
}

/** Row of swatches; `multi` = filter mode (set), otherwise single choice with «none». */
export function ColorPicker({
  value,
  onChange,
  allowNone = true,
  testId,
  size = 16,
}: {
  value: FeedColor | undefined | null
  onChange: (next: FeedColor | null) => void
  allowNone?: boolean
  testId?: string
  size?: number
}) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" aria-label={t('feed.color.label')} className="flex flex-wrap items-center gap-1" data-testid={testId}>
      {allowNone ? (
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          aria-label={t('feed.color.none')}
          title={t('feed.color.none')}
          onClick={() => onChange(null)}
          className={cn(
            'grid place-items-center rounded-full text-text-muted ring-1 ring-foreground/25 outline-none',
            HC_RING,
            !value && 'ring-2 ring-foreground',
          )}
          style={{ width: size, height: size }}
        >
          <span aria-hidden className="block h-px w-2/3 rotate-45 bg-current" />
        </button>
      ) : null}
      {FEED_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t(`feed.color.${c}`)}
          title={t(`feed.color.${c}`)}
          onClick={() => onChange(value === c && allowNone ? null : c)}
          className={cn('grid place-items-center rounded-full text-white outline-none ring-1 ring-foreground/20', HC_RING, value === c && 'ring-2 ring-foreground')}
          style={{ width: size, height: size, background: FEED_COLOR_HEX[c] }}
        >
          {value === c ? <Check aria-hidden className="size-2.5" strokeWidth={3} /> : null}
        </button>
      ))}
    </div>
  )
}

/** Multi-select color filter (toolbar). */
export function ColorFilter({ value, onToggle, counts }: { value: ReadonlySet<FeedColor>; onToggle: (c: FeedColor) => void; counts?: Partial<Record<FeedColor, number>> }) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('feed.filter.color')} className="flex items-center gap-1" data-testid="feed-color-filter">
      {FEED_COLORS.map((c) => {
        const on = value.has(c)
        const n = counts?.[c] ?? 0
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            aria-label={`${t(`feed.color.${c}`)}${n ? ` · ${n}` : ''}`}
            title={`${t(`feed.color.${c}`)}${n ? ` · ${n}` : ''}`}
            onClick={() => onToggle(c)}
            className={cn(
              'grid size-4 place-items-center rounded-full text-white outline-none ring-1 ring-foreground/20',
              HC_RING,
              on ? 'ring-2 ring-foreground' : !n && 'opacity-40',
            )}
            style={{ background: FEED_COLOR_HEX[c] }}
          >
            {on ? <Check aria-hidden className="size-2.5" strokeWidth={3} /> : null}
          </button>
        )
      })}
    </div>
  )
}

export function TagChip({ tag, onRemove, onClick, muted, active }: { tag: string; onRemove?: () => void; onClick?: () => void; muted?: boolean; active?: boolean }) {
  const { t } = useTranslation()
  const body = (
    <>
      <span aria-hidden className="text-text-muted">#</span>
      <span className="truncate">{tag}</span>
    </>
  )
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-[160px] shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] px-1 text-[11px]',
        active ? 'bg-accent/15 font-semibold text-foreground' : muted ? 'bg-foreground/[0.04] text-text-muted' : 'bg-foreground/[0.07] text-text-secondary',
      )}
    >
      {onClick ? <button type="button" onClick={onClick} className="inline-flex min-w-0 items-center gap-0.5 outline-none">{body}</button> : body}
      {onRemove ? (
        <button type="button" aria-label={t('feed.tags.remove', { tag })} title={t('feed.tags.remove', { tag })} onClick={onRemove} className="-mr-0.5 grid size-4 place-items-center rounded-[var(--radius-control)] text-text-muted outline-none hover:text-foreground">
          <XIcon aria-hidden className="size-3" />
        </button>
      ) : null}
    </span>
  )
}

/** Free-form tags + suggestions. Enter or comma adds; Backspace on empty removes the last one. */
export function TagEditor({ value, onChange, suggestions, testId, inherited }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[]; testId?: string; inherited?: string[] }) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState('')
  const add = (raw: string) => {
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean)
    if (!parts.length) return
    onChange(normalizeFeedTags([...value, ...parts]))
    setDraft('')
  }
  const full = value.length >= FEED_MAX_TAGS
  const lowered = new Set([...value, ...(inherited ?? [])].map((x) => x.toLowerCase()))
  const q = draft.trim().toLowerCase()
  const sugg = suggestions.filter((s) => !lowered.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q))).slice(0, 8)
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((tag) => <TagChip key={tag} tag={tag} onRemove={() => onChange(value.filter((x) => x !== tag))} />)}
        {(inherited ?? []).filter((x) => !value.some((v) => v.toLowerCase() === x.toLowerCase())).map((tag) => (
          <span key={`i-${tag}`} title={t('feed.tags.fromSource')}><TagChip tag={tag} muted /></span>
        ))}
        <input
          value={draft}
          disabled={full}
          onChange={(e) => {
            const v = e.target.value
            if (v.includes(',')) add(v)
            else setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(draft) }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => { if (draft.trim()) add(draft) }}
          placeholder={full ? t('feed.tags.full') : t('feed.tags.placeholder')}
          aria-label={t('feed.tags.placeholder')}
          className="h-6 min-w-[120px] flex-1 rounded-[var(--radius-control)] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
        />
      </div>
      {sugg.length && !full ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-text-muted">{t('feed.tags.suggested')}</span>
          {sugg.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex h-5 items-center rounded-[var(--radius-control)] px-1 text-[11px] text-text-secondary outline-none hover:bg-foreground/[0.07] hover:text-foreground">
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Sparkline({ values, width = 84, height = 20, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  const max = Math.max(1, ...values)
  const slot = width / Math.max(1, values.length)
  const bw = Math.max(1, Math.floor(slot) - 1)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0 text-accent">
      <title>{label}</title>
      {values.map((v, i) => {
        const h = v ? Math.max(2, Math.round((v / max) * (height - 2))) : 1
        return <rect key={i} x={Math.round(i * slot)} y={height - h} width={bw} height={h} rx={bw > 2 ? 1 : 0} fill="currentColor" opacity={v ? 0.9 : 0.25} />
      })}
    </svg>
  )
}

const KIND_ICON: Record<FeedSourceKind, LucideIcon> = {
  rss: Rss,
  atom: Rss,
  youtube: Youtube,
  github: Github,
  x: XIcon,
  page: Globe,
  unknown: Globe,
}

const KIND_TINT: Record<FeedSourceKind, string> = {
  rss: '#f76b15',
  atom: '#f76b15',
  youtube: '#e5484d',
  github: 'var(--foreground)',
  x: 'var(--foreground)',
  page: '#0090ff',
  unknown: '#8b8d98',
}

/** Favicon of the site with a type glyph fallback (and underneath while loading). */
export function SourceIcon({ source, size = 28 }: { source: Pick<FeedSource, 'url' | 'kind'>; size?: number }) {
  const [failed, setFailed] = React.useState(false)
  const host = sourceHost(source)
  const Icon = KIND_ICON[source.kind] ?? Globe
  const useFavicon = !!host && !failed && source.kind !== 'x'
  return (
    <span
      aria-hidden
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] bg-foreground/[0.06]"
      style={{ width: size, height: size, color: KIND_TINT[source.kind] }}
    >
      <Icon className="size-[55%]" aria-hidden />
      {useFavicon ? (
        <img
          src={`https://${host}/favicon.ico`}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={(e) => { if ((e.currentTarget.naturalWidth || 0) < 8) setFailed(true) }}
          className="absolute inset-0 m-auto bg-background object-contain"
          style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
        />
      ) : null}
    </span>
  )
}

const HEALTH_CLS: Record<SourceHealth, string> = {
  checking: 'bg-accent animate-pulse',
  ok: 'bg-success',
  error: 'bg-destructive',
  paused: 'bg-text-muted',
  pending: 'bg-text-muted animate-pulse',
  'needs-x': 'bg-[var(--warning,#d9a13b)]',
}

export function HealthDot({ health }: { health: SourceHealth }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary" data-health={health}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', HEALTH_CLS[health])} />
      {t(`feed.health.${health}`)}
    </span>
  )
}
