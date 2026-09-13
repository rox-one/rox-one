import { shouldUploadAudio } from './policy.ts'
import type {
  SpeakAdapter,
  SpeakInput,
  SpeakResult,
  TranscribeAdapter,
  TranscribeInput,
  TranscribeResult,
  VoicePrefs,
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
  if (prefs.privacyMigrationPending && shouldUploadAudio(prefs)) {
    throw new VoicePrivacyError('consent-required', 'Confirm archive and cloud ASR consent before recording')
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
      text: result.text,
      engine: 'local-whisper',
      uploaded: false,
      noSpeech: result.noSpeech,
      requestId: result.requestId,
    }
  }

  if (options.offline) {
    throw new VoicePrivacyError('cloud-stt-offline', 'Cloud speech is unavailable offline')
  }

  const result = await adapters.cloud.transcribe(input)
  return {
    text: result.text,
    engine: prefs.sttEngine,
    uploaded: true,
    noSpeech: result.noSpeech,
    requestId: result.requestId,
  }
}

export async function speakWithPolicy(
  prefs: VoicePrefs,
  input: SpeakInput,
  adapters: { edge: SpeakAdapter; fish: SpeakAdapter },
): Promise<SpeakResult> {
  const adapter = prefs.ttsEngine === 'fish-speech' ? adapters.fish : adapters.edge
  const result = await adapter.speak(input)
  return { engine: prefs.ttsEngine, uploaded: false }
}

export function assertEditableTranscript(text: string): string {
  const next = text.trim()
  if (!next) {
    throw new VoicePrivacyError('empty-transcript', 'Transcript is empty')
  }
  return next
}
