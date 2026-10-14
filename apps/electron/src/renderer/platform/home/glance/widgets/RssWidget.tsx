/** RSS / Atom: several feeds fetched as text, merged newest-first. */
import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { MultiFeed } from './net/MultiFeed'
import { clampInt } from './net/kit'
import { parseFeed, safeLink } from './net/parsers'

const parse = (raw: unknown, url: string) => (typeof raw === 'string' ? parseFeed(raw, url).items : [])

export function feedUrls(value: unknown, max = 12): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map((f) => safeLink(f)).filter((f): f is string => !!f))].slice(0, max)
}

export default function RssWidget({ config }: GlanceWidgetProps) {
  const urls = React.useMemo(() => feedUrls(config.feeds), [config.feeds])
  return <MultiFeed urls={urls} as="text" parse={parse} refreshMs={15 * 60_000} limit={clampInt(config.limit, 1, 100, 20)} collapseAfter={clampInt(config.collapseAfter, 0, 100, 5)} />
}
