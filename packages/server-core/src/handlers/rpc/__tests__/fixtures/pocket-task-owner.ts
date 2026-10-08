import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HandlerDeps } from '../../../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../../../transport/types'
import type { SessionCompletionEvent } from '../../../../sessions/SessionManager'
import type { ConductorSessionHost } from '../../../../tasks/TaskRunner'
import type { ISessionManager } from '../../../session-manager-interface'
import type { RoxExecutionContext } from '@rox/shared/auth'

const { saveConfig } = await import('@rox/shared/config')
const workspace = join(process.env.ROX_CONFIG_DIR!, 'workspace')
mkdirSync(workspace)
saveConfig({ workspaces: [{ id: 'canonical-workspace', slug: 'canonical-workspace', name: 'Workspace alias', rootPath: workspace, createdAt: 1 }], activeWorkspaceId: 'canonical-workspace', activeSessionId: null })
const { createPocketFixture, pocketSnapshot } = await import('@rox/shared/auth/__tests__/pocket-test-fixture')
const { RoxAccountAuthority, setRoxAccountAuthority } = await import('@rox/shared/auth')
const f = createPocketFixture()
setRoxAccountAuthority(f.authority)
const a = { issuer: 'https://native.fixture.test', subject: 'a' }, b = { issuer: 'https://native.fixture.test', subject: 'b' }
f.client.account = async token => pocketSnapshot(token)
f.client.credential = async (_token, state) => ({ accountId: state.user.id, keyId: state.key!.id, generation: 1, apiKey: 'isolated-fixture-key', baseUrl: 'https://api.rox.one/v1' })
for (const [caller, id] of [[a, 'account-a'], [b, 'account-b']] as const) await f.store.write(caller, { accountId: id, authGeneration: `generation-${id}`, accessToken: id, refreshToken: `fixture-refresh-${id}`, expiresAt: Date.now() + 900_000 })
const ownerA = await f.authority.capture(a), ownerB = await f.authority.capture(b)
const context = (caller: typeof a): RequestContext => ({ clientId: `fixture-${caller.subject}`, workspaceId: 'canonical-workspace', webContentsId: null,
  principal: { ...caller, credentialId: `fixture-credential-${caller.subject}`, credentialVersion: 1 } })
const realBackend = await import('@rox/shared/agent/backend')
const backendOwners: RoxExecutionContext[] = []
const connection = { slug: 'fixture', name: 'Fixture', providerType: 'omp' as const, authType: 'none' as const, defaultModel: 'rox/standard' }
mock.module('@rox/shared/agent/backend', () => ({ ...realBackend,
  resolveOmpSessionContext: () => ({ connection, resolvedModel: 'rox/standard', provider: 'omp', capabilities: realBackend.BACKEND_CAPABILITIES.omp }),
  createOmpSessionBackendFromResolvedContext: (options: Parameters<typeof realBackend.createOmpSessionBackendFromResolvedContext>[0]) => {
    const execution = options.coreConfig.roxExecutionContext
    assert.ok(execution, 'The actual backend factory must receive the initiating RPC owner')
    f.authority.assertCurrent(execution)
    backendOwners.push(execution)
    // This isolated executor boundary makes no provider request or native-loop claim.
    throw new Error('ISOLATED_STOP_BEFORE_PROVIDER')
  },
}))
const { SessionManager, setSessionPlatform } = await import('../../../../sessions/SessionManager')
setSessionPlatform({ appRootPath: workspace, resourcesPath: workspace, isPackaged: false, appVersion: 'fixture', isDebugMode: false,
  imageProcessor: { getMetadata: async () => null, process: async () => Buffer.alloc(0) }, logger: { info() {}, warn() {}, error() {}, debug() {} } })
