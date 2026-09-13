/**
 * Meeting capability grants. allow-all does not bypass these scopes.
 */

export const MEETING_CAPABILITIES = [
  'mic',
  'system',
  'screen',
  'cloud-processing',
  'archive',
  'send',
] as const

export type MeetingCapability = (typeof MEETING_CAPABILITIES)[number]

export type MeetingGrant = {
  id: string
  actorId: string
  workspaceId: string
  deviceId: string
  capabilities: readonly MeetingCapability[]
  targetIds?: readonly string[]
  payloadHash?: string
  expiresAt?: number
  revokedAt?: number
  budgetRemaining?: number
}

export type MeetingAction = {
  actorId: string
  workspaceId: string
  deviceId: string
  capability: MeetingCapability
  operation: string
  targetId?: string
  payloadHash?: string
  now?: number
  permissionMode?: 'allow-all' | 'ask' | 'safe'
}

export type AuthorizeResult =
  | { ok: true }
  | { ok: false; code: string }

export function authorizeMeetingAction(grant: MeetingGrant | null, action: MeetingAction): AuthorizeResult {
  if (!grant) return { ok: false, code: 'grant-required' }
  if (grant.revokedAt != null) return { ok: false, code: 'revoked' }
  if (grant.actorId !== action.actorId) return { ok: false, code: 'actor-mismatch' }
  if (grant.workspaceId !== action.workspaceId) return { ok: false, code: 'workspace-mismatch' }
  if (grant.deviceId !== action.deviceId) return { ok: false, code: 'device-mismatch' }
  if (action.now != null && grant.expiresAt != null && action.now >= grant.expiresAt) {
    return { ok: false, code: 'expired' }
  }
  if (!grant.capabilities.includes(action.capability)) return { ok: false, code: 'capability-denied' }
  if (grant.targetIds && action.targetId && !grant.targetIds.includes(action.targetId)) {
    return { ok: false, code: 'target-denied' }
  }
  if (grant.payloadHash && action.payloadHash && grant.payloadHash !== action.payloadHash) {
    return { ok: false, code: 'payload-mismatch' }
  }
  if (grant.budgetRemaining != null && grant.budgetRemaining <= 0) return { ok: false, code: 'budget-exhausted' }
  return { ok: true }
}

export function canUseCloudFallback(grant: MeetingGrant | null, localModelReady: boolean): boolean {
  if (!grant) return false
  if (grant.revokedAt != null) return false
  if (!grant.capabilities.includes('cloud-processing')) return false
  if (!localModelReady) return grant.capabilities.includes('cloud-processing')
  return true
}

export function archiveAllowed(grant: MeetingGrant | null): boolean {
  return authorizeMeetingAction(grant, {
    actorId: grant?.actorId ?? '',
    workspaceId: grant?.workspaceId ?? '',
    deviceId: grant?.deviceId ?? '',
    capability: 'archive',
    operation: 'archive',
  }).ok
}
