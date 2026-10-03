import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeLaunch } from '@rox/core/runtime-trace'
import type { PendingPrompt } from '@rox/shared/automations'
import type { ExecutePromptAutomationInput, ISessionManager } from '../../../session-manager-interface'
import type { HandlerDeps } from '../../../handler-deps'
import type { RpcServer, RequestContext } from '../../../../transport/types'
import type { SessionCompletionEvent } from '../../../../sessions/SessionManager'

const directory = process.env.ROX_CONFIG_DIR!
const workspace = join(directory, 'workspace')
mkdirSync(workspace, { recursive: true })
writeFileSync(join(directory, 'config.json'), JSON.stringify({ workspaces: [{ id: 'launch-workspace', name: 'Launch fixture', rootPath: workspace }] }))
const { RPC_CHANNELS } = await import('@rox/shared/protocol')
const { registerTasksHandlers } = await import('../../tasks')
const { registerAutomationsHandlers } = await import('../../automations')
const { SessionManager } = await import('../../../../sessions/SessionManager')
const { RuntimeTraceService } = await import('../../../../sessions/runtime-trace/service')
const { isRuntimeEvent } = await import('@rox/core/runtime-trace')
const { nativeRuntimeTraceEvent, nativeRuntimeTraceRunSummary } = await import('../../native-session-scope')
const privatePath = join(workspace, 'host-generator-template.txt')
writeFileSync(privatePath, 'Isolated private generator template')
const handlers = new Map<string, (context: RequestContext, ...args: unknown[]) => unknown>()
const listeners = new Set<(event: SessionCompletionEvent) => void>()
const sends: Parameters<ISessionManager['sendMessage']>[] = []
const automationInputs: ExecutePromptAutomationInput[] = []
const trace = new RuntimeTraceService(id => ({ id, workspaceId: 'launch-workspace', directory: join(workspace, 'sessions', id) }), () => {})
let generatedResolve!: () => void
const generated = new Promise<void>(resolve => { generatedResolve = resolve })
const server = { handle(channel: string, handler: (context: RequestContext, ...args: unknown[]) => unknown) { handlers.set(channel, handler) },
  push(channel: string) { if (channel === RPC_CHANNELS.tasks.GENERATED) generatedResolve() } } as unknown as RpcServer
