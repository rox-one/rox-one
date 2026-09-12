/**
 * Persist voice prefs to `~/.craft-agent/voice.json`.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'
import { withWakeWordConsent } from './policy.ts'
import {
  DEFAULT_WAKE_PHRASE,
  getDefaultVoicePrefs,
  isAudioRetention,
  isModelHealthStatus,
  isSttEngine,
  isTtsEngine,
  type VoicePrefs,
} from './types.ts'

export const VOICE_PREFS_FILE = 'voice.json'

export function getVoicePrefsPath(configDir: string = resolveConfigDir()): string {
  return join(configDir, VOICE_PREFS_FILE)
}

export function normalizeVoicePrefs(raw: unknown, now: number = Date.now()): VoicePrefs {
  const base = getDefaultVoicePrefs(now)
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const sttEngine = isSttEngine(obj.sttEngine) ? obj.sttEngine : base.sttEngine
  const ttsEngine = isTtsEngine(obj.ttsEngine) ? obj.ttsEngine : base.ttsEngine
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

  const prefs: VoicePrefs = {
    version: 1,
    sttEngine,
    ttsEngine,
    audioRetention: sttEngine === 'local-whisper' ? 'none' : audioRetention,
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
