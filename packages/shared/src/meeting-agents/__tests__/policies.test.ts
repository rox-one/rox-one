import { describe, expect, test } from 'bun:test'
import { authorizeMeetingAction, type MeetingGrant } from '../policies.ts'

function grant(partial: Partial<MeetingGrant> = {}): MeetingGrant {
  return {
    id: 'g1',
    actorId: 'user-1',
    workspaceId: 'ws-1',
    deviceId: 'dev-1',
    capabilities: ['mic'],
    ...partial,
  }
}

describe('meeting policies (RMA-I003)', () => {
  test('allow-all without a grant is still denied', () => {
    expect(authorizeMeetingAction(null, {
      actorId: 'user-1',
      workspaceId: 'ws-1',
      deviceId: 'dev-1',
      capability: 'mic',
      operation: 'capture',
      permissionMode: 'allow-all',
    })).toEqual({ ok: false, code: 'grant-required' })
  })

  test('expired grant is denied', () => {
    expect(authorizeMeetingAction(grant({ expiresAt: 10 }), {
      actorId: 'user-1',
      workspaceId: 'ws-1',
      deviceId: 'dev-1',
      capability: 'mic',
      operation: 'capture',
      now: 11,
    })).toEqual({ ok: false, code: 'expired' })
  })

  test('foreign workspace is denied', () => {
    expect(authorizeMeetingAction(grant(), {
      actorId: 'user-1',
      workspaceId: 'ws-other',
      deviceId: 'dev-1',
      capability: 'mic',
      operation: 'capture',
    })).toEqual({ ok: false, code: 'workspace-mismatch' })
  })

  test('approved then revoked is denied', () => {
    expect(authorizeMeetingAction(grant({ revokedAt: 5 }), {
      actorId: 'user-1',
      workspaceId: 'ws-1',
      deviceId: 'dev-1',
      capability: 'mic',
      operation: 'capture',
    })).toEqual({ ok: false, code: 'revoked' })
  })

  test('archive=no and cloud=no are separate denials', () => {
    const micOnly = grant({ capabilities: ['mic'] })
    expect(authorizeMeetingAction(micOnly, {
      actorId: 'user-1',
      workspaceId: 'ws-1',
      deviceId: 'dev-1',
      capability: 'archive',
      operation: 'store',
    })).toEqual({ ok: false, code: 'capability-denied' })
    expect(authorizeMeetingAction(micOnly, {
      actorId: 'user-1',
      workspaceId: 'ws-1',
      deviceId: 'dev-1',
      capability: 'cloud-processing',
      operation: 'upload',
    })).toEqual({ ok: false, code: 'capability-denied' })
  })

  test('target restriction is enforced', () => {
    expect(authorizeMeetingAction(grant({ targetIds: ['meeting-1'] }), {
      actorId: 'user-1',
      workspaceId: 'ws-1',
      deviceId: 'dev-1',
      capability: 'mic',
      operation: 'capture',
      targetId: 'meeting-2',
    })).toEqual({ ok: false, code: 'target-denied' })
  })
})
