/**
 * W1-12 (#1509) — Local rule host ports.
 *
 * The local authority has no team directory: personal agents and p2p chats are
 * answered from the local work store where they exist, with deterministic
 * fallbacks that match the W1-06 reference handlers (`work/reference`), so the
 * rules and the handlers agree on exactly one id.
 */

import type { EntityRef } from '@rox/core/entities'
import {
  defaultRuleSettings,
  type RuleId,
  type RuleSettings,
} from '@rox/core/automation'
import { deterministicId } from '../work/reference/engine'
import { collectionSpec } from '../work/reference/collections'
import { LocalWorkStore, type LocalWorkRecord } from '../work/local-work-store'
import type { RuleEngineHost, RuleScheduler } from './engine'
import type { RuleExecutionStore, RuleSettingsRow, RuleSettingsStore } from './store'

/** STUB(#1508): the agent id scheme of the W1-06 reference handler; W1-11 owns the real registry. */
export function localAgentId(workspaceId: string, ownerId: string): string {
  return deterministicId(workspaceId, 'agent', ownerId)
}

/** STUB(#1509 MSG-1): the p2p chat id scheme of `im.get_or_create_p2p` in the reference handler. */
export function localP2pChatId(workspaceId: string, a: string, b: string): string {
  return deterministicId(workspaceId, 'p2p', ...[a, b].sort())
}

/** Params merge: the per-principal row overrides the workspace row key by key. */
export function mergeParams(workspaceParams: Record<string, unknown>, principalParams: Record<string, unknown>): Record<string, unknown> {
  return { ...workspaceParams, ...principalParams }
}

export interface LocalRuleHostOptions {
  workspaceId: string
  workspaceRoot: string
  executions: RuleExecutionStore
  settingsStore: RuleSettingsStore
  dispatch: RuleEngineHost['dispatch']
  /**
   * Authority of the executor `dispatch` targets; the hint `by-target` steps
   * carry. The local bus is `'local'`; a host that routes to the workspace
   * authority passes `'workspace'`.
   */
  authorityHint?: 'local' | 'workspace'
  isFlagEnabled?: (flag: string) => boolean
  now?: () => Date
  scheduler?: RuleScheduler
  onExecution?: RuleEngineHost['onExecution']
  onError?: RuleEngineHost['onError']
  newExecutionId?: () => string
}

function recordValue(record: LocalWorkRecord<Record<string, unknown>> | null, key: string): unknown {
  const data = record?.record
  return data && typeof data === 'object' ? data[key] : undefined
}

/** The work-store directory of a reference collection (`note` → `docs`, …). */
function workDir(collection: string): string {
  return collectionSpec(collection).localDir ?? collection
}

export function createLocalRuleHost(options: LocalRuleHostOptions): RuleEngineHost {
  const work = new LocalWorkStore({ workspaceRoot: options.workspaceRoot })

  const settings = async (ruleId: RuleId, principalId?: string | null): Promise<RuleSettings> => {
    const scoped = principalId ? await options.settingsStore.read(options.workspaceId, ruleId, principalId) : null
    const workspaceRow: RuleSettingsRow | null = await options.settingsStore.read(options.workspaceId, ruleId, null)
    const effective: RuleSettingsRow | null = scoped ?? workspaceRow
    if (!effective) return defaultRuleSettings(ruleId)
    return {
      ruleId,
      enabled: effective.enabled,
      params: mergeParams(workspaceRow?.params ?? {}, effective.params),
      source: scoped ? 'principal' : 'workspace',
    }
  }

  const host: RuleEngineHost = {
    workspaceId: options.workspaceId,
    executions: options.executions,
    dispatch: options.dispatch,
    authorityHint: options.authorityHint ?? 'local',
    now: options.now ?? (() => new Date()),
    settings,
    isFlagEnabled: options.isFlagEnabled ?? (() => false),
    async generalChatId() {
      // ADR-U16 / D-v2-2: the General chat belongs to a team workspace and is
      // created with it. Locally it exists only when a shared workspace was
      // materialised here; otherwise R2/R4 have no team chat to join.
      const found = work.list<Record<string, unknown>>(workDir('channel')).find(entry => recordValue(entry, 'systemRole') === 'general')
      return found ? found.id : undefined
    },
    async personalAgent(principalId) {
      const found = work.list<Record<string, unknown>>(workDir('agent')).find(entry => recordValue(entry, 'ownerId') === principalId)
      // STUB(#1508): a host may answer before the agent row exists — the R3 step
      // provisions it at this deterministic id, so both agree by construction
      // (W1-11 replaces this with the real registry lookup).
      return found ? found.id : localAgentId(options.workspaceId, principalId)
    },
    async directChatRef(subjectPrincipalId, peerPrincipalId) {
      return { kind: 'channel', id: localP2pChatId(options.workspaceId, subjectPrincipalId, peerPrincipalId) }
    },
    async displayName(principalId) {
      const person = work.get<Record<string, unknown>>(workDir('person'), principalId)
      const name = recordValue(person, 'displayName') ?? recordValue(person, 'name')
      return typeof name === 'string' && name ? name : undefined
    },
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.onExecution ? { onExecution: options.onExecution } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.newExecutionId ? { newExecutionId: options.newExecutionId } : {}),
  }
  return host
}

export type { EntityRef }