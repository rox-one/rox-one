import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash as nodeHash } from 'node:crypto'
import {
  LAST_KNOWN_GOOD_CAPABILITIES,
  ROCKS_T1_MODEL_ID,
  RoxTranscriptionAdapter,
  VoiceHost,
  applyJobEvent,
  buildQueryPlan,
  canBindAccelerator,
  canonicalizeModules,
  classifyEvidence,
  compilePrompt,
  createVoiceJob,
  detectHotkeyCapabilities,
  isBlockedUrl,
  languageBadgeCount,
  overlayShouldStealFocus,
  parseCapabilities,
  rocksT1RouteNote,
  shouldShow74LanguageBadge,
  VoiceIdentityClient,
  memoryIdentityStore,
  GigaamE2eRnntAdapter,
  NemotronStreamingAdapter,
  WhisperLargeV3TurboAdapter,
  catalogTemplate,
  validateManifestShape,
  writeAtomicFile,
} from '../index.ts'

function wavSilence(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
  return bytes
}

describe('voice gateway contract', () => {
  it('brands rocks-t1 exactly and does not invent a 74-language badge', () => {
    const route = rocksT1RouteNote()
    expect(route.brand).toBe('rocks transcription (rocks t1)')
    expect(route.alias).toBe(ROCKS_T1_MODEL_ID)
    expect(shouldShow74LanguageBadge(LAST_KNOWN_GOOD_CAPABILITIES)).toBe(false)
    expect(languageBadgeCount(LAST_KNOWN_GOOD_CAPABILITIES)).toBe(2)
    const spoof = parseCapabilities({ signatureValid: false, languages: Array.from({ length: 74 }, (_, i) => ({ code: `l${i}` })) })
    expect(spoof.signatureValid).toBe(false)
    expect(spoof.languages).toEqual(LAST_KNOWN_GOOD_CAPABILITIES.languages)
  })

  it('bootstraps a voice-only token with singleflight', async () => {
    let calls = 0
    const http = {
      async fetch() {
        calls += 1
        return new Response(JSON.stringify({
          accessToken: 'tok',
          expiresIn: 900,
          scopes: ['voice:transcribe', 'voice:process', 'voice:capabilities'],
          installationId: 'inst-1',
        }), { status: 200 })
      },
    }
    const client = new VoiceIdentityClient(memoryIdentityStore(), http, { now: () => 1 })
    const [a, b] = await Promise.all([client.bearer(), client.bearer()])
    expect(a).toBe('tok')
    expect(b).toBe('tok')
    expect(calls).toBe(1)
  })

  it('rejects tokens that try to grant chat or admin scopes', async () => {
    const http = {
      async fetch() {
        return new Response(JSON.stringify({
          accessToken: 'tok',
          scopes: ['voice:transcribe', 'admin:all'],
          installationId: 'x',
        }), { status: 200 })
      },
    }
    const client = new VoiceIdentityClient(memoryIdentityStore(), http)
    await expect(client.bearer()).rejects.toThrow(/scope/)
  })
})

describe('rox transcription adapter', () => {
  it('posts multipart rocks-t1 verbose_json and converts seconds once', async () => {
    const requests: Array<{ url: string; headers: Headers; body: FormData }> = []
    const http = {
      async fetch(url: string, init: RequestInit) {
        requests.push({ url, headers: new Headers(init.headers), body: init.body as FormData })
        return new Response(JSON.stringify({
          text: 'hello',
          language: 'en',
          duration: 1.5,
          model: 'whisper-large-v3-turbo',
          segments: [{ start: 0, end: 1.5, text: 'hello' }],
        }), { status: 200, headers: { 'x-request-id': 'req-1' } })
      },
    }
    const identity = new VoiceIdentityClient(memoryIdentityStore({
      accessToken: 'tok',
      expiresAt: Date.now() + 60_000,
      scopes: ['voice:transcribe'],
      installationId: 'i',
    }), http)
    const adapter = new RoxTranscriptionAdapter({
      capabilities: { ...LAST_KNOWN_GOOD_CAPABILITIES, availability: 'ok', quota: { asr: { remaining: 3, resetAt: 0 }, process: { remaining: 3, resetAt: 0 } } },
      identity,
      http,
    })
    const originalAudio = wavSilence()
    const paddedAudio = new Uint8Array(originalAudio.length + 8)
    paddedAudio.set(originalAudio, 4)
    const result = await adapter.transcribe({
      audio: paddedAudio.subarray(4, 4 + originalAudio.length),
      mimeType: 'audio/wav',
      language: 'auto',
    })
    expect(result.text).toBe('hello')
    expect(result.durationMs).toBe(1500)
    expect(result.segments[0]?.endMs).toBe(1500)
    expect(result.requestedModelId).toBe('rocks-t1')
    const form = requests[0]?.body
    expect(form?.get('model')).toBe('rocks-t1')
    expect(form?.get('language')).toBeNull()
    expect(form?.get('response_format')).toBe('verbose_json')
    const file = form?.get('file')
    if (!(file instanceof Blob)) throw new Error('expected an audio file in the multipart request')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(originalAudio)
  })

  it('does not treat empty ASR text as success unless no-speech', async () => {
    const empty = {
      async fetch() {
        return new Response(JSON.stringify({ text: '' }), { status: 200 })
      },
    }
    const silence = {
      async fetch() {
        return new Response(JSON.stringify({ text: '', duration: 1.2, no_speech: true }), { status: 200 })
      },
    }
    const identity = (http: { fetch: typeof empty.fetch }) => new VoiceIdentityClient(memoryIdentityStore({
      accessToken: 'tok', expiresAt: Date.now() + 60_000, scopes: ['voice:transcribe'], installationId: 'i',
    }), http)
    const caps = { ...LAST_KNOWN_GOOD_CAPABILITIES, availability: 'ok' as const, quota: { asr: { remaining: 3, resetAt: 0 }, process: { remaining: 3, resetAt: 0 } } }
    await expect(new RoxTranscriptionAdapter({ capabilities: caps, identity: identity(empty), http: empty })
      .transcribe({ audio: wavSilence(), mimeType: 'audio/wav' })).rejects.toMatchObject({ code: 'upstream' })
    const quiet = await new RoxTranscriptionAdapter({ capabilities: caps, identity: identity(silence), http: silence })
      .transcribe({ audio: wavSilence(), mimeType: 'audio/wav' })
    expect(quiet.noSpeech).toBe(true)
  })
})

