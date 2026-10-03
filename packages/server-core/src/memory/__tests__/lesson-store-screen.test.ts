/**
 * Memory screen fields: pinned/disabled context selection, usage history,
 * backups before rewrites and loss-free pruning (archive instead of drop).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LESSON_LIMITS, type Lesson } from '@craft-agent/shared/memory/types'
import { selectContextLessons } from '@craft-agent/shared/memory/context-select'
import { LessonStore, resetLessonBackupsForTests } from '../LessonStore'

let dir: string
let file: string
const make = (rule: string, extra: Partial<Lesson> = {}): Lesson => ({
  ts: '2026-09-01T00:00:00.000Z', rule, category: 'preference', scope: 'workspace', source: { trigger: 'distillation', sessionId: 's1' }, ...extra,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lesson-screen-'))
  file = join(dir, 'lessons.jsonl')
  resetLessonBackupsForTests()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('context selection', () => {
  it('skips disabled, puts pinned first, then most recent', () => {
    const lessons = [make('a', { pinned: true }), make('b'), make('c', { disabled: true }), make('d')]
    expect(selectContextLessons(lessons, 3).map(l => l.rule)).toEqual(['a', 'd', 'b'])
    expect(selectContextLessons(lessons, 2).map(l => l.rule)).toEqual(['a', 'd'])
  })
  it('forContext uses the same rules', () => {
    writeFileSync(file, [make('old', { pinned: true }), make('off', { disabled: true }), make('new')].map(l => JSON.stringify(l)).join('\n') + '\n')
    expect(new LessonStore(file, 'workspace').forContext().map(l => l.rule)).toEqual(['old', 'new'])
  })
})

describe('usage history', () => {
  it('touchUsed appends capped usedAt timestamps', () => {
    writeFileSync(file, JSON.stringify(make('x')) + '\n')
    const store = new LessonStore(file, 'workspace')
    for (let i = 0; i < LESSON_LIMITS.usedAt + 3; i++) store.touchUsed(['x'])
    const lesson = store.list()[0]
    expect(lesson.usageCount).toBe(LESSON_LIMITS.usedAt + 3)
    expect(lesson.usedAt?.length).toBe(LESSON_LIMITS.usedAt)
  })
})

describe('backups and loss-free pruning', () => {
  it('snapshots lessons.jsonl verbatim once before the first rewrite', () => {
    const original = [make('a'), make('b')].map(l => JSON.stringify(l)).join('\n') + '\n'
    writeFileSync(file, original)
    const store = new LessonStore(file, 'workspace')
    store.update('a', { pinned: true })
    store.update('b', { disabled: true })
    const snaps = readdirSync(join(dir, 'backups'))
    expect(snaps.length).toBe(1)
    expect(readFileSync(join(dir, 'backups', snaps[0]), 'utf8')).toBe(original)
  })
  it('archives overflow instead of dropping it, keeping pinned lessons', () => {
    const lessons = Array.from({ length: LESSON_LIMITS.total }, (_, i) => make(`rule ${i}`, i === 0 ? { pinned: true } : {}))
    writeFileSync(file, lessons.map(l => JSON.stringify(l)).join('\n') + '\n')
    const store = new LessonStore(file, 'workspace')
    store.add(make('fresh'))
    const kept = store.list().map(l => l.rule)
    expect(kept.length).toBe(LESSON_LIMITS.total)
    expect(kept).toContain('rule 0')
    expect(kept).not.toContain('rule 1')
    const archive = join(dir, 'lessons.archive.jsonl')
    expect(existsSync(archive)).toBe(true)
    expect(readFileSync(archive, 'utf8')).toContain('"rule 1"')
  })
  it('recovers overflow archive exactly once after an interrupted active-file rename', () => {
    const active = `${JSON.stringify(make('kept'))}\n`
    writeFileSync(file, active)
    const archived = make('archived')
    const pending = `${file}.archive.pending`
    writeFileSync(pending, JSON.stringify({ id: 'recovery-1', active, archived: [archived] }))
    const archive = join(dir, 'lessons.archive.jsonl')

    const store = new LessonStore(file, 'workspace')
    expect(store.list().map((lesson) => lesson.rule)).toEqual(['kept'])
    const rows = readFileSync(archive, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rule: 'archived', archiveTransactionId: 'recovery-1' })
    expect(store.list()).toHaveLength(1)
    expect(readFileSync(archive, 'utf8').trim().split('\n')).toHaveLength(1)
    expect(existsSync(pending)).toBe(false)
  })

  it('does not mutate lessons when the required pre-rewrite backup cannot be created', () => {
    const original = `${JSON.stringify(make('preserve me'))}\n`
    writeFileSync(file, original)
    writeFileSync(join(dir, 'backups'), 'not a directory')
    const store = new LessonStore(file, 'workspace')

    expect(() => store.update('preserve me', { pinned: true })).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(store.list()[0]?.pinned).toBeUndefined()
  })
  it('round-trips new optional fields and drops malformed ones', () => {
    writeFileSync(file, JSON.stringify({ ...make('t'), tags: ['ui', 3], pinned: 'yes', mergedFrom: ['old rule'] }) + '\n')
    const lesson = new LessonStore(file, 'workspace').list()[0]
    expect(lesson.tags).toEqual(['ui'])
    expect(lesson.pinned).toBeUndefined()
    expect(lesson.mergedFrom).toEqual(['old rule'])
  })
})

describe('private lesson owners and recovery', () => {
  it('keeps duplicate text, context selection, usage, and mutation inside the exact owner', () => {
    const ownerA = { issuer: 'authority-a', subject: 'user-1' }
    const ownerB = { issuer: 'authority-a', subject: 'user-2' }
    const store = new LessonStore(file, 'workspace')
    store.add(make('same rule', { owner: ownerA }))
    store.add(make('same rule', { owner: ownerB }))
    store.add(make('legacy machine rule'))

    expect(store.listForOwner(ownerA).map((lesson) => lesson.rule)).toEqual(['same rule'])
    expect(store.listForOwner(ownerB).map((lesson) => lesson.rule)).toEqual(['same rule'])
    expect(store.listForOwner().map((lesson) => lesson.rule)).toEqual(['legacy machine rule'])
    expect(store.forContext(ownerA).map((lesson) => lesson.owner?.subject)).toEqual(['user-1'])
    expect(store.touchUsed(['same rule'], ownerA)).toBe(1)
    expect(store.listForOwner(ownerA)[0]?.usageCount).toBe(1)
    expect(store.listForOwner(ownerB)[0]?.usageCount).toBeUndefined()

    store.update('same rule', { pinned: true, owner: ownerB } as Partial<Lesson>, 'user', ownerA)
    expect(store.listForOwner(ownerA)[0]?.pinned).toBe(true)
    expect(store.listForOwner(ownerA)[0]?.owner).toEqual(ownerA)
    store.update('same rule', { disabled: true }, 'user', ownerB)
    expect(store.listForOwner(ownerB)[0]?.disabled).toBe(true)
    expect(store.listForOwner(ownerA)[0]?.disabled).toBeUndefined()
    expect(store.delete('same rule', 'user', ownerA)).toBe(true)
    expect(store.listForOwner(ownerB)).toHaveLength(1)
  })

  it('lists and restores only an archived lesson for the requesting owner', () => {
    const owner = { issuer: 'authority-a', subject: 'user-1' }
    const otherOwner = { issuer: 'authority-a', subject: 'user-2' }
    const lessons = Array.from({ length: LESSON_LIMITS.total }, (_, i) => make(`rule ${i}`, { owner }))
    lessons.push(make('other owner rule', { owner: otherOwner }))
    writeFileSync(file, lessons.map((lesson) => JSON.stringify(lesson)).join('\n') + '\n')
    const store = new LessonStore(file, 'workspace')
    store.add(make('owner replacement', { owner }))
    const archived = store.listArchivedForOwner(owner)
    expect(archived.map((entry) => entry.lesson.rule)).toEqual(['rule 0'])
    expect(store.listArchivedForOwner(otherOwner)).toEqual([])

    const restored = store.restoreArchivedForOwner(owner, archived[0]!.id)
    expect(restored?.rule).toBe('rule 0')
    expect(store.listForOwner(owner).map((lesson) => lesson.rule)).toContain('rule 0')
    expect(store.restoreArchivedForOwner(owner, archived[0]!.id)).toBeNull()
  })
})
