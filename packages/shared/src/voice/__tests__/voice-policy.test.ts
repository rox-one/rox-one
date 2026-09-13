import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_WAKE_PHRASE,
  ROCKS_T1_DISPLAY_NAME,
  ROCKS_T1_MODEL_ID,
  VoicePrivacyError,
  assertEditableTranscript,
  buildVoiceHealth,
  canStartWakeListening,
  describeLocalSttBackend,
  getDefaultVoicePrefs,
  isVoiceActive,
  loadVoicePrefs,
  normalizeVoicePrefs,
  saveVoicePrefs,
  shouldUploadAudio,
  speakWithPolicy,
  transcribeWithPolicy,
  withWakeWordConsent,
  type SpeakAdapter,
  type TranscribeAdapter,
  type VoicePrefs,
} from '../index.ts'

function localAdapter(text = 'hello locally'): TranscribeAdapter {
  return {
    engine: 'local-whisper',
    async transcribe() {
      return { text, engine: 'local-whisper', uploaded: false }
    },
  }
}

function cloudAdapter(text = 'hello cloud'): TranscribeAdapter {
  return {
    engine: 'cloud-deepgram',
    async transcribe() {
      return { text, engine: 'cloud-deepgram', uploaded: true }
    },
  }
}

function edgeAdapter(): SpeakAdapter {
  return {
    engine: 'edge',
    async speak() {
      return { engine: 'edge', uploaded: false }
    },
  }
}