describe('voice host and overlay', () => {
  it('keeps capture independent of composer remount and ignores stale seq', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-host-'))
    const host = new VoiceHost(dir, {
      async transcribe() {
        return {
          text: 'draft text',
          segments: [{ startMs: 0, endMs: 400, text: 'draft text' }],
          requestedModelId: 'rocks-t1',
          resolvedModelId: 'whisper-large-v3-turbo',
          requestId: 'r',
          durationMs: 400,
          noSpeech: false,
        }
      },
    }, () => 10)
    const prefs = { ...await import('../types.ts').then((m) => m.getDefaultVoicePrefs(10)) }
    const job = host.start(prefs)
    host.grantPermission()
    host.chunk(wavSilence())
    const finished = await host.stop(prefs)
    expect(finished.job).toBe('ready')
    const stale = applyJobEvent(createVoiceJob(job.recordingId, job.jobId), {
      recordingId: job.recordingId,
      jobId: job.jobId,
      seq: 0,
      job: 'failed',
    })
    expect(stale.job).toBe('queued')
    expect(overlayShouldStealFocus('recording')).toBe(false)
  })
})

describe('hotkeys', () => {
  it('gates Right Option until a native helper advertises modifier-only PTT', () => {
    const caps = detectHotkeyCapabilities('darwin')
    expect(canBindAccelerator('RightAlt', caps)?.reason).toBe('unregistered')
    expect(detectHotkeyCapabilities('web').globalToggle).toBe(false)
  })
})

describe('processing and enrichment', () => {
  it('compiles 14 modules in canonical order and skips search when off', () => {
    const compiled = compilePrompt({
      mode: 'improve-prompt',
      modules: ['prd', 'interview', 'plan'],
      transcriptOutputLanguage: 'preserve',
      answerLanguage: 'ru',
      transcript: 'сделай деплой с паролем secret',
    })
    expect(canonicalizeModules(['prd', 'interview', 'plan'])).toEqual(['plan', 'prd', 'interview'])
    expect(compiled.system).toContain('Interview questions come first')
    expect(buildQueryPlan('hello', false).skipped).toBe(true)
    expect(buildQueryPlan('привет', true).skipped).toBe(true)
    expect(isBlockedUrl('http://127.0.0.1/secret')).toBe(true)
    expect(isBlockedUrl('https://docs.rox.one/voice')).toBe(false)
  })
})

describe('local models and acceptance', () => {
  it('refuses unsigned manifests and production adapters without weights', async () => {
    expect(validateManifestShape({ family: 'whisper-large-v3-turbo', modelId: 'x', sourceRepo: 'openai/whisper-large-v3-turbo', sourceRevision: 'abc', files: [{ path: 'w.bin', url: 'https://cdn', bytes: 1, sha256: 'abcd', role: 'weights' }], signature: 'unsigned' }).ok).toBe(false)
    const whisper = new WhisperLargeV3TurboAdapter()
    await expect(whisper.load({ ...catalogTemplate('whisper-large-v3-turbo', 'darwin', 'arm64'), files: [], signature: 'sig' })).rejects.toMatchObject({ code: 'not-ready' })
    const nemo = new NemotronStreamingAdapter()
    await expect(nemo.load({ ...catalogTemplate('nemotron-3.5-asr-streaming-0.6b', 'darwin', 'arm64'), files: [], signature: 'sig' })).rejects.toMatchObject({ code: 'not-ready' })
    const giga = new GigaamE2eRnntAdapter()
    await expect(giga.load({ ...catalogTemplate('gigaam-v3-e2e-rnnt', 'darwin', 'arm64'), files: [], signature: 'sig' })).rejects.toMatchObject({ code: 'not-ready' })
    expect(classifyEvidence({
      liveCloudAsr: false,
      liveEnhancement: false,
      localWhisperReady: false,
      localNemotronReady: false,
      localGigaamReady: false,
      overlayWithoutFocusSteal: false,
      historyDurable: false,
      fixtureOnly: true,
    }).class).toBe('scaffold')
  })

  it('writes model files atomically after hash check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-model-'))
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sha = nodeHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const dest = join(dir, 'w.bin')
    await writeAtomicFile(dest, bytes, sha)
    expect(readFileSync(dest).length).toBe(4)
  })
})
