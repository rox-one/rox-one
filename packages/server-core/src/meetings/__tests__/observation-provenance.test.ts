import { describe, expect, test } from 'bun:test'
import {
  applyObservationProvenance,
  buildObservationProvenance,
  classifySelf,
  provenanceLabelKey,
  resolveOwnEcho,
} from '../observation-provenance.ts'
import type { TranscriptSegment } from '@rox/core/meetings'

const segment: TranscriptSegment = {
  meetingId: 'm1',
  streamId: 'stream',
  id: 's1',
  revision: 1,
  sequence: 0,
  startMs: 0,
  endMs: 1000,
  source: 'microphone',
  speakerId: null,
  language: 'ru',
  text: 'привет',
  final: true,
}

describe('per-line observation provenance (d2.1)', () => {
  test('self classification prefers the explicit flag, then the speaker label', () => {
    expect(classifySelf({ self: 'self', speaker: 'Иван' })).toBe('self')
    expect(classifySelf({ speaker: 'Иван', selfSpeaker: 'Иван' })).toBe('self')
    expect(classifySelf({ speaker: 'Иван', selfSpeaker: 'Пётр' })).toBe('other')
    expect(classifySelf({ speaker: null })).toBe('unknown')
  })

  test('ownEcho is only set when the agent audio is genuinely observable', () => {
    expect(resolveOwnEcho({ observer: 'browser-caption', source: 'microphone', self: 'self' })).toBe(true)
    expect(resolveOwnEcho({ observer: 'asr-stream', source: 'system', self: 'self' })).toBe(true)
    // Mic-only capture cannot hear the agent's own TTS — leave it unset, not false.
    expect(resolveOwnEcho({ observer: 'asr-stream', source: 'microphone', self: 'self' })).toBeUndefined()
    expect(resolveOwnEcho({ observer: 'asr-stream', source: 'system', self: 'other' })).toBeUndefined()
  })

  test('applyObservationProvenance attaches provenance and never fabricates ownEcho', () => {
    const micOnly = applyObservationProvenance(segment, {
      observer: 'asr-stream',
      sessionId: 'sess1',
      observedAt: 42,
      speaker: 'Иван',
      selfSpeaker: 'Иван',
      source: 'microphone',
    })
    expect(micOnly.provenance).toEqual({
      observer: 'asr-stream',
      sessionId: 'sess1',
      observedAt: 42,
      speaker: 'Иван',
      self: 'self',
    })
    expect(micOnly.ownEcho).toBeUndefined()

    const captioned = applyObservationProvenance(segment, {
      observer: 'browser-caption',
      speaker: 'Ассистент',
      selfSpeaker: 'Ассистент',
      source: 'microphone',
    })
    expect(captioned.ownEcho).toBe(true)
    expect(captioned.provenance?.self).toBe('self')
  })

  test('empty provenance stays honest about unknown speakers', () => {
    const built = buildObservationProvenance({ observer: 'asr-stream', source: 'system' })
    expect(built).toEqual({ observer: 'asr-stream', self: 'unknown' })
  })

  test('provenance chip maps to the staged i18n keys', () => {
    expect(provenanceLabelKey({ ownEcho: true })).toBe('meetings.local.provenance.ownEcho')
    expect(provenanceLabelKey({ provenance: { observer: 'asr-stream', self: 'other', speaker: 'Иван' } })).toBe('meetings.local.provenance.speaker')
    expect(provenanceLabelKey({ provenance: { observer: 'asr-stream', self: 'unknown' } })).toBe('meetings.local.provenance.mic')
    expect(provenanceLabelKey({ provenance: { observer: 'browser-caption', self: 'unknown' } })).toBe('meetings.local.provenance.system')
    expect(provenanceLabelKey({ provenance: { observer: 'manual', self: 'unknown' } })).toBe('meetings.local.provenance.unknown')
    expect(provenanceLabelKey({ speakerId: 'Иван' })).toBe('meetings.local.provenance.speaker')
  })
})