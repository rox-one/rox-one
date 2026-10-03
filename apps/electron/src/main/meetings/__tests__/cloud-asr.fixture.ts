import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../../../packages/server-core/src/authority/native-authority'
import { WsRpcServer, WsRpcClient } from '@rox/server-core/transport'
import { registerVoiceHandlers } from '../../../../../../packages/server-core/src/handlers/rpc/voice'
import type { HandlerDeps } from '../../../../../../packages/server-core/src/handlers/handler-deps'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { DeepgramTranscriptionAdapter, type TranscribeAdapter } from '@rox/shared/voice'
import { getServerServiceKey } from '@rox/shared/config/server-services'
import type { Workspace } from '@rox/core/types'
import { MeetingCloudAsr } from '../cloud-asr'
import { LocalMeetingStore } from '../local-store'

const deviceDir = process.env.CRAFT_CONFIG_DIR!
const serverDir = join(deviceDir, 'remote-host'); mkdirSync(serverDir)
const authority = new NativeAuthority({ stateDir: join(serverDir, 'authority') })
const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  admin = authority.bootstrapLocalAdministrator('synthetic central meeting service')
} finally {
  if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
}
const remoteRoot = join(serverDir, 'workspace-a'); mkdirSync(remoteRoot)
authority.registerWorkspace(admin.credential, 'remote-a', remoteRoot)
const enroll = (label: string) => authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60_000), label)!
const actor = enroll('meeting owner'), otherActor = enroll('other meeting owner')
const grant = () => authority.grantWorkspace(admin.credential, actor.principal.subject, 'remote-a', ['read', 'write', 'delete', 'subscribe'])
grant(); authority.grantWorkspace(admin.credential, otherActor.principal.subject, 'remote-a', ['read', 'write', 'subscribe'])
let requests = 0
let lastAudioBytes = 0
let defer = false
let pending: { resolve(response: Response): void; signal: AbortSignal } | undefined
const deepgramPayload = () => ({ metadata: { request_id: 'fixture-provider-request', duration: 5,
  model_info: { fixture: { arch: 'nova-4', version: 'fixture-latest-release' } }, diarize_info: { arch: 'fixture-latest-diarizer' } },
  results: { channels: [{ detected_language: 'ru', alternatives: [{ transcript: 'First paragraph. Второй абзац.',
    paragraphs: { paragraphs: [{ speaker: 0, sentences: [{ start: 0.25, end: 1.5, text: 'First paragraph.' }] },
      { speaker: 1, sentences: [{ start: 2.25, end: 4, text: 'Второй абзац.' }] }] },
    words: [{ start: 0.25, end: 0.5, word: 'First', speaker: 0 }, { start: 2.25, end: 2.5, word: 'Второй', speaker: 1 }] }] }] } })
const provider = new DeepgramTranscriptionAdapter({ apiKey: 'synthetic-host-only-key', http: { async fetch(url, init) {
  const parsed = new URL(String(url))
  assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Token synthetic-host-only-key')
  if (parsed.pathname === '/v1/models') return Response.json({ stt: [{ canonical_name: 'nova-4', batch: true, retired: false }] })
  assert.equal(parsed.pathname, '/v1/listen')
  assert.equal(parsed.searchParams.get('model'), 'nova-4')
  assert.equal(parsed.searchParams.get('version'), 'latest')
  assert.equal(parsed.searchParams.get('diarize_model'), 'latest')
  assert.equal(parsed.searchParams.get('paragraphs'), 'true')
  requests++; lastAudioBytes = (init?.body as Blob).size
  if (!defer) return Response.json(deepgramPayload())
  return new Promise<Response>(resolve => { pending = { resolve, signal: init?.signal as AbortSignal } })
} } })
const adapter: TranscribeAdapter = { engine: 'cloud-rox', async transcribe(input) {
  return { ...await provider.transcribe(input), engine: 'cloud-rox', uploaded: true }
} }
const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
  nativeEventChannels: new Set([RPC_CHANNELS.voice.CHANGED, RPC_CHANNELS.voice.JOB, RPC_CHANNELS.voice.OVERLAY]) })
