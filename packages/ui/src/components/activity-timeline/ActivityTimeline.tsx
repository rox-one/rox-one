/**
 * ActivityTimeline (W1-08, UI-SPEC §4 "ActivityTimeline").
 *
 * Day-grouped events (Operately feed; Lark task activity lines). Each event
 * renders through `renderers[event.type]` when provided (one renderer per
 * `domain_event.type`, registered by owning modules) and otherwise through
 * the generic "⟨actor⟩ · ⟨type⟩" line.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { PersonAvatar, type PersonOption } from '../person-field/PeopleList'
import { groupByDay } from './group-by-day'

export interface ActivityEvent {
  id: string
  type: string
  /** ISO instant. */
  at: string
  actor: Pick<PersonOption, 'name' | 'avatarUrl' | 'placeholder'>
  /** Optional pre-rendered summary (already localised by the producer). */
  summary?: string
}

export type ActivityRenderer = (event: ActivityEvent) => React.ReactNode

export interface ActivityTimelineProps {
  events: readonly ActivityEvent[]
  renderers?: Readonly<Record<string, ActivityRenderer>>
  /** Injected clock + zone for deterministic grouping. */
  now?: number
  timeZone?: string
  className?: string
}

export function ActivityTimeline({ events, renderers, now, timeZone, className }: ActivityTimelineProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'ru'
  const clock = now ?? Date.now()
  const groups = React.useMemo(() => groupByDay(events, { now: clock, timeZone }), [events, clock, timeZone])
  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone })
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone })

  if (events.length === 0) {
    return <div className={cn('py-3 text-[12px] text-text-muted', className)}>{t('entities.ui.activity.empty')}</div>
  }

  return (
    <section aria-label={t('entities.ui.activity.title')} className={cn('flex flex-col gap-3', className)}>
      {groups.map((group) => (
        <div key={group.day} className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {group.relative ? t(`entities.ui.activity.${group.relative}`) : dayFmt.format(new Date(group.items[0]!.at))}
          </h4>
          <ol className="flex flex-col gap-1">
            {group.items.map((event) => (
              <li key={event.id} data-event-type={event.type} className="flex items-start gap-2 text-[12px]">
                <PersonAvatar person={event.actor} size={20} />
                <span className="min-w-0 flex-1 text-text-secondary">
                  {renderers?.[event.type]?.(event)
                    ?? event.summary
                    ?? t('entities.ui.activity.generic', { actor: event.actor.name, type: event.type })}
                </span>
                <time dateTime={event.at} className="shrink-0 tabular-nums text-text-muted">{timeFmt.format(new Date(event.at))}</time>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  )
}
