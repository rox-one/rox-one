import { describe, expect, test } from 'bun:test'
import { executeApprovedProposal, type OutboxJob } from '../executor.ts'
import { payloadHash } from '../proposals.ts'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

function approved(): MeetingProposal {
  const payload = { title: 'прототип' }
  return {
    id: 'p1',
    workspaceId: 'ws',
    meetingId: 'm1',
    type: 'create_task',
    payload,
    payloadHash: payloadHash(payload),
    status: 'approved',
    sourceSpans: [],
    baseRevisions: {},
    approvedPayloadHash: payloadHash(payload),
  }
}

describe('meeting executor (RMA-I010)', () => {
  test('duplicate execute, crash, revoke, mismatch, and restart', () => {
    const hooks = {
      apply: (proposal: MeetingProposal) => ({ entityId: `task:${proposal.id}`, revision: '1' }),
      readback: (entityId: string) => ({ entityId, revision: '1' }),
    }
    const jobs: OutboxJob[] = []
    const first = executeApprovedProposal({ proposal: approved(), grant, actorId: 'user', deviceId: 'dev', jobs, hooks })
    expect(first.verification).toBe('verified')
    const dup = executeApprovedProposal({ proposal: approved(), grant, actorId: 'user', deviceId: 'dev', jobs, hooks })
    expect(dup.operationId).toBe(first.operationId)
    const crashBefore = executeApprovedProposal({
      proposal: { ...approved(), id: 'p2' },
      grant,
      actorId: 'user',
      deviceId: 'dev',
      jobs: [],
      hooks,
      crashBeforeApply: true,
    })
    expect(crashBefore.lifecycle).toBe('unknown')
    const crashAfter = executeApprovedProposal({
      proposal: { ...approved(), id: 'p3' },
      grant,
      actorId: 'user',
      deviceId: 'dev',
      jobs: [],
      hooks,
      crashAfterApply: true,
    })
    expect(crashAfter.lifecycle).toBe('unknown')
    expect(executeApprovedProposal({
      proposal: approved(),
      grant,
      actorId: 'user',
      deviceId: 'dev',
      jobs: [],
      hooks,
      revoke: true,
    }).lifecycle).toBe('cancelled')
    const mismatch = executeApprovedProposal({
      proposal: { ...approved(), id: 'p4' },
      grant,
      actorId: 'user',
      deviceId: 'dev',
      jobs: [],
      hooks: { apply: hooks.apply, readback: () => null },
    })
    expect(mismatch.verification).toBe('mismatch')
  })
})
