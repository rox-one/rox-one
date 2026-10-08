/**
 * W1-12 (#1509) — Local in-process rules consumer.
 *
 * Subscribes to the local command bus's post-commit event bus
 * (`InProcessEventBus`, W1-03) and runs the rule engine for every committed
 * event of this workspace. R1, R3 and R5 work offline: local notes and tasks,
 * the local daily note, the local drive and the local agent DM.
 *
 * Inert while `automation.rules.v1` is off: `attach()` installs no listener at
 * all, and every callback re-checks the flag (a live flag flip stops the work
 * immediately).
 */

import type { DomainEvent } from '@rox/core/events'
import { isAutomationRulesEnabled } from '@rox/shared/feature-flags'
import type { InProcessEventBus } from '../commands/event-bus'
import type { RuleDispatch, RuleScheduler } from './engine'
import { RuleEngine } from './engine'
import { createLocalRuleHost } from './host'
import type { RuleExecutionStore, RuleSettingsStore } from './store'

export interface LocalRulesConsumerOptions {
  workspaceId: string
  /** Workspace root: the local rules SQLite store and the local work store live under it. */
  workspaceRoot: string
  bus: InProcessEventBus
  dispatch: RuleDispatch
  executions: RuleExecutionStore
  settingsStore: RuleSettingsStore
  /** Live enabled workbench flags (the renderer mirrors them; env override applies inside the check). */
  enabledWorkbenchFlags?: () => ReadonlySet<string> | undefined
  isFlagEnabled?: (flag: string) => boolean
  now?: () => Date
  scheduler?: RuleScheduler
  onExecution?: Parameters<typeof createLocalRuleHost>[0]['onExecution']
  onError?: (error: unknown) => void
  newExecutionId?: () => string
}

export interface LocalRulesConsumer {
  readonly engine: RuleEngine
  /** Subscribe to the bus; a no-op while the flag is off. Returns a disposer. */
  attach(): () => void
  detach(): void
  readonly attached: boolean
  /** Re-drive pending executions after a restart (respects backoff and the flag). */
  resumePending(): Promise<void>
  close(): void
}

export function createLocalRulesConsumer(options: LocalRulesConsumerOptions): LocalRulesConsumer {
  const engine = new RuleEngine(createLocalRuleHost({
    workspaceId: options.workspaceId,
    workspaceRoot: options.workspaceRoot,
    executions: options.executions,
    settingsStore: options.settingsStore,
    dispatch: options.dispatch,
    isFlagEnabled: options.isFlagEnabled ?? (() => false),
    ...(options.now ? { now: options.now } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.onExecution ? { onExecution: options.onExecution } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.newExecutionId ? { newExecutionId: options.newExecutionId } : {}),
  }))
  let unsubscribe: (() => void) | null = null

  const enabled = (): boolean => {
    try {
      if (options.enabledWorkbenchFlags) return isAutomationRulesEnabled(options.enabledWorkbenchFlags())
      return engine.enabled
    } catch {
      return false
    }
  }

  const consumer: LocalRulesConsumer = {
    engine,
    get attached() {
      return unsubscribe !== null
    },
    attach() {
      if (unsubscribe || !enabled()) return () => {}
      unsubscribe = options.bus.subscribe((workspaceId, _frame, event: DomainEvent) => {
        if (workspaceId !== options.workspaceId) return
        if (!enabled()) return
        void engine.handleEvent(event).catch(error => options.onError?.(error))
      })
      return () => consumer.detach()
    },
    detach() {
      unsubscribe?.()
      unsubscribe = null
    },
    async resumePending() {
      if (!enabled()) return
      await engine.resumePending()
    },
    close() {
      consumer.detach()
      engine.close()
    },
  }
  return consumer
}