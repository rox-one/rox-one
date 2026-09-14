/**
 * Meeting follow-up schedules (issue #374 / I018).
 * Calendar cancel disables upcoming prep/capture; it does not erase the ledger.
 * Device jobs wait when the UI is closed. Server jobs continue.
 * The workflow simulator is not the production executor.
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeRox2V2Result, isVerifiedEffect, type Rox2V2Result } from '@craft-agent/core/rox2'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  compileMeetingFollowupMatcher,
  cronMatchesAt,
  meetingFollowupOccurrenceKey,
  type MeetingFollowupAction,
  type MeetingFollowupExecutor,
  type MeetingFollowupExecutorContext,
  type MeetingFollowupExecutorResult,
  type MeetingFollowupKind,
  type AutomationMatcher,
} from '@craft-agent/shared/automations'
import type { NativeNotePort, NativeTaskPort } from './native-actions.ts'

export type FollowupKind = MeetingFollowupKind
export type FollowupScope = 'device' | 'server'
export type MissedRunPolicy = 'skip' | 'catch-up-once' | 'hold'
export type FollowupExecutorMode = 'production' | 'simulator' | 'fixture'

export type FollowupSchedule = {
  id: string
  ownerId: string
  workspaceId: string
  timezone: string
  cron?: string
  occurrenceKey?: string
  expiresAt: number
  optOut: boolean
  budgetRemaining: number
  missedRunPolicy: MissedRunPolicy
  maxRetries: number
  kind: FollowupKind
  calendarEventId: string
  calendarCanceled?: boolean
  scope: FollowupScope
  meetingId?: string
  taskId?: string
  payloadHash?: string
}

export type FollowupLedgerStatus =
  | 'ran'
  | 'skipped'
  | 'waiting_device'
  | 'disabled'
  | 'unknown'
  | 'fulfilled'
  | 'denied'
  | 'duplicate'
  | 'opt-out'

export type FollowupLedgerEntry = {
  scheduleId: string
  occurrenceKey: string
  status: FollowupLedgerStatus
  at: number
  retryCount: number
  reason: string
  result: Rox2V2Result
}

export type FollowupSnapshot = {
  schedules: FollowupSchedule[]
  ledger: FollowupLedgerEntry[]
  occurrenceKeys: string[]
  grants: MeetingGrant[]
}

export type MeetingFollowupServiceOptions = {
  workspaceId: string
  actorId: string
  deviceId: string
  grants: readonly MeetingGrant[]
  now?: () => number
  executor?: FollowupExecutorMode
  deviceAvailable?: boolean
  tasks?: NativeTaskPort
  notes?: NativeNotePort
  persistDir?: string
}

const FILE = 'followup-ledger.json'
const MAX_RETRIES_DEFAULT = 3

function capabilityFor(kind: FollowupKind): MeetingGrant['capabilities'][number] {
  if (kind === 'capture') return 'capture.microphone'
  if (kind === 'send') return 'action.external'
  return 'archive.durable'
}

function sourceFor(kind: FollowupKind): 'archive' | 'external' | 'microphone' {
  if (kind === 'capture') return 'microphone'
  if (kind === 'send') return 'external'
  return 'archive'
}

function deniedResult(code: string, message: string): Rox2V2Result {
  return decodeRox2V2Result({ ok: false, state: 'queued', code, message })
}

function queuedResult(code: string, message: string): Rox2V2Result {
  return decodeRox2V2Result({ ok: false, state: 'queued', code, message })
}

function fixtureDenied(code: string): Rox2V2Result {
  return decodeRox2V2Result({ ok: false, state: 'fixture', code, message: code })
}

function simulatedDenied(code: string): Rox2V2Result {
  return decodeRox2V2Result({ ok: false, state: 'simulated', code, message: code })
}

export function occurrenceKey(scheduleId: string, instant: number, timezone: string): string {
  return meetingFollowupOccurrenceKey(scheduleId, instant, timezone)
}

export class MeetingFollowupService {
  private schedules = new Map<string, FollowupSchedule>()
  private ledger: FollowupLedgerEntry[] = []
  private occurrenceKeys = new Set<string>()
  private enabled = true
  private deviceAvailable: boolean

  private grants: MeetingGrant[]

  constructor(private readonly options: MeetingFollowupServiceOptions) {
    this.deviceAvailable = options.deviceAvailable !== false
    this.grants = [...options.grants]
  }

  static async load(options: MeetingFollowupServiceOptions): Promise<MeetingFollowupService> {
    const service = new MeetingFollowupService(options)
    await service.restore()
    return service
  }

  now(): number {
    return this.options.now?.() ?? Date.now()
  }

  listSchedules(): FollowupSchedule[] {
    return [...this.schedules.values()].map((item) => ({ ...item }))
  }

  listLedger(): FollowupLedgerEntry[] {
    return this.ledger.map((entry) => ({ ...entry, result: { ...entry.result } }))
  }

  matchers(): AutomationMatcher[] {
    if (!this.enabled) return []
    return [...this.schedules.values()]
      .filter((schedule) => !schedule.optOut && !schedule.calendarCanceled)
      .map((schedule) => compileMeetingFollowupMatcher(schedule))
  }

  snapshot(): FollowupSnapshot {
    return {
      schedules: this.listSchedules(),
      ledger: this.listLedger(),
      occurrenceKeys: [...this.occurrenceKeys],
      grants: this.grants.map((grant) => ({ ...grant, capabilities: [...grant.capabilities] })),
    }
  }

  restoreFrom(snapshot: FollowupSnapshot): void {
    this.schedules.clear()
    for (const schedule of snapshot.schedules) this.schedules.set(schedule.id, { ...schedule })
    this.ledger = snapshot.ledger.map((entry) => ({ ...entry, result: { ...entry.result } }))
    this.occurrenceKeys = new Set(snapshot.occurrenceKeys)
    if (snapshot.grants?.length && this.grants.length === 0) {
      this.grants = snapshot.grants.map((grant) => ({ ...grant, capabilities: [...grant.capabilities] }))
    }
  }

  async restore(): Promise<void> {
    if (!this.options.persistDir) return
    try {
      const parsed = JSON.parse(await readFile(join(this.options.persistDir, FILE), 'utf8')) as FollowupSnapshot
      if (!parsed || !Array.isArray(parsed.schedules)) return
      this.restoreFrom({
        schedules: parsed.schedules,
        ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
        occurrenceKeys: Array.isArray(parsed.occurrenceKeys) ? parsed.occurrenceKeys : [],
        grants: Array.isArray(parsed.grants) ? parsed.grants : [],
      })
    } catch {
      /* missing ledger is a fresh store */
    }
  }

  async persist(): Promise<void> {
    if (!this.options.persistDir) return
    await mkdir(this.options.persistDir, { recursive: true })
    await writeFile(join(this.options.persistDir, FILE), `${JSON.stringify(this.snapshot(), null, 2)}\n`, 'utf8')
  }

  upsertSchedule(schedule: FollowupSchedule): FollowupSchedule {
    const next = {
      ...schedule,
      maxRetries: schedule.maxRetries ?? MAX_RETRIES_DEFAULT,
      payloadHash: schedule.payloadHash || `followup:${schedule.id}`,
    }
    this.schedules.set(next.id, next)
    return next
  }

  cancelCalendar(calendarEventId: string): void {
    for (const schedule of this.schedules.values()) {
      if (schedule.calendarEventId === calendarEventId) {
        this.schedules.set(schedule.id, { ...schedule, calendarCanceled: true })
      }
    }
  }

  disableSchedules(): void {
    this.enabled = false
    for (const schedule of this.schedules.values()) {
      this.schedules.set(schedule.id, { ...schedule, optOut: true })
    }
  }

  setDeviceAvailable(available: boolean): void {
    this.deviceAvailable = available
  }

  async run(scheduleId: string, kind?: FollowupKind, extra?: { missed?: boolean; crashAfterSend?: boolean }): Promise<FollowupLedgerEntry> {
    const entry = await this.runUnlocked(scheduleId, kind, extra)
    await this.persist()
    return entry
  }

  async tick(now = this.now()): Promise<FollowupLedgerEntry[]> {
    const ran: FollowupLedgerEntry[] = []
    for (const schedule of this.schedules.values()) {
      if (schedule.cron && !cronMatchesAt(schedule.cron, now, schedule.timezone)) continue
      ran.push(await this.runUnlocked(schedule.id, schedule.kind, { missed: false }))
    }
    await this.persist()
    return ran
  }

  asAutomationExecutor(): MeetingFollowupExecutor {
    return {
      execute: async (action: MeetingFollowupAction, ctx: MeetingFollowupExecutorContext): Promise<MeetingFollowupExecutorResult> => {
        const previous = this.deviceAvailable
        this.deviceAvailable = !ctx.uiClosed
        try {
          const entry = await this.run(action.scheduleId, action.kind)
          return {
            status: entry.status,
            reason: entry.reason,
            verified: isVerifiedEffect(entry.result),
          }
        } finally {
          this.deviceAvailable = previous
        }
      },
    }
  }

  private async runUnlocked(scheduleId: string, kind?: FollowupKind, extra?: { missed?: boolean; crashAfterSend?: boolean }): Promise<FollowupLedgerEntry> {
    const now = this.now()
    const mode = this.options.executor ?? 'production'
    if (mode === 'simulator') {
      return this.record({
        scheduleId,
        occurrenceKey: `${scheduleId}:simulator`,
        status: 'denied',
        at: now,
        retryCount: 0,
        reason: 'simulator-not-production',
        result: simulatedDenied('simulator-not-production'),
      })
    }
    if (mode === 'fixture') {
      return this.record({
        scheduleId,
        occurrenceKey: `${scheduleId}:fixture`,
        status: 'denied',
        at: now,
        retryCount: 0,
        reason: 'fixture-not-production',
        result: fixtureDenied('fixture-not-production'),
      })
    }
    if (!this.enabled) {
      return this.record({
        scheduleId,
        occurrenceKey: `${scheduleId}:disabled`,
        status: 'disabled',
        at: now,
        retryCount: 0,
        reason: 'schedules-disabled',
        result: queuedResult('schedules-disabled', 'Follow-up schedules are disabled'),
      })
    }
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) {
      return this.record({
        scheduleId,
        occurrenceKey: `${scheduleId}:missing`,
        status: 'denied',
        at: now,
        retryCount: 0,
        reason: 'schedule-missing',
        result: deniedResult('schedule-missing', 'Follow-up schedule is missing'),
      })
    }
    const runKind = kind ?? schedule.kind
    const key = occurrenceKey(schedule.id, now, schedule.timezone)
    if (schedule.optOut) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'opt-out',
        at: now,
        retryCount: 0,
        reason: 'opt-out',
        result: queuedResult('opt-out', 'Owner opted out of this follow-up'),
      })
    }
    if (schedule.calendarCanceled && (runKind === 'prepare' || runKind === 'capture')) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'disabled',
        at: now,
        retryCount: 0,
        reason: 'calendar-canceled',
        result: queuedResult('calendar-canceled', 'Calendar cancellation stopped upcoming prep/capture'),
      })
    }
    if (schedule.expiresAt <= now) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'denied',
        at: now,
        retryCount: 0,
        reason: 'expired',
        result: deniedResult('expired', 'Follow-up schedule has expired'),
      })
    }
    if (schedule.budgetRemaining <= 0) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'denied',
        at: now,
        retryCount: 0,
        reason: 'budget-exhausted',
        result: deniedResult('budget-exhausted', 'Follow-up budget is exhausted'),
      })
    }
    const retries = this.ledger.filter((entry) => entry.scheduleId === schedule.id && entry.occurrenceKey === key).length
    if (retries >= schedule.maxRetries) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'skipped',
        at: now,
        retryCount: retries,
        reason: 'max-retries',
        result: queuedResult('max-retries', 'Maximum follow-up retries reached'),
      })
    }
    if (extra?.missed) {
      if (schedule.missedRunPolicy === 'skip') {
        return this.record({
          scheduleId,
          occurrenceKey: key,
          status: 'skipped',
          at: now,
          retryCount: retries,
          reason: 'missed-skip',
          result: queuedResult('missed-skip', 'Missed run skipped by policy'),
        })
      }
      if (schedule.missedRunPolicy === 'hold') {
        return this.record({
          scheduleId,
          occurrenceKey: key,
          status: 'skipped',
          at: now,
          retryCount: retries,
          reason: 'missed-hold',
          result: queuedResult('missed-hold', 'Missed run is held'),
        }, { consumeOccurrence: false })
      }
    }
    const actorId = schedule.ownerId || this.options.actorId
    const grantDevice = this.grants.find((grant) => grant.actorId === actorId && grant.workspaceId === this.options.workspaceId)?.deviceId
    const authz = authorizeMeetingAction({
      actor: {
        accountId: actorId,
        workspaceId: this.options.workspaceId,
        deviceId: grantDevice ?? this.options.deviceId,
        authenticated: true,
      },
      capability: capabilityFor(runKind),
      operation: `followup:${runKind}`,
      source: sourceFor(runKind),
      payloadHash: schedule.payloadHash ?? `followup:${schedule.id}`,
      now,
      permissionMode: 'ask',
      grants: this.grants,
    })
    if (!authz.ok) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'denied',
        at: now,
        retryCount: retries,
        reason: authz.code === 'grant-expired' || authz.code === 'grant-revoked' ? 'expired-grant' : authz.code,
        result: deniedResult(authz.code, authz.message),
      })
    }
    if (schedule.scope === 'device' && this.deviceAvailable === false) {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'waiting_device',
        at: now,
        retryCount: retries,
        reason: 'waiting_device',
        result: queuedResult('waiting_device', 'Device-scoped job is waiting for the app'),
      }, { consumeOccurrence: false })
    }
    if (runKind === 'send') {
      const lastSend = [...this.ledger].reverse().find((entry) => (
        entry.scheduleId === schedule.id && entry.status === 'unknown'
      ))
      if (lastSend) {
        return this.record({
          scheduleId,
          occurrenceKey: key,
          status: 'unknown',
          at: now,
          retryCount: retries,
          reason: 'unknown-no-resend',
          result: queuedResult('unknown-no-resend', 'Unknown send is not retried automatically'),
        }, { consumeOccurrence: false })
      }
      if (extra?.crashAfterSend) {
        return this.record({
          scheduleId,
          occurrenceKey: key,
          status: 'unknown',
          at: now,
          retryCount: retries,
          reason: 'send-unknown',
          result: decodeRox2V2Result({ ok: true, state: 'live', entityId: schedule.id }),
        })
      }
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'denied',
        at: now,
        retryCount: retries,
        reason: 'send-requires-fresh-grant',
        result: queuedResult('send-requires-fresh-grant', 'Send is a separate approved operation'),
      })
    }
    if (this.occurrenceKeys.has(key) && runKind !== 'promise-check') {
      return this.record({
        scheduleId,
        occurrenceKey: key,
        status: 'duplicate',
        at: now,
        retryCount: retries,
        reason: 'already-ran-occurrence',
        result: queuedResult('already-ran-occurrence', 'This occurrence already ran'),
      }, { consumeOccurrence: false })
    }
    if (runKind === 'promise-check') {
      return this.checkPromise(schedule, key, now, retries)
    }
    const verified = await this.applyEffect(schedule, runKind, key)
    this.spendBudget(schedule.id)
    return this.record({
      scheduleId: schedule.id,
      occurrenceKey: key,
      status: 'ran',
      at: now,
      retryCount: retries,
      reason: 'ran',
      result: verified,
    })
  }

  private async checkPromise(
    schedule: FollowupSchedule,
    key: string,
    now: number,
    retryCount: number,
  ): Promise<FollowupLedgerEntry> {
    if (!schedule.taskId || !this.options.tasks) {
      return this.record({
        scheduleId: schedule.id,
        occurrenceKey: key,
        status: 'denied',
        at: now,
        retryCount,
        reason: 'task-missing',
        result: deniedResult('task-missing', 'Promise check requires a native task'),
      })
    }
    const task = await this.options.tasks.get(schedule.taskId)
    if (!task) {
      return this.record({
        scheduleId: schedule.id,
        occurrenceKey: key,
        status: 'denied',
        at: now,
        retryCount,
        reason: 'task-missing',
        result: deniedResult('task-missing', 'Native task was not found'),
      })
    }
    if (task.completedAt != null || task.cancelledAt != null) {
      return this.record({
        scheduleId: schedule.id,
        occurrenceKey: key,
        status: 'fulfilled',
        at: now,
        retryCount,
        reason: 'already-completed',
        result: queuedResult('already-completed', 'Promise is already completed; no new reminder'),
      })
    }
    const overdue = task.dueAt != null && task.dueAt < now
    return this.record({
      scheduleId: schedule.id,
      occurrenceKey: key,
      status: 'ran',
      at: now,
      retryCount,
      reason: overdue ? 'overdue' : 'open',
      result: queuedResult(overdue ? 'overdue' : 'open', overdue ? 'Task is overdue' : 'Task is still open'),
    })
  }

  private async applyEffect(schedule: FollowupSchedule, kind: FollowupKind, key: string): Promise<Rox2V2Result> {
    if (!this.options.notes) {
      return {
        ok: true,
        mode: 'live',
        lifecycle: 'applied',
        verification: 'unknown',
        entityId: `${schedule.id}:${key}`,
        code: 'no-readback',
      }
    }
    const noteId = `followup-${schedule.id}-${key}`
    await this.options.notes.create({
      workspaceId: this.options.workspaceId,
      id: noteId,
      title: `${kind} ${schedule.id}`,
      body: `${kind} ${key}`,
    })
    const readback = await this.options.notes.get(noteId)
    if (!readback || readback.body !== `${kind} ${key}`) {
      return {
        ok: true,
        mode: 'live',
        lifecycle: 'applied',
        verification: 'unknown',
        entityId: noteId,
        code: 'readback-mismatch',
      }
    }
    const result: Rox2V2Result = {
      ok: true,
      mode: 'live',
      lifecycle: 'applied',
      verification: 'verified',
      entityId: noteId,
    }
    if (!isVerifiedEffect(result)) {
      throw new Error('Verified follow-up result contract broken')
    }
    return result
  }

  private spendBudget(scheduleId: string): void {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return
    this.schedules.set(scheduleId, { ...schedule, budgetRemaining: Math.max(0, schedule.budgetRemaining - 1) })
  }

  private record(entry: FollowupLedgerEntry, opts?: { consumeOccurrence?: boolean }): FollowupLedgerEntry {
    if (opts?.consumeOccurrence !== false) this.occurrenceKeys.add(entry.occurrenceKey)
    this.ledger.push(entry)
    return { ...entry, result: { ...entry.result } }
  }
}

export function createMeetingFollowupExecutor(
  service: MeetingFollowupService,
): MeetingFollowupExecutor {
  return service.asAutomationExecutor()
}

export function loadMeetingFollowupMatchers(persistDir: string): AutomationMatcher[] {
  try {
    const parsed = JSON.parse(readFileSync(join(persistDir, FILE), 'utf8')) as FollowupSnapshot
    if (!parsed || !Array.isArray(parsed.schedules)) return []
    return parsed.schedules
      .filter((schedule) => !schedule.optOut && !schedule.calendarCanceled)
      .map((schedule) => compileMeetingFollowupMatcher(schedule))
  } catch {
    return []
  }
}
