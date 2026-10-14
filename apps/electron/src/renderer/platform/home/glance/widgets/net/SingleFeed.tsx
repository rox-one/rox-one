/** One JSON/text source → parsed items → list, with skeleton / error states. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import { FeedList, ListSkeleton, NetStatus, useOnScreen } from './kit'
import type { FeedItem } from './parsers'

export function SingleFeed({ url, as = 'json', parse, refreshMs, collapseAfter }: {
  url: string | null
  as?: 'json' | 'text'
  parse: (raw: unknown) => FeedItem[]
  refreshMs: number
  collapseAfter?: number
}) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const state = useHomeFetch<unknown>(url, { as, refreshMs, paused: !visible })
  const items = React.useMemo(() => (state.data == null ? null : parse(state.data)), [state.data, parse])
  if (!url) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return (
    <div ref={ref} className="min-h-[1px]">
      <NetStatus error={state.error} hasData={!!items} onRetry={state.refresh} />
      {items ? <FeedList items={items} {...(collapseAfter ? { collapseAfter } : {})} /> : !state.error && <ListSkeleton />}
    </div>
  )
}
