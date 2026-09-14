/**
 * Idempotent builtin meeting-agent install (issue #358).
 * installed / enabled / authorized / healthy / running are independent.
 * Env flags do not mark an unavailable route healthy.
 */

import {
  BUILTIN_MEETING_AGENT_IDS,
  BUILTIN_MEETING_AGENTS,
  MEETING_AGENT_PACKAGE_VERSION,
  type BuiltinMeetingAgentId,
  type BuiltinRoleDefinition,
  type MeetingCapabilityId,
  type MeetingModelRole,
} from './catalog.ts'
import { MEETING_AGENT_PROMPTS } from './prompts.ts'

export type MeetingAgentOverride = {
  enabled?: boolean
  modelRole?: MeetingModelRole
}

export type MeetingAgentMigration = {
  workspaceId: string
  definitionId: BuiltinMeetingAgentId
  packageVersion: string
  capabilities: MeetingCapabilityId[]
}

export type MeetingRouteProbe = {
  available: boolean
  reason?: string
}

export type MeetingAgentReadiness = {
  id: BuiltinMeetingAgentId
  installed: boolean
  enabled: boolean
  authorized: boolean
  healthy: boolean
  running: boolean
  authorizationRequired: boolean
  promptVersion: number
}

export type MeetingAgentStore = {
  ledger: MeetingAgentMigration[]
  overrides: Partial<Record<BuiltinMeetingAgentId, MeetingAgentOverride>>
  grantedCapabilities: MeetingCapabilityId[]
  runningIds: BuiltinMeetingAgentId[]
}

export function emptyMeetingAgentStore(): MeetingAgentStore {
  return { ledger: [], overrides: {}, grantedCapabilities: [], runningIds: [] }
}

/** Bootstrap never issues model calls. Kept as a counter so tests can prove it. */
export let meetingBootstrapModelCalls = 0

export function resetMeetingBootstrapModelCalls(): void {
  meetingBootstrapModelCalls = 0
}

export function ensureBuiltinMeetingAgents(
  workspaceId: string,
  packageVersion: string,
  store: MeetingAgentStore,
  probe: MeetingRouteProbe = { available: true },
  roles: readonly BuiltinRoleDefinition[] = BUILTIN_MEETING_AGENTS,
): { store: MeetingAgentStore; readiness: MeetingAgentReadiness[] } {
  const next: MeetingAgentStore = {
    ledger: [...store.ledger],
    overrides: { ...store.overrides },
    grantedCapabilities: [...store.grantedCapabilities],
    runningIds: [...store.runningIds],
  }
  for (const role of roles) {
    const already = next.ledger.some(
      (row) => row.workspaceId === workspaceId && row.definitionId === role.id && row.packageVersion === packageVersion,
    )
    if (!already) {
      next.ledger.push({
        workspaceId,
        definitionId: role.id,
        packageVersion,
        capabilities: [...role.allowedCapabilityIds],
      })
    }
  }
  return { store: next, readiness: readinessFor(workspaceId, next, probe, packageVersion, roles) }
}

export function setMeetingAgentEnabled(
  store: MeetingAgentStore,
  id: BuiltinMeetingAgentId,
  enabled: boolean,
): MeetingAgentStore {
  return {
    ...store,
    overrides: {
      ...store.overrides,
      [id]: { ...store.overrides[id], enabled },
    },
  }
}

export function resetMeetingAgentOverrides(
  store: MeetingAgentStore,
  id: BuiltinMeetingAgentId,
): MeetingAgentStore {
  const overrides = { ...store.overrides }
  delete overrides[id]
  return { ...store, overrides }
}

export function readinessFor(
  workspaceId: string,
  store: MeetingAgentStore,
  probe: MeetingRouteProbe,
  packageVersion = MEETING_AGENT_PACKAGE_VERSION,
  roles: readonly BuiltinRoleDefinition[] = BUILTIN_MEETING_AGENTS,
): MeetingAgentReadiness[] {
  const envFlag = process.env.ROX_MEETING_HEALTHY === '1' || process.env.ROX_MEETING_HEALTHY === 'true'
  return roles.map((role) => {
    const installed = store.ledger.some(
      (row) => row.workspaceId === workspaceId && row.definitionId === role.id,
    )
    const enabled = store.overrides[role.id]?.enabled ?? role.enabledByDefault
    const granted = new Set(store.grantedCapabilities)
    const previousCaps = new Set(
      store.ledger
        .filter((row) => row.workspaceId === workspaceId && row.definitionId === role.id)
        .flatMap((row) => row.capabilities ?? []),
    )
    const expandedUngranted = role.allowedCapabilityIds.some(
      (cap) => !previousCaps.has(cap) && !granted.has(cap) && store.ledger.some((row) => (
        row.workspaceId === workspaceId && row.definitionId === role.id && row.packageVersion !== packageVersion
      )),
    )
    const authorizationRequired = role.allowedCapabilityIds.some((cap) => !granted.has(cap)) || expandedUngranted
    const authorized = !authorizationRequired
    const healthy = probe.available === true && !envFlagOnlyHealthy(probe, envFlag)
    return {
      id: role.id,
      installed,
      enabled,
      authorized,
      healthy,
      running: store.runningIds.includes(role.id),
      authorizationRequired,
      promptVersion: MEETING_AGENT_PROMPTS[role.id]?.version ?? role.promptVersion,
    }
  })
}

function envFlagOnlyHealthy(probe: MeetingRouteProbe, envFlag: boolean): boolean {
  if (probe.available) return false
  return envFlag
}

export function builtinCount(): number {
  return BUILTIN_MEETING_AGENT_IDS.length
}
