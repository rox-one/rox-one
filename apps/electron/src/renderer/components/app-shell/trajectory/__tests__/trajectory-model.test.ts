import { describe, expect, it } from 'bun:test'
import type { Message } from '../../../../../shared/types'
import {
  buildTrajectory,
  cullTimelineSpans,
  sortTimelineLanes,
  trajectoryInputDetail,
  deriveTrajectoryTimeline,
  formatDurationMillis,
  laneFor,
  projectTrajectoryRows,
  trajectoryPreviewText,
  trajectoryTimelineFocusIndexes,
  virtualWindow,
} from '../trajectory-model'

const m = (p: Partial<Message> & Pick<Message, 'id' | 'role' | 'timestamp'>): Message => ({ content: '', ...p }) as Message

const session: Message[] = [
  m({ id: 'u1', role: 'user', content: 'Fix the **build**', timestamp: 1000 }),
  m({ id: 'a1', role: 'assistant', content: 'Looking', timestamp: 1100, isIntermediate: true }),
  m({ id: 't1', role: 'tool', toolName: 'Bash', toolInput: { command: 'ls' }, toolResult: 'a\nb', toolStatus: 'completed', timestamp: 1200, toolDuration: 250 }),
  m({ id: 't2', role: 'tool', toolName: 'Read', toolInput: { path: 'x' }, toolResult: 'ENOENT', toolStatus: 'error', isError: true, timestamp: 1500, parentToolUseId: 'p' }),
  m({ id: 'h', role: 'user', content: 'hidden nudge', timestamp: 1600, hidden: true }),
  m({ id: 'a2', role: 'assistant', content: 'Done', timestamp: 1700 }),
  m({ id: 'u2', role: 'user', content: 'Thanks', timestamp: 5000 }),
  m({ id: 'a3', role: 'assistant', content: 'stream', timestamp: 5100, isStreaming: true }),
]

describe('buildTrajectory maps Rox messages to DSH-style records', () => {
  const turns = buildTrajectory(session)
  it('groups by user turn and skips hidden messages', () => {
    expect(turns.map((t) => t.turn)).toEqual([1, 2])
    expect(turns[0].cells.map((c) => c.kind)).toEqual(['user', 'message', 'tool', 'subtool', 'message'])
    expect(turns.flatMap((t) => t.cells).some((c) => c.messageId === 'h')).toBe(false)
  })
  it('renders tools as `name {args}` with a result preview and error flag', () => {
    const [, , bash, read] = turns[0].cells
    expect(bash.text).toBe('Bash {"command":"ls"}')
    expect(bash.resultPreview).toBe('a b')
    expect(bash.timeSeconds).toBe(0.25)
    expect(bash.durationEstimated).toBe(false)
    expect(read.isError).toBe(true)
    expect(read.kind).toBe('subtool')
  })
  it('infers durations from the next record and leaves running records open', () => {
    const assistant = turns[0].cells[1]
    expect(assistant.timeSeconds).toBeCloseTo(0.1)
    expect(assistant.durationEstimated).toBe(true)
    expect(turns[1].cells[1].running).toBe(true)
    expect(turns[1].cells[1].timeSeconds).toBeNull()
    expect(turns[0].cells[0].timeSeconds).toBeNull()
  })
  it('strips markdown in previews and caps length', () => {
    expect(trajectoryPreviewText('Fix the **build**')).toBe('Fix the build')
    expect(trajectoryPreviewText('x'.repeat(3000)).endsWith('…')).toBe(true)
  })
})

describe('timeline projection (ported from DSH timeline.ts)', () => {
  const turns = buildTrajectory(session)
  it('sequence mode gives every record one unit on its lane', () => {
    const model = deriveTrajectoryTimeline(turns, 'sequence')!
    expect(model.start).toBe(0)
    expect(model.end).toBe(7)
    expect(model.spans.map((s) => s.lane)).toEqual([0, 1, 2, 2, 1, 0, 1])
    expect(model.turnBoundaries).toEqual([{ turn: 1, time: 0 }, { turn: 2, time: 5 }])
    expect(model.spans[3].isError).toBe(true)
  })
  it('duration mode compresses idle gaps between records', () => {
    const model = deriveTrajectoryTimeline(turns, 'duration')!
    const u2 = model.spans.find((s) => s.index === 5)!
    // a2 ends at 1700 + (5000-1700 inferred) so no gap; the turn starts right after.
    expect(u2.start).toBeLessThanOrEqual(5000)
    expect(model.end).toBeGreaterThan(model.start)
  })
  it('focus returns records overlapping an inclusive range', () => {
    const model = deriveTrajectoryTimeline(turns, 'sequence')
    expect([...trajectoryTimelineFocusIndexes(model, { start: 2.5, end: 3.5 })].sort()).toEqual([2, 3])
  })
  it('lanes and formatting match DSH', () => {
    expect(laneFor('user')).toBe(0)
    expect(laneFor('message')).toBe(1)
    expect(laneFor('subtool')).toBe(2)
    expect(formatDurationMillis(1234567.4)).toBe('1,234,567')
    expect(formatDurationMillis(null)).toBe('—')
  })
  it('returns null for an empty session', () => {
    expect(deriveTrajectoryTimeline([], 'sequence')).toBeNull()
  })
})

