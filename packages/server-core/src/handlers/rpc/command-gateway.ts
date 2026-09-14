/**
 * Command Gateway phase-0 RPC handlers (RX-DOC-0032, RX-TSK-0407).
 *
 * Owner-only surface over the restart-safe pending-command store:
 * list/approve/deny, each scoped to the caller's workspace exactly like the
 * OpenClaw security handlers. Command creation is internal-only — executors
 * (TaskRunner / messaging inbox) call the store directly, never via RPC.
 */

import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, RequestContext } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcCommandGatewayActResult,
  rpcCommandGatewayListResult,
  rpcCommandGatewayReadResult,
} from '@craft-agent/core/rox2'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/

function invalidRequest(): never {
  throw new CodedError('INVALID_REF', 'Invalid command gateway request')
}

function parseWorkspaceInput(value: unknown): { workspaceId: string } {
  if (
    typeof value !== 'object' || value === null ||
    new Set(Object.keys(value)).size !== 1 ||
    typeof (value as { workspaceId?: unknown }).workspaceId !== 'string' ||
    !WORKSPACE_ID_PATTERN.test((value as { workspaceId: string }).workspaceId)
  ) {
    invalidRequest()
  }
  return { workspaceId: (value as { workspaceId: string }).workspaceId }
}

function authorizeWorkspace<T extends { workspaceId: string }>(
  context: RequestContext,
  deps: HandlerDeps,
  input: T,
): T {
  const callerWorkspaceId =
    context.workspaceId ??
    (context.webContentsId === null
      ? undefined
      : deps.windowManager?.getWorkspaceForWindow(context.webContentsId) ?? undefined)
  if (
    typeof callerWorkspaceId !== 'string' ||
    !WORKSPACE_ID_PATTERN.test(callerWorkspaceId) ||
    callerWorkspaceId !== input.workspaceId
  ) {
    invalidRequest()
  }
  return input
}

function requireStore(deps: HandlerDeps): NonNullable<HandlerDeps['commandGateway']> {
  const store = deps.commandGateway
  if (!store) {
    throw new CodedError(
      'UNSUPPORTED_OPERATION',
      'Command Gateway is not available on this host',
    )
  }
  return store
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.commandGateway.LIST,
  RPC_CHANNELS.commandGateway.APPROVE,
  RPC_CHANNELS.commandGateway.DENY,
] as const

export function registerCommandGatewayHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.commandGateway.LIST, async (context, rawInput: unknown) => {
    const listed = rpcCommandGatewayListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    return requireStore(deps).listPending(input.workspaceId)
  })

  server.handle(RPC_CHANNELS.commandGateway.APPROVE, async (context, rawInput: unknown) => {
    const input = parseAndAuthorizeDecision(context, deps, rawInput)
    const read = rpcCommandGatewayReadResult({ source: 'native', nativeId: input.id })
    if (!isClaimableLive(read.result)) invalidRequest()
    const act = rpcCommandGatewayActResult({ source: 'native', action: 'write', nativeId: input.id })
    if (!isClaimableLive(act)) invalidRequest()
    const cmd = requireStore(deps).decide(
      input.id,
      input.workspaceId,
      'approved',
      'owner',
    )
    if (!cmd) invalidRequest()
    return { ok: true as const }
  })

  server.handle(RPC_CHANNELS.commandGateway.DENY, async (context, rawInput: unknown) => {
    const input = parseAndAuthorizeDecision(context, deps, rawInput)
    const read = rpcCommandGatewayReadResult({ source: 'native', nativeId: input.id })
    if (!isClaimableLive(read.result)) invalidRequest()
    const act = rpcCommandGatewayActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: input.id,
    })
    if (!isClaimableLive(act)) invalidRequest()
    const cmd = requireStore(deps).decide(input.id, input.workspaceId, 'denied', 'owner')
    if (!cmd) invalidRequest()
    return { ok: true as const }
  })
}

function parseAndAuthorizeDecision(
  context: RequestContext,
  deps: HandlerDeps,
  rawInput: unknown,
): { workspaceId: string; id: string } {
  if (
    typeof rawInput !== 'object' || rawInput === null ||
    typeof (rawInput as { workspaceId?: unknown }).workspaceId !== 'string' ||
    typeof (rawInput as { id?: unknown }).id !== 'string' ||
    !(rawInput as { id: string }).id.startsWith('cmd-') ||
    !WORKSPACE_ID_PATTERN.test((rawInput as { workspaceId: string }).workspaceId)
  ) {
    invalidRequest()
  }
  return authorizeWorkspace(context, deps, rawInput as { workspaceId: string; id: string })
}
