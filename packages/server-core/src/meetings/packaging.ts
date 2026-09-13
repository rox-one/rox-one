/**
 * RMA-I031 / #387 — packaging resource assertions (U1).
 * Linux-only. Packaged OS smoke stays N5 not_run. Web cannot fake OS capture.
 * Protocol/storage IDs are not renamed.
 * Linux unsigned staging does not require macOS codesign.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_MEETING_AGENT_IDS, BUILTIN_MEETING_AGENTS } from '@craft-agent/shared/meeting-agents'
import { blocked, type EvidenceLevel, type GateStatus, type MeetingOpResult } from './types.ts'

export const MEETING_AGENT_ROLES = [
  'facilitator',
  'scribe',
  'analyst',
  'timekeeper',
  'critic',
  'researcher',
  'operator',
  'sponsor',
] as const

export const PACKAGING_IDENTITY = {
  protocol: 'rox-agent',
  storage: 'craft-agent',
  oauth: 'rox',
  packageId: 'rox-one',
} as const

export const PACKAGING_RESOURCE_EVIDENCE: EvidenceLevel = 'U1'
export const PACKAGING_OS_SMOKE_EVIDENCE: EvidenceLevel = 'N5'

export type PackagingOs = 'darwin' | 'win32' | 'linux'

export type PackagedUserState = {
  readonly overrides: Readonly<Record<string, string>>
  readonly consent: Readonly<Record<string, boolean>>
  readonly data: Readonly<Record<string, string>>
}

export type WebMeetingSurface = {
  readonly review: true
  readonly approve: true
  readonly notes: true
  readonly tasks: true
  readonly osCapture: false
}

export const WEB_MEETING_SURFACE: WebMeetingSurface = {
  review: true,
  approve: true,
  notes: true,
  tasks: true,
  osCapture: false,
}

export function packagingStatus(os: PackagingOs, verified: boolean): GateStatus {
  if (os !== 'linux') return 'blocked'
  if (!verified) return 'blocked'
  return 'not_run'
}

export function packagedOsSmokeStatus(_os: PackagingOs): 'not_run' {
  return 'not_run'
}

export function hasEightRoles(roles: readonly string[]): boolean {
  return MEETING_AGENT_ROLES.every((role) => roles.includes(role)) && roles.length === 8
}

export function applyPackagedUpgrade(
  previous: PackagedUserState,
  bundled: PackagedUserState,
): PackagedUserState {
  return {
    overrides: { ...bundled.overrides, ...previous.overrides },
    consent: { ...bundled.consent, ...previous.consent },
    data: { ...bundled.data, ...previous.data },
  }
}

export function startOsCapture(surface: 'web' | 'packaged'): MeetingOpResult<'os-capture-unavailable'> {
  void surface
  return blocked('os-capture-unavailable', 'N5')
}

export type UnsignedStageResult = {
  readonly roles: readonly string[]
  readonly signed: false
  readonly resourceStage: 'passed' | 'blocked'
  readonly osPackage: GateStatus
}

export function refuseCodesign(codesign: boolean): void {
  if (codesign) {
    throw new Error('codesign-not-supported')
  }
}

export function stageMeetingAgentResources(
  destDir: string,
  options: { readonly os: PackagingOs; readonly codesign?: boolean; readonly osVerified?: boolean },
): UnsignedStageResult {
  refuseCodesign(options.codesign === true)
  mkdirSync(destDir, { recursive: true })
  const roles: string[] = []
  for (const agent of BUILTIN_MEETING_AGENTS) {
    roles.push(agent.id)
    writeFileSync(
      join(destDir, `${agent.id}.json`),
      `${JSON.stringify({
        id: agent.id,
        version: agent.version,
        packageId: PACKAGING_IDENTITY.packageId,
        protocol: PACKAGING_IDENTITY.protocol,
        storage: PACKAGING_IDENTITY.storage,
        oauth: PACKAGING_IDENTITY.oauth,
        signed: false,
      }, null, 2)}\n`,
    )
  }
  const resourceStage = BUILTIN_MEETING_AGENT_IDS.every((id) => roles.includes(id)) && roles.length === 8
    ? 'passed'
    : 'blocked'
  return {
    roles,
    signed: false,
    resourceStage,
    osPackage: packagingStatus(options.os, options.osVerified === true),
  }
}
