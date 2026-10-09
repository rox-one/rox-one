/**
 * Realtime voice RPC — talk sessions, TTS streaming, the STT relay and the wake list.
 *
 * Provider credentials stay on this workspace server: the renderer only ever
 * receives normalized talk/STT events, TTS audio chunks and a short-lived
 * browser client secret. An unconfigured provider is a typed failure, never a
 * fabricated bridge. All provider work is fenced by `voiceRequestFence`.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { BroadcastEventMap } from '@rox/shared/protocol'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { getServerServiceKey, type ServerServiceKey } from '@rox/shared/config/server-services'
import { atomicWriteFileSync, readJsonFileSync } from '@rox/shared/utils/files'
import {
  createEdgeSpeechProvider,
  createOpenAiRealtimeTranscriptionSession,
  createOpenAiRealtimeVoiceProvider,
  createOpenAiSpeechProvider,
  createTtsStream,
  defaultVoiceWakeList,
  listRealtimeVoiceProviders,
  listSpeechProviders,
  loadVoicePrefs,
  normalizeWakeList,
  normalizeWakeTrigger,
  resolveConfiguredRealtimeVoiceProvider,
  resolveConfiguredSpeechProvider,
  saveVoicePrefs,
  synthesizeSpeech,
  TalkEventSequencer,
  VoiceProviderError,
  type RealtimeTranscriptionSession,
  type RealtimeVoiceBridge,
  type SpeechProvider,
  type TalkEvent,
  type TalkEventDraft,
  type TalkEventScope,
  type TalkMode,
  type TtsStream,
  type VoiceProviderSource,
  type VoicePrefs,
  type VoiceWakeList,
} from '@rox/shared/voice'
import type { HandlerFn, RequestContext, RpcHandlerOptions, RpcServer } from '@rox/server-core/transport'
import { pushTyped } from '@rox/server-core/transport'
import { nativeVoiceDirectory, secureNativeVoiceDirectory, voiceRequestFence } from './native-voice-scope'
import type { HandlerDeps } from '../handler-deps'

export const VOICE_REALTIME_HANDLED_CHANNELS = [
  RPC_CHANNELS.voice.TALK_START,
  RPC_CHANNELS.voice.TALK_STOP,
  RPC_CHANNELS.voice.TALK_AUDIO,
  RPC_CHANNELS.voice.TALK_CLIENT_SECRET,
  RPC_CHANNELS.voice.TTS_STREAM_START,
  RPC_CHANNELS.voice.TTS_STREAM_STOP,
  RPC_CHANNELS.voice.STT_START,
  RPC_CHANNELS.voice.STT_AUDIO,
  RPC_CHANNELS.voice.STT_STOP,
  RPC_CHANNELS.voice.PROVIDERS,
  RPC_CHANNELS.voice.WAKE_GET,
  RPC_CHANNELS.voice.WAKE_SET,
  RPC_CHANNELS.voice.TRIGGER,
] as const

const WAKE_FILE = 'voice-wake.json'
const MAX_REALTIME_AUDIO_BYTES = 1024 * 1024

function bodyOf(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

function decodeAudio(audioBase64: unknown, maxBytes = MAX_REALTIME_AUDIO_BYTES): Uint8Array {
  if (typeof audioBase64 !== 'string' || !audioBase64 || audioBase64.length > Math.ceil(maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)) {
    throw new Error('A bounded canonical audioBase64 payload is required')
  }
  const bytes = Buffer.from(audioBase64, 'base64')
  if (!bytes.length || bytes.byteLength > maxBytes || bytes.toString('base64') !== audioBase64) throw new Error('Invalid audio payload')
  return bytes
}

function asTalkMode(value: unknown): TalkMode {
  return value === 'transcription' || value === 'dictation' ? value : 'realtime'
}

interface TalkRuntime {
  sessionId: string
  providerId: string
  bridge: RealtimeVoiceBridge
  sequencer: TalkEventSequencer
}

interface SttRuntime {
  session: RealtimeTranscriptionSession
}

interface ClientRuntime {
  context: RequestContext
  assertCurrent: () => void
  talk: TalkRuntime | null
  stt: Map<string, SttRuntime>
  tts: Map<string, TtsStream>
}

export interface VoiceRealtimeHandlerOptions {
  configDir?: string
  providers?: VoiceProviderSource
  getServiceKey?: (key: ServerServiceKey) => string | undefined
  loadPrefs?: (context: RequestContext) => VoicePrefs
}

export function registerVoiceRealtimeHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  options: VoiceRealtimeHandlerOptions = {},
): void {
  const configDir = options.configDir ?? resolveConfigDir()
  const getServiceKey = options.getServiceKey ?? getServerServiceKey
  const speechProviders: readonly SpeechProvider[] = [
    createEdgeSpeechProvider(),
    createOpenAiSpeechProvider({ getApiKey: () => getServiceKey('OPENAI_API_KEY') }),
  ]
  const source: VoiceProviderSource = options.providers ?? {
    realtime: [createOpenAiRealtimeVoiceProvider({ getApiKey: () => getServiceKey('OPENAI_API_KEY') })],
    speech: speechProviders,
  }
  const authority = deps.nativeData?.authority
  const states = new Map<string, ClientRuntime>()
  const readOptions: RpcHandlerOptions = { access: 'nativeOrLocalElectron', nativeAction: 'read' }
  const writeOptions: RpcHandlerOptions = { access: 'nativeOrLocalElectron', nativeAction: 'write' }

  const readPrefs = (context: RequestContext): VoicePrefs => context.principal
    ? loadVoicePrefs(nativeVoiceDirectory(configDir, context))
    : options.loadPrefs?.(context) ?? loadVoicePrefs(configDir)

  const wakePath = (context: RequestContext): string => join(nativeVoiceDirectory(configDir, context), WAKE_FILE)

  const loadWakeList = (context: RequestContext): VoiceWakeList => {
    try {
      const raw = readJsonFileSync<{ triggers?: unknown; routing?: unknown }>(wakePath(context))
      return normalizeWakeList(raw).list
    } catch {
      return defaultVoiceWakeList()
    }
  }

  const saveWakeList = (context: RequestContext, list: VoiceWakeList): void => {
    atomicWriteFileSync(wakePath(context), `${JSON.stringify(list, null, 2)}\n`)
    secureNativeVoiceDirectory(nativeVoiceDirectory(configDir, context), context)
  }

  const handle = (channel: string, handler: HandlerFn, settings: RpcHandlerOptions) => server.handle(channel, (context, ...args: unknown[]) => {
    const payload = bodyOf(args[0])
    if (context.principal && Object.hasOwn(payload, 'workspaceId') && payload.workspaceId !== context.workspaceId) {
      throw new Error('Voice workspace does not match the authenticated client')
    }
    return handler(context, ...args)
  }, settings)

  const dispose = (state: ClientRuntime) => {
    state.talk?.bridge.close()
    for (const stt of state.stt.values()) stt.session.close('client-disposed')
    for (const tts of state.tts.values()) tts.cancel('client-disposed')
  }
  const disposeClient = (clientId: string) => {
    const state = states.get(clientId)
    if (state) dispose(state)
    states.delete(clientId)
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

  const getState = (context: RequestContext): ClientRuntime => {
    const clientId = context.clientId ?? 'legacy-direct-test'
    const current = states.get(clientId)
    if (current) {
      try { current.assertCurrent() } catch { disposeClient(clientId) }
      const live = states.get(clientId)
      if (live && (live.context.workspaceId !== context.workspaceId || live.context.webContentsId !== context.webContentsId
        || live.context.principal?.subject !== context.principal?.subject
        || live.context.principal?.credentialId !== context.principal?.credentialId)) {
        disposeClient(clientId)
      }
    }
    const existing = states.get(clientId)
    if (existing) return existing
    const state: ClientRuntime = {
      context, assertCurrent: voiceRequestFence(server, authority, context, 'write'), talk: null, stt: new Map(), tts: new Map(),
    }
    states.set(clientId, state)
    return state
  }

  const push = <K extends keyof BroadcastEventMap & string>(state: ClientRuntime, channel: K, ...args: BroadcastEventMap[K]) => {
    state.assertCurrent()
    pushTyped(server, channel, { to: 'client', clientId: state.context.clientId }, ...args)
  }

  handle(RPC_CHANNELS.voice.PROVIDERS, async context => {
    voiceRequestFence(server, authority, context, 'read')()
    return { realtime: listRealtimeVoiceProviders(source), speech: listSpeechProviders(source) }
  }, readOptions)

  handle(RPC_CHANNELS.voice.WAKE_GET, async context => {
    const list = loadWakeList(context)
    return { enabled: readPrefs(context).wakeWordEnabled, names: [...list.triggers] }
  }, readOptions)

  handle(RPC_CHANNELS.voice.WAKE_SET, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const directory = nativeVoiceDirectory(configDir, context)
    voiceRequestFence(server, authority, context, 'write')()
    const previous = loadWakeList(context)
    const { list } = normalizeWakeList({ triggers: body.names, routing: body.routing }, previous)
    saveWakeList(context, list)
    const prefs = readPrefs(context)
    const next = typeof body.enabled === 'boolean'
      ? saveVoicePrefs({ ...prefs, wakeWordEnabled: body.enabled }, directory)
      : prefs
    if (context.principal) secureNativeVoiceDirectory(directory, context)
    const changed = { enabled: next.wakeWordEnabled, names: [...list.triggers] }
    push(getState(context), RPC_CHANNELS.voice.WAKE_CHANGED, changed)
    return changed
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TRIGGER, async (context, payload: unknown) => {
    const name = normalizeWakeTrigger(bodyOf(payload).name)
    const list = loadWakeList(context)
    const matched = name ? list.triggers.find((trigger) => trigger.toLowerCase() === name.toLowerCase()) : undefined
    if (!matched) throw new Error('Unknown wake trigger')
    if (list.routing === 'none') return
    push(getState(context), RPC_CHANNELS.voice.TRIGGER, { trigger: matched, routing: list.routing, at: Date.now() })
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TALK_START, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const provider = resolveConfiguredRealtimeVoiceProvider(source, typeof body.provider === 'string' ? body.provider : undefined)
    const state = getState(context)
    state.talk?.bridge.close()
    const sessionId = randomUUID()
    const scope: TalkEventScope = {
      sessionId,
      workspaceId: context.workspaceId ?? 'local',
      mode: asTalkMode(body.mode),
      transport: 'provider-websocket',
      brain: 'direct',
      provider: provider.id,
    }
    const sequencer = new TalkEventSequencer(scope)
    let turnId: string | undefined
    let captureId: string | undefined
    let turns = 0
    const emit = (draft: TalkEventDraft): TalkEvent => {
      const event = sequencer.next(draft)
      try { push(state, RPC_CHANNELS.voice.TALK_EVENT, event) } catch { /* access revoked mid-stream */ }
      return event
    }
    const ensureTurn = () => {
      if (!turnId) {
        turns += 1
        turnId = `turn-${turns}`
        emit({ type: 'turn.started', turnId })
      }
      return turnId
    }
    emit({ type: 'session.started' })
    const voice = typeof body.voice === 'string' ? body.voice : undefined
    const bridge = await provider.createBridge({
      onAudio: (chunk) => {
        ensureTurn()
        emit({ type: 'output.audio.delta', turnId, payload: { audioBase64: Buffer.from(chunk).toString('base64'), mimeType: 'audio/pcm16' } })
      },
      onClearAudio: () => {
        if (turnId) emit({ type: 'output.audio.done', turnId, payload: { bargeIn: true }, final: true })
        turnId = undefined
      },
      onTranscript: (role, text, isFinal) => {
        if (role === 'user') {
          captureId ??= 'capture-1'
          emit({ type: isFinal ? 'transcript.final' : 'transcript.partial', captureId, payload: { text }, final: isFinal })
        } else {
          ensureTurn()
          emit({ type: 'output.text.delta', turnId, payload: { text }, final: isFinal })
        }
      },
      onResponseDone: () => {
        if (turnId) emit({ type: 'output.audio.done', turnId, final: true })
        if (captureId) { emit({ type: 'capture.ended', captureId, final: true }); captureId = undefined }
        turnId = undefined
      },
      onToolCall: (call) => {
        ensureTurn()
        emit({ type: 'tool.call', turnId, callId: call.callId, payload: { name: call.name, args: call.args } })
      },
      onError: (error) => emit({ type: 'health.changed', payload: { error: error.message } }),
    }, { sessionId, voice, workspaceId: context.workspaceId ?? undefined })
    state.talk = { sessionId, providerId: provider.id, bridge, sequencer }
    return { sessionId }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TALK_AUDIO, async (context, payload: unknown) => {
    const state = getState(context)
    if (!state.talk) throw new Error('No active talk session')
    state.assertCurrent()
    state.talk.bridge.sendAudio(decodeAudio(bodyOf(payload).audioBase64))
    return { ok: true as const }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TALK_STOP, async context => {
    const state = getState(context)
    const talk = state.talk
    if (!talk) return
    state.talk = null
    try { push(state, RPC_CHANNELS.voice.TALK_EVENT, talk.sequencer.next({ type: 'session.ended', final: true })) } catch { /* access revoked */ }
    talk.bridge.close()
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TALK_CLIENT_SECRET, async (context, payload: unknown) => {
    const provider = resolveConfiguredRealtimeVoiceProvider(source, typeof bodyOf(payload).provider === 'string' ? bodyOf(payload).provider as string : undefined)
    if (!provider.createBrowserSession) {
      throw new VoiceProviderError('unsupported', `Provider ${provider.id} does not issue browser client secrets`)
    }
    voiceRequestFence(server, authority, context, 'write')()
    const session = await provider.createBrowserSession({ workspaceId: context.workspaceId ?? undefined })
    return { clientSecret: session.clientSecret, expiresAt: session.expiresAt }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.STT_START, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const key = getServiceKey('OPENAI_API_KEY')
    if (!key) throw new VoiceProviderError('unconfigured', 'No realtime transcription provider is configured on this server')
    const state = getState(context)
    const streamId = randomUUID()
    const session = createOpenAiRealtimeTranscriptionSession({ getApiKey: () => key, model: typeof body.model === 'string' ? body.model : undefined })
    session.onEvent(event => {
      try { push(state, RPC_CHANNELS.voice.STT_EVENT, event) } catch { /* access revoked mid-stream */ }
    })
    await session.connect()
    state.stt.set(streamId, { session })
    return { streamId }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.STT_AUDIO, async (context, payload: unknown) => {
    const state = getState(context)
    const streamId = bodyOf(payload).streamId
    const stt = typeof streamId === 'string' ? state.stt.get(streamId) : undefined
    if (!stt) throw new Error('No active STT relay session')
    state.assertCurrent()
    stt.session.sendAudio(decodeAudio(bodyOf(payload).audioBase64))
    return { ok: true as const }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.STT_STOP, async (context, payload: unknown) => {
    const state = getState(context)
    const streamId = bodyOf(payload).streamId
    if (typeof streamId === 'string') {
      state.stt.get(streamId)?.session.close('client-stop')
      state.stt.delete(streamId)
    }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TTS_STREAM_START, async (context, payload: unknown) => {
    const body = bodyOf(payload)
    const provider = resolveConfiguredSpeechProvider(source, typeof body.provider === 'string' ? body.provider : undefined)
    voiceRequestFence(server, authority, context, 'write')()
    const state = getState(context)
    const synthesis = await synthesizeSpeech(provider, {
      text: typeof body.text === 'string' ? body.text : '',
      ...(typeof body.voice === 'string' ? { voice: body.voice } : {}),
      ...(typeof body.language === 'string' ? { language: body.language } : {}),
    })
    const streamId = randomUUID()
    const stream = createTtsStream({
      streamId,
      synthesize: async () => synthesis,
      mimeType: synthesis.outputFormat === 'mp3' ? 'audio/mpeg' : `audio/${synthesis.fileExtension}`,
    })
    state.tts.set(streamId, stream)
    void (async () => {
      try {
        for await (const chunk of stream) push(state, RPC_CHANNELS.voice.TTS_STREAM_CHUNK, chunk)
      } catch { /* cancelled or access revoked */ } finally {
        if (state.tts.get(streamId) === stream) state.tts.delete(streamId)
      }
    })()
    return { streamId }
  }, writeOptions)

  handle(RPC_CHANNELS.voice.TTS_STREAM_STOP, async (context, payload: unknown) => {
    const state = getState(context)
    const streamId = bodyOf(payload).streamId
    if (typeof streamId === 'string') {
      state.tts.get(streamId)?.cancel('client-stop')
      state.tts.delete(streamId)
    }
  }, writeOptions)
}