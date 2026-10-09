/**
 * W1-12 (#1509) — Workspace rule host ports.
 *
 * The workspace authority answers the rule engine from the real tables:
 * - General chat: `workspace.general_chat_id` (D-v2-2);
 * - personal agent: `agent_binding` (W1-11 owns provisioning; the binding row
 *   may already exist, otherwise the deterministic id is used so R3's
 *   `agents.provision_personal_agent` step and the welcome step agree);
 * - agent DM: `agent_binding.dm_chat_id` when known, else the deterministic
 *   p2p chat id (mirrors the W1-06 reference handler until MSG-1 owns chats);
 * - display name: `user_profile.display_name`.
 */

import type { SQL } from 'bun'
import type { EntityRef } from '@rox/core/entities'
import { defaultRuleSettings, type RuleId, type RuleSettings } from '@rox/core/automation'
import { deterministicId } from '../../../../../packages/server-core/src/work/reference/engine.ts'
import type { RuleEngineHost, RuleScheduler } from '../../../../../packages/server-core/src/rules/engine.ts'
import { mergeParams } from '../../../../../packages/server-core/src/rules/host.ts'
import type { RuleExecutionStore, RuleSettingsRow, RuleSettingsStore } from '../../../../../packages/server-core/src/rules/store.ts'

export interface WorkspaceRuleHostOptions {
  workspaceId: string
  database: SQL
  schema: string
  executions: RuleExecutionStore
  settingsStore: RuleSettingsStore
  dispatch: RuleEngineHost['dispatch']
  isFlagEnabled: (flag: string) => boolean
  now?: () => Date
  scheduler?: RuleScheduler
  onExecution?: RuleEngineHost['onExecution']
  onError?: RuleEngineHost['onError']
  newExecutionId?: () => string
}

/** `agent_binding.agent_principal_id` when bound, else the deterministic id R3 provisions at. */
export function workspaceAgentId(workspaceId: string, ownerId: string): string {
  return deterministicId(workspaceId, 'agent', ownerId)
}

export function workspaceP2pChatId(workspaceId: string, a: string, b: string): string {
  return deterministicId(workspaceId, 'p2p', ...[a, b].sort())
}

export function createWorkspaceRuleHost(options: WorkspaceRuleHostOptions): RuleEngineHost {
  const prefix = `"${options.schema.replaceAll('"', '""')}".`
  const query = async <T>(text: string, values: unknown[]): Promise<T[]> => options.database.unsafe<T[]>(text, values)

  const settings = async (ruleId: RuleId, principalId?: string | null): Promise<RuleSettings> => {
    const scoped = principalId ? await options.settingsStore.read(options.workspaceId, ruleId, principalId) : null
    const workspaceRow: RuleSettingsRow | null = await options.settingsStore.read(options.workspaceId, ruleId, null)
    const effective = scoped ?? workspaceRow
    if (!effective) return defaultRuleSettings(ruleId)
    return {
      ruleId,
      enabled: effective.enabled,
      params: mergeParams(workspaceRow?.params ?? {}, effective.params),
      source: scoped ? 'principal' : 'workspace',
    }
  }

  return {
    workspaceId: options.workspaceId,
    executions: options.executions,
    dispatch: options.dispatch,
    authorityHint: 'workspace',
    now: options.now ?? (() => new Date()),
    settings,
    isFlagEnabled: options.isFlagEnabled,
    async generalChatId() {
      const rows = await query<{ general_chat_id: string | null }>(
        `SELECT general_chat_id FROM ${prefix}workspace WHERE workspace_id = $1`, [options.workspaceId],
      )
      return rows[0]?.general_chat_id ?? undefined
    },
    async personalAgent(principalId) {
      const rows = await query<{ agent_principal_id: string; dm_chat_id: string | null }>(
        `SELECT agent_principal_id, dm_chat_id FROM ${prefix}agent_binding
          WHERE workspace_id = $1 AND owner_principal_id = $2 AND status = 'active' LIMIT 1`,
        [options.workspaceId, principalId],
      )
      const bound = rows[0]?.agent_principal_id
      // STUB(#1508): before W1-11 provisions the binding, R3 still needs the id
      // its own provisioning step will create the agent at.
      return bound ?? workspaceAgentId(options.workspaceId, principalId)
    },
    async directChatRef(subjectPrincipalId, peerPrincipalId) {
      const rows = await query<{ dm_chat_id: string | null }>(
        `SELECT dm_chat_id FROM ${prefix}agent_binding
          WHERE workspace_id = $1 AND agent_principal_id = $2 AND status = 'active' LIMIT 1`,
        [options.workspaceId, peerPrincipalId],
      )
      const dm = rows[0]?.dm_chat_id
      return { kind: 'channel', id: dm ?? workspaceP2pChatId(options.workspaceId, subjectPrincipalId, peerPrincipalId) }
    },
    async displayName(principalId) {
      const rows = await query<{ display_name: string | null }>(
        `SELECT display_name FROM ${prefix}user_profile WHERE principal_id = $1 LIMIT 1`, [principalId],
      )
      return rows[0]?.display_name ?? undefined
    },
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.onExecution ? { onExecution: options.onExecution } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.newExecutionId ? { newExecutionId: options.newExecutionId } : {}),
  }
}

export type { EntityRef }