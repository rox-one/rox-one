/**
 * Voice dictation / playback preferences and engine contracts.
 *
 * Local STT never uploads audio. Wake-word listening stays off until the user
 * consents to always-listening.
 */

export const VOICE_PREFS_VERSION = 1 as const
export const DEFAULT_WAKE_PHRASE = 'Так, Рокс!'

export type SttEngine = 'local-whisper' | 'cloud-rox' | 'cloud-deepgram'
export type TtsEngine = 'edge' | 'fish-speech'
export type AudioRetention = 'none' | 'session' | 'cloud-policy'
export type ModelHealthStatus = 'missing' | 'downloading' | 'ready' | 'error' | 'unsupported'

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
    sttEngine: 'local-whisper',
    ttsEngine: 'edge',
    audioRetention: 'none',
    wakeWordEnabled: false,
    alwaysListeningConsent: false,
    wakePhrase: DEFAULT_WAKE_PHRASE,
    selectedInputDeviceId: null,
    selectedOutputDeviceId: null,
    whisperStatus: 'missing',
    updatedAt: now,
  }
}
