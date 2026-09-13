import { classifyEvidence, collectEvidenceInput } from './acceptance.ts'
import { ROCKS_T1_DISPLAY_NAME, ROCKS_T1_MODEL_ID } from './contracts.ts'
import type { VoiceEnv } from './runtime.ts'
import {
  DEFAULT_WAKE_PHRASE,
  type SttEngine,
  type VoiceHealth,
  type VoicePrefs,
} from './types.ts'

export type WakeListenDecision =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'consent-required' }

export function usesCloudStt(engine: SttEngine): boolean {
  return engine === 'cloud-rox' || engine === 'cloud-deepgram'
}

/** Cloud engines upload only after explicit ASR consent. Local never leaves the machine. */
export function shouldUploadAudio(prefs: Pick<VoicePrefs, 'sttEngine' | 'cloudAsrConsent'>): boolean {
  return usesCloudStt(prefs.sttEngine) && prefs.cloudAsrConsent === true
}

export function resolveAudioRetention(
  prefs: Pick<VoicePrefs, 'sttEngine' | 'audioRetention' | 'cloudAsrConsent'>,
): VoicePrefs['audioRetention'] {
  if (!shouldUploadAudio(prefs)) return 'none'
  return prefs.audioRetention === 'none' ? 'cloud-policy' : prefs.audioRetention
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
  info: { appleSilicon: boolean; offline: boolean },
  env: VoiceEnv = process.env,
): VoiceHealth {
  const wake = canStartWakeListening(prefs)
  const evidence = classifyEvidence(collectEvidenceInput(env, {
    localWhisperReady: prefs.whisperStatus === 'ready',
    liveCloudAsr: false,
    liveEnhancement: false,
    overlayWithoutFocusSteal: false,
    historyDurable: false,
  }))
  return {
    sttEngine: prefs.sttEngine,
    ttsEngine: prefs.ttsEngine,
    whisper: prefs.whisperStatus,
    localBackend: describeLocalSttBackend(info),
    appleSilicon: info.appleSilicon,
    offline: info.offline,
    wakeWordArmed: wake.ok,
    audioRetention: resolveAudioRetention(prefs),
    asrModelId: prefs.asrModelId || ROCKS_T1_MODEL_ID,
    asrBrand: ROCKS_T1_DISPLAY_NAME,
    evidenceClass: evidence.class,
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
