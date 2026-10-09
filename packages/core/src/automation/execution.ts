/**
 * W1-12 (#1509) — `rule_execution` lifecycle (TECH-SPEC §14.2, DATA-MODEL §5.16).
 *
 * Pure decision logic shared by the local consumer (server-core) and the
 * `rules` consumer group (workspace-service):
 * - which step a redelivery resumes from ("steps already done are never repeated");
 * - the final status (`succeeded` / `partially_succeeded` / `failed`);
 * - the retry backoff schedule (1 min, 5 min, 30 min, 2 h; after 4 attempts the
 *   execution is `failed`).
 *
 * Persistence, dispatch and scheduling are the runtime's job.
 */

import type { CommandAuthorityHint, CommandType } from '../commands/envelope.ts'
import type { CommandReceiptStatus } from '../commands/receipt.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { PrincipalId, RuleId, SkipReason } from './rule.ts'

export const RULE_EXECUTION_STATUSES = ['running', 'succeeded', 'partially_succeeded', 'failed', 'skipped'] as const

export type RuleExecutionStatus = (typeof RULE_EXECUTION_STATUSES)[number]

export const RULE_STEP_STATUSES = ['pending', 'succeeded', 'failed', 'skipped'] as const

export type RuleStepStatus = (typeof RULE_STEP_STATUSES)[number]

/**
 * The planned command of a step, stored with the execution so a restart can
 * resume it without the triggering event. `rule_execution.steps` is jsonb
 * (DATA-MODEL §5.16); the plan is an extra member of each record, and the
 * settings API strips it from its view.
 */
export interface RuleStepPlan {
  type: CommandType
  payload: Record<string, unknown>
  target?: EntityRef
  authorityHint?: CommandAuthorityHint
  actor: 'system' | { agentOf: PrincipalId }
  /** The principal this execution acts for (the step's actor and target owner). */
  subject: PrincipalId
  optional?: boolean
}

/**
 * One step of an execution, stored in `rule_execution.steps`
 * (`[{action, command_id, receipt_ref, status}]`, DATA-MODEL §5.16).
 */
export interface RuleStepRecord {
  /** Step name (`RuleStep.name`). */
  action: string
  command_id: string
  status: RuleStepStatus
  /** What the step will dispatch (written at claim time, survives a restart). */
  plan?: RuleStepPlan
  /** Receipt status of the dispatched command (`applied` / `duplicate` / `rejected` / …). */
  receipt_status?: CommandReceiptStatus
  /** Ref created by the step (`receipt.ref`), for the "open the created entity" chip. */
  receipt_ref?: string
  error?: string
  attempts?: number
  duration_ms?: number
  finished_at?: string
}

export interface RuleExecutionRecord {
  ruleExecutionId: string
  workspaceId: string
  ruleId: RuleId | string
  idempotencyKey: string
  sourceEventId: string
  status: RuleExecutionStatus
  steps: readonly RuleStepRecord[]
  attempts: number
  lastError?: string
  createdAt: string
  finishedAt?: string
}

/** Backoff schedule after a failed attempt: 1 min, 5 min, 30 min, 2 h. */
export const RULE_BACKOFF_SCHEDULE_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const

/** Attempts an execution gets before it is `failed` (DATA-MODEL §5.16). */
export const MAX_RULE_ATTEMPTS = RULE_BACKOFF_SCHEDULE_MS.length

/** Delay before attempt `attempts + 1`; `null` when the attempt budget is spent. */
export function ruleRetryDelayMs(attempts: number): number | null {
  if (attempts < 1 || attempts > RULE_BACKOFF_SCHEDULE_MS.length) return null
  return RULE_BACKOFF_SCHEDULE_MS[attempts - 1] ?? null
}

/** A step is done when it succeeded, or was skipped as optional. */
export function isStepDone(record: RuleStepRecord | undefined): boolean {
  return record?.status === 'succeeded' || record?.status === 'skipped'
}

function recordFor(records: readonly RuleStepRecord[], action: string): RuleStepRecord | undefined {
  return records.find(record => record.action === action)
}

/**
 * First step index a redelivery must run: the first step whose name has no
 * terminal record in the previous attempt (`steps already done are never
 * repeated`). An optional step that failed is terminal too — the execution
 * finishes as `partially_succeeded` instead of retrying it. `stepCount` when
 * every step is done.
 */
