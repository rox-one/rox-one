/**
 * Persist voice prefs to `~/.craft-agent/voice.json`.
 * v1/v2 consent and TTS choices migrate conservatively; cloud consent is never inferred.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'
import { withWakeWordConsent } from './policy.ts'
import {
  DEFAULT_WAKE_PHRASE,
  VOICE_PREFS_VERSION,
  getDefaultVoicePrefs,
  isAudioRetention,
  isLocalArchivePolicy,
  isModelHealthStatus,
  isSttEngine,
  isTtsEngine,
  type EnhancementMode,
  type HotkeyMode,
  type OverlayPosition,
  type OverlayStyle,
  type RecognitionLanguage,
  type VoicePrefs,
} from './types.ts'

export const VOICE_PREFS_FILE = 'voice.json'

export function getVoicePrefsPath(configDir: string = resolveConfigDir()): string {
  return join(configDir, VOICE_PREFS_FILE)
}

function asLanguage(value: unknown): RecognitionLanguage {
  return value === 'en' || value === 'ru' || value === 'auto' ? value : 'auto'
}

function asEnhancement(value: unknown): EnhancementMode {
  return value === 'clean' || value === 'improve-prompt' || value === 'verbatim' ? value : 'verbatim'
}

function asHotkeyMode(value: unknown): HotkeyMode {
  return value === 'ptt' ? 'ptt' : 'toggle'
}

function asOverlayPosition(value: unknown): OverlayPosition {
  return value === 'top' ? 'top' : 'bottom'
}

function asOverlayStyle(value: unknown): OverlayStyle {
  return value === 'live' ? 'live' : 'minimal'
}

export function normalizeVoicePrefs(raw: unknown, now: number = Date.now()): VoicePrefs {
  const base = getDefaultVoicePrefs(now)
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const version = obj.version === 3 ? 3 : typeof obj.version === 'number' ? obj.version : 1
  const sttEngine = isSttEngine(obj.sttEngine) ? obj.sttEngine : base.sttEngine
  const ttsEngine = version === VOICE_PREFS_VERSION && isTtsEngine(obj.ttsEngine)
    ? obj.ttsEngine : base.ttsEngine
  const audioRetention = isAudioRetention(obj.audioRetention)
    ? obj.audioRetention
    : base.audioRetention
  const wakeWordEnabled = obj.wakeWordEnabled === true
  const alwaysListeningConsent = obj.alwaysListeningConsent === true
  const wakePhrase =
    typeof obj.wakePhrase === 'string' && obj.wakePhrase.trim()
      ? obj.wakePhrase.trim()
      : DEFAULT_WAKE_PHRASE
  const selectedInputDeviceId =
    typeof obj.selectedInputDeviceId === 'string' ? obj.selectedInputDeviceId : null
  const selectedOutputDeviceId =
    typeof obj.selectedOutputDeviceId === 'string' ? obj.selectedOutputDeviceId : null
  const whisperStatus = isModelHealthStatus(obj.whisperStatus)
    ? obj.whisperStatus
    : base.whisperStatus
  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : now

  const explicitLocal = version < 2 && sttEngine === 'local-whisper'
  const privacyMigrationPending = explicitLocal
    ? obj.privacyMigrationPending !== false
    : version < 3 || obj.privacyMigrationPending === true

  const prefs: VoicePrefs = {
    version: VOICE_PREFS_VERSION,
    sttEngine: explicitLocal ? 'local-whisper' : sttEngine,
    ttsEngine,
    audioRetention,
    localArchivePolicy: isLocalArchivePolicy(obj.localArchivePolicy)
      ? obj.localArchivePolicy
      : (explicitLocal ? 'none' : base.localArchivePolicy),
    asrModelId: typeof obj.asrModelId === 'string' && !(sttEngine === 'cloud-rox' && obj.asrModelId === 'rocks-t1')
      ? obj.asrModelId : (explicitLocal ? 'whisper-large-v3-turbo' : base.asrModelId),
    recognitionLanguage: asLanguage(obj.recognitionLanguage),
    timestamps: obj.timestamps === 'word' || obj.timestamps === 'none' || obj.timestamps === 'segment' ? obj.timestamps : 'segment',
    cloudAsrConsent: version >= 3 && obj.cloudAsrConsent === true,
    cloudEnhancementConsent: obj.cloudEnhancementConsent === true,
    webEnrichmentConsent: obj.webEnrichmentConsent === true,
    privacyMigrationPending,
    trailingSpace: version === VOICE_PREFS_VERSION && obj.trailingSpace === true,
    delivery: version === VOICE_PREFS_VERSION && obj.delivery === 'clipboard' ? 'clipboard' : 'draft',
    autoSubmit: false,
    enhancementMode: asEnhancement(obj.enhancementMode),
    enhancementModules: Array.isArray(obj.enhancementModules)
      ? obj.enhancementModules.filter((item): item is string => typeof item === 'string')
      : [],
    pttModifier: version === VOICE_PREFS_VERSION && (obj.pttModifier === 'ControlRight' || obj.pttModifier === 'none') ? obj.pttModifier : 'AltRight',
    hotkeyMode: asHotkeyMode(obj.hotkeyMode),
    toggleAccelerator: typeof obj.toggleAccelerator === 'string' ? obj.toggleAccelerator : base.toggleAccelerator,
    cancelAccelerator: typeof obj.cancelAccelerator === 'string' ? obj.cancelAccelerator : base.cancelAccelerator,
    overlayPosition: asOverlayPosition(obj.overlayPosition),
    overlayStyle: asOverlayStyle(obj.overlayStyle),
    soundFeedback: obj.soundFeedback === true,
    wakeWordEnabled: false,
    alwaysListeningConsent: false,
    wakePhrase,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    whisperStatus,
    updatedAt,
  }
  return withWakeWordConsent(prefs, {
    enabled: wakeWordEnabled,
    alwaysListening: alwaysListeningConsent,
  }, updatedAt)
}

export function loadVoicePrefs(configDir: string = resolveConfigDir()): VoicePrefs {
  try {
    const path = getVoicePrefsPath(configDir)
    if (!existsSync(path)) return getDefaultVoicePrefs()
    return normalizeVoicePrefs(readJsonFileSync<unknown>(path))
  } catch {
    return getDefaultVoicePrefs()
  }
}

export function saveVoicePrefs(
  prefs: VoicePrefs,
  configDir: string = resolveConfigDir(),
): VoicePrefs {
  const normalized = normalizeVoicePrefs({ ...prefs, updatedAt: Date.now() })
  const path = getVoicePrefsPath(configDir)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}
