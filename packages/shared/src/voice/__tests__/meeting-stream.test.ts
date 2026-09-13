import { describe, expect, test } from 'bun:test'
import { LAST_KNOWN_GOOD_CAPABILITIES } from '../capabilities.ts'
import { openMeetingStream } from '../meeting-stream.ts'

describe('meeting stream (RMA-I005)', () => {
  test('partial is visible before stop', () => {
    const stream = openMeetingStream({
      codec: 'audio/pcm',
      sampleRate: 16000,
      capabilities: { ...LAST_KNOWN_GOOD_CAPABILITIES, streaming: true },
      transcribe: () => 'hello',
    })
    const partial = stream.push(new Uint8Array([1, 2, 3]))
    expect(partial?.final).toBe(false)
    expect(partial?.text).toBe('hello')
    const finals = stream.stop()
    expect(finals[0]?.final).toBe(true)
  })

  test('batch-only capability is honest', () => {
    const stream = openMeetingStream({
      codec: 'audio/pcm',
      sampleRate: 16000,
      capabilities: { ...LAST_KNOWN_GOOD_CAPABILITIES, streaming: false },
      transcribe: () => 'window',
    })
    expect(stream.mode).toBe('batch_windowed')
  })

  test('malformed frames are ignored; 429/no-credentials does not emit a fixture phrase', () => {
    const denied = openMeetingStream({
      codec: 'audio/pcm',
      sampleRate: 16000,
      env: {},
    })
    expect(() => denied.push(new Uint8Array([1]))).toThrow(/no-credentials/)
    const stream = openMeetingStream({
      codec: 'audio/pcm',
      sampleRate: 16000,
      transcribe: () => 'ok',
    })
    expect(stream.push(new Uint8Array())).toBeNull()
  })

  test('revoke during upload and cancel stop further segments', () => {
    const revoked = openMeetingStream({
      codec: 'audio/pcm',
      sampleRate: 16000,
      revoked: true,
      transcribe: () => 'secret-fixture-phrase',
    })
    expect(revoked.push(new Uint8Array([1]))).toBeNull()
    expect(revoked.stop()).toEqual([])
    const stream = openMeetingStream({
      codec: 'audio/pcm',
      sampleRate: 16000,
      transcribe: () => 'hello',
    })
    stream.cancel()
    expect(stream.push(new Uint8Array([1]))).toBeNull()
  })
})
