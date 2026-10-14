/**
 * DSH-P1 usage projections: turnOutline, tokenUsage (retries bill
 * separately), contextPressure, contextBreakdown, and agreement with the
 * session-total accumulator for the same provider-reported numbers.
 */
import { describe, expect, test } from 'bun:test'
import { createRuntimeTraceFixture } from './fixture'
import {
  approximateTextTokens,
  projectContextBreakdown,
  projectContextPressure,
  projectTokenUsage,
  projectTurnOutline,
} from './projector'
import { isRuntimeEvent } from './validation'
import type { RuntimeEvent } from './types'

const fixture = createRuntimeTraceFixture()
function event(seq: number, kind: RuntimeEvent['kind'], payload: unknown, extra: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return { ...fixture[0]!, eventId: `usage:${seq}`, sourceEventId: `usage:${seq}`, seq, sourceSeq: seq, kind, payload, ...extra } as RuntimeEvent
}
const attempt = (
  seq: number,
  turnId: string,
  step: number,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {},
) => {
  const { costUsd, contextWindow, ...rest } = usage
  return event(seq, 'llm.attempt.completed', {
    turnId, step, usage: rest,
    ...(typeof costUsd === 'number' ? { costUsd } : {}),
    ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
    ...extra,
  })
}
const stepStarted = (seq: number, turnId: string, step: number) => event(seq, 'step.started', { turnId, step })
const stepCompleted = (seq: number, turnId: string, step: number) => event(seq, 'step.completed', { turnId, step })

describe('turnOutline', () => {
  test('empty log has no turns or steps', () => {
    expect(projectTurnOutline([])).toEqual({ turns: [], turnCount: 0, stepCount: 0 })
  })
  test('groups steps per turn; a retry attempt adds no turn', () => {
    const events = [
      stepStarted(1, 'turn-a', 1),
      attempt(2, 'turn-a', 1, { uncachedInput: 100, output: 10 }),
      stepCompleted(3, 'turn-a', 1),
      stepStarted(4, 'turn-a', 2),
      // Retry of the second request: billed as its own attempt, same turn.
      attempt(5, 'turn-a', 2, { uncachedInput: 100, output: 12 }, { retryOf: 'usage:2' }),
      stepCompleted(6, 'turn-a', 2),
      stepStarted(7, 'turn-b', 1),
      attempt(8, 'turn-b', 1, { uncachedInput: 50, output: 5 }),
      stepCompleted(9, 'turn-b', 1),
    ]
    for (const e of events) expect(isRuntimeEvent(e)).toBe(true)
    const outline = projectTurnOutline(events)
    expect(outline.turnCount).toBe(2)
    expect(outline.stepCount).toBe(3)
    expect(outline.turns.map(t => [t.turnId, t.steps])).toEqual([['turn-a', 2], ['turn-b', 1]])
    expect(outline.turns[0]!.firstSeq).toBe(1)
  })
  test('attempt-only events still outline the turn', () => {
    const outline = projectTurnOutline([attempt(1, 'solo', 3, { uncachedInput: 10, output: 1 })])
    expect(outline).toMatchObject({ turnCount: 1, stepCount: 3 })
  })
})

