import { readVoiceAudioChunk } from './voice-audio-read'
import { readBoundedRegularFile } from '@rox/shared/utils/bounded-file'
/**
 * Voice RPC — private actor preferences, client audio capture and Deepgram ASR.
 *
 * body.transcript is never allowed to override ASR. Cloud audio uploads only
 * after explicit actor cloudAsrConsent. Remote clients never invoke server OS playback.
 */

import { getServerServiceKey } from '@rox/shared/config/server-services'
import { arch } from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { resolveConfigDir } from '@rox/shared/config/paths'
import {
  LAST_KNOWN_GOOD_CAPABILITIES,
  LOCAL_MODEL_FAMILIES,
  ROCKS_T1_MODEL_ID,
  DeepgramTranscriptionAdapter,
  DEEPGRAM_TRANSCRIPTION_MODEL,
  DEEPGRAM_TRANSCRIPTION_NAME,
  VoiceHost,
  assertEditableTranscript,
  buildVoiceHealth,
  catalogTemplate,
  createProductionLocalTranscribeAdapter,
  createProductionVoiceHttp,
  createEdgeSpeakAdapter,
  EdgeTtsError,
  deleteRecording,
  exportRecording,
  getDefaultVoicePrefs,
  historyPage,
  loadHistoryIndex,
  loadVoicePrefs,
  resolveLocalAsrFamily,
  saveHistoryIndex,
  saveVoicePrefs,
  setFavorite,
  transcribeWithPolicy,
  speakWithPolicy,
  type SpeakAdapter,
  type TextTransmission,
  type TtsEngine,
  voiceGatewayBaseUrl,
  VOICE_PREFS_VERSION,
  type TranscribeAdapter,
  type TranscribeInput,
  type VoicePrefs,
  type NormalizedTranscript,
} from '@rox/shared/voice'
import type { HandlerFn, RequestContext, RpcServer, RpcHandlerOptions } from '@rox/server-core/transport'
import { nativeVoiceDirectory, secureNativeVoiceDirectory, voiceRequestFence } from './native-voice-scope'
import type { HistoryIndex, VoiceRecording } from '@rox/shared/voice/history'
import { pushTyped } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { createSystemSpeaker, type SystemSpeaker } from './system-tts'
import {
  isClaimableLive,
  rpcVoiceActResult,
  rpcVoiceListResult,
  rpcVoiceReadResult,
} from '@rox/core/rox2'

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
  RPC_CHANNELS.voice.HISTORY_EDIT,
  RPC_CHANNELS.voice.HISTORY_SELECT,
  RPC_CHANNELS.voice.HISTORY_AUDIO,
  RPC_CHANNELS.voice.RETRANSCRIBE,
  RPC_CHANNELS.voice.REPROCESS,
  RPC_CHANNELS.voice.PROCESS,
  RPC_CHANNELS.voice.MODELS_LIST,
] as const

function appleSilicon(): boolean {
  return process.platform === 'darwin' && (arch() === 'arm64' || process.arch === 'arm64')
}

const MAX_AUDIO_BYTES = 200 * 1024 * 1024
function decodeAudio(audioBase64: unknown, maxBytes = MAX_AUDIO_BYTES): Uint8Array {
  if (typeof audioBase64 !== 'string' || !audioBase64 || audioBase64.length > Math.ceil(maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)) {
    throw new Error('A bounded canonical audioBase64 payload is required')
  }
  const bytes = Buffer.from(audioBase64, 'base64')
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== audioBase64) throw new Error('Invalid audio payload')
  return bytes
}

