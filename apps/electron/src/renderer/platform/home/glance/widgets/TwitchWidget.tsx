/**
 * Twitch channels: live / offline. Twitch's Helix API needs an app token, so
 * this reads DecAPI's public plain-text uptime endpoint through home-fetch.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { GlanceWidgetProps } from '../registry'
import { MultiFeed } from './net/MultiFeed'
import { cleanTwitchLogin, type FeedItem } from './net/parsers'
import { openExternalSafe } from '../open-external'

export function twitchUptimeUrl(login: string): string {
  return `https://decapi.me/twitch/uptime/${login}`
}

/** DecAPI answers "<login> is offline", an error sentence, or a duration. */
export function parseTwitchUptime(raw: unknown, url: string): FeedItem[] {
  const login = url.slice(url.lastIndexOf('/') + 1)
  if (typeof raw !== 'string' || !login) return []
  const text = raw.trim().slice(0, 120)
  const offline = !text || /offline|not found|error|invalid|no user/i.test(text)
  return [{ id: login, title: login, url: `https://www.twitch.tv/${login}`, ...(offline ? {} : { meta: text, score: 1 }) }]
}

export default function TwitchWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const urls = React.useMemo(
    () => [...new Set((Array.isArray(config.channels) ? config.channels : []).map(cleanTwitchLogin).filter((c): c is string => !!c))].slice(0, 20).map(twitchUptimeUrl),
    [config.channels],
  )
  const render = (items: FeedItem[]) => (
    <ul className="flex flex-col gap-0.5" data-glance-twitch="">
      {[...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((c) => (
        <li key={c.id}>
          <a href={c.url} onClick={(e) => { e.preventDefault(); openExternalSafe(c.url) }} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-surface-hover">
            <span className={c.score ? 'size-2 shrink-0 rounded-full bg-destructive' : 'size-2 shrink-0 rounded-full bg-muted-foreground/40'} aria-hidden />
            <span className="truncate text-sm font-bold text-foreground">{c.title}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">{c.score ? `${t('glance.net.live')} · ${c.meta}` : t('messenger.presence.offline')}</span>
          </a>
        </li>
      ))}
    </ul>
  )
  return <MultiFeed urls={urls} as="text" parse={parseTwitchUptime} refreshMs={5 * 60_000} limit={20} sort={false} render={render} />
}
