/**
 * W1-06 (#1503) — Command modules: domain schemas + reference handlers.
 *
 * Both are registered through `COMMAND_MODULES` (the W1-03 wiring contract),
 * so the local and the workspace authority bind the same set:
 * - `DOMAIN_SCHEMA_COMMAND_MODULE` binds the `@rox/shared/domain` payload
 *   schema of every catalogue command that still has the placeholder;
 * - `REFERENCE_COMMAND_MODULE` binds a reference handler to every catalogue
 *   command that has no handler yet. It is the LAST module: a wave-2 module
 *   listed before it binds its own handler and the reference one is skipped.
 *
 * The backend is chosen from the executor's transaction handle (memory /
 * local SQLite store / Postgres).
 */

import { CommandRejection, type CommandHandlerContext, type CommandRegistry } from '@rox/core/commands'
import { COMMAND_PAYLOAD_SCHEMAS } from '@rox/shared/domain'
import { EntityLinkStore } from '../../entities/link-store'
import type { PersonalTaskPersistStore } from '../../tasks/personal-persist'
import { LocalWorkStore } from '../local-work-store'
import { ensureGoalsMigrated } from '../migrations/goals-migration'
import { LocalRecordBackend, type LocalLinkIndex } from './backends/local'
import { MemoryRecordBackend } from './backends/memory'
import { PostgresRecordBackend, type PostgresUnsafe } from './backends/postgres'
import { referenceHandler } from './engine'
import { REFERENCE_SPECS } from './specs'
import type { RecordBackend } from './types'

export interface ReferenceRuntime {
  now(): Date
  /** Local authority: workspace root for `{root}/work/` (null → NOT_FOUND). */
  workspaceRoot(workspaceId: string): string | null
  /**
   * Local authority: the PersonalTask v3 store backing `task` / `task-list`
   * (null → `work/tasks/`). May throw a `CommandRejection` (e.g. UNAVAILABLE
   * for a principal-scoped session): task commands then answer with it, the
   * other local commands still run.
   */
  personalTaskStore(workspaceId: string): PersonalTaskPersistStore | null
  /** The PersonalTask store changed under the Tasks UI (a task / list write, a MIG-05 placement). */
  personalTasksChanged(): void
  /** Local authority: link index mirror (null → links stay in `work/links/` only). */
  linkIndex(workspaceRoot: string): LocalLinkIndex | null
  /** Live flag lookup (the link index is only opened while `entities.links.v1` is on). */
  isFlagEnabled(flag: string): boolean
}

const linkStores = new Map<string, EntityLinkStore>()

const DEFAULT_RUNTIME: ReferenceRuntime = {
  now: () => new Date(),
  workspaceRoot: () => null,
  personalTaskStore: () => null,
  personalTasksChanged: () => {},
  linkIndex: root => {
    if (!runtime.isFlagEnabled('entities.links.v1')) return null
    let store = linkStores.get(root)
    if (!store) linkStores.set(root, (store = new EntityLinkStore({ workspaceRoot: root })))
    return store
  },
  isFlagEnabled: () => false,
}

let runtime: ReferenceRuntime = { ...DEFAULT_RUNTIME }

/** Host wiring (commands RPC, workspace service, tests). Returns a restore function. */
export function configureReferenceRuntime(overrides: Partial<ReferenceRuntime>): () => void {
  const previous = runtime
  runtime = { ...runtime, ...overrides }
  return () => { runtime = previous }
}

export function resetReferenceRuntime(): void {
  runtime = { ...DEFAULT_RUNTIME }
  for (const store of linkStores.values()) {
    try { store.close() } catch { /* best effort */ }
  }
  linkStores.clear()
}

/** The clock the reference handlers run on (W1-14: later modules share it, so one test override covers all). */
export function referenceRuntimeNow(): Date {
  return runtime.now()
}

interface TransactionHandle { kind?: string; workspaceId?: string; sql?: PostgresUnsafe; prefix?: string }

export function referenceBackendFor(ctx: CommandHandlerContext<unknown>): RecordBackend {
  const handle = (ctx.transaction ?? {}) as TransactionHandle
  switch (handle.kind) {
    case 'memory':
      return new MemoryRecordBackend(ctx.workspaceId)
    case 'sqlite': {
      const root = runtime.workspaceRoot(ctx.workspaceId)
      if (!root) throw new CommandRejection('NOT_FOUND', 'Workspace not found')
      let tasks: PersonalTaskPersistStore | null = null
      let tasksUnavailable: unknown
      try { tasks = runtime.personalTaskStore(ctx.workspaceId) } catch (error) { tasksUnavailable = error }
      // MIG-04/05 (goals.v1): once per workspace and process, before the first local command reads the work store
      // (deferred while the task store is unavailable to this session, so MIG-05 placements are never dropped).
      if (tasksUnavailable === undefined) {
        const report = ensureGoalsMigrated({ workspaceRoot: root, workspaceId: ctx.workspaceId, isFlagEnabled: flag => runtime.isFlagEnabled(flag), tasks, now: () => runtime.now(), actorId: ctx.actor.principalId })
        if (report?.status === 'migrated' && report.projects.some(project => project.tasksLinked > 0)) runtime.personalTasksChanged()
      }
      return new LocalRecordBackend({
        work: new LocalWorkStore({ workspaceRoot: root }),
        tasks,
        ...(tasksUnavailable !== undefined ? { tasksUnavailable } : {}),
        links: runtime.linkIndex(root),
        onTasksChanged: () => runtime.personalTasksChanged(),
      })
    }
    case 'postgres':
      if (!handle.sql || typeof handle.prefix !== 'string') break
      return new PostgresRecordBackend({ sql: handle.sql, prefix: handle.prefix, workspaceId: ctx.workspaceId, actorId: ctx.actor.principalId })
  }
  throw new CommandRejection('INTERNAL', 'No reference backend for this command store')
}

/** Binds the domain payload schema of every catalogue command still on the placeholder. */
export function bindDomainSchemas(registry: CommandRegistry): void {
  for (const [type, schema] of Object.entries(COMMAND_PAYLOAD_SCHEMAS)) {
    const definition = registry.get(type)
    if (definition && !definition.schemaBound) registry.bindSchema(type, schema)
  }
}

/** Binds a reference handler to every catalogue command without a handler. */
export function bindReferenceHandlers(registry: CommandRegistry): void {
  for (const [type, spec] of Object.entries(REFERENCE_SPECS)) {
    if (!registry.has(type) || registry.handler(type)) continue
    const { op, event } = typeof spec === 'function' ? { op: spec, event: undefined } : spec
    registry.bind(type, referenceHandler(type, op, { now: () => runtime.now(), backendFor: referenceBackendFor, verb: registry.get(type)!.verb, ...(event ? { eventType: event } : {}) }))
  }
}
