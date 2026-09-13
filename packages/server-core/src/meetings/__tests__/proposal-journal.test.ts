import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { startNativeMeeting } from '../catalog.ts'
import { MeetingJournal } from '../journal.ts'
import { payloadHash } from '../proposals.ts'
import {
  appendProposalJournalEvent,
  proposalJournalCommandId,
} from '../proposal-journal.ts'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

function root(): string {
  return mkdtempSync(join(tmpdir(), 'proposal-journal-'))
}

function started(persistRootDir: string, meetingId = 'm1') {
  const created = startNativeMeeting({
    persistRootDir,
    workspaceId: 'ws',
    actorId: 'user',
    grant,
    title: 'локальная',
    meetingId,
  })
  if (!created.ok) throw new Error('expected start')
  return created.meeting
}

function proposal(partial: Partial<MeetingProposal> = {}): MeetingProposal {
  const payload = { title: 'прототип' }
  return {
    id: 'prop-m1-abc',
    workspaceId: 'ws',
    meetingId: 'm1',
    type: 'create_task',
    payload,
    payloadHash: payloadHash(payload),
    status: 'proposed',
    sourceSpans: [],
    baseRevisions: {},
    ...partial,
  }
}

function upserts(persistRootDir: string, meetingId: string) {
  return new MeetingJournal(persistRootDir).read(meetingId).events.filter((event) => event.type === 'proposal.upsert')
}

describe('proposal.upsert journal write', () => {
  test('writes proposal.upsert after a started meeting', () => {
    const persistRootDir = root()
    started(persistRootDir)
    const row = proposal()
    const result = appendProposalJournalEvent({ persistRootDir, workspaceId: 'ws', proposal: row })
    expect(result.ok).toBe(true)
    const events = upserts(persistRootDir, 'm1')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'proposal.upsert', proposal: row })
  })

  test('fail-closes when the meeting snapshot does not exist', () => {
    const persistRootDir = root()
    expect(appendProposalJournalEvent({
      persistRootDir,
      workspaceId: 'ws',
      proposal: proposal(),
    })).toEqual({ ok: false, code: 'meeting-not-found' })
    expect(() => new MeetingJournal(persistRootDir).read('m1')).toThrow(/not found/)
  })

  test('duplicate commandId does not append a second event', () => {
    const persistRootDir = root()
    started(persistRootDir)
    const row = proposal({ status: 'rejected' })
    expect(proposalJournalCommandId(row)).toBe('proposal-prop-m1-abc-rejected')
    expect(appendProposalJournalEvent({ persistRootDir, workspaceId: 'ws', proposal: row }).ok).toBe(true)
    expect(appendProposalJournalEvent({ persistRootDir, workspaceId: 'ws', proposal: row }).ok).toBe(true)
    expect(upserts(persistRootDir, 'm1')).toHaveLength(1)
  })

  test('fail-closes without persist root, on workspace mismatch, and when the journal is locked', () => {
    const persistRootDir = root()
    started(persistRootDir)
    expect(appendProposalJournalEvent({
      persistRootDir: null,
      workspaceId: 'ws',
      proposal: proposal(),
    })).toEqual({ ok: false, code: 'config-dir-required' })
    expect(appendProposalJournalEvent({
      persistRootDir,
      workspaceId: 'other',
      proposal: proposal(),
    })).toEqual({ ok: false, code: 'workspace-mismatch' })
    const lock = new MeetingJournal(persistRootDir)
    lock.acquireWriter()
    expect(appendProposalJournalEvent({
      persistRootDir,
      workspaceId: 'ws',
      proposal: proposal(),
    })).toEqual({ ok: false, code: 'journal-locked' })
    lock.releaseWriter()
    expect(upserts(persistRootDir, 'm1')).toHaveLength(0)
  })
})
