/**
 * Voice dictation / playback preferences and engine contracts.
 *
 * Schema v3: system TTS is local by default; Edge TTS requires an explicit
 * current-version selection. Cloud ASR, enhancement and web enrichment have
 * separate consents. Legacy cloud/TTS defaults never imply user consent.
 */

import { DEEPGRAM_TRANSCRIPTION_MODEL } from './contracts.ts'

export const VOICE_PREFS_VERSION = 3 as const
export const DEFAULT_WAKE_PHRASE = 'Так, Рокс!'

export type SttEngine = 'local-whisper' | 'cloud-rox'
export type TtsEngine = 'system' | 'edge'
export type AudioRetention = 'none' | 'session' | 'cloud-policy'
export type LocalArchivePolicy = 'until-delete' | 'session' | 'none'
export type ModelHealthStatus = 'missing' | 'downloading' | 'ready' | 'error' | 'unsupported'
export type EnhancementMode = 'verbatim' | 'clean' | 'improve-prompt'
export type HotkeyMode = 'toggle' | 'ptt'
export type OverlayPosition = 'top' | 'bottom'
export type OverlayStyle = 'minimal' | 'live'
export type RecognitionLanguage = 'auto' | 'en' | 'ru'

export const STT_ENGINES: readonly SttEngine[] = ['local-whisper', 'cloud-rox'] as const

export const TTS_ENGINES: readonly TtsEngine[] = ['system', 'edge'] as const

export const AUDIO_RETENTION_POLICIES: readonly AudioRetention[] = [
  'none',
  'session',
  'cloud-policy',
] as const

export const LOCAL_ARCHIVE_POLICIES: readonly LocalArchivePolicy[] = [
  'until-delete',
  'session',
  'none',
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
  localArchivePolicy: LocalArchivePolicy
  asrModelId: string
  recognitionLanguage: RecognitionLanguage
  timestamps: 'segment' | 'word' | 'none'
  cloudAsrConsent: boolean
  cloudEnhancementConsent: boolean
  webEnrichmentConsent: boolean
  privacyMigrationPending: boolean
  /** Explicit local completion target; missing legacy preference remains draft. */
  delivery?: 'draft' | 'clipboard'
  trailingSpace?: boolean
  autoSubmit: boolean
  enhancementMode: EnhancementMode
  enhancementModules: string[]
  pttModifier?: 'AltRight' | 'ControlRight' | 'none'
  hotkeyMode: HotkeyMode
  toggleAccelerator: string
  cancelAccelerator: string
  overlayPosition: OverlayPosition
  overlayStyle: OverlayStyle
  soundFeedback: boolean
  wakeWordEnabled: boolean
  alwaysListeningConsent: boolean
  wakePhrase: string
  selectedInputDeviceId: string | null
  selectedOutputDeviceId: string | null
  whisperStatus: ModelHealthStatus
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
  asrModelId: string
  asrBrand: string
  evidenceClass: 'cloud-beta' | 'enhancement-beta' | 'local-model-beta' | 'full-epic' | 'scaffold'
}

export interface TranscribeInput {
  audio: Uint8Array
  mimeType: string
  language?: string
  signal?: AbortSignal
}
export interface TranscribeResult {
  segments?: import('./adapters/audio-result.ts').TranscriptSegment[]
  words?: import('./adapters/audio-result.ts').TranscriptWord[]
  text: string
  engine: SttEngine
  uploaded: boolean
  noSpeech?: boolean
  requestId?: string
  requestedModelId?: string
  resolvedModelId?: string
  modelRevision?: string
  diarizationModel?: string
  routeVersion?: string
  detectedLanguage?: string
  durationMs?: number
}

export interface SpeakInput {
  text: string
  language?: RecognitionLanguage
  signal?: AbortSignal
  /** Internal adapter progress; never populated from an RPC request payload. */
  onTextTransmission?: (state: TextTransmission) => void
}

export type TextTransmission = 'not-sent' | 'possible' | 'sent'

export interface SpeakResult {
  engine: TtsEngine
  /** No microphone audio is uploaded. Online TTS may send text. */
  uploaded: false
  textSent?: boolean
  /** A cancelled or failed CLI may already have transmitted text. */
  textTransmission?: TextTransmission
  audioBase64?: string
  mimeType?: 'audio/mpeg'
  playback?: 'audio' | 'native' | 'renderer' | 'none'
  voice?: string
  reason?: 'russian-system-voice-unavailable'
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

export function isLocalArchivePolicy(value: unknown): value is LocalArchivePolicy {
  return typeof value === 'string' && (LOCAL_ARCHIVE_POLICIES as readonly string[]).includes(value)
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
    ttsEngine: 'system',
    audioRetention: 'cloud-policy',
    localArchivePolicy: 'until-delete',
    asrModelId: DEEPGRAM_TRANSCRIPTION_MODEL,
    recognitionLanguage: 'auto',
    timestamps: 'segment',
    cloudAsrConsent: false,
    cloudEnhancementConsent: false,
    webEnrichmentConsent: false,
    privacyMigrationPending: false,
    delivery: 'draft',
    trailingSpace: false,
    autoSubmit: false,
    enhancementMode: 'verbatim',
    enhancementModules: [],
    pttModifier: 'AltRight',
    hotkeyMode: 'toggle',
    toggleAccelerator: 'CommandOrControl+Shift+D',
    cancelAccelerator: 'Escape',
    overlayPosition: 'bottom',
    overlayStyle: 'minimal',
    soundFeedback: false,
    wakeWordEnabled: false,
    alwaysListeningConsent: false,
    wakePhrase: DEFAULT_WAKE_PHRASE,
    selectedInputDeviceId: null,
    selectedOutputDeviceId: null,
    whisperStatus: 'missing',
    updatedAt: now,
  }
}