describe('tokenUsage', () => {
  test('retries bill as separate attempts; per-turn and totals sum', () => {
    const events = [
      attempt(1, 'a', 1, { uncachedInput: 100, output: 10, cacheRead: 20, cacheWrite: 5, costUsd: 0.001 }),
      attempt(2, 'a', 2, { uncachedInput: 110, output: 12, cacheRead: 25, cacheWrite: 5, costUsd: 0.002 }, { retryOf: 'usage:1' }),
      attempt(3, 'b', 1, { uncachedInput: 50, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 }),
    ]
    const usage = projectTokenUsage(events)
    expect(usage.attempts).toHaveLength(3)
    expect(usage.totals.attempts).toBe(3)
    expect(usage.totals.retries).toBe(1)
    expect(usage.totals).toMatchObject({
      uncachedInput: 260, output: 27, cacheRead: 45, cacheWrite: 10, costUsd: 0.004, partial: false,
    })
    expect(usage.perTurn).toHaveLength(2)
    expect(usage.perTurn[0]).toMatchObject({ turnId: 'a', attempts: 2, retries: 1, output: 22 })
    expect(usage.perTurn[1]).toMatchObject({ turnId: 'b', attempts: 1, retries: 0, output: 5 })
  })
  test('missing provider fields stay undefined, never zero', () => {
    const usage = projectTokenUsage([attempt(1, 'a', 1, { uncachedInput: 100, output: 10 })])
    expect(usage.totals.cacheRead).toBeUndefined()
    expect(usage.totals.cacheWrite).toBeUndefined()
    expect(usage.totals.costUsd).toBeUndefined()
    expect(usage.totals.partial).toBe(false)
    expect(usage.perTurn[0]?.cacheRead).toBeUndefined()
  })
  test('missing headline fields mark the totals partial', () => {
    // Cost-only attempt: no billable token counts at all.
    const usage = projectTokenUsage([attempt(1, 'a', 1, {}, { costUsd: 0.002 })])
    expect(usage.totals.uncachedInput).toBeUndefined()
    expect(usage.totals.output).toBeUndefined()
    expect(usage.totals.costUsd).toBe(0.002)
    expect(usage.totals.partial).toBe(true)
  })
  test('reasoning and route survive per attempt', () => {
    const usage = projectTokenUsage([
      attempt(1, 'a', 1, { uncachedInput: 100, output: 30, reasoning: 12 }, { route: { provider: 'conn', model: 'm' } }),
    ])
    expect(usage.totals.reasoning).toBe(12)
    expect(usage.attempts[0]?.route).toEqual({ provider: 'conn', model: 'm' })
    expect(usage.attempts[0]?.usage).toMatchObject({ uncachedInput: 100, output: 30, reasoning: 12 })
  })
})

describe('contextPressure', () => {
  test('newest attempt pressure against newest window', () => {
    const pressure = projectContextPressure([
      attempt(1, 'a', 1, { uncachedInput: 1000, output: 10, cacheRead: 200, cacheWrite: 50 }, { contextWindow: 100000 }),
      attempt(2, 'a', 2, { uncachedInput: 2000, output: 10, cacheRead: 400, cacheWrite: 100 }),
    ])
    // Prompt-side only: 2000 + 400 + 100 = 2500 of 100000, about 3 percent.
    expect(pressure).toMatchObject({ pressureTokens: 2500, contextWindow: 100000, percent: 3, partial: false })
  })
  test('unknown window omits percent; unknown prompt is partial', () => {
    expect(projectContextPressure([attempt(1, 'a', 1, { output: 10 })])).toMatchObject({ partial: true })
    expect(projectContextPressure([attempt(1, 'a', 1, { uncachedInput: 500, output: 5 })])).toMatchObject({
      pressureTokens: 500,
      partial: true,
    })
  })
})

describe('contextBreakdown', () => {
  const snapshot = (blocks: Array<{ kind: string; text?: string; included?: boolean }>, seq = 1) =>
    event(seq, 'context.captured', {
      snapshot: {
        id: 'ctx', version: 1, capturedAt: { state: 'known', value: 1, origin: 'observed', source: 'test' },
        originalPrompt: { text: '' }, effectivePrompt: { text: '' },
        model: { confirmed: { state: 'known', value: 'm', origin: 'observed', source: 'test' }, contextWindow: { state: 'unknown', reason: 'not-emitted' } },
        blocks: blocks.map((b, i) => ({
          id: `b${i}`, kind: b.kind, label: b.kind, source: 'test', order: i,
          content: b.text === undefined ? {} : { text: b.text }, included: b.included ?? true,
        })),
        inputTokens: { state: 'unknown', reason: 'not-emitted' },
        coverage: { state: 'complete', source: 'runtime', missing: [] },
      },
    })
  test('classifies system/tools/messages as a labelled heuristic', () => {
    const breakdown = projectContextBreakdown([
      snapshot([
        { kind: 'system', text: 'sys' },
        { kind: 'tool-schema', text: '[tools]' },
        { kind: 'history', text: 'hello' },
        { kind: 'history', text: undefined, included: true },
      ]),
    ])
    expect(breakdown?.heuristic).toBe(true)
    const unit = (text: string) => approximateTextTokens(text)
    expect(breakdown).toMatchObject({ system: unit('sys'), tools: unit('[tools]'), messages: unit('hello') })
  })
  test('no snapshot means no breakdown', () => {
    expect(projectContextBreakdown([attempt(1, 'a', 1, { uncachedInput: 1, output: 1 })])).toBeUndefined()
  })
})
