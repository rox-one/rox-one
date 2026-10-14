/**
 * MiniCalendar — month grid rendered in the Календарь sidebar through the
 * shell group content slot. Days with meetings get a dot; picking a day
 * filters the list, picking it again clears the filter. Roving focus grid.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { monthGrid, startOfDay } from './calendar-visibility'

export interface MiniCalendarProps {
  now: number
  selectedDay: number | null
  meetingDays: ReadonlySet<number>
  onSelectDay(day: number | null): void
}

const DAY = 86_400_000

export const MiniCalendar = React.memo(function MiniCalendar({ now, selectedDay, meetingDays, onSelectDay }: MiniCalendarProps) {
  const { t, i18n } = useTranslation()
  const today = startOfDay(now)
  const [month, setMonth] = React.useState(() => selectedDay ?? today)
  const [focusDay, setFocusDay] = React.useState(() => selectedDay ?? today)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const days = React.useMemo(() => monthGrid(month), [month])
  const monthIndex = new Date(month).getMonth()
  const tabbableDay = days.includes(focusDay) ? focusDay : (days.find((d) => new Date(d).getMonth() === monthIndex) ?? days[0])
  const monthFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }), [i18n.language])
  const dayFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full' }), [i18n.language])
  const weekdayFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }), [i18n.language])

  const shiftMonth = (delta: number) => {
    const d = new Date(month)
    d.setDate(1)
    d.setMonth(d.getMonth() + delta)
    setMonth(d.getTime())
    // Keep a tabbable cell inside the visible month (keyboard reachability).
    setFocusDay(startOfDay(d.getTime()))
  }
  const moveFocus = (next: number) => {
    const day = startOfDay(next)
    setFocusDay(day)
    if (new Date(day).getMonth() !== monthIndex) setMonth(day)
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus())
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
    if (step) { event.preventDefault(); moveFocus((tabbableDay ?? focusDay) + step * DAY + DAY / 2) }
  }

  return (
    <div className="px-2 pb-2 text-caption">
      <div className="flex items-center justify-between pb-1">
        <button type="button" aria-label={t('screens.calendar.prevMonth')} onClick={() => shiftMonth(-1)} className="rounded p-0.5 text-muted-foreground hover:bg-surface-hover">
          <ChevronLeft className="icon-caption" aria-hidden />
        </button>
        <span className="font-medium capitalize" aria-live="polite">{monthFmt.format(month)}</span>
        <button type="button" aria-label={t('screens.calendar.nextMonth')} onClick={() => shiftMonth(1)} className="rounded p-0.5 text-muted-foreground hover:bg-surface-hover">
          <ChevronRight className="icon-caption" aria-hidden />
        </button>
      </div>
      <div ref={gridRef} role="grid" aria-label={monthFmt.format(month)} onKeyDown={onKeyDown} className="grid grid-cols-7 gap-px text-center">
        <div role="row" className="contents">
          {days.slice(0, 7).map((d) => <span key={d} role="columnheader" className="text-muted-foreground">{weekdayFmt.format(d)}</span>)}
        </div>
        {[0, 1, 2, 3, 4, 5].map((w) => (
          <div key={w} role="row" className="contents">
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const inMonth = new Date(d).getMonth() === monthIndex
              const selected = d === selectedDay
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-day={d}
                  tabIndex={d === tabbableDay ? 0 : -1}
                  aria-selected={selected}
                  aria-current={d === today ? 'date' : undefined}
                  aria-label={dayFmt.format(d) + (meetingDays.has(d) ? `, ${t('screens.calendar.hasMeetings')}` : '')}
                  onClick={() => { setFocusDay(d); onSelectDay(selected ? null : d) }}
                  className={cn(
                    'relative rounded py-0.5 hover:bg-surface-hover',
                    !inMonth && 'text-muted-foreground',
                    d === today && 'font-semibold text-accent',
                    selected && 'bg-surface-selected',
                  )}
                >
                  {new Date(d).getDate()}
                  {meetingDays.has(d) && <span aria-hidden className="absolute inset-x-0 bottom-0 mx-auto size-1 rounded-full bg-accent" />}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
})
