/**
 * Voice RPC — dictation prefs, Device VoiceHost, Rox ASR adapter, history.
 *
 * body.transcript is never allowed to override ASR. Cloud audio uploads only
 * after cloudAsrConsent. Capture and history stay on this device.
 */

import { arch } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { resolveConfigDir } from '@craft-agent/shared/config/paths'
import {
  LAST_KNOWN_GOOD_CAPABILITIES,
  LOCAL_MODEL_FAMILIES,
  ROCKS_T1_DISPLAY_NAME,
  ROCKS_T1_MODEL_ID,
  RoxTranscriptionAdapter,
  VoiceHost,
  VoiceIdentityClient,
  VoicePrivacyError,
  assertEditableTranscript,
  buildVoiceHealth,
  catalogTemplate,
  createConfiguredLocalTranscribeAdapter,
  deleteRecording,
  exportRecording,
  getDefaultVoicePrefs,
  historyPage,
  loadHistoryIndex,
  loadVoicePrefs,
  memoryIdentityStore,
  parseCapabilities,
  resolveLocalAsrFamily,
  resolveVoiceGatewayMode,
  saveHistoryIndex,
  saveVoicePrefs,
  setFavorite,
  speakWithPolicy,
  transcribeWithPolicy,
  voiceGatewayBaseUrl,
  VOICE_PREFS_VERSION,
  type SpeakAdapter,
  type TranscribeAdapter,
  type TranscribeInput,
  type VoiceCapabilities,
  type VoicePrefs,
} from '@craft-agent/shared/voice'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.voice.GET,
  RPC_CHANNELS.voice.SAVE,
  RPC_CHANNELS.voice.HEALTH,
  RPC_CHANNELS.voice.TRANSCRIBE,
  RPC_CHANNELS.voice.SPEAK,
  RPC_CHANNELS.voice.BOOTSTRAP,
  RPC_CHANNELS.voice.CAPABILITIES,
  RPC_CHANNELS.voice.START,
  RPC_CHANNELS.voice.STOP,
  RPC_CHANNELS.voice.CANCEL,
  RPC_CHANNELS.voice.GRANT,
  RPC_CHANNELS.voice.CHUNK,
  RPC_CHANNELS.voice.HISTORY_LIST,
  RPC_CHANNELS.voice.HISTORY_GET,
  RPC_CHANNELS.voice.HISTORY_FAVORITE,
  RPC_CHANNELS.voice.HISTORY_DELETE,
  RPC_CHANNELS.voice.HISTORY_EXPORT,
  RPC_CHANNELS.voice.RETRANSCRIBE,
  RPC_CHANNELS.voice.REPROCESS,
  RPC_CHANNELS.voice.PROCESS,
  RPC_CHANNELS.voice.MODELS_LIST,
] as const

function appleSilicon(): boolean {
  return process.platform === 'darwin' && (arch() === 'arm64' || process.arch === 'arm64')
}

function decodeAudio(audioBase64: unknown): Uint8Array {
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    throw new Error('audioBase64 is required')
  }
  return Uint8Array.from(Buffer.from(audioBase64, 'base64'))
}

function localAdapter(prefs: VoicePrefs): TranscribeAdapter {
  return createConfiguredLocalTranscribeAdapter(prefs)
}

