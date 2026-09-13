import { describe, expect, test } from 'bun:test'
import { approveMeetingProposal, editMeetingProposal, payloadHash, rejectMeetingProposal, type ProposalStore } from '../proposals.ts'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

function proposal(status: MeetingProposal['status'] = 'proposed'): MeetingProposal {
  const payload = { title: 'прототип' }
  return {
    id: 'p1',
    workspaceId: 'ws',
    meetingId: 'm1',
    type: 'create_task',
    payload,
    payloadHash: payloadHash(payload),
    status,
    sourceSpans: [],
    baseRevisions: { transcript: '1' },
  }
}

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

describe('meeting proposals (RMA-I009)', () => {
  test('approve then edit becomes stale; reject and double approval are idempotent', () => {
    const store: ProposalStore = { items: [proposal()] }
    const approved = approveMeetingProposal({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload: { title: 'прототип' },
    })
    expect(approved.status).toBe('approved')
    expect(approveMeetingProposal({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload: { title: 'прототип' },
    }).status).toBe('approved')
    expect(editMeetingProposal(store, 'p1', { title: 'changed' }).status).toBe('stale')
  })

  test('stale source, revoked grant, and reject do not execute', () => {
    const store: ProposalStore = { items: [proposal()] }
    expect(() => approveMeetingProposal({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant,
      payload: { title: 'other' },
    })).toThrow(/payload-changed/)
    const revoked: ProposalStore = { items: [proposal()] }
    expect(() => approveMeetingProposal({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant: { ...grant, revokedAt: 1 },
      payload: { title: 'прототип' },
    })).toThrow(/revoked/)
    const rejectStore: ProposalStore = { items: [proposal()] }
    expect(rejectMeetingProposal(rejectStore, 'p1').status).toBe('rejected')
  })
})
