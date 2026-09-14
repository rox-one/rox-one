import { describe, expect, test } from 'bun:test'
import {
  MeetingBackpressureQueue,
  MeetingBudgetLedger,
  conversationMetrics,
  createMeetingTrace,
  finishMeetingTrace,
  traceOmitsSecrets,
} from '../observability.ts'

describe('meeting budgets (issue 386 / I030)', () => {
  test('parallel reserve does not exceed the cap', () => {
    const ledger = new MeetingBudgetLedger(10)
    const first = ledger.reserve('op-1', 6)
    const second = ledger.reserve('op-2', 6)
    const third = ledger.reserve('op-3', 4)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('cap-exceeded')
    expect(third.ok).toBe(true)
    expect(ledger.remaining()).toBe(0)
  })

  test('unknown does not silently return budget', () => {
    const ledger = new MeetingBudgetLedger(20)
    expect(ledger.reserve('op-1', 8).ok).toBe(true)
    expect(ledger.markUnknown('op-1').status).toBe('unknown')
    expect(ledger.remaining()).toBe(12)
    expect(() => ledger.settle('op-1', 0)).toThrow('unknown-budget-must-reconcile')
    expect(ledger.remaining()).toBe(12)
    const reconciled = ledger.reconcile('op-1', 3)
    expect(reconciled.status).toBe('settled')
    expect(reconciled.settled).toBe(3)
    expect(ledger.remaining()).toBe(17)
  })

  test('settle after receipt frees unused tokens', () => {
    const ledger = new MeetingBudgetLedger(40)
    expect(ledger.reserve('op-a', 10).ok).toBe(true)
    expect(ledger.settle('op-a', 4).settled).toBe(4)
    expect(ledger.remaining()).toBe(36)
  })

  test('429, cancel, offline backlog, and a 60-minute memory bound', () => {
    const queue = new MeetingBackpressureQueue({
      maxConcurrent: 2,
      maxQueue: 4,
      maxBytes: 64,
    }, () => 1_000)
    expect(queue.enqueue({ id: 'a', meetingId: 'm', workspaceId: 'ws', tokens: 1, bytes: 10 }).ok).toBe(true)
    expect(queue.enqueue({ id: 'b', meetingId: 'm', workspaceId: 'ws', tokens: 1, bytes: 10 }).ok).toBe(true)
    expect(queue.enqueue({ id: 'c', meetingId: 'm', workspaceId: 'ws', tokens: 1, bytes: 10 }).ok).toBe(true)
    expect(queue.snapshot().running).toBe(2)
    expect(queue.snapshot().queued).toBe(1)
    queue.note429(5_000)
    expect(queue.enqueue({ id: 'd', meetingId: 'm', workspaceId: 'ws', tokens: 1, bytes: 1 }).ok).toBe(false)
    queue.cancel('c')
    expect(queue.snapshot().queued).toBe(0)
    queue.noteOffline()
    const hour = new MeetingBackpressureQueue({
      maxConcurrent: 2,
      maxQueue: 8,
      maxBytes: 50,
    })
    for (let i = 0; i < 20; i += 1) {
      hour.enqueue({ id: `seg-${i}`, meetingId: 'm', workspaceId: 'ws', tokens: 1, bytes: 10 })
    }
    expect(hour.snapshot().bytes).toBeLessThanOrEqual(50)
    expect(hour.enqueue({ id: 'overflow', meetingId: 'm', workspaceId: 'ws', tokens: 1, bytes: 10 }).ok).toBe(false)
  })

  test('traces record stage/mode/lifecycle without secrets', () => {
    const started = createMeetingTrace({
      correlationId: 'corr-1',
      meetingId: 'm1',
      operationId: 'op-1',
      stage: 'execute',
      mode: 'production',
      lifecycle: 'running',
      verification: 'pending',
      modelRoute: 'rox/fast',
      policy: 'Bearer sk-secret-token',
    })
    const done = finishMeetingTrace(started, { lifecycle: 'succeeded', verification: 'verified', tokenUsage: 12 })
    expect(done.stage).toBe('execute')
    expect(done.lifecycle).toBe('succeeded')
    expect(done.verification).toBe('verified')
    expect(done.latencyMs).toBeGreaterThanOrEqual(0)
    expect(done.policy).toContain('[redacted]')
    expect(traceOmitsSecrets(done)).toBe(true)
    const metrics = conversationMetrics({
      truePositive: 3,
      falsePositive: 1,
      falseNegative: 1,
      abstain: 1,
      resolvedOwner: 2,
      resolvedOwnerCorrect: 2,
      resolvedDate: 2,
      resolvedDateCorrect: 2,
      citationsValid: 3,
      citationsTotal: 3,
      latenciesMs: [10, 20, 30, 40, 200],
    })
    expect(metrics.taskPrecision).toBe(0.75)
    expect(metrics.taskRecall).toBe(0.75)
    expect(metrics.p95Ms).toBe(200)
    expect(metrics.coverage).toBe(6)
  })
})
