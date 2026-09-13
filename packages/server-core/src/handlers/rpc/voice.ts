/**
 * Voice RPC — dictation prefs, Device VoiceHost capture, local-or-cloud STT.
 *
 * Audio stays on device unless the user selected a cloud STT engine.
 * Manual transcript edits are not accepted as ASR output.
 */

import { arch } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  VoicePrivacyError,
  assertEditableTranscript,
  buildVoiceHealth,
  getCachedVoiceCapabilities,
  getDefaultVoicePrefs,
  isVoiceExportFormat,
  loadVoicePrefs,
  resolveRecognitionLanguage,
  saveVoicePrefs,
  speakWithPolicy,
  transcribeWithPolicy,
  VOICE_PREFS_VERSION,
  type SpeakAdapter,
  type TranscribeAdapter,
  type TranscribeInput,
  type VoicePrefs,
} from '@craft-agent/shared/voice'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  createDefaultGatewayDeps,
  fetchVoiceCapabilities,
  resolveVoiceAccessToken,
  transcribeViaRoxGateway,
  type VoiceGatewayDeps,
} from '../../voice/gateway'
import { DeviceVoiceHost, type VoiceHostRuntime } from '../../voice/host'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.voice.GET,
  RPC_CHANNELS.voice.SAVE,
  RPC_CHANNELS.voice.HEALTH,
  RPC_CHANNELS.voice.TRANSCRIBE,
  RPC_CHANNELS.voice.SPEAK,
  RPC_CHANNELS.voice.CAPTURE_START,
  RPC_CHANNELS.voice.CAPTURE_CHUNK,
  RPC_CHANNELS.voice.CAPTURE_STOP,
  RPC_CHANNELS.voice.CAPTURE_CANCEL,
  RPC_CHANNELS.voice.STATUS,
  RPC_CHANNELS.voice.LIST,
  RPC_CHANNELS.voice.DELETE,
  RPC_CHANNELS.voice.FAVORITE,
  RPC_CHANNELS.voice.ARCHIVE_DIR,
  RPC_CHANNELS.voice.GET_AUDIO,
  RPC_CHANNELS.voice.RETRANSCRIBE,
  RPC_CHANNELS.voice.EXPORT,
  RPC_CHANNELS.voice.SELECT_REVISION,
  RPC_CHANNELS.voice.EDIT_TRANSCRIPT,
] as const

export interface VoiceHandlerRuntime {
  configDir?: string
  host?: DeviceVoiceHost
  gatewayDeps?: VoiceGatewayDeps
  localModelReady?: () => boolean | Promise<boolean>
  localAdapter?: TranscribeAdapter
  cloudAdapter?: TranscribeAdapter
  transcribe?: VoiceHostRuntime['transcribe']
}

function appleSilicon(): boolean {
  return process.platform === 'darwin' && (arch() === 'arm64' || process.arch === 'arm64')
}

function decodeAudio(audioBase64: unknown): Uint8Array {
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    throw new Error('audioBase64 is required')
  }
  return Uint8Array.from(Buffer.from(audioBase64, 'base64'))
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function localUnavailableAdapter(): TranscribeAdapter {
  return {
    engine: 'local-whisper',
    async transcribe() {
      throw new VoicePrivacyError(
        'local-model-missing',
        'Local Whisper model is not installed',
      )
    },
  }
}

function createCloudAdapter(deps: VoiceGatewayDeps): TranscribeAdapter {
  return {
    engine: 'cloud-rox',
    async transcribe(input: TranscribeInput) {
      const { token } = await resolveVoiceAccessToken(deps)
      return transcribeViaRoxGateway(deps, token, input)
    },
  }
}

function edgeSpeakAdapter(): SpeakAdapter {
  return {
    engine: 'edge',
    async speak() {
      return { engine: 'edge', uploaded: false }
    },
  }
}

function fishSpeakAdapter(): SpeakAdapter {
  return {
    engine: 'fish-speech',
    async speak() {
      return { engine: 'fish-speech', uploaded: false }
    },
  }
}

