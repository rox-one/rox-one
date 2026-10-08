/**
 * W1-03 (#1500) — Typed client contract (PLAN §1.1: envelope, registry, client).
 *
 * Renderer-side and agent-side callers dispatch through this interface; the
 * transport is `commands:execute` / `commands:list` (WS-RPC) locally and
 * `POST|GET /v1/workspaces/{ws}/commands` against the workspace service.
 */

import { createCommandEnvelope, type CommandEnvelope, type CommandType, type CreateCommandEnvelopeOptions } from './envelope.ts'
import type { CommandReceipt } from './receipt.ts'
import type { CommandCapability } from './registry.ts'

export interface CommandClient {
  execute(workspaceId: string, envelope: CommandEnvelope): Promise<CommandReceipt>
  list(workspaceId: string): Promise<CommandCapability[]>
}

/** Build an envelope and dispatch it in one call. */
export function dispatchCommand<P>(
  client: CommandClient,
  workspaceId: string,
  type: CommandType,
  payload: P,
  options?: CreateCommandEnvelopeOptions,
): Promise<CommandReceipt> {
  return client.execute(workspaceId, createCommandEnvelope(type, payload, options))
}
