import { describe, expect, test } from 'bun:test'
import { LAST_KNOWN_GOOD_VOICE_CAPABILITIES } from '../contracts.ts'
import {
  MeetingStreamError,
  collectMeetingStream,
  openMeetingStream,
  type MeetingStreamFrame,
} from '../meeting-stream.ts'

async function* framesOf(...frames: MeetingStreamFrame[]): AsyncIterable<MeetingStreamFrame> {
  for (const frame of frames) yield frame
}

const streamingCaps = { ...LAST_KNOWN_GOOD_VOICE_CAPABILITIES, streaming: true, availability: 'ready' as const }

describe('meeting ASR stream (issue 361)', () => {
  test('streaming emits a partial before stop', async () => {
    const stream = openMeetingStream({
      capabilities: streamingCaps,
      frames: framesOf(
        { kind: 'partial', text: 'привет', startMs: 0, endMs: 400 },
        { kind: 'final', text: 'привет мир', startMs: 0, endMs: 900 },
      ),
    })
    expect(stream.mode).toBe('streaming')
    const segments = await collectMeetingStream(stream)
    expect(segments[0]).toMatchObject({ partial: true, text: 'привет', mode: 'streaming' })
    expect(segments[1]).toMatchObject({ partial: false, text: 'привет мир' })
  })

  test('no streaming route uses batch_windowed and does not invent live partials', async () => {
    const stream = openMeetingStream({
      capabilities: LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
      frames: framesOf(
        { kind: 'audio', bytes: new Uint8Array([1, 2, 3]) },
        { kind: 'partial', text: 'should-not-emit', startMs: 0, endMs: 10 },
      ),
      transcribeWindow: async () => ({ text: 'окно' }),
    })
    expect(stream.mode).toBe('batch_windowed')
    const segments = await collectMeetingStream(stream)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ mode: 'batch_windowed', partial: false, text: 'окно' })
  })

  test('malformed frames do not invent transcript text', async () => {
    const stream = openMeetingStream({
      capabilities: streamingCaps,
      frames: framesOf(
        { kind: 'malformed' },
        { kind: 'final', text: 'ok', startMs: 0, endMs: 1 },
      ),
    })
    const segments = await collectMeetingStream(stream)
    expect(segments.map((item) => item.text)).toEqual(['ok'])
  })

  test('429 backs off once then fails closed', async () => {
    const slept: number[] = []
    const stream = openMeetingStream({
      capabilities: streamingCaps,
      frames: framesOf(
        { kind: 'error', status: 429 },
        { kind: 'error', status: 429, message: 'slow down' },
      ),
      backoffMs: 5,
      sleep: async (ms) => { slept.push(ms) },
    })
    await expect(collectMeetingStream(stream)).rejects.toMatchObject({ code: 'rate-limited' })
    expect(slept).toEqual([5])
  })

  test('abort and revoke fail closed', async () => {
    expect(() => openMeetingStream({
      capabilities: streamingCaps,
      frames: framesOf(),
      granted: false,
    })).toThrow(MeetingStreamError)

    const controller = new AbortController()
    const stream = openMeetingStream({
      capabilities: streamingCaps,
      frames: (async function* () {
        yield { kind: 'partial', text: 'x', startMs: 0, endMs: 1 } as const
        controller.abort()
        yield { kind: 'final', text: 'y', startMs: 0, endMs: 2 } as const
      })(),
      signal: controller.signal,
    })
    await expect(collectMeetingStream(stream)).rejects.toMatchObject({ code: 'aborted' })
  })
})
