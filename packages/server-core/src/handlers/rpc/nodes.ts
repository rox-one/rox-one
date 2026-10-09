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

function parseDeclaration(rawInput: unknown): NodeDeclaration {
  const input = asRecord(rawInput, 'declaration')
  return {
    nodeId: requireString(input.nodeId, 'nodeId'),
    declaredCaps: optionalStringArray(input.declaredCaps, 'declaredCaps'),
    declaredCommands: optionalStringArray(input.declaredCommands, 'declaredCommands'),
    kind: optionalString(input.kind, 'kind'),
    platform: optionalString(input.platform, 'platform'),
    label: optionalString(input.label, 'label'),
    connId: optionalString(input.connId, 'connId'),
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
  server.handle(RPC_CHANNELS.nodes.REGISTER, (_context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    const node = registry.registerNode(parseDeclaration(rawInput))
    server.push(RPC_CHANNELS.nodes.CHANGED, { to: 'all' }, { reason: 'registered', nodeId: node.nodeId })
    return registry.listNodes().find((view) => view.nodeId === node.nodeId) ?? null
  })

  server.handle(RPC_CHANNELS.nodes.LIST, () => requireRegistry(deps).listNodes())

  server.handle(RPC_CHANNELS.nodes.PRESENCE, (_context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    const nodeId = requireString(asRecord(rawInput, 'presence').nodeId, 'nodeId')
    if (!registry.getNode(nodeId)) throw new CodedError('NOT_FOUND', `unknown node ${nodeId}`)
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
      if (dispatch.accepted) {
        server.push(RPC_CHANNELS.nodes.INVOKE, { to: 'all' }, {
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

  server.handle(RPC_CHANNELS.nodes.INVOKE_RESULT, (_context: RequestContext, rawInput: unknown) => {
    const registry = requireRegistry(deps)
    const input = asRecord(rawInput, 'invokeResult')
    const invokeId = requireString(input.invokeId, 'invokeId')
    const settled = input.error === undefined
      ? registry.settleInvoke(invokeId, input.payload)
      : registry.failInvoke(invokeId, normalizeError(input.error))
    if (!settled) throw new CodedError('NOT_FOUND', `invoke ${invokeId} is not pending`)
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