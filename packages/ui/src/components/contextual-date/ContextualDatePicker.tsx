/**
 * ContextualDatePicker (W1-08, UI-SPEC §4 "ContextualDateField").
 *
 * Trigger shows the contextual display ("Mar 5", "March 2026", "Q2 2026",
 * "2026") or the "Set date" placeholder. The popover has tabs
 * Day · Month · Quarter · Year; the selected tab sets the precision of the
 * emitted value. Keyboard: Tab through tabs and cells, Esc closes.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST, POPOVER_SURFACE, SELECTED_TINT } from '../primitives/tokens'
import {
  DATE_PRECISIONS,
  formatContextualDate,
  monthGrid,
  normalizeContextualDate,
  parseIsoDate,
  toIsoDate,
  type ContextualDate,
  type DatePrecision,
} from './contextual-date'

export interface ContextualDatePickerProps {
  value?: ContextualDate | null
  onChange?: (value: ContextualDate | null) => void
  /** Today's calendar date (injectable for deterministic stories/tests). */
  today?: string
  defaultOpen?: boolean
  readOnly?: boolean
  className?: string
}

function todayIso(): string {
  const now = new Date()
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())
}

export function ContextualDatePicker({ value, onChange, today, defaultOpen = false, readOnly, className }: ContextualDatePickerProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'ru'
  const todayValue = today ?? todayIso()
  const anchor = parseIsoDate(value?.date ?? todayValue) ?? parseIsoDate(todayValue)!
  const [open, setOpen] = React.useState(defaultOpen)
  const [precision, setPrecision] = React.useState<DatePrecision>(value?.precision ?? 'day')
  const [viewYear, setViewYear] = React.useState(anchor.year)
  const [viewMonth, setViewMonth] = React.useState(anchor.month - 1)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const tabsId = React.useId()

  const formatQuarter = (quarter: number, year: number) => t('entities.ui.date.quarter', { quarter, year })
  const display = value ? formatContextualDate(value, locale, formatQuarter) : null
  const interactive = !readOnly && !!onChange

  const emit = (next: ContextualDate | null) => {
    onChange?.(next ? normalizeContextualDate(next) : null)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const step = (delta: number) => {
    if (precision === 'day') {
      const m = viewMonth + delta
      setViewYear(viewYear + Math.floor(m / 12))
      setViewMonth(((m % 12) + 12) % 12)
    } else {
      setViewYear(viewYear + delta * (precision === 'year' ? 12 : 1))
    }
  }

  const cellClass = (selected: boolean) => cn('h-8 rounded-[6px] text-[12px] tabular-nums', HOVER_TINT, MOTION_FAST, FOCUS_RING, selected && cn(SELECTED_TINT, 'font-semibold'))
  const selectedNorm = value ? normalizeContextualDate(value) : null
  const isSelected = (p: DatePrecision, iso: string) => selectedNorm?.precision === p && selectedNorm.date === iso

  const header = precision === 'day'
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(viewYear, viewMonth, 1)))
    : precision === 'year' ? `${viewYear - 5} – ${viewYear + 6}` : String(viewYear)

  return (
    <div className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={!interactive}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn('inline-flex h-7 items-center rounded-[6px] px-2 text-[13px]', display ? 'text-foreground' : 'text-text-muted', interactive && HOVER_TINT, MOTION_FAST, FOCUS_RING)}
      >
        {display ?? t('entities.ui.date.setDate')}
      </button>
      {open && interactive ? (
        <div
          role="dialog"
          aria-label={t('entities.ui.date.setDate')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus() } }}
          className={cn('absolute left-0 top-full z-20 mt-1 flex w-[264px] flex-col gap-2 p-2', POPOVER_SURFACE)}
        >
          <div role="tablist" aria-label={t('entities.ui.date.precision')} className="grid grid-cols-4 gap-1">
            {DATE_PRECISIONS.map((p) => (
              <button
                key={p}
                id={`${tabsId}-${p}`}
                type="button"
                role="tab"
                aria-selected={precision === p}
                aria-controls={`${tabsId}-panel`}
                onClick={() => setPrecision(p)}
                className={cn('h-7 rounded-[6px] text-[12px]', HOVER_TINT, FOCUS_RING, precision === p && cn(SELECTED_TINT, 'font-semibold'))}
              >
                {t(`entities.ui.date.tab.${p}`)}
              </button>
            ))}
          </div>
          <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${precision}`} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <button type="button" aria-label={t('entities.ui.date.prev')} onClick={() => step(-1)} className={cn('size-7 rounded-[6px]', HOVER_TINT, FOCUS_RING)}>‹</button>
              <span className="text-[12px] font-semibold capitalize">{header}</span>
              <button type="button" aria-label={t('entities.ui.date.next')} onClick={() => step(1)} className={cn('size-7 rounded-[6px]', HOVER_TINT, FOCUS_RING)}>›</button>
            </div>
            {precision === 'day' ? (
              <div className="grid grid-cols-7 gap-0.5">
                {monthGrid(viewYear, viewMonth).map((iso, i) => iso ? (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={isSelected('day', iso)}
                    aria-current={iso === todayValue ? 'date' : undefined}
                    aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))}
                    onClick={() => emit({ precision: 'day', date: iso })}
                    className={cn(cellClass(isSelected('day', iso)), iso === todayValue && 'text-accent')}
                  >
                    {Number(iso.slice(8))}
                  </button>
                ) : <span key={`pad-${i}`} aria-hidden="true" />)}
              </div>
            ) : null}
            {precision === 'month' ? (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, m) => {
                  const iso = toIsoDate(viewYear, m, 1)
                  return (
                    <button key={iso} type="button" aria-pressed={isSelected('month', iso)} onClick={() => emit({ precision: 'month', date: iso })} className={cellClass(isSelected('month', iso))}>
                      {new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(viewYear, m, 1)))}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {precision === 'quarter' ? (
              <div className="grid grid-cols-2 gap-1">
                {[1, 2, 3, 4].map((q) => {
                  const iso = toIsoDate(viewYear, (q - 1) * 3, 1)
                  return (
                    <button key={iso} type="button" aria-pressed={isSelected('quarter', iso)} onClick={() => emit({ precision: 'quarter', date: iso })} className={cellClass(isSelected('quarter', iso))}>
                      {formatQuarter(q, viewYear)}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {precision === 'year' ? (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, i) => viewYear - 5 + i).map((y) => {
                  const iso = toIsoDate(y, 0, 1)
                  return (
                    <button key={iso} type="button" aria-pressed={isSelected('year', iso)} onClick={() => emit({ precision: 'year', date: iso })} className={cellClass(isSelected('year', iso))}>
                      {y}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          {value ? (
            <button type="button" onClick={() => emit(null)} className={cn('h-7 self-start rounded-[6px] px-2 text-[12px] text-text-secondary', HOVER_TINT, FOCUS_RING)}>
              {t('entities.ui.date.clear')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
