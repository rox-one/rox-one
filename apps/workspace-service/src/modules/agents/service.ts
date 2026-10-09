/**
 * W1-11 (#1508) — The workspace authority's agent-governance composition.
 *
 * The command bus is W1-03's; this module supplies what the governance
 * pipeline needs on the server:
 * - the **audit writer** over `audit_log` (`./audit-log.ts`);
 * - the governance and identity stores. Until the wave-2 modules replace them
 *   with their own repositories, the reference in-memory stores are used, so
 *   the pipeline, the approvals and the reference handlers run end to end;
 * - the **authorizer**: the workspace ACL engine (W1-04) when the host passes
 *   one, otherwise the member shim the rest of the service already uses;
 * - `isEnabled()` from the live workbench flags (`agents.autonomy.v1`).
 *
 * `install()` puts the chain on the executor in the pipeline's order; the two
 * callbacks a host owns are `permissionMode` (the owner's session mode) and
 * `actionContext` (the chat / list / calendar a command happens in).
 */

import type { SQL } from 'bun'
import type { Authorizer } from '@rox/core/commands'
import type { CommandExecutor } from '../../../../../packages/server-core/src/commands/executor.ts'
import { isAgentsAutonomyEnabled, isIdentityPlaceholdersEnabled } from '@rox/shared/feature-flags'
import { installAgentsGovernance, type InstallAgentsGovernanceOptions } from '../../../../../packages/server-core/src/agents/governance-install.ts'
import {
  configureAgentsRuntime,
  createAgentsRuntime,
  type AgentInvocationPort,
  type AgentsRuntime,
  type ApprovedCommandDispatchPort,
} from '../../../../../packages/server-core/src/agents/runtime.ts'
import { InMemoryGovernanceStore, InMemoryIdentityStore } from '../../../../../packages/server-core/src/agents/store.ts'
import { PostgresAuditLog, auditWriterOf } from './audit-log.ts'
import { WORKSPACE_MEMBER_AUTHORIZER, type WorkspaceAuthorizer } from '../commands/authorizer.ts'

/** Live workbench flags of the running service. */
export type WorkspaceFlagSource = () => ReadonlySet<string> | undefined

export interface CreateWorkspaceAgentsServiceOptions {
  database: SQL
  schema?: string
  /** Live flags; `agents.autonomy.v1` decides whether the pipeline runs. */
  flags?: WorkspaceFlagSource
  /** ACL engine for step 4; the member shim by default (host wires W1-04's). */
  authorizer?: WorkspaceAuthorizer | Authorizer
  /** §13.1: the existing runtime a `agents.invoke` hands off to. */
  invocation?: AgentInvocationPort
  /** §13.3: the executor an approved request is replayed through. */
  dispatchApproved?: ApprovedCommandDispatchPort
  governance?: InMemoryGovernanceStore
  identity?: InMemoryIdentityStore
  now?: () => Date
  newId?: () => string
}

export interface WorkspaceAgentsService {
  readonly runtime: AgentsRuntime
  readonly audit: PostgresAuditLog
  /** Install the pipeline on this service's executor. */
  install(executor: CommandExecutor, options?: InstallCallbacks): CommandExecutor
  /** Publish the runtime as the process runtime for the shared handlers. */
  configure(): void
  /** Flags of this service. */
  isEnabled(): boolean
  placeholdersEnabled(): boolean
}

export interface InstallCallbacks {
  permissionMode?: InstallAgentsGovernanceOptions['permissionMode']
  actionContext?: InstallAgentsGovernanceOptions['actionContext']
  transport?: string
  onError?: (error: unknown) => void
}

export function createWorkspaceAgentsService(options: CreateWorkspaceAgentsServiceOptions): WorkspaceAgentsService {
  const audit = new PostgresAuditLog(options.schema ? { database: options.database, schema: options.schema } : { database: options.database })
  const flags: WorkspaceFlagSource = options.flags ?? (() => undefined)
  const runtime = createAgentsRuntime({
    audit: auditWriterOf(audit),
    governance: options.governance ?? new InMemoryGovernanceStore(),
    identity: options.identity ?? new InMemoryIdentityStore(),
    authorizer: options.authorizer ?? WORKSPACE_MEMBER_AUTHORIZER,
    ...(options.invocation ? { invocation: options.invocation } : {}),
    ...(options.dispatchApproved ? { dispatchApproved: options.dispatchApproved } : {}),
    isEnabled: () => isAgentsAutonomyEnabled(flags()),
    ...(options.now ? { now: options.now } : {}),
    ...(options.newId ? { newId: options.newId } : {}),
  })
  return {
    runtime,
    audit,
    isEnabled: () => isAgentsAutonomyEnabled(flags()),
    placeholdersEnabled: () => isIdentityPlaceholdersEnabled(flags()),
    configure() {
      configureAgentsRuntime(runtime)
    },
    install(executor, callbacks = {}) {
      return installAgentsGovernance(executor, {
        runtime,
        isEnabled: () => isAgentsAutonomyEnabled(flags()),
        ...(callbacks.permissionMode ? { permissionMode: callbacks.permissionMode } : {}),
        ...(callbacks.actionContext ? { actionContext: callbacks.actionContext } : {}),
        transport: callbacks.transport ?? 'http',
        ...(callbacks.onError ? { onError: callbacks.onError } : {}),
      })
    },
  }
}