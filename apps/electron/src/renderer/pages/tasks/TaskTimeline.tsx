/**
 * Task timeline view mode (Задачи): a pinned task column beside a horizontally
 * scrollable gantt track. Bars run from start («Когда») to deadline; drag to
 * move, drag an edge to resize, ←/→ (⇧ = deadline) from the keyboard. Tasks
 * without dates sit in the unscheduled tray and can be dropped on a day.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { daysBetween, parseIsoDate } from '@rox/shared/projects/roadmap'
import { cn } from '@/lib/utils'
import {
  applySpanDrag, barGeometry, dateAtOffset, ganttTicks, todayOffset, zoomScale, type GanttDragMode, type GanttRange, type GanttSpan, type GanttZoom,
} from '@/components/gantt/gantt-engine'
import { useGanttDrag, useTrackWidth } from '@/components/gantt/use-gantt'
import {
  dragPatch, dropPatch, groupTasks, partitionTasks, timelineRange, type SchedulePatch, type TimelineGroup, type TimelineGroupBy,
} from './timeline-model'

export const TIMELINE_DRAG_TYPE = 'application/x-rox-timeline-task'
const LABEL_COL = 220
const ROW_H = 28
const ZOOMS: { id: Exclude<GanttZoom, 'fit'>; label: string }[] = [
  { id: 'day', label: 'entities.ui.date.tab.day' },
  { id: 'week', label: 'entities.ui.gantt.zoom.week' },
  { id: 'month', label: 'entities.ui.gantt.zoom.month' },
  { id: 'quarter', label: 'entities.ui.gantt.zoom.quarter' },
]
const GROUPS: { id: TimelineGroupBy; label: string }[] = [
  { id: 'none', label: 'collection.display.groupBy.none' },
  { id: 'project', label: 'collection.display.groupBy.project' },
  { id: 'area', label: 'tasks.quickEntry.area' },
  { id: 'list', label: 'collection.view.list' },
]

export interface TaskTimelineProps {
  tasks: readonly PersonalTask[]
  today: string
  locale: string
  selectedId: string | null
  zoom: Exclude<GanttZoom, 'fit'>
  groupBy: TimelineGroupBy
  onZoom: (zoom: Exclude<GanttZoom, 'fit'>) => void
  onGroupBy: (groupBy: TimelineGroupBy) => void
  onSelect: (id: string) => void
  onSchedule: (id: string, patch: SchedulePatch) => void
  groupTitle: (group: TimelineGroup) => string
}

export function TaskTimeline({ tasks, today, locale, selectedId, zoom, groupBy, onZoom, onGroupBy, onSelect, onSchedule, groupTitle }: TaskTimelineProps) {
  const { t } = useTranslation()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const viewport = useTrackWidth(scrollRef)
  const { scheduled, unscheduled } = React.useMemo(() => partitionTasks(tasks, today), [tasks, today])
  const spanById = React.useMemo(() => new Map(scheduled.map((s) => [s.task.id, s.span])), [scheduled])
  const range = React.useMemo(() => timelineRange(scheduled.map((s) => s.span), today), [scheduled, today])
  const scale = zoomScale(range, zoom, Math.max(0, viewport - LABEL_COL))
  const { pxPerDay, trackWidth } = scale
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ticks = React.useMemo(() => ganttTicks(range, scale, locale), [range, pxPerDay, locale])
  const todayLeft = todayOffset(range, today, pxPerDay)
  const groups = React.useMemo(() => groupTasks(scheduled.map((s) => s.task), groupBy), [scheduled, groupBy])
  const byId = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const { drag, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture } = useGanttDrag({
    pxPerDay,
    onCommit: (id, mode, days) => { const task = byId.get(id); if (task) onSchedule(id, dragPatch(task, mode, days, today)) },
    onClick: onSelect,
  })
  // Stable callbacks for memoized rows: they read the latest closures from a ref.
  const latest = React.useRef({ onPointerDown, onSchedule, onSelect, today })
  latest.current = { onPointerDown, onSchedule, onSelect, today }
  const rowHandlers = React.useMemo<RowHandlers>(() => ({
    pointerDown: (e, id, mode) => latest.current.onPointerDown(e, id, mode),
    lostCapture: onLostPointerCapture,
    select: (id) => latest.current.onSelect(id),
    nudge: (task, mode, days) => latest.current.onSchedule(task.id, dragPatch(task, mode, days, latest.current.today)),
    // ↑/↓ walk the timeline rows (visual order), not the page's list order.
    walk: (id, delta) => {
      const ids = rowOrderRef.current
      const next = ids[ids.indexOf(id) + delta]
      if (next) scrollRef.current?.querySelector<HTMLElement>(`[data-testid="timeline-bar-${CSS.escape(next)}"]`)?.focus()
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  const rowOrderRef = React.useRef<string[]>([])
  const [dropDay, setDropDay] = React.useState<string | null>(null)
  const dateFmt = React.useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }), [locale])

  // Open on today rather than the padded window start; again when zoom or the window changes.
  React.useEffect(() => {
    const el = scrollRef.current
    if (el && todayLeft != null) el.scrollLeft = Math.max(0, todayLeft - (el.clientWidth - LABEL_COL) / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, range.start, range.end, viewport > 0])

  const dayAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    return rect ? dateAtOffset(range, clientX - rect.left, pxPerDay) : null
  }
  const onTrackDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(TIMELINE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const day = dayAt(event.clientX)
    if (day !== dropDay) setDropDay(day)
  }
  const onTrackDrop = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData(TIMELINE_DRAG_TYPE)
    const day = dayAt(event.clientX)
    setDropDay(null)
    if (!id || !day) return
    event.preventDefault()
    onSchedule(id, dropPatch(day))
  }

  rowOrderRef.current = groups.flatMap((g) => g.tasks.map((task) => task.id))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tasks-timeline">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3.5 pb-1.5 text-sm">
        <div role="radiogroup" aria-label={t('entities.ui.gantt.zoom')} className="inline-flex rounded-[var(--radius-control)] border border-border-subtle p-0.5">
          {ZOOMS.map((z) => (
            <button key={z.id} type="button" role="radio" aria-checked={zoom === z.id} data-testid={`timeline-zoom-${z.id}`} onClick={() => onZoom(z.id)}
              className={cn('rounded-[var(--radius-control)] px-2 py-0.5', zoom === z.id ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:bg-surface-hover')}>
              {t(z.label)}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label={t('collection.display.groupByLabel')} data-testid="timeline-group" className="inline-flex rounded-[var(--radius-control)] border border-border-subtle p-0.5">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={groupBy === g.id} data-testid={`timeline-group-${g.id}`} onClick={() => onGroupBy(g.id)}
              className={cn('rounded-[var(--radius-control)] px-2 py-0.5', groupBy === g.id ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:bg-surface-hover')}>
              {t(g.label)}
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        <div style={{ width: LABEL_COL + trackWidth }} className="relative min-h-full">
          <div className="sticky top-0 z-sticky flex bg-background">
            <div style={{ width: LABEL_COL }} className="sticky left-0 z-sticky shrink-0 bg-background" />
            <div className="relative h-6 select-none" style={{ width: trackWidth }}>
              {ticks.map((tick) => (
                <span key={`${tick.left}-${tick.label}`} style={{ left: tick.left }} className={cn('absolute top-1 whitespace-nowrap pl-1 text-xs', tick.major ? 'font-medium text-text-secondary' : 'text-text-muted')}>{tick.label}</span>
              ))}
            </div>
          </div>
          <div className="relative" onDragOver={onTrackDragOver} onDragLeave={() => setDropDay(null)} onDrop={onTrackDrop}>
            <div ref={trackRef} className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_COL, width: trackWidth }}>
              {ticks.filter((tk) => tk.major).map((tick) => <span key={tick.left} style={{ left: tick.left }} className="absolute inset-y-0 w-px bg-border-subtle" />)}
              {todayLeft != null ? <span data-testid="timeline-today" title={t('entities.ui.gantt.today')} style={{ left: todayLeft }} className="absolute inset-y-0 w-px bg-accent" /> : null}
              {dropDay ? <span style={barGeometry(range, { start: dropDay, end: dropDay }, pxPerDay)} className="absolute inset-y-0 bg-accent/15" /> : null}
            </div>
            {scheduled.length === 0 ? (
              <p className="sticky left-0 px-3.5 py-3 text-sm text-text-muted" style={{ width: Math.min(viewport || LABEL_COL, LABEL_COL + trackWidth) }}>{t('entities.ui.gantt.empty')}</p>
            ) : groups.map((group) => (
              <React.Fragment key={group.key}>
                {groupBy !== 'none' ? (
                  <div className="sticky left-0 px-3 pt-2 text-xs font-medium uppercase text-text-muted" style={{ width: LABEL_COL }}>{groupTitle(group)}</div>
                ) : null}
                {group.tasks.map((task) => {
                  const base = spanById.get(task.id)!
                  const dragging = drag?.id === task.id
                  return (
                    <TimelineRow key={task.id} task={task} span={dragging ? applySpanDrag(base, drag.mode, drag.deltaDays) : base}
                      range={range} totalDays={scale.totalDays} pxPerDay={pxPerDay} trackWidth={trackWidth}
                      selected={selectedId === task.id} dragging={dragging} dateFmt={dateFmt} handlers={rowHandlers} />
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-border-subtle px-3.5 py-2" data-testid="timeline-tray">
        <div className="mb-1 text-xs font-medium uppercase text-text-muted">{t('tasks.bucket.unscheduled')} · {unscheduled.length}</div>
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {unscheduled.map((task) => (
            <button key={task.id} type="button" draggable data-testid={`timeline-tray-${task.id}`}
              onDragStart={(e) => { e.dataTransfer.setData(TIMELINE_DRAG_TYPE, task.id); e.dataTransfer.effectAllowed = 'move' }}
              onClick={() => onSelect(task.id)}
              onKeyDown={(e) => {
                // Keyboard scheduling: Enter starts the task today.
                if (e.key !== 'Enter') return
                e.preventDefault()
                e.stopPropagation()
                onSchedule(task.id, dropPatch(today))
              }}
              className={cn('max-w-48 truncate rounded-[var(--radius-control)] border border-border-subtle px-2 py-0.5 text-xs hover:bg-surface-hover', selectedId === task.id && 'border-accent')}
              title={task.title}>
              {task.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

interface RowHandlers {
  pointerDown: (e: React.PointerEvent, id: string, mode: GanttDragMode) => void
  lostCapture: () => void
  select: (id: string) => void
  nudge: (task: PersonalTask, mode: GanttDragMode, days: number) => void
  walk: (id: string, delta: -1 | 1) => void
}

interface TimelineRowProps {
  task: PersonalTask
  span: GanttSpan
  range: GanttRange
  totalDays: number
  pxPerDay: number
  trackWidth: number
  selected: boolean
  dragging: boolean
  dateFmt: Intl.DateTimeFormat
  handlers: RowHandlers
}

/** One timeline row; memoized so a drag re-renders only the dragged bar. */
const TimelineRow = React.memo(function TimelineRow({ task, span, range, totalDays, pxPerDay, trackWidth, selected, dragging, dateFmt, handlers }: TimelineRowProps) {
  const { t } = useTranslation()
  const { left, width } = barGeometry(range, span, pxPerDay)
  const startLabel = dateFmt.format(parseIsoDate(span.start))
  const endLabel = dateFmt.format(parseIsoDate(span.end))
  const handle = (mode: GanttDragMode, side: 'left-0' | 'right-0') => (
    <span onPointerDown={(e) => handlers.pointerDown(e, task.id, mode)} className={cn('absolute inset-y-0 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-accent/40 group-hover:opacity-100', side)} />
  )
  return (
    <div className="flex" style={{ height: ROW_H }}>
      <button type="button" tabIndex={-1} onClick={() => handlers.select(task.id)} style={{ width: LABEL_COL }}
        className={cn('sticky left-0 z-sticky shrink-0 truncate bg-background px-3 text-left text-sm', selected ? 'font-medium text-foreground' : 'text-text-secondary hover:text-foreground')}
        title={task.title}>
        {task.title}
      </button>
      <div className="relative" style={{ width: trackWidth }}>
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('entities.ui.gantt.bar', { title: task.title, start: startLabel, end: endLabel })}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, totalDays - 1)}
          aria-valuenow={daysBetween(range.start, span.start)}
          aria-valuetext={`${startLabel} — ${endLabel}`}
          data-testid={`timeline-bar-${task.id}`}
          onFocus={() => { if (!selected) handlers.select(task.id) }}
          onPointerDown={(e) => handlers.pointerDown(e, task.id, 'move')}
          onLostPointerCapture={handlers.lostCapture}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              e.stopPropagation()
              handlers.walk(task.id, e.key === 'ArrowUp' ? -1 : 1)
              return
            }
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            e.stopPropagation()
            // ←/→ move, ⇧ the deadline edge, ⌥ the start edge.
            handlers.nudge(task, e.shiftKey ? 'end' : e.altKey ? 'start' : 'move', e.key === 'ArrowLeft' ? -1 : 1)
          }}
          style={{ left, width }}
          title={`${task.title} · ${startLabel} — ${endLabel}`}
          className={cn(
            'group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-[var(--radius-control)] border border-accent/40 bg-accent/20 outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            selected && 'border-accent bg-accent/35',
            dragging && 'cursor-grabbing',
          )}
        >
          {width > 72 ? <span className="relative block truncate px-2 text-xs leading-5 text-text-secondary">{startLabel} — {endLabel}</span> : null}
          {handle('start', 'left-0')}
          {handle('end', 'right-0')}
        </div>
      </div>
    </div>
  )
})
