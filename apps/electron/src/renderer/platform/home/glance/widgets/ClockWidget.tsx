import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GlanceWidgetProps } from '../registry'

export function formatClock(date: Date, opts: { locale: string; hour12: boolean; seconds: boolean; timeZone?: string }): string | null {
  try {
    return new Intl.DateTimeFormat(opts.locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(opts.seconds ? { second: '2-digit' } : {}),
      hour12: opts.hour12,
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    }).format(date)
  } catch {
    return null
  }
}

function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, stepMs - (Date.now() % stepMs))
    }
    timer = setTimeout(tick, stepMs - (Date.now() % stepMs))
    return () => clearTimeout(timer)
  }, [stepMs])
  return now
}

export default function ClockWidget({ config }: GlanceWidgetProps) {
  const { i18n } = useTranslation()
  const seconds = config.showSeconds === true
  const hour12 = config.hourFormat === '12h'
  const now = useNow(seconds ? 1000 : 60_000)
  const zones = Array.isArray(config.timezones) ? (config.timezones as string[]) : []
  const locale = i18n.language || 'ru'
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  return (
    <div className="flex flex-col gap-2" data-glance-clock="">
      <div>
        <p className="text-stat font-bold tabular-nums text-foreground">{formatClock(now, { locale, hour12, seconds })}</p>
        <p className="text-sm capitalize text-muted-foreground">{date}</p>
      </div>
      {zones.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {zones.map((zone) => {
            const time = formatClock(now, { locale, hour12, seconds: false, timeZone: zone })
            return (
              <li key={zone} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-muted-foreground" title={zone}>{zone.split('/').pop()?.replace(/_/g, ' ')}</span>
                <span className="tabular-nums font-bold text-foreground">{time ?? '—'}</span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
