/**
 * RMA-I018 / #374 — meeting follow-up schedules.
 * Calendar cancel disables upcoming work; it does not erase history.
 * Fixture/simulator executors are not the production path.
 * Send goes through a persisted outbox and fail-closes: no production mail.
 * In-memory followup identity is not a live receipt: stamps stay pending
 * (live:false, not verified; L4 remains not_run).
 * Optional persistDir load/saves a JSON snapshot of schedules+ledger
 * (mkdir/writeFile); that file is not a live receipt.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dispatchOutbox, reserveOutbox, type OutboxEntry } from './outbox.ts'
import { denied, unsupported, type EvidenceLevel, type MeetingOpResult } from './types.ts'

/** Local in-memory followup identity only. Never a live/L4 verified receipt. */
function localApplied<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'C2',
): MeetingOpResult<T> {
  return { status: 'pending', reason, live: false, evidenceLevel }
}

export const FOLLOWUP_SEND_GATE = {
  evidenceLevel: 'U1',
  live: false,
  l4: 'not_run',
} as const

export type FollowupKind = 'prepare' | 'finalize' | 'promise-check' | 'send'

export type MissedRunPolicy = 'skip' | 'catch-up-once' | 'hold'

export type FollowupSchedule = {
  readonly id: string
  readonly ownerId: string
  readonly timezone: string
  readonly occurrenceKey: string
  readonly expiresAt: number
  readonly optOut: boolean
  readonly budgetRemaining: number
  readonly missedRunPolicy: MissedRunPolicy
  readonly kind: FollowupKind
  readonly calendarEventId: string
  readonly calendarCanceled?: boolean
  readonly deviceAvailable?: boolean
  readonly grantExpired?: boolean
  readonly alreadyCompleted?: boolean
  readonly freshSendGrant?: boolean
}

export type FollowupLedgerEntry = {
  readonly scheduleId: string
  readonly occurrenceKey: string
  readonly status: 'ran' | 'skipped' | 'waiting_device' | 'disabled' | 'unknown'
  readonly at: number
}

export type FollowupExecutor = 'production' | 'simulator'

export type FollowupSnapshot = {
  schedules: FollowupSchedule[]
  ledger: FollowupLedgerEntry[]
  occurrenceKeys: string[]
}

export type FollowupRuntime = {
  readonly now: () => number
  readonly executor: FollowupExecutor
  readonly persistDir?: string
  readonly persisted: {
    schedules: Map<string, FollowupSchedule>
    ledger: FollowupLedgerEntry[]
    occurrenceKeys: Set<string>
    outbox: OutboxEntry[]
  }
}

const FILE = 'followup-ledger.json'

export function createFollowupRuntime(now = () => Date.now(), persistDir?: string): FollowupRuntime {
  return {
    now,
    executor: 'production',
    persistDir,
    persisted: {
      schedules: new Map(),
      ledger: [],
      occurrenceKeys: new Set(),
      outbox: [],
    },
  }
}

export function snapshotFollowup(runtime: FollowupRuntime): FollowupSnapshot {
  return {
    schedules: [...runtime.persisted.schedules.values()].map((item) => ({ ...item })),
    ledger: runtime.persisted.ledger.map((entry) => ({ ...entry })),
    occurrenceKeys: [...runtime.persisted.occurrenceKeys],
  }
}

export function restoreFollowupFrom(runtime: FollowupRuntime, snapshot: FollowupSnapshot): void {
  runtime.persisted.schedules.clear()
  for (const schedule of snapshot.schedules) runtime.persisted.schedules.set(schedule.id, { ...schedule })
  runtime.persisted.ledger.length = 0
  for (const entry of snapshot.ledger) runtime.persisted.ledger.push({ ...entry })
  runtime.persisted.occurrenceKeys.clear()
  for (const key of snapshot.occurrenceKeys) runtime.persisted.occurrenceKeys.add(key)
}

export async function restoreFollowup(runtime: FollowupRuntime): Promise<void> {
  if (!runtime.persistDir) return
  try {
    const parsed = JSON.parse(await readFile(join(runtime.persistDir, FILE), 'utf8')) as FollowupSnapshot
    if (!parsed || !Array.isArray(parsed.schedules)) return
    restoreFollowupFrom(runtime, {
      schedules: parsed.schedules,
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
      occurrenceKeys: Array.isArray(parsed.occurrenceKeys) ? parsed.occurrenceKeys : [],
    })
  } catch {
    /* missing ledger is a fresh store */
  }
}

