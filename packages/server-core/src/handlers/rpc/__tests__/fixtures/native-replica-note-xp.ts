import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority, type NativeIssuedCredential } from '../../../../authority/native-authority'
import { NativeJournal } from '../../../../authority/native-journal'
import { CollaborationSyncService } from '../../../../collaboration/sync-service'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerGamificationHandlers } from '../../gamification'
import { registerNotesHandlers } from '../../notes'
import { registerNativeDataHandlers } from '../../native-data'
import { RPC_CHANNELS, type NativeDataMutationInput, type NativeDataReceipt, type NativeReplicaCreatePlan } from '@craft-agent/shared/protocol'
import { awardXp } from '@craft-agent/shared/gamification'
import type { HandlerDeps } from '../../../handler-deps'

const checks: Array<{ name: string; passed: boolean }> = []
const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw Error(name) }
const denied = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch { return true } }
const pause = () => new Promise(resolve => setTimeout(resolve, 25))
const directory = realpathSync(process.env.CRAFT_CONFIG_DIR!), stateDir = join(directory, 'authority')
let authority = new NativeAuthority({ stateDir })
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: NativeIssuedCredential
try { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); admin = authority.bootstrapLocalAdministrator('synthetic operator') }
finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
for (const id of ['own', 'foreign']) { const path = join(directory, id); mkdirSync(path); authority.registerWorkspace(admin.credential, id, path) }
const enroll = (label: string) => {
  const person = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60000), label)
  if (!person) throw Error('Fixture enrollment failed')
  return person
}
const alice = enroll('Alice'), bob = enroll('Bob'), recovered = enroll('Recoverable'), revoked = enroll('Revoked')
const reader = enroll('Reader'), subscriber = enroll('Subscriber')
for (const person of [alice, bob, recovered, revoked]) authority.grantWorkspace(admin.credential, person.principal.subject, 'own', ['read', 'write', 'subscribe'])
authority.grantWorkspace(admin.credential, reader.principal.subject, 'own', ['read', 'subscribe'])
authority.grantWorkspace(admin.credential, subscriber.principal.subject, 'own', ['subscribe'])
awardXp('session_completed')
const hostPath = join(directory, 'gamification.json'), hostBefore = readFileSync(hostPath, 'utf8')
// A deliberately unavailable optional XP store must not reject a committed canonical note.
const blockedStorePath = join(stateDir, 'native-gamification'); writeFileSync(blockedStorePath, 'unavailable optional store')
let server: WsRpcServer, journal: NativeJournal, revokeAfterCommit: string | undefined
const clients: WsRpcClient[] = []
const start = async () => {
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
    nativeEventChannels: new Set([RPC_CHANNELS.gamification.CHANGED]), nativeClientEventChannels: new Set([RPC_CHANNELS.gamification.CHANGED]) })
  journal = new NativeJournal({ stateDir,
    authorize: (principal, id, action, root) => authority.authorize(principal, id, action, root),
    permissionFence: (principal, id, action) => authority.permissionFence(principal, id, action),
    authorizePreparedRecovery: (principal, id, action, fence, root) => authority.authorizePreparedRecovery(principal, id, action, fence, root) })
  const sync = new CollaborationSyncService(authority, journal), commit = sync.commit.bind(sync)
  sync.commit = (principal, workspaceId, mutation) => {
    const receipt = commit(principal, workspaceId, mutation)
    if (revokeAfterCommit === principal.subject) {
      revokeAfterCommit = undefined
      authority.revokeWorkspaceGrant(admin.credential, principal.subject, workspaceId)
    }
    return receipt
  }
  const deps = { nativeData: { authority, journal, sync }, platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } } } as unknown as HandlerDeps
  registerNativeDataHandlers(server, deps); registerNotesHandlers(server, deps); registerGamificationHandlers(server, deps)
  await server.listen()
}
const connect = (person: NativeIssuedCredential, workspaceId = 'own') => {
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: person.credential, workspaceId,
    mode: 'remote', autoReconnect: false, requestTimeout: 1000, connectTimeout: 1000 })
  clients.push(client); client.connect(); return client
}
const stop = async () => { for (const client of clients.splice(0)) client.destroy(); await pause(); server?.close(); journal?.close() }
type Progress = { xp: number; questRecords: Array<{ id: string; status: string }> }
const get = async (client: WsRpcClient) => await client.invoke(RPC_CHANNELS.gamification.GET) as Progress
const prepare = async (client: WsRpcClient, title: string, operationId: string): Promise<NativeDataMutationInput> => {
  const plan = await client.invoke(RPC_CHANNELS.notes.PREPARE_CREATE, 'own', title) as NativeReplicaCreatePlan
  return { ...plan.mutation, workspaceId: 'own', kind: 'notes', operationId }
}
const mutate = async (client: WsRpcClient, mutation: NativeDataMutationInput) => await client.invoke(RPC_CHANNELS.nativeData.MUTATE, mutation) as NativeDataReceipt
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
try {
  await start()
  let recoveryClient = connect(recovered)
  const recoveryMutation = await prepare(recoveryClient, 'Recovery note', 'recover-create')
  const recoveryReceipt = await mutate(recoveryClient, recoveryMutation)
  check('xp-store-failure-keeps-accepted-canonical-receipt', recoveryReceipt.revision === 1 && recoveryReceipt.operationId === 'recover-create')
  check('xp-store-failure-keeps-note-bytes', readFileSync(join(directory, 'own', recoveryMutation.changes[0]!.path), 'utf8') === recoveryMutation.changes[0]!.content)
  rmSync(blockedStorePath)
  check('unavailable-xp-did-not-fall-back-to-host', (await get(recoveryClient)).xp === 0 && readFileSync(hostPath, 'utf8') === hostBefore)
  const recoveryRetry = await mutate(recoveryClient, recoveryMutation)
  check('accepted-exact-retry-keeps-original-receipt', same(recoveryReceipt, recoveryRetry))
  check('accepted-retry-recovers-only-missing-reward', (await get(recoveryClient)).xp === 15)
  let a = connect(alice), b = connect(bob)
  const aEvents: unknown[] = [], bEvents: unknown[] = []
  a.on(RPC_CHANNELS.gamification.CHANGED, event => aEvents.push(event)); b.on(RPC_CHANNELS.gamification.CHANGED, event => bEvents.push(event))
  const mutation = await prepare(a, 'Actual replica note', 'actual-replica-create')
  await prepare(b, 'Cancelled before enqueue', 'never-submitted')
  check('prepare-and-abandoned-create-award-zero', (await get(a)).xp === 0 && (await get(b)).xp === 0)
  const receipt = await mutate(a, mutation)
  check('actual-canonical-create-awards-15', (await get(a)).xp === 15)
  check('actual-canonical-create-completes-first-note', (await get(a)).questRecords.find(quest => quest.id === 'first_note')?.status === 'completed')
  check('receipt-retains-exact-private-identity', receipt.subject === alice.principal.subject && receipt.issuer === alice.principal.issuer && receipt.workspaceId === 'own' && receipt.nativeId === mutation.nativeId && receipt.operationId === mutation.operationId)
  check('receipt-projection-adds-no-xp-or-private-storage-path', Object.keys(receipt).sort().join(',') === 'contentHash,deleted,issuer,kind,nativeId,operationId,revision,sequence,subject,workspaceId' && !JSON.stringify(receipt).includes(directory))
  await pause()
  check('xp-change-event-is-caller-only', aEvents.length === 1 && bEvents.length === 0 && (aEvents[0] as Progress).xp === 15)
  const retry = await mutate(a, mutation)
  check('exact-retry-does-not-change-receipt-or-xp', same(receipt, retry) && (await get(a)).xp === 15)
  check('operation-id-reuse-is-denied', await denied(() => mutate(a, { ...mutation, changes: [{ path: mutation.changes[0]!.path, content: 'different payload' }] })))
  await mutate(a, await prepare(a, 'Second actual note', 'second-create'))
  await mutate(a, { ...mutation, expectedRevision: 1, operationId: 'actual-replica-edit', changes: [{ path: mutation.changes[0]!.path, content: '# Updated note\n' }] })
  check('second-note-and-update-never-reaward-first-note', (await get(a)).xp === 15)
  await b.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: 'own', kind: 'notes', nativeId: mutation.nativeId })
  await b.invoke(RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: 'own', afterSequence: 0 })
  check('read-and-pull-never-award-observer', (await get(b)).xp === 0)
  const asset = { workspaceId: 'own', kind: 'notes' as const, nativeId: 'asset', operationId: 'asset-create', expectedRevision: null, schemaVersion: 1 as const, changes: [{ path: 'notes/assets/asset.bin', content: 'asset bytes' }] }
  await mutate(b, asset)
  check('non-markdown-file-create-is-not-note-xp', (await get(b)).xp === 0)
  const readerClient = connect(reader), subscriberClient = connect(subscriber)
  check('read-only-mutation-denied-with-zero-xp', await denied(() => mutate(readerClient, { ...mutation, operationId: 'reader-denied' })) && (await get(readerClient)).xp === 0)
  check('subscription-only-mutation-denied', await denied(() => mutate(subscriberClient, { ...mutation, operationId: 'subscriber-denied' })))
  authority.grantWorkspace(admin.credential, subscriber.principal.subject, 'own', ['read', 'subscribe'])
  check('subscription-only-denial-did-not-award-xp', (await get(connect(subscriber))).xp === 0)
  check('foreign-workspace-mutation-denied', await denied(() => mutate(b, { ...mutation, workspaceId: 'foreign', operationId: 'foreign-denied' })))
  check('unknown-entity-kind-mutation-denied', await denied(() => mutate(b, { ...mutation, kind: 'tasks' as 'notes', operationId: 'kind-denied' })))
  let revokedClient = connect(revoked)
  const revokedMutation = await prepare(revokedClient, 'Revoked after commit', 'revoked-create')
  const revokedEvents: unknown[] = []; revokedClient.on(RPC_CHANNELS.gamification.CHANGED, event => revokedEvents.push(event))
  revokeAfterCommit = revoked.principal.subject
  check('postcommit-revocation-withholds-stale-response', await denied(() => mutate(revokedClient, revokedMutation)))
  authority.grantWorkspace(admin.credential, revoked.principal.subject, 'own', ['read', 'subscribe']); revokedClient = connect(revoked)
  check('postcommit-revocation-awards-no-xp-or-event', (await get(revokedClient)).xp === 0 && revokedEvents.length === 0)
  const persistedAfterRevocation = await revokedClient.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: 'own', kind: 'notes', nativeId: revokedMutation.nativeId }) as { revision: number }
  check('accepted-note-is-preserved-after-postcommit-revocation', persistedAfterRevocation.revision === 1)
  check('other-actors-and-host-remain-unchanged', (await get(b)).xp === 0 && readFileSync(hostPath, 'utf8') === hostBefore)
  await stop(); authority.close(); authority = new NativeAuthority({ stateDir }); await start()
  a = connect(alice); b = connect(bob); recoveryClient = connect(recovered)
  check('xp-and-quest-persist-across-server-restart', (await get(a)).xp === 15 && (await get(a)).questRecords.find(quest => quest.id === 'first_note')?.status === 'completed')
  check('create-retry-after-later-edit-and-restart-retains-original-receipt', same(await mutate(a, mutation), receipt))
  await mutate(recoveryClient, recoveryMutation)
  check('restart-replay-never-rewards-again-or-changes-other-actor', (await get(a)).xp === 15 && (await get(recoveryClient)).xp === 15 && (await get(b)).xp === 0 && readFileSync(hostPath, 'utf8') === hostBefore)
  console.log(JSON.stringify(checks))
} finally { await stop(); authority.close() }
process.exit(0)
