/**
 * Extension widget: any HTTPS endpoint that returns the small Rox widget JSON
 * format — { "title"?, "text"?, "items"?: [{ "title", "url"?, "meta"? }] }.
 * Rendered as text only: remote HTML is never injected.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { FeedList, ListSkeleton, NetStatus, clampInt, useOnScreen } from './net/kit'
import { safeLink, type FeedItem } from './net/parsers'

export function parseExtension(raw: unknown): { text: string; items: FeedItem[] } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const text = typeof v.text === 'string' ? v.text.slice(0, 2000) : ''
  const items: FeedItem[] = []
  for (const [i, it] of (Array.isArray(v.items) ? v.items : []).slice(0, 50).entries()) {
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.slice(0, 300) : ''
    if (!title) continue
    const url = safeLink(r.url) ?? ''
    items.push({ id: `${i}:${title}`, title, url, ...(typeof r.meta === 'string' ? { meta: r.meta.slice(0, 160) } : {}) })
  }
  return text || items.length ? { text, items } : null
}

export default function ExtensionWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const url = safeLink(config.url)
  const s = useHomeFetch<unknown>(url?.startsWith('https://') ? url : null, { as: 'json', refreshMs: clampInt(config.refreshMin, 1, 1440, 15) * 60_000, paused: !visible })
  const ext = s.data ? parseExtension(s.data) : null
  if (!url) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-extension="">
      <NetStatus error={s.error ?? (s.data && !ext ? 'invalid' : null)} hasData={!!ext} onRetry={s.refresh} />
      {ext ? (
        <>
          {ext.text && <p className="mb-1 whitespace-pre-wrap text-sm text-foreground">{ext.text}</p>}
          {ext.items.some((i) => i.url) && <FeedList items={ext.items.filter((i) => i.url)} />}
          {ext.items.some((i) => !i.url) && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {ext.items.filter((i) => !i.url).map((i) => (
                <li key={i.id} className="truncate text-sm text-foreground">{i.title}{i.meta ? <span className="text-xs text-muted-foreground"> · {i.meta}</span> : null}</li>
              ))}
            </ul>
          )}
        </>
      ) : !s.error && !s.data && <ListSkeleton rows={3} />}
    </div>
  )
}