export function resumeStepIndex(
  stepNames: readonly string[],
  records: readonly RuleStepRecord[],
  optional: ReadonlySet<string> = new Set(),
): number {
  for (let index = 0; index < stepNames.length; index += 1) {
    const name = stepNames[index]!
    const record = recordFor(records, name)
    if (record?.status === 'failed' && optional.has(name)) continue
    if (!isStepDone(record)) return index
  }
  return stepNames.length
}

/** A step record merged with the receipt of the latest attempt. */
export interface StepOutcome {
  action: string
  commandId: string
  status: RuleStepStatus
  receiptStatus?: CommandReceiptStatus
  receiptRef?: string
  error?: string
  durationMs?: number
  finishedAt: string
}

/** Apply one attempt's outcome over the previous records (in step order, deduped by action). */
export function mergeStepRecords(previous: readonly RuleStepRecord[], outcomes: readonly StepOutcome[]): RuleStepRecord[] {
  const byAction = new Map(previous.map(record => [record.action, { ...record }]))
  for (const outcome of outcomes) {
    const prior = byAction.get(outcome.action)
    byAction.set(outcome.action, {
      action: outcome.action,
      command_id: outcome.commandId,
      status: outcome.status,
      ...(prior?.plan ? { plan: prior.plan } : {}),
      ...(outcome.receiptStatus ? { receipt_status: outcome.receiptStatus } : {}),
      ...(outcome.receiptRef ? { receipt_ref: outcome.receiptRef } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
      attempts: (prior?.attempts ?? 0) + 1,
      ...(outcome.durationMs !== undefined ? { duration_ms: outcome.durationMs } : {}),
      finished_at: outcome.finishedAt,
    })
  }
  return [...byAction.values()]
}

export interface ExecutionStatusInput {
  /** Step names in declaration order. */
  stepNames: readonly string[]
  /** Whether each step is optional, by name. */
  optional?: ReadonlySet<string>
  records: readonly RuleStepRecord[]
  /** Attempts already spent (including the latest). */
  attempts: number
  /** Attempt budget; defaults to `MAX_RULE_ATTEMPTS`. */
  maxAttempts?: number
}

/**
 * Status after an attempt: `succeeded` when every step is done, `partially_
 * succeeded` when only optional steps failed, `running` while a retry is
 * pending, `failed` when the attempt budget is spent.
 */
export function executionStatusAfterAttempt(input: ExecutionStatusInput): RuleExecutionStatus {
  const { stepNames, records, attempts } = input
  const optional = input.optional ?? new Set<string>()
  const pending = resumeStepIndex(stepNames, records, optional)
  if (pending >= stepNames.length) {
    const optionalFailure = records.some(record => record.status === 'failed' && optional.has(record.action))
    return optionalFailure ? 'partially_succeeded' : 'succeeded'
  }
  const budget = input.maxAttempts ?? MAX_RULE_ATTEMPTS
  return attempts >= budget ? 'failed' : 'running'
}

/** Whether an execution needs another attempt (`running` with a pending step). */
export function isResumable(status: RuleExecutionStatus): boolean {
  return status === 'running' || status === 'failed' || status === 'partially_succeeded'
}

/** A step failed and the execution still has attempts left. */
export function needsRetry(input: ExecutionStatusInput): boolean {
  return executionStatusAfterAttempt(input) === 'running'
}

/** The skip marker stored on a `skipped` execution (`last_error` has no reason column). */
export function skipMarker(reason: string): string {
  return `skipped:${reason}`
}

export function skipReasonFromMarker(marker: string | undefined): string | undefined {
  return marker?.startsWith('skipped:') ? marker.slice('skipped:'.length) : undefined
}

/** What one rule did with one event (engine result; also the observability input). */
export interface RuleRunOutcome {
  ruleId: RuleId
  /** `rule_execution.idempotency_key`. */
  key: string
  status: RuleExecutionStatus
  /** Nothing was dispatched: the execution already existed and had no pending step. */
  duplicate: boolean
  skippedReason?: SkipReason
  steps: readonly RuleStepRecord[]
}