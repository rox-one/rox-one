import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../../authority/native-authority'
import { WsRpcServer } from '../../../../transport/server'
import { WsRpcClient } from '../../../../transport/client'
import { registerGamificationHandlers } from '../../gamification'
import { registerNotesHandlers } from '../../notes'
import { NativeJournal } from '../../../../authority/native-journal'
import { CollaborationSyncService } from '../../../../collaboration/sync-service'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { awardXp, loadGamificationState } from '@rox/shared/gamification'
import type { HandlerDeps } from '../../../handler-deps'

const checks: Array<{ name: string; passed: boolean }> = []
const check = (name: string, pass: boolean) => { checks.push({ name, passed: pass }); if (!pass) throw Error(name) }
const denied = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch { return true } }
const configDir = realpathSync(process.env.CRAFT_CONFIG_DIR!), state = join(configDir, 'authority')
let authority = new NativeAuthority({ stateDir: state })
const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); admin = authority.bootstrapLocalAdministrator('synthetic maintenance') }
finally { if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor); else Reflect.deleteProperty(process.stdin, 'isTTY') }
const ownRoot = join(configDir, 'own'), foreignRoot = join(configDir, 'foreign'); mkdirSync(ownRoot); mkdirSync(foreignRoot)
authority.registerWorkspace(admin.credential, 'own', ownRoot); authority.registerWorkspace(admin.credential, 'foreign', foreignRoot)
const enroll = (label: string) => {
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60000), label)
  assert(issued, 'Fixture enrollment must succeed')
  return issued
}
const alice = enroll('Alice'), bob = enroll('Bob')
for (const person of [alice, bob]) authority.grantWorkspace(admin.credential, person.principal.subject, 'own', ['read', 'subscribe'])
awardXp('session_completed'); const hostPath = join(configDir, 'gamification.json'), hostBefore = readFileSync(hostPath, 'utf8')
const clients: WsRpcClient[] = []
let server: WsRpcServer, journal: NativeJournal
const start = async () => {
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
    nativeEventChannels: new Set([RPC_CHANNELS.gamification.CHANGED]), nativeClientEventChannels: new Set([RPC_CHANNELS.gamification.CHANGED]) })
  journal = new NativeJournal({ stateDir: state, authorize: (principal,id,action,nativeRoot) => authority.authorize(principal,id,action,nativeRoot), permissionFence: (principal,id,action) => authority.permissionFence(principal,id,action), authorizePreparedRecovery: (principal,id,action,fence,nativeRoot) => authority.authorizePreparedRecovery(principal,id,action,fence,nativeRoot) })
  const deps = { nativeData: { authority, journal, sync: new CollaborationSyncService(authority,journal) }, platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } } } as unknown as HandlerDeps
  registerGamificationHandlers(server, deps)
  registerNotesHandlers(server, deps)
  await server.listen()
}
const connect = (person: typeof alice, workspaceId = 'own') => {
  const c = new WsRpcClient('ws://127.0.0.1:' + server.port, { token: person.credential, workspaceId, mode: 'remote', autoReconnect: false, requestTimeout: 1000, connectTimeout: 1000 })
  clients.push(c); c.connect(); return c
}
const stop = async () => { for (const c of clients.splice(0)) c.destroy(); await new Promise(resolve => setTimeout(resolve, 20)); server?.close(); journal?.close() }
try {
  await start(); let a = connect(alice), b = connect(bob); const aEvents: unknown[] = [], bEvents: unknown[] = []
  a.on(RPC_CHANNELS.gamification.CHANGED, payload => aEvents.push(payload)); b.on(RPC_CHANNELS.gamification.CHANGED, payload => bEvents.push(payload))
  const get = async (client: WsRpcClient) => await client.invoke(RPC_CHANNELS.gamification.GET) as any
  check('native-default-hides-host-xp', (await get(a)).xp === 0 && (await get(b)).xp === 0)
  const complete = await a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'first_note', principal: bob.principal, subject: bob.principal.subject, workspaceId: 'foreign' }) as any
  check('reward-completion-atomic', complete.xp === 15 && complete.questRecords.find((q: any) => q.id === 'first_note').status === 'completed' && complete.weeklyXp.current === 15)
  await new Promise(resolve => setTimeout(resolve, 25)); check('changed-is-caller-only', aEvents.length === 1 && (aEvents[0] as any).xp === 15 && bEvents.length === 0)
  check('actor-argument-spoof-ignored', (await get(b)).xp === 0)
  await a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'snooze', questId: 'first_note' }); await a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'dismiss', questId: 'first_note' })
  check('completed-snooze-replay-cannot-award-again', (await a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'first_note' }) as any).xp === 15)
  await Promise.all([a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'first_task' }), a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'first_task' })])
  check('concurrent-completion-is-once', (await get(a)).xp === 30)
  const later = await b.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'snooze', questId: 'first_link' }) as any
  check('snooze-persists-deadline', later.xp === 0 && later.questRecords.find((q: any) => q.id === 'first_link').snoozeUntil > Date.now())
  await b.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'dismiss', questId: 'first_workflow' })
  check('dismiss-terminal-no-reward', (await b.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'first_workflow' }) as any).xp === 0)
  await a.invoke(RPC_CHANNELS.gamification.SET_CONSENT, true)
  check('consent-actor-scoped', (await get(a)).analyticsConsent === true && (await get(b)).analyticsConsent === false)
  check('invalid-consent-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.SET_CONSENT, 'yes')))
  check('arbitrary-award-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.AWARD, 'session_completed')))
  check('global-rating-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.RATE, { sessionId: 'foreign-session', score: 100 })))
  check('foreign-workspace-denied', await denied(() => connect(alice, 'foreign').invoke(RPC_CHANNELS.gamification.GET)))
  check('unknown-quest-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'forged' })))
  check('host-state-byte-preserved', readFileSync(hostPath, 'utf8') === hostBefore && loadGamificationState().xp === 25)
  const storeDir = join(state, 'native-gamification'), storePath = join(storeDir, 'progress.sqlite')
  check('private-custody-modes', (statSync(storeDir).mode & 0o777) === 0o700 && (statSync(storePath).mode & 0o777) === 0o600)
  await stop(); authority.close(); authority = new NativeAuthority({ stateDir: state }); await start(); a = connect(alice); b = connect(bob)
  check('xp-and-completed-state-survive-restart', (await get(a)).xp === 30 && (await get(a)).questRecords.find((q: any) => q.id === 'first_task').status === 'completed')
  check('preferences-survive-restart', (await get(a)).analyticsConsent === true && (await get(b)).questRecords.find((q: any) => q.id === 'first_workflow').status === 'dismissed')
  authority.revokeWorkspaceGrant(admin.credential, alice.principal.subject, 'own')
  check('revoked-read-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.GET)))
  check('revoked-write-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.QUEST, { action: 'complete', questId: 'privacy_review' })))
  check('revoked-consent-denied', await denied(() => a.invoke(RPC_CHANNELS.gamification.SET_CONSENT, false)))
  authority.grantWorkspace(admin.credential, alice.principal.subject, 'own', ['read', 'subscribe']); a = connect(alice)
  check('denied-actions-do-not-mutate', (await get(a)).xp === 30 && (await get(a)).analyticsConsent === true)
  for (const person of [alice,bob]) authority.grantWorkspace(admin.credential,person.principal.subject,'own',['read','write','subscribe'])
  a=connect(alice); b=connect(bob)
  const create = async (client: WsRpcClient,title: string) => await client.invoke(RPC_CHANNELS.notes.CREATE,'own',title,undefined,{operationId:'create-'+title,expectedRevision:null,schemaVersion:1}) as any
  const source=await create(a,'Source'), target=await create(b,'Target'); await create(b,'Another')
  check('first-real-native-note-awards-once',(await get(b)).xp===15)
  check('real-native-note-auto-completes-quest',(await get(b)).questRecords.find((q:any)=>q.id==='first_note').status==='completed')
  check('manual-after-real-action-cannot-double-award',(await b.invoke(RPC_CHANNELS.gamification.QUEST,{action:'complete',questId:'first_note'}) as any).xp===15)
  let revision=source.nativeRevision
  const save=async(content:string,operationId:string)=>{const note=await a.invoke(RPC_CHANNELS.notes.SAVE,'own',source.id,content,undefined,{operationId,expectedRevision:revision,schemaVersion:1}) as any; revision=note.nativeRevision;return note}
  await save(source.content+'\n[[Target]]','link-target')
  check('real-canonical-edge-awards-and-completes-quest',(await get(a)).xp===40&&(await get(a)).questRecords.find((q:any)=>q.id==='first_link').status==='completed')
  await save(source.content+'\n\n[[Target|Renamed alias]]','link-alias')
  check('edge-line-and-alias-cannot-reaward',(await get(a)).xp===40)
  await save(source.content,'unlink-target');await save(source.content+'\n[[Target]]','relink-target')
  check('unlink-relink-receipt-dedupe',(await get(a)).xp===40)
  await save(source.content+'\n[[Target]]\n[[Missing note]]\n[[Source]]','unresolved-links')
  check('unresolved-or-self-edge-has-no-xp',(await get(a)).xp===40)
  const reader=enroll('read-only-note');authority.grantWorkspace(admin.credential,reader.principal.subject,'own',['read','subscribe']);const r=connect(reader)
  check('denied-product-action-awards-nothing',await denied(()=>create(r,'Denied'))&&(await get(r)).xp===0)
  await stop();authority.close();authority=new NativeAuthority({stateDir:state});await start();a=connect(alice);b=connect(bob)
  check('automatic-xp-and-host-isolation-survive-restart',(await get(a)).xp===40&&(await get(b)).xp===15&&readFileSync(hostPath,'utf8')===hostBefore)
  console.log(JSON.stringify(checks))
} finally { await stop(); authority.close() }
process.exit(0)
