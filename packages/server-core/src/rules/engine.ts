/**
 * W1-12 (#1509) — Domain rule engine (TECH-SPEC §14.2 algorithm).
 *
 * One engine per authority. Per committed event:
 *   1. every rule whose `triggers` match: `targets` → `enabled` → `conditions`;
 *   2. claim the `rule_execution` row (`INSERT … ON CONFLICT DO NOTHING`) —
 *      an existing row resumes from its first non-succeeded step;
 *   3. dispatch each remaining step as a command with
 *      `commandId = key + ':' + step.name` (`command_receipt` dedupes);
 *   4. a failed required step retries on the backoff schedule; optional steps
 *      fail into `partially_succeeded`.
 *
 * Nothing here talks to transports or UI: the host supplies the workspace, the
 * store, the dispatcher and the flag source.
 */

import { randomUUID } from 'node:crypto'
import {
  createCommandEnvelope,
  isEffectiveReceipt,
  type CommandActor,
  type CommandEnvelope,
  type CommandReceipt,
} from '@rox/core/commands'
import { CommandStoreUnavailable } from '../commands/store'
import type { EntityRef } from '@rox/core/entities'
import type { DomainEvent } from '@rox/core/events'
import {
  DOMAIN_RULES,
  MAX_RULE_ATTEMPTS,
  RULE_BACKOFF_SCHEDULE_MS,
  SYSTEM_PRINCIPAL_ID,
  executionStatusAfterAttempt,
  mergeStepRecords,
  resumeStepIndex,
  ruleById,
  ruleRetryDelayMs,
  ruleStepActor,
  ruleStepCommandId,
  skipMarker,
  type DomainRule,
  type RuleCtx,
  type RuleExecutionRecord,
  type RuleId,
  type RuleRunOutcome,
  type RuleSettings,
  type RuleStep,
  type RuleStepPlan,
  type RuleStepRecord,
  type RuleTarget,
  type SkipReason,
  type StepOutcome,
} from '@rox/core/automation'
import type { RuleExecutionStore } from './store'

/** Dispatch of one rule step through the authority's command bus. */
export type RuleDispatch = (input: { workspaceId: string; actor: CommandActor; envelope: CommandEnvelope }) => Promise<CommandReceipt>

/** Retry timer port (tests drive it manually). */
export interface RuleScheduler {
  schedule(delayMs: number, task: () => void): () => void
}

export const DEFAULT_RULE_FLAG = 'automation.rules.v1'

export interface RuleEngineHost {
  readonly workspaceId: string
  readonly executions: RuleExecutionStore
  readonly dispatch: RuleDispatch
  /** Authority of this host: the hint `by-target` steps dispatch with. */
  readonly authorityHint: 'local' | 'workspace'
  now(): Date
  settings(ruleId: RuleId, principalId?: string | null): Promise<RuleSettings>
  isFlagEnabled(flag: string): boolean
  generalChatId(): Promise<string | undefined>
  personalAgent(principalId: string): Promise<string | undefined>
  directChatRef(subjectPrincipalId: string, peerPrincipalId: string): Promise<EntityRef | undefined>
  displayName(principalId: string): Promise<string | undefined>
  scheduler?: RuleScheduler
  /** Flag gating the engine; defaults to `automation.rules.v1`. */
  flag?: string
  onExecution?(outcome: RuleRunOutcome, record: RuleExecutionRecord): void
  onError?(error: unknown): void
  newExecutionId?(): string
}

/** Default scheduler: `setTimeout`, unref'd so it never holds the process open. */
export const TIMER_RULE_SCHEDULER: RuleScheduler = {
  schedule(delayMs, task) {
    const timer = setTimeout(task, delayMs)
    ;(timer as { unref?: () => void }).unref?.()
    return () => clearTimeout(timer)
  },
}

export interface ResumeOptions {
  /** Ignore the backoff gate and the attempt budget (an explicit redelivery or a manual retry). */
  force?: boolean
}

export class RuleEngine {
  private readonly cancels = new Set<() => void>()

  constructor(private readonly host: RuleEngineHost) {}

  private get flag(): string {
    return this.host.flag ?? DEFAULT_RULE_FLAG
  }

  get enabled(): boolean {
    return this.safeFlag(this.flag)
  }

  private safeFlag(flag: string): boolean {
    try { return this.host.isFlagEnabled(flag) === true } catch { return false }
  }

  /** Evaluate one committed event. Safe to call repeatedly (idempotent). */
  async handleEvent(event: DomainEvent): Promise<RuleRunOutcome[]> {
    if (!this.enabled) return []
    const outcomes: RuleRunOutcome[] = []
    for (const rule of DOMAIN_RULES) {
      if (!rule.triggers.includes(event.type)) continue
      try {
        outcomes.push(...(await this.runRule(rule, event)))
      } catch (error) {
        this.host.onError?.(error)
      }
    }
    return outcomes
  }

