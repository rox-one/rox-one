/** YouTube: latest uploads from channel Atom feeds (no API key). */
import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { MultiFeed } from './net/MultiFeed'
import { clampInt } from './net/kit'
import { cleanYoutubeChannel, parseFeed } from './net/parsers'

const parse = (raw: unknown, url: string) => (typeof raw === 'string' ? parseFeed(raw, url).items : [])

export function youtubeUrls(channels: unknown): string[] {
  const ids = (Array.isArray(channels) ? channels : []).map(cleanYoutubeChannel).filter((c): c is string => !!c)
  return [...new Set(ids)].slice(0, 12).map((id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)
}

export default function YoutubeWidget({ config }: GlanceWidgetProps) {
  const urls = React.useMemo(() => youtubeUrls(config.channels), [config.channels])
  return <MultiFeed urls={urls} as="text" parse={parse} refreshMs={30 * 60_000} limit={clampInt(config.limit, 1, 50, 15)} collapseAfter={clampInt(config.collapseAfter, 0, 50, 5)} />
}
