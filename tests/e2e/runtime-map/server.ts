/** Loopback-only deterministic executor. Uses the production journal; never calls a provider. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createRuntimeTraceFixture } from '../../../packages/core/src/runtime-trace/fixture'
import { known, type RuntimeAgentObservation, type RuntimeEvent, type RuntimePayloadQuery, type RuntimeTraceQuery, type RuntimeEventsQuery } from '../../../packages/core/src/runtime-trace/types'
import { RuntimeTraceService, type RuntimeTraceRun } from '../../../packages/server-core/src/sessions/runtime-trace/service'
import { createCatalogFixture } from './catalog-store'
import { contextFixtureAgentIds, createContextFixtureSnapshot } from '../../fixtures/runtime-map/context'

if (process.env.ROX_RUNTIME_MAP_E2E !== '1' || process.env.NODE_ENV === 'production') throw new Error('Isolated runtime-map test server requires explicit test opt-in')
const directory = await mkdtemp(join(tmpdir(), 'rox-runtime-map-e2e-'))
const catalog = createCatalogFixture(directory)
const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
const encoder = new TextEncoder()
let generation = 0, index = 2, run: RuntimeTraceRun | undefined
let runtimeStarts = 0, terminalExecutions = 0
let terminal: { stdout: string; stderr: string; exitCode: number; elapsedMs: number } | undefined
let events: RuntimeEvent[] = []
const fixture = createRuntimeTraceFixture()
const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4176', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' }
function emit(event: RuntimeEvent) {
  events.push(event)
  const data = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  for (const subscriber of subscribers) { try { subscriber.enqueue(data) } catch { subscribers.delete(subscriber) } }
}
function createService() {
  return new RuntimeTraceService(id => id === 'fixture-session' ? { id, workspaceId: 'fixture-workspace', directory: join(directory, `session-${generation}`) } : undefined, emit)
}
let service = createService()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
function toObservation(event: RuntimeEvent): RuntimeAgentObservation {
  const root = (id?: string) => id === 'fixture-parent' ? 'root' : id
  return { sourceId: 'isolated-executor', sourceSeq: event.sourceSeq, sourceEventId: `test-event-${event.sourceSeq}`,
    agentId: root(event.agentId)!, parentAgentId: root(event.parentAgentId),
    occurredAt: known(Date.now(), 'isolated-executor-clock'), clockDomain: 'isolated-executor', origin: 'observed',
    spanId: event.spanId, toolUseId: event.toolUseId, messageId: `transcript-${event.sourceSeq}`, kind: event.kind,
    payload: event.kind === 'agent.assigned' ? { assignment: { ...event.payload.assignment,
      parentAgentId: root(event.payload.assignment.parentAgentId) } } : event.payload,
  } as RuntimeAgentObservation
}

const server = Bun.serve({ hostname: '127.0.0.1', port: 4177, idleTimeout: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  try {
    if (path.startsWith('/catalog/')) {
      const result = catalog.handle(path, request.method === 'POST' ? await request.json() : undefined)
      return result === undefined ? json({ error: 'Unknown catalog test route' }, 404) : json(result)
    }
    if (path === '/health') return json({ class: 'renderer-e2e', syntheticExecutor: true })
    if (path === '/events') {
      let subscriber: ReadableStreamDefaultController<Uint8Array>
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { subscriber = controller; subscribers.add(controller); controller.enqueue(encoder.encode(': isolated runtime trace\n\n')) },
        cancel() { subscribers.delete(subscriber) },
      }), { headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
    }
    if (path === '/stats') return json({ runtimeStarts, terminalExecutions, providerRequests: 0, eventCount: events.length, step: index, steps: fixture.length, sourceConnections: subscribers.size, rootRunId: run?.rootRunId })
    if (path === '/reset' && request.method === 'POST') {
      generation++; index = 2; run = undefined; events = []; terminal = undefined; runtimeStarts = terminalExecutions = 0
      await mkdir(join(directory, `session-${generation}`), { recursive: true }); service = createService()
      return json({ reset: true })
    }
    if (path === '/restart' && request.method === 'POST') { service = createService(); return json({ recovered: true }) }
    if (path === '/approval' && request.method === 'POST') {
      if (!run) return json({ error: 'No active test run' }, 409)
      await service.record(run, 'approval.requested', { id: 'test-approval', kind: 'permission', description: 'Тестовый запрос разрешения; карта его не подтверждает' }, { messageId: 'fixture-approval' })
      return json({ requested: true })
    }
    if (path === '/context-fixture' && request.method === 'POST') {
      if (!run) return json({ error: 'No active test run' }, 409)
      const rootSnapshot = createContextFixtureSnapshot('root')
      const childSnapshot = createContextFixtureSnapshot('child')
      await service.capture('fixture-session', rootSnapshot)
      const observation = (sourceSeq: number, agentId: string, kind: RuntimeAgentObservation['kind'], payload: unknown): RuntimeAgentObservation => ({
        sourceId: 'explicit-context-fixture', sourceSeq, sourceEventId: `context-fixture:${sourceSeq}`,
        agentId, parentAgentId: 'root', occurredAt: known(Date.now(), 'explicit-context-fixture'), origin: 'observed',
        kind, payload,
      } as RuntimeAgentObservation)
      await service.observe('fixture-session', observation(1, contextFixtureAgentIds.child, 'agent.assigned', { assignment: {
        agentId: contextFixtureAgentIds.child, parentAgentId: 'root', name: 'Child context fixture', nativeKind: 'restricted',
        task: childSnapshot.originalPrompt, prompt: childSnapshot.effectivePrompt, model: childSnapshot.model,
        contextSnapshotId: childSnapshot.id, tools: ['read'], permissionMode: 'read-only',
      } }))
      await service.observe('fixture-session', observation(2, contextFixtureAgentIds.child, 'context.captured', { snapshot: childSnapshot }))
      await service.observe('fixture-session', observation(3, contextFixtureAgentIds.missing, 'agent.assigned', { assignment: {
        agentId: contextFixtureAgentIds.missing, parentAgentId: 'root', name: 'Child without snapshot', nativeKind: 'task',
        task: { text: 'Context snapshot was not emitted.' }, prompt: { text: 'Explicit assignment without snapshot.' },
      } }))
      return json({ rootSnapshotId: rootSnapshot.id, childSnapshotId: childSnapshot.id, agents: contextFixtureAgentIds })
    }
    if (path === '/large' && request.method === 'POST') {
      if (!run) return json({ error: 'No active test run' }, 409)
      const content = 'Authorization: Bearer fixture-secret-value\n' + 'Большой тестовый результат.\n'.repeat(20_000)
      const event = await service.record(run, 'tool.completed', { name: 'fixture_large_read', input: { text: '{"test":true}' }, result: { text: content }, modelContent: { text: 'Тестовое сокращение большого результата.' }, status: 'succeeded' }, { spanId: 'fixture-large', toolUseId: 'fixture-large' })
      return json(event)
    }
    if (path === '/start' && request.method === 'POST') {
      if (run) return json({ error: 'A test run already exists' }, 409)
      runtimeStarts++
      run = await service.begin('fixture-session', fixture[0].kind === 'run.accepted' ? fixture[0].payload.prompt.text! : '', { messageId: 'fixture-user', launch: { kind: 'manual' } })
      return json({ rootRunId: run.rootRunId })
    }
    if (path === '/next-run' && request.method === 'POST') {
      if (!run || index < fixture.length) return json({ error: 'Previous test run must be complete' }, 409)
      runtimeStarts++; index = 2
      run = await service.begin('fixture-session', 'Второй тестовый запрос', { messageId: 'fixture-user-next', launch: { kind: 'manual' } })
      return json({ rootRunId: run.rootRunId })
    }
    if (path === '/step' && request.method === 'POST') {
      if (!run || index >= fixture.length) return json({ error: 'No pending test step' }, 409)
      const event = fixture[index++]
      if (event.kind === 'terminal.started') {
        terminalExecutions++
        await service.observe('fixture-session', { ...toObservation(event), kind: 'terminal.started', payload: {
          command: 'printf fixture; printf "fixture stderr" >&2', shell: 'bash', cwd: directory, status: 'running',
        } })
        const started = performance.now()
        const child = Bun.spawn(['bash', '-c', 'printf fixture; printf "fixture stderr" >&2'], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
        terminal = { stdout, stderr, exitCode, elapsedMs: performance.now() - started }
      } else if (event.kind === 'terminal.completed') {
        if (!terminal) throw new Error('Executor never ran')
        await service.observe('fixture-session', { ...toObservation(event), elapsedMs: terminal.elapsedMs, kind: 'terminal.completed', payload: {
          command: 'printf fixture; printf "fixture stderr" >&2', cwd: directory, shell: 'bash', stdout: { text: terminal.stdout }, stderr: { text: terminal.stderr },
          exitCode: known(terminal.exitCode, 'real-test-shell'), status: terminal.exitCode === 0 ? 'succeeded' : 'failed',
        } })
      } else if (event.kind === 'run.completed') await service.finish('fixture-session', 'complete')
      else await service.observe('fixture-session', toObservation(event))
      return json({ emittedKind: event.kind, remaining: fixture.length - index })
    }
    if (path === '/snapshot') return json(await service.getSnapshot(await request.json() as RuntimeTraceQuery))
    if (path === '/read-events') return json(await service.readEvents(await request.json() as RuntimeEventsQuery))
    if (path === '/read-payload') return json(await service.readPayload(await request.json() as RuntimePayloadQuery))
    return json({ error: 'Unknown test route' }, 404)
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Test server error' }, 400) }
} })
async function dispose() { server.stop(true); await rm(directory, { recursive: true, force: true }); process.exit(0) }
process.on('SIGTERM', dispose); process.on('SIGINT', dispose)
