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
    const rejected = rejectMeetingProposal({
      store: rejectStore,
      proposalId: 'p1',
      actorId: 'user',
      grant,
    })
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) throw new Error('expected reject')
    expect(rejected.proposal.status).toBe('rejected')
  })

  test('reject is fail-closed without grant and does not undo applied', () => {
    const store: ProposalStore = { items: [proposal()] }
    expect(rejectMeetingProposal({
      store,
      proposalId: 'p1',
      actorId: 'user',
      grant: null,
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(store.items[0]?.status).toBe('proposed')
    expect(rejectMeetingProposal({
      store,
      proposalId: 'missing',
      actorId: 'user',
      grant,
    })).toEqual({ ok: false, code: 'proposal-not-found' })
    const appliedStore: ProposalStore = { items: [proposal('applied')] }
    expect(rejectMeetingProposal({
      store: appliedStore,
      proposalId: 'p1',
      actorId: 'user',
      grant,
    })).toEqual({ ok: false, code: 'already-applied' })
    expect(appliedStore.items[0]?.status).toBe('applied')
    const rejectedStore: ProposalStore = { items: [proposal('rejected')] }
    const again = rejectMeetingProposal({
      store: rejectedStore,
      proposalId: 'p1',
      actorId: 'user',
      grant,
    })
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error('expected idempotent reject')
    expect(again.proposal.status).toBe('rejected')
    const archiveGrant: MeetingGrant = { ...grant, capabilities: ['archive'] }
    const proposed: ProposalStore = { items: [proposal()] }
    expect(rejectMeetingProposal({
      store: proposed,
      proposalId: 'p1',
      actorId: 'user',
      grant: archiveGrant,
    })).toEqual({ ok: false, code: 'capability-denied' })
    expect(proposed.items[0]?.status).toBe('proposed')
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
