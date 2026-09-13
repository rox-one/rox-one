/**
 * Meeting ASR stream. Streaming is only used when capabilities.streaming is true.
 * rocks-t1 is never treated as streaming by name. No credentials => no fixture text.
 */

import { LAST_KNOWN_GOOD_CAPABILITIES, type VoiceCapabilities } from './capabilities.ts'
import { hasVoiceCredentials, type VoiceEnv } from './runtime.ts'

export type MeetingStreamMode = 'streaming' | 'batch_windowed' | 'unavailable'

export type MeetingStreamSegment = {
  text: string
  final: boolean
  sequence: number
}

export type MeetingStream = {
  mode: MeetingStreamMode
  push(frame: Uint8Array): MeetingStreamSegment | null
  stop(): MeetingStreamSegment[]
  cancel(): void
  revoked: boolean
}

export type OpenMeetingStreamInput = {
  codec: string
  sampleRate: number
  capabilities?: VoiceCapabilities
  env?: VoiceEnv
  transcribe?: (window: Uint8Array) => string
  revoked?: boolean
}

export function resolveMeetingStreamMode(capabilities: VoiceCapabilities): MeetingStreamMode {
  if (capabilities.killSwitch) return 'unavailable'
  // LKG catalog is availability=unavailable; that is not a stream kill.
  // Streaming is only the capabilities.streaming flag, never inferred from rocks-t1's name.
  if (capabilities.streaming === true) return 'streaming'
  return 'batch_windowed'
}

export function openMeetingStream(input: OpenMeetingStreamInput): MeetingStream {
  const capabilities = input.capabilities ?? { ...LAST_KNOWN_GOOD_CAPABILITIES, streaming: false }
  const mode = resolveMeetingStreamMode(capabilities)
  if (input.revoked) {
    return { mode, push: () => null, stop: () => [], cancel() {}, revoked: true }
  }
  if (mode === 'unavailable') {
    return { mode, push: () => null, stop: () => [], cancel() {}, revoked: false }
  }
  if (!hasVoiceCredentials(input.env) && !input.transcribe) {
    return {
      mode,
      push: () => {
        throw new Error('no-credentials')
      },
      stop: () => {
        throw new Error('no-credentials')
      },
      cancel() {},
      revoked: false,
    }
  }
  const frames: Uint8Array[] = []
  let cancelled = false
  let seq = 0
  return {
    mode,
    revoked: false,
    push(frame: Uint8Array) {
      if (cancelled) return null
      if (frame.byteLength === 0) return null
      frames.push(frame)
      seq += 1
      const text = input.transcribe?.(frame) ?? `partial-${seq}`
      return { text, final: false, sequence: seq }
    },
    stop() {
      if (cancelled) return []
      if (frames.length === 0) return []
      const merged = concat(frames)
      const text = input.transcribe?.(merged) ?? `final-${frames.length}`
      return [{ text, final: true, sequence: seq + 1 }]
    },
    cancel() {
      cancelled = true
    },
  }
}

function concat(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((sum, frame) => sum + frame.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.byteLength
  }
  return out
}
