import { describe, expect, test } from 'bun:test'
import { decodeRox2V2Result, isVerifiedEffect } from '../../rox2/platform-contract.ts'
import { meetingBindingKey, unknownLiveResult, verifiedMeetingResult } from '../model.ts'
import { MeetingSchemaError, parseMeeting, parseProposal } from '../schemas.ts'

describe('meeting model (issue 357)', () => {
  test('two accounts sharing a remoteId stay distinct bindings', () => {
    const a = meetingBindingKey({
      provider: 'zoom',
      account: 'acct-a',
      remoteType: 'call',
      remoteId: 'same-remote',
    })
    const b = meetingBindingKey({
      provider: 'zoom',
      account: 'acct-b',
      remoteType: 'call',
      remoteId: 'same-remote',
    })
    expect(a).not.toBe(b)
  })

  test('legacy live does not become verified', () => {
    const decoded = decodeRox2V2Result({ ok: true, state: 'live', entityId: 'task:1' })
    expect(decoded.lifecycle).toBe('applied')
    expect(decoded.verification).toBe('unknown')
    expect(isVerifiedEffect(decoded)).toBe(false)
    expect(isVerifiedEffect(verifiedMeetingResult('meeting:1'))).toBe(true)
    expect(isVerifiedEffect(unknownLiveResult('meeting:1'))).toBe(false)
  })

  test('unknown schema version blocks write', () => {
    expect(() => parseMeeting({
      schemaVersion: 99,
      kind: 'meeting',
      ref: { workspaceId: 'ws', entityId: 'm1', revisionId: '1' },
      title: 'x',
      createdAt: 1,
      updatedAt: 1,
    })).toThrow(MeetingSchemaError)
    expect(() => parseProposal({
      schemaVersion: 1,
      kind: 'proposal',
      ref: { workspaceId: 'ws', entityId: 'p1', revisionId: '1' },
      meetingId: 'm1',
      action: 'create-task',
      payload: {},
      causation: { commandId: 'c1', evidenceIds: [] },
    })).toThrow(MeetingSchemaError)
  })
})
