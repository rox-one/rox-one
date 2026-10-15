import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { SingleFeed } from './net/SingleFeed'
import { clampInt } from './net/kit'
import { parseHackerNews } from './net/parsers'

const TAGS: Record<string, string> = { top: 'front_page', new: 'story', show: 'show_hn', ask: 'ask_hn' }

export function hackerNewsUrl(feed: unknown, limit: number): string {
  const tag = TAGS[typeof feed === 'string' ? feed : 'top'] ?? TAGS.top!
  const endpoint = feed === 'new' ? 'search_by_date' : 'search'
  return `https://hn.algolia.com/api/v1/${endpoint}?tags=${tag}&hitsPerPage=${limit}`
}

export default function HackerNewsWidget({ config }: GlanceWidgetProps) {
  const limit = clampInt(config.limit, 1, 50, 15)
  return <SingleFeed url={hackerNewsUrl(config.feed, limit)} parse={parseHackerNews} refreshMs={10 * 60_000} collapseAfter={clampInt(config.collapseAfter, 0, 50, 5)} />
}
