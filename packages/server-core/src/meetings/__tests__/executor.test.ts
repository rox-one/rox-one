import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isUiVerified } from '@craft-agent/core/meetings'
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
    expect(first.lifecycle).toBe('succeeded')
    expect(first.mode).toBe('fixture')
    expect(first.verification).toBe('pending')
    expect(first.verification).not.toBe('verified')
    expect(first.mode).not.toBe('production')
    expect(isUiVerified(first)).toBe(false)
    expect(first.entityRef?.entityId).toBe('task:p1')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('done')
    const dup = executeApprovedProposal({ proposal: approved(), grant, actorId: 'user', deviceId: 'dev', jobs, hooks })
    expect(dup.operationId).toBe(first.operationId)
    expect(dup.entityRef?.revisionId).toBe('1')
    expect(dup.entityRef?.entityId).toBe('task:p1')
    expect(dup.mode).toBe('fixture')
    expect(dup.verification).toBe('pending')
    expect(dup.verification).not.toBe('verified')
    expect(isUiVerified(dup)).toBe(false)
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
    expect(mismatch.mode).toBe('fixture')
    expect(mismatch.mode).not.toBe('production')
  })

  test('does not stamp verified or production on native in-memory apply', () => {
    const src = readFileSync(new URL('../executor.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/verification:\s*'verified'/)
    expect(src).not.toMatch(/mode:\s*'production'/)
  })
})