describe('ledger rows', () => {
  const turns = buildTrajectory(session)
  it('collapses turns, hides calls and filters by search', () => {
    const all = projectTrajectoryRows(turns, { collapsedTurns: new Set(), collapseCalls: false, query: '' })
    expect(all.length).toBe(2 + 7)
    const collapsed = projectTrajectoryRows(turns, { collapsedTurns: new Set(['turn:1']), collapseCalls: false, query: '' })
    expect(collapsed.length).toBe(2 + 2)
    expect(collapsed[0]).toMatchObject({ type: 'turn', collapsed: true, preview: 'Fix the build' })
    const noCalls = projectTrajectoryRows(turns, { collapsedTurns: new Set(), collapseCalls: true, query: '' })
    expect(noCalls.some((r) => r.type === 'cell' && r.cell.kind === 'tool')).toBe(false)
    const search = projectTrajectoryRows(turns, { collapsedTurns: new Set(), collapseCalls: false, query: 'enoent' })
    expect(search.map((r) => r.key)).toEqual(['turn:1', 'cell:t2:3'])
  })
  it('virtualWindow bounds a long ledger', () => {
    expect(virtualWindow(10000, 30, 30000, 600, 8)).toEqual({ start: 992, end: 1029 })
    expect(virtualWindow(0, 30, 0, 600)).toEqual({ start: 0, end: 0 })
  })
  it('handles a 5000-record session quickly', () => {
    const big: Message[] = []
    for (let i = 0; i < 5000; i++) big.push(m({ id: `x${i}`, role: i % 10 === 0 ? 'user' : i % 2 ? 'tool' : 'assistant', toolName: 'Bash', toolInput: { i }, timestamp: i * 10 }))
    const t0 = performance.now()
    const tt = buildTrajectory(big)
    deriveTrajectoryTimeline(tt, 'duration')
    projectTrajectoryRows(tt, { collapsedTurns: new Set(), collapseCalls: false, query: 'bash' })
    expect(tt.length).toBe(500)
    expect(performance.now() - t0).toBeLessThan(1500)
  })

  it('never infers a duration across a turn boundary', () => {
    const msgs = [
      { id: 'u1', role: 'user', content: 'q', timestamp: 0 },
      { id: 'a1', role: 'assistant', content: 'a', timestamp: 1000 },
      { id: 'u2', role: 'user', content: 'q2', timestamp: 500_000 },
      { id: 'a2', role: 'assistant', content: 'b', timestamp: 501_000 },
    ] as Message[]
    const turns = buildTrajectory(msgs)
    expect(turns[0].cells[1].timeSeconds).toBeNull()
    expect(turns[0].cells[1].durationEstimated).toBe(false)
    expect(turns[1].cells[1].timeSeconds).toBeNull()
  })

  it('reuses per-message content for unchanged message objects and formats input lazily', () => {
    const tool = { id: 't', role: 'tool', content: '', toolName: 'Bash', toolInput: { a: 1 }, toolResult: 'ok', timestamp: 1 } as Message
    const first = buildTrajectory([tool])[0].cells[0]
    const second = buildTrajectory([tool])[0].cells[0]
    expect(second.text).toBe(first.text)
    expect('inputDetail' in first).toBe(false)
    expect(trajectoryInputDetail(tool)).toBe('{\n  "a": 1\n}')
    expect(trajectoryInputDetail(undefined)).toBeUndefined()
  })

  it('falls back to errorTitle when error content is empty', () => {
    const cell = buildTrajectory([{ id: 'e', role: 'error', content: '', errorTitle: 'Rate limited', timestamp: 1 } as Message])[0].cells[0]
    expect(cell.text).toBe('Rate limited')
  })

  it('culls off-domain spans and merges sub-pixel neighbours', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, role: 'tool', content: '', toolName: 'X', timestamp: i } as Message))
    const model = deriveTrajectoryTimeline(buildTrajectory(many), 'sequence')!
    const lanes = sortTimelineLanes(model)
    const all = cullTimelineSpans(lanes, { start: model.start, end: model.end }, 500)
    expect(all.length).toBeLessThanOrEqual(250)
    expect(all.reduce((n, s) => n + s.count, 0)).toBe(5000)
    const zoomed = cullTimelineSpans(lanes, { start: 100, end: 110 }, 500)
    expect(zoomed.every((s) => s.count === 1)).toBe(true)
    expect(zoomed.length).toBeLessThanOrEqual(12)
    const err = cullTimelineSpans([[{ start: 0, end: 1, index: 0, isError: false, kind: 'tool', label: '', lane: 2 }, { start: 1, end: 2, index: 1, isError: true, kind: 'tool', label: '', lane: 2 }], [], []], { start: 0, end: 1000 }, 100)
    expect(err.length).toBe(1)
    expect(err[0].isError).toBe(true)
  })
})
