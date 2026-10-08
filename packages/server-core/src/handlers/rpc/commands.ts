/**
 * W1-03 (#1500) — Command bus RPC handlers.
 *
 * `commands:execute` routes a CommandEnvelope by authority (local executor or
 * the workspace outbox) and answers with a CommandReceipt; `commands:list`
 * is capability discovery. Committed local events are projected and pushed on
 * `commands:event`.
 *
 * Inert when off: gated live by `commands.bus.v1` (default OFF,
 * `CRAFT_FEATURE_COMMAND_BUS` override). While off no store is opened,
 * nothing is written, `execute` answers `rejected/UNAVAILABLE` and `list`
 * answers `{ enabled: false, commands: [] }`.
 */

import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { isCommandBusEnabled } from '@rox/shared/feature-flags'
import type { CommandBusPushEvent } from '@rox/shared/commands'
import {
  rejectedReceipt,
  type Authorizer,
  type CommandActor,
  type CommandCapability,
  type CommandReceipt,
  type CommandRegistry,
  type ExecutionAuthority,
} from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { RequestContext } from '../../transport/types.ts'
import type { HandlerDeps } from '../handler-deps'
import { CommandExecutor } from '../../commands/executor.ts'
import { CommandRouter, type WorkspaceCommandSink } from '../../commands/router.ts'
import { InProcessEventBus } from '../../commands/event-bus.ts'
import { SqliteCommandStore } from '../../commands/local-store.ts'
import { CommandStoreUnavailable, type CommandStore } from '../../commands/store.ts'
import { createWiredCommandRegistry } from '../../commands/registry.ts'
import { getCommandBusFlags } from '../../commands/flags.ts'

export const HANDLED_CHANNELS = [RPC_CHANNELS.commands.EXECUTE, RPC_CHANNELS.commands.LIST] as const

export interface CommandsListResult {
  enabled: boolean
  commands: CommandCapability[]
}

export interface CommandsHandlerRuntime {
  workspaceFor?: (id: string) => { id: string; rootPath: string } | null
  /** Live enabled workbench flags (default: `commands/flags` source + env override). */
  enabledWorkbenchFlags?: ReadonlySet<string> | (() => ReadonlySet<string> | undefined)
  registry?: CommandRegistry
  eventBus?: InProcessEventBus
  /** Store per workspace (default: `<root>/.rox/commands.sqlite`). */
  storeFor?: (workspace: { id: string; rootPath: string }) => CommandStore
  authorizer?: Authorizer
  /** Workspace-authority sink (host wires `WorkspaceCommandSync` when the workspace is shared). */
  workspaceSink?: (workspaceId: string) => WorkspaceCommandSink | null
  resolveTargetAuthority?: (workspaceId: string, ref: EntityRef) => ExecutionAuthority | undefined
}

let sharedRegistry: CommandRegistry | null = null
let sharedBus: InProcessEventBus | null = null

/** Process-wide local registry (`createWiredCommandRegistry`; modules bind via COMMAND_MODULES). */
export function getLocalCommandRegistry(): CommandRegistry {
  sharedRegistry ??= createWiredCommandRegistry({ isFlagEnabled: flag => getCommandBusFlags().has(flag) })
  return sharedRegistry
}

export function getLocalEventBus(): InProcessEventBus {
  sharedBus ??= new InProcessEventBus()
  return sharedBus
}

function actorFor(ctx: RequestContext): CommandActor {
  const principalId = ctx.actor?.principalId ?? ctx.principal?.credentialId ?? 'local'
  return { principalId, kind: ctx.actor ? 'user' : 'system' }
}

export function registerCommandsHandlers(server: RpcServer, _deps: HandlerDeps, runtime: CommandsHandlerRuntime = {}): void {
  const workspaceFor = runtime.workspaceFor ?? (getWorkspaceByNameOrId as (id: string) => { id: string; rootPath: string } | null)
  const flags = (): ReadonlySet<string> | undefined => {
    if (typeof runtime.enabledWorkbenchFlags === 'function') return runtime.enabledWorkbenchFlags()
    return runtime.enabledWorkbenchFlags ?? getCommandBusFlags()
  }
  const enabled = () => isCommandBusEnabled(flags())
  const registry = runtime.registry ?? getLocalCommandRegistry()
  const bus = runtime.eventBus ?? getLocalEventBus()
  const storeFor = runtime.storeFor ?? (workspace => new SqliteCommandStore({ workspaceRoot: workspace.rootPath }))
  const routers = new Map<string, { router: CommandRouter; store: CommandStore }>()

  const unsubscribe = bus.subscribe((workspaceId, frame) => {
    const event: CommandBusPushEvent = { kind: 'realtime', frame }
    pushTyped(server, RPC_CHANNELS.commands.EVENT, { to: 'workspace', workspaceId }, workspaceId, event)
  })
  server.onShutdown?.(() => {
    unsubscribe()
    for (const { store } of routers.values()) {
      try { void store.close?.() } catch { /* best effort */ }
    }
    routers.clear()
  })

  const requireWorkspace = (ctx: RequestContext, workspaceId: unknown): { id: string; rootPath: string } => {
    if (typeof workspaceId !== 'string' || !workspaceId) throw new CodedError('INVALID_PAYLOAD', 'workspaceId required')
    if (ctx.principal && workspaceId !== ctx.workspaceId) throw new CodedError('FORBIDDEN', 'Command workspace access denied')
    const workspace = workspaceFor(workspaceId)
    if (!workspace) throw new CodedError('NOT_FOUND', 'Workspace not found')
    return workspace
  }

  const routerFor = (workspace: { id: string; rootPath: string }): CommandRouter => {
    let entry = routers.get(workspace.id)
    if (!entry) {
      const store = storeFor(workspace)
      const local = new CommandExecutor({
        registry,
        store,
        authority: 'local',
        isEnabled: enabled,
        publish: events => { bus.publish(events) },
        ...(runtime.authorizer ? { authorizer: runtime.authorizer } : {}),
      })
      const router = new CommandRouter({
        registry,
        local,
        isEnabled: enabled,
        ...(runtime.workspaceSink ? { workspaceSink: runtime.workspaceSink } : {}),
        ...(runtime.resolveTargetAuthority ? { resolveTargetAuthority: runtime.resolveTargetAuthority } : {}),
      })
      entry = { router, store }
      routers.set(workspace.id, entry)
    }
    return entry.router
  }

  server.handle(RPC_CHANNELS.commands.EXECUTE, async (ctx, workspaceId: unknown, envelope: unknown): Promise<CommandReceipt> => {
    if (!enabled()) {
      const id = envelope && typeof envelope === 'object' ? (envelope as { commandId?: unknown }).commandId : undefined
      return rejectedReceipt(typeof id === 'string' && id.length <= 256 ? id : '', 'UNAVAILABLE', 'Command bus is disabled')
    }
    const workspace = requireWorkspace(ctx, workspaceId)
    try {
      return await routerFor(workspace).route({ workspaceId: workspace.id, actor: actorFor(ctx), envelope })
    } catch (error) {
      // Nothing was committed: a retryable RPC error, never a terminal receipt.
      if (error instanceof CommandStoreUnavailable) throw new CodedError('HANDLER_ERROR', 'Command store unavailable; nothing was committed, retry')
      throw error
    }
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.commands.LIST, async (ctx, workspaceId: unknown): Promise<CommandsListResult> => {
    if (!enabled()) return { enabled: false, commands: [] }
    requireWorkspace(ctx, workspaceId)
    return { enabled: true, commands: registry.capabilities() }
  }, { nativeAction: 'read' })
}