function broadcast(server: RpcServer, prefs: VoicePrefs): void {
  pushTyped(server, RPC_CHANNELS.voice.CHANGED, { to: 'all' }, prefs)
}

async function broadcastCapture(server: RpcServer, host: DeviceVoiceHost): Promise<void> {
  pushTyped(server, RPC_CHANNELS.voice.CAPTURE_CHANGED, { to: 'all' }, await host.status())
}

function gatewayDepsFrom(runtime: VoiceHandlerRuntime): VoiceGatewayDeps {
  return runtime.gatewayDeps ?? createDefaultGatewayDeps({ configDir: runtime.configDir })
}

function createHost(runtime: VoiceHandlerRuntime): DeviceVoiceHost {
  if (runtime.host) return runtime.host
  const deps = gatewayDepsFrom(runtime)
  const transcribe = runtime.transcribe ?? (async (input) => {
    const prefs = loadVoicePrefs(runtime.configDir)
    const localReady = await Promise.resolve(runtime.localModelReady?.() ?? false)
    return transcribeWithPolicy(prefs, {
      audio: new Uint8Array(input.audio),
      mimeType: input.mimeType,
      language: input.language,
      requestId: input.requestId,
      signal: input.signal,
    }, {
      local: runtime.localAdapter ?? localUnavailableAdapter(),
      cloud: runtime.cloudAdapter ?? createCloudAdapter(deps),
    }, { localModelReady: localReady })
  })
  return new DeviceVoiceHost({
    configDir: runtime.configDir,
    gatewayDeps: deps,
    transcribe,
  })
}

function mapVoiceError(error: unknown): never {
  if (error instanceof VoicePrivacyError) {
    throw new Error(error.message)
  }
  throw error
}

function prefsDir(runtime: VoiceHandlerRuntime): string | undefined {
  return runtime.configDir
}

function languageFrom(body: Record<string, unknown>, prefs: VoicePrefs): string | undefined {
  if (typeof body.language === 'string' && body.language.trim()) return body.language
  return resolveRecognitionLanguage(prefs.recognitionLanguage)
}

let registeredHost: DeviceVoiceHost | null = null

export async function shutdownVoiceHandlers(): Promise<void> {
  await registeredHost?.shutdown()
}

