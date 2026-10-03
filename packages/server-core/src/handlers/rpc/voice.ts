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
  createProductionLocalTranscribeAdapter,
  createProductionVoiceHttp,
  createEdgeSpeakAdapter,
  deleteRecording,
  exportRecording,
  getDefaultVoicePrefs,
  historyPage,
  loadHistoryIndex,
  loadVoicePrefs,
  memoryIdentityStore,
  parseCapabilities,
  resolveLocalAsrFamily,
  saveHistoryIndex,
  saveVoicePrefs,
  setFavorite,
  transcribeWithPolicy,
  speakWithPolicy,
  type SpeakAdapter,
  voiceGatewayBaseUrl,
  VOICE_PREFS_VERSION,
  type TranscribeAdapter,
  type TranscribeInput,
  type VoiceCapabilities,
  type VoicePrefs,
} from '@craft-agent/shared/voice'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { createSystemSpeaker, type SystemSpeaker } from './system-tts'
import {
  isClaimableLive,
  rpcVoiceActResult,
  rpcVoiceListResult,
  rpcVoiceReadResult,
} from '@craft-agent/core/rox2'

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
  return createProductionLocalTranscribeAdapter(prefs)
}

function voiceHttp() {
  return createProductionVoiceHttp()
}

function identityClient() {
  return new VoiceIdentityClient(memoryIdentityStore(), voiceHttp(), {
    baseUrl: voiceGatewayBaseUrl(),
  })
}

function cloudAdapter(caps: VoiceCapabilities): TranscribeAdapter {
  const adapter = new RoxTranscriptionAdapter({
    capabilities: caps,
    identity: identityClient(),
    http: voiceHttp(),
    baseUrl: voiceGatewayBaseUrl(),
  })
  return {
    engine: 'cloud-rox',
    async transcribe(input) {
      const result = await adapter.transcribe({
        audio: input.audio,
        mimeType: input.mimeType,
        language: input.language,
      })
      return {
        text: result.text,
        engine: 'cloud-rox',
        uploaded: true,
        noSpeech: result.noSpeech,
        requestId: result.requestId,
        requestedModelId: result.requestedModelId,
        resolvedModelId: result.resolvedModelId,
        routeVersion: result.routeVersion,
        detectedLanguage: result.detectedLanguage,
        durationMs: result.durationMs,
      }
    },
  }
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
          cloud: cloudAdapter(cachedCaps),
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

export function registerVoiceHandlers(server: RpcServer, _deps: HandlerDeps, options: {
  edgeSpeaker?: SpeakAdapter
  systemSpeaker?: SystemSpeaker
  loadPrefs?: () => VoicePrefs
} = {}): void {
  const edgeSpeaker = options.edgeSpeaker ?? createEdgeSpeakAdapter()
  const systemSpeaker = options.systemSpeaker ?? createSystemSpeaker()
  const readPrefs = options.loadPrefs ?? loadVoicePrefs
  let synthesis: AbortController | null = null
  server.handle(RPC_CHANNELS.voice.GET, async () => {
    const listed = rpcVoiceListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('voice prefs are not live')
    return loadVoicePrefs()
  })

  server.handle(RPC_CHANNELS.voice.SAVE, async (_ctx, patch: unknown) => {
    const act = rpcVoiceActResult({ source: 'native', action: 'write', nativeId: 'prefs' })
    if (!isClaimableLive(act)) throw new Error('voice save is not live')
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
        cloud: cloudAdapter(cachedCaps),
      })
    } catch (error) {
      if (error instanceof VoicePrivacyError) throw new Error(error.message)
      throw error
    }
  })

  server.handle(RPC_CHANNELS.voice.SPEAK, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (body.status === true) {
      return { engine: 'system', uploaded: false as const, playback: 'none' as const, speaking: systemSpeaker.isSpeaking() }
    }
    if (body.stop === true) {
      const pending = synthesis !== null
      synthesis?.abort()
      synthesis = null
      const stopped = systemSpeaker.stop() || pending
      return { engine: 'system', uploaded: false as const, playback: 'none' as const, stopped }
    }
    const text = assertEditableTranscript(typeof body.text === 'string' ? body.text : '')
    synthesis?.abort()
    systemSpeaker.stop()
    const controller = new AbortController()
    synthesis = controller
    const prefs = readPrefs()
    try {
      try {
        const policy = await speakWithPolicy(prefs, { text, language: prefs.recognitionLanguage, signal: controller.signal }, {
          edge: edgeSpeaker,

        })
        if (controller.signal.aborted) return { engine: prefs.ttsEngine, uploaded: false, playback: 'none' as const }
        if (policy.audioBase64) return { ...policy, playback: 'audio' as const }
      } catch {
        // An unavailable online service/CLI keeps the existing system fallback usable.
        if (controller.signal.aborted) return { engine: prefs.ttsEngine, uploaded: false, playback: 'none' as const }
      }
      const result = await systemSpeaker.speak(text)
      if (controller.signal.aborted) return { engine: 'system', uploaded: false, playback: 'none' as const }
      return result.played
        ? { engine: 'system', uploaded: false as const, playback: 'native' as const, voice: result.voice }
        : { engine: 'system', uploaded: false as const, playback: 'renderer' as const }
    } finally {
      if (synthesis === controller) synthesis = null
    }
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
    const read = rpcVoiceReadResult({ source: 'native', nativeId: id })
    if (!isClaimableLive(read.result)) {
      return { recording: null, revisions: [], runs: loadHistoryIndex(resolveConfigDir()).runs }
    }
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
    const id = String(body.id ?? '')
    if (!id) throw new Error('id is required')
    const act = rpcVoiceActResult({ source: 'native', action: 'destroy', granted: true, nativeId: id })
    if (!isClaimableLive(act)) throw new Error('voice history delete is not live')
    saveHistoryIndex(resolveConfigDir(), deleteRecording(loadHistoryIndex(resolveConfigDir()), id))
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
