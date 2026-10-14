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
import { accumulateAttemptSessionUsage, type AttemptSessionUsageState } from '@rox/shared/sessions/session-tokens'
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
) => event(seq, 'llm.attempt.completed', { turnId, step, usage, ...extra })
const stepStarted = (seq: number, turnId: string, step: number) => event(seq, 'step.started', { turnId, step })
const stepCompleted = (seq: number, turnId: string, step: number) => event(seq, 'step.completed', { turnId, step })

const zeroSession = (): AttemptSessionUsageState => ({
  inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0,
})

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
  test('missing provider fields stay undefined and mark partial; never zero', () => {
    const usage = projectTokenUsage([attempt(1, 'a', 1, { uncachedInput: 100, output: 10 })])
    expect(usage.totals.cacheRead).toBeUndefined()
    expect(usage.totals.cacheWrite).toBeUndefined()
    expect(usage.totals.costUsd).toBeUndefined()
    expect(usage.totals.partial).toBe(true)
    expect(usage.perTurn[0]?.cacheRead).toBeUndefined()
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
      attempt(1, 'a', 1, { uncachedInput: 1000, output: 10, cacheRead: 200, cacheWrite: 50 }, { contextWindow: 100_000 }),
      attempt(2, 'a', 2, { uncachedInput: 2000, output: 10, cacheRead: 400, cacheWrite: 100 }),
    ])
    // Prompt-side only: 2000 + 400 + 100 = 2500 of 100_000 → 3% (rounded).
    expect(pressure).toMatchObject({ pressureTokens: 2500, contextWindow: 100_000, percent: 3, partial: false })
  })
  test('unknown window omits percent; unknown prompt is partial', () => {
    expect(projectContextPressure([attempt(1, 'a', 1, { output: 10 })])).toMatchObject({ partial: true })
    expect(projectContextPressure([attempt(1, 'a', 1, { uncachedInput: 500, output: 5 })]).toMatchObject({
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

describe('agreement with SessionTokenUsage accumulation', () => {
  test('same provider numbers: prompt/output/cost agree', () => {
    // As emitted by SessionManager: prompt 1000 incl. cache → uncached 790.
    const journal = [attempt(1, 'a', 1, { uncachedInput: 790, output: 50, cacheRead: 200, cacheWrite: 10, costUsd: 0.002 })]
    const usage = projectTokenUsage(journal)
    let session = zeroSession()
    session = accumulateAttemptSessionUsage(session, {
      inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200, cacheCreationTokens: 10, costUsd: 0.002,
    })
    const promptSum = (usage.totals.uncachedInput ?? 0) + (usage.totals.cacheRead ?? 0) + (usage.totals.cacheWrite ?? 0)
    expect(promptSum).toBe(session.inputTokens)
    expect(usage.totals.output).toBe(session.outputTokens)
    expect(usage.totals.costUsd).toBe(session.costUsd)
    expect(session.totalTokens).toBe(session.inputTokens + session.outputTokens)
  })
  test('output and cost accumulate identically across retries; input is last-wins vs billed-sum by design', () => {
    const journal = [
      attempt(1, 'a', 1, { uncachedInput: 790, output: 50, cacheRead: 200, cacheWrite: 10, costUsd: 0.002 }),
      attempt(2, 'a', 2, { uncachedInput: 800, output: 60, cacheRead: 210, cacheWrite: 10, costUsd: 0.003 }, { retryOf: 'usage:1' }),
    ]
    const usage = projectTokenUsage(journal)
    let session = zeroSession()
    for (const [prompt, out, cost] of [[1000, 50, 0.002], [1020, 60, 0.003]] as const) {
      session = accumulateAttemptSessionUsage(session, {
        inputTokens: prompt, outputTokens: out, cacheReadTokens: 200, cacheCreationTokens: 10, costUsd: cost,
      })
    }
    // Accumulated fields agree exactly.
    expect(usage.totals.output).toBe(session.outputTokens)
    expect(usage.totals.costUsd).toBeCloseTo(session.costUsd, 10)
    // Session input is the current prompt (last-wins); the journal keeps every billed request.
    expect(session.inputTokens).toBe(1020)
    expect((usage.totals.uncachedInput ?? 0) + (usage.totals.cacheRead ?? 0) + (usage.totals.cacheWrite ?? 0)).toBe(2020)
  })
})
