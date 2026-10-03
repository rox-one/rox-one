import { strict as assert } from 'node:assert'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { NativeAuthority } from '../../../authority/native-authority'
import { WsRpcServer } from '../../../transport/server'
import { WsRpcClient } from '../../../transport/client'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { registerVoiceHandlers } from '../voice'
import type { HandlerDeps } from '../../handler-deps'
import type { TranscribeAdapter, TranscribeInput } from '@rox/shared/voice'
import type { RpcServer } from '../../../transport'

const configDir = process.env.CRAFT_CONFIG_DIR!
let authority = new NativeAuthority({ stateDir: join(configDir, 'authority') })
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  admin = authority.bootstrapLocalAdministrator('synthetic voice owner')
} finally {
  if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
}
for (const id of ['workspace-a', 'workspace-b']) {
  const root = join(configDir, id); mkdirSync(root)
  authority.registerWorkspace(admin.credential, id, root)
}
const enroll = (label: string) => authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60_000), label)!
const first = enroll('first'), second = enroll('second'), reader = enroll('reader')
const grant = (issued: typeof first, actions: Parameters<NativeAuthority['grantWorkspace']>[3]) => authority.grantWorkspace(admin.credential, issued.principal.subject, 'workspace-a', actions)
for (const actor of [first, second]) grant(actor, ['read', 'write', 'delete', 'subscribe'])
grant(reader, ['read', 'subscribe'])
writeFileSync(join(configDir, 'voice.json'), JSON.stringify({ version: 3, cloudAsrConsent: true, recognitionLanguage: 'ru', selectedInputDeviceId: 'HOST SECRET DEVICE' }))
const hostPrefs = readFileSync(join(configDir, 'voice.json'), 'utf8')
const proofs = new Map<string, { workspaceId: string; webContentsId: number }>()
const clients: WsRpcClient[] = []
let server!: WsRpcServer
let nativePlaybackCalls = 0
let requests: TranscribeInput[] = []
let behavior: 'resolve' | 'defer' = 'resolve'
let pending: { input: TranscribeInput; resolve: (value: Awaited<ReturnType<TranscribeAdapter['transcribe']>>) => void; reject: (reason: Error) => void } | undefined
const result = () => ({ engine: 'cloud-rox' as const, uploaded: true, text: 'First paragraph.\n\nSecond paragraph.',
  segments: [{ startMs: 0, endMs: 100, text: 'First paragraph.', speakerId: 'speaker-1' }, { startMs: 100, endMs: 200, text: 'Second paragraph.', speakerId: 'speaker-2' }],
  words: [{ startMs: 0, endMs: 50, text: 'First', speakerId: 'speaker-1' }],
  requestedModelId: 'nova-3', resolvedModelId: 'nova-3-general', modelRevision: 'fixture-release', diarizationModel: 'fixture-diarizer', durationMs: 200 })
