/**
 * Trajectory projection for Rox chat sessions.
 *
 * Ported from DeepSeek Harness `@deepseek-ai/dsh-client-ui-trajectory`
 * (packages/client/ui-trajectory, timeline.ts / trajectory-record.ts /
 * trajectory-preview.ts), MIT License, Copyright (c) 2026 DeepSeek.
 * See notices/dsh-client-ui-trajectory.LICENSE. Adapted to Rox `Message` data:
 * DSH projects Session events, Rox projects the flat message list.
 */
import type { Message } from '../../../../shared/types'

export type TrajectoryCellKind = 'system' | 'user' | 'context' | 'compacted' | 'message' | 'tool' | 'subtool'

export interface TrajectoryCell {
  /** Ledger order across the whole session. */
  index: number
  kind: TrajectoryCellKind
  messageId: string
  /** 1-based user turn, or null for records before the first user prompt. */
  turn: number | null
  /** One-line ledger text (assistant/user preview, or `name {args}` for tools). */
  text: string
  /** Tool result one-line preview (tools only). */
  resultPreview?: string
  toolName?: string
  /** Full recorded output for the inspector (input is formatted lazily, see trajectoryInputDetail). */
  outputDetail?: string
  startedAt: number | null
  /** Seconds; null while running or when unrecorded. */
  timeSeconds: number | null
  /** True when the duration was inferred from the next record's timestamp. */
  durationEstimated: boolean
  isError: boolean
  running: boolean
}

export interface TrajectoryTurnModel {
  turn: number | null
  cells: TrajectoryCell[]
}

const PREVIEW_SOURCE_CHARACTERS = 2048
const PREVIEW_OUTPUT_CHARACTERS = 512

