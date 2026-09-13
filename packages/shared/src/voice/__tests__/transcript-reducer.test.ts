import { describe, expect, test } from 'bun:test'
import { applyTranscriptPatch } from '../transcript-reducer.ts'

describe('meeting transcript ordering', () => {
  test('ignores replay and older revisions without losing the corrected text', () => {
    const newer = {
      meetingId: 'm1',
      streamId: 's1',
      id: 'seg1',
      revision: 2,
      sequence: 3,
      startMs: 0,
      endMs: 1000,
      source: 'microphone' as const,
      speakerId: null,
      language: 'ru',
      text: 'Срок — понедельник',
      final: true,
    }
    const initial = { segments: {}, finalizedWatermark: 0 }
    const s1 = applyTranscriptPatch(initial, newer)
    const s2 = applyTranscriptPatch(s1, { ...newer, revision: 1, text: 'Срок — пятница' })
    const s3 = applyTranscriptPatch(s2, newer)
    expect(Object.keys(s3.segments)).toHaveLength(1)
    expect(s3.segments['s1:seg1']?.text).toBe('Срок — понедельник')
    expect(initial.segments).toEqual({})
  })

  test('same segmentId on two streams stays two segments', () => {
    const a = {
      meetingId: 'm1',
      streamId: 'mic',
      id: 'seg1',
      revision: 1,
      sequence: 1,
      startMs: 0,
      endMs: 10,
      source: 'microphone' as const,
      speakerId: null,
      language: 'ru',
      text: 'a',
      final: true,
    }
    const state = applyTranscriptPatch(applyTranscriptPatch({ segments: {}, finalizedWatermark: 0 }, a), {
      ...a,
      streamId: 'system',
      text: 'b',
    })
    expect(Object.keys(state.segments).sort()).toEqual(['mic:seg1', 'system:seg1'])
  })

  test('manual correction is a newer revision and replay cannot clobber it', () => {
    const original = {
      meetingId: 'm1',
      streamId: 's1',
      id: 'seg1',
      revision: 1,
      sequence: 1,
      startMs: 0,
      endMs: 10,
      source: 'microphone' as const,
      speakerId: null,
      language: 'ru',
      text: 'draft',
      final: true,
    }
    const corrected = { ...original, revision: 2, text: 'fixed', supersedesRevision: 1 }
    const state = applyTranscriptPatch(applyTranscriptPatch({ segments: {}, finalizedWatermark: 0 }, original), corrected)
    const replayed = applyTranscriptPatch(state, original)
    expect(replayed.segments['s1:seg1']?.text).toBe('fixed')
  })
})
