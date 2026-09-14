import { describe, expect, it } from 'bun:test'
import {
  cancelCalendar,
  createFollowupRuntime,
  disableSchedules,
  FOLLOWUP_SEND_GATE,
  occurrenceKey,
  queueFollowupDraft,
  runFollowup,
  upsertSchedule,
  type FollowupSchedule,
} from '../followup.ts'
import { dispatchOutbox } from '../outbox.ts'
import { isLiveVerified } from '../types.ts'

function schedule(overrides: Partial<FollowupSchedule> = {}): FollowupSchedule {
  return {
    id: 'sched-1',
    ownerId: 'user-1',
    timezone: 'America/New_York',
    occurrenceKey: 'sched-1:placeholder',
    expiresAt: Date.UTC(2026, 10, 1),
    optOut: false,
    budgetRemaining: 3,
    missedRunPolicy: 'skip',
    kind: 'prepare',
    calendarEventId: 'cal-1',
    deviceAvailable: true,
    ...overrides,
  }
}

describe('followup schedules (#374)', () => {
  it('does not duplicate DST/replay of the same local calendar day', () => {
    const runtime = createFollowupRuntime(() => Date.UTC(2026, 2, 8, 6, 30))
    upsertSchedule(runtime, schedule())
    const first = runFollowup(runtime, 'sched-1', 'prepare')
    const second = runFollowup(runtime, 'sched-1', 'prepare')
    expect(first.status).toBe('verified')
    expect(second.status).toBe('duplicate')
    const before = occurrenceKey('sched-1', Date.UTC(2026, 2, 8, 6, 0), 'America/New_York')
    const after = occurrenceKey('sched-1', Date.UTC(2026, 2, 8, 7, 0), 'America/New_York')
    expect(before).toBe(after)
  })

  it('calendar cancel disables upcoming prepare without erasing ledger', () => {
    const runtime = createFollowupRuntime(() => Date.UTC(2026, 5, 1))
    upsertSchedule(runtime, schedule())
    const first = runFollowup(runtime, 'sched-1', 'prepare')
    expect(first.status).toBe('verified')
    cancelCalendar(runtime, 'cal-1')
    const next = runFollowup(runtime, 'sched-1', 'prepare')
    expect(next.reason).toBe('calendar-canceled')
    expect(runtime.persisted.ledger.some((row) => row.status === 'ran')).toBe(true)
  })

  it('marks closed-app device jobs as waiting_device', () => {
    const runtime = createFollowupRuntime()
    upsertSchedule(runtime, schedule({ deviceAvailable: false }))
    const result = runFollowup(runtime, 'sched-1', 'prepare')
    expect(result.reason).toBe('waiting_device')
  })

  it('reports already-completed promises honestly and denies expired grants', () => {
    const runtime = createFollowupRuntime()
    upsertSchedule(runtime, schedule({ alreadyCompleted: true }))
    expect(runFollowup(runtime, 'sched-1', 'promise-check').reason).toBe('already-completed')
    upsertSchedule(runtime, schedule({ id: 'sched-2', grantExpired: true }))
    expect(runFollowup(runtime, 'sched-2', 'prepare').reason).toBe('expired-grant')
  })

  it('refuses simulator executor and send without a fresh grant check', () => {
    const runtime = createFollowupRuntime()
    const simulator = { ...runtime, executor: 'simulator' as const }
    upsertSchedule(runtime, schedule())
    expect(runFollowup(simulator, 'sched-1', 'prepare').reason).toBe('simulator-not-production')
    expect(runFollowup(runtime, 'sched-1', 'send').reason).toBe('send-requires-fresh-grant')
  })

  it('rollback disables schedules while keeping the ledger', () => {
    const runtime = createFollowupRuntime()
    upsertSchedule(runtime, schedule())
    runFollowup(runtime, 'sched-1', 'prepare')
    disableSchedules(runtime)
    expect(runtime.persisted.schedules.get('sched-1')?.optOut).toBe(true)
    expect(runtime.persisted.ledger).toHaveLength(1)
  })

  it('persists a send on the outbox and fail-closes without a live L4 send', () => {
    const runtime = createFollowupRuntime(() => Date.UTC(2026, 5, 1))
    upsertSchedule(runtime, schedule({ freshSendGrant: true }))
    const result = runFollowup(runtime, 'sched-1', 'send')
    expect(FOLLOWUP_SEND_GATE.evidenceLevel).toBe('U1')
    expect(FOLLOWUP_SEND_GATE.l4).toBe('not_run')
    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('followup-send-not-live')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).toBe('U1')
    expect(isLiveVerified(result)).toBe(false)
    expect(runtime.persisted.outbox).toHaveLength(1)
    expect(runtime.persisted.outbox[0]?.kind).toBe('send')
    expect(runtime.persisted.outbox[0]?.status).toBe('blocked')
  })

  it('does not auto-resend an unknown outbox entry', () => {
    const runtime = createFollowupRuntime(() => Date.UTC(2026, 5, 1))
    upsertSchedule(runtime, schedule({ freshSendGrant: true, occurrenceKey: 'sched-1:2026-06-01' }))
    runtime.persisted.outbox.push({
      operationId: 'op-unknown',
      idempotencyKey: 'sched-1:send:sched-1:2026-06-01',
      payloadHash: 'sched-1:2026-06-01',
      kind: 'send',
      status: 'unknown',
    })
    const result = runFollowup(runtime, 'sched-1', 'send')
    expect(result.status).toBe('unknown')
    expect(result.reason).toBe('no-automatic-resend')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).toBe('U1')
    expect(runtime.persisted.outbox).toHaveLength(1)
    expect(runtime.persisted.outbox[0]?.status).toBe('unknown')
  })

  it('keeps draft distinct from send and never dispatches production mail', () => {
    const runtime = createFollowupRuntime(() => Date.UTC(2026, 5, 1))
    upsertSchedule(runtime, schedule())
    const drafted = queueFollowupDraft(runtime, 'sched-1', {
      operationId: 'draft-1',
      idempotencyKey: 'draft-1',
      payloadHash: 'body-1',
    })
    expect(drafted.status).toBe('pending')
    expect(drafted.reason).toBe('draft-not-send')
    expect(drafted.live).toBe(false)
    expect(dispatchOutbox(runtime.persisted.outbox[0]!).reason).toBe('draft-not-send')
    expect(runtime.persisted.outbox[0]?.kind).toBe('draft')
  })
})
