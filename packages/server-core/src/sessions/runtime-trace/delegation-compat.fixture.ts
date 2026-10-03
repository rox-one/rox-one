import { strict as assert } from 'node:assert'
import { readFile, rm } from 'node:fs/promises'
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
const trace = new RuntimeTraceService(id => sessions.get(id), event => emitted.push(event))
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
} else {
  const { SessionManager } = await import('../SessionManager')
  const { OmpAgent } = await import('@rox/shared/agent/omp-agent')
  const { createFakeOmp, makeOmpConfig, useFakeOmpEnv } = await import('@rox/shared/agent/__tests__/omp-fake-cli')
  const parent = await createSession(workspace, { name: 'Parent', permissionMode: 'allow-all', model: 'rox/r1-max' })
  register(parent)
  await saveSession({ ...parent, messages: [storedMessage('parent-request', 'user', 'Request', 1)], tokenUsage: usage })
  const root = await trace.begin(parent.id, 'Request', { messageId: 'parent-request' })
  const manager = Object.create(SessionManager.prototype) as InstanceType<typeof SessionManager>
  const jobs: Promise<void>[] = []
  Object.assign(manager, { runtimeTrace: trace,
    createSession: async (_workspaceId: string, options: Parameters<typeof createSession>[1]) => { const child = await createSession(workspace, options); register(child); return { ...child, workspaceId: 'ws-test' } },
    sendMessage: (id: string, prompt: string) => { const job = (async () => { const child = loadSession(workspace, id)!; await saveSession({ ...child, messages: [storedMessage('child-request', 'user', prompt, 2)], tokenUsage: usage }); await trace.begin(id, prompt, { messageId: 'child-request' }); await trace.publishMessage(id, 'child-answer', 'Isolated child executor response'); await trace.finish(id, 'complete') })(); jobs.push(job); return job },
  })
  const managed = { ...parent, workspace: { id: 'ws-test', name: 'Fixture', rootPath: workspace }, enabledSourceSlugs: [], permissionMode: 'allow-all' }
  const handler = (manager as unknown as { createSpawnSessionHandler(managed: unknown): NonNullable<InstanceType<typeof OmpAgent>['onSpawnSession']> }).createSpawnSessionHandler(managed)
  const fake = createFakeOmp('host-tool-spawn')
  const restore = useFakeOmpEnv(fake)
  const agent = new OmpAgent(makeOmpConfig(fake))
  agent.onSpawnSession = handler
  try {
    for await (const event of agent.chat('Request')) await trace.agentEvent(parent.id, event as never, { structuredHostTerminals: true })
    await Promise.all(jobs)
    await trace.finish(parent.id, 'complete')
    const request = fake.readRpcLog().find(event => event.type === 'host_tool_result' && event.id === 'htc-spawn')
    assert.ok(request, 'Real host RPC dispatcher must return the spawn result')
    const assignment = emitted.find(event => event.kind === 'agent.assigned')
    assert.equal(assignment?.kind, 'agent.assigned')
    if (assignment?.kind !== 'agent.assigned') throw new Error('Missing assignment')
    assert.equal(assignment.payload.assignment.prompt.text, 'Actual delivered child prompt')
    const childId = assignment.payload.assignment.sessionId!
    const accepted = emitted.find(event => event.kind === 'run.accepted' && event.sessionId === childId)
    assert.equal(accepted?.rootRunId, root.rootRunId)
    assert.notEqual(accepted?.runId, root.runId)
    assert.equal(accepted?.parentAgentId, root.agentId)
    assert.equal(loadSession(workspace, childId)?.parentSessionId, parent.id)
    assert.equal(loadSession(workspace, childId)?.messages[0]?.content, 'Actual delivered child prompt')
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    assert.equal((await recovered.getSnapshot({ workspaceId: 'ws-test', sessionId: childId })).events.length, emitted.length)
  } finally { agent.destroy(); restore(); fake.cleanup() }
}
console.log(`runtime trace ${process.argv[2]} fixture passed`)

// Standalone fixture owns its process; backend housekeeping timers do not extend the test.
process.exit(0)
