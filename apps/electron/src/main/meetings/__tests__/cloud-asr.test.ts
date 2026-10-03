import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingCloudAsr, type MeetingVoiceClient } from '../cloud-asr'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { emptyLocalMeeting } from '../local-model'
import type { Workspace } from '@rox/core/types'

const noEngine = { ready: false, engine: 'deepgram', model: 'nova-3', binary: null, modelPath: null, ffmpeg: null,
  missing: ['deepgram-not-configured'], cloudAvailable: false }
const workspace: Workspace = { id: 'local-a', slug: 'local-a', name: 'Synthetic workspace', rootPath: '/synthetic/workspace', createdAt: 1,
  remoteServer: { url: 'wss://workspace.example.test', remoteWorkspaceId: 'remote-a', token: 'fixture-workspace-credential' } }
const meeting = emptyLocalMeeting({ id: 'm-1234', title: 'Synthetic meeting', workspaceId: workspace.id, now: 1 })
const context = { ownerId: 41, bindingGeneration: 1 }
const input = { audio: new Uint8Array(44), mimeType: 'audio/wav' }
const transcript = { text: 'First.\n\nSecond.', requestedModelId: 'nova-3', resolvedModelId: 'nova-3-general', requestId: 'fixture',
  modelRevision: 'fixture-release', diarizationModel: 'fixture-diarizer', durationMs: 1000, noSpeech: false,
  segments: [{ text: 'First.', startMs: 0, endMs: 400, speakerId: 'speaker-1' }, { text: 'Second.', startMs: 500, endMs: 1000, speakerId: 'speaker-2' }] }

function harness(override?: MeetingVoiceClient['invoke'], options: { timeoutMs?: number; discoveryTimeoutMs?: number } = {}) {
  const channels: string[] = []
  let liveGeneration = 1
  let connected = 0
  let destroyed = 0
  const client: MeetingVoiceClient = {
    async invoke(channel, ...args) {
      channels.push(channel)
      if (override) return override(channel, ...args)
      if (channel === RPC_CHANNELS.voice.GET) return { sttEngine: 'cloud-rox', cloudAsrConsent: true, privacyMigrationPending: false }
      if (channel === RPC_CHANNELS.voice.CAPABILITIES) return { availability: 'ok', modelId: 'nova-3' }
      if (channel === RPC_CHANNELS.voice.STOP) return { job: 'ready', transcript }
      return { ok: true }
    },
    destroy() { destroyed++ },
  }
  const bridge = new MeetingCloudAsr({
    getWorkspace: id => id === workspace.id ? workspace : null, localEngine: () => noEngine,
    async localTranscribe() { throw new Error('Local key must not be used') },
    async connect(remote) { expect(remote).toEqual(workspace.remoteServer!); connected++; return client },
    isContextCurrent: (id, lease) => id === workspace.id && lease.ownerId === 41 && lease.bindingGeneration === liveGeneration,
    pollMs: 1, timeoutMs: options.timeoutMs ?? 1000,
    discoveryTimeoutMs: options.discoveryTimeoutMs,
  })
  return { bridge, channels, invalidate: () => { liveGeneration += 2 }, counts: () => ({ connected, destroyed }) }
}

