import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importMeetingMedia } from '../import.ts'
import { MeetingImportError, MeetingMediaArchive } from '../import-media.ts'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

describe('meeting import (RMA-I004)', () => {
  test('permission-like rejects, replay is idempotent, corrupt empty media fails', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const first = importMeetingMedia({ workspaceId: 'ws', bytes, existing: [] })
    expect(first.status).toBe('ok')
    const replay = importMeetingMedia({ workspaceId: 'ws', bytes, existing: first.item ? [first.item] : [] })
    expect(replay.status).toBe('duplicate')
    expect(importMeetingMedia({ workspaceId: 'ws', bytes: new Uint8Array(), existing: [] }).status).toBe('rejected')
    expect(importMeetingMedia({ workspaceId: 'ws', bytes, existing: [], mimeType: 'video/mp4' }).reason).toBe('bad-format')
  })
})

const actor = {
  accountId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  authenticated: true,
}

const archiveGrant: MeetingGrant = {
  id: 'g-archive',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  capabilities: ['archive'],
  expiresAt: 9_000,
}

describe('meeting import (issue 360)', () => {
  test('replay of the same hash is one recording', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-mtg-import-'))
    const file = join(dir, 'clip.webm')
    const bytes = new Uint8Array([1, 2, 3, 4])
    writeFileSync(file, bytes)
    const archive = new MeetingMediaArchive(join(dir, 'store'))
    const first = await archive.importFile({
      workspaceId: 'ws-a',
      filePath: file,
      bytes,
      actor,
      grants: [archiveGrant],
      now: 1,
    })
    const second = await archive.importFile({
      workspaceId: 'ws-a',
      filePath: file,
      bytes,
      actor,
      grants: [archiveGrant],
      now: 2,
    })
    expect(second.sha256).toBe(first.sha256)
    expect(archive.list()).toHaveLength(1)
  })

  test('corrupt empty file is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-mtg-import-'))
    const file = join(dir, 'empty.webm')
    writeFileSync(file, '')
    const archive = new MeetingMediaArchive(join(dir, 'store'))
    await expect(archive.importFile({
      workspaceId: 'ws-a',
      filePath: file,
      bytes: new Uint8Array(),
      actor,
      grants: [archiveGrant],
      now: 1,
    })).rejects.toMatchObject({ code: 'corrupt-file' })
  })

  test('mic grant is not enough to import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-mtg-import-'))
    const file = join(dir, 'clip.webm')
    const bytes = new Uint8Array([9, 9])
    writeFileSync(file, bytes)
    const archive = new MeetingMediaArchive(join(dir, 'store'))
    await expect(archive.importFile({
      workspaceId: 'ws-a',
      filePath: file,
      bytes,
      actor,
      grants: [{ ...archiveGrant, capabilities: ['mic'] }],
      now: 1,
    })).rejects.toBeInstanceOf(MeetingImportError)
  })
})
