/** iCal (.ics) calendar: upcoming events, recurring ones expanded. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { ListSkeleton, NetStatus, clampInt, useOnScreen } from './net/kit'
import { parseIcal, type CalEvent } from './net/data'
import { safeLink } from './net/parsers'
import { openExternalSafe } from '../open-external'

/** webcal:// is the usual share link; fetch it as https. */
export function icalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/^webcals?:\/\//i, 'https://')
  const url = safeLink(v)
  return url?.startsWith('https://') ? url : null
}

export default function CalendarWidget({ config }: GlanceWidgetProps) {
  const { t, i18n } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const url = icalUrl(config.url)
  const days = clampInt(config.days, 1, 60, 14)
  const s = useHomeFetch<string>(url, { as: 'text', refreshMs: 30 * 60_000, paused: !visible })
  const now = Date.now()
  const events = React.useMemo(
    () => (typeof s.data === 'string' ? parseIcal(s.data, now - 60 * 60_000, now + days * 86_400_000, clampInt(config.limit, 1, 50, 10)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-read when data changes
    [s.data, days, config.limit],
  )
  if (!url) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  const dayFmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const groups = new Map<string, CalEvent[]>()
  for (const e of events ?? []) {
    const key = dayFmt.format(e.start)
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-calendar="">
      <NetStatus error={s.error} hasData={!!events} onRetry={s.refresh} />
      {events ? (
        events.length === 0 ? <p className="text-sm text-muted-foreground">{t('entities.ui.tree.empty')}</p> : (
          <div className="flex flex-col gap-2">
            {[...groups].map(([day, list]) => (
              <section key={day}>
                <h4 className="mb-0.5 text-xs font-bold uppercase text-muted-foreground">{day}</h4>
                <ul className="flex flex-col gap-0.5">
                  {list.map((e) => (
                    <li key={e.id} className="flex min-w-0 gap-2 text-sm">
                      <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{e.allDay ? '—' : timeFmt.format(e.start)}</span>
                      {e.url ? (
                        <a href={e.url} onClick={(ev) => { ev.preventDefault(); openExternalSafe(e.url!) }} className="min-w-0 truncate font-bold text-foreground hover:underline">{e.title}</a>
                      ) : <span className="min-w-0 truncate font-bold text-foreground">{e.title}</span>}
                      {e.location && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{e.location}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : !s.error && <ListSkeleton rows={4} />}
    </div>
  )
}
