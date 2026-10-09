/**
 * W1-12 (#1509) — Host wiring for the local rules consumer.
 *
 * The command-bus RPC handler (`handlers/rpc/commands.ts`) calls this once per
 * process and attaches a workspace consumer the first time that workspace runs
 * a command. One `SqliteRulesStore` per workspace (`<root>/.rox/automation-rules.sqlite`)
 * backs both the executions and the `automation_rule` settings.
 */

import type { CommandEnvelope, CommandReceipt } from '@rox/core/commands'
import type { CommandActor } from '@rox/core/commands'
import type { InProcessEventBus } from '../commands/event-bus'
import { createLocalRulesConsumer, type LocalRulesConsumer } from './consumer'
import type { RuleScheduler } from './engine'
import { SqliteRulesStore } from './store'
import { RuleSettingsService } from './settings'

export interface LocalRulesDispatchInput {
  workspaceId: string
  actor: CommandActor
  envelope: CommandEnvelope
}

export interface LocalRulesWiringOptions {
  bus: InProcessEventBus
  workspaceFor: (workspaceId: string) => { id: string; rootPath: string } | null
  /** The local router's `route` for a workspace (`null`: no local authority there). */
  dispatchFor: (workspaceId: string) => ((input: LocalRulesDispatchInput) => Promise<CommandReceipt>) | null
  /** Live enabled workbench flags (renderer mirror); the env override applies inside the check. */
  enabledWorkbenchFlags?: () => ReadonlySet<string> | undefined
  isFlagEnabled?: (flag: string) => boolean
  now?: () => Date
  scheduler?: RuleScheduler
  onError?: (error: unknown) => void
}

export interface LocalRulesWiring {
  /** Consumer of one workspace (created on demand; `null` when the workspace is unknown). */
  consumerFor(workspaceId: string): LocalRulesConsumer | null
  /** Executions store of one workspace (also the settings store). */
  storeFor(workspaceId: string): SqliteRulesStore | null
  /** `automation_rule` settings API of one workspace. */
  settingsFor(workspaceId: string): RuleSettingsService | null
  /** Attach the consumer of a workspace (no-op while the flag is off or already attached). */
  attachWorkspace(workspaceId: string): void
  close(): void
}

interface WorkspaceEntry {
  store: SqliteRulesStore
  consumer: LocalRulesConsumer
  settings: RuleSettingsService
}

export function createLocalRulesWiring(options: LocalRulesWiringOptions): LocalRulesWiring {
  const entries = new Map<string, WorkspaceEntry>()

  const entryFor = (workspaceId: string): WorkspaceEntry | null => {
    const existing = entries.get(workspaceId)
    if (existing) return existing
    const workspace = options.workspaceFor(workspaceId)
    const dispatch = options.dispatchFor(workspaceId)
    if (!workspace || !dispatch) return null
    const store = new SqliteRulesStore({ workspaceRoot: workspace.rootPath })
    const consumer = createLocalRulesConsumer({
      workspaceId,
      workspaceRoot: workspace.rootPath,
      bus: options.bus,
      dispatch,
      executions: store,
      settingsStore: store,
      ...(options.enabledWorkbenchFlags ? { enabledWorkbenchFlags: options.enabledWorkbenchFlags } : {}),
      isFlagEnabled: options.isFlagEnabled ?? (() => false),
      ...(options.now ? { now: options.now } : {}),
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    })
    const settings = new RuleSettingsService({
      store,
      workspaceId,
      ...(options.now ? { now: options.now } : {}),
      isAdmin: async () => true,
    })
    const entry: WorkspaceEntry = { store, consumer, settings }
    entries.set(workspaceId, entry)
    return entry
  }

  return {
    consumerFor: workspaceId => entryFor(workspaceId)?.consumer ?? null,
    storeFor: workspaceId => entryFor(workspaceId)?.store ?? null,
    settingsFor: workspaceId => entryFor(workspaceId)?.settings ?? null,
    attachWorkspace(workspaceId) {
      const entry = entryFor(workspaceId)
      if (!entry) return
      entry.consumer.attach()
      if (!entry.consumer.attached) return
      void entry.consumer.resumePending().catch(error => options.onError?.(error))
    },
    close() {
      for (const entry of entries.values()) {
        try { entry.consumer.close() } catch (error) { options.onError?.(error) }
        try { entry.store.close() } catch (error) { options.onError?.(error) }
      }
      entries.clear()
    },
  }
}