/**
 * Shared bits for network widgets: on-screen detection (polling pauses when
 * the card or the whole Home surface is hidden), status line and item list.
 * Kept small: it ships inside every network widget chunk.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, RotateCw } from 'lucide-react'
import type { HomeFetchErrorReason } from '../../../../../../shared/home-fetch'
import { openExternalSafe } from '../../open-external'
import type { FeedItem } from './parsers'

/**
 * True while the element is laid out and intersects the viewport. A Home
 * surface hidden by keep-alive (display:none) or scrolled away reads false,
 * so `useHomeFetch(..., { paused: !visible })` stops polling.
 */
export function useOnScreen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T | null>(null)
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, visible]
}

export function NetStatus({ error, hasData, onRetry }: { error: HomeFetchErrorReason | null; hasData: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  if (!error) return null
  const text = error === 'offline' ? t('dashboard.syncOffline') : error === 'rate-limited' ? t('glance.net.limited') : t('auth.somethingWentWrong')
  return (
    <div className={hasData ? 'mb-1 flex items-center gap-1 text-xs text-muted-foreground' : 'flex items-center gap-2 py-2 text-sm text-muted-foreground'} role="status" data-glance-net-error={error}>
      <span className="truncate">{text}</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1 hover:bg-surface-hover hover:text-foreground">
        <RotateCw className="icon-caption" />
        {t('automations.retry')}
      </button>
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" data-glance-skeleton="">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded-[var(--radius-control)] bg-surface-hover" style={{ width: `${90 - ((i * 17) % 35)}%` }} />
      ))}
    </div>
  )
}

export function relTime(at: number | undefined, locale: string, now = Date.now()): string {
  if (!at) return ''
  const diff = Math.round((at - now) / 1000)
  const abs = Math.abs(diff)
  const [v, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 3600 ? [Math.round(diff / 60), 'minute'] : abs < 86400 ? [Math.round(diff / 3600), 'hour'] : [Math.round(diff / 86400), 'day']
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' }).format(v, unit)
  } catch {
    return ''
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export function FeedList({ items, collapseAfter = 0 }: { items: readonly FeedItem[]; collapseAfter?: number }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = React.useState(false)
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t('entities.ui.tree.empty')}</p>
  const shown = collapseAfter > 0 && !open ? items.slice(0, collapseAfter) : items
  return (
    <>
      <ul className="flex flex-col gap-1" data-glance-feed="">
        {shown.map((item) => {
          const meta = [item.score !== undefined ? `▲ ${item.score}` : '', item.meta ?? hostOf(item.url), relTime(item.at, i18n.language)].filter(Boolean).join(' · ')
          return (
            <li key={item.id} className="group/item flex min-w-0 items-start gap-2">
              <a
                href={item.url}
                onClick={(e) => { e.preventDefault(); openExternalSafe(item.url) }}
                className="min-w-0 flex-1 rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-surface-hover"
                title={item.url}
              >
                <span className="line-clamp-2 text-sm font-bold text-foreground">{item.title}</span>
                {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
              </a>
              {item.commentsUrl && item.commentsUrl !== item.url && (
                <a
                  href={item.commentsUrl}
                  onClick={(e) => { e.preventDefault(); openExternalSafe(item.commentsUrl!) }}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] px-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  aria-label={t('entities.ui.comments.title')}
                >
                  <MessageSquare className="icon-caption" />
                  {item.comments ?? ''}
                </a>
              )}
            </li>
          )
        })}
      </ul>
      {collapseAfter > 0 && items.length > collapseAfter && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
          {open ? t('glance.net.less') : t('glance.net.more', { count: items.length - collapseAfter })}
        </button>
      )}
    </>
  )
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}
