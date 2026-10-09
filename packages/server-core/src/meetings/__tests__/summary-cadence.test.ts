import { describe, expect, test } from 'bun:test'
import { runSummaryCadence, summaryWindow } from '../summary-cadence.ts'
import type { ObserveTranscriptLine } from '../session-transcript-store.ts'
import type { MeetingSessionRecord } from '@rox/core/meetings'

const INTERVAL = 1000

function session(createdAt = 0): Pick<MeetingSessionRecord, 'sessionId' | 'meetingId' | 'createdAt'> {
  return { sessionId: 'sess', meetingId: 'm1', createdAt }
}

function line(seq: number, text: string, at: number): ObserveTranscriptLine {
  return { seq, key: `k${seq}`, sessionId: 'sess', speaker: '', text, at, final: true }
}

describe('rolling 5-minute summary cadence (d2.5)', () => {
  test('windows are anchored at session start', () => {
    expect(summaryWindow(0, 0, 300000)).toMatchObject({ windowStartMs: 0, windowEndMs: 300000, index: 0 })
    expect(summaryWindow(299999, 0, 300000).index).toBe(0)
    expect(summaryWindow(300000, 0, 300000).index).toBe(1)
    expect(summaryWindow(310000, 300000, 300000)).toMatchObject({ windowStartMs: 300000, windowEndMs: 600000 })
  })

  test('runs the model step only at the window boundary', async () => {
    const calls: number[] = []
    const lines = [line(0, 'решили выпустить релиз', 100)]
    const first = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines,
      now: 500,
      intervalMs: INTERVAL,
      model: async () => {
        calls.push(1)
        return JSON.stringify({ text: 'модель A', sourceSegmentIds: ['k0'] })
      },
    })
    expect(first.generator).toBe('model')
    expect(first.text).toBe('модель A')

    const sameWindow = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines,
      now: 800,
      intervalMs: INTERVAL,
      previous: first,
      model: async () => {
        calls.push(2)
        return JSON.stringify({ text: 'model B', sourceSegmentIds: ['k0'] })
      },
    })
    expect(sameWindow).toEqual(first)
    expect(calls).toHaveLength(1)

    const nextWindow = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines: [line(1, 'проверить бюджет', 1100)],
      now: 1500,
      intervalMs: INTERVAL,
      previous: first,
      model: async () => {
        calls.push(3)
        return JSON.stringify({ text: 'model C', sourceSegmentIds: ['k1'] })
      },
    })
    expect(nextWindow.generator).toBe('model')
    expect(nextWindow.text).toBe('model C')
    expect(calls).toHaveLength(2)
  })

  test('invalidates the previous summary when the transcript revision advances', async () => {
    let calls = 0
    const lines = [line(0, 'решили выпустить релиз', 100)]
    const first = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines,
      now: 500,
      intervalMs: INTERVAL,
      model: async () => {
        calls += 1
        return JSON.stringify({ text: 'model A', sourceSegmentIds: ['k0'] })
      },
    })
    const invalidated = await runSummaryCadence({
      session: session(0),
      revision: 2,
      lines,
      now: 600,
      intervalMs: INTERVAL,
      previous: first,
      model: async () => {
        calls += 1
        return JSON.stringify({ text: 'model B', sourceSegmentIds: ['k0'] })
      },
    })
    expect(invalidated.invalidatedByRevision).toBe(2)
    expect(invalidated.text).toBe('model A')
    expect(calls).toBe(1)
  })

  test('falls back to the deterministic heuristic when the model step fails', async () => {
    const failed = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines: [line(0, 'решили выпустить релиз', 100), line(1, 'надо проверить бюджет', 200)],
      now: 500,
      intervalMs: INTERVAL,
      model: async () => {
        throw new Error('model-unavailable')
      },
    })
    expect(failed.generator).toBe('heuristic')
    expect(failed.text).toBe('решили выпустить релиз • надо проверить бюджет')
    expect(failed.sourceSegmentIds).toEqual(['k0', 'k1'])
  })

  test('falls back when the model step times out or emits invalid JSON', async () => {
    const timedOut = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines: [line(0, 'есть риск сорвать сроки', 100)],
      now: 500,
      intervalMs: INTERVAL,
      modelTimeoutMs: 5,
      model: () => new Promise<string>(() => {}),
    })
    expect(timedOut.generator).toBe('heuristic')
    expect(timedOut.text).toBe('есть риск сорвать сроки')

    const invalid = await runSummaryCadence({
      session: session(0),
      revision: 1,
      lines: [line(0, 'риск сорвать сроки', 100)],
      now: 500,
      intervalMs: INTERVAL,
      model: async () => JSON.stringify({ text: 'без цитаты', sourceSegmentIds: ['missing'] }),
    })
    expect(invalid.generator).toBe('heuristic')
  })
})