import { describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  getNoteRevision,
  listNoteRevisions,
  recordNoteRevision,
} from '../note-revision-history.ts'

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const markdownRevision = (content: string) => `sha256:${digest(content)}`

describe('note-revision-history', () => {
  it('records, lists and loads revisions without rewriting older snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-'))
    const noteId = 'projects/plan'
    const v1 = '# One\n'
    const v2 = '# Two\n'
    const first = await recordNoteRevision(root, {
      noteId,
      content: v1,
      revisionId: markdownRevision(v1),
      operationId: 'op-1',
      committedAt: '2026-10-23T07:00:00.000Z',
      actorPrincipalId: 'local-uid:1:ws',
    })
    const second = await recordNoteRevision(root, {
      noteId,
      content: v2,
      revisionId: markdownRevision(v2),
      operationId: 'op-2',
      previousRevision: first.revisionId,
      committedAt: '2026-10-23T07:01:00.000Z',
      actorPrincipalId: 'local-uid:1:ws',
    })
    const listed = await listNoteRevisions(root, 'ws', noteId)
    expect(listed.map((entry) => entry.revisionId)).toEqual([second.revisionId, first.revisionId])
    expect(listed[0]?.byteSize).toBe(Buffer.byteLength(v2, 'utf8'))

    const loaded = await getNoteRevision(root, 'ws', noteId, first.revisionId)
    expect(loaded?.content).toBe(v1)

    // Re-record same revisionId must not grow duplicates.
    await recordNoteRevision(root, {
      noteId,
      content: v2,
      revisionId: second.revisionId,
      operationId: 'op-2',
      committedAt: '2026-10-23T07:01:00.000Z',
    })
    expect(await listNoteRevisions(root, 'ws', noteId)).toHaveLength(2)
    expect((await getNoteRevision(root, 'ws', noteId, first.revisionId))?.content).toBe(v1)
  })

  it('reuses committed MarkdownCommitStore journals for list and get', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-journal-'))
    const workspaceId = 'ws'
    const noteId = 'daily/2026-10-23'
    const content = '# From journal\n'
    const revisionId = markdownRevision(content)
    const directory = join(root, '.rox-docs', 'commits', digest(`${workspaceId}\0${noteId}`))
    await mkdir(directory, { recursive: true })
    const operationId = 'journal-op'
    const key = digest(`actor\0${operationId}`)
    await writeFile(join(directory, `${key}.json`), JSON.stringify({
      schemaVersion: 1,
      phase: 'committed',
      fingerprint: 'x',
      command: { noteId, content, operationId, expectedRevision: markdownRevision('') },
      receipt: {
        revision: revisionId,
        previousRevision: markdownRevision(''),
        committedAt: '2026-10-23T08:00:00.000Z',
        actorPrincipalId: 'actor',
        operationId,
        noteId,
      },
    }))
    const listed = await listNoteRevisions(root, workspaceId, noteId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.revisionId).toBe(revisionId)
    expect(listed[0]?.actorPrincipalId).toBe('actor')
    const body = await getNoteRevision(root, workspaceId, noteId, revisionId)
    expect(body?.content).toBe(content)
  })

  it('rejects unsafe note ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-bad-'))
    await expect(listNoteRevisions(root, 'ws', '../escape')).rejects.toThrow(/Invalid note ID/)
    await expect(recordNoteRevision(root, {
      noteId: 'a/../b',
      content: 'x',
      revisionId: 'r',
      operationId: 'o',
    })).rejects.toThrow(/Invalid note ID/)
  })
})

describe('conflict-safe restore semantics', () => {
  it('keeps the restored snapshot and appends a new tip revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-restore-'))
    const noteId = 'doc'
    const oldBody = '# Old\n'
    const currentBody = '# Current\n'
    const oldRev = markdownRevision(oldBody)
    const currentRev = markdownRevision(currentBody)
    await recordNoteRevision(root, {
      noteId, content: oldBody, revisionId: oldRev, operationId: 'a',
      committedAt: '2026-10-23T09:00:00.000Z',
    })
    await recordNoteRevision(root, {
      noteId, content: currentBody, revisionId: currentRev, operationId: 'b',
      previousRevision: oldRev, committedAt: '2026-10-23T09:01:00.000Z',
    })
    // Simulate restore: save old body as a NEW revision while current tip is expected.
    const restoredBody = oldBody
    const restoredRev = markdownRevision(restoredBody)
    // Same bytes as old → same revisionId; still must not erase history entries.
    await recordNoteRevision(root, {
      noteId, content: restoredBody, revisionId: restoredRev, operationId: 'c',
      previousRevision: currentRev, committedAt: '2026-10-23T09:02:00.000Z',
    })
    // Same bytes ⇒ same revisionId (content-addressed); the prior tip stays listed.
    const listed = await listNoteRevisions(root, 'ws', noteId)
    expect(listed.map((e) => e.revisionId).sort()).toEqual([oldRev, currentRev].sort())
    expect((await getNoteRevision(root, 'ws', noteId, oldRev))?.content).toBe(oldBody)
    expect((await getNoteRevision(root, 'ws', noteId, currentRev))?.content).toBe(currentBody)
    // A restore that changes bytes must mint a distinct tip while keeping both parents.
    const edited = '# Restored then edited\n'
    const editedRev = markdownRevision(edited)
    await recordNoteRevision(root, {
      noteId, content: edited, revisionId: editedRev, operationId: 'd',
      previousRevision: oldRev, committedAt: '2026-10-23T09:03:00.000Z',
    })
    const after = await listNoteRevisions(root, 'ws', noteId)
    expect(after.map((e) => e.revisionId).sort()).toEqual([oldRev, currentRev, editedRev].sort())
    expect((await getNoteRevision(root, 'ws', noteId, oldRev))?.content).toBe(oldBody)
  })
})
