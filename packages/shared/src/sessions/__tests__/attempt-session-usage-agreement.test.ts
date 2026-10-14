import { describe, expect, it } from 'bun:test'
import { projectTokenUsage } from '@rox/core/runtime-trace/projector'
import type { RuntimeEvent } from '@rox/core/runtime-trace/types'
import { accumulateAttemptSessionUsage, type AttemptSessionUsageState } from '../session-tokens'

/**
 * DSH-P1 journal agreement: projection totals over `llm.attempt.completed`
 * events agree with SessionTokenUsage accumulated from the same provider
 * numbers through the helper SessionManager's complete branch uses.
 */
interface AttemptNumbers {
  uncachedInput?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  costUsd?: number
  contextWindow?: number
}

const journalEvents = (attempts: AttemptNumbers[]): RuntimeEvent[] =>
  attempts.map((numbers, index) => ({
    schemaVersion: 1,
    eventId: `agree:${index}`,
    sourceEventId: `agree:${index}`,
    sourceId: 'agree',
    sourceSeq: index + 1,
    workspaceId: 'agree-workspace',
    rootSessionId: 'agree-session',
    runId: 'agree-run',
    rootRunId: 'agree-run',
    agentId: 'agree-agent',
    seq: index + 1,
    occurredAt: { state: 'known', value: 1000 + index, source: 'agree', origin: 'observed' },
    receivedAt: 1000 + index,
    clockDomain: 'agree',
    origin: 'observed',
    kind: 'llm.attempt.completed',
    payload: {
      turnId: 'agree-turn',
      step: index + 1,
      usage: {
        ...(numbers.uncachedInput !== undefined ? { uncachedInput: numbers.uncachedInput } : {}),
        ...(numbers.output !== undefined ? { output: numbers.output } : {}),
        ...(numbers.cacheRead !== undefined ? { cacheRead: numbers.cacheRead } : {}),
        ...(numbers.cacheWrite !== undefined ? { cacheWrite: numbers.cacheWrite } : {}),
      },
      ...(numbers.costUsd !== undefined ? { costUsd: numbers.costUsd } : {}),
      ...(numbers.contextWindow !== undefined ? { contextWindow: numbers.contextWindow } : {}),
      ...(index === 2 ? { retryOf: 'agree:1' } : {}),
    },
  }) as unknown as RuntimeEvent)

const zeroUsage = (): AttemptSessionUsageState => ({
  inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0,
})

describe('journal/projection agreement with SessionTokenUsage', () => {
  it('output and cost totals agree; input is the last prompt', () => {
    const attempts: AttemptNumbers[] = [
      { uncachedInput: 100, output: 20, cacheRead: 800, cacheWrite: 10, costUsd: 0.01, contextWindow: 200_000 },
      { uncachedInput: 120, output: 8, cacheRead: 820, cacheWrite: 12, costUsd: 0.004 },
      { uncachedInput: 120, output: 8, cacheRead: 820, cacheWrite: 12, costUsd: 0.004 }, // retry of attempt 2
    ]
    const events = journalEvents(attempts)
    const projection = projectTokenUsage(events)

    const usage = events.reduce((state, event) => {
      if (event.kind !== 'llm.attempt.completed') return state
      const payload = event.payload
      const prompt = (payload.usage.uncachedInput ?? 0) + (payload.usage.cacheRead ?? 0) + (payload.usage.cacheWrite ?? 0)
      return accumulateAttemptSessionUsage(state, {
        inputTokens: prompt,
        outputTokens: payload.usage.output ?? 0,
        cacheReadTokens: payload.usage.cacheRead,
        cacheCreationTokens: payload.usage.cacheWrite,
        costUsd: payload.costUsd,
        contextWindow: payload.contextWindow,
      })
    }, zeroUsage())

    expect(projection.totals.attempts).toBe(3)
    expect(projection.totals.retries).toBe(1)
    expect(projection.totals.output).toBe(usage.outputTokens)
    expect(projection.totals.costUsd).toBe(usage.costUsd)
    expect(usage.outputTokens).toBe(36)
    expect(usage.costUsd).toBeCloseTo(0.018, 10)
    // inputTokens is last-wins (the current prompt), not a sum.
    expect(usage.inputTokens).toBe(120 + 820 + 12)
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens)
    expect(usage.contextWindow).toBe(200_000)
  })

  it('unknown cost is omitted on both sides, never zero-filled into the projection', () => {
    const events = journalEvents([{ uncachedInput: 50, output: 5 }])
    const projection = projectTokenUsage(events)
    const usage = accumulateAttemptSessionUsage(zeroUsage(), { inputTokens: 50, outputTokens: 5 })
    expect(projection.totals.costUsd).toBeUndefined()
    expect(usage.costUsd).toBe(0)
    expect(projection.totals.output).toBe(usage.outputTokens)
  })

  it('accumulateAttemptSessionUsage mirrors the complete branch: last-wins input/cache, accumulating output/cost', () => {
    const first = accumulateAttemptSessionUsage(zeroUsage(), {
      inputTokens: 1000, outputTokens: 50, cacheReadTokens: 900, cacheCreationTokens: 10, costUsd: 0.02, contextWindow: 200_000,
    })
    expect(first).toMatchObject({ inputTokens: 1000, outputTokens: 50, totalTokens: 1050, costUsd: 0.02, cacheReadTokens: 900, contextWindow: 200_000 })
    const second = accumulateAttemptSessionUsage(first, { inputTokens: 1100, outputTokens: 30 })
    expect(second).toMatchObject({ inputTokens: 1100, outputTokens: 80, totalTokens: 1180, costUsd: 0.02, cacheReadTokens: 0, contextWindow: 200_000 })
  })
})
