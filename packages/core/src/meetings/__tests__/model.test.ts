import { describe, expect, test } from 'bun:test'
import {
  decodeLegacyLiveResult,
  emptyMeeting,
  isUiVerified,
  meetingBindingKey,
  meetingEntityId,
  type OperationResultV2,
} from '../model.ts'
import { assertWritableSchema, parseMeeting, parseOperationResultV2, parseProposal } from '../schemas.ts'

describe('meeting model (RMA-I001)', () => {
  test('meeting is a call entity, not a session', () => {
    expect(meetingEntityId('m1')).toBe('call:m1')
    const meeting = emptyMeeting({ workspaceId: 'ws-a', meetingId: 'm1', title: 'Standup', now: 1 })
    expect(meeting.entityId.startsWith('call:')).toBe(true)
    expect(meeting.schemaVersion).toBe(1)
  })

  test('two accounts with the same remoteId stay distinct', () => {
    const a = meetingBindingKey({
      workspaceId: 'ws',
      provider: 'zoom',
      accountId: 'acct-1',
      remoteType: 'call',
      remoteId: 'remote-9',
    })
    const b = meetingBindingKey({
      workspaceId: 'ws',
      provider: 'zoom',
      accountId: 'acct-2',
      remoteType: 'call',
      remoteId: 'remote-9',
    })
    expect(a).not.toBe(b)
  })

  test('legacy live does not become verified', () => {
    const decoded = decodeLegacyLiveResult({ ok: true, state: 'live', entityId: 'call:m1' }, 'op-1')
    expect(decoded.verification).toBe('unknown')
    expect(isUiVerified(decoded)).toBe(false)
  })

  test('unknown schema blocks writes', () => {
    const blocked = parseMeeting({
      schemaVersion: 99,
      workspaceId: 'ws',
      meetingId: 'm',
      entityId: 'call:m',
      revision: 0,
      status: 'planned',
    })
    expect(blocked).toEqual({ status: 'blocked', reason: 'unsupported-schema', version: 99 })
    expect(() => assertWritableSchema({ schemaVersion: 99, workspaceId: 'ws', meetingId: 'm', entityId: 'call:m', revision: 0, status: 'planned' })).toThrow(/unsupported meeting schema 99/)
  })

  test('proposal and v2 result codecs reject invalid envelopes', () => {
    expect(parseProposal({}).status).toBe('invalid')
    const ok: OperationResultV2 = {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'queued',
      verification: 'not_requested',
      operationId: 'op-1',
    }
    expect(parseOperationResultV2(ok)).toEqual(ok)
    expect(parseOperationResultV2({ schemaVersion: 3, mode: 'production', lifecycle: 'queued', verification: 'verified', operationId: 'x' })).toEqual({
      status: 'blocked',
      reason: 'unsupported-schema',
      version: 3,
    })
  })
})
