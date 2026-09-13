import { describe, expect, it } from 'bun:test'
import {
  applyTranscriptDelivery,
  formatSrt,
  formatSrtTime,
  joinDraftTranscript,
  resolveRecognitionLanguage,
  resultFromRevision,
  revisionFromResult,
} from '../index.ts'

describe('voice history helpers', () => {
  it('leaves auto recognition language unspecified for the ASR request', () => {
    expect(resolveRecognitionLanguage('auto')).toBeUndefined()
    expect(resolveRecognitionLanguage(undefined)).toBeUndefined()
    expect(resolveRecognitionLanguage('en')).toBe('en')
    expect(resolveRecognitionLanguage('ru')).toBe('ru')
  })

  it('formats timestamped ASR segments as SRT', () => {
    expect(formatSrtTime(1.5)).toBe('00:00:01,500')
    expect(formatSrt([
      { id: 0, start: 0, end: 1.5, text: 'hello' },
      { id: 1, start: 1.5, end: 3, text: ' world ' },
    ])).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nhello\n\n2\n00:00:01,500 --> 00:00:03,000\nworld\n',
    )
  })

  it('applies draft vs clipboard delivery and a trailing space', () => {
    expect(applyTranscriptDelivery('hello', { delivery: 'draft', trailingSpace: false })).toEqual({
      text: 'hello',
      insert: true,
      copy: false,
    })
    expect(applyTranscriptDelivery('hello', { delivery: 'clipboard', trailingSpace: true })).toEqual({
      text: 'hello ',
      insert: false,
      copy: true,
    })
    expect(applyTranscriptDelivery('hello ', { delivery: 'draft', trailingSpace: true })).toEqual({
      text: 'hello ',
      insert: true,
      copy: false,
    })
  })

  it('joins draft transcripts without stacking spaces', () => {
    expect(joinDraftTranscript('', 'hello')).toBe('hello')
    expect(joinDraftTranscript('hello', 'world')).toBe('hello world')
    expect(joinDraftTranscript('hello ', 'world')).toBe('hello world')
    expect(joinDraftTranscript('hello', 'world ')).toBe('hello world ')
    expect(joinDraftTranscript('hello ', 'world ')).toBe('hello world ')
  })

  it('projects selected ASR revisions and drops timestamps from manual edits', () => {
    const asr = revisionFromResult({
      text: 'model output',
      engine: 'cloud-rox',
      uploaded: true,
      modelId: 'rocks-t1',
      language: 'en',
      segments: [{ id: 0, start: 0, end: 1, text: 'model output' }],
    })
    expect(resultFromRevision(asr)).toMatchObject({
      text: 'model output',
      engine: 'cloud-rox',
      uploaded: true,
      segments: [{ id: 0, start: 0, end: 1, text: 'model output' }],
    })
    const manual = revisionFromResult({
      text: 'edited',
      engine: 'cloud-rox',
      uploaded: true,
      segments: [{ id: 0, start: 0, end: 1, text: 'edited' }],
    }, { kind: 'manual', parentId: asr.id })
    expect(resultFromRevision(manual).segments).toBeUndefined()
    expect(manual.parentId).toBe(asr.id)
  })
})
