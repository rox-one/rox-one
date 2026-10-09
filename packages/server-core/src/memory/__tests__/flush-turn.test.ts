/**
 * c1.8 flush turn: pending memory writes are committed at the turn/session
 * boundary deterministically, idempotently and crash-safely. A crash between the
 * durable write-intent and the corpus write leaves a recoverable state — never a
 * half-written corpus entry and never a duplicate on retry.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MemoryProposal } from '@rox/shared/memory/proposals'
import { MemoryProposalStore } from '../MemoryProposalStore'
import { approveMemoryProposalDurably } from '../approve-memory-proposal'
import { flushMemoryWrites } from '../flush-turn'
import { parseLessons } from '../LessonStore'

const roots: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-flush-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function proposal(id: string, text: string): MemoryProposal {
  const ts = '2026-01-01T00:00:00.000Z'
  return {
    id,
    text,
    kind: 'rule',
    status: 'pending',
    sessionId: 's1',
    workspaceId: 'ws1',
    sourceMessageIds: ['m1'],
    provenance: { trigger: 'close' },
    riskFlags: [],
    conflicts: [],
    editHistory: [],
    createdAt: ts,
    updatedAt: ts,
    cost: { tokens: 5, model: 'rox/fast' },
  }
}

function lessonCount(wsRoot: string): number {
  const path = join(wsRoot, 'memory', 'lessons.jsonl')
  if (!existsSync(path)) return 0
  return parseLessons(readFileSync(path, 'utf8')).length
}

describe('flush turn (c1.8)', () => {
  test('recovers a write interrupted mid-approval without duplicating the corpus entry', () => {
    const ws = tmp()
    const store = new MemoryProposalStore(join(ws, 'memory'))
    store.save(proposal('mp_a', 'Always run bun test before calling a change done'))

    // Simulate a crash right after the durable write-intent is persisted but
    // before the canonical corpus write lands.
    expect(() =>
      approveMemoryProposalDurably({
        store,
        workspaceRoot: ws,
        proposalId: 'mp_a',
        scope: 'workspace',
        now: new Date('2026-01-01T00:00:00.000Z'),
        faultAfterIntent: () => {
          throw new Error('simulated crash mid-flush')
        },
      }),
    ).toThrow('simulated crash mid-flush')

    // Recoverable state: the intent survived, no corpus entry is written.
    const interrupted = store.get('mp_a')
    expect(interrupted?.approval).toBeDefined()
    expect(interrupted?.approval?.writtenAt).toBeUndefined()
    expect(lessonCount(ws)).toBe(0)

    // The flush turn replays it deterministically and durably.
    const first = flushMemoryWrites({ store, workspaceRoot: ws, now: new Date('2026-01-01T00:00:10.000Z') })
    expect(first.flushed).toEqual(['mp_a'])
    expect(first.failed).toEqual([])
    expect(lessonCount(ws)).toBe(1)
    const lessons = parseLessons(readFileSync(join(ws, 'memory', 'lessons.jsonl'), 'utf8'))
    expect(lessons[0]?.rule).toBe('Always run bun test before calling a change done')
    expect(store.get('mp_a')?.approval?.writtenAt).toBeDefined()

    // Idempotent: a second flush finds nothing pending and appends nothing.
    const second = flushMemoryWrites({ store, workspaceRoot: ws })
    expect(second.flushed).toEqual([])
    expect(second.failed).toEqual([])
    expect(lessonCount(ws)).toBe(1)
  })

  test('flushes pending intents in deterministic id order and ignores non-pending ones', () => {
    const ws = tmp()
    const store = new MemoryProposalStore(join(ws, 'memory'))
    // Insert out of order; each gets a durable intent (crash immediately).
    for (const id of ['mp_c', 'mp_a', 'mp_b']) {
      store.save(proposal(id, `rule ${id}`))
      expect(() =>
        approveMemoryProposalDurably({
          store,
          workspaceRoot: ws,
          proposalId: id,
          scope: 'workspace',
          now: new Date('2026-01-01T00:00:00.000Z'),
          faultAfterIntent: () => {
            throw new Error('crash')
          },
        }),
      ).toThrow('crash')
    }
    const result = flushMemoryWrites({ store, workspaceRoot: ws })
    expect(result.flushed).toEqual(['mp_a', 'mp_b', 'mp_c'])
    expect(lessonCount(ws)).toBe(3)
  })

  test('flush is a no-op with nothing pending', () => {
    const ws = tmp()
    const store = new MemoryProposalStore(join(ws, 'memory'))
    const result = flushMemoryWrites({ store, workspaceRoot: ws })
    expect(result).toEqual({ flushed: [], failed: [] })
    expect(existsSync(join(ws, 'memory', 'lessons.jsonl'))).toBe(false)
  })
})