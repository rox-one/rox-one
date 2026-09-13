import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingJournal, MeetingRevisionConflict } from '../journal.ts'
import { MeetingRepository } from '../repository.ts'
import { migrateLegacyLiveResult } from '../migrations.ts'

function tmpJournal() {
  const dir = mkdtempSync(join(tmpdir(), 'rox-meetings-'))
  return { dir, journal: new MeetingJournal(dir, 'ws-a') }
}

const meeting = {
  schemaVersion: 2,
  kind: 'meeting',
  ref: { workspaceId: 'ws-a', entityId: 'mtg-1', revisionId: 'r1' },
  title: 'Weekly',
  createdAt: 1,
  updatedAt: 1,
}

describe('meeting journal (issue 357)', () => {
  test('stale expectedRevision is rejected', async () => {
    const { journal } = tmpJournal()
    await journal.load()
    await journal.append({
      commandId: 'c1',
      workspaceId: 'ws-a',
      expectedRevision: 0,
      type: 'create-meeting',
      payload: {},
    }, { meeting }, 'mtg-1')
    await expect(journal.append({
      commandId: 'c2',
      workspaceId: 'ws-a',
      expectedRevision: 0,
      type: 'create-meeting',
      payload: {},
    }, { meeting }, 'mtg-1')).rejects.toBeInstanceOf(MeetingRevisionConflict)
  })

  test('repeated commandId does not create a second effect', async () => {
    const { dir, journal } = tmpJournal()
    const repo = new MeetingRepository(journal)
    const command = {
      commandId: 'create-1',
      workspaceId: 'ws-a',
      expectedRevision: 0,
      type: 'create-meeting' as const,
      payload: { meeting },
    }
    const first = await repo.apply(command)
    const second = await repo.apply({ ...command, expectedRevision: 1 })
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect((await journal.load()).events).toHaveLength(1)
    const restarted = new MeetingRepository(new MeetingJournal(dir, 'ws-a'))
    await restarted.load()
    expect(restarted.list()).toHaveLength(1)
  })

  test('corrupt tail is quarantined and complete events survive restart', async () => {
    const { dir, journal } = tmpJournal()
    await journal.load()
    await journal.append({
      commandId: 'c1',
      workspaceId: 'ws-a',
      expectedRevision: 0,
      type: 'create-meeting',
      payload: { meeting },
    }, { meeting }, 'mtg-1')
    const eventsPath = join(dir, 'events.jsonl')
    writeFileSync(eventsPath, `${readFileSync(eventsPath, 'utf8')}{"seq":2,"commandId":"c2","type":"create-meeting","at":2,"payload":{"meeting":`)
    const recovered = new MeetingJournal(dir, 'ws-a')
    const snapshot = await recovered.load()
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.quarantined.some((item) => item.reason === 'corrupt-tail')).toBe(true)
    expect(snapshot.revision).toBe(1)
  })

  test('legacy live result migrates to unknown verification', () => {
    const report = migrateLegacyLiveResult({ ok: true, state: 'live', entityId: 'meeting:mtg-1' })
    expect(report.count).toBe(1)
    expect(report.readback.verification).toBe('unknown')
    expect(report.backupHash).toHaveLength(64)
  })
})