registerVoiceHandlers(server, { nativeData: { authority } } as HandlerDeps, { configDir: serverDir, cloudTranscriber: adapter })
const clients = new Set<WsRpcClient>()
const channels: string[] = []
const client = (token = actor.credential) => {
  const value = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: 'remote-a',
    mode: 'remote', autoReconnect: false, requestTimeout: 3000, connectTimeout: 1000 })
  clients.add(value); value.connect(); return value
}
const localRoot = join(deviceDir, 'local-workspace'); mkdirSync(localRoot)
const workspace: Workspace = { id: 'local-a', slug: 'local-a', name: 'Synthetic device workspace', rootPath: localRoot, createdAt: 1,
  remoteServer: { url: 'ws://127.0.0.1:1', remoteWorkspaceId: 'remote-a', token: actor.credential } }
let generation = 1
const context = () => ({ ownerId: 41, bindingGeneration: generation })
const bridge = new MeetingCloudAsr({
  getWorkspace: id => id === workspace.id ? workspace : null,
  localEngine: () => ({ ready: false, engine: 'deepgram', binary: null, model: 'nova-3', modelPath: null,
    ffmpeg: null, missing: ['deepgram-not-configured'], cloudAvailable: false }),
  async localTranscribe() { throw new Error('Device provider key must not be used') },
  isContextCurrent: (id, lease) => id === workspace.id && lease.ownerId === 41 && lease.bindingGeneration === generation,
  pollMs: 2, timeoutMs: 4000,
  async connect(remote) {
    assert.deepEqual(remote, workspace.remoteServer)
    const value = client(remote.token)
    return { async invoke(channel: string, ...args: unknown[]) { channels.push(channel); return value.invoke(channel, ...args) },
      destroy() { value.destroy(); clients.delete(value) } }
  },
})
const root = join(deviceDir, 'device-meetings')
const store = new LocalMeetingStore({ root, detectEngine: meeting => bridge.engine(meeting?.workspaceId ?? null), emit() {},
  transcribeCloud: (input, meeting, lease) => bridge.transcribe(input, meeting, lease) })
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 4000
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await tick() }
}
async function recording(size = 44) {
  const started = store.recStart({ title: 'Private synthetic meeting', workspaceId: workspace.id, mimeType: 'audio/wav',
    owner: 41, transcriptionContext: context() })
  if (!started.ok) throw new Error(started.code)
  const audio = new Uint8Array(size); audio.set([82, 73, 70, 70]); audio.set([87, 65, 86, 69], 8)
  store.recChunk(started.value.id, audio)
  await store.recStop(started.value.id, { durationMs: 1000 })
  return started.value.id
}
async function deferredRecording() {
  defer = true; pending = undefined
  const id = await recording()
  await until(() => pending !== undefined, 'provider upload')
  return { id, request: pending! }
}

