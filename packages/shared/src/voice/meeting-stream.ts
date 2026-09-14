/**
 * Meeting ASR stream (issue #361 / I005).
 * Streaming is used only when capabilities.streaming is true.
 * Last-known-good capabilities set streaming=false, so the honest default
 * is batch_windowed — never a fake live partial.
 */

import type { VoiceCapabilities } from './contracts.ts'

export type MeetingStreamMode = 'streaming' | 'batch_windowed'

export type MeetingStreamSegment = {
  id: string
  text: string
  partial: boolean
  startMs: number
  endMs: number
  mode: MeetingStreamMode
}

export type MeetingStreamFrame =
  | { kind: 'audio'; bytes: Uint8Array }
  | { kind: 'partial'; text: string; startMs: number; endMs: number }
  | { kind: 'final'; text: string; startMs: number; endMs: number }
  | { kind: 'error'; status: number; message?: string }
  | { kind: 'malformed' }

export type MeetingStream = {
  mode: MeetingStreamMode
  segments(): AsyncGenerator<MeetingStreamSegment>
  cancel(): void
}

export class MeetingStreamError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MeetingStreamError'
  }
}

export type MeetingStreamInput = {
  capabilities: VoiceCapabilities
  frames: AsyncIterable<MeetingStreamFrame>
  transcribeWindow?: (audio: Uint8Array) => Promise<{ text: string }>
  signal?: AbortSignal
  granted?: boolean
  backoffMs?: number
  sleep?: (ms: number) => Promise<void>
}

export function openMeetingStream(input: MeetingStreamInput): MeetingStream {
  if (input.granted === false) {
    throw new MeetingStreamError('revoked', 'Meeting ASR grant is missing or revoked')
  }
  const mode: MeetingStreamMode = input.capabilities.streaming ? 'streaming' : 'batch_windowed'
  let cancelled = false
  const abort = () => { cancelled = true }
  input.signal?.addEventListener('abort', abort, { once: true })

  return {
    mode,
    cancel() {
      cancelled = true
    },
    async *segments(): AsyncGenerator<MeetingStreamSegment> {
      const chunks: Uint8Array[] = []
      let seq = 0
      let retries = 0
      for await (const frame of input.frames) {
        if (cancelled || input.signal?.aborted) {
          throw new MeetingStreamError('aborted', 'Meeting ASR stream was cancelled')
        }
        if (frame.kind === 'malformed') {
          continue
        }
        if (frame.kind === 'error') {
          if (frame.status === 429 && retries < 1) {
            retries += 1
            await (input.sleep ?? delay)(input.backoffMs ?? 50)
            continue
          }
          if (frame.status === 429) {
            throw new MeetingStreamError('rate-limited', frame.message ?? 'ASR rate limited')
          }
          throw new MeetingStreamError(`http-${frame.status}`, frame.message ?? 'ASR request failed')
        }
        if (frame.kind === 'audio') {
          chunks.push(frame.bytes)
          continue
        }
        if (frame.kind === 'partial') {
          if (mode !== 'streaming') continue
          seq += 1
          yield {
            id: `seg-${seq}`,
            text: frame.text,
            partial: true,
            startMs: frame.startMs,
            endMs: frame.endMs,
            mode,
          }
          continue
        }
        if (frame.kind === 'final') {
          seq += 1
          yield {
            id: `seg-${seq}`,
            text: frame.text,
            partial: false,
            startMs: frame.startMs,
            endMs: frame.endMs,
            mode,
          }
        }
      }
      if (cancelled || input.signal?.aborted) {
        throw new MeetingStreamError('aborted', 'Meeting ASR stream was cancelled')
      }
      if (mode === 'batch_windowed' && chunks.length > 0 && input.transcribeWindow) {
        const merged = concat(chunks)
        const result = await input.transcribeWindow(merged)
        seq += 1
        yield {
          id: `seg-${seq}`,
          text: result.text,
          partial: false,
          startMs: 0,
          endMs: 0,
          mode: 'batch_windowed',
        }
      }
    },
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function collectMeetingStream(stream: MeetingStream): Promise<MeetingStreamSegment[]> {
  const out: MeetingStreamSegment[] = []
  for await (const segment of stream.segments()) out.push(segment)
  return out
}
