import { describe, expect, test } from 'bun:test'
import {
  ProposalInbox,
  approveMeetingProposal,
  approveMeetingProposals,
} from '../proposals.ts'
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

function actor(proposalId: string, payloadHash: string, extra: Record<string, unknown> = {}) {
  return {
    proposalId,
    actorId: 'acct-1',
    workspaceId: 'ws-a',
    deviceId: 'dev-1',
    payloadHash,
    baseRevision: 1,
    now: 1,
    grants: [grant],
    ...extra,
  }
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

  test('approveMeetingProposal binds actor, hash, base revision and target', () => {
    const inbox = new ProposalInbox()
    const proposal = inbox.put({
      id: 'p7',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
      target: 'tasks:ws-a',
    })
    expect(approveMeetingProposal(inbox, actor(proposal.id, proposal.payloadHash, {
      baseRevision: 2,
      target: 'tasks:ws-a',
    })).status).toBe('stale')
    const live = inbox.put({
      id: 'p8',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'прототип' },
      sourceRevision: 1,
      target: 'tasks:ws-a',
    })
    expect(() => approveMeetingProposal(inbox, actor(live.id, live.payloadHash, {
      target: 'mail:other',
    }))).toThrow('Approval target does not match')
    expect(approveMeetingProposal(inbox, actor(live.id, live.payloadHash, {
      target: 'tasks:ws-a',
    })).status).toBe('approved')
    expect(inbox.get('p8')?.status).not.toBe('applied')
  })

  test('batch approve is separate operations, not allow-all', () => {
    const inbox = new ProposalInbox()
    const first = inbox.put({
      id: 'p9',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'one' },
      sourceRevision: 1,
    })
    const second = inbox.put({
      id: 'p10',
      workspaceId: 'ws-a',
      meetingId: 'm1',
      payload: { title: 'two' },
      sourceRevision: 1,
    })
    const results = approveMeetingProposals(inbox, [
      actor(first.id, first.payloadHash),
      actor(second.id, 'wrong-hash'),
    ])
    expect(results[0]?.ok).toBe(true)
    expect(results[1]?.ok).toBe(false)
    expect(inbox.get('p9')?.status).toBe('approved')
    expect(inbox.get('p10')?.status).toBe('proposed')
    expect(inbox.clarify('p10').status).toBe('needs_clarification')
  })
})
