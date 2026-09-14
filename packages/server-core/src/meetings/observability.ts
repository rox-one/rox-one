/**
 * Meeting traces, budgets, and backpressure (issue #386 / I030).
 * Reserve before dispatch, settle after receipt, reconcile on unknown.
 * Unknown does not silently return budget. Secrets and raw speech stay out of traces.
 */

import { randomUUID } from 'node:crypto'

export const MEETING_TRACE_STAGES = [
  'capture',
  'asr',
  'extract',
  'route',
  'assist',
  'approve',
  'execute',
  'verify',
] as const

export type MeetingTraceStage = (typeof MEETING_TRACE_STAGES)[number]

export type MeetingTraceMode = 'production' | 'fixture' | 'simulated'
export type MeetingTraceLifecycle = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
export type MeetingTraceVerification = 'not_requested' | 'pending' | 'verified' | 'mismatch' | 'unknown'

export type MeetingTrace = {
  traceId: string
  correlationId: string
  causationId?: string
  meetingId: string
  operationId?: string
  stage: MeetingTraceStage
  mode: MeetingTraceMode
  lifecycle: MeetingTraceLifecycle
  verification: MeetingTraceVerification
  modelRoute?: string
  modelVersion?: string
  latencyMs?: number
  tokenUsage?: number
  audioMs?: number
  policy?: string
  startedAt: number
  finishedAt?: number
}

export type BudgetReservation = {
  operationId: string
  amount: number
  status: 'reserved' | 'settled' | 'unknown'
  settled?: number
}

export type BudgetReserveOk = {
  ok: true
  reservationId: string
  reserved: number
  remaining: number
}

export type BudgetReserveDenied = {
  ok: false
  code: 'cap-exceeded' | 'already-reserved' | 'invalid-amount'
  remaining: number
}

export type MeetingBackpressureSnapshot = {
  running: number
  queued: number
  cancelled: number
  rateLimited: number
  offline: number
  bytes: number
}

const MAX_TRACE_TEXT = 0

function sanitizePolicy(policy: string | undefined): string | undefined {
  if (!policy) return undefined
  return policy.replace(/sk-[a-zA-Z0-9]+|Bearer\s+\S+|password=\S+/gi, '[redacted]').slice(0, 120)
}

export function createMeetingTrace(input: Omit<MeetingTrace, 'traceId' | 'startedAt'> & { traceId?: string; startedAt?: number }): MeetingTrace {
  return {
    ...input,
    traceId: input.traceId ?? randomUUID(),
    startedAt: input.startedAt ?? Date.now(),
    policy: sanitizePolicy(input.policy),
    tokenUsage: input.tokenUsage,
  }
}

export function finishMeetingTrace(trace: MeetingTrace, input: {
  lifecycle: MeetingTraceLifecycle
  verification?: MeetingTraceVerification
  latencyMs?: number
  tokenUsage?: number
  finishedAt?: number
}): MeetingTrace {
  return {
    ...trace,
    lifecycle: input.lifecycle,
    verification: input.verification ?? trace.verification,
    latencyMs: input.latencyMs ?? ((input.finishedAt ?? Date.now()) - trace.startedAt),
    tokenUsage: input.tokenUsage ?? trace.tokenUsage,
    finishedAt: input.finishedAt ?? Date.now(),
  }
}

export function traceOmitsSecrets(trace: MeetingTrace): boolean {
  const encoded = JSON.stringify(trace)
  return !encoded.includes('sk-') && encoded.length >= 0 && !encoded.includes('password=')
}

export class MeetingBudgetLedger {
  private readonly rows = new Map<string, BudgetReservation>()

  constructor(private readonly cap: number) {
    if (!Number.isFinite(cap) || cap < 0) throw new Error('Budget cap must be a non-negative number')
  }

  remaining(): number {
    return this.cap - this.held()
  }

  held(): number {
    let used = 0
    for (const row of this.rows.values()) {
      if (row.status === 'settled') used += row.settled ?? 0
      else used += row.amount
    }
    return used
  }

  get(operationId: string): BudgetReservation | undefined {
    const row = this.rows.get(operationId)
    return row ? { ...row } : undefined
  }