describe('voice privacy policy', () => {
  it('defaults new installs to cloud-rox rocks-t1 without auto-submit', () => {
    const prefs = getDefaultVoicePrefs(1)
    expect(prefs.sttEngine).toBe('cloud-rox')
    expect(prefs.asrModelId).toBe(ROCKS_T1_MODEL_ID)
    expect(prefs.ttsEngine).toBe('edge')
    expect(prefs.wakeWordEnabled).toBe(false)
    expect(prefs.alwaysListeningConsent).toBe(false)
    expect(prefs.autoSubmit).toBe(false)
    expect(prefs.cloudEnhancementConsent).toBe(false)
    expect(prefs.webEnrichmentConsent).toBe(false)
    expect(prefs.wakePhrase).toBe(DEFAULT_WAKE_PHRASE)
    expect(shouldUploadAudio(prefs)).toBe(true)
    expect(canStartWakeListening(prefs)).toEqual({ ok: false, reason: 'disabled' })
  })

  it('does not upload without cloud ASR consent', () => {
    const prefs = { ...getDefaultVoicePrefs(1), cloudAsrConsent: false }
    expect(shouldUploadAudio(prefs)).toBe(false)
  })

  it('does not silently migrate an explicit v1 local user to cloud', () => {
    const prefs = normalizeVoicePrefs({
      version: 1,
      sttEngine: 'local-whisper',
      audioRetention: 'none',
    }, 5)
    expect(prefs.sttEngine).toBe('local-whisper')
    expect(prefs.cloudAsrConsent).toBe(false)
    expect(prefs.privacyMigrationPending).toBe(true)
    expect(shouldUploadAudio(prefs)).toBe(false)
  })

  it('refuses to arm wake word without always-listening consent', () => {
    const prefs = withWakeWordConsent(getDefaultVoicePrefs(1), {
      enabled: true,
      alwaysListening: false,
    }, 2)
    expect(prefs.wakeWordEnabled).toBe(false)
    expect(canStartWakeListening(prefs)).toEqual({ ok: false, reason: 'disabled' })
  })

  it('arms wake word only after explicit consent', () => {
    const prefs = withWakeWordConsent(getDefaultVoicePrefs(1), {
      enabled: true,
      alwaysListening: true,
    }, 2)
    expect(prefs.wakeWordEnabled).toBe(true)
    expect(prefs.alwaysListeningConsent).toBe(true)
    expect(canStartWakeListening(prefs)).toEqual({ ok: true })
  })

  it('transcribes locally without calling the cloud adapter', async () => {
    const prefs: VoicePrefs = {
      ...getDefaultVoicePrefs(1),
      sttEngine: 'local-whisper',
      cloudAsrConsent: false,
      whisperStatus: 'ready',
    }
    let cloudCalls = 0
    const cloud: TranscribeAdapter = {
      engine: 'cloud-rox',
      async transcribe(input) {
        cloudCalls += 1
        return cloudAdapter().transcribe(input)
      },
    }
    const result = await transcribeWithPolicy(prefs, {
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    }, { local: localAdapter('dictate this'), cloud })
    expect(result).toEqual({
      text: 'dictate this',
      engine: 'local-whisper',
      uploaded: false,
      noSpeech: undefined,
      requestId: undefined,
    })
    expect(cloudCalls).toBe(0)
  })

  it('uploads audio only when a cloud STT engine is selected and consented', async () => {
    const prefs: VoicePrefs = {
      ...getDefaultVoicePrefs(1),
      sttEngine: 'cloud-deepgram',
      cloudAsrConsent: true,
      audioRetention: 'cloud-policy',
    }
    let localCalls = 0
    const local: TranscribeAdapter = {
      engine: 'local-whisper',
      async transcribe(input) {
        localCalls += 1
        return localAdapter().transcribe(input)
      },
    }
    const result = await transcribeWithPolicy(prefs, {
      audio: new Uint8Array([9]),
      mimeType: 'audio/webm',
    }, { local, cloud: cloudAdapter('cloud text') })
    expect(result.uploaded).toBe(true)
    expect(result.engine).toBe('cloud-deepgram')
    expect(localCalls).toBe(0)
  })

  it('blocks cloud STT while offline', async () => {
    const prefs: VoicePrefs = { ...getDefaultVoicePrefs(1), sttEngine: 'cloud-rox' }
    await expect(transcribeWithPolicy(prefs, {
      audio: new Uint8Array([1]),
      mimeType: 'audio/webm',
    }, { local: localAdapter(), cloud: cloudAdapter() }, { offline: true })).rejects.toMatchObject({
      code: 'cloud-stt-offline',
    })
  })

  it('does not upload TTS audio', async () => {
    const result = await speakWithPolicy(
      getDefaultVoicePrefs(1),
      { text: 'hello' },
      { edge: edgeAdapter(), fish: { engine: 'fish-speech', async speak() { return { engine: 'fish-speech', uploaded: false } } } },
    )
    expect(result).toEqual({ engine: 'edge', uploaded: false })
  })

  it('keeps live transcripts editable', () => {
    expect(assertEditableTranscript('  Привет  ')).toBe('Привет')
    expect(() => assertEditableTranscript('   ')).toThrow(VoicePrivacyError)
  })

  it('gates VAD on RMS energy', () => {
    expect(isVoiceActive(new Float32Array(32), 0.02)).toBe(false)
    const loud = new Float32Array(8)
    loud.fill(0.5)
    expect(isVoiceActive(loud, 0.02)).toBe(true)
  })

  it('documents MLX on Apple Silicon and CPU fallback elsewhere', () => {
    expect(describeLocalSttBackend({ appleSilicon: true })).toBe('whisper-large-v3-turbo-mlx')
    expect(describeLocalSttBackend({ appleSilicon: false })).toBe('whisper-large-v3-turbo-cpu')
    const health = buildVoiceHealth(getDefaultVoicePrefs(1), {
      appleSilicon: false,
      offline: true,
    })
    expect(health.offline).toBe(true)
    expect(health.wakeWordArmed).toBe(false)
    expect(health.asrBrand).toBe(ROCKS_T1_DISPLAY_NAME)
  })

  it('normalizes persisted wake-word flags so consent cannot be skipped', () => {
    const prefs = normalizeVoicePrefs({
      wakeWordEnabled: true,
      alwaysListeningConsent: false,
      sttEngine: 'local-whisper',
      version: 1,
    }, 5)
    expect(prefs.wakeWordEnabled).toBe(false)
    expect(prefs.alwaysListeningConsent).toBe(false)
  })

  it('round-trips prefs without uploading secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-'))
    const saved = saveVoicePrefs({
      ...getDefaultVoicePrefs(1),
      selectedInputDeviceId: 'mic-1',
      whisperStatus: 'ready',
    }, dir)
    expect(loadVoicePrefs(dir).selectedInputDeviceId).toBe('mic-1')
    const raw = readFileSync(join(dir, 'voice.json'), 'utf8')
    expect(raw).toContain('"sttEngine": "cloud-rox"')
    expect(raw).toContain('"asrModelId": "rocks-t1"')
    expect(saved.wakeWordEnabled).toBe(false)
  })
})
