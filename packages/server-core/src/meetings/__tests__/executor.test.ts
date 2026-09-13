import { describe, expect, test } from 'bun:test'
import { MeetingExecutor, type EffectAdapter } from '../executor.ts'
import { ProposalInbox } from '../proposals.ts'
import { isVerifiedEffect } from '@craft-agent/core/rox2'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const grant: MeetingGrant = {
  id: 'g1',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  capabilities: ['action.external'],
  expiresAt: 9_000,
}

function approvedProposal() {
  const inbox = new ProposalInbox()
  const proposal = inbox.put({
    id: 'p1',
    workspaceId: 'ws-a',
    meetingId: 'm1',
    payload: { title: 'прототип', due: '2026-09-18' },
    sourceRevision: 1,
  })
  return inbox.approve({
    proposalId: 'p1',
    actorId: 'acct-1',
    workspaceId: 'ws-a',
    deviceId: 'dev-1',
    payloadHash: proposal.payloadHash,
    now: 1,
    grants: [grant],
  })
}

function adapter(opts?: { mismatch?: boolean; fail?: boolean }): EffectAdapter {
  return {
    idempotent: true,
    async execute({ operationId }) {
      if (opts?.fail) throw new Error('provider down')
      return { remoteId: 'task-1', requestId: operationId, fields: { title: 'прототип', due: '2026-09-18' } }
    },
    async readback() {
      return opts?.mismatch ? { title: 'other' } : { title: 'прототип', due: '2026-09-18' }
    },
  }
}

describe('meeting executor (issue 366)', () => {
  test('duplicate execute is one effect', async () => {
    const exec = new MeetingExecutor(adapter())
    const proposal = approvedProposal()
    const first = await exec.executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 1,
      grants: [grant],
      expectedFields: { title: 'прототип' },
    })
    const second = await exec.executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 2,
      grants: [grant],
      expectedFields: { title: 'прототип' },
    })
    expect(first.status).toBe('acked')
    expect(second.operationId).toBe(first.operationId)
    expect(exec.effectCount()).toBe(1)
    expect(first.result && isVerifiedEffect(first.result)).toBe(true)
  })

  test('crash after effect stays unknown and is not retried blindly', async () => {
    const exec = new MeetingExecutor(adapter())
    const proposal = approvedProposal()
    const crashed = await exec.executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 1,
      grants: [grant],
      crashAfterEffect: true,
    })
    expect(crashed.status).toBe('unknown')
    expect(crashed.result?.verification).toBe('unknown')
    const replay = await exec.executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 2,
      grants: [grant],
    })
    expect(replay.status).toBe('unknown')
    expect(exec.effectCount()).toBe(1)
  })

  test('revoke and readback mismatch fail closed', async () => {
    const exec = new MeetingExecutor(adapter({ mismatch: true }))
    const proposal = approvedProposal()
    const revoked = await exec.executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 1,
      grants: [{ ...grant, revokedAt: 1 }],
    })
    expect(revoked.status).toBe('failed')
    const mismatch = await new MeetingExecutor(adapter({ mismatch: true })).executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 1,
      grants: [grant],
      expectedFields: { title: 'прототип' },
    })
    expect(mismatch.result?.code).toBe('readback-mismatch')
    expect(mismatch.result && isVerifiedEffect(mismatch.result)).toBe(false)
  })

  test('restart restores unknown jobs', async () => {
    const exec = new MeetingExecutor(adapter())
    const proposal = approvedProposal()
    await exec.executeApprovedProposal({
      proposal,
      actorId: 'acct-1',
      workspaceId: 'ws-a',
      deviceId: 'dev-1',
      now: 1,
      grants: [grant],
      crashAfterEffect: true,
    })
    const restarted = new MeetingExecutor(adapter())
    restarted.restore(exec.list())
    expect(restarted.list()[0]?.status).toBe('unknown')
  })
})
