import { strict as assert } from 'node:assert'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RuntimeTraceService, type RuntimeTraceSession } from './service'
import { createSession, loadSession, saveSession, getSessionPath, getSessionFilePath } from '@rox/shared/sessions'
import type { StoredMessage, StoredSession } from '@rox/shared/sessions'
import type { RuntimeEvent } from '@rox/core/runtime-trace'

const workspace = process.env.ROX_CONFIG_DIR!
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
const storedMessage = (id: string, type: StoredMessage['type'], content: string, timestamp: number): StoredMessage => ({ id, type, content, timestamp })
const sessions = new Map<string, RuntimeTraceSession>()
const emitted: RuntimeEvent[] = []
let trace = new RuntimeTraceService(id => sessions.get(id), event => emitted.push(event))
const register = (session: { id: string; parentSessionId?: string }) => sessions.set(session.id, { id: session.id, parentSessionId: session.parentSessionId, workspaceId: 'ws-test', directory: getSessionPath(workspace, session.id) })

if (process.argv[2] === 'legacy') {
  const session = await createSession(workspace, { name: 'Existing pre-trace session', model: 'rox/r1-max' })
  register(session)
  const stored: StoredSession = { ...session, messages: [storedMessage('old-user', 'user', 'Existing request', 10), storedMessage('old-answer', 'assistant', 'Existing answer', 20)], tokenUsage: usage }
  await saveSession(stored)
  const path = getSessionFilePath(workspace, session.id)
  const original = await readFile(path, 'utf8')
  assert.equal((await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: session.id })).coverage.state, 'unavailable')
  const run = await trace.begin(session.id, 'New observed request')
  await trace.publishMessage(session.id, 'new-trace-answer', 'Observed response')
  await trace.finish(session.id, 'complete')
  assert.ok((await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: session.id })).events.some(event => event.kind === 'result.published'))
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual(loadSession(workspace, session.id)?.messages, stored.messages)
  // Rollback simulation removes only the new sidecar in this isolated fixture.
  await rm(join(getSessionPath(workspace, session.id), 'meta', 'runtime-trace', run.rootRunId), { recursive: true })
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual(loadSession(workspace, session.id)?.messages, stored.messages)
  assert.equal((await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: session.id })).coverage.state, 'unavailable')
} else if (process.argv[2] === 'system-dispatch') {
  const { SessionManager } = await import('../SessionManager')
  const { nativeRuntimeTraceEvent, nativeRuntimeTraceRunSummary } = await import('../../handlers/rpc/native-session-scope')
  const session = await createSession(workspace, { name: 'System dispatch owner' })
  register(session)
  const privatePath = join(workspace, 'private-generated-host-path')
  await writeFile(privatePath, 'Isolated fixture host data')
  const managed = { ...session, workspace: { id: 'ws-test', name: 'Fixture', rootPath: workspace }, messages: [], isProcessing: false }
  const manager = Object.create(SessionManager.prototype) as InstanceType<typeof SessionManager>
  const dispatches: Parameters<typeof manager.sendMessage>[] = []
  const dispatchJobs: Promise<void>[] = []
  let completeSource!: () => void
  const sourceDispatched = new Promise<void>(resolve => { completeSource = resolve })
  Object.assign(manager, { roxExecutions: new Map(), nativeMemoryContexts: new Map(), runtimeTrace: trace, sessions: new Map([[session.id, managed]]),
    sendEvent() {}, persistSession() {},
    createSession: async (_workspaceId: string, options: Parameters<typeof createSession>[1]) => {
      const child = await createSession(workspace, options)
      register(child)
      return { ...child, workspaceId: 'ws-test' }
    },
    sendMessage: (...args: Parameters<typeof manager.sendMessage>) => {
      dispatches.push(args)
      const job = trace.begin(args[0], args[1], { messageId: `system-dispatch-${dispatches.length}`, launch: args[8]?.runtimeLaunch }).then(() => {
        if (args[8]?.runtimeLaunch?.triggerId === 'source-activated:fixture-source') completeSource()
      })
      dispatchJobs.push(job)
      return job
    },
  })
  // Exercise actual auth formatter and legacy automation authority without external credentials.
  await manager.completeAuthRequest(session.id, { requestId: 'actual-auth-request', success: false, sourceSlug: 'fixture-source', error: privatePath })
  assert.deepEqual(dispatches[0]?.[8]?.runtimeLaunch, { kind: 'unknown', triggerId: 'auth-result:actual-auth-request' })
  await manager.executePromptAutomation({ workspaceId: 'ws-test', workspaceRootPath: workspace, prompt: `Host automation ${privatePath}`, automationName: 'Fixture automation' })
  assert.deepEqual(dispatches[1]?.[8]?.runtimeLaunch, { kind: 'unknown' })
  await manager.executePromptAutomation({ workspaceId: 'ws-test', workspaceRootPath: workspace, prompt: `Scheduled host automation ${privatePath}`, runtimeLaunch: { kind: 'scheduled', triggerId: 'actual-schedule' }, waitForCompletion: false })
  // Background dispatch awaits its collector I/O; allow it to finish before inspecting.
  await Promise.all(dispatchJobs)
  assert.deepEqual(dispatches[2]?.[8]?.runtimeLaunch, { kind: 'scheduled', triggerId: 'actual-schedule' })
  await (manager as unknown as { processEvent(managed: unknown, event: unknown): Promise<void> }).processEvent(managed,
    { type: 'source_activated', sourceSlug: 'fixture-source', originalMessage: `Generated source retry ${privatePath}` })
  await sourceDispatched
  assert.deepEqual(dispatches[3]?.[8]?.runtimeLaunch, { kind: 'unknown', triggerId: 'source-activated:fixture-source' })
  assert.equal(emitted.filter(event => event.kind === 'run.accepted').length, 4)
  for (const event of emitted.filter(event => event.kind === 'run.accepted')) {
    assert.equal(JSON.stringify(nativeRuntimeTraceEvent(event)).includes(privatePath), false)
  }
  for (const args of dispatches) {
    const snapshot = await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: args[0] })
    assert.equal(snapshot.runs.map(run => nativeRuntimeTraceRunSummary(run, snapshot.events)).some(run => run.prompt.includes(privatePath)), false)
  }
} else if (process.argv[2] === 'background-nudge') {
  const { SessionManager } = await import('../SessionManager')
  const { nativeRuntimeTraceEvent, nativeRuntimeTraceRunSummary } = await import('../../handlers/rpc/native-session-scope')
  const session = await createSession(workspace, { name: 'Idle background owner', permissionMode: 'allow-all' })
  register(session)
  const run = await trace.begin(session.id, 'Original user request', { messageId: 'original-user-request' })
  const outputFile = join(workspace, 'private-background-output.txt')
  await writeFile(outputFile, 'Actual isolated background output')
  await trace.agentEvent(session.id, { type: 'tool_start', toolName: 'task', toolUseId: 'background-tool', input: {} }, { originRun: run })
  await trace.agentEvent(session.id, { type: 'task_backgrounded', taskId: 'background-task', toolUseId: 'background-tool' }, { originRun: run })
  const manager = Object.create(SessionManager.prototype) as InstanceType<typeof SessionManager>
  const jobs: Promise<void>[] = []
  Object.assign(manager, { roxExecutions: new Map(), nativeMemoryContexts: new Map(), runtimeTrace: trace, keepBackgroundTasksAlive: true, taskOutputIndex: new Map(),
    sendEvent() {},
    sendMessage: (...args: Parameters<typeof manager.sendMessage>) => {
      assert.equal(args[4]?.hidden, true)
      assert.deepEqual(args[8]?.runtimeLaunch, { kind: 'unknown', triggerId: 'background-task:background-task' })
      const job = trace.begin(args[0], args[1], { messageId: 'hidden-background-nudge', launch: args[8]?.runtimeLaunch }).then(() => {})
      jobs.push(job)
      return job
    },
  })
  const managed = { ...session, workspace: { id: 'ws-test', name: 'Fixture', rootPath: workspace }, isProcessing: false,
    backgroundTaskRegistry: new Map([['background-task', { taskId: 'background-task', startTime: Date.now(), status: 'running' }]]), backgroundTaskOutputs: new Map() }
  await (manager as unknown as { processEvent(managed: unknown, event: unknown): Promise<void> }).processEvent(managed, { type: 'task_completed', taskId: 'background-task', outputFile, status: 'completed' })
  await Promise.all(jobs)
  const nudge = emitted.find(event => event.kind === 'run.accepted' && event.messageId === 'hidden-background-nudge')
  if (nudge?.kind !== 'run.accepted') throw new Error('Missing actual idle nudge launch')
  assert.ok(nudge.payload.prompt.text?.includes(outputFile))
  assert.equal(JSON.stringify(nativeRuntimeTraceEvent(nudge)).includes(outputFile), false)
  const snapshot = await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: session.id })
  assert.equal(snapshot.runs.map(run => nativeRuntimeTraceRunSummary(run, snapshot.events)).some(run => run.prompt.includes(outputFile)), false)
} else {
  const { SessionManager } = await import('../SessionManager')
  const { OmpAgent } = await import('@rox/shared/agent/omp-agent')
  const { createFakeOmp, makeOmpConfig, useFakeOmpEnv } = await import('@rox/shared/agent/__tests__/omp-fake-cli')
  const parent = await createSession(workspace, { name: 'Parent', permissionMode: 'allow-all', model: 'rox/r1-max' })
  register(parent)
  await saveSession({ ...parent, messages: [storedMessage('parent-request', 'user', 'Request', 1)], tokenUsage: usage })
  const untraced = process.argv[2] === 'spawn-untraced-parent'
  if (untraced) {
    const meta = join(getSessionPath(workspace, parent.id), 'meta')
    await mkdir(meta, { recursive: true })
    await writeFile(join(meta, 'runtime-trace'), 'unavailable trace directory')
    await assert.rejects(trace.begin(parent.id, 'Request', { messageId: 'parent-request' }))
    await rm(join(meta, 'runtime-trace'))
    // Recover from a real failed recording without inventing a durable parent run.
    trace = new RuntimeTraceService(id => sessions.get(id), event => emitted.push(event))
    assert.equal(trace.getActive(parent.id), undefined)
    assert.equal((await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: parent.id })).coverage.state, 'unavailable')
  }
  const root = untraced ? undefined : await trace.begin(parent.id, 'Request', { messageId: 'parent-request' })
  const raced = process.argv[2] === 'spawn-race'
  let successor: Awaited<ReturnType<typeof trace.begin>> | undefined
  const manager = Object.create(SessionManager.prototype) as InstanceType<typeof SessionManager>
  const jobs: Promise<void>[] = []
  const createdChildren: string[] = []
  Object.assign(manager, { roxExecutions: new Map(), nativeMemoryContexts: new Map(), runtimeTrace: trace,
    createSession: async (_workspaceId: string, options: Parameters<typeof createSession>[1]) => {
      const child = await createSession(workspace, options)
      register(child)
      createdChildren.push(child.id)
      // The actual child-creation await permits an independent prompt to become active.
      if (raced) successor = await trace.begin(parent.id, 'Concurrent successor request', { messageId: 'successor-request' })
      return { ...child, workspaceId: 'ws-test' }
    },
    sendMessage: (...args: Parameters<typeof manager.sendMessage>) => {
      const [id, prompt] = args
      const job = (async () => {
        const child = loadSession(workspace, id)!
        await saveSession({ ...child, messages: [storedMessage('child-request', 'user', prompt, 2)], tokenUsage: usage })
        const childRun = await trace.begin(id, prompt, { messageId: 'child-request', launch: args[8]?.runtimeLaunch })
        await trace.publishMessage(id, 'child-answer', 'Isolated child executor response', undefined, false, childRun)
        await trace.finish(id, 'complete', childRun)
      })()
      jobs.push(job)
      return job
    },
  })
  const managed = { ...parent, workspace: { id: 'ws-test', name: 'Fixture', rootPath: workspace }, enabledSourceSlugs: [], permissionMode: 'allow-all' }
  const handler = (manager as unknown as { createSpawnSessionHandler(managed: unknown): NonNullable<InstanceType<typeof OmpAgent>['onSpawnSession']> }).createSpawnSessionHandler(managed)
  const fake = createFakeOmp('host-tool-spawn')
  const restore = useFakeOmpEnv(fake)
  const agent = new OmpAgent(makeOmpConfig(fake))
  agent.onSpawnSession = handler
  try {
    for await (const event of agent.chat('Request')) await trace.agentEvent(parent.id, event as never, { structuredHostTerminals: true, originRun: root ?? null })
    await Promise.all(jobs)
    await trace.finish(parent.id, 'complete', root ?? null)
    const request = fake.readRpcLog().find(event => event.type === 'host_tool_result' && event.id === 'htc-spawn')
    assert.ok(request, 'Real host RPC dispatcher must return the spawn result')
    const assignment = emitted.find(event => event.kind === 'agent.assigned')
    const childId = createdChildren[0]!
    const accepted = emitted.find(event => event.kind === 'run.accepted' && event.sessionId === childId)
    if (accepted?.kind !== 'run.accepted') throw new Error('Missing actual child run')
    if (!untraced) {
      assert.ok(root)
      assert.equal(assignment?.kind, 'agent.assigned')
      if (assignment?.kind !== 'agent.assigned') throw new Error('Missing assignment')
      assert.equal(assignment.rootRunId, root.rootRunId, 'The actual spawning invocation owns assignment after child creation awaits')
      assert.equal(assignment.payload.assignment.prompt.text, 'Actual delivered child prompt')
      assert.equal(assignment.payload.assignment.sessionId, childId)
      assert.equal(accepted.rootRunId, root.rootRunId)
      assert.notEqual(accepted.runId, root.runId)
      assert.equal(accepted.parentAgentId, root.agentId)
    } else {
      assert.equal(assignment, undefined)
      assert.equal(accepted.payload.launch.kind, 'delegated', 'Missing parent observations cannot turn a host assignment into a manual user request')
      const { nativeRuntimeTraceEvent, nativeRuntimeTraceRunSummary } = await import('../../handlers/rpc/native-session-scope')
      const nativeEvent = nativeRuntimeTraceEvent(accepted)
      assert.equal(nativeEvent.kind === 'run.accepted' && nativeEvent.payload.prompt.availability, 'redacted')
      assert.equal(JSON.stringify(nativeEvent).includes('Actual delivered child prompt'), false)
      const snapshot = await trace.getSnapshot({ workspaceId: 'ws-test', sessionId: childId })
      const nativeRuns = snapshot.runs.map(run => nativeRuntimeTraceRunSummary(run, snapshot.events))
      assert.equal(nativeRuns.some(run => run.prompt.includes('Actual delivered child prompt')), false)
    }
    assert.equal(loadSession(workspace, childId)?.parentSessionId, parent.id)
    assert.equal(loadSession(workspace, childId)?.messages[0]?.content, 'Actual delivered child prompt')
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    assert.equal((await recovered.getSnapshot({ workspaceId: 'ws-test', sessionId: childId })).events.length, emitted.filter(event => event.rootRunId === accepted.rootRunId).length)
    if (raced) {
      assert.ok(successor)
      assert.equal(trace.getActive(parent.id)?.runId, successor.runId)
      const next = await recovered.getSnapshot({ workspaceId: 'ws-test', sessionId: parent.id, rootRunId: successor.rootRunId })
      assert.equal(next.events.some(event => event.kind === 'agent.assigned' || event.sessionId === childId), false)
      const successorRootRunId = successor.rootRunId
      assert.equal(next.runs.find(run => run.rootRunId === successorRootRunId)?.status, 'running')
    }
  } finally { agent.destroy(); restore(); fake.cleanup() }
}
console.log(`runtime trace ${process.argv[2]} fixture passed`)

// Standalone fixture owns its process; backend housekeeping timers do not extend the test.
process.exit(0)
