/**
 * Install exactly eight builtin meeting agents. Idempotent. User overrides
 * survive package upgrades. Expanding required scopes needs a new grant.
 */

import {
  BUILTIN_MEETING_AGENTS,
  BUILTIN_MEETING_AGENT_IDS,
  MEETING_AGENT_PACKAGE_VERSION,
  type BuiltinMeetingAgentId,
  type BuiltinRoleDefinition,
} from './catalog.ts'
import { promptForRole } from './prompts.ts'

export type MeetingAgentHealth = 'healthy' | 'authorization_required' | 'offline' | 'disabled'

export type MeetingAgentRecord = {
  id: BuiltinMeetingAgentId
  definition: BuiltinRoleDefinition
  installed: boolean
  enabled: boolean
  authorized: boolean
  healthy: MeetingAgentHealth
  running: boolean
  packageVersion: string
  prompt: string
  userOverride?: { enabled?: boolean; modelRole?: BuiltinRoleDefinition['modelRole'] }
}

export type MeetingAgentStore = {
  workspaceId: string
  packageVersion: string
  ledger: Array<{ definitionId: string; packageVersion: string }>
  records: Record<BuiltinMeetingAgentId, MeetingAgentRecord>
}

export type EnsureOptions = {
  online?: boolean
  grantedCapabilities?: readonly string[]
  previous?: MeetingAgentStore
  routeHealthy?: boolean
}

function effectiveEnabled(def: BuiltinRoleDefinition, override?: MeetingAgentRecord['userOverride']): boolean {
  if (override?.enabled === false) return false
  return def.enabledByDefault
}

function authorized(def: BuiltinRoleDefinition, granted: readonly string[], priorCaps?: readonly string[]): boolean {
  const needed = [...new Set([...def.allowedCapabilityIds, ...(priorCaps ?? [])])]
  return needed.every((cap) => granted.includes(cap) || granted.includes('*'))
}

export function ensureBuiltinMeetingAgents(
  workspaceId: string,
  packageVersion: string = MEETING_AGENT_PACKAGE_VERSION,
  options: EnsureOptions = {},
): MeetingAgentStore {
  if (!workspaceId) throw new Error('workspace id is empty')
  const granted = options.grantedCapabilities ?? []
  const previous = options.previous
  const records = {} as Record<BuiltinMeetingAgentId, MeetingAgentRecord>
  for (const definition of BUILTIN_MEETING_AGENTS) {
    const prior = previous?.records[definition.id]
    const userOverride = prior?.userOverride
    const enabled = effectiveEnabled(definition, userOverride)
    const auth = authorized(definition, granted, prior?.definition.allowedCapabilityIds)
    const scopesGrew =
      prior != null &&
      [...new Set([...definition.allowedCapabilityIds, ...prior.definition.allowedCapabilityIds])].some(
        (cap) => !granted.includes(cap) && cap !== '*',
      )
    const healthy: MeetingAgentHealth = !enabled
      ? 'disabled'
      : options.online === false
        ? 'offline'
        : scopesGrew || !auth
          ? 'authorization_required'
          : options.routeHealthy === false
            ? 'offline'
            : 'healthy'
    records[definition.id] = {
      id: definition.id,
      definition,
      installed: true,
      enabled,
      authorized: auth && !scopesGrew,
      healthy,
      running: false,
      packageVersion,
      prompt: promptForRole(definition.id, definition.promptVersion).text,
      userOverride,
    }
  }
  return {
    workspaceId,
    packageVersion,
    ledger: BUILTIN_MEETING_AGENT_IDS.map((definitionId) => ({ definitionId, packageVersion })),
    records,
  }
}

export function disableMeetingAgent(store: MeetingAgentStore, id: BuiltinMeetingAgentId): MeetingAgentStore {
  const current = store.records[id]
  const next = ensureBuiltinMeetingAgents(store.workspaceId, store.packageVersion, {
    previous: {
      ...store,
      records: {
        ...store.records,
        [id]: { ...current, userOverride: { ...current.userOverride, enabled: false } },
      },
    },
  })
  return next
}

export function resetMeetingAgentOverrides(store: MeetingAgentStore): MeetingAgentStore {
  return ensureBuiltinMeetingAgents(store.workspaceId, store.packageVersion, {
    previous: { ...store, records: Object.fromEntries(
      Object.entries(store.records).map(([id, record]) => [id, { ...record, userOverride: undefined }]),
    ) as MeetingAgentStore['records'] },
  })
}

export function installedCount(store: MeetingAgentStore): number {
  return Object.values(store.records).filter((record) => record.installed).length
}