  reserve(operationId: string, amount: number): BudgetReserveOk | BudgetReserveDenied {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, code: 'invalid-amount', remaining: this.remaining() }
    }
    const existing = this.rows.get(operationId)
    if (existing && existing.status !== 'settled') {
      return { ok: false, code: 'already-reserved', remaining: this.remaining() }
    }
    if (this.held() + amount > this.cap) {
      return { ok: false, code: 'cap-exceeded', remaining: this.remaining() }
    }
    this.rows.set(operationId, { operationId, amount, status: 'reserved' })
    return { ok: true, reservationId: operationId, reserved: amount, remaining: this.remaining() }
  }

  settle(operationId: string, actual: number): BudgetReservation {
    const row = this.require(operationId)
    if (row.status === 'unknown') {
      throw new Error('unknown-budget-must-reconcile')
    }
    const settled = Math.max(0, actual)
    if (settled > this.cap) {
      throw new Error('settle-exceeds-cap')
    }
    const next: BudgetReservation = { ...row, status: 'settled', settled }
    this.rows.set(operationId, next)
    return { ...next }
  }

  markUnknown(operationId: string): BudgetReservation {
    const row = this.require(operationId)
    const next: BudgetReservation = { ...row, status: 'unknown' }
    this.rows.set(operationId, next)
    return { ...next }
  }

  reconcile(operationId: string, observed?: number): BudgetReservation {
    const row = this.require(operationId)
    if (row.status !== 'unknown' && observed === undefined) {
      return { ...row }
    }
    const settled = observed === undefined ? row.amount : Math.max(0, observed)
    const next: BudgetReservation = { ...row, status: 'settled', settled }
    this.rows.set(operationId, next)
    return { ...next }
  }

  private require(operationId: string): BudgetReservation {
    const row = this.rows.get(operationId)
    if (!row) throw new Error(`Unknown budget reservation ${operationId}`)
    return row
  }
}

export type BackpressureJob = {
  id: string
  meetingId: string
  workspaceId: string
  tokens: number
  bytes?: number
}

export class MeetingBackpressureQueue {
  private running = new Set<string>()
  private queue: BackpressureJob[] = []
  private cancelled = new Set<string>()
  private rateLimited = 0
  private offline = 0
  private bytes = 0
  private backoffUntil = 0

  constructor(
    private readonly limits: {
      maxConcurrent: number
      maxQueue: number
      maxBytes: number
    },
    private readonly now: () => number = () => Date.now(),
  ) {}

  snapshot(): MeetingBackpressureSnapshot {
    return {
      running: this.running.size,
      queued: this.queue.length,
      cancelled: this.cancelled.size,
      rateLimited: this.rateLimited,
      offline: this.offline,
      bytes: this.bytes,
    }
  }

  enqueue(job: BackpressureJob): { ok: true } | { ok: false; code: 'queue-full' | 'memory-cap' | 'rate-limited' | 'cancelled' } {
    if (this.cancelled.has(job.id)) return { ok: false, code: 'cancelled' }
    if (this.now() < this.backoffUntil) {
      this.rateLimited += 1
      return { ok: false, code: 'rate-limited' }
    }
    const nextBytes = this.bytes + (job.bytes ?? 0)
    if (nextBytes > this.limits.maxBytes) return { ok: false, code: 'memory-cap' }
    if (this.running.size < this.limits.maxConcurrent) {
      this.running.add(job.id)
      this.bytes = nextBytes
      return { ok: true }
    }
    if (this.queue.length >= this.limits.maxQueue) return { ok: false, code: 'queue-full' }
    this.queue.push(job)
    this.bytes = nextBytes
    return { ok: true }
  }

  complete(jobId: string, bytes = 0): void {
    this.running.delete(jobId)
    this.bytes = Math.max(0, this.bytes - bytes)
    const next = this.queue.shift()
    if (next) this.running.add(next.id)
  }

  cancel(jobId: string): void {
    this.cancelled.add(jobId)
    this.queue = this.queue.filter((job) => job.id !== jobId)
    this.running.delete(jobId)
  }

  note429(backoffMs: number): void {
    this.rateLimited += 1
    this.backoffUntil = Math.max(this.backoffUntil, this.now() + backoffMs)
  }

  noteOffline(): void {
    this.offline += 1
  }
}

export function conversationMetrics(input: {
  truePositive: number
  falsePositive: number
  falseNegative: number
  abstain: number
  resolvedOwner: number
  resolvedOwnerCorrect: number
  resolvedDate: number
  resolvedDateCorrect: number
  citationsValid: number
  citationsTotal: number
  latenciesMs: readonly number[]
}): {
  taskPrecision: number
  taskRecall: number
  falsePositiveRate: number
  abstainRate: number
  ownerAccuracy: number | null
  dateAccuracy: number | null
  citationValidity: number | null
  p95Ms: number | null
  coverage: number
} {
  const decisions = input.truePositive + input.falsePositive + input.falseNegative + input.abstain
  const precisionDen = input.truePositive + input.falsePositive
  const recallDen = input.truePositive + input.falseNegative
  return {
    taskPrecision: precisionDen === 0 ? 1 : input.truePositive / precisionDen,
    taskRecall: recallDen === 0 ? 1 : input.truePositive / recallDen,
    falsePositiveRate: precisionDen === 0 ? 0 : input.falsePositive / precisionDen,
    abstainRate: decisions === 0 ? 0 : input.abstain / decisions,
    ownerAccuracy: input.resolvedOwner === 0 ? null : input.resolvedOwnerCorrect / input.resolvedOwner,
    dateAccuracy: input.resolvedDate === 0 ? null : input.resolvedDateCorrect / input.resolvedDate,
    citationValidity: input.citationsTotal === 0 ? null : input.citationsValid / input.citationsTotal,
    p95Ms: percentile(input.latenciesMs, 0.95),
    coverage: decisions,
  }
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index] ?? null
}

void MAX_TRACE_TEXT
