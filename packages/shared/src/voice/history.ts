import type { VoiceTranscriptSegment } from './contracts.ts'
import type {
  TranscribeResult,
  VoiceDelivery,
  VoiceExportFormat,
  VoiceOverlayPosition,
  VoiceRecognitionLanguage,
  VoiceTranscriptKind,
  VoiceTranscriptRevision,
} from './types.ts'

export const VOICE_OVERLAY_POSITIONS: readonly VoiceOverlayPosition[] = ['top', 'bottom'] as const
export const VOICE_DELIVERIES: readonly VoiceDelivery[] = ['draft', 'clipboard'] as const
export const VOICE_RECOGNITION_LANGUAGES: readonly VoiceRecognitionLanguage[] = ['auto', 'en', 'ru'] as const
export const VOICE_EXPORT_FORMATS: readonly VoiceExportFormat[] = ['txt', 'json', 'srt'] as const

export function isVoiceOverlayPosition(value: unknown): value is VoiceOverlayPosition {
  return value === 'top' || value === 'bottom'
}

export function isVoiceDelivery(value: unknown): value is VoiceDelivery {
  return value === 'draft' || value === 'clipboard'
}

export function isVoiceRecognitionLanguage(value: unknown): value is VoiceRecognitionLanguage {
  return value === 'auto' || value === 'en' || value === 'ru'
}

export function isVoiceExportFormat(value: unknown): value is VoiceExportFormat {
  return value === 'txt' || value === 'json' || value === 'srt'
}

export function resolveRecognitionLanguage(language: VoiceRecognitionLanguage | undefined): string | undefined {
  if (!language || language === 'auto') return undefined
  return language
}

export function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const secs = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function formatSrt(segments: VoiceTranscriptSegment[]): string {
  return segments.map((segment, index) => (
    `${index + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}\n${segment.text.trim()}\n`
  )).join('\n')
}

export function newRevisionId(): string {
  return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function revisionFromResult(
  result: TranscribeResult,
  extras: { parentId?: string; createdAt?: string; kind?: VoiceTranscriptKind } = {},
): VoiceTranscriptRevision {
  return {
    id: newRevisionId(),
    kind: extras.kind ?? 'asr',
    parentId: extras.parentId,
    modelId: result.modelId,
    engine: result.engine,
    uploaded: result.uploaded,
    text: result.text,
    language: result.language,
    segments: result.segments,
    words: result.words,
    createdAt: extras.createdAt ?? new Date().toISOString(),
  }
}

export function resultFromRevision(revision: VoiceTranscriptRevision): TranscribeResult {
  return {
    text: revision.text,
    engine: revision.engine ?? 'cloud-rox',
    uploaded: revision.uploaded === true,
    language: revision.language,
    modelId: revision.modelId,
    segments: revision.kind === 'asr' ? revision.segments : undefined,
    words: revision.kind === 'asr' ? revision.words : undefined,
  }
}

export function applyTranscriptDelivery(
  text: string,
  prefs: { delivery: VoiceDelivery; trailingSpace: boolean },
): { text: string; insert: boolean; copy: boolean } {
  const next = prefs.trailingSpace && !text.endsWith(' ') ? `${text} ` : text
  return {
    text: next,
    insert: prefs.delivery === 'draft',
    copy: prefs.delivery === 'clipboard',
  }
}

/** Insert dictation into an existing draft without stacking spaces. */
export function joinDraftTranscript(current: string, incoming: string): string {
  if (!current) return incoming
  if (!incoming) return current
  const left = current.replace(/\s+$/u, '')
  const right = incoming.trim()
  const trailing = incoming.endsWith(' ') ? ' ' : ''
  return `${left} ${right}${trailing}`
}
