/**
 * Fail-closed meeting capability grants (issue #359).
 * `allow-all` does not waive meeting capture/cloud/archive/send policy.
 * A speaker label is not an authenticated actor.
 */

import type { MeetingCapabilityId } from './catalog.ts'

export type MeetingActor = {
  accountId: string
  workspaceId: string
  deviceId: string
  authenticated: boolean
  speakerLabel?: string
}

export type MeetingGrant = {
  id: string
  actorId: string
  workspaceId: string
  deviceId: string
  capabilities: readonly MeetingCapabilityId[]
  target?: string
  payloadHash?: string
  expiresAt: number
  revokedAt?: number
  budgetRemaining?: number
}

export type MeetingActionRequest = {
  actor: MeetingActor
  capability: MeetingCapabilityId
  operation: string
  source: 'microphone' | 'system' | 'screen' | 'import' | 'cloud' | 'archive' | 'external'
  target?: string
  payloadHash: string
  now: number
  permissionMode: 'allow-all' | 'ask' | 'safe'
  grants: readonly MeetingGrant[]
  localModelReady?: boolean
}

export type MeetingAuthz =
  | { ok: true; grantId: string }
  | { ok: false; code: string; message: string }

const SOURCE_CAPABILITY: Record<MeetingActionRequest['source'], MeetingCapabilityId> = {
  microphone: 'capture.microphone',
  system: 'capture.system',
  screen: 'capture.screen',
  import: 'archive.durable',
  cloud: 'processing.cloud',
  archive: 'archive.durable',
  external: 'action.external',
}

export function authorizeMeetingAction(request: MeetingActionRequest): MeetingAuthz {
  if (!request.actor.authenticated) {
    return deny('unauthenticated', 'Speaker labels and anonymous participants cannot authorize meeting actions')
  }
  if (request.actor.speakerLabel && request.actor.accountId === request.actor.speakerLabel) {
    return deny('speaker-not-actor', 'Speaker identity is not an authenticated actor')
  }
  if (!request.actor.accountId || !request.actor.workspaceId || !request.actor.deviceId) {
    return deny('incomplete-actor', 'Authenticated actor, workspace, and device are required')
  }
  const required = SOURCE_CAPABILITY[request.source]
  if (required !== request.capability) {
    return deny('capability-mismatch', 'Operation source does not match requested capability')
  }
  if (request.capability === 'processing.cloud' && request.localModelReady === false && request.permissionMode === 'allow-all') {
    /* missing local model still does not imply cloud fallback */
  }
  const grant = request.grants.find((item) => grantMatches(item, request, required))
  if (!grant) {
    if (request.permissionMode === 'ask') {
      return deny('challenge', 'Meeting capability requires an explicit grant')
    }
    return deny('grant-missing', 'Meeting capability is not granted')
  }
  if (grant.revokedAt && grant.revokedAt <= request.now) {
    return deny('grant-revoked', 'Grant was revoked before the effect')
  }
  if (grant.expiresAt <= request.now) {
    return deny('grant-expired', 'Grant has expired')
  }
  if (grant.workspaceId !== request.actor.workspaceId) {
    return deny('workspace-mismatch', 'Grant belongs to another workspace')
  }
  if (grant.target && request.target && grant.target !== request.target) {
    return deny('target-denied', 'Grant does not cover this target')
  }
  if (grant.payloadHash && grant.payloadHash !== request.payloadHash) {
    return deny('payload-mismatch', 'Approved payload hash does not match')
  }
  if (grant.budgetRemaining !== undefined && grant.budgetRemaining <= 0) {
    return deny('budget-exhausted', 'Grant budget is exhausted')
  }
  if (request.capability === 'processing.cloud' && request.localModelReady === false && !grant.capabilities.includes('processing.cloud')) {
    return deny('cloud-fallback-denied', 'Missing local model does not authorize cloud processing')
  }
  return { ok: true, grantId: grant.id }
}

function grantMatches(grant: MeetingGrant, request: MeetingActionRequest, required: MeetingCapabilityId): boolean {
  if (grant.actorId !== request.actor.accountId) return false
  if (grant.workspaceId !== request.actor.workspaceId) return false
  if (grant.deviceId !== request.actor.deviceId) return false
  if (!grant.capabilities.includes(required)) return false
  return true
}

function deny(code: string, message: string): MeetingAuthz {
  return { ok: false, code, message }
}

export function revokeGrant(grant: MeetingGrant, now: number): MeetingGrant {
  return { ...grant, revokedAt: now }
}
