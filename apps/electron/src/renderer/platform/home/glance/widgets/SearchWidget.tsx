/**
 * Web search (Exa) through the main process: the key never reaches the
 * renderer. A saved query refreshes hourly while visible; the box runs ad-hoc
 * searches. Without a configured key the widget says so and stays idle.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { homeFetchApi } from '@/lib/home-fetch'
import type { HomeFetchErrorReason, HomeSearchHit } from '../../../../../shared/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { FeedList, ListSkeleton, NetStatus, clampInt, useOnScreen } from './net/kit'
import { safeLink, type FeedItem } from './net/parsers'

export function hitsToItems(hits: readonly HomeSearchHit[]): FeedItem[] {
  const out: FeedItem[] = []
  for (const h of hits) {
    const url = safeLink(h.url)
    if (!url || typeof h.title !== 'string') continue
    const at = h.publishedDate ? Date.parse(h.publishedDate) : NaN
    out.push({ id: url, title: h.title.slice(0, 300) || url, url, ...(Number.isFinite(at) ? { at } : {}), ...(h.snippet ? { meta: h.snippet.slice(0, 160) } : {}) })
  }
  return out
}

export default function SearchWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const saved = typeof config.query === 'string' ? config.query.trim().slice(0, 500) : ''
  const [draft, setDraft] = React.useState('')
  const [query, setQuery] = React.useState(saved)
  const [state, setState] = React.useState<{ items: FeedItem[] | null; error: HomeFetchErrorReason | null; loading: boolean }>({ items: null, error: null, loading: false })
  const num = clampInt(config.limit, 1, 20, 8)
  const seq = React.useRef(0)
  React.useEffect(() => setQuery(saved), [saved])
  const run = React.useCallback(async (q: string) => {
    const api = homeFetchApi()
    if (!q) return
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true }))
    const res = api ? await api.search({ query: q, numResults: num }).catch(() => null) : null
    if (id !== seq.current) return
    if (res?.status === 'ok') setState({ items: hitsToItems(res.data), error: null, loading: false })
    else setState((s) => ({ items: res?.status === 'error' && res.cached ? hitsToItems(res.cached.data) : s.items, error: res?.status === 'error' ? res.reason : 'network', loading: false }))
  }, [num])
  React.useEffect(() => {
    if (!query || !visible) return
    void run(query)
    if (query !== saved) return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void run(query) }, 60 * 60_000)
    return () => clearInterval(timer)
  }, [query, run, saved, visible])
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-search="">
      <form className="mb-2 flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const q = draft.trim(); if (q) setQuery(q) }}>
        <Search className="icon-caption shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={saved || t('feed.search')}
          aria-label={t('feed.search')}
          maxLength={500}
          className="h-7 min-w-0 flex-1 rounded-[var(--radius-control)] bg-surface-hover px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </form>
      {state.error === 'no-key' ? (
        <p className="text-sm text-muted-foreground" role="status">{t('glance.net.noKey')}</p>
      ) : (
        <>
          <NetStatus error={state.error} hasData={!!state.items} onRetry={() => void run(query)} />
          {state.items ? <FeedList items={state.items} /> : state.loading ? <ListSkeleton /> : null}
        </>
      )}
    </div>
  )
}