/** Bounded one-line preview (DSH trajectoryPreviewText, markdown stripping simplified). */
export function trajectoryPreviewText(text: string): string {
  const source = text.slice(0, PREVIEW_SOURCE_CHARACTERS)
  const compact = source
    .replace(/```[a-z0-9_-]*\n?/gi, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const preview = compact.slice(0, PREVIEW_OUTPUT_CHARACTERS).trimEnd()
  return source.length < text.length || preview.length < compact.length ? `${preview}…` : preview
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function kindFor(message: Message): TrajectoryCellKind | null {
  if (message.hidden) return null
  switch (message.role) {
    case 'user':
      return 'user'
    case 'assistant':
    case 'thinking':
      return 'message'
    case 'tool':
      return message.parentToolUseId ? 'subtool' : 'tool'
    case 'status':
      return message.statusType === 'compaction_complete' || message.statusType === 'compacting' ? 'compacted' : null
    case 'error':
      return 'system'
    case 'plan':
    case 'info':
    case 'warning':
      return 'context'
    default:
      return null
  }
}

/** Pretty-printed tool input, computed lazily by the inspector only. */
export function trajectoryInputDetail(message: Message | undefined): string | undefined {
  if (!message?.toolInput) return undefined
  try {
    return JSON.stringify(message.toolInput, null, 2) ?? undefined
  } catch {
    return String(message.toolInput)
  }
}

type CellContent = Pick<TrajectoryCell, 'text' | 'resultPreview' | 'toolName' | 'outputDetail'>

/**
 * Per-message content cache. Messages are immutable snapshots: a streaming
 * delta replaces only the tail message object, so unchanged messages reuse
 * their previews and only the changed tail is recomputed.
 */
const contentCache = new WeakMap<Message, CellContent>()

function contentFor(message: Message, kind: TrajectoryCellKind): CellContent {
  const cached = contentCache.get(message)
  if (cached) return cached
  let content: CellContent
  if (kind === 'tool' || kind === 'subtool') {
    const name = message.toolName ?? message.toolDisplayName ?? 'tool'
    const args = message.toolInput ? compactJson(message.toolInput) : ''
    content = { toolName: name, text: trajectoryPreviewText(args ? `${name} ${args}` : name) }
    const result = message.toolResult || message.content || undefined
    if (result !== undefined) {
      content.outputDetail = result
      content.resultPreview = trajectoryPreviewText(result)
    }
  } else {
    content = { text: trajectoryPreviewText(message.content || message.errorTitle || ''), outputDetail: message.content || message.errorTitle || undefined }
  }
  contentCache.set(message, content)
  return content
}

/** Upper bound for inferred durations so an idle gap never becomes a giant span. */
const MAX_INFERRED_MS = 10 * 60 * 1000

/**
 * Project the Rox message list into turn-grouped trajectory records.
 * - user message → USER (opens a turn)
 * - assistant/thinking → ASSISTANT (lane Model); duration = gap to the next record of the same turn (estimated;
 *   never inferred across a turn boundary, so user think/idle time is not attributed to the model)
 * - tool → TOOL / SUBTOOL (lane Tools); duration = toolDuration (ms) or estimated gap; error status → red
 * - error → SYSTEM, compaction status → COMPACTED, plan/info/warning → CONTEXT
 */
export function buildTrajectory(messages: readonly Message[]): TrajectoryTurnModel[] {
  const visible = messages.filter((m) => kindFor(m) !== null && m.statusType !== 'retrying')
  const turns: TrajectoryTurnModel[] = []
  let current: TrajectoryTurnModel | null = null
  let turnNumber = 0
  visible.forEach((message, index) => {
    const kind = kindFor(message)!
    if (kind === 'user') {
      turnNumber += 1
      current = { turn: turnNumber, cells: [] }
      turns.push(current)
    } else if (current === null) {
      current = { turn: null, cells: [] }
      turns.push(current)
    }
    const next = visible[index + 1]
    const startedAt = Number.isFinite(message.timestamp) ? message.timestamp : null
    const running = message.isStreaming === true || message.toolStatus === 'executing' || message.toolStatus === 'pending'
    let timeSeconds: number | null = null
    let durationEstimated = false
    if (kind === 'tool' || kind === 'subtool') {
      if (typeof message.toolDuration === 'number' && Number.isFinite(message.toolDuration)) {
        timeSeconds = Math.max(0, message.toolDuration) / 1000
      }
    }
    if (
      timeSeconds === null &&
      !running &&
      kind !== 'user' &&
      startedAt !== null &&
      next !== undefined &&
      kindFor(next) !== 'user' &&
      Number.isFinite(next.timestamp)
    ) {
      const gap = next.timestamp - startedAt
      if (gap >= 0 && gap <= MAX_INFERRED_MS) {
        timeSeconds = gap / 1000
        durationEstimated = true
      }
    }
    const isError = message.isError === true || message.toolStatus === 'error' || message.role === 'error'
    const cell: TrajectoryCell = {
      index,
      kind,
      messageId: message.id,
      turn: current!.turn,
      ...contentFor(message, kind),
      startedAt,
      timeSeconds,
      durationEstimated,
      isError,
      running,
    }
    current!.cells.push(cell)
  })
  return turns
}

// ---------------------------------------------------------------------------
// Timeline (ported 1:1 from DSH timeline.ts)
// ---------------------------------------------------------------------------

export type TrajectoryTimelineMode = 'sequence' | 'duration'

export interface TrajectoryTimeRange {
  start: number
  end: number
}

export interface TrajectoryTimelineSpan extends TrajectoryTimeRange {
  index: number
  isError: boolean
  kind: TrajectoryCellKind
  label: string
  lane: number
}

export interface TrajectoryTimelineModel extends TrajectoryTimeRange {
  spans: TrajectoryTimelineSpan[]
  turnBoundaries: Array<{ turn: number; time: number }>
}

/** Lane 0 = Input, 1 = Model, 2 = Tools. */
export function laneFor(kind: TrajectoryCellKind): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'message' || kind === 'compacted') return 1
  return 0
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

function cellRange(cell: TrajectoryCell): TrajectoryTimeRange | null {
  if (!finite(cell.startedAt)) return null
  const durationMs = finite(cell.timeSeconds) ? Math.max(0, cell.timeSeconds * 1e3) : 0
  return { start: cell.startedAt, end: cell.startedAt + durationMs }
}

function spanFor(cell: TrajectoryCell, start: number, end: number): TrajectoryTimelineSpan {
  return { start, end, index: cell.index, isError: cell.isError, kind: cell.kind, label: cell.text, lane: laneFor(cell.kind) }
}

export function deriveTrajectoryTimeline(
  turns: readonly TrajectoryTurnModel[],
  mode: TrajectoryTimelineMode = 'sequence',
): TrajectoryTimelineModel | null {
  if (mode === 'duration') return deriveTimedTimeline(turns)
  const spans: TrajectoryTimelineSpan[] = []
  const turnBoundaries: TrajectoryTimelineModel['turnBoundaries'] = []
  for (const turn of turns) {
    if (turn.cells.length === 0) continue
    if (turn.turn !== null) turnBoundaries.push({ turn: turn.turn, time: spans.length })
    const base = spans.length
    turn.cells.forEach((cell, offset) => spans.push(spanFor(cell, base + offset, base + offset + 1)))
  }
  if (spans.length === 0) return null
  return { start: 0, end: spans.length, spans, turnBoundaries }
}

/** Recorded-duration projection with idle gaps compressed (DSH mode "duration"). */
function deriveTimedTimeline(turns: readonly TrajectoryTurnModel[]): TrajectoryTimelineModel | null {
  const timedTurns = turns.flatMap((turn) => {
    const rawSpans = turn.cells.flatMap((cell) => {
      const range = cellRange(cell)
      return range === null ? [] : [spanFor(cell, range.start, range.end)]
    })
    return rawSpans.length === 0 ? [] : [{ turn: turn.turn, rawSpans }]
  })
  const rawSpans = timedTurns.flatMap((turn) => turn.rawSpans)
  if (rawSpans.length === 0) return null
  const removedIdleBySpan = new Map<TrajectoryTimelineSpan, number>()
  let removedIdle = 0
  let coveredUntil: number | null = null
  for (const span of [...rawSpans].sort((l, r) => l.start - r.start || l.end - r.end)) {
    if (coveredUntil !== null && span.start > coveredUntil) removedIdle += span.start - coveredUntil
    removedIdleBySpan.set(span, removedIdle)
    coveredUntil = coveredUntil === null ? span.end : Math.max(coveredUntil, span.end)
  }
  const spans: TrajectoryTimelineSpan[] = []
  const turnBoundaries: TrajectoryTimelineModel['turnBoundaries'] = []
  for (const turn of timedTurns) {
    const projected = turn.rawSpans.map((span) => {
      const offset = removedIdleBySpan.get(span) ?? 0
      return { ...span, start: span.start - offset, end: span.end - offset }
    })
    spans.push(...projected)
    if (turn.turn !== null) turnBoundaries.push({ turn: turn.turn, time: Math.min(...projected.map((s) => s.start)) })
  }
  let start = Infinity
  let end = -Infinity
  for (const s of spans) {
    if (s.start < start) start = s.start
    if (s.end > end) end = s.end
  }
  return { start, end, spans, turnBoundaries }
}

export interface TrajectoryRenderedSpan extends TrajectoryTimelineSpan {
  /** Number of records merged into this span (1 = a single record). */
  count: number
}

/** Spans of each lane sorted by start, computed once per model. */
export function sortTimelineLanes(model: TrajectoryTimelineModel | null): TrajectoryTimelineSpan[][] {
  const lanes: TrajectoryTimelineSpan[][] = [[], [], []]
  if (!model) return lanes
  for (const span of model.spans) lanes[span.lane]!.push(span)
  for (const lane of lanes) lane.sort((l, r) => l.start - r.start || l.end - r.end)
  return lanes
}

/**
 * Cull spans outside the visible domain and merge spans whose pixels overlap
 * (each span is at least minSpanPx wide), so DOM cost is bounded by track
 * width (≤ 3 lanes × width / minSpanPx) rather than by record count. A merged span keeps the first record's
 * index (click target), is an error if any member is, and reports `count`.
 */
export function cullTimelineSpans(
  lanes: readonly (readonly TrajectoryTimelineSpan[])[],
  domain: TrajectoryTimeRange,
  trackWidthPx: number,
  minSpanPx = 2,
): TrajectoryRenderedSpan[] {
  const duration = Math.max(1e-9, domain.end - domain.start)
  const pxPerUnit = Math.max(1, trackWidthPx) / duration
  const out: TrajectoryRenderedSpan[] = []
  for (const lane of lanes) {
    let open: TrajectoryRenderedSpan | null = null
    let openEndPx = -Infinity
    for (const span of lane) {
      if (span.end < domain.start) continue
      if (span.start > domain.end) break
      const startPx = (span.start - domain.start) * pxPerUnit
      const endPx = Math.max(startPx + minSpanPx, (span.end - domain.start) * pxPerUnit)
      // Pixel overlap with the previous rendered span → merge. Rendered spans in a
      // lane never overlap, so each lane renders at most width / minSpanPx spans.
      if (open && startPx < openEndPx) {
        open.end = Math.max(open.end, span.end)
        open.isError = open.isError || span.isError
        open.count += 1
        openEndPx = Math.max(openEndPx, endPx)
        continue
      }
      open = { ...span, count: 1 }
      openEndPx = endPx
      out.push(open)
    }
  }
  return out
}

/** Records active at any point inside an inclusive selected interval. */
export function trajectoryTimelineFocusIndexes(model: TrajectoryTimelineModel | null, range: TrajectoryTimeRange): Set<number> {
  return new Set(model?.spans.filter((s) => s.start <= range.end && s.end >= range.start).map((s) => s.index))
}

/** DSH formatDurationMillis: integer ms with thousands separators. */
export function formatDurationMillis(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—'
  return String(Math.round(milliseconds)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ---------------------------------------------------------------------------
// Ledger rows: fold + search projection, fixed-height windowing
// ---------------------------------------------------------------------------

export type TrajectoryRow =
  | { type: 'turn'; key: string; turn: number | null; count: number; collapsed: boolean; preview: string }
  | { type: 'cell'; key: string; cell: TrajectoryCell }

export function cellMatches(cell: TrajectoryCell, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    cell.text.toLowerCase().includes(q) ||
    (cell.resultPreview?.toLowerCase().includes(q) ?? false) ||
    (cell.toolName?.toLowerCase().includes(q) ?? false)
  )
}

/**
 * Flatten turns into ledger rows. Collapsed turns render one summary row;
 * collapsed calls hide tool/subtool rows (DSH "Calls" toggle). Search keeps
 * only matching cells and their turn headers.
 */
export function projectTrajectoryRows(
  turns: readonly TrajectoryTurnModel[],
  opts: { collapsedTurns: ReadonlySet<string>; collapseCalls: boolean; query: string; focus?: ReadonlySet<number> | null },
): TrajectoryRow[] {
  const rows: TrajectoryRow[] = []
  const query = opts.query.trim()
  for (const turn of turns) {
    const key = `turn:${turn.turn ?? 'pre'}`
    const cells = turn.cells.filter(
      (c) =>
        cellMatches(c, query) &&
        (!opts.collapseCalls || (c.kind !== 'tool' && c.kind !== 'subtool')) &&
        (!opts.focus || opts.focus.has(c.index)),
    )
    if (cells.length === 0 && (query || opts.focus)) continue
    const collapsed = opts.collapsedTurns.has(key)
    rows.push({
      type: 'turn',
      key,
      turn: turn.turn,
      count: turn.cells.length,
      collapsed,
      preview: turn.cells[0]?.kind === 'user' ? turn.cells[0].text : '',
    })
    if (collapsed) continue
    for (const cell of cells) rows.push({ type: 'cell', key: `cell:${cell.messageId}:${cell.index}`, cell })
  }
  return rows
}

/** Visible slice for a fixed-row-height virtual list (overscan rows each side). */
export function virtualWindow(
  rowCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 8,
): { start: number; end: number } {
  if (rowCount === 0) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1
  const start = Math.max(0, first - overscan)
  const end = Math.min(rowCount, first + visible + overscan)
  return { start, end }
}
