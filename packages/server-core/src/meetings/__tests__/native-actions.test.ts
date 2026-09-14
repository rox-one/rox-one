import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FileTaskRepository } from '@craft-agent/core/tasks/personal'
import { resetPersonalTaskIds } from '@craft-agent/core/tasks/personal'
import { Rox2NoteRepository } from '@craft-agent/core/rox2'
import { isVerifiedEffect } from '@craft-agent/core/rox2'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { ProposalInbox } from '../proposals.ts'
import {
  NativeMeetingActions,
  createFileTaskPort,
  createRox2NotePort,
  memoryTaskFs,
} from '../native-actions.ts'

const grant: MeetingGrant = {
  id: 'g1',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  capabilities: ['action.external'],
  expiresAt: 9_000,
}

function approved(inbox = new ProposalInbox(), id = 'p1') {
  const proposal = inbox.put({
    id,
    workspaceId: 'ws-a',
    meetingId: 'm1',
    payload: {
      title: 'прототип',
      due: '2026-09-18',
      evidence: {
        segmentId: 'seg-1',
        segmentRevision: 1,
        quote: 'Иван, подготовь прототип к пятнице.',
      },
    },
    sourceRevision: 1,
  })
  return inbox.approve({
    proposalId: id,
    actorId: 'acct-1',
    workspaceId: 'ws-a',
    deviceId: 'dev-1',
    payloadHash: proposal.payloadHash,
    now: 1,
    grants: [grant],
  })
}

function harness(fs = memoryTaskFs()) {
  resetPersonalTaskIds()
  const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
  const notes = new Rox2NoteRepository()
  const actions = new NativeMeetingActions({
    tasks: createFileTaskPort(repo),
    notes: createRox2NotePort(notes),
    workspaceId: 'ws-a',
    actorId: 'acct-1',
    deviceId: 'dev-1',
    grants: [grant],
    now: () => 1,
  })
  return { fs, repo, notes, actions }
}

describe('meeting native actions (issue 367)', () => {
  test('approved proposal writes one native task and linked note with evidence', async () => {
    const { actions } = harness()
    const result = await actions.applyApprovedTaskProposal(approved())
    expect(result.job.status).toBe('acked')
    expect(result.job.result && isVerifiedEffect(result.job.result)).toBe(true)
    expect(result.task?.title).toBe('прототип')
    expect(result.task?.notes).toContain('2026-09-18')
    expect(result.binding?.taskId).toBe(result.task?.id)
    expect(result.binding?.evidence.quote).toContain('прототип')
    expect(result.binding?.evidence.segmentId).toBe('seg-1')
    const listed = await actions.bindings('m1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.taskId).toBe(result.task?.id)
  })

  test('double approval is a single native task', async () => {
    const { actions } = harness()
    const proposal = approved()
    const first = await actions.applyApprovedTaskProposal(proposal)
    const second = await actions.applyApprovedTaskProposal(proposal)
    expect(second.job.operationId).toBe(first.job.operationId)
    expect(second.task?.id).toBe(first.task?.id)
    expect((await actions.bindings('m1'))).toHaveLength(1)
  })

  test('disk failure is visible and does not create a task', async () => {
    const fs = memoryTaskFs()
    const { actions } = harness(fs)
    fs.quota = true
    const result = await actions.applyApprovedTaskProposal(approved())
    expect(result.job.status).toBe('failed')
    expect(result.job.result && isVerifiedEffect(result.job.result)).toBe(false)
    expect(await actions.bindings('m1')).toHaveLength(0)
  })

  test('a second window cannot save with a stale CAS revision', async () => {
    const { actions } = harness()
    await actions.applyApprovedTaskProposal(approved())
    const other = approved(new ProposalInbox(), 'p2')
    const conflict = await actions.applyApprovedTaskProposal(other, { expectedTaskRevision: 0 })
    expect(conflict.job.status).toBe('failed')
    expect(await actions.bindings('m1')).toHaveLength(1)
  })

  test('restart restores the same task id and evidence span', async () => {
    const first = harness()
    const created = await first.actions.applyApprovedTaskProposal(approved())
    const taskId = created.task?.id
    expect(taskId).toBeTruthy()

    const repo = new FileTaskRepository('/tmp/personal-tasks.json', first.fs)
    const notes = new Rox2NoteRepository()
    notes.restore(first.notes.list())
    const restarted = new NativeMeetingActions({
      tasks: createFileTaskPort(repo),
      notes: createRox2NotePort(notes),
      workspaceId: 'ws-a',
      actorId: 'acct-1',
      deviceId: 'dev-1',
      grants: [grant],
      now: () => 2,
    })
    restarted.restoreJobs(first.actions.jobs())
    const bindings = await restarted.bindings('m1')
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.taskId).toBe(taskId)
    expect(bindings[0]?.evidence.segmentId).toBe('seg-1')
    expect(bindings[0]?.evidence.quote).toContain('прототип')
    const task = await createFileTaskPort(repo).get(taskId!)
    expect(task?.title).toBe('прототип')
    expect(JSON.stringify(task)).toContain('2026-09-18')
  })

  test('does not use localStorage as a canonical writer and keeps RPC seams', () => {
    const native = readFileSync(join(import.meta.dir, '../native-actions.ts'), 'utf8')
    const notes = readFileSync(join(import.meta.dir, '../../handlers/rpc/notes.ts'), 'utf8')
    const tasks = readFileSync(join(import.meta.dir, '../../handlers/rpc/personal-tasks.ts'), 'utf8')
    expect(native).not.toContain('localStorage')
    expect(notes).toContain('export async function createMeetingEvidenceNote')
    expect(tasks).toContain('export function personalTasksRepository')
  })
})
