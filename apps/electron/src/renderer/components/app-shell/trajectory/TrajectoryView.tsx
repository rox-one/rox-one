/**
 * Trajectory tab: toolbar, three-lane timing overview, virtualized event ledger
 * and record inspector.
 *
 * Interaction model and layout ported from DeepSeek Harness
 * `@deepseek-ai/dsh-client-ui-trajectory` (TrajectoryView / TrajectoryToolbar /
 * TrajectoryTimeline / TrajectoryTable), MIT License, Copyright (c) 2026 DeepSeek.
 * See notices/dsh-client-ui-trajectory.LICENSE.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Clock, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from '../../../../shared/types'
import {
  buildTrajectory,
  cullTimelineSpans,
  deriveTrajectoryTimeline,
  formatDurationMillis,
  projectTrajectoryRows,
  sortTimelineLanes,
  trajectoryInputDetail,
  trajectoryTimelineFocusIndexes,
  type TrajectoryCell,
  type TrajectoryCellKind,
  type TrajectoryTimeRange,
  type TrajectoryTimelineMode,
  type TrajectoryTimelineModel,
} from './trajectory-model'

const ROW_HEIGHT = 30
const TURN_ROW_HEIGHT = 22
const OVERSCAN = 8
const MINIMUM_DRAG_PX = 3
const MINIMUM_ZOOM_OPERATIONS = 4

const SPAN_COLOR: Record<TrajectoryCellKind, string> = {
  user: 'bg-accent',
  system: 'bg-muted-foreground/70',
  context: 'bg-success/70',
  compacted: 'bg-muted-foreground/60',
  message: 'bg-rose-400',
  tool: 'bg-amber-500',
  subtool: 'bg-amber-500/80',
}

const KIND_TAG: Record<TrajectoryCellKind, string> = {
  user: 'text-accent border-accent/30 bg-accent/10',
  system: 'text-muted-foreground border-border bg-foreground/5',
  context: 'text-success border-success/30 bg-success/10',
  compacted: 'text-muted-foreground border-border bg-foreground/5',
  message: 'text-rose-500 border-rose-400/30 bg-rose-400/10',
  tool: 'text-amber-600 border-amber-500/30 bg-amber-500/10',
  subtool: 'text-amber-600 border-amber-500/30 bg-amber-500/5',
}

function useKindLabel() {
  const { t } = useTranslation()
  return React.useCallback(
    (kind: TrajectoryCellKind) => t(`trajectory.kind.${kind === 'message' ? 'assistant' : kind}`),
    [t],
  )
}

export interface TrajectoryViewProps {
  messages: readonly Message[]
  onOpenMessage?: (messageId: string) => void
  className?: string
}

export function TrajectoryView({ messages, onOpenMessage, className }: TrajectoryViewProps) {
  const { t } = useTranslation()
  const turns = React.useMemo(() => buildTrajectory(messages), [messages])
  const [mode, setMode] = React.useState<TrajectoryTimelineMode>('sequence')
  const [collapsedTurns, setCollapsedTurns] = React.useState<ReadonlySet<string>>(() => new Set())
  const [collapseCalls, setCollapseCalls] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [range, setRange] = React.useState<TrajectoryTimeRange | null>(null)
  /** Selection is keyed by message id so it survives visibility changes of earlier records. */
  const [selected, setSelected] = React.useState<string | null>(null)

  const model = React.useMemo(() => deriveTrajectoryTimeline(turns, mode), [turns, mode])
  const focus = React.useMemo(() => (range ? trajectoryTimelineFocusIndexes(model, range) : null), [model, range])
  React.useEffect(() => setRange(null), [mode])

  const rows = React.useMemo(
    () => projectTrajectoryRows(turns, { collapsedTurns, collapseCalls, query, focus }),
    [turns, collapsedTurns, collapseCalls, query, focus],
  )
  const searchMatches = React.useMemo(() => {
    if (!query.trim()) return null
    return new Set(rows.flatMap((r) => (r.type === 'cell' ? [r.cell.index] : [])))
  }, [rows, query])

  const allTurnKeys = React.useMemo(() => turns.map((turn) => `turn:${turn.turn ?? 'pre'}`), [turns])
  const allTurnsCollapsed = allTurnKeys.length > 0 && allTurnKeys.every((k) => collapsedTurns.has(k))
  const cellsByIndex = React.useMemo(() => turns.flatMap((turn) => turn.cells), [turns])
  const selectedCell = React.useMemo(
    () => (selected === null ? null : (cellsByIndex.find((cell) => cell.messageId === selected) ?? null)),
    [cellsByIndex, selected],
  )
  const selectedMessage = React.useMemo(
    () => (selected === null ? undefined : messages.find((m) => m.id === selected)),
    [messages, selected],
  )
  const selectByIndex = React.useCallback(
    (index: number) => {
      const cell = cellsByIndex[index]
      if (cell) setSelected(cell.messageId)
    },
    [cellsByIndex],
  )

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)} data-testid="trajectory-view">
      <div role="toolbar" aria-label={t('trajectory.toolbar.aria')} className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-3">
        <ToolbarToggle
          pressed={mode === 'duration'}
          title={mode === 'duration' ? t('trajectory.toolbar.useEqualWidth') : t('trajectory.toolbar.useActualDuration')}
          onClick={() => setMode(mode === 'duration' ? 'sequence' : 'duration')}
        >
          <Clock className="h-3 w-3" aria-hidden />
          {t('trajectory.toolbar.duration')}
        </ToolbarToggle>
        <ToolbarToggle
          pressed={allTurnsCollapsed}
          title={allTurnsCollapsed ? t('trajectory.toolbar.expandTurns') : t('trajectory.toolbar.collapseTurns')}
          onClick={() => setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(allTurnKeys))}
        >
          <span aria-hidden>{allTurnsCollapsed ? '⊞' : '⊟'}</span>
          {t('trajectory.toolbar.turns')}
        </ToolbarToggle>
        <ToolbarToggle
          pressed={collapseCalls}
          title={collapseCalls ? t('trajectory.toolbar.expandCalls') : t('trajectory.toolbar.collapseCalls')}
          onClick={() => setCollapseCalls((v) => !v)}
        >
          <span aria-hidden>{collapseCalls ? '⊞' : '⊟'}</span>
          {t('trajectory.toolbar.calls')}
        </ToolbarToggle>
        <div className="ml-auto flex h-6 w-44 items-center gap-1.5 rounded-full border border-border/60 bg-foreground/[0.03] px-2">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label={t('trajectory.toolbar.search')}
            placeholder={t('trajectory.toolbar.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <TrajectoryTimeline
        model={model}
        mode={mode}
        range={range}
        selectedIndex={selectedCell?.index ?? null}
        searchMatches={searchMatches}
        onRangeChange={setRange}
        onRecordSelect={selectByIndex}
      />
      {turns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('trajectory.empty')}</div>
      ) : (
        <TrajectoryLedger
          rows={rows}
          selected={selected}
          onSelect={setSelected}
          onToggleTurn={(key) =>
            setCollapsedTurns((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }
        />
      )}
      {selectedCell && (
        <TrajectoryInspector cell={selectedCell} message={selectedMessage} onClose={() => setSelected(null)} onOpenMessage={onOpenMessage} />
      )}
    </div>
  )
}