  /** Re-drive executions that still have steps pending (restart recovery; respects backoff + budget). */
  async resumePending(): Promise<RuleRunOutcome[]> {
    if (!this.enabled) return []
    const outcomes: RuleRunOutcome[] = []
    for (const record of await this.host.executions.pending(this.host.workspaceId)) {
      try {
        outcomes.push(await this.resumeExecution(record))
      } catch (error) {
        this.host.onError?.(error)
      }
    }
    return outcomes
  }

  /**
   * Resume one execution from its stored plan (no event needed). `force`
   * skips the backoff gate and the attempt budget — a manual retry or an
   * explicit redelivery of the same event.
   */
  async resumeExecution(record: RuleExecutionRecord, options: ResumeOptions = {}): Promise<RuleRunOutcome> {
    const names = record.steps.map(step => step.action)
    const idle: RuleRunOutcome = {
      ruleId: record.ruleId as RuleId,
      key: record.idempotencyKey,
      status: record.status,
      duplicate: true,
      steps: record.steps,
    }
    if (resumeStepIndex(names, record.steps, optionalOf(record.steps)) >= names.length) return idle
    if (!options.force && !this.retryDue(record)) return idle
    const attempt = record.attempts + 1
    if (attempt > MAX_RULE_ATTEMPTS && !options.force) return idle
    const outcome = await this.attempt(record, attempt)
    this.host.onExecution?.(outcome, record)
    return outcome
  }

  close(): void {
    for (const cancel of this.cancels) cancel()
    this.cancels.clear()
  }

  private async runRule(rule: DomainRule, event: DomainEvent): Promise<RuleRunOutcome[]> {
    const outcomes: RuleRunOutcome[] = []
    const targets = await rule.targets(this.ctxFor(null), event)
    for (const target of targets) {
      const ctx = this.ctxFor(target)
      const key = rule.key(ctx, event)
      if (!(await rule.enabled(ctx, event))) continue
      const reason = await rule.conditions(ctx, event)
      if (reason) {
        outcomes.push(await this.recordSkip(rule, event, key, reason))
        continue
      }
      const steps = await rule.steps(ctx, event)
      outcomes.push(await this.claimAndRun(rule, event, key, steps, ctx))
    }
    return outcomes
  }

  private ctxFor(target: RuleTarget | null): RuleCtx {
    const host = this.host
    const settingsOf = (ruleId: RuleId, principalId?: string | null): Promise<RuleSettings> =>
      host.settings(ruleId, principalId === undefined ? (target?.subject ?? null) : principalId)
    const ctx: RuleCtx = {
      workspaceId: host.workspaceId,
      subject: target?.subject ?? SYSTEM_PRINCIPAL_ID,
      token: target?.token,
      now: () => host.now(),
      settings: settingsOf,
      params: async (ruleId, principalId) => (await settingsOf(ruleId, principalId)).params,
      isFlagEnabled: flag => this.safeFlag(flag),
      generalChatId: () => host.generalChatId(),
      personalAgent: id => host.personalAgent(id),
      directChatRef: (subject, peer) => host.directChatRef(subject, peer),
      displayName: id => host.displayName(id),
    }
    return ctx
  }

  private async recordSkip(rule: DomainRule, event: DomainEvent, key: string, reason: SkipReason): Promise<RuleRunOutcome> {
    const now = this.host.now().toISOString()
    const claim = await this.host.executions.claim({
      ruleExecutionId: this.newExecutionId(),
      workspaceId: this.host.workspaceId,
      ruleId: rule.id,
      idempotencyKey: key,
      sourceEventId: event.eventId,
      status: 'skipped',
      steps: [],
      attempts: 1,
      lastError: skipMarker(reason),
      createdAt: now,
      finishedAt: now,
    })
    return {
      ruleId: rule.id,
      key,
      status: claim.execution.status,
      duplicate: !claim.inserted,
      skippedReason: reason,
      steps: claim.execution.steps,
    }
  }

  private async claimAndRun(rule: DomainRule, event: DomainEvent, key: string, steps: readonly RuleStep[], ctx: RuleCtx): Promise<RuleRunOutcome> {
    const planned: RuleStepRecord[] = steps.map(step => ({
      action: step.name,
      command_id: ruleStepCommandId(step, key),
      status: 'pending',
      plan: planOf(step, ctx.subject),
    }))
    const claim = await this.host.executions.claim({
      ruleExecutionId: this.newExecutionId(),
      workspaceId: this.host.workspaceId,
      ruleId: rule.id,
      idempotencyKey: key,
      sourceEventId: event.eventId,
      status: 'running',
      steps: planned,
      attempts: 1,
      createdAt: this.host.now().toISOString(),
    })
    if (claim.inserted) {
      const outcome = await this.attempt(claim.execution, 1)
      this.host.onExecution?.(outcome, claim.execution)
      return outcome
    }
    // A redelivery: resume the existing execution from its first pending step.
    return this.resumeExecution(claim.execution, { force: true })
  }

