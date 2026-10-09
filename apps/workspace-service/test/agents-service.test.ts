/**
 * W1-11 (#1508) — The workspace authority's agents service (no database).
 *
 * Covers what can be asserted without Postgres: the composition (runtime,
 * stores, flag switches) and the middleware the service installs on the command
 * bus. The `audit_log` chain itself is exercised by `agents-audit.pg.test.ts`
 * when a protected test database is configured.
 */

import { describe, expect, it } from 'bun:test'
import { SQL } from 'bun'
import { createCommandEnvelope } from '../../../packages/core/src/commands/index.ts'
import type { CommandReceipt } from '../../../packages/core/src/commands/index.ts'
import { CommandExecutor } from '../../../packages/server-core/src/commands/executor.ts'
import { InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { createWiredCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import { createWorkspaceAgentsService } from '../src/modules/agents/service.ts'
import { AGENTS_COMMAND_MODULE } from '../../../packages/server-core/src/agents/module.ts'
import { getAgentsRuntime } from '../../../packages/server-core/src/agents/runtime.ts'

/** A `SQL` double: the service only builds statements, it does not run them here. */
function unusedSql(): SQL {
  return new SQL({ url: 'postgres://rox:rox@127.0.0.1:1/rox', max: 1, connectionTimeout: 1 })
}

describe('workspace agents service', () => {
  it('composes a runtime from the injected stores and the live flags', async () => {
    const sql = unusedSql()
    const flags = new Set<string>()
    const service = createWorkspaceAgentsService({ database: sql, flags: () => flags })
    try {
      expect(service.isEnabled()).toBe(false)
      expect(service.placeholdersEnabled()).toBe(false)
      flags.add('agents.autonomy.v1')
      expect(service.isEnabled()).toBe(true)
      expect(service.placeholdersEnabled()).toBe(false)
      flags.add('identity.placeholders.v1')
      expect(service.placeholdersEnabled()).toBe(true)
      // The runtime shares the service's stores, so a handler sees what the
      // governance pipeline wrote.
      expect(service.runtime.governance).toBeDefined()
      expect(service.runtime.identity).toBeDefined()
      service.configure()
      expect(getAgentsRuntime()).toBe(service.runtime)
    } finally {
      await sql.close({ timeout: 1 }).catch(() => {})
    }
  })

  it('installs the four governance middleware in pipeline order on the executor', async () => {
    const sql = unusedSql()
    const service = createWorkspaceAgentsService({ database: sql, flags: () => new Set(['agents.autonomy.v1']) })
    try {
      const registry = createWiredCommandRegistry({ isFlagEnabled: () => true })
      const executor = new CommandExecutor({ registry, store: new InMemoryCommandStore(), authority: 'workspace' })
      service.install(executor)
      expect(executor.middlewareNames()).toEqual(['agent-audit', 'agent-policy', 'agent-rate-limit', 'agent-approval-gate'])
    } finally {
      await sql.close({ timeout: 1 }).catch(() => {})
    }
  })

  it('a human command still runs while the autonomy flag is off', async () => {
    const sql = unusedSql()
    const service = createWorkspaceAgentsService({ database: sql, flags: () => new Set() })
    try {
      const registry = createWiredCommandRegistry({ isFlagEnabled: flag => flag === 'identity.placeholders.v1' || flag === 'workbench.mode.messenger.v1' })
      const executor = service.install(new CommandExecutor({ registry, store: new InMemoryCommandStore(), authority: 'workspace' }))
      const receipt = await executor.execute({
        workspaceId: 'ws-1',
        actor: { principalId: 'owner-1', kind: 'user' },
        envelope: createCommandEnvelope('system.ping', { nonce: 'n1' }),
      })
      expect(receipt).toMatchObject({ status: 'applied' })
      expect((receipt.result as { authority: string }).authority).toBe('workspace')
    } finally {
      await sql.close({ timeout: 1 }).catch(() => {})
    }
  })

  it('the module binds the schemas and handlers the workspace service executes', () => {
    const registry = createWiredCommandRegistry({ isFlagEnabled: () => true })
    for (const type of [
      'workspaces.create', 'people.invite', 'identity.ensure_placeholder', 'identity.activate_placeholder', 'identity.merge_placeholder',
      'im.create_chat', 'im.join_chat', 'im.leave_chat', 'im.set_visibility', 'im.browse_public_chats',
      'agents.provision_personal_agent', 'agents.invoke', 'agents.decide_approval', 'agents.pause',
    ]) {
      expect(registry.handler(type), type).toBeDefined()
      expect(registry.get(type)?.schemaBound, type).toBe(true)
      expect(typeof registry.get(type)?.riskClass, type).toBe('function')
    }
    expect(AGENTS_COMMAND_MODULE.name).toBe('agents')
    expect(registry.capabilities().find(capability => capability.type === 'agents.invoke')?.available).toBe(true)
  })

  it('an agent envelope without the flag never reaches a hand-off', async () => {
    const sql = unusedSql()
    const service = createWorkspaceAgentsService({ database: sql, flags: () => new Set() })
    try {
      const registry = createWiredCommandRegistry({ isFlagEnabled: flag => flag !== 'agents.autonomy.v1' })
      const executor = service.install(new CommandExecutor({ registry, store: new InMemoryCommandStore(), authority: 'workspace' }))
      const receipt: CommandReceipt = await executor.execute({
        workspaceId: 'ws-1',
        actor: { principalId: 'owner-1', kind: 'user' },
        envelope: createCommandEnvelope('agents.invoke', { workspaceId: 'ws-1', agentPrincipalId: 'a', ownerPrincipalId: 'owner-1', instruction: 'x', provenance: { trigger: 'mention' } }, { onBehalfOf: 'a' }),
      })
      expect(receipt.status).toBe('rejected')
      // The catalogue flag makes the command unavailable before the pipeline runs.
      expect(receipt.error?.code).toBe('UNAVAILABLE')
    } finally {
      await sql.close({ timeout: 1 }).catch(() => {})
    }
  })
})