const adapter: TranscribeAdapter = { engine: 'cloud-rox', async transcribe(input) {
  requests.push(input)
  if (behavior === 'resolve') return result()
  return new Promise((resolve, reject) => {
    pending = { input, resolve, reject }
    input.signal?.addEventListener('abort', () => reject(new Error('synthetic-aborted')), { once: true })
  })
} }
const startServer = async (stopTimeoutMs?: number) => {
  server = new WsRpcServer({ port: 0, requireAuth: true, nativeAuthority: authority, validateToken: async token => token === 'legacy-fixture',
    nativeEventChannels: new Set([RPC_CHANNELS.voice.CHANGED, RPC_CHANNELS.voice.JOB, RPC_CHANNELS.voice.OVERLAY]),
    resolveLocalClientBinding: candidate => proofs.get(candidate.localClientProof ?? '') ?? null })
  // Exercise the real transport timeout without waiting four minutes. Every
  // other RPC keeps its production registration and authentication behavior.
  const registrationServer = stopTimeoutMs ? new Proxy(server, {
    get(target, property) {
      if (property === 'handle') return ((channel, handler, settings) => target.handle(channel, handler,
        channel === RPC_CHANNELS.voice.STOP ? { ...settings, timeoutMs: stopTimeoutMs } : settings)) as RpcServer['handle']
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) : server
  registerVoiceHandlers(registrationServer, { nativeData: { authority } } as HandlerDeps, { configDir, cloudTranscriber: adapter,
    systemSpeaker: { stop: () => false, isSpeaking: () => false, async speak() { nativePlaybackCalls++; return { played: true } } } })
  await server.listen()
}
const client = (issued: typeof first, workspaceId = 'workspace-a', localProof?: string) => {
  const c = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: issued.credential, workspaceId,
    ...(localProof ? { localClientProof: localProof, webContentsId: proofs.get(localProof)!.webContentsId } : {}),
    mode: localProof ? 'local' : 'remote', autoReconnect: false, requestTimeout: 2000, connectTimeout: 500 })
  clients.push(c); c.connect(); return c
}
const deny = async (fn: () => Promise<unknown>) => { let denied = false; try { await fn() } catch { denied = true }; assert(denied, 'Expected an authorization/privacy/validation failure: ' + String(fn)) }
const tick = () => new Promise(resolve => setTimeout(resolve, 15))
const awaitPending = async () => { for (let i = 0; i < 50 && !pending; i++) await tick(); assert(pending, 'Adapter never received the request'); return pending! }
const audioBase64 = Buffer.from('synthetic audio bytes').toString('base64')
const consent = (c: WsRpcClient) => c.invoke(RPC_CHANNELS.voice.SAVE, { cloudAsrConsent: true, privacyMigrationPending: false })
const capture = async (c: WsRpcClient) => {
  const started = await c.invoke(RPC_CHANNELS.voice.START, { mimeType: 'audio/ogg;codecs=opus' })
  await c.invoke(RPC_CHANNELS.voice.GRANT)
  await c.invoke(RPC_CHANNELS.voice.CHUNK, { audioBase64 })
  const job = await c.invoke(RPC_CHANNELS.voice.STOP)
  assert.equal(job.job, 'ready'); assert.equal(job.transcript.diarizationModel, 'fixture-diarizer')
  assert.equal(job.transcript.segments[1].speakerId, 'speaker-2'); assert.equal(job.transcript.text, result().text)
  return started.recordingId as string
}