try {
  assert.equal(getServerServiceKey('DEEPGRAM_API_KEY'), undefined)
  await server.listen(); workspace.remoteServer!.url = `ws://127.0.0.1:${server.port}`
  const control = client()
  // The central actor consent is false even though the device's engine is the
  // default cloud engine; inspecting never grants consent on the user's behalf.
  assert.deepEqual((await bridge.inspect(workspace.id, context())).missing, ['cloud-consent'])
  assert.equal(requests, 0)
  await control.invoke(RPC_CHANNELS.voice.SAVE, { cloudAsrConsent: true, privacyMigrationPending: false })
  assert.equal((await bridge.inspect(workspace.id, context())).ready, true)
  const other = client(otherActor.credential)
  assert.equal((await other.invoke(RPC_CHANNELS.voice.GET)).cloudAsrConsent, false)
  const id = await recording(2 * 1024 * 1024 + 44)
  await until(() => store.read(id)?.transcript.status === 'done', 'persisted remote transcript')
  assert.equal(requests, 1); assert.equal(lastAudioBytes, 2 * 1024 * 1024 + 44)
  assert.equal(channels.filter(channel => channel === RPC_CHANNELS.voice.CHUNK).length, 3)
  assert(!channels.includes(RPC_CHANNELS.voice.TRANSCRIBE))
  const saved = store.readTranscript(id)!
  assert.deepEqual(saved.segments.map(segment => [segment.startMs, segment.endMs, segment.speakerId]),
    [[250, 1500, 'speaker-1'], [2250, 4000, 'speaker-2']])
  assert.equal(saved.model, 'nova-4'); assert.equal(saved.provenance?.modelRevision, 'fixture-latest-release')
  assert.equal(saved.provenance?.diarizationModel, 'fixture-latest-diarizer')
  assert.equal(store.read(id)?.durationMs, 5000)
  const markdown = readFileSync(join(root, id, 'transcript.md'), 'utf8')
  assert(markdown.includes('speaker-1: First paragraph.\n\n')); assert(markdown.includes('speaker-2: Второй абзац.'))
  assert(!JSON.stringify(saved).includes('synthetic-host-only-key'))
  assert.equal(getServerServiceKey('DEEPGRAM_API_KEY'), undefined)

  const cancelled = await deferredRecording()
  assert.equal(store.cancelTranscription(cancelled.id).ok, true)
  await until(() => cancelled.request.signal.aborted, 'provider aborted after native cancellation')
  cancelled.request.resolve(Response.json(deepgramPayload()))
  await tick(); assert.equal(store.read(cancelled.id)?.transcript.status, 'cancelled')
  assert.equal(store.read(cancelled.id)?.durationMs, 1000); assert.equal(store.readTranscript(cancelled.id), null)
  assert(!existsSync(join(root, cancelled.id, 'transcript.md')))

  const stale = await deferredRecording()
  generation += 2 // Same final workspace ID after A -> B -> A.
  await until(() => stale.request.signal.aborted, 'provider aborted after native workspace generation changed')
  stale.request.resolve(Response.json(deepgramPayload()))
  await until(() => store.read(stale.id)?.transcript.status === 'failed', 'stale workspace failure')
  assert.equal(store.read(stale.id)?.durationMs, 1000); assert.equal(store.readTranscript(stale.id), null)

  const revoked = await deferredRecording()
  authority.revokeWorkspaceGrant(admin.credential, actor.principal.subject, 'remote-a'); grant()
  await until(() => revoked.request.signal.aborted, 'provider aborted after revoke/regrant')
  revoked.request.resolve(Response.json(deepgramPayload()))
  await until(() => store.read(revoked.id)?.transcript.status === 'failed', 'revoked remote failure')
  assert.equal(store.readTranscript(revoked.id), null)

  const unconsented = await deferredRecording()
  await control.invoke(RPC_CHANNELS.voice.SAVE, { cloudAsrConsent: false })
  unconsented.request.resolve(Response.json(deepgramPayload()))
  await until(() => store.read(unconsented.id)?.transcript.status === 'failed', 'consent revocation')
  assert.equal(store.readTranscript(unconsented.id), null)
  assert.equal(store.read(unconsented.id)?.durationMs, 1000)
  defer = false
  await control.invoke(RPC_CHANNELS.voice.SAVE, { cloudAsrConsent: true })
  assert.equal(store.transcribe(cancelled.id, context()).ok, true)
  await until(() => store.read(cancelled.id)?.transcript.status === 'done', 'retry after cancellation')
  console.log('central meetings: keyless device, streamed ASR, persistence, consent, cancellation, revocation and window fences passed')
} finally {
  for (const value of clients) value.destroy()
  await tick(); server.close(); authority.close()
}
