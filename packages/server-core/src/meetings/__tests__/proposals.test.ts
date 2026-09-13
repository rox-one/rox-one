import { describe, expect, test } from 'bun:test'
import { ProposalInbox } from '../proposals.ts'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const grant: MeetingGrant = {
  id: 'g1',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  capabilities: ['action.external'],
  payloadHash: undefined,
  expiresAt: 9_000,
}

describe('proposal inbox (issue 365)', () => {
  test('approve then edit invalidates approval', () => {
    const inbox = new ProposalInbox()
    const proposal = inbox.put({
      id: 'p1',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
    })
    const approved = inbox.approve({
      proposalId: 'p1',
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      payloadHash: proposal.payloadHash,
      now: 1,
      grants: [grant],
    })
    expect(approved.status).toBe('approved')
    expect(inbox.edit('p1', { title: 'исследование' }).status).toBe('proposed')
  })

  test('stale source, reject, and double approval', () => {
    const inbox = new ProposalInbox()
    const proposal = inbox.put({
      id: 'p2',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
    })
    expect(inbox.markStaleIfSourceChanged('p2', 2).status).toBe('stale')
    inbox.put({
      id: 'p3',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
    })
    expect(inbox.reject('p3').status).toBe('rejected')
    const live = inbox.put({
      id: 'p4',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
    })
    inbox.approve({
      proposalId: 'p4',
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      payloadHash: live.payloadHash,
      now: 1,
      grants: [grant],
    })
    const again = inbox.approve({
      proposalId: 'p4',
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      payloadHash: live.payloadHash,
      now: 1,
      grants: [grant],
    })
    expect(again.status).toBe('approved')
  })

  test('revoked grant cannot approve', () => {
    const inbox = new ProposalInbox()
    const proposal = inbox.put({
      id: 'p5',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
    })
    expect(() => inbox.approve({
      proposalId: 'p5',
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      payloadHash: proposal.payloadHash,
      now: 1,
      grants: [{ ...grant, revokedAt: 1 }],
    })).toThrow('grant-revoked')
  })

  test('restart restores proposals without applying them', () => {
    const inbox = new ProposalInbox()
    const proposal = inbox.put({
      id: 'p6',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
    })
    inbox.approve({
      proposalId: 'p6',
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      payloadHash: proposal.payloadHash,
      now: 1,
      grants: [grant],
    })
    const restarted = new ProposalInbox()
    restarted.restore(inbox.list())
    expect(restarted.get('p6')?.status).toBe('approved')
    expect(restarted.get('p6')?.status).not.toBe('applied')
  })
})
