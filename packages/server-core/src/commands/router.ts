/**
 * W1-03 (#1500) — Local command router (TECH-SPEC §1 rule 1).
 *
 * authority `local` → the local executor (workspace-local SQLite).
 * authority `workspace` → the client outbox (`queued` receipt; the workspace
 * service answers later with the terminal receipt). Without a workspace
 * connection: SERVER_REQUIRED.
 * authority `by-target` → the target's authority (`resolveTargetAuthority`),
 * else `authorityHint`, else local.
 *
 * Client-side checks before queueing (the server re-checks everything):
 * envelope shape, unknown command, payload size and bound schemas.
 */

import {
  DEFAULT_MAX_COMMAND_PAYLOAD_BYTES,
  MAX_COMMAND_PAYLOAD_BYTES,
  payloadByteLength,
  rejectedReceipt,
  type CommandActor,
  type CommandEnvelope,
  type CommandReceipt,
  type CommandRegistry,
  type ExecutionAuthority,
} from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { decodeCommandEnvelope } from '@rox/shared/commands/schemas'
import type { CommandExecutor } from './executor'

/** Where workspace-authority commands go (implemented by `WorkspaceCommandSync`). */
export interface WorkspaceCommandSink {
  enqueue(workspaceId: string, envelope: CommandEnvelope): Promise<CommandReceipt>
}

export interface CommandRouterOptions {
  registry: CommandRegistry
  local: CommandExecutor
  /** Per-workspace sink; `null` → the workspace has no shared authority. */
  workspaceSink?: (workspaceId: string) => WorkspaceCommandSink | null
  /** Which authority owns a target ref (`undefined` → hint / local). */
  resolveTargetAuthority?: (workspaceId: string, ref: EntityRef) => ExecutionAuthority | undefined
  isEnabled?: () => boolean
}

export class CommandRouter {
  constructor(private readonly options: CommandRouterOptions) {}

  /** Which authority would execute this envelope (exposed for tests and diagnostics). */
  resolveAuthority(workspaceId: string, envelope: CommandEnvelope): ExecutionAuthority | null {
    const definition = this.options.registry.get(envelope.type)
    if (!definition) return null
    if (definition.authority === 'local' || definition.authority === 'workspace') return definition.authority
    if (envelope.target) {
      const owner = this.options.resolveTargetAuthority?.(workspaceId, envelope.target)
      if (owner) return owner
    }
    return envelope.authorityHint ?? 'local'
  }

  async route(input: { workspaceId: string; actor: CommandActor; envelope: unknown }): Promise<CommandReceipt> {
    if (this.options.isEnabled && !this.options.isEnabled()) {
      return rejectedReceipt(commandIdOf(input.envelope), 'UNAVAILABLE', 'Command bus is disabled')
    }
    const decoded = decodeCommandEnvelope(input.envelope)
    // Invalid / unknown envelopes get their exact rejection from the executor.
    if (!decoded.ok || !this.options.registry.has(decoded.value.type)) return this.options.local.execute(input)
    const envelope = decoded.value
    const authority = this.resolveAuthority(input.workspaceId, envelope)
    if (authority !== 'workspace') return this.options.local.execute({ ...input, envelope })

    const sink = this.options.workspaceSink?.(input.workspaceId) ?? null
    if (!sink) return rejectedReceipt(envelope.commandId, 'SERVER_REQUIRED', `${envelope.type} needs a workspace connection`)
    const definition = this.options.registry.get(envelope.type)!
    const limit = Math.min(definition.maxPayloadBytes ?? DEFAULT_MAX_COMMAND_PAYLOAD_BYTES, MAX_COMMAND_PAYLOAD_BYTES)
    if (payloadByteLength(envelope.payload) > limit) {
      return rejectedReceipt(envelope.commandId, 'PAYLOAD_TOO_LARGE', `Payload exceeds ${limit} bytes`, { limit })
    }
    if (definition.schemaBound && !definition.schema.safeParse(envelope.payload).success) {
      return rejectedReceipt(envelope.commandId, 'VALIDATION', 'Invalid payload')
    }
    return sink.enqueue(input.workspaceId, envelope)
  }
}

function commandIdOf(raw: unknown): string {
  const id = raw && typeof raw === 'object' ? (raw as { commandId?: unknown }).commandId : undefined
  return typeof id === 'string' && id.length <= 256 ? id : ''
}
