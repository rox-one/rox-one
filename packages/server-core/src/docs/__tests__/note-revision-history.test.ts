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

    // Same operationId is idempotent; does not grow or rewrite peers.
    await recordNoteRevision(root, {
      noteId,
      content: v2,
      revisionId: second.revisionId,
      operationId: 'op-2',
      committedAt: '2026-10-23T07:01:00.000Z',
    })
    expect(await listNoteRevisions(root, 'ws', noteId)).toHaveLength(2)
    expect((await getNoteRevision(root, 'ws', noteId, first.revisionId))?.content).toBe(v1)
    expect((await getNoteRevision(root, 'ws', noteId, first.revisionId))?.committedAt).toBe('2026-10-23T07:00:00.000Z')
  })

  it('keeps original metadata when restoring identical bytes as a new operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-identical-'))
    const noteId = 'doc'
    const body = '# Same\n'
    const rev = markdownRevision(body)
    await recordNoteRevision(root, {
      noteId, content: body, revisionId: rev, operationId: 'orig',
      committedAt: '2026-10-23T09:00:00.000Z',
    })
    await recordNoteRevision(root, {
      noteId, content: '# Other\n', revisionId: markdownRevision('# Other\n'), operationId: 'mid',
      previousRevision: rev, committedAt: '2026-10-23T09:01:00.000Z',
    })
    await recordNoteRevision(root, {
      noteId, content: body, revisionId: rev, operationId: 'restore-op',
      previousRevision: markdownRevision('# Other\n'), committedAt: '2026-10-23T09:02:00.000Z',
    })
    const listed = await listNoteRevisions(root, 'ws', noteId)
    expect(listed.map((e) => e.operationId)).toEqual(['restore-op', 'mid', 'orig'])
    const originals = listed.filter((e) => e.revisionId === rev)
    expect(originals).toHaveLength(2)
    expect(originals.find((e) => e.operationId === 'orig')?.committedAt).toBe('2026-10-23T09:00:00.000Z')
    expect(originals.find((e) => e.operationId === 'restore-op')?.committedAt).toBe('2026-10-23T09:02:00.000Z')
    expect((await getNoteRevision(root, 'ws', noteId, rev))?.content).toBe(body)
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

  it('getNoteRevision prefers sidecar and does not require other sources when found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-get-'))
    const noteId = 'solo'
    const content = '# Sidecar only\n'
    const revisionId = markdownRevision(content)
    await recordNoteRevision(root, {
      noteId, content, revisionId, operationId: 's1',
      committedAt: '2026-10-23T10:00:00.000Z',
    })
    const loaded = await getNoteRevision(root, 'ws', noteId, revisionId)
    expect(loaded?.content).toBe(content)
    expect(loaded?.operationId).toBe('s1')
    expect(await getNoteRevision(root, 'ws', noteId, 'sha256:missing')).toBeNull()
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

  it('merges native tips even when sidecar already has rows (sidecar is not full coverage)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-merge-native-'))
    const workspaceId = 'ws'
    const noteId = 'covered'
    const body = '# Covered\n'
    await recordNoteRevision(root, {
      noteId, content: body, revisionId: markdownRevision(body), operationId: 'side-1',
      committedAt: '2026-10-23T11:00:00.000Z', actorPrincipalId: 'local-uid:1:ws',
    })
    const nativeDir = join(root, '.rox-docs', 'commits', digest(`native\0${workspaceId}`))
    await mkdir(nativeDir, { recursive: true })
    // Pre-sidecar native-only tip must remain visible after the first sidecar row appears.
    await writeFile(join(nativeDir, `native-${'b'.repeat(64)}.json`), JSON.stringify({
      phase: 'committed',
      command: { changes: [{ kind: 'write', noteId, content: '# From native only\n', expectedRevision: null }] },
      receipt: { operationId: 'native-only', committedAt: '2026-10-23T10:55:00.000Z', actorPrincipalId: 'x' },
    }))
    const listed = await listNoteRevisions(root, workspaceId, noteId)
    expect(listed.map((e) => e.operationId)).toEqual(['side-1', 'native-only'])
  })

  it('early-filters native journals by noteId without requiring coverage skip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-native-filter-'))
    const workspaceId = 'ws'
    const noteId = 'target'
    const nativeDir = join(root, '.rox-docs', 'commits', digest(`native\0${workspaceId}`))
    await mkdir(nativeDir, { recursive: true })
    const content = '# Target from native\n'
    await writeFile(join(nativeDir, `native-${'c'.repeat(64)}.json`), JSON.stringify({
      phase: 'committed',
      command: { changes: [{ kind: 'write', noteId, content, expectedRevision: null }] },
      receipt: { operationId: 'native-hit', committedAt: '2026-10-23T12:00:00.000Z', actorPrincipalId: 'local-uid:9:ws' },
    }))
    await writeFile(join(nativeDir, `native-${'d'.repeat(64)}.json`), JSON.stringify({
      phase: 'committed',
      command: { changes: [{ kind: 'write', noteId: 'other', content: '# Other\n', expectedRevision: null }] },
      receipt: { operationId: 'native-miss', committedAt: '2026-10-23T12:01:00.000Z', actorPrincipalId: 'x' },
    }))
    const listed = await listNoteRevisions(root, workspaceId, noteId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.operationId).toBe('native-hit')
    expect(listed[0]?.actorPrincipalId).toBe('local-uid:9:ws')
    expect((await getNoteRevision(root, workspaceId, noteId, markdownRevision(content)))?.content).toBe(content)
  })

  it('serializes concurrent sidecar writes for the same noteId', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-note-history-lock-'))
    const noteId = 'locked'
    const bodies = Array.from({ length: 12 }, (_, i) => `# v${i}\n`)
    await Promise.all(bodies.map((content, i) => recordNoteRevision(root, {
      noteId,
      content,
      revisionId: markdownRevision(content),
      operationId: `op-${i}`,
      committedAt: `2026-10-23T10:${String(i).padStart(2, '0')}:00.000Z`,
    })))
    const listed = await listNoteRevisions(root, 'ws', noteId)
    expect(listed).toHaveLength(12)
    expect(new Set(listed.map((e) => e.operationId)).size).toBe(12)
    for (const body of bodies) {
      expect((await getNoteRevision(root, 'ws', noteId, markdownRevision(body)))?.content).toBe(body)
    }
  })
})