function fixtureHttp() {
  return {
    async fetch(url: string, init?: RequestInit) {
      if (url.includes('/voice/bootstrap')) {
        return new Response(JSON.stringify({
          accessToken: 'fixture-token',
          expiresIn: 900,
          scopes: ['voice:transcribe', 'voice:process', 'voice:capabilities'],
          installationId: 'fixture',
        }), { status: 200 })
      }
      if (url.includes('/voice/capabilities')) {
        return new Response(JSON.stringify({
          ...LAST_KNOWN_GOOD_CAPABILITIES,
          availability: 'ok',
          signatureValid: true,
          quota: { asr: { remaining: 100, resetAt: 0 }, process: { remaining: 100, resetAt: 0 } },
        }), { status: 200 })
      }
      if (url.includes('/audio/transcriptions')) {
        return new Response(JSON.stringify({
          text: 'rox cloud dictation',
          language: 'en',
          duration: 1.2,
          model: 'whisper-large-v3-turbo',
          segments: [{ start: 0, end: 1.2, text: 'rox cloud dictation' }],
        }), { status: 200, headers: { 'x-request-id': 'fixture-asr' } })
      }
      if (url.includes('/voice/process')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        return new Response(JSON.stringify({
          executed_tools: [],
          result: {
            outputText: `cleaned: ${body.user ?? 'ok'}`,
            transcriptLanguage: 'en',
            outputLanguage: 'en',
            answerLanguage: 'en',
            appliedModules: [],
            unresolvedQuestions: [],
            assumptions: [],
            sources: [],
            warnings: [],
          },
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    },
  }
}

function liveHttp() {
  return { fetch }
}

function voiceHttp() {
  return resolveVoiceGatewayMode() === 'live' ? liveHttp() : fixtureHttp()
}

function identityClient() {
  return new VoiceIdentityClient(memoryIdentityStore(), voiceHttp(), {
    baseUrl: voiceGatewayBaseUrl(),
  })
}

function cloudAdapter(prefs: VoicePrefs, caps: VoiceCapabilities): TranscribeAdapter {
  const adapter = new RoxTranscriptionAdapter({
    capabilities: caps,
    identity: identityClient(),
    http: voiceHttp(),
    baseUrl: voiceGatewayBaseUrl(),
  })
  return {
    engine: prefs.sttEngine,
    async transcribe(input) {
      const result = await adapter.transcribe({
        audio: input.audio,
        mimeType: input.mimeType,
        language: input.language,
      })
      return {
        text: result.text,
        engine: prefs.sttEngine,
        uploaded: true,
        noSpeech: result.noSpeech,
        requestId: result.requestId,
      }
    },
  }
}

function edgeSpeakAdapter(): SpeakAdapter {
  return { engine: 'edge', async speak() { return { engine: 'edge', uploaded: false } } }
}

function fishSpeakAdapter(): SpeakAdapter {
  return { engine: 'fish-speech', async speak() { return { engine: 'fish-speech', uploaded: false } } }
}

let cachedCaps: VoiceCapabilities = {
  ...LAST_KNOWN_GOOD_CAPABILITIES,
  availability: 'ok',
  quota: { asr: { remaining: 100, resetAt: 0 }, process: { remaining: 100, resetAt: 0 } },
}
let host: VoiceHost | null = null

function getHost(server: RpcServer): VoiceHost {
  if (!host) {
    host = new VoiceHost(resolveConfigDir(), {
      async transcribe(audio, mimeType, language) {
        const prefs = loadVoicePrefs()
        const result = await transcribeWithPolicy(prefs, { audio, mimeType, language }, {
          local: localAdapter(prefs),
          cloud: cloudAdapter(prefs, cachedCaps),
        })
        return {
          text: result.text,
          segments: [{ startMs: 0, endMs: 0, text: result.text }],
          requestedModelId: prefs.asrModelId || ROCKS_T1_MODEL_ID,
          resolvedModelId: prefs.asrModelId || ROCKS_T1_MODEL_ID,
          requestId: result.requestId ?? 'host',
          durationMs: 0,
          noSpeech: result.noSpeech === true,
        }
      },
    })
    host.on((event) => {
      pushTyped(server, RPC_CHANNELS.voice.JOB, { to: 'all' }, event.job)
      pushTyped(server, RPC_CHANNELS.voice.OVERLAY, { to: 'all' }, event.overlay)
    })
  }
  return host
}

function broadcast(server: RpcServer, prefs: VoicePrefs): void {
  pushTyped(server, RPC_CHANNELS.voice.CHANGED, { to: 'all' }, prefs)
}

export function registerVoiceHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.voice.GET, async () => loadVoicePrefs())

  server.handle(RPC_CHANNELS.voice.SAVE, async (_ctx, patch: unknown) => {
    const current = loadVoicePrefs()
    const next = saveVoicePrefs({
      ...current,
      ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch as Partial<VoicePrefs> : {}),
      version: VOICE_PREFS_VERSION,
    })
    broadcast(server, next)
    return next
  })

  server.handle(RPC_CHANNELS.voice.HEALTH, async () => {
    return buildVoiceHealth(loadVoicePrefs(), {
      appleSilicon: appleSilicon(),
      offline: false,
    }, {
      CI: process.env.CI,
      CRAFT_VOICE_GATEWAY_FIXTURE: process.env.CRAFT_VOICE_GATEWAY_FIXTURE,
      CRAFT_VOICE_LOCAL_FIXTURE: process.env.CRAFT_VOICE_LOCAL_FIXTURE,
      CRAFT_VOICE_ACCESS_TOKEN: process.env.CRAFT_VOICE_ACCESS_TOKEN,
      CRAFT_VOICE_GATEWAY_TOKEN: process.env.CRAFT_VOICE_GATEWAY_TOKEN,
      ROX_API_KEY: process.env.ROX_API_KEY,
    })
  })

  server.handle(RPC_CHANNELS.voice.BOOTSTRAP, async () => {
    const token = await identityClient().ensure()
    return { installationId: token.installationId, expiresAt: token.expiresAt, scopes: token.scopes }
  })

  server.handle(RPC_CHANNELS.voice.CAPABILITIES, async () => {
    try {
      const http = voiceHttp()
      const token = await identityClient().bearer()
      const response = await http.fetch(`${voiceGatewayBaseUrl()}/voice/capabilities`, {
        headers: { authorization: `Bearer ${token}` },
      })
      cachedCaps = parseCapabilities(await response.json(), cachedCaps)
    } catch {
      cachedCaps = parseCapabilities({ signatureValid: false }, cachedCaps)
    }
    return {
      ...cachedCaps,
      displayName: cachedCaps.displayName || ROCKS_T1_DISPLAY_NAME,
      languageCount: cachedCaps.languages.length,
      show74Badge: cachedCaps.languages.length === 74,
    }
  })

  server.handle(RPC_CHANNELS.voice.TRANSCRIBE, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const prefs = loadVoicePrefs()
    const input: TranscribeInput = {
      audio: decodeAudio(body.audioBase64),
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm',
      language: typeof body.language === 'string' ? body.language : prefs.recognitionLanguage === 'auto' ? undefined : prefs.recognitionLanguage,
    }
    try {
      return await transcribeWithPolicy(prefs, input, {
        local: localAdapter(prefs),
        cloud: cloudAdapter(prefs, cachedCaps),
      })
    } catch (error) {
      if (error instanceof VoicePrivacyError) throw new Error(error.message)
      throw error
    }
  })

  server.handle(RPC_CHANNELS.voice.SPEAK, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const text = assertEditableTranscript(typeof body.text === 'string' ? body.text : '')
    return speakWithPolicy(loadVoicePrefs(), { text }, {
      edge: edgeSpeakAdapter(),
      fish: fishSpeakAdapter(),
    })
  })

  server.handle(RPC_CHANNELS.voice.START, async () => getHost(server).start(loadVoicePrefs()))
  server.handle(RPC_CHANNELS.voice.GRANT, async () => getHost(server).grantPermission())
  server.handle(RPC_CHANNELS.voice.CHUNK, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    getHost(server).chunk(decodeAudio(body.audioBase64))
    return { ok: true }
  })
  server.handle(RPC_CHANNELS.voice.STOP, async () => getHost(server).stop(loadVoicePrefs()))
  server.handle(RPC_CHANNELS.voice.CANCEL, async () => getHost(server).cancel())

  server.handle(RPC_CHANNELS.voice.HISTORY_LIST, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    return historyPage(loadHistoryIndex(resolveConfigDir()), {
      cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
      limit: typeof body.limit === 'number' ? body.limit : 20,
      search: typeof body.search === 'string' ? body.search : undefined,
      favorite: body.favorite === true,
    })
  })

  server.handle(RPC_CHANNELS.voice.HISTORY_GET, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const id = typeof body.id === 'string' ? body.id : ''
    const index = loadHistoryIndex(resolveConfigDir())
    return {
      recording: index.recordings.find((item) => item.id === id) ?? null,
      revisions: index.revisions.filter((item) => item.recordingId === id),
      runs: index.runs,
    }
  })

  server.handle(RPC_CHANNELS.voice.HISTORY_FAVORITE, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const index = setFavorite(loadHistoryIndex(resolveConfigDir()), String(body.id), body.favorite === true)
    saveHistoryIndex(resolveConfigDir(), index)
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.voice.HISTORY_DELETE, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    saveHistoryIndex(resolveConfigDir(), deleteRecording(loadHistoryIndex(resolveConfigDir()), String(body.id)))
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.voice.HISTORY_EXPORT, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const format = body.format === 'srt' || body.format === 'json' ? body.format : 'txt'
    return { text: exportRecording(loadHistoryIndex(resolveConfigDir()), String(body.id), format) }
  })

  server.handle(RPC_CHANNELS.voice.RETRANSCRIBE, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    return { ok: true, recordingId: String(body.id ?? '') }
  })

  server.handle(RPC_CHANNELS.voice.REPROCESS, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    return { ok: true, recordingId: String(body.id ?? '') }
  })

  server.handle(RPC_CHANNELS.voice.PROCESS, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const prefs = loadVoicePrefs()
    if (!prefs.cloudEnhancementConsent) {
      return { skipped: true, reason: 'enhancement-off', text: typeof body.text === 'string' ? body.text : '' }
    }
    const http = voiceHttp()
    const response = await http.fetch(`${voiceGatewayBaseUrl()}/voice/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: body.text, tools: prefs.webEnrichmentConsent ? ['web_search'] : [] }),
    })
    return response.json()
  })

  server.handle(RPC_CHANNELS.voice.MODELS_LIST, async () => {
    const prefs = loadVoicePrefs()
    const platform = process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux' ? process.platform : 'linux'
    const archName = appleSilicon() || process.arch === 'arm64' ? 'arm64' : 'x64'
    const selected = resolveLocalAsrFamily(prefs.asrModelId)
    return {
      families: LOCAL_MODEL_FAMILIES,
      selected,
      catalog: LOCAL_MODEL_FAMILIES.map((family) => catalogTemplate(family, platform, archName)),
    }
  })
}

export function getDefaultVoiceDto(): VoicePrefs {
  return getDefaultVoicePrefs()
}
