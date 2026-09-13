import { getCachedVoiceCapabilities } from './capabilities.ts'
import { voiceLanguageLabel, type VoiceCapabilities } from './contracts.ts'
import {
  DEFAULT_WAKE_PHRASE,
  type SttEngine,
  type VoiceHealth,
  type VoicePrefs,
  type VoiceRecordingStatus,
} from './types.ts'

const KEEP_AUDIO_STATUSES: ReadonlySet<VoiceRecordingStatus> = new Set([
  'recording',
  'interrupted',
  'queued',
  'transcribing',
  'error',
])

export type WakeListenDecision =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'consent-required' }

export function usesCloudStt(engine: SttEngine): boolean {
  return engine === 'cloud-rox' || engine === 'cloud-deepgram'
}

/** Local Whisper never leaves the machine. Cloud engines upload by policy. */
export function shouldUploadAudio(prefs: Pick<VoicePrefs, 'sttEngine'>): boolean {
  return usesCloudStt(prefs.sttEngine)
}

export function resolveAudioRetention(
  prefs: Pick<VoicePrefs, 'audioRetention'>,
): VoicePrefs['audioRetention'] {
  return prefs.audioRetention
}

/**
 * Local audio bytes vs transcript history.
 *
 * `none` discards bytes as soon as capture is complete or canceled.
 * `session` keeps bytes until the host reloads, then only favorites.
 * `cloud-policy` keeps local bytes until the user deletes the recording.
 * In-flight / interrupted / failed captures always keep bytes so retry works.
 */
export function shouldDiscardAudio(
  prefs: Pick<VoicePrefs, 'audioRetention'>,
  rec: { status: VoiceRecordingStatus; favorite?: boolean },
  phase: 'immediate' | 'host-reload',
): boolean {
  if (KEEP_AUDIO_STATUSES.has(rec.status)) return false
  if (prefs.audioRetention === 'cloud-policy') return false
  if (prefs.audioRetention === 'none') return true
  if (phase === 'immediate') return false
  return rec.favorite !== true
}

export function canStartWakeListening(
  prefs: Pick<VoicePrefs, 'wakeWordEnabled' | 'alwaysListeningConsent'>,
): WakeListenDecision {
  if (!prefs.wakeWordEnabled) return { ok: false, reason: 'disabled' }
  if (!prefs.alwaysListeningConsent) return { ok: false, reason: 'consent-required' }
  return { ok: true }
}

export function withWakeWordConsent(
  prefs: VoicePrefs,
  consent: { enabled: boolean; alwaysListening: boolean },
  now: number = Date.now(),
): VoicePrefs {
  const alwaysListeningConsent = consent.enabled ? consent.alwaysListening : false
  return {
    ...prefs,
    wakeWordEnabled: consent.enabled && alwaysListeningConsent,
    alwaysListeningConsent,
    wakePhrase: prefs.wakePhrase || DEFAULT_WAKE_PHRASE,
    updatedAt: now,
  }
}

export function describeLocalSttBackend(info: { appleSilicon: boolean }): VoiceHealth['localBackend'] {
  return info.appleSilicon ? 'whisper-large-v3-turbo-mlx' : 'whisper-large-v3-turbo-cpu'
}

export function buildVoiceHealth(
  prefs: VoicePrefs,
  info: {
    appleSilicon: boolean
    offline: boolean
    localModelReady?: boolean
    capabilities?: VoiceCapabilities
  },
): VoiceHealth {
  const wake = canStartWakeListening(prefs)
  const localModelReady = info.localModelReady === true
  const caps = info.capabilities ?? getCachedVoiceCapabilities()
  return {
    sttEngine: prefs.sttEngine,
    ttsEngine: prefs.ttsEngine,
    whisper: localModelReady ? 'ready' : (prefs.whisperStatus === 'ready' ? 'missing' : prefs.whisperStatus),
    localBackend: describeLocalSttBackend(info),
    appleSilicon: info.appleSilicon,
    offline: info.offline,
    wakeWordArmed: wake.ok,
    audioRetention: resolveAudioRetention(prefs),
    localModelReady,
    cloudModelId: caps.modelId,
    cloudDisplayName: caps.displayName,
    languageLabel: voiceLanguageLabel(caps),
  }
}

/** RMS energy gate used by the renderer capture loop. */
export function isVoiceActive(
  samples: ArrayLike<number>,
  threshold = 0.02,
): boolean {
  if (samples.length === 0) return false
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length) >= threshold
}