export function registerVoiceHandlers(
  server: RpcServer,
  _deps: HandlerDeps,
  runtime: VoiceHandlerRuntime = {},
): void {
  const host = createHost(runtime)
  registeredHost = host
  const dir = prefsDir(runtime)

  server.handle(RPC_CHANNELS.voice.GET, async () => loadVoicePrefs(dir))

  server.handle(RPC_CHANNELS.voice.SAVE, async (_ctx, patch: unknown) => {
    const current = loadVoicePrefs(dir)
    const next = saveVoicePrefs({
      ...current,
      ...(patch && typeof patch === 'object' ? patch : {}),
      version: VOICE_PREFS_VERSION,
    } as VoicePrefs, dir)
    broadcast(server, next)
    return next
  })

  server.handle(RPC_CHANNELS.voice.HEALTH, async () => {
    const prefs = loadVoicePrefs(dir)
    const localModelReady = await Promise.resolve(runtime.localModelReady?.() ?? false)
    let capabilities = getCachedVoiceCapabilities()
    try {
      const deps = gatewayDepsFrom(runtime)
      const { token } = await resolveVoiceAccessToken(deps)
      capabilities = await fetchVoiceCapabilities(deps, token)
    } catch {
      // last-known-good cache is enough for a degraded health snapshot
    }
    return buildVoiceHealth(prefs, {
      appleSilicon: appleSilicon(),
      offline: false,
      localModelReady,
      capabilities,
    })
  })

  server.handle(RPC_CHANNELS.voice.TRANSCRIBE, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    const prefs = loadVoicePrefs(dir)
    try {
      const rec = await host.start(typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm')
      await host.appendChunk(rec.id, Buffer.from(decodeAudio(body.audioBase64)))
      await host.stop(rec.id)
      return await host.transcribeRecording(rec.id, prefs, {
        language: languageFrom(body, prefs),
      })
    } catch (error) {
      mapVoiceError(error)
    }
  })

  server.handle(RPC_CHANNELS.voice.SPEAK, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    const text = assertEditableTranscript(typeof body.text === 'string' ? body.text : '')
    return speakWithPolicy(loadVoicePrefs(dir), { text }, {
      edge: edgeSpeakAdapter(),
      fish: fishSpeakAdapter(),
    })
  })

  server.handle(RPC_CHANNELS.voice.CAPTURE_START, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    const rec = await host.start(typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm')
    await broadcastCapture(server, host)
    return rec
  })

  server.handle(RPC_CHANNELS.voice.CAPTURE_CHUNK, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    await host.appendChunk(body.id, Buffer.from(decodeAudio(body.chunkBase64)))
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.voice.CAPTURE_STOP, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    const status = await host.status()
    const id = typeof body.id === 'string' ? body.id : status.activeId
    if (!id) throw new Error('No active recording')
    try {
      const prefs = loadVoicePrefs(dir)
      await host.stop(id, {
        durationMs: typeof body.durationMs === 'number' ? body.durationMs : undefined,
      })
      await broadcastCapture(server, host)
      const result = await host.transcribeRecording(id, prefs, {
        language: languageFrom(body, prefs),
      })
      await broadcastCapture(server, host)
      return result
    } catch (error) {
      await broadcastCapture(server, host)
      mapVoiceError(error)
    }
  })

  server.handle(RPC_CHANNELS.voice.CAPTURE_CANCEL, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    const status = await host.status()
    const id = typeof body.id === 'string' ? body.id : status.activeId
    if (!id) throw new Error('No active recording')
    const rec = await host.cancel(id, {
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : undefined,
    })
    await broadcastCapture(server, host)
    return rec
  })

  server.handle(RPC_CHANNELS.voice.STATUS, async () => host.status())

  server.handle(RPC_CHANNELS.voice.LIST, async () => host.list())

  server.handle(RPC_CHANNELS.voice.DELETE, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    await host.delete(body.id)
    await broadcastCapture(server, host)
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.voice.FAVORITE, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    const rec = await host.setFavorite(body.id, body.favorite === true)
    await broadcastCapture(server, host)
    return rec
  })

  server.handle(RPC_CHANNELS.voice.ARCHIVE_DIR, async () => {
    await host.ensureReady()
    return { path: host.archiveDir() }
  })

  server.handle(RPC_CHANNELS.voice.GET_AUDIO, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    return host.getAudio(body.id)
  })

  server.handle(RPC_CHANNELS.voice.RETRANSCRIBE, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    const prefs = loadVoicePrefs(dir)
    try {
      const result = await host.transcribeRecording(body.id, prefs, {
        language: languageFrom(body, prefs),
      })
      await broadcastCapture(server, host)
      return result
    } catch (error) {
      await broadcastCapture(server, host)
      mapVoiceError(error)
    }
  })

  server.handle(RPC_CHANNELS.voice.EXPORT, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    if (!isVoiceExportFormat(body.format)) throw new Error('Unsupported export format')
    return host.exportRecording(body.id, body.format)
  })

  server.handle(RPC_CHANNELS.voice.SELECT_REVISION, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string' || typeof body.revisionId !== 'string') {
      throw new Error('id and revisionId are required')
    }
    const rec = await host.selectRevision(body.id, body.revisionId)
    await broadcastCapture(server, host)
    return rec
  })

  server.handle(RPC_CHANNELS.voice.EDIT_TRANSCRIPT, async (_ctx, payload: unknown) => {
    const body = asRecord(payload)
    if (typeof body.id !== 'string') throw new Error('id is required')
    try {
      const rec = await host.editTranscript(body.id, typeof body.text === 'string' ? body.text : '')
      await broadcastCapture(server, host)
      return rec
    } catch (error) {
      mapVoiceError(error)
    }
  })
}

export function getDefaultVoiceDto(): VoicePrefs {
  return getDefaultVoicePrefs()
}