export async function persistFollowup(runtime: FollowupRuntime): Promise<void> {
  if (!runtime.persistDir) return
  await mkdir(runtime.persistDir, { recursive: true })
  await writeFile(join(runtime.persistDir, FILE), `${JSON.stringify(snapshotFollowup(runtime), null, 2)}\n`, 'utf8')
}

export async function loadFollowupRuntime(now = () => Date.now(), persistDir?: string): Promise<FollowupRuntime> {
  const runtime = createFollowupRuntime(now, persistDir)
  await restoreFollowup(runtime)
  return runtime
}

export function occurrenceKey(scheduleId: string, instant: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return `${scheduleId}:${year}-${month}-${day}`
}

export function upsertSchedule(runtime: FollowupRuntime, schedule: FollowupSchedule): void {
  runtime.persisted.schedules.set(schedule.id, schedule)
}

export function cancelCalendar(runtime: FollowupRuntime, calendarEventId: string): void {
  for (const schedule of runtime.persisted.schedules.values()) {
    if (schedule.calendarEventId === calendarEventId) {
      runtime.persisted.schedules.set(schedule.id, { ...schedule, calendarCanceled: true })
    }
  }
}

export function runFollowup(
  runtime: FollowupRuntime,
  scheduleId: string,
  kind: FollowupKind,
): MeetingOpResult {
  if (runtime.executor === 'simulator') {
    return unsupported('simulator-not-production')
  }
  const schedule = runtime.persisted.schedules.get(scheduleId)
  if (!schedule) return denied('schedule-missing')
  if (schedule.optOut) return { status: 'pending', reason: 'opt-out', live: false, evidenceLevel: 'U1' }
  if (schedule.grantExpired) return denied('expired-grant')
  if (schedule.alreadyCompleted && kind === 'promise-check') {
    return localApplied('already-completed', 'U1')
  }
  if (schedule.calendarCanceled && (kind === 'prepare' || kind === 'finalize')) {
    runtime.persisted.ledger.push({
      scheduleId,
      occurrenceKey: schedule.occurrenceKey,
      status: 'disabled',
      at: runtime.now(),
    })
    return { status: 'pending', reason: 'calendar-canceled', live: false, evidenceLevel: 'U1' }
  }
  if (schedule.expiresAt <= runtime.now()) return denied('expired')
  if (schedule.budgetRemaining <= 0) return denied('budget-exhausted')
  if (schedule.deviceAvailable === false) {
    runtime.persisted.ledger.push({
      scheduleId,
      occurrenceKey: schedule.occurrenceKey,
      status: 'waiting_device',
      at: runtime.now(),
    })
    return { status: 'pending', reason: 'waiting_device', live: false, evidenceLevel: 'U1' }
  }
  if (kind === 'send') {
    if (!schedule.freshSendGrant) {
      return unsupported('send-requires-fresh-grant')
    }
    return enqueueFollowupOutbox(runtime, {
      operationId: `${scheduleId}:${schedule.occurrenceKey}:send`,
      idempotencyKey: `${scheduleId}:send:${schedule.occurrenceKey}`,
      payloadHash: schedule.occurrenceKey,
      kind: 'send',
      status: 'queued',
    })
  }
  const key = occurrenceKey(schedule.id, runtime.now(), schedule.timezone)
  if (runtime.persisted.occurrenceKeys.has(key)) {
    return { status: 'duplicate', reason: 'already-ran-occurrence', live: false, evidenceLevel: 'U1' }
  }
  runtime.persisted.occurrenceKeys.add(key)
  runtime.persisted.ledger.push({
    scheduleId,
    occurrenceKey: key,
    status: 'ran',
    at: runtime.now(),
  })
  return localApplied('ran')
}

export function disableSchedules(runtime: FollowupRuntime): void {
  for (const schedule of runtime.persisted.schedules.values()) {
    runtime.persisted.schedules.set(schedule.id, { ...schedule, optOut: true })
  }
}

export function queueFollowupDraft(
  runtime: FollowupRuntime,
  scheduleId: string,
  operation: { operationId: string; idempotencyKey: string; payloadHash: string },
): MeetingOpResult {
  const schedule = runtime.persisted.schedules.get(scheduleId)
  if (!schedule) return denied('schedule-missing')
  return enqueueFollowupOutbox(runtime, { ...operation, kind: 'draft', status: 'queued' })
}

function enqueueFollowupOutbox(runtime: FollowupRuntime, next: OutboxEntry): MeetingOpResult {
  const { reserved, entry } = reserveOutbox(runtime.persisted.outbox, next)
  if (reserved) runtime.persisted.outbox.push(entry)
  return dispatchOutbox(entry)
}
