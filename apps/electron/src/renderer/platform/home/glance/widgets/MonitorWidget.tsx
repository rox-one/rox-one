/** Site monitor: up/down per URL via home-fetch (any HTTP answer < 400 is up). */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { HomeFetchErrorReason } from '../../../../../shared/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { StatusDot, relTime, useOnScreen } from './net/kit'
import { safeLink } from './net/parsers'
import { openExternalSafe } from '../open-external'

/** Too-large still means the server answered. Offline says nothing about the site. */
export function siteState(hasData: boolean, error: HomeFetchErrorReason | null): boolean | null {
  if (error === 'too-large') return true
  if (error === 'offline' || error === 'rate-limited') return null
  if (error) return false
  return hasData ? true : null
}

function Site({ title, url, paused }: { title: string; url: string; paused: boolean }) {
  const { t, i18n } = useTranslation()
  const s = useHomeFetch<string>(url, { as: 'text', refreshMs: 5 * 60_000, paused })
  const ok = siteState(s.data !== null && !s.error, s.error)
  const host = (() => { try { return new URL(url).host } catch { return url } })()
  return (
    <li>
      <a href={url} onClick={(e) => { e.preventDefault(); openExternalSafe(url) }} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-surface-hover" data-glance-site={ok === null ? 'unknown' : ok ? 'up' : 'down'}>
        <StatusDot ok={ok} title={ok === false ? s.error ?? '' : undefined} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{title || host}</span>
        <span className="shrink-0 truncate text-xs text-muted-foreground">{ok === false ? t('common.unavailable') : relTime(s.fetchedAt ?? undefined, i18n.language)}</span>
      </a>
    </li>
  )
}

export default function MonitorWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const sites = (Array.isArray(config.links) ? (config.links as { title: string; url: string }[]) : [])
    .map((l) => ({ title: l.title, url: safeLink(l.url) }))
    .filter((l): l is { title: string; url: string } => !!l.url?.startsWith('https://'))
    .slice(0, 20)
  if (sites.length === 0) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return (
    <div ref={ref} className="min-h-[1px]">
      <ul className="flex flex-col gap-0.5" data-glance-monitor="">
        {sites.map((s) => <Site key={s.url} title={s.title} url={s.url} paused={!visible} />)}
      </ul>
    </div>
  )
}
