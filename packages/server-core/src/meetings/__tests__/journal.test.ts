import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyMeeting } from '@craft-agent/core/meetings'
import { MeetingJournal } from '../journal.ts'
import { createMeetingRepository } from '../repository.ts'
import { migrateMeetingJournal } from '../migrations.ts'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'meeting-journal-'))
}

function created(workspaceId: string, meetingId: string) {
  return {
    type: 'meeting.created' as const,
    meeting: emptyMeeting({ workspaceId, meetingId, title: 'Call', now: 10 }),
  }
}

describe('meeting journal (RMA-I001)', () => {
  test('two accounts with the same remoteId remain two meetings', () => {
    const journal = new MeetingJournal(tempRoot())
    journal.acquireWriter()
    journal.commit({
      workspaceId: 'ws',
      meetingId: 'm-acct1',
      expectedRevision: 0,
      commandId: 'c1',
      events: [created('ws', 'm-acct1')],
      outboxEntries: [],
    })
    journal.commit({
      workspaceId: 'ws',
      meetingId: 'm-acct2',
      expectedRevision: 0,
      commandId: 'c2',
      events: [created('ws', 'm-acct2')],
      outboxEntries: [],
    })
    expect(journal.read('m-acct1').meeting.meetingId).toBe('m-acct1')
    expect(journal.read('m-acct2').meeting.meetingId).toBe('m-acct2')
    journal.releaseWriter()
  })

  test('stale CAS and duplicate commandId do not create a second effect', async () => {
    const repo = createMeetingRepository(tempRoot())
    const first = {
      workspaceId: 'ws',
      meetingId: 'm1',
      expectedRevision: 0,
      commandId: 'cmd-1',
      events: [created('ws', 'm1')],
      outboxEntries: [{ operationId: 'op-1', proposalId: 'p1', idempotencyKey: 'k1', payloadHash: 'h', createdAt: 1 }],
    }
    expect(await repo.commit(first)).toEqual({ revision: 1, duplicate: false })
    expect(await repo.commit(first)).toEqual({ revision: 1, duplicate: true })
    await expect(repo.commit({ ...first, commandId: 'cmd-2', expectedRevision: 0 })).rejects.toThrow(/stale CAS/)
    const snap = await repo.read('ws', 'm1')
    expect(snap.outbox).toHaveLength(1)
  })

  test('corrupt tail is quarantined and the original bytes are preserved', () => {
    const root = tempRoot()
    const journal = new MeetingJournal(root)
    journal.acquireWriter()
    journal.commit({
      workspaceId: 'ws',
      meetingId: 'm1',
      expectedRevision: 0,
      commandId: 'c1',
      events: [created('ws', 'm1')],
      outboxEntries: [],
    })
    const journalPath = journal.journalPath('m1')
    appendFileSync(journalPath, '{not-json\n')
    const restored = journal.read('m1')
    expect(restored.meeting.meetingId).toBe('m1')
    expect(journal.lastQuarantine?.reason).toBe('corrupt-tail')
    expect(existsSync(journal.lastQuarantine!.path)).toBe(true)
    expect(readFileSync(journal.lastQuarantine!.path, 'utf8')).toContain('{not-json')
    journal.releaseWriter()
  })

  test('second writer is refused; restart after crash still reads snapshot', () => {
    const root = tempRoot()
    const a = new MeetingJournal(root)
    a.acquireWriter()
    const b = new MeetingJournal(root)
    expect(() => b.acquireWriter()).toThrow(/already has a writer/)
    a.commit({
      workspaceId: 'ws',
      meetingId: 'm1',
      expectedRevision: 0,
      commandId: 'boot',
      events: [created('ws', 'm1')],
      outboxEntries: [],
    })
    a.releaseWriter()
    const restarted = new MeetingJournal(root)
    expect(restarted.read('m1').meeting.revision).toBe(1)
  })

  test('binding event persists native-journal sourceBinding', () => {
    const journal = new MeetingJournal(tempRoot())
    journal.acquireWriter()
    journal.commit({
      workspaceId: 'ws',
      meetingId: 'm1',
      expectedRevision: 0,
      commandId: 'c1',
      events: [created('ws', 'm1')],
      outboxEntries: [],
    })
    journal.commit({
      workspaceId: 'ws',
      meetingId: 'm1',
      expectedRevision: 1,
      commandId: 'c2',
      events: [
        {
          type: 'meeting.binding',
          sourceBinding: {
            provider: 'native-journal',
            accountId: 'user',
            remoteType: 'capture-intent',
            remoteId: 'm1',
          },
        },
        { type: 'meeting.status', status: 'capturing' },
      ],
      outboxEntries: [],
    })
    const meeting = journal.read('m1').meeting
    expect(meeting.status).toBe('capturing')
    expect(meeting.sourceBinding?.provider).toBe('native-journal')
    expect(meeting.sourceBinding?.remoteType).toBe('capture-intent')
    journal.releaseWriter()
  })

  test('migration backup count hash and readback', () => {
    const root = tempRoot()
    const journal = new MeetingJournal(root)
    journal.acquireWriter()
    journal.commit({
      workspaceId: 'ws',
      meetingId: 'm1',
      expectedRevision: 0,
      commandId: 'c1',
      events: [created('ws', 'm1')],
      outboxEntries: [],
    })
    journal.releaseWriter()
    const report = migrateMeetingJournal(journal, 42)
    expect(report.meetingCount).toBe(1)
    expect(report.hash.length).toBe(64)
    expect(report.readbackOk).toBe(true)
    expect(report.blocked).toEqual([])
    expect(existsSync(join(report.backupDir, 'm1', 'snapshot.json'))).toBe(true)
  })

  test('unknown schema is not written', () => {
    const journal = new MeetingJournal(tempRoot())
    journal.acquireWriter()
    const meeting = emptyMeeting({ workspaceId: 'ws', meetingId: 'm1', now: 1 })
    expect(() =>
      journal.commit({
        workspaceId: 'ws',
        meetingId: 'm1',
        expectedRevision: 0,
        commandId: 'bad',
        events: [{ type: 'meeting.created', meeting: { ...meeting, schemaVersion: 99 as 1 } }],
        outboxEntries: [],
      }),
    ).toThrow(/unsupported meeting schema/)
    journal.releaseWriter()
  })
})