try {
  await startServer()
  const a = client(first), b = client(second), ro = client(reader)
  const aEvents: unknown[] = [], bEvents: unknown[] = []
  a.on(RPC_CHANNELS.voice.CHANGED, value => aEvents.push(value)); b.on(RPC_CHANNELS.voice.CHANGED, value => bEvents.push(value))
  a.on(RPC_CHANNELS.voice.JOB, value => aEvents.push(value)); b.on(RPC_CHANNELS.voice.JOB, value => bEvents.push(value))
  assert.equal((await a.invoke(RPC_CHANNELS.voice.GET)).cloudAsrConsent, false)
  assert.equal((await a.invoke(RPC_CHANNELS.voice.GET)).selectedInputDeviceId, null)
  assert.equal((await a.invoke(RPC_CHANNELS.voice.CAPABILITIES)).availability, 'ok')
  await deny(() => a.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64, transcript: 'renderer injection', cloudAsrConsent: true }))
  assert.equal(requests.length, 0)
  await consent(a); await tick()
  assert.equal((await b.invoke(RPC_CHANNELS.voice.GET)).cloudAsrConsent, false)
  assert(aEvents.length > 0); assert.equal(bEvents.length, 0)
  assert.equal(readFileSync(join(configDir, 'voice.json'), 'utf8'), hostPrefs)
  await deny(() => ro.invoke(RPC_CHANNELS.voice.SAVE, { cloudAsrConsent: true }))
  await deny(() => ro.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64 }))
  await deny(() => a.invoke(RPC_CHANNELS.voice.GET, { workspaceId: 'workspace-b' }))
  const foreign = client(first, 'workspace-b'); await deny(() => foreign.invoke(RPC_CHANNELS.voice.GET))
  const legacy = client({ ...first, credential: 'legacy-fixture' }); await deny(() => legacy.invoke(RPC_CHANNELS.voice.GET))
  const transcribed = await a.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64, mimeType: 'audio/webm', transcript: 'renderer injection' })
  assert.equal(transcribed.text, result().text); assert(!JSON.stringify(transcribed).includes('apiKey'))
  await deny(() => a.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64: '%%%invalid' }))
  await deny(() => a.invoke(RPC_CHANNELS.voice.START, { mimeType: '../../arbitrary' }))
  const recordingId = await capture(a); await tick()
  assert.equal(bEvents.length, 0)
  assert.equal((await b.invoke(RPC_CHANNELS.voice.HISTORY_LIST)).page.length, 0)
  assert.equal((await b.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: recordingId })).recording, null)
  await deny(() => b.invoke(RPC_CHANNELS.voice.HISTORY_FAVORITE, { id: recordingId, favorite: true }))
  await deny(() => b.invoke(RPC_CHANNELS.voice.HISTORY_DELETE, { id: recordingId }))
  await deny(() => b.invoke(RPC_CHANNELS.voice.RETRANSCRIBE, { id: recordingId }))
  assert.equal((await a.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: recordingId })).recording.audioPath, '')
  const exported = await a.invoke(RPC_CHANNELS.voice.HISTORY_EXPORT, { id: recordingId, format: 'json' })
  assert(!exported.text.includes(configDir)); assert(exported.text.includes('First paragraph.'))
  await a.invoke(RPC_CHANNELS.voice.HISTORY_FAVORITE, { id: recordingId, favorite: true })
  assert.equal((await a.invoke(RPC_CHANNELS.voice.HISTORY_LIST, { favorite: true })).page.length, 1)
  const before = requests.length
  const rerun = await a.invoke(RPC_CHANNELS.voice.RETRANSCRIBE, { id: recordingId, path: '/etc/passwd' })
  assert.equal(requests.length, before + 1); assert.equal(rerun.transcript.modelRevision, 'fixture-release')
  assert.equal((await a.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: recordingId })).revisions.length, 2)
  const actorHash = createHash('sha256').update(JSON.stringify(['rox-private-voice-v1', first.principal.issuer, first.principal.subject])).digest('hex')
  const original = join(configDir, 'voice-users', actorHash, 'voice', 'recordings', recordingId, 'original.bin')
  const foreignAudio = join(configDir, 'foreign-sensitive-audio.bin')
  writeFileSync(foreignAudio, 'foreign-sensitive-fixture')
  renameSync(original, original + '.saved'); symlinkSync(foreignAudio, original)
  const beforeLinkedRetry = requests.length
  await deny(() => a.invoke(RPC_CHANNELS.voice.RETRANSCRIBE, { id: recordingId }))
  assert.equal(requests.length, beforeLinkedRetry)
  assert.equal(readFileSync(foreignAudio, 'utf8'), 'foreign-sensitive-fixture')
  rmSync(original); renameSync(original + '.saved', original)

  assert.equal((await a.invoke(RPC_CHANNELS.voice.SPEAK, { text: 'remote user text' })).playback, 'renderer')
  assert.equal(nativePlaybackCalls, 0)

  await consent(b)
  // Two independent client hosts may record concurrently without sharing chunks/jobs.
  const startedA = await a.invoke(RPC_CHANNELS.voice.START, { mimeType: 'audio/webm' })
  const startedB = await b.invoke(RPC_CHANNELS.voice.START, { mimeType: 'audio/ogg' })
  await a.invoke(RPC_CHANNELS.voice.GRANT); await b.invoke(RPC_CHANNELS.voice.GRANT)
  const firstAudio = Buffer.from('first actor distinct audio').toString('base64')
  const secondAudio = Buffer.from('second actor different audio').toString('base64')
  await a.invoke(RPC_CHANNELS.voice.CHUNK, { audioBase64: firstAudio })
  await b.invoke(RPC_CHANNELS.voice.CHUNK, { audioBase64: secondAudio })
  const concurrentStart = requests.length
  const [jobA, jobB] = await Promise.all([a.invoke(RPC_CHANNELS.voice.STOP), b.invoke(RPC_CHANNELS.voice.STOP)])
  assert.equal(jobA.recordingId, startedA.recordingId); assert.equal(jobB.recordingId, startedB.recordingId)
  assert.notEqual(jobA.recordingId, jobB.recordingId)
  assert.deepEqual(requests.slice(concurrentStart).map(input => Buffer.from(input.audio).toString()).sort(),
    ['first actor distinct audio', 'second actor different audio'].sort())
  assert.equal((await a.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: startedB.recordingId })).recording, null)
  assert.equal((await b.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: startedA.recordingId })).recording, null)
  await a.invoke(RPC_CHANNELS.voice.HISTORY_DELETE, { id: startedA.recordingId })
  await b.invoke(RPC_CHANNELS.voice.HISTORY_DELETE, { id: startedB.recordingId })
  behavior = 'defer'; pending = undefined
  const pendingA = a.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64 }).then(value => ({ value }), error => ({ error }))
  const requestA = await awaitPending()
  await b.invoke(RPC_CHANNELS.voice.CANCEL)
  assert.equal(requestA.input.signal!.aborted, false)
  await a.invoke(RPC_CHANNELS.voice.CANCEL)
  assert.equal(requestA.input.signal!.aborted, true)
  assert('error' in await pendingA)

  pending = undefined
  const consentRevoked = a.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64 }).then(value => ({ value }), error => ({ error }))
  const consentRequest = await awaitPending()
  await a.invoke(RPC_CHANNELS.voice.SAVE, { cloudAsrConsent: false })
  assert.equal(consentRequest.input.signal!.aborted, true)
  assert('error' in await consentRevoked)
  await consent(a)

  pending = undefined
  const revoked = a.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64 }).then(value => ({ value }), error => ({ error }))
  const revokeRequest = await awaitPending()
  authority.revokeWorkspaceGrant(admin.credential, first.principal.subject, 'workspace-a')
  grant(first, ['read', 'write', 'delete', 'subscribe'])
  assert.equal(revokeRequest.input.signal!.aborted, true)
  assert('error' in await revoked)
  assert.equal((await a.invoke(RPC_CHANNELS.voice.GET)).cloudAsrConsent, true)

  pending = undefined
  const disconnected = b.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64 }).catch(() => undefined)
  const disconnectRequest = await awaitPending(); b.destroy(); await disconnected; await tick()
  assert.equal(disconnectRequest.input.signal!.aborted, true)

  behavior = 'resolve'
  // Directory names contain neither subjects nor public profile information.
  const users = join(configDir, 'voice-users')
  assert(readdirSync(users).every(entry => /^[a-f0-9]{64}$/.test(entry)))
  for (const dir of readdirSync(users)) {
    assert.equal(lstatSync(join(users, dir)).mode & 0o777, 0o700)
    if (existsSync(join(users, dir, 'voice.json'))) assert.equal(lstatSync(join(users, dir, 'voice.json')).mode & 0o777, 0o600)
    if (existsSync(join(users, dir, 'voice', 'history.json'))) assert.equal(lstatSync(join(users, dir, 'voice', 'history.json')).mode & 0o777, 0o600)
  }
  for (const c of clients.splice(0)) c.destroy(); await tick(); server.close(); authority.close()
  authority = new NativeAuthority({ stateDir: join(configDir, 'authority') }); await startServer(30)
  const restarted = client(first)
  assert.equal((await restarted.invoke(RPC_CHANNELS.voice.GET)).cloudAsrConsent, true)
  assert.equal((await restarted.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: recordingId })).revisions.length, 2)
  await restarted.invoke(RPC_CHANNELS.voice.HISTORY_DELETE, { id: recordingId })
  assert.equal((await restarted.invoke(RPC_CHANNELS.voice.HISTORY_LIST)).page.length, 0)
  const timeoutCapture = await restarted.invoke(RPC_CHANNELS.voice.START, { mimeType: 'audio/webm' })
  await restarted.invoke(RPC_CHANNELS.voice.GRANT)
  await restarted.invoke(RPC_CHANNELS.voice.CHUNK, { audioBase64 })
  behavior = 'defer'; pending = undefined
  const timedOut = restarted.invoke(RPC_CHANNELS.voice.STOP).then(value => ({ value }), error => ({ error }))
  const delayed = await awaitPending()
  assert('error' in await timedOut)
  const beforeLateResult = JSON.stringify(await restarted.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: timeoutCapture.recordingId }))
  // Simulate a provider which ignores cancellation and succeeds after timeout.
  delayed.resolve(result()); await tick()
  assert.equal(delayed.input.signal!.aborted, true)
  assert.equal(JSON.stringify(await restarted.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: timeoutCapture.recordingId })), beforeLateResult)
  assert.equal((await restarted.invoke(RPC_CHANNELS.voice.HISTORY_GET, { id: timeoutCapture.recordingId })).revisions.length, 0)
  // The timed-out capture releases the host and cannot block a new recording.
  const afterTimeout = await restarted.invoke(RPC_CHANNELS.voice.START, { mimeType: 'audio/ogg' })
  assert.notEqual(afterTimeout.jobId, timeoutCapture.jobId)
  await restarted.invoke(RPC_CHANNELS.voice.CANCEL)
  const c = client(second); behavior = 'defer'; pending = undefined
  const shutdownRequest = c.invoke(RPC_CHANNELS.voice.TRANSCRIBE, { audioBase64 }).catch(() => undefined)
  const inFlight = await awaitPending(); server.close(); await shutdownRequest
  assert.equal(inFlight.input.signal!.aborted, true)
  console.log('native voice isolation, real streamed ASR, consent, persistence, cancellation and revocation passed')
} finally {
  for (const c of clients) c.destroy()
  await tick(); server?.close(); authority.close()
}
