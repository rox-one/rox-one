import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { SingleFeed } from './net/SingleFeed'
import { clampInt } from './net/kit'
import { parseLobsters, type FeedItem } from './net/parsers'

export function lobstersUrl(sort: unknown, tag: unknown): string {
  const t = typeof tag === 'string' && /^[a-z0-9_-]{1,25}$/i.test(tag.trim()) ? tag.trim().toLowerCase() : ''
  if (t) return `https://lobste.rs/t/${t}.json`
  return sort === 'new' ? 'https://lobste.rs/newest.json' : 'https://lobste.rs/hottest.json'
}

export default function LobstersWidget({ config }: GlanceWidgetProps) {
  const limit = clampInt(config.limit, 1, 50, 15)
  const parse = React.useCallback((raw: unknown): FeedItem[] => parseLobsters(raw).slice(0, limit), [limit])
  return <SingleFeed url={lobstersUrl(config.sort, config.tag)} parse={parse} refreshMs={10 * 60_000} collapseAfter={clampInt(config.collapseAfter, 0, 50, 5)} />
}
