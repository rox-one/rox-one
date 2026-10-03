/**
 * Device meetings use the configured workspace's authenticated voice service.
 * Provider credentials stay on that service. A native window lease fences both
 * the upload and the response; remote consent belongs to that credential's actor.
 */
import { createHash } from 'node:crypto'
import type { Workspace, RemoteServerConfig } from '@rox/core/types'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { DEEPGRAM_TRANSCRIPTION_MODEL, type NormalizedTranscript, type TranscriptionRequest } from '@rox/shared/voice'
import type { LocalAsrEngine, LocalMeeting } from '../../shared/meetings-local'
import type { LocalTranscriptionContext } from './local-store'

export interface MeetingVoiceClient {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  destroy(): void
}

export interface MeetingCloudAsrDeps {
  getWorkspace(id: string): Workspace | null
  connect(remote: RemoteServerConfig): Promise<MeetingVoiceClient>
  localEngine(): LocalAsrEngine
  localTranscribe(input: TranscriptionRequest): Promise<NormalizedTranscript>
  isContextCurrent(workspaceId: string, context: LocalTranscriptionContext): boolean
  timeoutMs?: number
  discoveryTimeoutMs?: number
  pollMs?: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function remoteIdentity(remote: RemoteServerConfig): string {
  // Never return or print a workspace's connection credential.
  return createHash('sha256').update(JSON.stringify(remote)).digest('hex')
}

function consented(prefs: Record<string, unknown>): boolean {
  return prefs.sttEngine === 'cloud-rox' && prefs.cloudAsrConsent === true && prefs.privacyMigrationPending !== true
}

function normalizedResult(raw: unknown): NormalizedTranscript {
  const result = record(raw)
  if (result.engine !== 'cloud-rox' || typeof result.text !== 'string' || !Array.isArray(result.segments)
    || typeof result.requestedModelId !== 'string' || !result.requestedModelId
    || typeof result.durationMs !== 'number' || !Number.isFinite(result.durationMs) || result.durationMs < 0
    || result.segments.length > 200_000 || result.text.length > 2_000_000) throw new Error('cloud-transcription-invalid-response')
  let previous = -1
  const segments = result.segments.map((value) => {
    const segment = record(value)
    if (typeof segment.startMs !== 'number' || typeof segment.endMs !== 'number' || !Number.isFinite(segment.startMs)
      || !Number.isFinite(segment.endMs) || segment.startMs < previous || segment.startMs < 0 || segment.endMs < segment.startMs
      || (result.durationMs as number) > 0 && segment.endMs > (result.durationMs as number) + 50
      || typeof segment.text !== 'string' || segment.text.length > 2_000_000
      || segment.speakerId !== undefined && typeof segment.speakerId !== 'string') throw new Error('cloud-transcription-invalid-response')
    previous = segment.startMs
    return { startMs: segment.startMs, endMs: segment.endMs, text: segment.text,
      ...(typeof segment.speakerId === 'string' ? { speakerId: segment.speakerId } : {}) }
  })
  const stringField = (key: string): string | undefined => typeof result[key] === 'string' ? result[key] as string : undefined
  return {
    text: result.text, segments, durationMs: result.durationMs, requestedModelId: result.requestedModelId,
    requestId: stringField('requestId') ?? 'workspace-deepgram', noSpeech: result.noSpeech === true,
    detectedLanguage: stringField('detectedLanguage'), resolvedModelId: stringField('resolvedModelId'),
    modelRevision: stringField('modelRevision'), diarizationModel: stringField('diarizationModel'), routeVersion: stringField('routeVersion'),
  }
}

export class MeetingCloudAsr {
  private readonly engines = new Map<string, { identity: string; engine: LocalAsrEngine }>()

  constructor(private readonly deps: MeetingCloudAsrDeps) {}

  engine(workspaceId: string | null): LocalAsrEngine {
    const local = this.deps.localEngine()
    if (!workspaceId) return local
    const remote = this.deps.getWorkspace(workspaceId)?.remoteServer
    if (!remote) return local
    const cached = this.engines.get(workspaceId)
    if (cached?.identity === remoteIdentity(remote)) return { ...cached.engine, ffmpeg: local.ffmpeg }
    return { ...local, engine: 'deepgram', model: DEEPGRAM_TRANSCRIPTION_MODEL, binary: null, modelPath: null,
      ready: true, missing: [], cloudAvailable: true }
  }

  async inspect(workspaceId: string | null, context?: LocalTranscriptionContext): Promise<LocalAsrEngine> {
    if (!workspaceId || !this.deps.getWorkspace(workspaceId)?.remoteServer) return this.deps.localEngine()
    try {
      return await this.withRemote(workspaceId, context, undefined, async (client, check, remote) => {
        const [prefs, rawCapabilities] = await Promise.all([
          client.invoke(RPC_CHANNELS.voice.GET), client.invoke(RPC_CHANNELS.voice.CAPABILITIES),
        ])
        check()
        const capabilities = record(rawCapabilities)
        const missing = [!consented(record(prefs)) && 'cloud-consent', capabilities.availability !== 'ok' && 'deepgram-not-configured']
          .filter((item): item is string => Boolean(item))
        const engine: LocalAsrEngine = { ...this.deps.localEngine(), engine: 'deepgram', binary: null, modelPath: null,
          model: typeof capabilities.modelId === 'string' ? capabilities.modelId : DEEPGRAM_TRANSCRIPTION_MODEL,
          ready: missing.length === 0, missing, cloudAvailable: capabilities.availability === 'ok' }
        this.engines.set(workspaceId, { identity: remoteIdentity(remote), engine })
        return engine
      }, this.deps.discoveryTimeoutMs ?? 15_000)
    } catch (error) {
      if (error instanceof Error && error.message === 'cloud-context-changed') throw error
      return { ...this.engine(workspaceId), ready: false, cloudAvailable: false, missing: ['cloud-transcription-unavailable'] }
    }
  }

