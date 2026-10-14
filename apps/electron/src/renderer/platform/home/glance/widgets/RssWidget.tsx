/**
 * RSS / Atom: several feeds fetched as text through home-fetch, merged
 * newest-first. One hidden child per feed keeps each on its own cache entry.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { GlanceWidgetProps } from '../registry'
import { useHomeFetch } from '@/lib/home-fetch'
import { FeedList, ListSkeleton, NetStatus, clampInt, useOnScreen } from './net/kit'
import { mergeFeeds, parseFeed, safeLink, type FeedItem } from './net/parsers'
import type { HomeFetchErrorReason } from '../../../../../shared/home-fetch'

type Slot = { items: FeedItem[] | null; error: HomeFetchErrorReason | null; refresh: () => void }

function FeedSource({ url, paused, onState }: { url: string; paused: boolean; onState: (url: string, slot: Slot) => void }) {
  const s = useHomeFetch<string>(url, { as: 'text', refreshMs: 15 * 60_000, paused })
  const items = React.useMemo(() => (typeof s.data === 'string' ? parseFeed(s.data, url).items : null), [s.data, url])
  React.useEffect(() => onState(url, { items, error: s.error, refresh: s.refresh }), [items, onState, s.error, s.refresh, url])
  return null
}

export default function RssWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const feeds = React.useMemo(
    () => [...new Set((Array.isArray(config.feeds) ? config.feeds : []).map((f) => safeLink(f)).filter((f): f is string => !!f))].slice(0, 12),
    [config.feeds],
  )
  const [slots, setSlots] = React.useState<Record<string, Slot>>({})
  const onState = React.useCallback((url: string, slot: Slot) => setSlots((s) => ({ ...s, [url]: slot })), [])
  const limit = clampInt(config.limit, 1, 100, 20)
  const live = feeds.map((f) => slots[f]).filter((s): s is Slot => !!s)
  const lists = live.map((s) => s.items).filter((i): i is FeedItem[] => !!i)
  const items = mergeFeeds(lists, limit)
  const failed = live.find((s) => s.error)
  return (
    <div ref={ref} className="min-h-[1px]">
      {feeds.map((url) => <FeedSource key={url} url={url} paused={!visible} onState={onState} />)}
      {failed && <NetStatus error={failed.error} hasData={lists.length > 0} onRetry={() => live.forEach((s) => s.error && s.refresh())} />}
      {feeds.length === 0 ? <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p> : lists.length > 0 ? <FeedList items={items} collapseAfter={clampInt(config.collapseAfter, 0, 100, 5)} /> : !failed && <ListSkeleton />}
    </div>
  )
}