const manager = new SessionManager()
const factoryBoundaryErrors: unknown[] = []
manager.setEventSink((_channel, _target, event) => { if (event?.type === 'error' || event?.type === 'typed_error') factoryBoundaryErrors.push(event) })
const { RPC_CHANNELS } = await import('@rox/shared/protocol')
const { registerTasksHandlers } = await import(process.env.ROX_TASK_OWNER_NEGATIVE_CONTROL ? '../../.task-owner-before' : '../../tasks')
const handlers = new Map<string, HandlerFn>()
let generatedResolve!: () => void
const generated = new Promise<void>(resolve => { generatedResolve = resolve })
let generatedResult: unknown
const server = { handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) }, push(channel: string, _target: unknown, ...result: unknown[]) { if (channel === RPC_CHANNELS.tasks.GENERATED) { generatedResult = result; generatedResolve() } } } as unknown as RpcServer
const logger = { info() {}, warn() {}, error() {}, debug() {} }
registerTasksHandlers(server, { sessionManager: manager, platform: { logger } } as unknown as HandlerDeps)
await handlers.get(RPC_CHANNELS.tasks.GENERATE)!(context(a), 'Workspace alias', { goal: 'Isolated owner draft', model: 'rox/standard' })
await generated
assert.equal(backendOwners.length, 1, `The production generation must reach the actual factory: ${JSON.stringify({factoryBoundaryErrors, generatedResult})}`)
assert.deepEqual(backendOwners.map(owner => owner.cloudAccountId), ['account-a'])
assert.deepEqual(backendOwners.map(owner => owner.caller), [a])
console.log('actual task authoring factory owner capture passed')