  /** Dispatch from the first pending step, persist, and schedule a retry when one is due. */
  private async attempt(record: RuleExecutionRecord, attempt: number): Promise<RuleRunOutcome> {
    const planned = record.steps
    const names = planned.map(step => step.action)
    const optional = optionalOf(planned)
    const start = resumeStepIndex(names, planned, optional)
    if (start >= names.length) {
      return { ruleId: record.ruleId as RuleId, key: record.idempotencyKey, status: record.status, duplicate: true, steps: planned }
    }
    const outcomes: StepOutcome[] = []
    for (let index = start; index < planned.length; index += 1) {
      const plannedStep = planned[index]!
      const outcome = await this.dispatchStep(plannedStep)
      outcomes.push(outcome)
      if (outcome.status === 'failed' && !optional.has(outcome.action)) break
    }

    const steps = mergeStepRecords(planned, outcomes)
    const status = executionStatusAfterAttempt({ stepNames: names, optional, records: steps, attempts: attempt })
    const failed = steps.find(step => step.status === 'failed' && !optional.has(step.action))
    const updated: RuleExecutionRecord = {
      ...record,
      status,
      steps,
      attempts: attempt,
      ...(failed?.error ? { lastError: failed.error.slice(0, 4000) } : {}),
      ...(status === 'running' ? {} : { finishedAt: this.host.now().toISOString() }),
    }
    if (status === 'running') delete updated.finishedAt
    await this.host.executions.save(updated)
    if (status === 'running') this.scheduleRetry(updated)
    return { ruleId: record.ruleId as RuleId, key: record.idempotencyKey, status, duplicate: false, steps }
  }

  private retryDue(record: RuleExecutionRecord): boolean {
    const delay = ruleRetryDelayMs(record.attempts)
    if (delay === null) return false
    const finished = Date.parse(record.finishedAt ?? record.createdAt)
    if (Number.isNaN(finished)) return true
    return this.host.now().getTime() >= finished + delay
  }

  private scheduleRetry(record: RuleExecutionRecord): void {
    const delay = ruleRetryDelayMs(record.attempts)
    if (delay === null) return
    const scheduler = this.host.scheduler ?? TIMER_RULE_SCHEDULER
    const cancel = scheduler.schedule(delay, () => {
      this.cancels.delete(cancel)
      void this.resumeExecution(record, { force: false }).catch(error => this.host.onError?.(error))
    })
    this.cancels.add(cancel)
  }

  private async dispatchStep(step: RuleStepRecord): Promise<StepOutcome> {
    const plan = step.plan
    const startedAt = this.host.now().getTime()
    const fail = (error: string): StepOutcome => ({
      action: step.action,
      commandId: step.command_id,
      status: 'failed',
      error: error.slice(0, 2000),
      finishedAt: this.host.now().toISOString(),
    })
    if (!plan) return fail('no planned command to resume')

    let actor: CommandActor
    try {
      const agentId = plan.actor === 'system' ? undefined : await this.host.personalAgent(plan.actor.agentOf)
      actor = ruleStepActor({ name: step.action, command: { type: plan.type, payload: plan.payload }, actor: plan.actor }, plan.subject, agentId)
    } catch (error) {
      return fail(errorText(error))
    }
    const envelope = createCommandEnvelope(plan.type, plan.payload, {
      commandId: step.command_id,
      idempotencyKey: step.command_id,
      ...(plan.target ? { target: plan.target } : {}),
      authorityHint: plan.authorityHint ?? this.host.authorityHint,
      ...(plan.actor === 'system' ? {} : { onBehalfOf: plan.actor.agentOf }),
      correlationId: step.command_id,
      now: () => this.host.now(),
    })
    try {
      const receipt = await this.host.dispatch({ workspaceId: this.host.workspaceId, actor, envelope })
      const effective = isEffectiveReceipt(receipt)
      return {
        action: step.action,
        commandId: step.command_id,
        status: effective ? 'succeeded' : 'failed',
        receiptStatus: receipt.status,
        ...(receipt.ref ? { receiptRef: `${receipt.ref.kind}:${receipt.ref.id}` } : {}),
        ...(effective ? {} : { error: receipt.error?.code ?? receipt.status }),
        durationMs: this.host.now().getTime() - startedAt,
        finishedAt: this.host.now().toISOString(),
      }
    } catch (error) {
      // A store outage committed nothing: rethrow so the caller sees it and the
      // retry timer re-dispatches (the same command id cannot double-apply).
      if (error instanceof CommandStoreUnavailable) throw error
      return fail(errorText(error))
    }
  }

  private newExecutionId(): string {
    return this.host.newExecutionId?.() ?? randomUUID()
  }
}

function planOf(step: RuleStep, subject: string): RuleStepPlan {
  return {
    type: step.command.type,
    payload: step.command.payload,
    ...(step.command.target ? { target: step.command.target } : {}),
    ...(step.command.authorityHint ? { authorityHint: step.command.authorityHint } : {}),
    actor: step.actor,
    subject,
    ...(step.optional ? { optional: true } : {}),
  }
}

/** Names of the optional steps of an execution (from the stored plans). */
function optionalOf(records: readonly RuleStepRecord[]): Set<string> {
  return new Set(records.filter(record => record.plan?.optional === true).map(record => record.action))
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 2000)
  return String(error).slice(0, 2000)
}