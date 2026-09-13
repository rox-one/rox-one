import { describe, expect, test } from 'bun:test'
import { applyTranscriptPatch, bindSpeaker, emptyTranscriptState } from '../transcript-reducer.ts'

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
    const initial = emptyTranscriptState()
    const s1 = applyTranscriptPatch(initial, newer)
    const s2 = applyTranscriptPatch(s1, { ...newer, revision: 1, text: 'Срок — пятница' })
    const s3 = applyTranscriptPatch(s2, newer)
    expect(Object.keys(s3.segments)).toHaveLength(1)
    expect(s3.segments['s1:seg1']?.text).toBe('Срок — понедельник')
    expect(initial.segments).toEqual({})
  })

  test('same segmentId on two streams stays distinct', () => {
    const base = {
      meetingId: 'm1',
      id: 'seg1',
      revision: 1,
      sequence: 1,
      startMs: 0,
      endMs: 10,
      source: 'microphone' as const,
      speakerId: 'spk-1',
      language: 'ru',
      text: 'one',
      final: true,
    }
    let state = emptyTranscriptState()
    state = applyTranscriptPatch(state, { ...base, streamId: 'mic' })
    state = applyTranscriptPatch(state, { ...base, streamId: 'system', text: 'two' })
    expect(Object.keys(state.segments)).toHaveLength(2)
    expect(state.segments['mic:seg1']?.text).toBe('one')
    expect(state.segments['system:seg1']?.text).toBe('two')
  })

  test('manual correction is not overwritten by an older ASR packet', () => {
    const asr = {
      meetingId: 'm1',
      streamId: 's1',
      id: 'seg1',
      revision: 3,
      sequence: 4,
      startMs: 0,
      endMs: 10,
      source: 'microphone' as const,
      speakerId: 'spk-1',
      language: 'ru',
      text: 'исправлено вручную',
      final: true,
      kind: 'manual' as const,
    }
    let state = applyTranscriptPatch(emptyTranscriptState(), asr)
    state = applyTranscriptPatch(state, { ...asr, revision: 2, kind: 'asr', text: 'старое ASR' })
    expect(state.segments['s1:seg1']?.text).toBe('исправлено вручную')
    state = bindSpeaker(state, 'spk-1', ['person:ivan', 'person:ivan-2'])
    expect(state.speakers['spk-1']?.status).toBe('ambiguous')
  })
})
