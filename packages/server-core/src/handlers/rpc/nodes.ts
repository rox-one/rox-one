/**
 * f.9 — node/device RPC handlers.
 *
 * Thin transport over the server-owned `NodeRegistry`. The registry (not the
 * handler) is where the claims-vs-allowlist invariant lives: `nodes:invoke`
 * never dispatches a command the server has not allowlisted for that node, and
 * a refused dispatch resolves immediately with a typed terminal error.
 *
 * `nodes:invoke` blocks until the node reports a terminal result (or the
 * explicit deadline elapses and the registry settles `timeout`), so the RPC
 * answers with the same `ok | error | timeout` union the registry produces.
 *
 * Fencing: the connection identity is always the server-minted
 * `context.clientId` — never a payload field. Registration records it, the
 * invoke push is addressed to it (`{ to: 'client' }`, never a broadcast), and
 * `nodes:invokeResult` / `nodes:presence` presented by a different connection
 * are refused `NODE_CONNECTION_MISMATCH` without settling the invoke.
 */

import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer, RequestContext } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import type { NodeDeclaration, NodeRegistry } from '../../nodes'

/** Upper bound for a single invoke; kept below the handler's own timeout. */
const MAX_INVOKE_TIMEOUT_MS = 110_000
const INVOKE_HANDLER_TIMEOUT_MS = 120_000

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.nodes.REGISTER,
  RPC_CHANNELS.nodes.LIST,
  RPC_CHANNELS.nodes.PRESENCE,
  RPC_CHANNELS.nodes.INVOKE,
  RPC_CHANNELS.nodes.INVOKE_RESULT,
  RPC_CHANNELS.nodes.INVOKE_CANCEL,
] as const

function invalid(message: string): never {
  throw new CodedError('INVALID_PAYLOAD', message)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(`${what} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') invalid(`${what} must be a string`)
  return value
}

function optionalStringArray(value: unknown, what: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    invalid(`${what} must be an array of strings`)
  }
  return value as string[]
}

/**
 * Parse a node declaration. The connection identity is NOT taken from the
 * payload: `context.clientId` is server-minted, so a client cannot register a
 * node under another connection's identity (see `registerNodeHandlers`).
 */
function parseDeclaration(rawInput: unknown): NodeDeclaration {
  const input = asRecord(rawInput, 'declaration')
  return {
    nodeId: requireString(input.nodeId, 'nodeId'),
    declaredCaps: optionalStringArray(input.declaredCaps, 'declaredCaps'),
    declaredCommands: optionalStringArray(input.declaredCommands, 'declaredCommands'),
    kind: optionalString(input.kind, 'kind'),
    platform: optionalString(input.platform, 'platform'),
    label: optionalString(input.label, 'label'),
  }
}

function requireRegistry(deps: HandlerDeps): NodeRegistry {
  const registry = deps.nodes
  if (!registry) {
    throw new CodedError('UNSUPPORTED_OPERATION', 'Node registry is not available on this host')
  }
  return registry
}

export function registerNodeHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.nodes.REGISTER, (context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    // Server-minted connection identity: a later registration under a different
    // one supersedes this connection's in-flight invokes (registry fencing).
    const node = registry.registerNode({ ...parseDeclaration(rawInput), connId: context.clientId })
    server.push(RPC_CHANNELS.nodes.CHANGED, { to: 'all' }, { reason: 'registered', nodeId: node.nodeId })
    return registry.listNodes().find((view) => view.nodeId === node.nodeId) ?? null
  })

  server.handle(RPC_CHANNELS.nodes.LIST, () => requireRegistry(deps).listNodes())

  server.handle(RPC_CHANNELS.nodes.PRESENCE, (context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    const nodeId = requireString(asRecord(rawInput, 'presence').nodeId, 'nodeId')
    if (!registry.getNode(nodeId)) throw new CodedError('NOT_FOUND', `unknown node ${nodeId}`)
    // A superseded connection must not keep the node's presence alive.
    if (!registry.ownsNode(nodeId, context.clientId)) {
      throw new CodedError('NODE_CONNECTION_MISMATCH', `connection does not own node ${nodeId}`)
    }
    return registry.touch(nodeId)
  })

  server.handle(
    RPC_CHANNELS.nodes.INVOKE,
    async (_context: RequestContext, rawInput: unknown) => {
      const registry = requireRegistry(deps)
      const input = asRecord(rawInput, 'invoke')
      const nodeId = requireString(input.nodeId, 'nodeId')
      const command = requireString(input.command, 'command')
      const requestedTimeout = input.timeoutMs
      if (requestedTimeout !== undefined && (!Number.isSafeInteger(requestedTimeout) || (requestedTimeout as number) < 1 || (requestedTimeout as number) > MAX_INVOKE_TIMEOUT_MS)) {
        invalid('timeoutMs must be a positive integer within the invoke bound')
      }
      const dispatch = registry.invoke(nodeId, command, requestedTimeout === undefined ? {} : { timeoutMs: requestedTimeout as number })
      if (dispatch.accepted && dispatch.connId === null) {
        // No live connection identity to target: settle typed rather than
        // broadcast the payload to every client (the visibility bug).
        registry.failInvoke(dispatch.invokeId!, {
          code: 'NODE_UNROUTABLE',
          message: `node ${nodeId} has no live connection to receive the invoke`,
        })
      } else if (dispatch.accepted) {
        // Deliver only to the connection that registered the node.
        server.push(RPC_CHANNELS.nodes.INVOKE, { to: 'client', clientId: dispatch.connId! }, {
          invokeId: dispatch.invokeId,
          nodeId,
          command,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        })
      }
      return dispatch.result
    },
    { timeoutMs: INVOKE_HANDLER_TIMEOUT_MS },
  )

  server.handle(RPC_CHANNELS.nodes.INVOKE_RESULT, (context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    const input = asRecord(rawInput, 'invokeResult')
    const invokeId = requireString(input.invokeId, 'invokeId')
    const settlement = input.error === undefined
      ? registry.settleInvokeFrom(invokeId, input.payload, context.clientId)
      : registry.failInvokeFrom(invokeId, normalizeError(input.error), context.clientId)
    if (!settlement.settled) {
      if (settlement.refusal.code === 'CONNECTION_MISMATCH') {
        throw new CodedError('NODE_CONNECTION_MISMATCH', settlement.refusal.message)
      }
      throw new CodedError('NOT_FOUND', settlement.refusal.message)
    }
    return { ok: true as const }
  })

  server.handle(RPC_CHANNELS.nodes.INVOKE_CANCEL, (_context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    const invokeId = requireString(asRecord(rawInput, 'invokeCancel').invokeId, 'invokeId')
    return { cancelled: registry.cancelInvoke(invokeId) }
  })
}

function normalizeError(rawError: unknown): { code: string; message: string } {
  const error = asRecord(rawError, 'error')
  return {
    code: optionalString(error.code, 'error.code') ?? 'NODE_ERROR',
    message: optionalString(error.message, 'error.message') ?? 'node reported an error',
  }
}