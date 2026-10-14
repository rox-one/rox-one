/**
 * Journal-vs-session agreement (DSH P1): the runtime-trace usage projection
 * and SessionTokenUsage accumulation agree on the same provider-reported
 * numbers. Output and cost accumulate identically; session input is the
 * current prompt (last-wins) while the journal keeps every billed request.
 */
import { describe, expect, test } from 'bun:test'
import { projectTokenUsage } from '@rox/core/runtime-trace/projector'
import type { RuntimeEvent } from '@rox/core/runtime-trace/types'
import {
  accumulateAttemptSessionUsage,
  type AttemptSessionUsageState,
} from './session-tokens'

function journalAttempt(
  seq: number,
  turnId: string,
  step: number,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {},
): RuntimeEvent {
  const { costUsd, contextWindow, ...rest } = usage
  return {
    schemaVersion: 1,
    eventId: `agree:${seq}`,
    sourceEventId: `agree:${seq}`,
    sourceId: 'agreement-test',
    sourceSeq: seq,
    workspaceId: 'agree-workspace',
    rootSessionId: 'agree-session',
    sessionId: 'agree-session',
    rootRunId: 'agree-run',
    runId: 'agree-run',
    agentId: 'agree-agent',
    seq,
    occurredAt: { state: 'known', value: 1000 + seq, origin: 'observed', source: 'agreement-test' },
    receivedAt: 1000 + seq,
    clockDomain: 'agreement-test',
    origin: 'observed',
    kind: 'llm.attempt.completed',
    payload: {
      turnId, step, usage: rest,
      ...(typeof costUsd === 'number' ? { costUsd } : {}),
      ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
      ...extra,
    },
  } as RuntimeEvent
}

const zeroSession = (): AttemptSessionUsageState => ({
  inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0,
})

describe('usage journal agrees with SessionTokenUsage accumulation', () => {
  test('same provider numbers: prompt/output/cost agree', () => {
    // As emitted by SessionManager: prompt 1000 incl. cache maps to uncached 790.
    const journal = [journalAttempt(1, 'a', 1, { uncachedInput: 790, output: 50, cacheRead: 200, cacheWrite: 10, costUsd: 0.002 })]
    const usage = projectTokenUsage(journal)
    const session = accumulateAttemptSessionUsage(zeroSession(), {
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
      journalAttempt(1, 'a', 1, { uncachedInput: 790, output: 50, cacheRead: 200, cacheWrite: 10, costUsd: 0.002 }),
      journalAttempt(2, 'a', 2, { uncachedInput: 800, output: 60, cacheRead: 210, cacheWrite: 10, costUsd: 0.003 }, { retryOf: 'agree:1' }),
    ]
    const usage = projectTokenUsage(journal)
    expect(usage.totals.retries).toBe(1)
    let session = zeroSession()
    for (const [prompt, out, cost] of [[1000, 50, 0.002], [1020, 60, 0.003]] as const) {
      session = accumulateAttemptSessionUsage(session, {
        inputTokens: prompt, outputTokens: out, cacheReadTokens: 200, cacheCreationTokens: 10, costUsd: cost,
      })
    }
    expect(usage.totals.output).toBe(session.outputTokens)
    expect(usage.totals.costUsd).toBeCloseTo(session.costUsd, 10)
    // Session input is the current prompt (last-wins); the journal keeps every billed request.
    expect(session.inputTokens).toBe(1020)
    expect((usage.totals.uncachedInput ?? 0) + (usage.totals.cacheRead ?? 0) + (usage.totals.cacheWrite ?? 0)).toBe(2020)
  })
})
