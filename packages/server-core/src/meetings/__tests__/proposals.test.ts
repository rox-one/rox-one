import { describe, expect, test } from 'bun:test'
import {
  approveMeetingProposal,
  createMeetingProposal,
  editMeetingProposal,
  payloadHash,
  rejectMeetingProposal,
  type ProposalStore,
} from '../proposals.ts'
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

  test('create is fail-closed without grant and idempotent by payload hash', () => {
    const store: ProposalStore = { items: [] }
    const payload = { title: 'прототип' }
    expect(createMeetingProposal({
      store,
      actorId: 'user',
      grant: null,
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(store.items).toEqual([])
    const created = createMeetingProposal({
      store,
      actorId: 'user',
      grant,
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected create')
    expect(created.proposal.status).toBe('proposed')
    expect(created.proposal.id.startsWith('prop-m1-')).toBe(true)
    const again = createMeetingProposal({
      store,
      actorId: 'user',
      grant,
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
    })
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error('expected idempotent create')
    expect(again.proposal.id).toBe(created.proposal.id)
    expect(store.items).toHaveLength(1)
    expect(createMeetingProposal({
      store,
      actorId: 'user',
      grant,
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload: { title: 'other' },
      id: created.proposal.id,
    })).toEqual({ ok: false, code: 'payload-conflict' })
  })
})
