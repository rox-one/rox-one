/**
 * W1-12 (#1509) — The workspace `rules` consumer group and its settings API.
 *
 * The runtime is the workspace authority's half of TECH-SPEC §14.2: a
 * `DomainEventSink` attached to the W1-03 relay (the same mechanism as
 * notification fan-out) evaluates every committed `domain_event` through the
 * shared `@rox/server-core` engine, dispatching each step as an ordinary
 * workspace command (ACL, `rule:*` rate limits, receipts, audit).
 *
 * Metrics (TECH-SPEC §14.4): `rule_executions_total{rule,status}`,
 * `rule_duplicates_prevented_total` and per-step latencies in milliseconds.
 */

import type { SQL } from 'bun'
import type { DomainEvent } from '@rox/core/events'
import { isAutomationRulesEnabled } from '@rox/shared/feature-flags'
import type { RuleRunOutcome } from '@rox/core/automation'
import { RpcCallCounter } from '../../../../../packages/server-core/src/observability/rpc-call-counter.ts'
import { RuleEngine, type RuleDispatch, type RuleScheduler } from '../../../../../packages/server-core/src/rules/engine.ts'
import { RuleSettingsService } from '../../../../../packages/server-core/src/rules/settings.ts'
import type { RuleExecutionStore, RuleSettingsStore } from '../../../../../packages/server-core/src/rules/store.ts'
import type { DomainEventSink } from '../events/relay.ts'
import { PostgresRulesStore } from './store.ts'
import { createWorkspaceRuleHost } from './host.ts'

export interface WorkspaceRulesOptions {
  database: SQL
  schema: string
  /** The workspace command executor of that workspace (`null`: nothing to dispatch). */
  dispatchFor: (workspaceId: string) => RuleDispatch | null
  /** Live enabled workbench flags; the env override applies inside the check. */
  enabledWorkbenchFlags?: () => ReadonlySet<string> | undefined
  isFlagEnabled?: (flag: string) => boolean
  now?: () => Date
  scheduler?: RuleScheduler
  onError?: (error: unknown) => void
  /** Execution store override (tests use the in-memory twin). */
  storeFor?: (workspaceId: string) => RuleExecutionStore & RuleSettingsStore
  /** Workspace role lookup for the settings API admin gate (`owner` / `admin`). */
  roleFor?: (workspaceId: string, principalId: string) => Promise<string | null>
}

export interface WorkspaceRulesRuntime {
  /** Live `automation.rules.v1` check (routes and sink are inert while off). */
  enabled(): boolean
  /** Relay sink: evaluates committed events for their workspace (inert while the flag is off). */
  readonly sink: DomainEventSink
  /** `automation_rule` settings API of one workspace (admin gate included). */
  settingsFor(workspaceId: string): RuleSettingsService
  /** Execution history of one workspace. */
  executionsFor(workspaceId: string): RuleExecutionStore
  /** Whether the caller may manage the workspace-level rules R2–R5 (DATA-MODEL §5.16). */
  isAdmin(workspaceId: string, principalId: string): Promise<boolean>
  /** `POST …/retry`: force the pending steps of one execution. */
  retry(workspaceId: string, idempotencyKey: string): Promise<RuleRunOutcome | null>
  /** Re-drive pending executions (startup recovery). */
  resumePending(workspaceId: string): Promise<number>
  /** Fixed-label counters (TECH-SPEC §14.4); no ids, payloads or keys leave this port. */
  snapshot(): Readonly<Record<string, number>>
  close(): void
}

interface WorkspaceEntry {
  store: RuleExecutionStore & RuleSettingsStore
  engine: RuleEngine
  settings: RuleSettingsService
}

