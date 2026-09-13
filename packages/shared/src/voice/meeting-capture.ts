import { createHash } from 'node:crypto'

export type MeetingCaptureStatus = 'recording' | 'paused' | 'stopped' | 'denied' | 'unplugged'

export type MeetingCaptureSession = {
  meetingId: string
  status: MeetingCaptureStatus
  startedAt: number
  paused: boolean
  mic: Uint8Array[]
  system: Uint8Array[]
  sampleRate: number
}

export function startMeetingCaptureSession(meetingId: string, sampleRate = 16000, now = Date.now()): MeetingCaptureSession {
  return { meetingId, status: 'recording', startedAt: now, paused: false, mic: [], system: [], sampleRate }
}

export function pauseMeetingCaptureSession(session: MeetingCaptureSession): MeetingCaptureSession {
  if (session.status !== 'recording') return session
  return { ...session, status: 'paused', paused: true }
}

export function appendMeetingAudio(
  session: MeetingCaptureSession,
  source: 'mic' | 'system',
  bytes: Uint8Array,
): MeetingCaptureSession {
  if (session.status !== 'recording' || session.paused) return session
  const next = { ...session, mic: [...session.mic], system: [...session.system] }
  if (source === 'mic') next.mic.push(bytes)
  else next.system.push(bytes)
  return next
}

export function stopMeetingCaptureSession(session: MeetingCaptureSession, reason: MeetingCaptureStatus = 'stopped'): {
  status: MeetingCaptureStatus
  mic: { sha256: string; bytes: number; durationMs: number }
  system: { sha256: string; bytes: number; durationMs: number }
} {
  const mic = concat(session.mic)
  const system = concat(session.system)
  return {
    status: reason,
    mic: summarize(mic, session.sampleRate),
    system: summarize(system, session.sampleRate),
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

function summarize(bytes: Uint8Array, sampleRate: number) {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    durationMs: sampleRate > 0 ? Math.round((bytes.byteLength / 2 / sampleRate) * 1000) : 0,
  }
}
