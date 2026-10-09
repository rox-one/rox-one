/**
 * W1-11 (#1508) — Test harness: the real command bus with the agent-governance
 * pipeline installed, a JSONL audit log in a temp config dir, and the
 * reference stores.
 *
 * Every test that needs to see a command *as the bus sees it* (receipts,
 * capabilities, the ten-step trace, audit rows) drives it through this
 * harness, so nothing is asserted against a re-implementation of the bus.
 * The temp config dir means the user's `~/rox` is never touched.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCommandEnvelope,
  type Authorizer,
  type CommandActor,
  type CommandEnvelope,
  type CommandOrigin,
  type CommandReceipt,
  type CommandRegistry,
} from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import type { AuditRow } from '@rox/core/agents'
import { createWiredCommandRegistry } from '../../commands/registry.ts'
import { CommandExecutor } from '../../commands/executor.ts'
import { InMemoryCommandStore } from '../../commands/store.ts'
import { JsonlAuditLog } from '../audit-log.ts'
import { agentsGovernanceChain } from '../governance-install.ts'
import { configureAgentsRuntime, createAgentsRuntime, type AgentsRuntime } from '../runtime.ts'

export const WORKSPACE = 'ws-1'

export interface HarnessOptions {
  /** Live workbench flags (module capability discovery). */
  flags?: Set<string>
  /** `agents.autonomy.v1`: governs the middleware and `agents.*` capability. */
  autonomyEnabled?: boolean
  /** Flag the acting owner's session as `ask` | `safe` | `allow-all`. */
  permissionMode?: 'ask' | 'safe' | 'allow-all'
  authorizer?: Authorizer
  now?: () => Date
  /** Fail the audit writer for every append (used by the negative test). */
  auditFailure?: Error
}

export interface RunOptions {
  actor?: CommandActor
  onBehalfOf?: string
  target?: EntityRef
  origin?: CommandOrigin
  commandId?: string
  /** The container the caller claims (chat / list / calendar). */
  container?: string
}

export interface AgentsHarness {
  runtime: AgentsRuntime
  registry: CommandRegistry
  executor: CommandExecutor
  audit: JsonlAuditLog
  configDir: string
  flags: Set<string>
  /** Create the workspace (`ws-1`), its General chat and the owner's admin row. */
  seedWorkspace(options?: { chatCreation?: 'members' | 'admins' }): void
  run(type: string, payload: unknown, options?: RunOptions): Promise<CommandReceipt>
  auditRows(): AuditRow[]
  capabilities(): Array<{ type: string; available: boolean; reason?: string }>
  close(): void
}

const DEFAULT_PERMISSION_MODE = { value: 'ask' as 'ask' | 'safe' | 'allow-all' }

export function createAgentsHarness(options: HarnessOptions = {}): AgentsHarness {
  const configDir = mkdtempSync(join(tmpdir(), 'rox-agents-harness-'))
  // The flags of the modules this package binds, so its commands are
  // available; `agents.autonomy.v1` is the governance switch itself.
  const flags = options.flags ?? new Set<string>([
    ...(options.autonomyEnabled === false ? [] : ['agents.autonomy.v1']),
    'identity.placeholders.v1',
    'workbench.mode.messenger.v1',
    'workbench.mode.contacts.v1',
  ])
  const auditLog = new JsonlAuditLog({ configDir })
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE.value
  const now = options.now ?? (() => new Date('2026-10-08T12:00:00.000Z'))
  const runtime = createAgentsRuntime({
    configDir,
    audit: options.auditFailure
      ? { append: async () => { throw options.auditFailure } }
      : { append: async row => auditLog.append(row) },
    isEnabled: () => options.autonomyEnabled !== false,
    now,
    newId: (() => {
      let counter = 0
      return () => `id-${++counter}`
    })(),
    ...(options.authorizer ? { authorizer: options.authorizer } : {}),
  })
  configureAgentsRuntime(runtime)

  const registry = createWiredCommandRegistry({ isFlagEnabled: flag => flags.has(flag) })
  const executor = new CommandExecutor({
    registry,
    store: new InMemoryCommandStore(),
    authority: 'workspace',
    ...(options.authorizer ? { authorizer: options.authorizer } : {}),
    now,
  })
  for (const middleware of agentsGovernanceChain({
    runtime,
    isEnabled: () => options.autonomyEnabled !== false,
    permissionMode: () => permissionMode,
    actionContext: ctx => (ctx.envelope.target?.kind === 'channel' ? { container: `channel:${ctx.envelope.target.id}` } : {}),
    transport: 'test',
  })) {
    executor.use(middleware)
  }

  return {
    runtime,
    registry,
    executor,
    audit: auditLog,
    configDir,
    flags,
    seedWorkspace(seedOptions = {}) {
      const chatId = `${WORKSPACE}-general`
      runtime.identity.createWorkspace({
        workspaceId: WORKSPACE,
        name: 'Rox',
        slug: 'rox',
        generalChatId: chatId,
        chatCreation: seedOptions.chatCreation ?? 'members',
        createdBy: 'owner-1',
        createdAt: '2026-10-08T12:00:00.000Z',
      })
      runtime.identity.createChat({
        chatId,
        workspaceId: WORKSPACE,
        kind: 'group',
        visibility: 'public',
        systemRole: 'general',
        name: 'Rox',
        createdBy: 'owner-1',
        archivedAt: null,
        postingPolicy: 'all',
        invitePolicy: 'members',
      })
      runtime.identity.upsertMembership({ workspaceId: WORKSPACE, principalId: 'owner-1', role: 'admin', status: 'active', joinedAt: '2026-10-08T12:00:00.000Z' })
      runtime.identity.upsertChatMember({ chatId, principalId: 'owner-1', role: 'owner', state: 'active' })
    },
    async run(type, payload, runOptions = {}) {
      const envelope: CommandEnvelope = createCommandEnvelope(type as `${string}.${string}`, payload, {
        ...(runOptions.commandId ? { commandId: runOptions.commandId } : {}),
        ...(runOptions.target ? { target: runOptions.target } : {}),
        ...(runOptions.origin ? { origin: runOptions.origin } : {}),
        ...(runOptions.onBehalfOf ? { onBehalfOf: runOptions.onBehalfOf } : {}),
      })
      const actor: CommandActor = runOptions.actor ?? { principalId: 'owner-1', kind: 'user' }
      return executor.execute({ workspaceId: WORKSPACE, actor, envelope })
    },
    auditRows() {
      return auditLog.months().flatMap(month => auditLog.read(month))
    },
    capabilities() {
      return registry.capabilities().map(capability => ({
        type: capability.type,
        available: capability.available,
        ...(capability.available ? {} : { reason: capability.reason }),
      }))
    },
    close() {
      configureAgentsRuntime(null)
      rmSync(configDir, { recursive: true, force: true })
    },
  }
}