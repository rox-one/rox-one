export interface TranscriptSegment { startMs: number; endMs: number; text: string }
export interface TranscriptWord { startMs: number; endMs: number; text: string }
export interface NormalizedTranscript {
  text: string
  detectedLanguage?: string
  segments: TranscriptSegment[]
  words?: TranscriptWord[]
  requestedModelId: string
  resolvedModelId: string
  routeVersion?: string
  requestId: string
  durationMs: number
  noSpeech: boolean
}
export class AudioValidationError extends Error {
  readonly code: 'invalid-mime' | 'empty' | 'too-large' | 'damaged'
  constructor(code: AudioValidationError['code'], message: string) {
    super(message); this.name = 'AudioValidationError'; this.code = code
  }
}
export function secondsToMs(value: number): number { return Math.round(value * 1000) }
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
export function sniffAudioMime(bytes: Uint8Array, declared?: string): string {
  if (bytes.length >= 12) {
    const header = String.fromCharCode(...bytes.slice(0, 4))
    if (header === 'RIFF') return 'audio/wav'
    if (header === 'OggS') return 'audio/ogg'
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm'
    if (bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)) return 'audio/mpeg'
  }
  if (declared && declared.startsWith('audio/')) return declared
  throw new AudioValidationError('invalid-mime', 'Unrecognized audio container')
}
export function validateAudioLimits(bytes: Uint8Array, limits: { maxBytes: number; allowedMime: string[] }, declaredMime?: string): string {
  if (bytes.length === 0) throw new AudioValidationError('empty', 'Audio is empty')
  if (bytes.length > limits.maxBytes) throw new AudioValidationError('too-large', `Audio exceeds ${limits.maxBytes} bytes`)
  const mime = sniffAudioMime(bytes, declaredMime)
  if (!limits.allowedMime.includes(mime)) throw new AudioValidationError('invalid-mime', `MIME ${mime} is not allowed`)
  return mime
}
export function normalizeVerboseJson(raw: unknown, meta: { requestedModelId: string; resolvedModelId: string; routeVersion?: string; requestId: string; durationMs?: number }): NormalizedTranscript {
  if (!raw || typeof raw !== 'object') throw new AudioValidationError('damaged', 'ASR payload is not an object')
  const obj = raw as Record<string, unknown>
  const text = typeof obj.text === 'string' ? obj.text : ''
  const durationSec = asNumber(obj.duration)
  const durationMs = meta.durationMs ?? (durationSec != null ? secondsToMs(durationSec) : 0)
  const segmentsRaw = Array.isArray(obj.segments) ? obj.segments : []
  const segments: TranscriptSegment[] = segmentsRaw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const seg = item as Record<string, unknown>
    const start = asNumber(seg.start); const end = asNumber(seg.end)
    if (start == null || end == null) return []
    return [{ startMs: secondsToMs(start), endMs: secondsToMs(end), text: typeof seg.text === 'string' ? seg.text : '' }]
  })
  const wordsRaw = Array.isArray(obj.words) ? obj.words : undefined
  const words = wordsRaw?.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const word = item as Record<string, unknown>
    const start = asNumber(word.start); const end = asNumber(word.end)
    if (start == null || end == null) return []
    return [{ startMs: secondsToMs(start), endMs: secondsToMs(end), text: typeof word.word === 'string' ? word.word : typeof word.text === 'string' ? word.text : '' }]
  })
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]; const next = segments[i]
    if (prev && next && next.startMs < prev.startMs) throw new AudioValidationError('damaged', 'Segment timestamps are not monotonic')
  }
  if (durationMs > 0) {
    for (const seg of segments) {
      if (seg.endMs > durationMs + 50) throw new AudioValidationError('damaged', 'Segment timestamp exceeds duration')
    }
  }
  return {
    text, detectedLanguage: typeof obj.language === 'string' ? obj.language : undefined, segments,
    words: words && words.length > 0 ? words : undefined, requestedModelId: meta.requestedModelId,
    resolvedModelId: meta.resolvedModelId, routeVersion: meta.routeVersion, requestId: meta.requestId,
    durationMs,
    noSpeech: obj.no_speech === true || (text.trim().length === 0 && (durationSec ?? 0) >= 0.4),
  }
}
export async function sha256HexAsync(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}
