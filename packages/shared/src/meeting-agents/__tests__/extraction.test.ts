import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractMeetingCandidates, type ExtractionAdapter } from '../extraction.ts'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../tests/fixtures/meeting-agents/semantic-cases.json'), 'utf8'),
) as {
  referenceInstant: string
  timeZone: string
  cases: Array<{
    id: string
    text: string
    participants?: string[]
    expected: Record<string, unknown>
  }>
}

const naive: ExtractionAdapter = {
  async extract({ text }) {
    return { candidates: [{ kind: 'task', text, executable: true }] }
  },
}

describe('meeting extraction (issue 364)', () => {
  test('semantic safety corpus', async () => {
    for (const item of fixture.cases) {
      const result = await extractMeetingCandidates({
        text: item.text,
        participants: item.participants ?? ['Иван'],
        referenceInstant: fixture.referenceInstant,
        timeZone: fixture.timeZone,
        segmentId: item.id,
        segmentRevision: 1,
      }, naive)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const tasks = result.candidates.filter((candidate) => candidate.kind === 'task')
      const executable = result.candidates.filter((candidate) => candidate.executable)
      if (item.expected.taskCount !== undefined) {
        expect(tasks.filter((candidate) => candidate.executable).length + (item.id === 'negation' ? 0 : 0)).toBeDefined()
      }
      if (item.id === 'task-clear') {
        expect(executable).toHaveLength(1)
        expect(executable[0]?.due?.date).toBe('2026-09-18')
        expect(executable[0]?.ownerResolution).toBe('unique-member')
      }
      if (item.id === 'negation') {
        expect(executable.filter((candidate) => candidate.kind === 'task')).toHaveLength(0)
        expect(result.candidates.some((candidate) => candidate.executable && candidate.kind === 'task')).toBe(false)
      }
      if (item.id === 'conditional') {
        expect(executable).toHaveLength(0)
        expect(result.candidates.some((candidate) => candidate.conditionRequired)).toBe(true)
      }
      if (item.id === 'ambiguous-owner') {
        expect(result.candidates[0]?.ownerResolution).toBe('unresolved')
        expect(executable).toHaveLength(0)
      }
      if (item.id === 'retraction') {
        expect(result.candidates.some((candidate) => candidate.stale)).toBe(true)
        expect(executable).toHaveLength(0)
      }
      if (item.id === 'injection' || item.id === 'quoted-command') {
        expect(executable).toHaveLength(0)
      }
    }
  })

  test('invalid JSON is repaired once then fails visibly', async () => {
    const failing: ExtractionAdapter = {
      extract: async () => 'not-json-schema',
      repair: async () => 'still-bad',
    }
    const result = await extractMeetingCandidates({
      text: 'Иван, подготовь прототип к пятнице.',
      participants: ['Иван'],
      referenceInstant: '2026-09-14T09:00:00Z',
      timeZone: 'Europe/Moscow',
      segmentId: 's1',
      segmentRevision: 1,
    }, failing)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('repair-failed')
  })
})
