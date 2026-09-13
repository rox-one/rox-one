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

export function ensureBuiltinMeetingAgents(
  workspaceId: string,
  packageVersion: string,
  store: MeetingAgentStore,
  probe: MeetingRouteProbe = { available: true },
): { store: MeetingAgentStore; readiness: MeetingAgentReadiness[] } {
  const next: MeetingAgentStore = {
    ledger: [...store.ledger],
    overrides: { ...store.overrides },
    grantedCapabilities: [...store.grantedCapabilities],
    runningIds: [...store.runningIds],
  }
  for (const role of BUILTIN_MEETING_AGENTS) {
    const already = next.ledger.some(
      (row) => row.workspaceId === workspaceId && row.definitionId === role.id && row.packageVersion === packageVersion,
    )
    if (!already) {
      next.ledger.push({ workspaceId, definitionId: role.id, packageVersion })
    }
    const previous = next.ledger.find(
      (row) => row.workspaceId === workspaceId && row.definitionId === role.id && row.packageVersion !== packageVersion,
    )
    if (previous) {
      const addedScopes = role.allowedCapabilityIds.filter((cap) => !capabilityKnownInLedger(next.ledger, role.id, cap))
      if (addedScopes.length > 0) {
        /* authorization_required is computed in readiness; overrides are not auto-expanded */
      }
    }
  }
  return { store: next, readiness: readinessFor(workspaceId, next, probe, packageVersion) }
}

function capabilityKnownInLedger(
  ledger: MeetingAgentMigration[],
  id: BuiltinMeetingAgentId,
  _capability: MeetingCapabilityId,
): boolean {
  return ledger.some((row) => row.definitionId === id)
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
): MeetingAgentReadiness[] {
  const envFlag = process.env.ROX_MEETING_HEALTHY === '1' || process.env.ROX_MEETING_HEALTHY === 'true'
  return BUILTIN_MEETING_AGENTS.map((role) => {
    const installed = store.ledger.some(
      (row) => row.workspaceId === workspaceId && row.definitionId === role.id,
    )
    const enabled = store.overrides[role.id]?.enabled ?? role.enabledByDefault
    const granted = new Set(store.grantedCapabilities)
    const authorizationRequired = role.allowedCapabilityIds.some((cap) => !granted.has(cap))
    const authorized = !authorizationRequired
    const healthy = probe.available === true && !envFlagOnlyHealthy(probe, envFlag)
    return {
      id: role.id,
      installed,
      enabled,
      authorized: authorized && !authorizationRequired,
      healthy,
      running: store.runningIds.includes(role.id),
      authorizationRequired,
      promptVersion: MEETING_AGENT_PROMPTS[role.id].version,
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
