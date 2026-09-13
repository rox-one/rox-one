/**
 * Voice dictation / playback preferences and engine contracts.
 *
 * Schema v2: cloud-rox is the fresh-install default. Local capture stays on
 * device. Cloud ASR, enhancement and web enrichment are three separate consents.
 */

export const VOICE_PREFS_VERSION = 2 as const
export const DEFAULT_WAKE_PHRASE = 'Так, Рокс!'

export type SttEngine = 'local-whisper' | 'cloud-rox' | 'cloud-deepgram'
export type TtsEngine = 'edge' | 'fish-speech'
export type AudioRetention = 'none' | 'session' | 'cloud-policy'
export type LocalArchivePolicy = 'until-delete' | 'session' | 'none'
export type ModelHealthStatus = 'missing' | 'downloading' | 'ready' | 'error' | 'unsupported'
export type EnhancementMode = 'verbatim' | 'clean' | 'improve-prompt'
export type HotkeyMode = 'toggle' | 'ptt'
export type OverlayPosition = 'top' | 'bottom'
export type OverlayStyle = 'minimal' | 'live'
export type RecognitionLanguage = 'auto' | 'en' | 'ru'

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
  autoSubmit: boolean
  enhancementMode: EnhancementMode
  enhancementModules: string[]
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
}

export interface TranscribeResult {
  text: string
  engine: SttEngine
  uploaded: boolean
  noSpeech?: boolean
  requestId?: string
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
    ttsEngine: 'edge',
    audioRetention: 'cloud-policy',
    localArchivePolicy: 'until-delete',
    asrModelId: 'rocks-t1',
    recognitionLanguage: 'auto',
    timestamps: 'segment',
    cloudAsrConsent: true,
    cloudEnhancementConsent: false,
    webEnrichmentConsent: false,
    privacyMigrationPending: false,
    autoSubmit: false,
    enhancementMode: 'verbatim',
    enhancementModules: [],
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