function ToolbarToggle({ pressed, title, onClick, children }: { pressed: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs transition-colors',
        pressed ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Overview timeline (Chrome-Network-style; DSH TrajectoryTimeline)
// ---------------------------------------------------------------------------

interface TimelineProps {
  model: TrajectoryTimelineModel | null
  mode: TrajectoryTimelineMode
  range: TrajectoryTimeRange | null
  selectedIndex: number | null
  searchMatches: ReadonlySet<number> | null
  onRangeChange: (range: TrajectoryTimeRange | null) => void
  onRecordSelect: (index: number) => void
}

const TrajectoryTimeline = React.memo(function TrajectoryTimeline({ model, mode, range, selectedIndex, searchMatches, onRangeChange, onRecordSelect }: TimelineProps) {
  const { t } = useTranslation()
  const kindLabel = useKindLabel()
  const trackRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ pointerId: number; anchor: number; clientX: number; record: number | null } | null>(null)
  const [draft, setDraft] = React.useState<TrajectoryTimeRange | null>(null)
  const [viewport, setViewport] = React.useState<TrajectoryTimeRange | null>(null)
  const [trackWidth, setTrackWidth] = React.useState(800)
  React.useEffect(() => setViewport(null), [mode])
  React.useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    if (track.clientWidth > 0) setTrackWidth(track.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (track.clientWidth > 0) setTrackWidth(track.clientWidth)
    })
    ro.observe(track)
    return () => ro.disconnect()
  }, [])
  const lanes = React.useMemo(() => sortTimelineLanes(model), [model])

  const full = Math.max(1, (model?.end ?? 0) - (model?.start ?? 0))
  const domainStart = viewport?.start ?? model?.start ?? 0
  const domainDuration = viewport ? Math.max(1, viewport.end - viewport.start) : full
  // Only spans inside the visible domain are rendered, sub-pixel neighbours merged.
  const renderedSpans = React.useMemo(
    () => cullTimelineSpans(lanes, { start: domainStart, end: domainStart + domainDuration }, trackWidth),
    [lanes, domainStart, domainDuration, trackWidth],
  )

  React.useEffect(() => {
    const track = trackRef.current
    if (!track || !model) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = track.getBoundingClientRect()
      const anchorFraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
      const minimum = Math.min(mode === 'sequence' ? MINIMUM_ZOOM_OPERATIONS : 20, full)
      const nextDuration = Math.min(full, Math.max(minimum, domainDuration * Math.exp(event.deltaY * 0.0015)))
      if (nextDuration >= full * 0.999) {
        setViewport(null)
        return
      }
      const anchorTime = domainStart + anchorFraction * domainDuration
      const nextStart = Math.min(Math.max(anchorTime - anchorFraction * nextDuration, model.start), model.end - nextDuration)
      setViewport({ start: nextStart, end: nextStart + nextDuration })
    }
    track.addEventListener('wheel', onWheel, { passive: false })
    return () => track.removeEventListener('wheel', onWheel)
  }, [model, mode, full, domainDuration, domainStart])

  const pct = (value: number) => `${((value - domainStart) / domainDuration) * 100}%`
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return domainStart + Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width))) * domainDuration
  }
  const recordAt = (target: EventTarget | null) => {
    const value = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-timeline-record-index]')?.dataset.timelineRecordIndex : undefined
    return value === undefined ? null : Number(value)
  }
  const shown = draft ?? range

  return (
    <section aria-label={t('trajectory.timeline.aria')} className="relative shrink-0 select-none border-b border-border/60">
      <div className="grid h-[50px] grid-cols-[52px_minmax(0,1fr)] bg-foreground/[0.02]">
        <div aria-hidden className="relative border-r border-border/50 text-[10px] leading-none text-muted-foreground">
          <span className="absolute right-1.5 top-[7px]">{t('trajectory.lane.input')}</span>
          <span className="absolute right-1.5 top-[21px]">{t('trajectory.lane.model')}</span>
          <span className="absolute right-1.5 top-[35px]">{t('trajectory.lane.tools')}</span>
        </div>
        <div
          ref={trackRef}
          role="group"
          tabIndex={0}
          aria-label={t('trajectory.timeline.overviewAria')}
          className="relative cursor-crosshair overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-accent"
          onContextMenu={(e) => {
            e.preventDefault()
            onRangeChange(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onRangeChange(null)
              setViewport(null)
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || !model) return
            const anchor = timeAt(e.clientX)
            dragRef.current = { pointerId: e.pointerId, anchor, clientX: e.clientX, record: recordAt(e.target) }
            e.currentTarget.setPointerCapture?.(e.pointerId)
            setDraft({ start: anchor, end: anchor })
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== e.pointerId) return
            const now = timeAt(e.clientX)
            setDraft(drag.anchor <= now ? { start: drag.anchor, end: now } : { start: now, end: drag.anchor })
          }}
          onPointerUp={(e) => {
            const drag = dragRef.current
            dragRef.current = null
            setDraft(null)
            if (!drag || !model) return
            if (Math.abs(e.clientX - drag.clientX) < MINIMUM_DRAG_PX) {
              if (drag.record !== null) onRecordSelect(drag.record)
              else onRangeChange(null)
              return
            }
            const now = timeAt(e.clientX)
            onRangeChange(drag.anchor <= now ? { start: drag.anchor, end: now } : { start: now, end: drag.anchor })
          }}
          onPointerCancel={() => {
            dragRef.current = null
            setDraft(null)
          }}
        >
          {model === null ? (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t('trajectory.timeline.noTimingData')}</span>
          ) : (
            <>
              {model.turnBoundaries.filter((b) => b.time >= domainStart && b.time <= domainStart + domainDuration).map((b) => (
                <span key={b.turn} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-border" style={{ left: pct(b.time) }} />
              ))}
              <div className="absolute inset-x-0 bottom-[7px] top-[7px]">
                {renderedSpans.map((span) => {
                  const width = ((span.end - span.start) / domainDuration) * 100
                  const dim = (shown && !(span.start <= shown.end && span.end >= shown.start)) || (searchMatches && span.count === 1 && !searchMatches.has(span.index))
                  return (
                    <span
                      key={span.index}
                      data-timeline-record-index={span.index}
                      data-timeline-span={span.kind}
                      data-error={span.isError || undefined}
                      title={span.count > 1 ? `${kindLabel(span.kind)} × ${span.count}` : `${kindLabel(span.kind)} · ${span.label}`}
                      className={cn(
                        'absolute h-2 min-w-[2px] rounded-[1px]',
                        span.isError ? 'bg-destructive' : SPAN_COLOR[span.kind],
                        dim ? 'opacity-20' : 'opacity-90',
                        selectedIndex === span.index && 'z-[1] opacity-100 ring-2 ring-accent ring-offset-1 ring-offset-background',
                      )}
                      style={{
                        top: span.lane * 14,
                        left: `calc(${pct(span.start)} + 1px)`,
                        width: mode === 'sequence' ? `max(2px, calc(${width}% - 2px))` : `max(2px, ${width}%)`,
                      }}
                    />
                  )
                })}
              </div>
              {shown && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 border-x-2 border-accent bg-accent/10"
                  style={{ left: pct(shown.start), width: `${((shown.end - shown.start) / domainDuration) * 100}%` }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
})

// ---------------------------------------------------------------------------
// Ledger (fixed-height rows, windowed)
// ---------------------------------------------------------------------------

interface LedgerProps {
  rows: ReturnType<typeof projectTrajectoryRows>
  selected: string | null
  onSelect: (messageId: string) => void
  onToggleTurn: (key: string) => void
}

/**
 * Event ledger as an ARIA grid (row > gridcell) with a roving tabindex:
 * ArrowUp/Down/Home/End/PageUp/PageDown move focus (scrolling the virtual
 * window), Enter/Space select a record or toggle a turn. Turn headers keep a
 * real <button> (inside their gridcell) for expand/collapse semantics.
 */
function TrajectoryLedger({ rows, selected, onSelect, onToggleTurn }: LedgerProps) {
  const { t } = useTranslation()
  const kindLabel = useKindLabel()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [height, setHeight] = React.useState(600)
  const followRef = React.useRef(true)
  const [activeKey, setActiveKey] = React.useState<string | null>(null)
  const focusPendingRef = React.useRef(false)

  // Offsets: turn rows are shorter than content rows.
  const offsets = React.useMemo(() => {
    const out = new Array<number>(rows.length + 1)
    out[0] = 0
    for (let i = 0; i < rows.length; i++) out[i + 1] = out[i] + (rows[i].type === 'turn' ? TURN_ROW_HEIGHT : ROW_HEIGHT)
    return out
  }, [rows])
  const total = offsets[rows.length]
  const rowIndexByKey = React.useMemo(() => new Map(rows.map((row, i) => [row.key, i] as const)), [rows])
  // Roving tab stop: the active row if it still exists, else the selected record, else the first row.
  const activeIndex = React.useMemo(() => {
    if (rows.length === 0) return -1
    const byActive = activeKey === null ? undefined : rowIndexByKey.get(activeKey)
    if (byActive !== undefined) return byActive
    if (selected !== null) {
      const bySelected = rows.findIndex((row) => row.type === 'cell' && row.cell.messageId === selected)
      if (bySelected >= 0) return bySelected
    }
    return 0
  }, [rows, rowIndexByKey, activeKey, selected])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setHeight(el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Open at the tail and follow appends until the user scrolls up (DSH behaviour).
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [total])

  // After keyboard navigation, focus the newly active row once it is rendered.
  React.useLayoutEffect(() => {
    if (!focusPendingRef.current) return
    focusPendingRef.current = false
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"] [data-roving]`)
    target?.focus({ preventScroll: true })
  })

  const moveTo = (index: number) => {
    if (rows.length === 0) return
    const next = Math.min(rows.length - 1, Math.max(0, index))
    const el = scrollRef.current
    if (el) {
      const top = offsets[next]
      const bottom = offsets[next + 1]
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
      setScrollTop(el.scrollTop)
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
    }
    focusPendingRef.current = true
    setActiveKey(rows[next].key)
  }

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT))
    const handled: Record<string, number> = {
      ArrowDown: activeIndex + 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: rows.length - 1,
      PageDown: activeIndex + page,
      PageUp: activeIndex - page,
    }
    if (e.key in handled) {
      e.preventDefault()
      moveTo(handled[e.key])
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const row = rows[activeIndex]
      if (row?.type === 'cell') {
        e.preventDefault()
        onSelect(row.cell.messageId)
      }
      // Turn rows: the focused <button> handles Enter/Space natively.
    }
  }

  // Binary-search the first row under scrollTop, then window with overscan.
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= scrollTop) lo = mid + 1
    else hi = mid
  }
  // Window sized by the shortest row so the viewport is always covered.
  const start = Math.max(0, lo - OVERSCAN)
  const end = Math.min(rows.length, lo + Math.ceil(height / TURN_ROW_HEIGHT) + 1 + OVERSCAN)
  // Always render the roving tab stop so the grid stays reachable with Tab.
  const indexes: number[] = []
  if (activeIndex >= 0 && activeIndex < start) indexes.push(activeIndex)
  for (let i = start; i < end; i++) indexes.push(i)
  if (activeIndex >= end) indexes.push(activeIndex)

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-auto"
      role="grid"
      aria-label={t('trajectory.ledgerAria')}
      aria-rowcount={rows.length}
      aria-colcount={1}
      onKeyDown={onGridKeyDown}
      onScroll={(e) => {
        const el = e.currentTarget
        setScrollTop(el.scrollTop)
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
      }}
    >
      <div role="rowgroup" style={{ height: total, position: 'relative' }}>
        {indexes.map((rowIndex) => {
          const row = rows[rowIndex]
          const top = offsets[rowIndex]
          const tabIndex = rowIndex === activeIndex ? 0 : -1
          if (row.type === 'turn') {
            return (
              <div
                key={row.key}
                role="row"
                aria-rowindex={rowIndex + 1}
                data-row-index={rowIndex}
                className="absolute inset-x-0"
                style={{ top, height: TURN_ROW_HEIGHT }}
              >
                <div role="gridcell" className="h-full">
                  <button
                    type="button"
                    data-roving
                    tabIndex={tabIndex}
                    aria-expanded={!row.collapsed}
                    onFocus={() => setActiveKey(row.key)}
                    onClick={() => onToggleTurn(row.key)}
                    className="flex h-full w-full items-center gap-1.5 border-t-2 border-border/60 px-2 text-left font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    {row.collapsed ? <ChevronRight className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
                    <span className="rounded-b-sm bg-foreground/5 px-1.5">
                      {row.turn === null ? t('trajectory.betweenTurns') : t('trajectory.turn', { turn: row.turn })}
                    </span>
                    {row.collapsed && <span className="min-w-0 truncate font-sans text-xs">… {row.preview}</span>}
                  </button>
                </div>
              </div>
            )
          }
          const cell = row.cell
          const isTool = cell.kind === 'tool' || cell.kind === 'subtool'
          const isSelected = selected === cell.messageId
          return (
            <div
              key={row.key}
              role="row"
              aria-rowindex={rowIndex + 1}
              aria-selected={isSelected}
              data-row-index={rowIndex}
              data-kind={cell.kind}
              data-error={cell.isError || undefined}
              className="absolute inset-x-0"
              style={{ top, height: ROW_HEIGHT }}
            >
              <div
                role="gridcell"
                data-roving
                tabIndex={tabIndex}
                onFocus={() => setActiveKey(row.key)}
                onClick={() => onSelect(cell.messageId)}
                className={cn(
                  'flex h-full cursor-pointer items-center gap-2 border-l-2 pl-2 pr-3 text-xs outline-none hover:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent',
                  cell.isError ? 'border-destructive/50' : 'border-accent/20',
                  isSelected && 'bg-accent/10',
                )}
              >
                <span className={cn('flex w-[76px] shrink-0 justify-end', cell.kind === 'subtool' && 'pl-3')}>
                  <span className={cn('inline-flex h-[19px] items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide', cell.isError ? 'border-destructive/30 bg-destructive/10 text-destructive' : KIND_TAG[cell.kind])}>
                    {kindLabel(cell.kind)}
                  </span>
                </span>
                <span className={cn('flex min-w-0 flex-1 items-center truncate', isTool && 'font-mono text-[12px]', cell.kind === 'subtool' && 'pl-6')}>
                  <span className="truncate text-foreground">{cell.text || <span className="text-muted-foreground">{t('trajectory.noContent')}</span>}</span>
                  {isTool && (
                    <>
                      <span className="mx-2 shrink-0 text-muted-foreground" aria-hidden>→</span>
                      <span className={cn('min-w-0 truncate', cell.isError ? 'text-destructive' : 'text-muted-foreground')}>
                        {cell.running ? t('trajectory.running') : cell.resultPreview || t('trajectory.noOutput')}
                      </span>
                    </>
                  )}
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {cell.timeSeconds === null ? '—' : `${cell.durationEstimated ? '≈' : ''}${t('trajectory.unit.ms', { value: formatDurationMillis(cell.timeSeconds * 1000) })}`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrajectoryInspector({ cell, message, onClose, onOpenMessage }: { cell: TrajectoryCell; message: Message | undefined; onClose: () => void; onOpenMessage?: (id: string) => void }) {
  const { t } = useTranslation()
  const kindLabel = useKindLabel()
  // Pretty JSON is formatted only for the inspected record, never per message on rebuild.
  const inputDetail = React.useMemo(
    () => (cell.kind === 'tool' || cell.kind === 'subtool' ? trajectoryInputDetail(message) : undefined),
    [cell.kind, message],
  )
  return (
    <section aria-label={t('trajectory.details')} className="flex max-h-[40%] min-h-[120px] shrink-0 flex-col border-t border-border/60 bg-foreground/[0.02]">
      <header className="flex h-8 shrink-0 items-center gap-2 px-3 text-xs">
        <span className="font-semibold uppercase">{kindLabel(cell.kind)}</span>
        {cell.toolName && <span className="font-mono">{cell.toolName}</span>}
        <span className="text-muted-foreground">
          {cell.isError ? t('trajectory.status.failed') : cell.running ? t('trajectory.status.pending') : t('trajectory.status.completed')}
          {cell.startedAt !== null && ` · ${new Date(cell.startedAt).toLocaleTimeString()}`}
          {cell.timeSeconds !== null && ` · ${cell.durationEstimated ? '≈' : ''}${t('trajectory.unit.ms', { value: formatDurationMillis(cell.timeSeconds * 1000) })}`}
        </span>
        {onOpenMessage && (
          <button type="button" className="ml-auto rounded-full px-2 py-0.5 text-accent hover:bg-accent/10" onClick={() => onOpenMessage(cell.messageId)}>
            {t('trajectory.openInChat')}
          </button>
        )}
        <button type="button" aria-label={t('trajectory.closeDetails')} className={cn('rounded-full p-1 hover:bg-foreground/10', !onOpenMessage && 'ml-auto')} onClick={onClose}>
          <X className="h-3 w-3" />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto px-3 pb-3 md:grid-cols-2">
        {inputDetail !== undefined && <DetailBlock label={t('trajectory.input')} text={inputDetail} />}
        <DetailBlock label={t('trajectory.output')} text={cell.outputDetail ?? ''} error={cell.isError} />
      </div>
    </section>
  )
}

function DetailBlock({ label, text, error }: { label: string; text: string; error?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className={cn('max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-foreground/[0.04] p-2 font-mono text-[11px]', error && 'text-destructive')}>
        {text.length > 20000 ? `${text.slice(0, 20000)}…` : text || t('trajectory.noOutput')}
      </pre>
    </div>
  )
}
