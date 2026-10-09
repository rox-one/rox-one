import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, lastSnapshot, listRepoFiles, readSnapshotFile, readSnapshots, snapshotDiff, type SnapshotFileRef } from '../snapshots'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('snapshots fallback', () => {
  test('records full trees, diffs between snapshots and reads files', () => {
    const repo = tempDir('snap')
    mkdirSync(join(repo, 'lessons'), { recursive: true })
    writeFileSync(join(repo, 'MEMORY.md'), 'a\nb\n')
    writeFileSync(join(repo, 'lessons', 'x.md'), 'x\n')

    const t1 = new Date('2026-10-09T10:00:00.000Z')
    const first = createSnapshot(repo, { message: 'memory(main): first', now: t1 })
    expect(first.appended).toBe(true)
    expect(first.entry.parent).toBeNull()
    expect(first.entry.files.map((file) => [file.path, file.op])).toEqual([
      ['MEMORY.md', 'added'],
      ['lessons/x.md', 'added'],
    ])

    // unchanged tree -> no-op: nothing appended, the previous entry is returned
    const noop = createSnapshot(repo, { message: 'memory(main): noop', now: new Date('2026-10-09T10:00:01.000Z') })
    expect(noop.appended).toBe(false)
    expect(noop.entry.id).toBe(first.entry.id)
    expect(readFileSync(join(repo, '.snapshots', 'index.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)

    writeFileSync(join(repo, 'MEMORY.md'), 'a\nb\nc\n')
    writeFileSync(join(repo, 'lessons', 'y.md'), 'y\n')
    unlinkSync(join(repo, 'lessons', 'x.md'))
    const second = createSnapshot(repo, { message: 'memory(main): second', now: new Date('2026-10-09T11:00:00.000Z') })
    expect(second.appended).toBe(true)
    expect(second.entry.parent).toBe(first.entry.id)
    expect(second.entry.files.map((file) => [file.path, file.op])).toEqual([
      ['MEMORY.md', 'modified'],
      ['lessons/x.md', 'deleted'],
      ['lessons/y.md', 'added'],
    ])

    const entries = readSnapshots(repo)
    expect(entries.map((entry) => entry.id)).toEqual([first.entry.id, second.entry.id])
    expect(lastSnapshot(repo)?.id).toBe(second.entry.id)
    expect(readFileSync(join(repo, '.snapshots', 'index.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)

    const diff = snapshotDiff(repo, first.entry.id, second.entry.id)
    const memory = diff.find((file) => file.path === 'MEMORY.md')
    expect(memory).toMatchObject({ op: 'modified', additions: 1, deletions: 0 })
    expect(diff.find((file) => file.path === 'lessons/x.md')).toMatchObject({ op: 'deleted', additions: 0, deletions: 1 })
    expect(diff.find((file) => file.path === 'lessons/y.md')).toMatchObject({ op: 'added', additions: 1, deletions: 0 })

    expect(readSnapshotFile(repo, first.entry.id, 'MEMORY.md')).toBe('a\nb\n')
    expect(readSnapshotFile(repo, first.entry.id, '../escape.md')).toBeNull()
  })

  test('excludes snapshot/conflict dirs and tmp files from the tracked tree', () => {
    const repo = tempDir('snap-exclude')
    mkdirSync(join(repo, '.snapshots', 'x'), { recursive: true })
    mkdirSync(join(repo, '.conflicts', 'x'), { recursive: true })
    mkdirSync(join(repo, '.git-rox'), { recursive: true })
    writeFileSync(join(repo, 'MEMORY.md'), 'a\n')
    writeFileSync(join(repo, 'MEMORY.md.123.tmp'), 'tmp\n')
    writeFileSync(join(repo, '.snapshots', 'x', 'f.md'), 'nested\n')
    createSnapshot(repo, { message: 'm', now: new Date('2026-10-09T12:00:00.000Z') })
    expect(listRepoFiles(repo)).toEqual(['MEMORY.md'])
    expect(existsSync(join(repo, '.snapshots', 'index.jsonl'))).toBe(true)
  })

  test('distinct ids for identical timestamps', () => {
    const repo = tempDir('snap-ids')
    writeFileSync(join(repo, 'a.md'), 'a\n')
    const now = new Date('2026-10-09T12:00:00.000Z')
    const a = createSnapshot(repo, { message: 'a', now })
    writeFileSync(join(repo, 'a.md'), 'b\n')
    const b = createSnapshot(repo, { message: 'b', now })
    expect(a.entry.id).not.toBe(b.entry.id)
  })

  test('F3: snapshotDiff honors a caller-supplied tree cache', () => {
    const repo = tempDir('snap-cache')
    writeFileSync(join(repo, 'MEMORY.md'), 'a\nb\n')
    const to = createSnapshot(repo, { message: 'to', now: new Date('2026-10-09T12:00:00.000Z') })

    // Without a cache the referenced (nonexistent) from-tree is empty.
    const uncached = snapshotDiff(repo, 'ghost-from', to.entry.id)
    expect(uncached.some((file) => file.path === 'ghost.md')).toBe(false)

    // A prefilled cache injects a synthetic from-tree; the diff must reflect it.
    const cache = new Map<string, SnapshotFileRef[]>([
      [
        'ghost-from',
        [
          { path: 'ghost.md', op: 'modified', hash: 'deadbeef' },
          { path: 'MEMORY.md', op: 'modified', hash: '0000000000000000000000000000000000000000' },
        ],
      ],
    ])
    const cached = snapshotDiff(repo, 'ghost-from', to.entry.id, cache)
    expect(cached.find((file) => file.path === 'ghost.md')).toMatchObject({ op: 'deleted', additions: 0, deletions: 0 })
    expect(cached.find((file) => file.path === 'MEMORY.md')).toMatchObject({ op: 'modified' })
    // the toId tree was memoized into the same cache too
    expect(cache.has(to.entry.id)).toBe(true)
  })
})