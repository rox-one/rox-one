/**
 * RMA-I031 / #387 — packaging resource assertions.
 * Unverified OS packaging stays blocked, not passed. Protocol/storage IDs are not renamed.
 * Linux unsigned staging does not require macOS codesign.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_MEETING_AGENT_IDS, BUILTIN_MEETING_AGENTS } from '@craft-agent/shared/meeting-agents'

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

export function packagingStatus(os: 'darwin' | 'win32' | 'linux', verified: boolean): 'passed' | 'blocked' {
  if (!verified) return 'blocked'
  if (os === 'linux' || os === 'darwin' || os === 'win32') return 'passed'
  return 'blocked'
}

export function hasEightRoles(roles: readonly string[]): boolean {
  return MEETING_AGENT_ROLES.every((role) => roles.includes(role)) && roles.length === 8
}

export type UnsignedStageResult = {
  readonly roles: readonly string[]
  readonly signed: false
  readonly resourceStage: 'passed' | 'blocked'
  readonly osPackage: 'passed' | 'blocked'
}

export function refuseCodesign(codesign: boolean): void {
  if (codesign) {
    throw new Error('codesign-not-supported')
  }
}

export function stageMeetingAgentResources(
  destDir: string,
  options: { readonly os: 'darwin' | 'win32' | 'linux'; readonly codesign?: boolean; readonly osVerified?: boolean },
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
