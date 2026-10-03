import { shouldUploadAudio } from './policy.ts'
import { VOICE_PREFS_VERSION } from './types.ts'
import type {
  TranscribeAdapter,
  TranscribeInput,
  TranscribeResult,
  VoicePrefs,
  SpeakAdapter,
  SpeakInput,
  SpeakResult,
} from './types.ts'

export class VoicePrivacyError extends Error {
  readonly code: 'cloud-stt-offline' | 'local-model-missing' | 'empty-transcript' | 'consent-required'

  constructor(code: VoicePrivacyError['code'], message: string) {
    super(message)
    this.name = 'VoicePrivacyError'
    this.code = code
  }
}

export async function transcribeWithPolicy(
  prefs: VoicePrefs,
  input: TranscribeInput,
  adapters: { local: TranscribeAdapter; cloud: TranscribeAdapter },
  options: { offline?: boolean } = {},
): Promise<TranscribeResult> {
  if (options.offline && prefs.sttEngine === 'cloud-rox') {
    throw new VoicePrivacyError('cloud-stt-offline', 'Cloud speech is unavailable offline')
  }

  if (prefs.privacyMigrationPending && shouldUploadAudio(prefs)) {
    throw new VoicePrivacyError('consent-required', 'Confirm archive and cloud ASR consent before recording')
  }

  if (prefs.sttEngine === 'cloud-rox' && !prefs.cloudAsrConsent) {
    throw new VoicePrivacyError('consent-required', 'Enable cloud ASR consent or select local Whisper')
  }
  if (!shouldUploadAudio(prefs)) {
    if (prefs.whisperStatus !== 'ready') {
      throw new VoicePrivacyError(
        'local-model-missing',
        'Local Whisper model is not installed',
      )
    }
    const result = await adapters.local.transcribe(input)
    return {
      ...result,
      engine: 'local-whisper',
      uploaded: false,
    }
  }

  if (options.offline) {
    throw new VoicePrivacyError('cloud-stt-offline', 'Cloud speech is unavailable offline')
  }

  const result = await adapters.cloud.transcribe(input)
  return {
    ...result,
    engine: adapters.cloud.engine,
    uploaded: true,
  }
}

export async function speakWithPolicy(
  prefs: VoicePrefs,
  input: SpeakInput,
  adapters: { edge: SpeakAdapter },
): Promise<SpeakResult> {
  if (prefs.version !== VOICE_PREFS_VERSION || prefs.ttsEngine !== 'edge') {
    throw new VoicePrivacyError('consent-required', 'Select Edge TTS explicitly in current voice settings')
  }
  input.signal?.throwIfAborted()
  const adapter = adapters.edge
  const result = await adapter.speak(input)
  return { ...result, engine: prefs.ttsEngine, uploaded: false }
}

export function assertEditableTranscript(text: string): string {
  const next = text.trim()
  if (!next) {
    throw new VoicePrivacyError('empty-transcript', 'Transcript is empty')
  }
  return next
}
