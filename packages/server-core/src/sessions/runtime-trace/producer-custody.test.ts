import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskSpec, readNodeOutput, saveTaskSpec } from '@rox/shared/tasks'
import { TaskRunner, type ConductorSessionHost } from '../../tasks/TaskRunner'
import { SessionManager, type SessionCompletionEvent } from '../SessionManager'
import type { TaskRuntimeObservation } from './conductor'

async function until(ready: () => boolean) {
  const deadline = Date.now() + 5000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Actual producer fixture did not settle')
    await Bun.sleep(5)
  }
}

test('actual TaskRunner captures each output version before a blocked passive queue and canonical verdict re-ask', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rox-task-producer-custody-'))
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  try {
    const parsed = parseTaskSpec({ id: 'queued-repair', title: 'Queued repair', goal: 'Preserve observed versions', max_iterations: 1,
      defaults: { permissionMode: 'allow-all' }, nodes: [{ id: 'answer', prompt: 'Produce an answer' }] })
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error))
    saveTaskSpec(root, parsed.data)
    const listeners = new Set<(event: SessionCompletionEvent) => void>()
    const sent: Array<{ id: string; prompt: string }> = []
    const observed: TaskRuntimeObservation[] = []
    let children = 0
    let paused = false
    const host: ConductorSessionHost = {
      async createSession() { return { id: `child-${++children}` } },
      async sendMessage(id, prompt) { sent.push({ id, prompt }) },
      async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
      getSessionWorkingDirectory() { return root }, getSessionFinalText() { return undefined },
      onSessionComplete(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async observeTaskRun(observation) {
        if (observation.entry.kind === 'node-finished' && observation.entry.state === 'done') { paused = true; await blocked }
        observed.push(observation)
      },
    }
    const runner = new TaskRunner({ host, workspaceId: 'owned-workspace', workspaceRoot: root })
    runner.run('queued-repair', { runId: 'owned-run', orchestratorSessionId: 'orchestrator' })
    const complete = (id: string, text: string, messageId: string) => {
      for (const listener of [...listeners]) listener({ sessionId: id, workspaceId: 'owned-workspace', reason: 'complete', finalText: text, finalMessageId: messageId })
    }
    await until(() => sent.some(call => call.id === 'child-1'))
    complete('child-1', 'FIRST_OUTPUT', 'first-answer')
    await until(() => sent.filter(call => call.id === 'orchestrator').length === 1)
    await until(() => paused)
    complete('orchestrator', 'NOT_A_VERDICT', 'first-verdict')
    await until(() => sent.filter(call => call.id === 'orchestrator').length === 2)
    complete('orchestrator', 'VERDICT: PASS', 'final-verdict')
    expect(runner.getRunState('queued-repair', 'owned-run')?.status).toBe('completed')
    expect(readNodeOutput(root, 'queued-repair', 'owned-run', 'answer')).toEqual({ text: 'FIRST_OUTPUT' })
    expect(readNodeOutput(root, 'queued-repair', 'owned-run', '__verdict__')).toEqual({ text: 'VERDICT: PASS' })
    expect(observed.filter(value => value.entry.kind === 'verdict')).toHaveLength(0)
    release()
    await until(() => observed.some(value => value.entry.kind === 'run-completed'))
    const outputs = observed.filter(value => value.entry.kind === 'node-finished' && value.entry.state === 'done')
    expect(outputs.map(value => value.output)).toEqual([{ text: 'FIRST_OUTPUT' }])
    expect(outputs.map(value => value.messageId)).toEqual(['first-answer'])
    expect(outputs.map(value => value.outputRef)).toEqual(['tasks/queued-repair/runs/owned-run/nodes/answer.json'])
    const verdicts = observed.filter(value => value.entry.kind === 'verdict')
    expect(verdicts.map(value => value.output?.text)).toEqual(['NOT_A_VERDICT', 'VERDICT: PASS'])
    expect(verdicts.map(value => value.messageId)).toEqual(['first-verdict', 'final-verdict'])
  } finally { release(); await rm(root, { recursive: true, force: true }) }
})

test('actual SessionManager keeps caller ownership after passive trace awaits and sends origin independently', async () => {
  const managed = { id: 'owned-session', workspace: { id: 'owned-workspace' }, messages: [] }
  const nativeMemoryContexts = new Map()
  const roxExecutions = new Map()
  const manager = Object.create(SessionManager.prototype)
  const origin = { runId: 'captured-origin', rootRunId: 'captured-origin', attemptId: 'captured-attempt', agentId: 'root', sessionId: managed.id, workspaceId: managed.workspace.id }
  let observedOrigin: unknown
  let mutate = () => {}
  Object.assign(manager, { roxExecutions, nativeMemoryContexts, sessions: new Map([[managed.id, managed]]),
    runtimeTrace: { async agentEvent(_id: string, _event: unknown, options: { originRun: unknown }) { observedOrigin = options.originRun; mutate() } },
  })
  // This is the actual modern owner guard. The fixture starts as an unowned
  // legacy session, then proves it cannot adopt a newly acquired owner after I/O.
  const event = { type: 'runtime_observation', observation: {} }
  await manager.processEvent(managed, event, undefined, origin)
  expect(observedOrigin).toBe(origin)
  mutate = () => roxExecutions.set(managed.id, { caller: { issuer: 'new-owner', subject: 'new-owner' } })
  await expect(manager.processEvent(managed, event, undefined, origin)).rejects.toThrow('ROX_SESSION_OWNER_CONFLICT')
  expect(managed.messages).toHaveLength(0)
  roxExecutions.clear()
  let authorized = true
  nativeMemoryContexts.set(managed.id, { owner: { issuer: 'fixture', subject: 'fixture' }, assertAuthorized() { if (!authorized) throw new Error('fixture native scope retired') } })
  mutate = () => { authorized = false }
  await expect(manager.processEvent(managed, event, undefined, origin)).rejects.toThrow('fixture native scope retired')
  expect(managed.messages).toHaveLength(0)
})
