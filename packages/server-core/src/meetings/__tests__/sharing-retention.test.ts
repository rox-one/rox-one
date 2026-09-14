import { describe, expect, test } from 'bun:test'
import { getMeeting, listMeetings, type MeetingQueryRecord } from '../queries.ts'
import {
  exportMeeting,
  importMeeting,
  renderMeetingMarkdown,
} from '../exports.ts'
import { deleteMeetingWithRetention } from '../retention.ts'
import {
  addLinkedNote,
  applyCollaborativeCorrection,
  buildSharedRecap,
  createShareLink,
  emptyMeetingShare,
  revokeMember,
  revokeShareLink,
  searchShareVisible,
  shareLinkAllows,
} from '../sharing.ts'

const owner = { accountId: 'acct-1', workspaceId: 'ws-a' }
const member = { accountId: 'acct-2', workspaceId: 'ws-a' }
const outsider = { accountId: 'acct-3', workspaceId: 'ws-a' }
const queryActor = { workspaceId: 'ws-a', allowed: true }

function seed() {
  let record = emptyMeetingShare({
    meetingId: 'm1',
    workspaceId: 'ws-a',
    title: 'Standup',
    ownerId: 'acct-1',
  })
  record = {
    ...record,
    transcript: 'Discussed the prototype and the salary-band.',
    audioSha256: 'sha-audio',
    embeddings: ['emb-1'],
    derivedSummary: 'salary-band recap',
    cache: { recap: 'salary-band recap' },
    sharedExports: ['export-1'],
    externalCopies: [{ id: 'mail-1', provider: 'mail', status: 'sent' }],
    members: [
      { accountId: 'acct-1', role: 'owner' },
      { accountId: 'acct-2', role: 'member' },
    ],
  }
  record = addLinkedNote(record, {
    id: 'note-private',
    ownerId: 'acct-1',
    audience: 'private',
    text: 'salary-band 9000',
    revision: 1,
  })
  record = addLinkedNote(record, {
    id: 'note-shared',
    ownerId: 'acct-1',
    audience: 'shared',
    text: 'roadmap Friday',
    revision: 1,
  })
  return record
}

describe('meeting sharing, export, and retention (I032)', () => {
  test('member revoke hides private notes from recap, search, and export', () => {
    const record = seed()
    const recap = buildSharedRecap(record, member)
    expect(recap.notes.map((note) => note.id)).toEqual(['note-shared'])
    expect(recap.text).toContain('roadmap')
    expect(recap.text).not.toContain('salary-band 9000')
    expect(recap.excludedPrivate).toBe(true)
    expect(searchShareVisible(record, member, 'salary-band')).toBe(false)
    expect(searchShareVisible(record, member, 'roadmap')).toBe(true)
    const revoked = revokeMember(record, owner, 'acct-2', 10)
    if ('ok' in revoked) throw new Error('expected record')
    expect(buildSharedRecap(revoked, member, 10).notes).toEqual([])
    expect(exportMeeting(revoked, member, { format: 'json', now: 10 }).ok).toBe(false)
  })

  test('share link revoke and concurrent correction conflict', () => {
    const record = seed()
    const created = createShareLink(record, owner, ['acct-2'])
    if ('ok' in created) throw new Error('expected link')
    expect(shareLinkAllows(created.link, 'acct-2')).toBe(true)
    const revoked = revokeShareLink(created.record, owner, created.link.id, 5)
    if ('ok' in revoked) throw new Error('expected record')
    const link = revoked.links[0]!
    expect(shareLinkAllows(link, 'acct-2', 5)).toBe(false)
    const first = applyCollaborativeCorrection(record, owner, {
      id: 'c1',
      segmentId: 'seg-1',
      text: 'Срок — понедельник',
      expectedRevision: record.revision,
    })
    if ('ok' in first) throw new Error('expected record')
    const conflict = applyCollaborativeCorrection(first, member, {
      id: 'c1',
      segmentId: 'seg-1',
      text: 'Срок — пятница',
      expectedRevision: record.revision,
    })
    expect('ok' in conflict && conflict.ok === false && conflict.code === 'conflict').toBe(true)
    expect(first.corrections[0]?.text).toBe('Срок — понедельник')
  })

  test('export/import round-trips links and clips without copying private notes to a shared audience', () => {
    const record = seed()
    const clip = { startMs: 0, endMs: 1000, text: 'прототип' }
    const shared = exportMeeting(record, owner, { format: 'markdown', audience: 'shared', clip })
    expect(shared.ok).toBe(true)
    if (!shared.ok) return
    expect(shared.bundle.notes.map((note) => note.id)).toEqual(['note-shared'])
    expect(renderMeetingMarkdown(shared.bundle)).toContain('прототип')
    expect(renderMeetingMarkdown(shared.bundle)).not.toContain('salary-band 9000')
    const owned = exportMeeting(record, owner, { format: 'json', audience: 'owner' })
    expect(owned.ok).toBe(true)
    if (!owned.ok) return
    expect(owned.bundle.notes.some((note) => note.audience === 'private')).toBe(true)
    expect(owned.bundle.links).toEqual([
      { kind: 'note', id: 'note-private' },
      { kind: 'note', id: 'note-shared' },
    ])
    const imported = importMeeting(owned.bundle, owner)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.record.notes.map((note) => note.id).sort()).toEqual(['note-private', 'note-shared'])
    expect(exportMeeting(record, outsider, { format: 'json' }).ok).toBe(false)
  })

  test('delete tombstones the meeting, cascades indexes, and marks external copies retained', () => {
    const record = seed()
    const meetings: MeetingQueryRecord[] = [{
      id: 'm1',
      workspaceId: 'ws-a',
      title: 'Standup',
      updatedAt: 1,
      transcript: 'salary-band',
    }]
    const deleted = deleteMeetingWithRetention({
      record,
      meetings,
      actor: queryActor,
      now: 9,
      indexKeys: ['meetings:m1', 'embeddings:m1'],
    })
    expect(deleted.record.deleted).toBe(true)
    expect(deleted.record.transcript).toBeUndefined()
    expect(deleted.record.audioSha256).toBeUndefined()
    expect(deleted.record.embeddings).toEqual([])
    expect(deleted.record.cache).toEqual({})
    expect(deleted.record.sharedExports).toEqual([])
    expect(deleted.record.notes.every((note) => note.text === '')).toBe(true)
    expect(deleted.cascade.externalCopies).toEqual([
      { id: 'mail-1', provider: 'mail', status: 'external-retained' },
    ])
    expect(deleted.cascade.nativeNotesPreserved).toBe(true)
    expect(deleted.cascade.nativeTasksPreserved).toBe(true)
    expect(getMeeting(deleted.query, 'm1', queryActor).state).toBe('deleted')
    expect(listMeetings({ meetings: deleted.query, actor: queryActor, limit: 10 }).state).toBe('empty')
    expect(exportMeeting(deleted.record, owner, { format: 'json' }).code).toBe('deleted')
  })
})
