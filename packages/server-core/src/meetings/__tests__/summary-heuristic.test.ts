import { describe, expect, test } from 'bun:test'
import { extractHeuristicNotes, heuristicSummary } from '../summary-heuristic.ts'
import type { ObserveTranscriptLine } from '../session-transcript-store.ts'

function line(seq: number, text: string, at = seq * 1000): ObserveTranscriptLine {
  return { seq, key: `k${seq}`, sessionId: 'sess', speaker: '', text, at, final: true }
}

describe('deterministic heuristic summary (d2.5 fallback)', () => {
  test('extracts decisions, actions and risks with RU-first patterns', () => {
    const notes = extractHeuristicNotes([
      line(0, 'Мы решили выпустить релиз в пятницу'),
      line(1, 'Нужно подготовить демо к встрече'),
      line(2, 'Есть риск сорвать сроки'),
      line(3, 'Просто обсуждение без вывода'),
    ])
    const byKind = (kind: string) => notes.filter((note) => note.kind === kind).map((note) => note.text)
    expect(byKind('decision')).toEqual(['Мы решили выпустить релиз в пятницу'])
    expect(byKind('action')).toEqual(['Нужно подготовить демо к встрече'])
    expect(byKind('risk')).toEqual(['Есть риск сорвать сроки'])
    expect(notes.every((note) => note.sourceSegmentIds.length === 1)).toBe(true)
  })

  test('heuristic summary is transcript-backed and deterministic', () => {
    const input = {
      sessionId: 'sess',
      meetingId: 'm1',
      windowStartMs: 0,
      windowEndMs: 300000,
      revision: 4,
      lines: [line(0, 'Решили перенести созвон'), line(1, 'Надо проверить бюджет')],
      now: 1234,
    }
    const first = heuristicSummary(input)
    const second = heuristicSummary(input)
    expect(first).toEqual(second)
    expect(first.generator).toBe('heuristic')
    expect(first.text).toBe('Решили перенести созвон • Надо проверить бюджет')
    expect(first.sourceSegmentIds).toEqual(['k0', 'k1'])
    expect(first.revision).toBe(4)
    expect(first.updatedAt).toBe(1234)
  })

  test('empty evidence yields an empty, labelled summary rather than invented prose', () => {
    const summary = heuristicSummary({
      sessionId: 'sess',
      meetingId: 'm1',
      windowStartMs: 0,
      windowEndMs: 300000,
      revision: 0,
      lines: [line(0, 'погода сегодня хорошая')],
      now: 1,
    })
    expect(summary.text).toBe('')
    expect(summary.sourceSegmentIds).toEqual([])
  })
})