export function createWorkspaceRules(options: WorkspaceRulesOptions): WorkspaceRulesRuntime {
  const entries = new Map<string, WorkspaceEntry>()
  const counters = new RpcCallCounter()

  const enabled = (): boolean => {
    try {
      if (options.enabledWorkbenchFlags) return isAutomationRulesEnabled(options.enabledWorkbenchFlags())
      return options.isFlagEnabled ? options.isFlagEnabled('automation.rules.v1') : isAutomationRulesEnabled()
    } catch {
      return false
    }
  }

  const stores = new Map<string, RuleExecutionStore & RuleSettingsStore>()
  const storeOf = (workspaceId: string): RuleExecutionStore & RuleSettingsStore => {
    const existing = stores.get(workspaceId)
    if (existing) return existing
    const store = options.storeFor?.(workspaceId) ?? new PostgresRulesStore(options.database, options.schema)
    stores.set(workspaceId, store)
    return store
  }
  const isAdmin = async (workspaceId: string, principalId: string): Promise<boolean> => {
    if (options.roleFor) {
      const role = await options.roleFor(workspaceId, principalId)
      return role === 'owner' || role === 'admin'
    }
    const store = storeOf(workspaceId)
    if (!(store instanceof PostgresRulesStore)) return false
    const role = await store.memberRole(workspaceId, principalId)
    return role === 'owner' || role === 'admin'
  }

  const entryFor = (workspaceId: string): WorkspaceEntry | null => {
    const existing = entries.get(workspaceId)
    if (existing) return existing
    const dispatch = options.dispatchFor(workspaceId)
    if (!dispatch) return null
    const store = storeOf(workspaceId)
    const engine = new RuleEngine(createWorkspaceRuleHost({
      workspaceId,
      database: options.database,
      schema: options.schema,
      executions: store,
      settingsStore: store,
      dispatch,
      isFlagEnabled: options.isFlagEnabled ?? (() => false),
      ...(options.now ? { now: options.now } : {}),
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      onExecution: outcome => {
        // A redelivery that found nothing to do is a prevented duplicate, not a
        // new execution (TECH-SPEC §14.4 keeps the two counters apart).
        if (outcome.duplicate) {
          counters.record('rule_duplicates_prevented_total')
          return
        }
        counters.record(`rule_executions_total|rule=${outcome.ruleId}|status=${outcome.status}`)
        for (const step of outcome.steps) {
          if (typeof step.duration_ms === 'number') counters.record(`rule_step_latency_ms|rule=${outcome.ruleId}|step=${step.action}`, Math.round(step.duration_ms))
        }
      },
      ...(options.onError ? { onError: options.onError } : {}),
    }))
    const settings = new RuleSettingsService({
      store,
      workspaceId,
      ...(options.now ? { now: options.now } : {}),
      isAdmin: async actor => isAdmin(workspaceId, actor.principalId),
    })
    const entry: WorkspaceEntry = { store, engine, settings }
    entries.set(workspaceId, entry)
    return entry
  }

  return {
    enabled,
    async sink(events: DomainEvent[]) {
      if (!enabled()) return
      for (const event of events) {
        const entry = entryFor(event.workspaceId)
        if (!entry) continue
        await entry.engine.handleEvent(event)
      }
    },
    settingsFor(workspaceId) {
      const entry = entryFor(workspaceId)
      if (!entry) throw new Error(`No rules runtime for workspace ${workspaceId}`)
      return entry.settings
    },
    executionsFor(workspaceId) {
      const entry = entryFor(workspaceId)
      if (!entry) throw new Error(`No rules runtime for workspace ${workspaceId}`)
      return entry.store
    },
    isAdmin,
    async retry(workspaceId, idempotencyKey) {
      const entry = entryFor(workspaceId)
      if (!entry || !enabled()) return null
      const record = await entry.store.get(workspaceId, idempotencyKey)
      if (!record) return null
      return entry.engine.resumeExecution(record, { force: true })
    },
    async resumePending(workspaceId) {
      const entry = entryFor(workspaceId)
      if (!entry || !enabled()) return 0
      const outcomes = await entry.engine.resumePending()
      return outcomes.length
    },
    snapshot() {
      return Object.freeze(counters.snapshot())
    },
    close() {
      for (const entry of entries.values()) entry.engine.close()
      entries.clear()
    },
  }
}