// The runner fixtures below use the existing authority and real durable task files. Only
// session execution is injected; no account or native permission guard is replaced.
const { TaskRunner } = await import('../../../../tasks/TaskRunner')
const { parseTaskSpec, saveTaskSpec, appendRunLog, readRunLog } = await import('@rox/shared/tasks')
const parsed = parseTaskSpec({ id: 'owner-task', title: 'Owner task', goal: 'owner proof', defaults: { permissionMode: 'safe', model: 'rox/standard' }, nodes: [{ id: 'first', prompt: 'Produce an isolated result' }] })
assert.equal(parsed.success, true)
if (!parsed.success) throw new Error('invalid fixture task')
saveTaskSpec(workspace, parsed.data)
class OwnerHost implements ConductorSessionHost {
  readonly sends: Parameters<ISessionManager['sendMessage']>[] = []
  readonly listeners = new Set<(event: SessionCompletionEvent) => void>()
  createCount = 0
  createBarrier?: () => Promise<void>
  async createSession() { this.createCount++; await this.createBarrier?.(); return { id: `fixture-child-${this.createCount}` } }
  async sendMessage(...args: Parameters<ISessionManager['sendMessage']>) {
    const execution = args[8]?.roxExecutionContext
    assert.ok(execution)
    const currentAuthority = (await import('@rox/shared/auth')).getRoxAccountAuthority()
    currentAuthority.assertCurrent(execution)
    await currentAuthority.bind(`session:canonical-workspace:${args[0]}`, execution)
    this.sends.push(args)
  }
  async setSessionStatus() {}
  async setKanbanColumn() {}
  async setTaskNodeCount() {}
  async cancelProcessing() {}
  onSessionComplete(listener: (event: SessionCompletionEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSessionFinalText() { return undefined }
  getSessionWorkingDirectory() { return workspace }
  complete(sessionId: string, finalText: string) { for (const listener of [...this.listeners]) listener({ sessionId, workspaceId: 'canonical-workspace', reason: 'complete', finalText }) }
}
const waitFor = async (predicate: () => boolean) => { for (let i = 0; i < 300; i++) { if (predicate()) return; await Bun.sleep(1) } throw new Error('Fixture did not settle') }
const repairHost = new OwnerHost()
const repairSend = repairHost.sendMessage.bind(repairHost)
repairHost.sendMessage = async (...args: Parameters<ISessionManager['sendMessage']>) => {
  await repairSend(...args)
  repairHost.complete(args[0], repairHost.sends.length === 1 ? 'invalid fixture spec' : 'id: authored-task\ntitle: Authored task\ngoal: Isolated fixture\ndefaults:\n  permissionMode: safe\nnodes:\n  - id: first\n    prompt: Isolated result\n')
}
const repairHandlers = new Map<string, HandlerFn>()
let repairedResolve!: () => void
const repaired = new Promise<void>(resolve => { repairedResolve = resolve })
registerTasksHandlers({ handle(channel: string, handler: HandlerFn) { repairHandlers.set(channel, handler) }, push(channel: string) { if (channel === RPC_CHANNELS.tasks.GENERATED) repairedResolve() } } as unknown as RpcServer,
  { sessionManager: repairHost, platform: { logger } } as unknown as HandlerDeps)
await repairHandlers.get(RPC_CHANNELS.tasks.GENERATE)!(context(a), 'canonical-workspace', { goal: 'Isolated repair' })
await repaired
assert.equal(repairHost.sends.length, 2)
assert.deepEqual(repairHost.sends.map(args => args[8]?.roxExecutionContext), [ownerA, ownerA])
assert.ok(repairHost.sends.every(args => args[8]?.runtimeLaunch?.kind === 'unknown'))
const host = new OwnerHost()
await f.authority.bind('session:canonical-workspace:orchestrator-a', ownerA)
const runner = new TaskRunner({ workspaceId: 'canonical-workspace', workspaceRoot: workspace, host })
runner.run('owner-task', { runId: 'owned-run', orchestratorSessionId: 'orchestrator-a', roxExecutionContext: ownerA })
await waitFor(() => host.sends.length === 1)
assert.deepEqual(await f.store.readBinding('task-run:canonical-workspace:owner-task:owned-run'), { caller: a, accountId: 'account-a', authGeneration: 'generation-account-a' })
assert.deepEqual(host.sends[0]![8]?.roxExecutionContext, ownerA)
assert.equal(host.sends[0]![8]?.runtimeLaunch?.kind, 'delegated')
host.complete(host.sends[0]![0], 'actual injected child completion')
await waitFor(() => host.sends.length === 2)
assert.deepEqual(host.sends[1]![8]?.roxExecutionContext, ownerA)
assert.equal(host.sends[1]![8]?.runtimeLaunch?.kind, 'unknown')
host.complete('orchestrator-a', 'VERDICT: PASS')
assert.equal((await runner.waitUntilSettled('owner-task', 'owned-run')).status, 'completed')
assert.ok(readRunLog(workspace, 'owner-task', 'owned-run').some(entry => entry.kind === 'run-completed'))

let releaseCreate!: () => void
const barrier = new Promise<void>(resolve => { releaseCreate = resolve })
const delayed = new OwnerHost()
delayed.createBarrier = () => barrier
const deferred = new TaskRunner({ workspaceId: 'canonical-workspace', workspaceRoot: workspace, host: delayed })
deferred.run('owner-task', { runId: 'deferred-run', verifyOnComplete: false, roxExecutionContext: ownerA })
await waitFor(() => delayed.createCount === 1)
await f.authority.logout(a)
releaseCreate()
const revoked = await deferred.waitUntilSettled('owner-task', 'deferred-run')
assert.equal(delayed.sends.length, 0, 'Logout during actual child creation must prevent model delivery')
assert.equal(revoked.status, 'failed')
assert.ok(readRunLog(workspace, 'owner-task', 'deferred-run').some(entry => entry.kind === 'node-finished' && entry.reason?.includes('ROX_ACCOUNT_CHANGED')))

// Restore the original record, then use a new authority instance and new runner. The
// exact sealed task-run owner survives; mutable parent bindings cannot replace it.
await f.store.write(a, { accountId: 'account-a', authGeneration: 'generation-account-a', accessToken: 'account-a', refreshToken: 'fixture-refresh-account-a', expiresAt: Date.now() + 900_000 })
const restoredAuthority = new RoxAccountAuthority(f.store, f.client)
setRoxAccountAuthority(restoredAuthority)
const restoredA = await restoredAuthority.capture(a), restoredB = await restoredAuthority.capture(b)
await restoredAuthority.bind('task-run:canonical-workspace:owner-task:restart-run', restoredA)
appendRunLog(workspace, 'owner-task', 'restart-run', { t: new Date().toISOString(), kind: 'run-started', taskId: 'owner-task', runId: 'restart-run', orchestratorSessionId: 'mutable-parent' })
appendRunLog(workspace, 'owner-task', 'restart-run', { t: new Date().toISOString(), kind: 'run-paused' })
await restoredAuthority.bind('session:canonical-workspace:mutable-parent', restoredB)
const resumedHost = new OwnerHost()
const resumed = new TaskRunner({ workspaceId: 'canonical-workspace', workspaceRoot: workspace, host: resumedHost })
resumed.resume('owner-task', 'restart-run', restoredA)
await waitFor(() => resumedHost.sends.length === 1)
assert.deepEqual(resumedHost.sends[0]![8]?.roxExecutionContext, restoredA)
await resumed.stop('owner-task', 'restart-run')

const rpcHost = new OwnerHost()
const resumeHandlers = new Map<string, HandlerFn>()
registerTasksHandlers({ handle(channel: string, handler: HandlerFn) { resumeHandlers.set(channel, handler) } } as unknown as RpcServer,
  { sessionManager: rpcHost, platform: { logger } } as unknown as HandlerDeps)
await resumeHandlers.get(RPC_CHANNELS.tasks.RUN)!(context(a), 'Workspace alias', { slug: 'owner-task', runId: 'rpc-owned-run', orchestratorSessionId: 'rpc-orchestrator' })
await waitFor(() => rpcHost.sends.length === 1)
assert.deepEqual(rpcHost.sends[0]![8]?.roxExecutionContext, restoredA)
assert.deepEqual(await f.store.readBinding('task-run:canonical-workspace:owner-task:rpc-owned-run'), { caller: a, accountId: 'account-a', authGeneration: 'generation-account-a' })
await assert.rejects(() => resumeHandlers.get(RPC_CHANNELS.tasks.RUN)!(context(a), 'canonical-workspace', { slug: 'owner-task', runId: 'alias-duplicate', orchestratorSessionId: 'rpc-orchestrator' }), /already has an active run/)
await assert.rejects(() => resumeHandlers.get(RPC_CHANNELS.tasks.RUN)!(context(b), 'canonical-workspace', { slug: 'owner-task', runId: 'foreign-run', orchestratorSessionId: 'rpc-orchestrator' }), /ROX_SESSION_OWNER_CONFLICT/)
assert.equal(rpcHost.createCount, 1)
await resumeHandlers.get(RPC_CHANNELS.tasks.STOP)!(context(a), 'canonical-workspace', 'owner-task', 'rpc-owned-run')
const createsBeforeDeniedResume = rpcHost.createCount
await assert.rejects(() => resumeHandlers.get(RPC_CHANNELS.tasks.RESUME)!(context(b), 'Workspace alias', 'owner-task', 'restart-run'), /ROX_SESSION_OWNER_CONFLICT/)
assert.equal(rpcHost.createCount, createsBeforeDeniedResume)
assert.deepEqual(await f.store.readBinding('task-run:canonical-workspace:owner-task:restart-run'), { caller: a, accountId: 'account-a', authGeneration: 'generation-account-a' })
appendRunLog(workspace, 'owner-task', 'legacy-run', { t: new Date().toISOString(), kind: 'run-started', taskId: 'owner-task', runId: 'legacy-run', orchestratorSessionId: 'mutable-parent' })
appendRunLog(workspace, 'owner-task', 'legacy-run', { t: new Date().toISOString(), kind: 'run-paused' })
await assert.rejects(() => resumeHandlers.get(RPC_CHANNELS.tasks.RESUME)!(context(a), 'canonical-workspace', 'owner-task', 'legacy-run'), /ROX_TASK_RUN_OWNER_UNKNOWN/)
const legacy = new TaskRunner({ workspaceId: 'canonical-workspace', workspaceRoot: workspace, host: rpcHost })
legacy.resume('owner-task', 'legacy-run')
const legacyResult = await legacy.waitUntilSettled('owner-task', 'legacy-run')
assert.equal(legacyResult.status, 'failed')
assert.equal(rpcHost.createCount, createsBeforeDeniedResume)
assert.ok(readRunLog(workspace, 'owner-task', 'legacy-run').some(entry => entry.kind === 'node-finished' && entry.reason?.includes('ROX_TASK_RUN_OWNER_UNKNOWN')))
// A new same-caller credential generation cannot acquire a sealed old run.
await f.store.write(a, { accountId: 'account-a', authGeneration: 'rotated-generation-a', accessToken: 'account-a', refreshToken: 'fixture-rotated-refresh', expiresAt: Date.now() + 900_000 })
const rotatedAuthority = new RoxAccountAuthority(f.store, f.client)
setRoxAccountAuthority(rotatedAuthority)
await assert.rejects(() => resumeHandlers.get(RPC_CHANNELS.tasks.RESUME)!(context(a), 'canonical-workspace', 'owner-task', 'restart-run'), /ROX_ACCOUNT_CHANGED/)
assert.equal(rpcHost.createCount, createsBeforeDeniedResume)
assert.deepEqual(await f.store.readBinding('task-run:canonical-workspace:owner-task:restart-run'), { caller: a, accountId: 'account-a', authGeneration: 'generation-account-a' })
await assert.rejects(() => resumeHandlers.get(RPC_CHANNELS.tasks.RESUME)!(context(a), 'canonical-workspace', 'owner-task:other', 'restart-run'), /Invalid path segment/)
console.log('pocket task owner fixtures passed')
process.exit(0)
