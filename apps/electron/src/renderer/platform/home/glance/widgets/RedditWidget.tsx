import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { SingleFeed } from './net/SingleFeed'
import { clampInt } from './net/kit'
import { cleanSubreddit, parseReddit } from './net/parsers'

const SORTS = new Set(['hot', 'new', 'top'])

export function redditUrl(subreddit: unknown, sort: unknown, limit: number): string | null {
  const name = typeof subreddit === 'string' ? cleanSubreddit(subreddit) : null
  if (!name) return null
  const s = typeof sort === 'string' && SORTS.has(sort) ? sort : 'hot'
  return `https://www.reddit.com/r/${name}/${s}.json?limit=${limit}${s === 'top' ? '&t=day' : ''}&raw_json=1`
}

export default function RedditWidget({ config }: GlanceWidgetProps) {
  const limit = clampInt(config.limit, 1, 50, 15)
  return <SingleFeed url={redditUrl(config.subreddit, config.sort, limit)} parse={parseReddit} refreshMs={10 * 60_000} collapseAfter={clampInt(config.collapseAfter, 0, 50, 5)} />
}
