/**
 * W1-11 (#1508) — Installing the governance pipeline on a command executor.
 *
 * One call, used by both authorities:
 *
 * ```ts
 * const runtime = createAgentsRuntime({ isEnabled: () => isAgentsAutonomyEnabled(flags) })
 * configureAgentsRuntime(runtime)
 * installAgentsGovernance(executor, { runtime, isEnabled: runtime.isEnabled })
 * ```
 *
 * The chain order is the pipeline's order (audit wraps everything; see
 * `@rox/core/commands/middleware`). The remaining wiring a host owns:
 * - `permissionMode(ctx)`: the acting owner's session `PermissionMode`
 *   (`ask` by default) — TECH-SPEC §13.2 maps it onto the approval policy;
 * - `actionContext(ctx)`: the chat / list / calendar the command happens in,
 *   plus whether it is the owner's own DM with its agent.
 */

import { createHash } from 'node:crypto'
import type { CommandExecutor } from '../commands/executor.ts'
import type { CommandMiddleware, CommandPipelineContext } from '@rox/core/commands'
import {
  createAgentGovernanceChain,
  type ActionContext,
  type AuditWriter,
  type PolicyGovernanceDeps,
} from '@rox/core/commands'
import type { AgentPermissionMode } from '@rox/core/agents'
import { agentSubject, policyPortsFor, type AgentsRuntime } from './runtime.ts'

export interface InstallAgentsGovernanceOptions {
  runtime: AgentsRuntime
  /** `agents.autonomy.v1`; defaults to the runtime's own switch. */
  isEnabled?: () => boolean
  /** The acting owner's session permission mode (`ask` by default). */
  permissionMode?: (ctx: CommandPipelineContext) => AgentPermissionMode
  /** Chat / list / calendar metadata for grants and standing approvals. */
  actionContext?: (ctx: CommandPipelineContext) => ActionContext
  /** `request_hash` of the envelope; defaults to the executor's own hash. */
  requestHash?: (ctx: CommandPipelineContext) => string
  /** Where the command entered the system (`ws-rpc`, `http`, `local`). */
  transport?: string
  onError?: (error: unknown) => void
}

/**
 * The middleware chain, in installation order. Exported separately so a host
 * that builds its own executor (or a test) can compose it directly.
 */
export function agentsGovernanceChain(options: InstallAgentsGovernanceOptions): CommandMiddleware[] {
  const { runtime } = options
  const audit: AuditWriter = runtime.audit
  const policy: PolicyGovernanceDeps = {
    isEnabled: options.isEnabled ?? runtime.isEnabled,
    now: () => runtime.now(),
    ports: policyPortsFor(runtime),
    permissionMode: options.permissionMode ?? (() => 'ask'),
    actionContext: options.actionContext ?? (() => ({})),
  }
  return createAgentGovernanceChain({
    policy,
    audit: {
      isEnabled: options.isEnabled ?? runtime.isEnabled,
      now: () => runtime.now(),
      writer: audit,
      requestHash: options.requestHash ?? (ctx => stableRequestHash(ctx)),
      ...(options.transport ? { transport: () => options.transport } : {}),
      newAuditId: () => runtime.newId(),
    },
  })
}

/**
 * A stable `request_hash` for the audit row when the host does not pass the
 * executor's own hash. The cost is a JSON stringify per governed command; the
 * server passes its real hash (`hashCommandRequest`) instead.
 */
function stableRequestHash(ctx: CommandPipelineContext): string {
  const input = [ctx.envelope.commandId, ctx.envelope.type, JSON.stringify(ctx.envelope.payload ?? null), ctx.envelope.onBehalfOf ?? ''].join('\u0000')
  return createHash('sha256').update(input).digest('hex')
}

/** Install the chain on an executor, in order. Returns the same executor. */
export function installAgentsGovernance(executor: CommandExecutor, options: InstallAgentsGovernanceOptions): CommandExecutor {
  for (const middleware of agentsGovernanceChain(options)) {
    try {
      executor.use(middleware)
    } catch (error) {
      options.onError?.(error)
    }
  }
  return executor
}

/** The bucket subject an agent spends from, for logs and diagnostics. */
export { agentSubject }