/**
 * Compact year heatmap for the «Активность» screen. Reuses the pure session
 * heatmap machinery (`buildYearHeatmap`, `heatmapNavigate`, `heatmapHomeKey`,
 * `heatmapEndKey`, `localDayKey`) shared with the collection heatmap view; only
 * the chrome is slimmer, and the level scale matches `SessionHeatmapHost` so
 * the same colour means the same thing on both screens.
 *
 * Keyboard: the grid is a single tab stop; Arrow keys move the focused day,
 * Home/End jump to today / Dec 31, and the focused day is `aria-selected`.
 */
import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  buildYearHeatmap,
  heatmapEndKey,
  heatmapHomeKey,
  heatmapNavigate,
  type HeatmapNavDir,
} from '@rox/shared/sessions/collection'
import { cn } from '@/lib/utils'
import { ScreenButton } from '../ui'
import type { ActivitySession } from './activity-model'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

const LEVEL_CLASS: Record<number, string> = {
  // eslint-disable-next-line rox/no-foreground-opacity -- empty-day fill matches SessionHeatmapHost's heat scale
  0: 'bg-foreground/8',
  // eslint-disable-next-line rox/no-raw-color -- heat scale mirrors session-heatmap/SessionHeatmapHost.tsx; no heat colour token exists
  1: 'bg-emerald-900/55',
  // eslint-disable-next-line rox/no-raw-color -- heat scale mirrors session-heatmap/SessionHeatmapHost.tsx; no heat colour token exists
  2: 'bg-emerald-700/65',
  // eslint-disable-next-line rox/no-raw-color -- heat scale mirrors session-heatmap/SessionHeatmapHost.tsx; no heat colour token exists
  3: 'bg-emerald-500/75',
  // eslint-disable-next-line rox/no-raw-color -- heat scale mirrors session-heatmap/SessionHeatmapHost.tsx; no heat colour token exists
  4: 'bg-emerald-400',
}

export function ActivityHeatmap({
  sessions,
  now,
  locale,
  focusKey,
  onFocusKeyChange,
}: {
  sessions: readonly ActivitySession[]
  now: number
  locale: string
  focusKey: string
  onFocusKeyChange: (key: string) => void
}) {
  const { t } = useTranslation()
  const [year, setYear] = React.useState(() => new Date(now).getFullYear())
  const gridRef = React.useRef<HTMLDivElement>(null)

  const heatmap = React.useMemo(() => buildYearHeatmap(sessions, year, now), [sessions, year, now])

  // Keep the focused day inside the displayed year.
  React.useEffect(() => {
    if (focusKey.startsWith(`${year}-`)) return
    onFocusKeyChange(heatmapHomeKey(year, heatmap.todayKey))
  }, [year, focusKey, heatmap.todayKey, onFocusKeyChange])

  const moveFocus = (dir: HeatmapNavDir) => onFocusKeyChange(heatmapNavigate(focusKey, dir, year))

  const focusedDateLabel = React.useMemo(() => {
    const [y, m, d] = focusKey.split('-').map(Number)
    if (!y || !m || !d) return focusKey
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }, [focusKey, locale])

  const focusedCount = React.useMemo(() => {
    for (const week of heatmap.weeks) {
      for (const cell of week) if (cell.key === focusKey) return cell.count
    }
    return 0
  }, [heatmap.weeks, focusKey])

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-body font-semibold">{t('extraScreens.activity.heatmap')}</h2>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-surface-hover px-1.5">
          <ScreenButton
            variant="ghost"
            className="px-1"
            // eslint-disable-next-line rox/prefer-primitives -- class-only token pass; Tooltip migration is a separate change
            title={t('extraScreens.activity.prevYear')}
            onClick={() => setYear((value) => value - 1)}
          >
            <ChevronLeft className="icon-caption" aria-hidden />
            <span className="sr-only">{t('extraScreens.activity.prevYear')}</span>
          </ScreenButton>
          <span className="text-small font-semibold numeric">{year}</span>
          <ScreenButton
            variant="ghost"
            className="px-1"
            // eslint-disable-next-line rox/prefer-primitives -- class-only token pass; Tooltip migration is a separate change
            title={t('extraScreens.activity.nextYear')}
            onClick={() => setYear((value) => value + 1)}
          >
            <ChevronRight className="icon-caption" aria-hidden />
            <span className="sr-only">{t('extraScreens.activity.nextYear')}</span>
          </ScreenButton>
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="flex flex-col justify-end gap-[3px] pt-5">
          {WEEKDAYS.map((day) => (
            <span key={day} className="h-3 text-caption leading-3 text-muted-foreground" aria-hidden={day % 2 === 1}>
              {day % 2 === 0 ? t(`collection.heatmap.weekday.${day}`) : ''}
            </span>
          ))}
        </div>
        <div
          ref={gridRef}
          role="grid"
          aria-label={t('extraScreens.activity.heatmap')}
          tabIndex={0}
          className="outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          onKeyDown={(event) => {
            if (event.key === 'Home') {
              event.preventDefault()
              onFocusKeyChange(heatmapHomeKey(year, heatmap.todayKey))
              return
            }
            if (event.key === 'End') {
              event.preventDefault()
              onFocusKeyChange(heatmapEndKey(year))
              return
            }
            const dir: HeatmapNavDir | null =
              event.key === 'ArrowLeft'
                ? 'left'
                : event.key === 'ArrowRight'
                  ? 'right'
                  : event.key === 'ArrowUp'
                    ? 'up'
                    : event.key === 'ArrowDown'
                      ? 'down'
                      : null
            if (!dir) return
            event.preventDefault()
            moveFocus(dir)
          }}
        >
          <div className="mb-1 flex">
            {heatmap.weeks.map((_, weekIndex) => {
              const label = heatmap.monthLabels.find((item) => item.weekIndex === weekIndex)
              return (
                <span key={weekIndex} className="w-[15px] shrink-0 text-caption text-muted-foreground">
                  {label ? t(`collection.heatmap.month.${String(label.month).padStart(2, '0')}`) : ''}
                </span>
              )
            })}
          </div>
          <div className="flex gap-px">
            {heatmap.weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-px">
                {week.map((cell, row) => {
                  if (!cell.inYear || !cell.key) {
                    return <span key={`${weekIndex}-${row}`} className="h-3 w-3 rounded-[var(--radius-control)]" />
                  }
                  const focused = cell.key === focusKey
                  const isToday = cell.key === heatmap.todayKey
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      role="gridcell"
                      aria-selected={focused}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={t('collection.heatmap.cell', { date: cell.key, count: cell.count })}
                      // eslint-disable-next-line rox/prefer-primitives -- per-cell tooltip matches SessionHeatmapHost; aria-label already labels it
                      title={t('collection.heatmap.cell', { date: cell.key, count: cell.count })}
                      className={cn(
                        'h-3 w-3 rounded-[var(--radius-control)] outline-none',
                        LEVEL_CLASS[cell.level] ?? LEVEL_CLASS[0],
                        focused && 'ring-1 ring-foreground ring-offset-1 ring-offset-background',
                        isToday && !focused && 'ring-1 ring-border-strong',
                      )}
                      onClick={() => {
                        onFocusKeyChange(cell.key!)
                        gridRef.current?.focus()
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 text-small text-muted-foreground">
        {focusedDateLabel} · {t('extraScreens.activity.dayCount', { count: focusedCount })}
      </p>
    </div>
  )
}