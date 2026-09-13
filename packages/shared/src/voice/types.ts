/**
 * Voice dictation / playback preferences and engine contracts.
 *
 * Local STT never uploads audio. Wake-word listening stays off until the user
 * consents to always-listening. Local recognition and audio retention are
 * independent settings.
 */

import {
  DEFAULT_VOICE_CANCEL_ACCELERATOR,
  DEFAULT_VOICE_TOGGLE_ACCELERATOR,
  type VoicePttModifier,
} from './hotkeys.ts'
import {
  ROX_VOICE_LANGUAGE_LABEL,
  ROX_VOICE_PUBLIC_MODEL_ID,
  ROX_VOICE_UI_NAME,
  type VoiceTranscriptSegment,
  type VoiceTranscriptWord,
} from './contracts.ts'

export const VOICE_PREFS_VERSION = 2 as const
export const DEFAULT_WAKE_PHRASE = 'Так, Рокс!'

export type SttEngine = 'local-whisper' | 'cloud-rox' | 'cloud-deepgram'
export type TtsEngine = 'edge' | 'fish-speech'
export type AudioRetention = 'none' | 'session' | 'cloud-policy'
export type ModelHealthStatus = 'missing' | 'downloading' | 'ready' | 'error' | 'unsupported'
export type VoiceTranscriptKind = 'asr' | 'manual'
export type VoiceExportFormat = 'txt' | 'json' | 'srt'
export type VoiceOverlayPosition = 'top' | 'bottom'
export type VoiceDelivery = 'draft' | 'clipboard'
export type VoiceRecognitionLanguage = 'auto' | 'en' | 'ru'

export const STT_ENGINES: readonly SttEngine[] = [
  'local-whisper',
  'cloud-rox',
  'cloud-deepgram',
] as const

export const TTS_ENGINES: readonly TtsEngine[] = ['edge', 'fish-speech'] as const

export const AUDIO_RETENTION_POLICIES: readonly AudioRetention[] = [
  'none',
  'session',
  'cloud-policy',
] as const

export interface AudioDevice {
  id: string
  label: string
  kind: 'input' | 'output'
}

export interface VoicePrefs {
  version: typeof VOICE_PREFS_VERSION
  sttEngine: SttEngine
  ttsEngine: TtsEngine
  audioRetention: AudioRetention
  wakeWordEnabled: boolean
  /** Required before always-listening / wake-word capture may start. */
  alwaysListeningConsent: boolean
  wakePhrase: string
  selectedInputDeviceId: string | null
  selectedOutputDeviceId: string | null
  /** Cached UI hint only. Local readiness comes from a real probe, not this field. */
  whisperStatus: ModelHealthStatus
  overlayEnabled: boolean
  overlayPosition: VoiceOverlayPosition
  hotkeyToggle: string
  hotkeyCancel: string
  pttModifier: VoicePttModifier
  recognitionLanguage: VoiceRecognitionLanguage
  delivery: VoiceDelivery
  trailingSpace: boolean
  updatedAt: number
}

export interface VoiceHealth {
  sttEngine: SttEngine
  ttsEngine: TtsEngine
  whisper: ModelHealthStatus
  localBackend: 'whisper-large-v3-turbo-mlx' | 'whisper-large-v3-turbo-cpu'
  appleSilicon: boolean
  offline: boolean
  wakeWordArmed: boolean
  audioRetention: AudioRetention
  localModelReady: boolean
  cloudModelId: string
  cloudDisplayName: string
  languageLabel: string
}

export type VoiceRecordingStatus =
  | 'recording'
  | 'interrupted'
  | 'queued'
  | 'transcribing'
  | 'complete'
  | 'error'
  | 'canceled'

export interface VoiceTranscriptRevision {
  id: string
  kind: VoiceTranscriptKind
  parentId?: string
  modelId?: string
  engine?: SttEngine
  uploaded?: boolean
  text: string
  language?: string
  segments?: VoiceTranscriptSegment[]
  words?: VoiceTranscriptWord[]
  createdAt: string
}

export interface VoiceRecording {
  id: string
  createdAt: string
  updatedAt: string
  status: VoiceRecordingStatus
  mimeType: string
  durationMs?: number
  error?: string
  favorite?: boolean
  selectedRevisionId?: string
  revisions?: VoiceTranscriptRevision[]
  result?: TranscribeResult
  /** False after retention discards the bytes. Play/retranscribe need this. */
  audioAvailable: boolean
}

export interface TranscribeInput {
  audio: Uint8Array
  mimeType: string
  language?: string
  requestId?: string
  signal?: AbortSignal
}

export interface TranscribeResult {
  text: string
  engine: SttEngine
  uploaded: boolean
  language?: string
  duration?: number
  modelId?: string
  requestId?: string
  segments?: VoiceTranscriptSegment[]
  words?: VoiceTranscriptWord[]
}

export interface SpeakInput {
  text: string
}

export interface SpeakResult {
  engine: TtsEngine
  uploaded: false
}

export interface TranscribeAdapter {
  engine: SttEngine
  transcribe(input: TranscribeInput): Promise<TranscribeResult>
}

export interface SpeakAdapter {
  engine: TtsEngine
  speak(input: SpeakInput): Promise<SpeakResult>
}

export function isSttEngine(value: unknown): value is SttEngine {
  return typeof value === 'string' && (STT_ENGINES as readonly string[]).includes(value)
}

export function isTtsEngine(value: unknown): value is TtsEngine {
  return typeof value === 'string' && (TTS_ENGINES as readonly string[]).includes(value)
}

export function isAudioRetention(value: unknown): value is AudioRetention {
  return typeof value === 'string' && (AUDIO_RETENTION_POLICIES as readonly string[]).includes(value)
}

export function isModelHealthStatus(value: unknown): value is ModelHealthStatus {
  return (
    value === 'missing' ||
    value === 'downloading' ||
    value === 'ready' ||
    value === 'error' ||
    value === 'unsupported'
  )
}

export function getDefaultVoicePrefs(now: number = Date.now()): VoicePrefs {
  return {
    version: VOICE_PREFS_VERSION,
    sttEngine: 'cloud-rox',
    ttsEngine: 'edge',
    audioRetention: 'session',
    wakeWordEnabled: false,
    alwaysListeningConsent: false,
    wakePhrase: DEFAULT_WAKE_PHRASE,
    selectedInputDeviceId: null,
    selectedOutputDeviceId: null,
    whisperStatus: 'missing',
    overlayEnabled: true,
    overlayPosition: 'top',
    hotkeyToggle: DEFAULT_VOICE_TOGGLE_ACCELERATOR,
    hotkeyCancel: DEFAULT_VOICE_CANCEL_ACCELERATOR,
    pttModifier: 'AltRight',
    recognitionLanguage: 'auto',
    delivery: 'draft',
    trailingSpace: false,
    updatedAt: now,
  }
}

export function shouldMigrateLegacyLocalDefault(raw: Record<string, unknown>): boolean {
  const engine = isSttEngine(raw.sttEngine) ? raw.sttEngine : null
  const status = isModelHealthStatus(raw.whisperStatus) ? raw.whisperStatus : 'missing'
  return engine === 'local-whisper' && (status === 'missing' || status === 'unsupported')
}

export const VOICE_CLOUD_LABEL = {
  modelId: ROX_VOICE_PUBLIC_MODEL_ID,
  displayName: ROX_VOICE_UI_NAME,
  languageLabel: ROX_VOICE_LANGUAGE_LABEL,
} as const

