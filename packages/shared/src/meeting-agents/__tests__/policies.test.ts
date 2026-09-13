import { describe, expect, test } from 'bun:test'
import { authorizeMeetingAction, revokeGrant, type MeetingGrant } from '../policies.ts'

const actor = {
  accountId: 'acct-1',
  workspaceId: 'ws-1',
  deviceId: 'dev-1',
  authenticated: true,
}

const grant: MeetingGrant = {
  id: 'g1',
  actorId: 'acct-1',
  workspaceId: 'ws-1',
  deviceId: 'dev-1',
  capabilities: ['capture.microphone'],
  payloadHash: 'hash-1',
  expiresAt: 2_000,
}

describe('meeting grants (issue 359)', () => {
  test('allow-all without a grant is still denied', () => {
    const result = authorizeMeetingAction({
      actor,
      capability: 'capture.microphone',
      operation: 'start-capture',
      source: 'microphone',
      payloadHash: 'hash-1',
      now: 1_000,
      permissionMode: 'allow-all',
      grants: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('grant-missing')
  })

  test('expired and revoked grants fail closed', () => {
    expect(authorizeMeetingAction({
      actor,
      capability: 'capture.microphone',
      operation: 'chunk',
      source: 'microphone',
      payloadHash: 'hash-1',
      now: 3_000,
      permissionMode: 'ask',
      grants: [grant],
    }).ok).toBe(false)
    const revoked = revokeGrant(grant, 1_500)
    expect(authorizeMeetingAction({
      actor,
      capability: 'capture.microphone',
      operation: 'chunk',
      source: 'microphone',
      payloadHash: 'hash-1',
      now: 1_600,
      permissionMode: 'ask',
      grants: [revoked],
    }).ok).toBe(false)
  })

  test('foreign workspace and restricted target are denied', () => {
    expect(authorizeMeetingAction({
      actor: { ...actor, workspaceId: 'ws-other' },
      capability: 'capture.microphone',
      operation: 'chunk',
      source: 'microphone',
      payloadHash: 'hash-1',
      now: 1_000,
      permissionMode: 'ask',
      grants: [grant],
    }).ok).toBe(false)
    expect(authorizeMeetingAction({
      actor,
      capability: 'action.external',
      operation: 'send',
      source: 'external',
      target: 'mail:other',
      payloadHash: 'hash-1',
      now: 1_000,
      permissionMode: 'ask',
      grants: [{
        ...grant,
        id: 'g2',
        capabilities: ['action.external'],
        target: 'mail:allowed',
      }],
    }).ok).toBe(false)
  })

  test('speaker label is not an authenticated actor', () => {
    const result = authorizeMeetingAction({
      actor: { ...actor, speakerLabel: 'acct-1' },
      capability: 'action.external',
      operation: 'send',
      source: 'external',
      payloadHash: 'hash-1',
      now: 1_000,
      permissionMode: 'allow-all',
      grants: [{ ...grant, capabilities: ['action.external'] }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('speaker-not-actor')
  })

  test('missing local model does not authorize cloud fallback', () => {
    const result = authorizeMeetingAction({
      actor,
      capability: 'processing.cloud',
      operation: 'transcribe',
      source: 'cloud',
      payloadHash: 'hash-1',
      now: 1_000,
      permissionMode: 'allow-all',
      grants: [{ ...grant, capabilities: ['capture.microphone'] }],
      localModelReady: false,
    })
    expect(result.ok).toBe(false)
  })
})
