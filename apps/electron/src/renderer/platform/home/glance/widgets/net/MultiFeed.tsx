/**
 * Several sources → one merged list. One invisible child per source keeps
 * each on its own home-fetch cache entry and poll timer.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { HomeFetchErrorReason } from '../../../../../../shared/home-fetch'
import { FeedList, ListSkeleton, NetStatus, useOnScreen } from './kit'
import { mergeFeeds, type FeedItem } from './parsers'

type Slot = { items: FeedItem[] | null; error: HomeFetchErrorReason | null; refresh: () => void }

function Source({ url, as, parse, refreshMs, paused, onState }: {
  url: string
  as: 'json' | 'text'
  parse: (raw: unknown, url: string) => FeedItem[]
  refreshMs: number
  paused: boolean
  onState: (url: string, slot: Slot) => void
}) {
  const s = useHomeFetch<unknown>(url, { as, refreshMs, paused })
  const items = React.useMemo(() => (s.data == null ? null : parse(s.data, url)), [s.data, parse, url])
  React.useEffect(() => onState(url, { items, error: s.error, refresh: s.refresh }), [items, onState, s.error, s.refresh, url])
  return null
}

export function MultiFeed({ urls, as, parse, refreshMs, limit, collapseAfter, sort = true, render }: {
  urls: readonly string[]
  as: 'json' | 'text'
  parse: (raw: unknown, url: string) => FeedItem[]
  refreshMs: number
  limit: number
  collapseAfter?: number
  /** Merge newest-first (default) or keep source order. */
  sort?: boolean
  render?: (items: FeedItem[]) => React.ReactNode
}) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const [slots, setSlots] = React.useState<Record<string, Slot>>({})
  const onState = React.useCallback((url: string, slot: Slot) => setSlots((s) => ({ ...s, [url]: slot })), [])
  const live = urls.map((u) => slots[u]).filter((s): s is Slot => !!s)
  const lists = live.map((s) => s.items).filter((i): i is FeedItem[] => !!i)
  const items = sort ? mergeFeeds(lists, limit) : lists.flat().slice(0, limit)
  const failed = live.find((s) => s.error)
  if (urls.length === 0) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return (
    <div ref={ref} className="min-h-[1px]">
      {urls.map((url) => <Source key={url} url={url} as={as} parse={parse} refreshMs={refreshMs} paused={!visible} onState={onState} />)}
      {failed && <NetStatus error={failed.error} hasData={lists.length > 0} onRetry={() => live.forEach((s) => s.error && s.refresh())} />}
      {lists.length > 0 ? (render ? render(items) : <FeedList items={items} {...(collapseAfter ? { collapseAfter } : {})} />) : !failed && <ListSkeleton />}
    </div>
  )
}
