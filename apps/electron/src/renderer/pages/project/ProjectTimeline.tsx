/**
 * Interactive roadmap: a gantt-like strip of milestones (drag a bar to retime,
 * drag its edges to change start/due) plus milestone cards (drag the grip to
 * reorder, status menu, stages and sub-stages, «→ задача»).
 * Fits its container — never scrolls horizontally.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GripVertical, ListPlus, Trash2, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import {
  addDays,
  daysBetween,
  MILESTONE_STATUSES,
  milestoneProgress,
  parseIsoDate,
  roadmapId,
  roadmapTimelineRange,
  shiftMilestone,
  toIsoDate,
  type MilestoneStatus,
  type RoadmapMilestone,
  type RoadmapStage,
} from '@rox/shared/projects/roadmap'
import { AddRow, AutoTextarea, CheckBox, EmptyLine, IconButton, InlineInput } from './roadmap-ui'

export const STATUS_DOT: Record<MilestoneStatus, string> = {
  planned: 'bg-foreground/25',
  active: 'bg-accent',
  done: 'bg-success',
  blocked: 'bg-destructive',
}

const STATUS_BAR: Record<MilestoneStatus, string> = {
  planned: 'bg-foreground/[0.10]',
  active: 'bg-accent/25',
  done: 'bg-success/25',
  blocked: 'bg-destructive/20',
}

const STATUS_FILL: Record<MilestoneStatus, string> = {
  planned: 'bg-foreground/20',
  active: 'bg-accent/60',
  done: 'bg-success/60',
  blocked: 'bg-destructive/50',
}

const LABEL_COL = 168
const LANE_H = 28

type DragMode = 'move' | 'start' | 'end'

interface DragState {
  id: string
  mode: DragMode
  startX: number
  pxPerDay: number
  deltaDays: number
}

function applyDrag(m: RoadmapMilestone, mode: DragMode, days: number): RoadmapMilestone {
  if (!days) return m
  if (mode === 'move') return shiftMilestone(m, days)
  const start = m.startDate ?? m.dueDate
  const due = m.dueDate ?? m.startDate
  if (!start || !due) return m
  if (mode === 'start') {
    const next = addDays(start, days)
    return { ...m, startDate: next > due ? due : next, dueDate: due }
  }
  const next = addDays(due, days)
  return { ...m, startDate: start, dueDate: next < start ? start : next }
}

export function StatusMenu({
  status,
  onChange,
}: {
  status: MilestoneStatus
  onChange: (next: MilestoneStatus) => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('projectRoadmap.statusLabel', { status: t(`projectRoadmap.status.${status}`) })}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} />
          <span className="hidden @[520px]:inline">{t(`projectRoadmap.status.${status}`)}</span>
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="start">
        {MILESTONE_STATUSES.map((s) => (
          <StyledDropdownMenuItem key={s} onSelect={() => onChange(s)}>
            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} />
            {t(`projectRoadmap.status.${s}`)}
          </StyledDropdownMenuItem>
        ))}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline strip
// ─────────────────────────────────────────────────────────────────────────────

export function RoadmapTimeline({
  milestones,
  onChange,
  onFocusMilestone,
  locale,
}: {
  milestones: RoadmapMilestone[]
  onChange: (next: RoadmapMilestone[]) => void
  onFocusMilestone: (id: string) => void
  locale: string
}) {
  const { t } = useTranslation()
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = React.useState(0)
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const today = toIsoDate(new Date())

  React.useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setTrackWidth(el.getBoundingClientRect().width)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  const preview = React.useMemo(
    () => (drag ? milestones.map((m) => (m.id === drag.id ? applyDrag(m, drag.mode, drag.deltaDays) : m)) : milestones),
    [milestones, drag],
  )
  // Keep the window stable while dragging so the bar follows the pointer.
  const baseRange = React.useMemo(() => roadmapTimelineRange(milestones, today), [milestones, today])
  const range = baseRange
  const dated = preview.filter((m) => m.startDate || m.dueDate)
  const undated = preview.filter((m) => !m.startDate && !m.dueDate)

  const totalDays = range ? Math.max(1, daysBetween(range.start, range.end) + 1) : 1
  const pxPerDay = trackWidth > 0 ? trackWidth / totalDays : 0

  const ticks = React.useMemo(() => {
    if (!range || pxPerDay <= 0) return [] as { left: number; label: string; major: boolean }[]
    const out: { left: number; label: string; major: boolean }[] = []
    const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short' })
    const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    const step = pxPerDay * 7 >= 56 ? 7 : pxPerDay * 14 >= 56 ? 14 : 0
    for (let i = 0; i < totalDays; i++) {
      const d = parseIsoDate(addDays(range.start, i))
      const left = i * pxPerDay
      if (d.getDate() === 1) out.push({ left, label: monthFmt.format(d), major: true })
      else if (step && d.getDay() === 1 && (step === 7 || Math.floor(i / 7) % 2 === 0) && d.getDate() > 3 && d.getDate() < 29) {
        out.push({ left, label: dayFmt.format(d), major: false })
      }
    }
    return out
  }, [range, pxPerDay, totalDays, locale])

  const onPointerDown = (e: React.PointerEvent, m: RoadmapMilestone, mode: DragMode) => {
    if (pxPerDay <= 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag({ id: m.id, mode, startX: e.clientX, pxPerDay, deltaDays: 0 })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const deltaDays = Math.round((e.clientX - drag.startX) / drag.pxPerDay)
    if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays })
  }
  const onPointerUp = () => {
    if (!drag) return
    const { id, mode, deltaDays } = drag
    setDrag(null)
    if (deltaDays) onChange(milestones.map((m) => (m.id === id ? applyDrag(m, mode, deltaDays) : m)))
    else onFocusMilestone(id)
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })

  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-foreground/[0.025] px-3 py-2" data-testid="project-timeline">
      <div className="flex min-w-0">
        <div style={{ width: LABEL_COL }} className="shrink-0" />
        <div ref={trackRef} className="relative h-5 min-w-0 flex-1 select-none">
          {ticks.map((tick) => (
            <span
              key={`${tick.left}-${tick.label}`}
              style={{ left: tick.left }}
              className={cn('absolute top-0 whitespace-nowrap pl-1 text-[11px]', tick.major ? 'font-medium text-foreground/70' : 'text-muted-foreground/70')}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {range && dated.length ? (
        <div
          className="relative min-w-0"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          {dated.map((m) => {
            const start = m.startDate ?? m.dueDate!
            const due = m.dueDate ?? m.startDate!
            const left = daysBetween(range.start, start) * pxPerDay
            const width = Math.max(pxPerDay, (daysBetween(start, due) + 1) * pxPerDay)
            const progress = milestoneProgress(m)
            const pct = progress.total ? progress.done / progress.total : m.status === 'done' ? 1 : 0
            const dragging = drag?.id === m.id
            return (
              <div key={m.id} className="flex min-w-0 items-center" style={{ height: LANE_H }}>
                <button
                  type="button"
                  style={{ width: LABEL_COL }}
                  onClick={() => onFocusMilestone(m.id)}
                  className="flex shrink-0 items-center gap-2 truncate pr-2 text-left text-[12px] text-foreground/80 hover:text-foreground"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[m.status])} />
                  <span className="truncate">{m.title}</span>
                </button>
                <div className="relative h-full min-w-0 flex-1">
                  {ticks.filter((tk) => tk.major).map((tick) => (
                    <span key={tick.left} style={{ left: tick.left }} className="absolute inset-y-0 w-px bg-foreground/[0.06]" />
                  ))}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={t('projectRoadmap.timelineBarLabel', { title: m.title, start: dateFmt.format(parseIsoDate(start)), due: dateFmt.format(parseIsoDate(due)) })}
                    aria-valuetext={`${start} — ${due}`}
                    data-testid="project-timeline-bar"
                    onPointerDown={(e) => onPointerDown(e, m, 'move')}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        const days = e.key === 'ArrowLeft' ? -1 : 1
                        onChange(milestones.map((x) => (x.id === m.id ? applyDrag(x, e.shiftKey ? 'end' : 'move', days) : x)))
                      }
                    }}
                    style={{ left, width }}
                    className={cn(
                      'group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                      STATUS_BAR[m.status],
                      dragging && 'cursor-grabbing',
                    )}
                    title={`${m.title} · ${dateFmt.format(parseIsoDate(start))} — ${dateFmt.format(parseIsoDate(due))}`}
                  >
                    <div className={cn('absolute inset-y-0 left-0', STATUS_FILL[m.status])} style={{ width: `${Math.round(pct * 100)}%` }} />
                    {width > 72 ? (
                      <span className="relative block truncate px-2 text-[11px] leading-5 text-foreground/80">
                        {dateFmt.format(parseIsoDate(start))} — {dateFmt.format(parseIsoDate(due))}
                      </span>
                    ) : null}
                    <span
                      onPointerDown={(e) => onPointerDown(e, m, 'start')}
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-foreground/20 group-hover:opacity-100"
                    />
                    <span
                      onPointerDown={(e) => onPointerDown(e, m, 'end')}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-foreground/20 group-hover:opacity-100"
                    />
                  </div>
                </div>
              </div>
            )
          })}
          {/* today marker */}
          {daysBetween(range.start, today) >= 0 && daysBetween(today, range.end) >= 0 ? (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-accent/70"
              style={{ left: LABEL_COL + (daysBetween(range.start, today) + 0.5) * pxPerDay }}
              title={t('projectRoadmap.today')}
            />
          ) : null}
        </div>
      ) : (
        <p className="py-2 text-[12px] text-muted-foreground">{t('projectRoadmap.timelineNoDates')}</p>
      )}
      {undated.length && dated.length ? (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {t('projectRoadmap.timelineUndated', { names: undated.map((m) => m.title).join(', ') })}
        </p>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestone cards
// ─────────────────────────────────────────────────────────────────────────────

function DateField({ value, onChange, label }: { value?: string; onChange: (next: string | undefined) => void; label: string }) {
  return (
    <input
      type="date"
      aria-label={label}
      title={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="h-6 w-[118px] shrink-0 rounded-md bg-transparent px-1 text-[12px] tabular-nums text-muted-foreground outline-none hover:bg-foreground/[0.04] focus:bg-foreground/[0.05] focus:text-foreground"
    />
  )
}

function StageRow({
  stage,
  onChange,
  onRemove,
  onToTask,
}: {
  stage: RoadmapStage
  onChange: (next: RoadmapStage) => void
  onRemove: () => void
  onToTask: (title: string) => void
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = React.useState(false)
  return (
    <div className="min-w-0">
      <div className="group flex min-w-0 items-center gap-1">
        <CheckBox checked={stage.done} label={stage.title} onChange={(done) => onChange({ ...stage, done })} />
        <InlineInput
          value={stage.title}
          ariaLabel={stage.title}
          className={cn(stage.done && 'text-muted-foreground line-through')}
          onCommit={(title) => (title ? onChange({ ...stage, title }) : onRemove())}
        />
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label={t('projectRoadmap.addSubstage')} onClick={() => setAdding(true)}>
            <ListPlus className="h-3.5 w-3.5" />
          </IconButton>
          <button
            type="button"
            onClick={() => onToTask(stage.title)}
            className="h-6 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            title={t('projectRoadmap.stageToTaskHint')}
          >
            {t('projectRoadmap.stageToTask')}
          </button>
          <IconButton label={t('projectRoadmap.remove')} onClick={onRemove}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      {stage.substages.length || adding ? (
        <div className="ml-5 flex flex-col">
          {stage.substages.map((ss) => (
            <div key={ss.id} className="group flex min-w-0 items-center gap-1">
              <CheckBox
                checked={ss.done}
                label={ss.title}
                onChange={(done) => onChange({ ...stage, substages: stage.substages.map((x) => (x.id === ss.id ? { ...x, done } : x)) })}
              />
              <InlineInput
                value={ss.title}
                ariaLabel={ss.title}
                className={cn('text-[12px]', ss.done && 'text-muted-foreground line-through')}
                onCommit={(title) =>
                  onChange({
                    ...stage,
                    substages: title
                      ? stage.substages.map((x) => (x.id === ss.id ? { ...x, title } : x))
                      : stage.substages.filter((x) => x.id !== ss.id),
                  })
                }
              />
              <IconButton
                label={t('projectRoadmap.remove')}
                className="opacity-0 group-hover:opacity-100"
                onClick={() => onChange({ ...stage, substages: stage.substages.filter((x) => x.id !== ss.id) })}
              >
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          {adding ? (
            <AddRow
              placeholder={t('projectRoadmap.addSubstagePlaceholder')}
              onAdd={(title) => onChange({ ...stage, substages: [...stage.substages, { id: roadmapId('ss'), title, done: false }] })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function MilestoneList({
  milestones,
  onChange,
  expandedId,
  onExpandedChange,
  taskStats,
  onCreateTask,
}: {
  milestones: RoadmapMilestone[]
  onChange: (next: RoadmapMilestone[]) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  taskStats: (m: RoadmapMilestone) => { open: number; done: number }
  onCreateTask: (title: string, milestoneId: string) => void
}) {
  const { t } = useTranslation()
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)

  const update = (id: string, patch: (m: RoadmapMilestone) => RoadmapMilestone) =>
    onChange(milestones.map((m) => (m.id === id ? patch(m) : m)))

  const move = (from: string, to: string) => {
    if (from === to) return
    const list = [...milestones]
    const fromIdx = list.findIndex((m) => m.id === from)
    const toIdx = list.findIndex((m) => m.id === to)
    if (fromIdx < 0 || toIdx < 0) return
    const [item] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, item!)
    onChange(list)
  }

  const addMilestone = (title: string) => {
    let last: string | undefined
    for (const m of milestones) {
      const d = m.dueDate ?? m.startDate
      if (d && (!last || d > last)) last = d
    }
    const startDate = last ? addDays(last, 1) : toIsoDate(new Date())
    const created: RoadmapMilestone = {
      id: roadmapId('ms'),
      title,
      description: '',
      status: 'planned',
      startDate,
      dueDate: addDays(startDate, 6),
      stages: [],
      taskIds: [],
    }
    onChange([...milestones, created])
  }

  return (
    <div className="flex flex-col gap-1" data-testid="project-milestones">
      {milestones.map((m, index) => {
        const expanded = expandedId === m.id
        const progress = milestoneProgress(m)
        const tasks = taskStats(m)
        return (
          <div
            key={m.id}
            id={`project-milestone-${m.id}`}
            data-testid="project-milestone"
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              setOverId(m.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId) move(dragId, m.id)
              setDragId(null)
              setOverId(null)
            }}
            className={cn(
              '@container min-w-0 rounded-lg transition-colors',
              expanded ? 'bg-foreground/[0.03]' : 'hover:bg-foreground/[0.02]',
              overId === m.id && dragId && dragId !== m.id && 'bg-accent/10',
              dragId === m.id && 'opacity-50',
            )}
          >
            <div className="flex min-w-0 items-center gap-1 px-1 py-1">
              <span
                draggable
                onDragStart={(e) => {
                  setDragId(m.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/x-rox-milestone', m.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
                title={t('projectRoadmap.dragToReorder')}
                className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 hover:text-foreground"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <IconButton
                label={expanded ? t('projectRoadmap.collapse') : t('projectRoadmap.expand')}
                onClick={() => onExpandedChange(expanded ? null : m.id)}
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </IconButton>
              <span className="w-4 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{index + 1}</span>
              <StatusMenu status={m.status} onChange={(status) => update(m.id, (x) => ({ ...x, status }))} />
              <InlineInput
                value={m.title}
                ariaLabel={t('projectRoadmap.milestoneTitle')}
                className="font-medium"
                onCommit={(title) => title && update(m.id, (x) => ({ ...x, title }))}
              />
              <span className="hidden shrink-0 text-[12px] tabular-nums text-muted-foreground @[560px]:inline" title={t('projectRoadmap.stagesProgress')}>
                {progress.total ? `${progress.done}/${progress.total}` : ''}
              </span>
              {tasks.open + tasks.done > 0 ? (
                <span className="hidden shrink-0 text-[12px] tabular-nums text-muted-foreground @[640px]:inline">
                  {t('projectRoadmap.milestoneTasks', { done: tasks.done, total: tasks.open + tasks.done })}
                </span>
              ) : null}
              <div className="hidden shrink-0 items-center @[460px]:flex">
                <DateField
                  label={t('projectRoadmap.startDate')}
                  value={m.startDate}
                  onChange={(startDate) => update(m.id, (x) => ({ ...x, startDate, ...(startDate && x.dueDate && startDate > x.dueDate ? { dueDate: startDate } : {}) }))}
                />
                <span className="text-[12px] text-muted-foreground/60">—</span>
                <DateField
                  label={t('projectRoadmap.dueDate')}
                  value={m.dueDate}
                  onChange={(dueDate) => update(m.id, (x) => ({ ...x, dueDate, ...(dueDate && x.startDate && dueDate < x.startDate ? { startDate: dueDate } : {}) }))}
                />
              </div>
            </div>
            {expanded ? (
              <div className="min-w-0 pb-2 pl-12 pr-2">
                <div className="mb-1 flex items-center gap-1 @[460px]:hidden">
                  <DateField label={t('projectRoadmap.startDate')} value={m.startDate} onChange={(startDate) => update(m.id, (x) => ({ ...x, startDate }))} />
                  <span className="text-[12px] text-muted-foreground/60">—</span>
                  <DateField label={t('projectRoadmap.dueDate')} value={m.dueDate} onChange={(dueDate) => update(m.id, (x) => ({ ...x, dueDate }))} />
                </div>
                <AutoTextarea
                  value={m.description}
                  placeholder={t('projectRoadmap.milestoneDescriptionPlaceholder')}
                  ariaLabel={t('projectRoadmap.milestoneDescription')}
                  className="text-muted-foreground"
                  onCommit={(description) => update(m.id, (x) => ({ ...x, description }))}
                />
                <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{t('projectRoadmap.stages')}</div>
                <div className="flex flex-col">
                  {m.stages.map((stage) => (
                    <StageRow
                      key={stage.id}
                      stage={stage}
                      onChange={(next) => update(m.id, (x) => ({ ...x, stages: x.stages.map((s) => (s.id === stage.id ? next : s)) }))}
                      onRemove={() => update(m.id, (x) => ({ ...x, stages: x.stages.filter((s) => s.id !== stage.id) }))}
                      onToTask={(title) => onCreateTask(title, m.id)}
                    />
                  ))}
                  <AddRow
                    placeholder={t('projectRoadmap.addStagePlaceholder')}
                    onAdd={(title) => update(m.id, (x) => ({ ...x, stages: [...x.stages, { id: roadmapId('st'), title, done: false, substages: [] }] }))}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('projectRoadmap.deleteMilestoneConfirm', { title: m.title }))) {
                        onChange(milestones.filter((x) => x.id !== m.id))
                      }
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('projectRoadmap.deleteMilestone')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
      {milestones.length === 0 ? <EmptyLine>{t('projectRoadmap.milestonesEmpty')}</EmptyLine> : null}
      <AddRow placeholder={t('projectRoadmap.addMilestonePlaceholder')} onAdd={addMilestone} testId="project-add-milestone" />
    </div>
  )
}