  async transcribe(input: TranscriptionRequest, meeting: LocalMeeting, context?: LocalTranscriptionContext): Promise<NormalizedTranscript> {
    const workspaceId = meeting.workspaceId
    if (!workspaceId || !this.deps.getWorkspace(workspaceId)?.remoteServer) return this.deps.localTranscribe(input)
    return this.withRemote(workspaceId, context, input.signal, async (client, check) => {
      const [rawPrefs, rawCapabilities] = await Promise.all([
        client.invoke(RPC_CHANNELS.voice.GET), client.invoke(RPC_CHANNELS.voice.CAPABILITIES),
      ])
      check()
      if (!consented(record(rawPrefs))) throw new Error('cloud-consent')
      const capabilities = record(rawCapabilities)
      if (capabilities.availability !== 'ok') throw new Error('deepgram-not-configured')
      if (input.audio.byteLength === 0) throw new Error('empty-audio')
      if (input.audio.byteLength > 200 * 1024 * 1024) throw new Error('cloud-transcription-too-large')
      const result = await this.upload(client, check, input)
      check()
      // A user can revoke upload consent while a provider request is in flight.
      if (!consented(record(await client.invoke(RPC_CHANNELS.voice.GET)))) throw new Error('cloud-consent')
      check()
      return normalizedResult(result)
    })
  }

  private async upload(client: MeetingVoiceClient, check: () => void, input: TranscriptionRequest): Promise<unknown> {
    check()
    await client.invoke(RPC_CHANNELS.voice.START, { mimeType: input.mimeType })
    check()
    await client.invoke(RPC_CHANNELS.voice.GRANT)
    // Each encoded request stays well below the RPC frame budget. STOP alone
    // performs ASR; do not send a second TRANSCRIBE request for these bytes.
    const chunkBytes = 1024 * 1024
    for (let offset = 0; offset < input.audio.byteLength; offset += chunkBytes) {
      check()
      const acknowledged = record(await client.invoke(RPC_CHANNELS.voice.CHUNK,
        { audioBase64: Buffer.from(input.audio.subarray(offset, offset + chunkBytes)).toString('base64') }))
      if (acknowledged.ok !== true) throw new Error('cloud-transcription-upload-failed')
    }
    check()
    const job = record(await client.invoke(RPC_CHANNELS.voice.STOP))
    if (job.job !== 'ready' && job.job !== 'degraded') throw new Error('cloud-transcription-failed')
    return { ...record(job.transcript), engine: 'cloud-rox' }
  }

  private async withRemote<T>(workspaceId: string, context: LocalTranscriptionContext | undefined, signal: AbortSignal | undefined,
    operation: (client: MeetingVoiceClient, check: () => void, remote: RemoteServerConfig) => Promise<T>, timeoutMs?: number): Promise<T> {
    const remote = this.deps.getWorkspace(workspaceId)?.remoteServer
    if (!remote || !context || !this.deps.isContextCurrent(workspaceId, context)) throw new Error('cloud-context-changed')
    const captured = { ...remote }
    const identity = remoteIdentity(captured)
    let client: MeetingVoiceClient | undefined
    let ended = false
    let reason: Error | undefined
    const aborted = Promise.withResolvers<never>()
    const fail = (message: string) => {
      if (ended || reason) return
      reason = new Error(message)
      client?.destroy()
      aborted.reject(reason)
    }
    const check = () => {
      const currentRemote = this.deps.getWorkspace(workspaceId)?.remoteServer
      if (signal?.aborted) fail('cloud-transcription-cancelled')
      else if (!this.deps.isContextCurrent(workspaceId, context) || !currentRemote || remoteIdentity(currentRemote) !== identity) fail('cloud-context-changed')
      if (reason) throw reason
    }
    const onAbort = () => fail('cloud-transcription-cancelled')
    const poll = setInterval(() => { try { check() } catch { /* rejection is handled by the race */ } }, this.deps.pollMs ?? 100)
    const timeout = setTimeout(() => fail('cloud-transcription-timeout'), timeoutMs ?? this.deps.timeoutMs ?? 240_000)
    signal?.addEventListener('abort', onAbort, { once: true })
    const work = async () => {
      check()
      client = await this.deps.connect(captured)
      if (reason || ended) { client.destroy(); throw reason ?? new Error('cloud-context-changed') }
      check()
      return operation(client, check, captured)
    }
    try { return await Promise.race([work(), aborted.promise]) }
    catch (error) {
      if (reason) throw reason
      if (error instanceof Error && /^(cloud-|deepgram-not-configured$|empty-audio$)/.test(error.message)) throw error
      // Endpoints, tokens and device paths can occur in transport exceptions.
      throw new Error('cloud-transcription-unavailable')
    } finally {
      ended = true
      clearInterval(poll)
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      client?.destroy()
    }
  }
}