function bodyOf(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

function audioMime(value: unknown): string {
  if (value === undefined) return 'audio/webm'
  if (typeof value !== 'string' || value.length > 128 || !/^(?:audio\/(?:webm|wav|x-wav|ogg|mpeg|mp3|mp4|flac|aac|opus)|video\/webm)(?:;\s*codecs=[A-Za-z0-9.,_-]+)?$/i.test(value)) {
    throw new Error('Unsupported audio MIME type')
  }
  return value
}

function normalizedResult(result: Awaited<ReturnType<TranscribeAdapter['transcribe']>>, prefs: VoicePrefs): NormalizedTranscript {
  return {
    ...result,
    segments: result.segments ?? [{ startMs: 0, endMs: result.durationMs ?? 0, text: result.text }],
    requestedModelId: result.requestedModelId ?? prefs.asrModelId ?? ROCKS_T1_MODEL_ID,
    resolvedModelId: result.resolvedModelId ?? result.requestedModelId,
    requestId: result.requestId ?? 'host', durationMs: result.durationMs ?? 0, noSpeech: result.noSpeech === true,
  }
}

function localAdapter(prefs: VoicePrefs): TranscribeAdapter {
  return createProductionLocalTranscribeAdapter(prefs)
}

function voiceHttp() {
  return createProductionVoiceHttp()
}

function cloudAdapter(): TranscribeAdapter {
  const adapter = new DeepgramTranscriptionAdapter({
    apiKey: getServerServiceKey('DEEPGRAM_API_KEY') ?? '', model: process.env.DEEPGRAM_MODEL,
  })
  return {
    engine: 'cloud-rox',
    async transcribe(input) {
      const result = await adapter.transcribe(input)
      return { ...result, engine: 'cloud-rox', uploaded: true }
    },
  }
}


interface VoiceClientState {
  context: RequestContext
  directory: string
  assertCurrent: () => void
  host: VoiceHost | null
  captureBytes: number
  captureOperationFence?: () => void
  speaker: SystemSpeaker
  synthesis: { controller: AbortController; engine: TtsEngine; textTransmission: TextTransmission } | null
  lastTextTransmission: TextTransmission
  transcriptions: Set<AbortController>
}

export function registerVoiceHandlers(server: RpcServer, deps: HandlerDeps, options: {
  edgeSpeaker?: SpeakAdapter
  systemSpeaker?: SystemSpeaker
  loadPrefs?: () => VoicePrefs
  cloudTranscriber?: TranscribeAdapter
  configDir?: string
} = {}): void {
  const handle = (channel: string, handler: HandlerFn, settings: RpcHandlerOptions) => server.handle(channel, (context, ...args: unknown[]) => {
    const payload = bodyOf(args[0])
    if (context.principal && Object.hasOwn(payload, 'workspaceId') && payload.workspaceId !== context.workspaceId) {
      throw new Error('Voice workspace does not match the authenticated client')
    }
    return handler(context, ...args)
  }, settings)
  const edgeSpeaker = options.edgeSpeaker ?? createEdgeSpeakAdapter()
  const configDir = options.configDir ?? resolveConfigDir()
  const authority = deps.nativeData?.authority
  const states = new Map<string, VoiceClientState>()
  const cloud = () => options.cloudTranscriber ?? cloudAdapter()
  const readOptions: RpcHandlerOptions = { access: 'nativeOrLocalElectron', nativeAction: 'read' }
  const writeOptions: RpcHandlerOptions = { access: 'nativeOrLocalElectron', nativeAction: 'write' }
  const transcriptionOptions: RpcHandlerOptions = { ...writeOptions, timeoutMs: 240_000 }
  const readPrefs = (context: RequestContext) => context.principal ? loadVoicePrefs(nativeVoiceDirectory(configDir, context))
    : options.loadPrefs?.() ?? loadVoicePrefs(configDir)
  const directory = (context: RequestContext, action: 'read' | 'write' | 'delete' = 'read') => {
    voiceRequestFence(server, authority, context, action)()
    return nativeVoiceDirectory(configDir, context)
  }
  const cancel = (state: VoiceClientState) => {
    state.synthesis?.controller.abort()
    state.synthesis = null
    state.speaker.stop()
    for (const controller of state.transcriptions) controller.abort()
    state.transcriptions.clear()
    state.host?.cancel()
    state.host = null
    state.captureBytes = 0
  }
  const disposeClient = (clientId: string) => {
    const state = states.get(clientId)
    if (state) cancel(state)
    states.delete(clientId)
    deps.voiceOverlay?.retire(clientId)
  }
  const disposeInvalidation = authority?.onInvalidation(event => {
    for (const [clientId, state] of states) {
      const principal = state.context.principal
      if (principal?.subject !== event.subject || (event.credentialId && principal.credentialId !== event.credentialId)
        || (event.workspaceId && state.context.workspaceId !== event.workspaceId)) continue
      disposeClient(clientId)
    }
  })
  const disposeDisconnect = server.onClientDisconnect?.(disposeClient)
  server.onShutdown?.(() => {
    disposeInvalidation?.(); disposeDisconnect?.()
    for (const clientId of [...states.keys()]) disposeClient(clientId)
  })
  const getState = (context: RequestContext): VoiceClientState => {
    const clientId = context.clientId ?? 'legacy-direct-test'
    let current = states.get(clientId)
    if (current) {
      try { current.assertCurrent() } catch { disposeClient(clientId); current = undefined }
      if (current && (current.context.workspaceId !== context.workspaceId || current.context.webContentsId !== context.webContentsId
        || current.context.principal?.subject !== context.principal?.subject
        || current.context.principal?.credentialId !== context.principal?.credentialId)) {
        disposeClient(clientId); current = undefined
      }
    }
    if (current) return current
    const assertCurrent = voiceRequestFence(server, authority, context, 'write')
    const state: VoiceClientState = {
      context, directory: directory(context, 'write'), assertCurrent, host: null, captureBytes: 0,
      speaker: options.systemSpeaker ?? createSystemSpeaker(), synthesis: null, lastTextTransmission: 'not-sent', transcriptions: new Set(),
    }
    states.set(clientId, state)
    return state
  }
  const getHost = (context: RequestContext): VoiceHost => {
    const state = getState(context)
    if (state.host) return state.host
    const host = new VoiceHost(state.directory, {
      async transcribe(audio, mimeType, language, signal) {
        const assertOperation = state.captureOperationFence ?? state.assertCurrent
        assertOperation()
        state.assertCurrent()
        const prefs = readPrefs(context)
        const result = await transcribeWithPolicy(prefs, { audio, mimeType, language, signal }, {
          local: localAdapter(prefs), cloud: cloud(),
        })
        try { signal?.throwIfAborted(); assertOperation(); state.assertCurrent() } catch (error) {
          // A timed-out operation must be cancelled before VoiceHost can
          // persist a late revision or enter its ordinary failure path.
          host.cancel()
          throw error
        }
        return normalizedResult(result, prefs)
      },
    })
    host.on(event => {
      try { state.assertCurrent() } catch { return }
      const target = { to: 'client' as const, clientId: state.context.clientId }
      pushTyped(server, RPC_CHANNELS.voice.JOB, target, event.job)
      pushTyped(server, RPC_CHANNELS.voice.OVERLAY, target, event.overlay)
      try {
        deps.voiceOverlay?.publish({ context: state.context, state: event.overlay, position: readPrefs(state.context).overlayPosition, assertCurrent: state.assertCurrent })
      } catch { deps.voiceOverlay?.retire(state.context.clientId) }
    })
    state.host = host
    return host
  }
  const transcribe = async (context: RequestContext, audio: Uint8Array, mimeType: string, language?: string) => {
    const state = getState(context)
    const controller = new AbortController()
    const assertOperation = voiceRequestFence(server, authority, context, 'write')
    const timeout = setTimeout(() => controller.abort(new Error('Voice transcription timed out')), 240_000)
    state.transcriptions.add(controller)
    const prefs = readPrefs(context)
    try {
      const result = await transcribeWithPolicy(prefs, { audio, mimeType, language: language ??
        (prefs.recognitionLanguage === 'auto' ? undefined : prefs.recognitionLanguage), signal: controller.signal }, {
        local: localAdapter(prefs), cloud: cloud(),
      })
      controller.signal.throwIfAborted()
      assertOperation()
      state.assertCurrent()
      return result
    } finally { clearTimeout(timeout); state.transcriptions.delete(controller) }
  }
  const index = (context: RequestContext) => loadHistoryIndex(directory(context))
  const publicRecording = (context: RequestContext, recording: VoiceRecording) => ({ ...recording, audioPath: '' })
  const record = (context: RequestContext, id: unknown) => {
    const history = index(context)
    const found = typeof id === 'string' ? history.recordings.find(item => item.id === id) : undefined
    if (!found) throw new Error('Recording not found')
    return { history, recording: found }
  }
  const writeIndex = (context: RequestContext, history: HistoryIndex) => {
    const root = directory(context, 'write')
    saveHistoryIndex(root, history)
    secureNativeVoiceDirectory(root, context)
  }
  const transmissionEvidence = (textTransmission: TextTransmission) => ({ textTransmission,
    ...(textTransmission === 'possible' ? {} : { textSent: textTransmission === 'sent' }) })

  handle(RPC_CHANNELS.voice.GET, async context => {
    voiceRequestFence(server, authority, context, 'read')()
    const listed = rpcVoiceListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('voice prefs are not live')
    return readPrefs(context)
  }, readOptions)
  handle(RPC_CHANNELS.voice.SAVE, async (context, patch: unknown) => {
    const root = directory(context, 'write')
    const act = rpcVoiceActResult({ source: 'native', action: 'write', nativeId: 'prefs' })
    if (!isClaimableLive(act)) throw new Error('voice save is not live')
    const next = saveVoicePrefs({ ...readPrefs(context), ...bodyOf(patch), version: VOICE_PREFS_VERSION }, root)
    secureNativeVoiceDirectory(root, context)
    if (!next.cloudAsrConsent) {
      for (const state of states.values()) if (state.directory === root) cancel(state)
    }
    // Consent and device preferences are private even when several users share a workspace.
    pushTyped(server, RPC_CHANNELS.voice.CHANGED, { to: 'client', clientId: context.clientId }, next)
    return next
  }, writeOptions)
  handle(RPC_CHANNELS.voice.HEALTH, async context => {
    directory(context)
    const health = buildVoiceHealth(readPrefs(context), { appleSilicon: appleSilicon(), offline: false }, {
      CI: process.env.CI, CRAFT_VOICE_GATEWAY_FIXTURE: process.env.CRAFT_VOICE_GATEWAY_FIXTURE,
      CRAFT_VOICE_LOCAL_FIXTURE: process.env.CRAFT_VOICE_LOCAL_FIXTURE,
    })
    return getServerServiceKey('DEEPGRAM_API_KEY') || options.cloudTranscriber ? {
      ...health, asrModelId: process.env.DEEPGRAM_MODEL || DEEPGRAM_TRANSCRIPTION_MODEL, asrBrand: DEEPGRAM_TRANSCRIPTION_NAME,
    } : health
  }, readOptions)
  handle(RPC_CHANNELS.voice.BOOTSTRAP, async context => {
    directory(context)
    if (!getServerServiceKey('DEEPGRAM_API_KEY') && !options.cloudTranscriber) throw new Error('Deepgram is not configured on this server')
    return { installationId: 'server-deepgram', expiresAt: Date.now() + 15 * 60 * 1000,
      scopes: ['voice:transcribe', 'voice:capabilities'] }
  }, readOptions)
  handle(RPC_CHANNELS.voice.CAPABILITIES, async context => {
    directory(context)
    return { ...LAST_KNOWN_GOOD_CAPABILITIES, modelId: process.env.DEEPGRAM_MODEL || DEEPGRAM_TRANSCRIPTION_MODEL,
      displayName: DEEPGRAM_TRANSCRIPTION_NAME, availability: getServerServiceKey('DEEPGRAM_API_KEY') || options.cloudTranscriber ? 'ok' : 'unavailable',
      languages: [], languageCount: 0, show74Badge: false, timestampGranularities: ['segment', 'word'], maxBytes: MAX_AUDIO_BYTES }
  }, readOptions)
  handle(RPC_CHANNELS.voice.TRANSCRIBE, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    return transcribe(context, decodeAudio(body.audioBase64), audioMime(body.mimeType), typeof body.language === 'string' ? body.language : undefined)
  }, transcriptionOptions)

  handle(RPC_CHANNELS.voice.SPEAK, async (context, payload: unknown) => {
    const state = getState(context)
    const assertOperation = voiceRequestFence(server, authority, context, 'write')
    const body = bodyOf(payload)
    if (body.status === true) return { engine: state.synthesis?.engine ?? 'system', uploaded: false as const,
      playback: 'none' as const, speaking: state.synthesis !== null || state.speaker.isSpeaking(),
      ...transmissionEvidence(state.synthesis?.textTransmission ?? state.lastTextTransmission) }
    if (body.stop === true) {
      const pending = state.synthesis !== null
      const evidence = transmissionEvidence(state.synthesis?.textTransmission ?? state.lastTextTransmission)
      state.synthesis?.controller.abort(); state.synthesis = null
      const stopped = state.speaker.stop() || pending
      return { engine: 'system', uploaded: false as const, playback: 'none' as const, stopped, ...evidence }
    }
    const text = assertEditableTranscript(typeof body.text === 'string' ? body.text : '')
    if (text.length > 100_000) throw new Error('Speech text is too large')
    state.synthesis?.controller.abort(); state.speaker.stop()
    const controller = new AbortController()
    const prefs = readPrefs(context)
    const request = { controller, engine: prefs.ttsEngine, textTransmission: 'not-sent' as TextTransmission }
    state.synthesis = request; state.lastTextTransmission = 'not-sent'
    const updateTransmission = (transmission: TextTransmission) => {
      request.textTransmission = transmission
      if (state.synthesis === request) state.lastTextTransmission = transmission
    }
    const cancelled = () => ({ engine: prefs.ttsEngine, uploaded: false as const, playback: 'none' as const,
      ...transmissionEvidence(request.textTransmission) })
    try {
      if (prefs.ttsEngine === 'edge' && prefs.version === VOICE_PREFS_VERSION) {
        try {
          updateTransmission('possible')
          const policy = await speakWithPolicy(prefs, { text, language: prefs.recognitionLanguage,
            signal: controller.signal, onTextTransmission: updateTransmission }, { edge: edgeSpeaker })
          updateTransmission(policy.textTransmission ?? (policy.textSent === true ? 'sent' : policy.textSent === false ? 'not-sent' : request.textTransmission))
          if (controller.signal.aborted) return cancelled()
          assertOperation()
          state.assertCurrent()
          if (policy.audioBase64) return { ...policy, ...transmissionEvidence(request.textTransmission), playback: 'audio' as const }
        } catch (error) {
          if (error instanceof EdgeTtsError) updateTransmission(error.textTransmission)
          if (controller.signal.aborted) return cancelled()
          assertOperation()
          state.assertCurrent()
        }
      }
      if (controller.signal.aborted) return cancelled()
      assertOperation()
      state.assertCurrent()
      // System TTS belongs to a genuinely bound local device. A remote actor's
      // message must never be played on the shared server's speakers.
      if (context.principal || (context.clientId && context.webContentsId === null)) {
        return { engine: 'system', uploaded: false as const, playback: 'renderer' as const, ...transmissionEvidence(request.textTransmission) }
      }
      const result = await state.speaker.speak(text)
      if (controller.signal.aborted) return cancelled()
      assertOperation()
      state.assertCurrent()
      return result.played ? { engine: 'system', uploaded: false as const, playback: 'native' as const,
        voice: result.voice, ...transmissionEvidence(request.textTransmission) }
        : { engine: 'system', uploaded: false as const, playback: 'none' as const,
          reason: 'russian-system-voice-unavailable' as const, ...transmissionEvidence(request.textTransmission) }
    } finally { if (state.synthesis === request) state.synthesis = null }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.START, async (context, payload?: unknown) => {
    const body = bodyOf(payload)
    const state = getState(context)
    const job = getHost(context).start(readPrefs(context), { mimeType: audioMime(body.mimeType) })
    state.captureBytes = 0
    secureNativeVoiceDirectory(state.directory, context)
    return job
  }, writeOptions)
  handle(RPC_CHANNELS.voice.GRANT, async context => getHost(context).grantPermission(), writeOptions)
  handle(RPC_CHANNELS.voice.CHUNK, async (context, payload: unknown) => {
    const state = getState(context)
    const bytes = decodeAudio(bodyOf(payload).audioBase64, 4 * 1024 * 1024)
    if (state.captureBytes + bytes.byteLength > MAX_AUDIO_BYTES) { cancel(state); throw new Error('Recording exceeds the audio limit') }
    getHost(context).chunk(bytes); state.captureBytes += bytes.byteLength
    secureNativeVoiceDirectory(state.directory, context)
    return { ok: true }
  }, writeOptions)
  handle(RPC_CHANNELS.voice.STOP, async context => {
    const state = getState(context)
    const prefs = readPrefs(context)
    const assertOperation = voiceRequestFence(server, authority, context, 'write')
    state.captureOperationFence = assertOperation
    const host = getHost(context)
    const jobId = host.current()?.jobId
    const timeout = setTimeout(() => { if (host.current()?.jobId === jobId) host.cancel() }, 240_000)
    try {
      const result = await host.stop(prefs, prefs.recognitionLanguage === 'auto' ? undefined : prefs.recognitionLanguage)
      assertOperation()
      state.assertCurrent()
      secureNativeVoiceDirectory(state.directory, context)
      return result
    } finally {
      clearTimeout(timeout)
      if (state.captureOperationFence === assertOperation) state.captureOperationFence = undefined
    }
  }, transcriptionOptions)
  handle(RPC_CHANNELS.voice.CANCEL, async context => {
    const state = getState(context)
    const result = state.host?.cancel() ?? null
    for (const controller of state.transcriptions) controller.abort()
    state.transcriptions.clear(); state.captureBytes = 0
    return result
  }, writeOptions)
  handle(RPC_CHANNELS.voice.HISTORY_LIST, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const page = historyPage(index(context), { cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
      limit: typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : 20,
      search: typeof body.search === 'string' ? body.search : undefined, favorite: body.favorite === true })
    return { ...page, page: page.page.map(item => publicRecording(context, item)) }
  }, readOptions)
  handle(RPC_CHANNELS.voice.HISTORY_GET, async (context, payload: unknown) => {
    const id = bodyOf(payload).id
    const history = index(context)
    const found = typeof id === 'string' ? history.recordings.find(item => item.id === id) : undefined
    const read = rpcVoiceReadResult({ source: 'native', nativeId: typeof id === 'string' ? id : '' })
    if (!found || !isClaimableLive(read.result)) return { recording: null, revisions: [], runs: [] }
    const revisions = history.revisions.filter(item => item.recordingId === id)
    const revisionIds = new Set(revisions.map(item => item.id))
    return { recording: publicRecording(context, found), revisions, runs: history.runs.filter(item => revisionIds.has(item.transcriptRevisionId)) }
  }, readOptions)
  handle(RPC_CHANNELS.voice.HISTORY_FAVORITE, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const { history, recording } = record(context, body.id)
    writeIndex(context, setFavorite(history, recording.id, body.favorite === true))
    return { ok: true }
  }, writeOptions)
  handle(RPC_CHANNELS.voice.HISTORY_DELETE, async (context, payload: unknown) => {
    const root = directory(context, 'delete')
    const { history, recording } = record(context, bodyOf(payload).id)
    if (!/^[a-f0-9-]{36}$/.test(recording.id)) throw new Error('Invalid recording identifier')
    saveHistoryIndex(root, deleteRecording(history, recording.id))
    rmSync(join(root, 'voice', 'recordings', recording.id), { recursive: true, force: true })
    secureNativeVoiceDirectory(root, context)
    return { ok: true }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'delete' })
  handle(RPC_CHANNELS.voice.HISTORY_EXPORT, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const { history, recording } = record(context, body.id)
    const publicHistory = { ...history, recordings: history.recordings.map(item => publicRecording(context, item)) }
    return { text: exportRecording(publicHistory, recording.id, body.format === 'srt' || body.format === 'json' ? body.format : 'txt') }
  }, readOptions)
  handle(RPC_CHANNELS.voice.HISTORY_EDIT, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const { history, recording } = record(context, body.id)
    directory(context, 'write')
    if (typeof body.text !== 'string' || !body.text.trim() || Buffer.byteLength(body.text, 'utf8') > 1_000_000) throw new Error('A bounded transcript is required')
    const selected = history.revisions.find(item => item.id === recording.selectedRevisionId && item.recordingId === recording.id)
    if (!selected || body.expectedRevisionId !== selected.id) throw new Error('Transcript changed; reload before editing')
    const revision = { id: randomUUID(), recordingId: recording.id, parentId: selected.id, kind: 'manual' as const,
      modelId: 'manual', text: body.text, segments: [], createdAt: Date.now() }
    history.revisions.push(revision)
    recording.selectedRevisionId = revision.id
    recording.selectedRunId = undefined
    writeIndex(context, history)
    return { ok: true, revisionId: revision.id }
  }, writeOptions)
  handle(RPC_CHANNELS.voice.HISTORY_SELECT, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const { history, recording } = record(context, body.id)
    directory(context, 'write')
    if (body.expectedRevisionId !== recording.selectedRevisionId) throw new Error('Transcript changed; reload before selecting')
    const revision = history.revisions.find(item => item.id === body.revisionId && item.recordingId === recording.id)
    if (!revision) throw new Error('Transcript revision not found')
    recording.selectedRevisionId = revision.id
    recording.selectedRunId = undefined
    writeIndex(context, history)
    return { ok: true, revisionId: revision.id }
  }, writeOptions)
  handle(RPC_CHANNELS.voice.HISTORY_AUDIO, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const { recording } = record(context, body.id)
    const fence = voiceRequestFence(server, authority, context, 'read')
    const root = directory(context)
    secureNativeVoiceDirectory(root, context)
    const chunk = readVoiceAudioChunk(root, recording, body)
    fence()
    return chunk
  }, readOptions)
  handle(RPC_CHANNELS.voice.RETRANSCRIBE, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const { recording } = record(context, body.id)
    if (!/^[a-f0-9-]{36}$/.test(recording.id)) throw new Error('Invalid recording identifier')
    const root = directory(context, 'write')
    const path = join(root, 'voice', 'recordings', recording.id, 'original.bin')
    const original = readBoundedRegularFile(path, { maxBytes: MAX_AUDIO_BYTES })
    const result = await transcribe(context, original, audioMime(recording.format))
    const prefs = readPrefs(context)
    const transcript = normalizedResult(result, prefs)
    const history = index(context)
    const current = history.recordings.find(item => item.id === recording.id)
    if (!current) throw new Error('Recording was removed during transcription')
    const id = randomUUID()
    history.revisions.push({ id, recordingId: recording.id, kind: 'asr', modelId: transcript.requestedModelId,
      modelRevision: transcript.modelRevision ?? transcript.resolvedModelId, routeVersion: transcript.routeVersion,
      detectedLanguage: transcript.detectedLanguage, text: transcript.text, segments: transcript.segments, words: transcript.words,
      createdAt: Date.now() })
    current.selectedRevisionId = id; current.state = transcript.noSpeech ? 'failed' : 'finalized'
    writeIndex(context, history)
    return { ok: true, recordingId: recording.id, transcript }
  }, transcriptionOptions)
  handle(RPC_CHANNELS.voice.REPROCESS, async (context, payload: unknown) => {
    record(context, bodyOf(payload).id)
    throw new Error('Stored voice reprocessing is not configured')
  }, writeOptions)
  handle(RPC_CHANNELS.voice.PROCESS, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const state = getState(context)
    const assertOperation = voiceRequestFence(server, authority, context, 'write')
    const prefs = readPrefs(context)
    if (!prefs.cloudEnhancementConsent) return { skipped: true, reason: 'enhancement-off', text: typeof body.text === 'string' ? body.text : '' }
    // The legacy Rox enhancement gateway has no per-native-actor adapter.
    if (context.principal) throw new Error('Cloud voice enhancement is not configured for this account')
    const controller = new AbortController(); state.transcriptions.add(controller)
    try {
      const response = await voiceHttp().fetch(`${voiceGatewayBaseUrl()}/voice/process`, {
        method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: body.text, tools: prefs.webEnrichmentConsent ? ['web_search'] : [] }),
      })
      const result: unknown = await response.json()
      controller.signal.throwIfAborted(); assertOperation(); state.assertCurrent()
      return result
    } finally { state.transcriptions.delete(controller) }
  }, writeOptions)
  handle(RPC_CHANNELS.voice.MODELS_LIST, async context => {
    directory(context)
    const prefs = readPrefs(context)
    const platform = process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux' ? process.platform : 'linux'
    const archName = appleSilicon() || process.arch === 'arm64' ? 'arm64' : 'x64'
    return { families: LOCAL_MODEL_FAMILIES, selected: resolveLocalAsrFamily(prefs.asrModelId),
      catalog: LOCAL_MODEL_FAMILIES.map(family => catalogTemplate(family, platform, archName)) }
  }, readOptions)
}

export function getDefaultVoiceDto(): VoicePrefs {
  return getDefaultVoicePrefs()
}
