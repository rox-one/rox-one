import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_WAKE_PHRASE,
  DEEPGRAM_TRANSCRIPTION_NAME,
  DEEPGRAM_TRANSCRIPTION_MODEL,
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
  transcribeWithPolicy,
  withWakeWordConsent,
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
    engine: 'cloud-rox',
    async transcribe() {
      return { text, engine: 'cloud-rox', uploaded: true }
    },
  }
}


describe('voice privacy policy', () => {
  it('defaults new installs to cloud-rox Deepgram Nova without auto-submit', () => {
    const prefs = getDefaultVoicePrefs(1)
    expect(prefs.sttEngine).toBe('cloud-rox')
    expect(prefs.asrModelId).toBe(DEEPGRAM_TRANSCRIPTION_MODEL)
    expect(prefs.ttsEngine).toBe('system')
    expect(prefs.wakeWordEnabled).toBe(false)
    expect(prefs.alwaysListeningConsent).toBe(false)
    expect(prefs.autoSubmit).toBe(false)
    expect(prefs.cloudEnhancementConsent).toBe(false)
    expect(prefs.webEnrichmentConsent).toBe(false)
    expect(prefs.wakePhrase).toBe(DEFAULT_WAKE_PHRASE)
    expect(shouldUploadAudio(prefs)).toBe(false)
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
  it('does not reinterpret legacy default cloud consent or remote TTS as user choices', () => {
    const prefs = normalizeVoicePrefs({
      version: 2,
      sttEngine: 'cloud-rox',
      cloudAsrConsent: true,
      ttsEngine: 'edge',
    }, 6)
    expect(prefs.version).toBe(3)
    expect(prefs.cloudAsrConsent).toBe(false)
    expect(prefs.privacyMigrationPending).toBe(true)
    expect(prefs.ttsEngine).toBe('system')
  })
  it('retains only explicit current-version Edge choices independently of ASR consent', () => {
    for (const version of [undefined, 1, 2, 4]) {
      expect(normalizeVoicePrefs({ version, ttsEngine: 'edge' }).ttsEngine).toBe('system')
    }
    const pending = normalizeVoicePrefs({ version: 3, ttsEngine: 'edge', privacyMigrationPending: true, cloudAsrConsent: false })
    expect(pending.ttsEngine).toBe('edge')
    expect(pending.privacyMigrationPending).toBe(true)
    expect(pending.cloudAsrConsent).toBe(false)
    expect(normalizeVoicePrefs({ version: 3, ttsEngine: 'edge', privacyMigrationPending: false }).ttsEngine).toBe('edge')
    expect(normalizeVoicePrefs({ version: 3, ttsEngine: 'fish-speech' }).ttsEngine).toBe('system')
  })
  it('requires explicit ASR consent instead of silently switching engines', async () => {
    const prefs = getDefaultVoicePrefs(1)
    let localCalls = 0
    const local: TranscribeAdapter = {
      engine: 'local-whisper',
      async transcribe(input) {
        localCalls += 1
        return localAdapter().transcribe(input)
      },
    }
    await expect(transcribeWithPolicy(prefs, {
      audio: new Uint8Array([1]),
      mimeType: 'audio/webm',
    }, { local, cloud: cloudAdapter() })).rejects.toMatchObject({ code: 'consent-required' })
    expect(localCalls).toBe(0)
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
      sttEngine: 'cloud-rox',
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
    expect(result.engine).toBe('cloud-rox')
    expect(localCalls).toBe(0)
  })
  it('preserves the actual ASR model evidence returned by the selected provider', async () => {
    const result = await transcribeWithPolicy(
      { ...getDefaultVoicePrefs(1), cloudAsrConsent: true },
      { audio: new Uint8Array([1]), mimeType: 'audio/webm' },
      {
        local: localAdapter(),
        cloud: {
          engine: 'cloud-rox',
          async transcribe() {
            return {
              text: 'Привет',
              engine: 'cloud-rox',
              uploaded: true,
              requestedModelId: 'rocks-t1',
              resolvedModelId: 'whisper-large-v3-turbo',
              routeVersion: 'route-2026-09',
              requestId: 'request-1',
              detectedLanguage: 'ru',
              durationMs: 640,
            }
          },
        },
      },
    )
    expect(result).toMatchObject({
      engine: 'cloud-rox',
      requestedModelId: 'rocks-t1',
      resolvedModelId: 'whisper-large-v3-turbo',
      routeVersion: 'route-2026-09',
      requestId: 'request-1',
      detectedLanguage: 'ru',
      durationMs: 640,
    })
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
    expect(health.asrBrand).toBe(DEEPGRAM_TRANSCRIPTION_NAME)
    const fixtureHealth = buildVoiceHealth(getDefaultVoicePrefs(1), {
      appleSilicon: false,
      offline: true,
    }, { CI: '1' })
    expect(fixtureHealth.evidenceClass).toBe('scaffold')
    const credHealth = buildVoiceHealth({ ...getDefaultVoicePrefs(1), whisperStatus: 'ready' }, {
      appleSilicon: false,
      offline: true,
    }, { ROX_API_KEY: 'rox_test_key' })
    expect(credHealth.evidenceClass).toBe('local-model-beta')

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
    expect(raw).toContain('"asrModelId": "nova-3"')
    expect(saved.wakeWordEnabled).toBe(false)
  })
})
