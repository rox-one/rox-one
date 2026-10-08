/**
 * GanttView shell (W1-08, UI-SPEC §4 "GanttView"; ADR-U10).
 *
 * Month grid with a "Today" marker, bars coloured by status tone, zoom
 * Week / Month / Quarter, and rescheduling by pointer drag or ← → on a
 * focused bar. Rescheduling only emits `onReschedule(id, {start, end})`; the
 * host turns it into a command. Label «Гантт».
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, SELECTED_TINT } from '../primitives/tokens'
import { statusToneTextClass, type StatusTone } from '../status-badge/StatusBadge'
import { GANTT_ZOOMS, layoutGantt, shiftIso, validGanttItems, type GanttZoom } from './gantt-layout'

export interface GanttItem {
  id: string
  title: string
  start: string
  end: string
  tone?: StatusTone
}

export interface GanttViewProps {
  items: readonly GanttItem[]
  zoom?: GanttZoom
  onZoomChange?: (zoom: GanttZoom) => void
  today?: string
  onReschedule?: (id: string, next: { start: string; end: string }) => void
  className?: string
}

export function GanttView({ items, zoom: zoomProp, onZoomChange, today, onReschedule, className }: GanttViewProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'ru'
  const [zoomState, setZoomState] = React.useState<GanttZoom>(zoomProp ?? 'month')
  const zoom = zoomProp ?? zoomState
  const hintId = React.useId()
  const drag = React.useRef<{ id: string; originX: number; days: number } | null>(null)
  const [dragOffset, setDragOffset] = React.useState<{ id: string; days: number } | null>(null)
  const valid = validGanttItems(items)
  const layout = layoutGantt(valid, { zoom, today })
  const setZoom = (z: GanttZoom) => { setZoomState(z); onZoomChange?.(z) }

  const fmtDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const fmtCol = (iso: string, kind: 'day' | 'month' | 'quarter') => {
    const date = new Date(`${iso}T00:00:00Z`)
    if (kind === 'day') return String(date.getUTCDate())
    if (kind === 'month') return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date)
    return t('entities.ui.date.quarter', { quarter: Math.floor(date.getUTCMonth() / 3) + 1, year: date.getUTCFullYear() })
  }
  const reschedule = (item: GanttItem, days: number) => {
    if (!onReschedule || days === 0) return
    onReschedule(item.id, { start: shiftIso(item.start, days), end: shiftIso(item.end, days) })
  }

  return (
    <section aria-label={t('entities.ui.gantt.label')} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">{t('entities.ui.gantt.label')}</span>
        <div role="radiogroup" aria-label={t('entities.ui.gantt.zoom')} className="ml-auto inline-flex rounded-[6px] bg-foreground/[0.05] p-0.5">
          {GANTT_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={zoom === z}
              onClick={() => setZoom(z)}
              className={cn('h-6 rounded-[5px] px-2 text-[12px]', HOVER_TINT, FOCUS_RING, zoom === z && cn(SELECTED_TINT, 'font-semibold'))}
            >
              {t(`entities.ui.gantt.zoom.${z}`)}
            </button>
          ))}
        </div>
      </div>
      {!layout ? (
        <div className="py-6 text-center text-[12px] text-text-muted">{t('entities.ui.gantt.empty')}</div>
      ) : (
        <div className="relative overflow-x-auto rounded-[8px] border border-border">
          <div className="relative" style={{ width: layout.totalWidth, height: 28 + valid.length * 32 + 8 }}>
            {layout.columns.map((col) => (
              <div
                key={col.key}
                aria-hidden="true"
                className="absolute top-0 h-full border-l border-border/60 pl-1 pt-1 text-[10px] text-text-muted"
                style={{ left: col.x, width: col.width }}
              >
                {fmtCol(col.start, col.kind)}
              </div>
            ))}
            {layout.todayX !== null ? (
              <div className="absolute top-0 h-full" style={{ left: layout.todayX }} aria-hidden="true">
                <div className="h-full w-px bg-accent" />
                <span className="absolute left-1 top-[14px] whitespace-nowrap text-[10px] font-semibold text-accent">{t('entities.ui.gantt.today')}</span>
              </div>
            ) : null}
            {layout.bars.map((bar) => {
              const item = valid.find((i) => i.id === bar.id)!
              const offset = dragOffset?.id === bar.id ? dragOffset.days * layout.dayWidth : 0
              const label = t('entities.ui.gantt.bar', { title: item.title, start: fmtDay.format(new Date(`${item.start}T00:00:00Z`)), end: fmtDay.format(new Date(`${item.end}T00:00:00Z`)) })
              return (
                <button
                  key={bar.id}
                  type="button"
                  data-gantt-bar={bar.id}
                  aria-label={label}
                  aria-describedby={onReschedule ? hintId : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); reschedule(item, -1) }
                    if (e.key === 'ArrowRight') { e.preventDefault(); reschedule(item, 1) }
                  }}
                  onPointerDown={(e) => {
                    if (!onReschedule) return
                    drag.current = { id: bar.id, originX: e.clientX, days: 0 }
                    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    if (!drag.current || drag.current.id !== bar.id) return
                    const days = Math.round((e.clientX - drag.current.originX) / layout.dayWidth)
                    drag.current.days = days
                    setDragOffset({ id: bar.id, days })
                  }}
                  onPointerUp={() => {
                    const d = drag.current
                    drag.current = null
                    setDragOffset(null)
                    if (d && d.id === bar.id) reschedule(item, d.days)
                  }}
                  className={cn(
                    'absolute flex h-6 items-center overflow-hidden rounded-[6px] px-2 text-left text-[11px] font-medium',
                    'bg-[color-mix(in_oklch,currentColor_18%,transparent)] transition-[left] duration-200 ease-out motion-reduce:transition-none',
                    statusToneTextClass(item.tone ?? 'info'),
                    onReschedule ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                    FOCUS_RING,
                  )}
                  style={{ left: bar.x + offset, width: Math.max(bar.width, 8), top: 28 + bar.row * 32 }}
                >
                  <span className="truncate text-foreground">{item.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {onReschedule ? <span id={hintId} className="sr-only">{t('entities.ui.gantt.rescheduleHint')}</span> : null}
    </section>
  )
}
