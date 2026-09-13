/**
 * RMA-I031 / #387 — packaging resource assertions.
 * Unverified OS packaging stays blocked, not passed. Protocol/storage IDs are not renamed.
 */

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