const yaml = 'id: launch-fixture\ntitle: Launch fixture\ngoal: Isolated authoring\ndefaults:\n  permissionMode: safe\nnodes:\n  - id: first\n    prompt: Produce a result\n'
const sessionManager = {
  async createSession() { return { id: 'actual-draft-session' } },
  onSessionComplete(listener: (event: SessionCompletionEvent) => void) { listeners.add(listener); return () => listeners.delete(listener) },
  getSessionFinalText() { return undefined },
  async sendMessage(...args: Parameters<ISessionManager['sendMessage']>) {
    sends.push(args)
    await trace.begin(args[0], args[1], { messageId: `generated-${sends.length}`, launch: args[8]?.runtimeLaunch })
    // The first isolated executor result is invalid, so the actual RPC enters its repair loop.
    for (const listener of [...listeners]) listener({ sessionId: args[0], workspaceId: 'launch-workspace', reason: 'complete', finalText: sends.length === 1 ? 'invalid generated spec' : yaml })
  },
  async executePromptAutomation(input: ExecutePromptAutomationInput) {
    automationInputs.push(input)
    const sessionId = `automation-test-${automationInputs.length}`
    await trace.begin(sessionId, input.prompt, { messageId: sessionId, launch: input.runtimeLaunch })
    return { sessionId }
  },
}
const deps = { sessionManager, platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } } } as unknown as HandlerDeps
registerTasksHandlers(server, deps)
registerAutomationsHandlers(server, deps)
const caller: RequestContext = { clientId: 'isolated-handler-client', workspaceId: 'launch-workspace', webContentsId: null }
const generate = handlers.get(RPC_CHANNELS.tasks.GENERATE)!
await generate(caller, 'launch-workspace', { goal: `Use ${privatePath}` })
await generated
assert.equal(sends.length, 2, 'The actual handler must complete its authoring and automatic repair dispatches')
for (const args of sends) assert.deepEqual(args[8]?.runtimeLaunch, { kind: 'unknown', triggerId: 'task-draft:actual-draft-session' })
const automationTest = handlers.get(RPC_CHANNELS.automations.TEST)!
await automationTest(caller, { workspaceId: 'launch-workspace', automationId: 'saved-automation-id', actions: [{ type: 'prompt', prompt: `Host prompt ${privatePath}` }] })
assert.deepEqual(automationInputs[0]?.runtimeLaunch, { kind: 'unknown', triggerId: 'saved-automation-id' })
await automationTest(caller, { workspaceId: 'launch-workspace', actions: [{ type: 'prompt', prompt: `Unidentified host prompt ${privatePath}` }] })
assert.deepEqual(automationInputs[1]?.runtimeLaunch, { kind: 'unknown', triggerId: undefined })
for (const sessionId of ['actual-draft-session', 'automation-test-1', 'automation-test-2']) {
  const snapshot = await trace.getSnapshot({ workspaceId: 'launch-workspace', sessionId })
  for (const event of snapshot.events.filter(event => event.kind === 'run.accepted')) {
    const projected = nativeRuntimeTraceEvent(event)
    assert.equal(isRuntimeEvent(projected), true)
    assert.equal(projected.kind === 'run.accepted' && projected.payload.prompt.availability, 'redacted')
    assert.equal(JSON.stringify(projected).includes(privatePath), false)
  }
  assert.equal(snapshot.runs.map(run => nativeRuntimeTraceRunSummary(run, snapshot.events)).some(run => run.prompt.includes(privatePath)), false)
}
const manager = Object.create(SessionManager.prototype) as InstanceType<typeof SessionManager>
const permissionSwitches: Array<[string, string]> = []
const approvalDispatches: Parameters<typeof manager.sendMessage>[] = []
Object.assign(manager, { roxExecutions: new Map(), nativeMemoryContexts: new Map(), sessions: new Map(['channel-approval', 'manual-approval'].map(id => [id, { id, permissionMode: 'safe' }])),
  setSessionPermissionMode(id: string, mode: string) { permissionSwitches.push([id, mode]) },
  async sendMessage(...args: Parameters<typeof manager.sendMessage>) { approvalDispatches.push(args) },
})
const channelLaunch: RuntimeLaunch = { kind: 'channel', triggerId: 'actual-button-message', channel: { kind: 'channel-identity', id: 'actual-binding-id', label: 'telegram', scope: 'session' } }
await manager.acceptPlan('channel-approval', undefined, channelLaunch)
await manager.acceptPlan('manual-approval')
assert.deepEqual(permissionSwitches, [['channel-approval', 'allow-all'], ['manual-approval', 'allow-all']])
assert.deepEqual(approvalDispatches[0]?.[8]?.runtimeLaunch, channelLaunch)
assert.equal(approvalDispatches[1]?.[8], undefined, 'Desktop/manual approval keeps its original entry point provenance')
const launch = (pending: Pick<PendingPrompt, 'scheduledAt' | 'scheduledTimezone' | 'matcherId' | 'occurrenceKey'>): RuntimeLaunch =>
  (manager as unknown as { runtimeLaunchForAutomationPrompt(value: Pick<PendingPrompt, 'scheduledAt' | 'scheduledTimezone' | 'matcherId' | 'occurrenceKey'>): RuntimeLaunch }).runtimeLaunchForAutomationPrompt(pending)
// The two actual UTC instants of a DST overlap remain distinct in one scheduler timezone.
for (const scheduledAt of ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']) {
  const before = Date.now()
  const observed = launch({ scheduledAt, scheduledTimezone: 'America/New_York', matcherId: 'dst-matcher', occurrenceKey: `dst-matcher:${scheduledAt}:0` })
  assert.equal(observed.kind, 'scheduled')
  assert.equal(observed.timezone, 'America/New_York')
  assert.deepEqual(observed.scheduledAt, { state: 'known', value: Date.parse(scheduledAt), origin: 'observed', source: 'automation-scheduler' })
  assert.equal(observed.dispatchedAt?.state, 'known')
  if (observed.dispatchedAt?.state === 'known') {
    assert.ok(observed.dispatchedAt.value >= before && observed.dispatchedAt.value <= Date.now())
    assert.equal(observed.dispatchedAt.source, 'automation-dispatch')
  }
  assert.equal(observed.occurrenceId, `dst-matcher:${scheduledAt}:0`)
  const run = await trace.begin(`scheduled-${scheduledAt}`, 'Observed scheduler action', { launch: observed })
  const snapshot = await trace.getSnapshot({ workspaceId: 'launch-workspace', sessionId: run.sessionId })
  const accepted = snapshot.events.find(event => event.kind === 'run.accepted')
  assert.deepEqual(accepted?.kind === 'run.accepted' && accepted.payload.launch, observed)
}
for (const pending of [{}, { scheduledAt: 'invalid schedule instant' }, { scheduledAt: '1969-12-31T23:59:59.000Z' }]) {
  const observed = launch(pending)
  assert.equal(observed.kind, 'unknown')
  assert.equal(observed.scheduledAt?.state, 'unknown')
  assert.equal(observed.timezone, undefined)
}
console.log('runtime launch producer fixtures passed')
process.exit(0)