describe('native meetings central voice bridge', () => {
  it('uses an authenticated workspace service with no device key and retains paragraphs/speakers/provenance in one upload', async () => {
    const { bridge, channels, counts } = harness()
    expect(await bridge.inspect(workspace.id, context)).toMatchObject({ ready: true, cloudAvailable: true, engine: 'deepgram' })
    expect(await bridge.transcribe(input, meeting, context)).toEqual(transcript)
    expect(channels.filter(channel => channel === RPC_CHANNELS.voice.STOP)).toHaveLength(1)
    expect(channels).not.toContain(RPC_CHANNELS.voice.TRANSCRIBE)
    expect(channels).not.toContain(RPC_CHANNELS.voice.SAVE)
    expect(counts()).toEqual({ connected: 2, destroyed: 2 })
  })

  it('does not upload audio or share device consent when the remote actor has declined cloud transcription', async () => {
    const { bridge, channels } = harness(async channel => channel === RPC_CHANNELS.voice.GET
      ? { sttEngine: 'cloud-rox', cloudAsrConsent: false } : { availability: 'ok' })
    expect(await bridge.inspect(workspace.id, context)).toMatchObject({ ready: false, missing: ['cloud-consent'] })
    await expect(bridge.transcribe(input, meeting, context)).rejects.toThrow('cloud-consent')
    expect(channels).not.toContain(RPC_CHANNELS.voice.START)
    expect(channels).not.toContain(RPC_CHANNELS.voice.CHUNK)
  })

  it('denies a foreign window and a changed workspace binding before dialing', async () => {
    const { bridge, counts, invalidate } = harness()
    await expect(bridge.transcribe(input, meeting, { ownerId: 99, bindingGeneration: 1 })).rejects.toThrow('cloud-context-changed')
    invalidate() // Includes a switch away and back, with the same final workspace ID.
    await expect(bridge.transcribe(input, meeting, context)).rejects.toThrow('cloud-context-changed')
    expect(counts()).toEqual({ connected: 0, destroyed: 0 })
  })

  it('aborts an unresponsive connection on timeout and disposes a late connected socket', async () => {
    const pending = Promise.withResolvers<MeetingVoiceClient>()
    let destroyed = 0
    const bridge = new MeetingCloudAsr({ getWorkspace: () => workspace, localEngine: () => noEngine,
      localTranscribe: async () => { throw new Error('local must not run') }, connect: () => pending.promise,
      isContextCurrent: () => true, timeoutMs: 5, pollMs: 1 })
    await expect(bridge.transcribe(input, meeting, context)).rejects.toThrow('cloud-transcription-timeout')
    pending.resolve({ invoke: async () => transcript, destroy() { destroyed++ } })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(destroyed).toBe(1)
  })

  it('removes secret connection details from an offline error', async () => {
    const bridge = new MeetingCloudAsr({ getWorkspace: () => workspace, localEngine: () => noEngine,
      localTranscribe: async () => { throw new Error('local must not run') }, isContextCurrent: () => true,
      async connect() { throw new Error('wss://private.example credential=do-not-expose /private/device/audio.wav') } })
    await expect(bridge.transcribe(input, meeting, context)).rejects.toThrow('cloud-transcription-unavailable')
    expect(await bridge.inspect(workspace.id, context)).toMatchObject({ ready: false, missing: ['cloud-transcription-unavailable'] })
  })

  it('bounds service discovery separately from a long-running transcription and never sends audio during discovery', async () => {
    const { bridge, channels } = harness(async () => new Promise(() => {}), { discoveryTimeoutMs: 5, timeoutMs: 4000 })
    const started = Date.now()
    expect(await bridge.inspect(workspace.id, context)).toMatchObject({ ready: false, missing: ['cloud-transcription-unavailable'] })
    expect(Date.now() - started).toBeLessThan(500)
    expect(channels).not.toContain(RPC_CHANNELS.voice.START)
    expect(channels).not.toContain(RPC_CHANNELS.voice.CHUNK)
  })
})

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
it('persists real remotely authenticated streamed Deepgram results and fences cancelled/revoked/window-stale replies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rox-cloud-meetings-')); directories.push(dir)
  const env: Record<string, string | undefined> = { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir, ROX_SERVICE_SECRETS_FILE: join(dir, 'absent-secrets.env') }
  for (const name of ['DEEPGRAM_API_KEY', 'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY', 'TAVILY_API_KEY']) delete env[name]
  const process_ = Bun.spawn([process.execPath, join(import.meta.dir, 'cloud-asr.fixture.ts')], { cwd: join(import.meta.dir, '../../../../../..'),
    env, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([process_.exited, new Response(process_.stdout).text(), new Response(process_.stderr).text()])
  expect({ exit, stdout, stderr }).toEqual({ exit: 0,
    stdout: 'central meetings: keyless device, streamed ASR, persistence, consent, cancellation, revocation and window fences passed\n', stderr: '' })
}, 20_000)
