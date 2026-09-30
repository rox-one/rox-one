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
  it('round-trips new optional fields and drops malformed ones', () => {
    writeFileSync(file, JSON.stringify({ ...make('t'), tags: ['ui', 3], pinned: 'yes', mergedFrom: ['old rule'] }) + '\n')
    const lesson = new LessonStore(file, 'workspace').list()[0]
    expect(lesson.tags).toEqual(['ui'])
    expect(lesson.pinned).toBeUndefined()
    expect(lesson.mergedFrom).toEqual(['old rule'])
  })
})
