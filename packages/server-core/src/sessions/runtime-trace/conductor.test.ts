import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskSpec, saveTaskSpec, readRunLog } from '@rox/shared/tasks'
import type { CreateSessionOptions } from '@rox/shared/protocol'
import type { RuntimeEvent } from '@rox/core/runtime-trace'
import type { SessionCompletionEvent } from '../SessionManager'
import { TaskRunner, type ConductorSessionHost } from '../../tasks/TaskRunner'
import { RuntimeTraceService, type RuntimeTraceSession } from './service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function until(check: () => boolean) { for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)) } throw new Error('Timed out waiting for authority/collector') }

describe('canonical Conductor observations', () => {
  it('publishes actual DAG dependencies and durable verification verdict, separately from node completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-conductor-map-')); roots.push(root)
    const parsed = parseTaskSpec({ id: 'actual-task', title: 'Actual task', goal: 'Inspect then verify', acceptance_criteria: 'Both nodes returned an output', defaults: { permissionMode: 'allow-all' }, max_iterations: 0,
      nodes: [{ id: 'read', title: 'read', prompt: 'Read' }, { id: 'verify', title: 'verify', prompt: '${nodes.read.output}', depends_on: ['read'] }] })
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error))
    saveTaskSpec(root, parsed.data)
    const sessions = new Map<string, RuntimeTraceSession>([['orchestrator', { id: 'orchestrator', workspaceId: 'ws', directory: join(root, 'sessions', 'orchestrator') }]])
    const events: RuntimeEvent[] = []
    const collector = new RuntimeTraceService(id => sessions.get(id), event => events.push(event))
    await collector.begin('orchestrator', 'A concurrent channel request', { launch: { kind: 'channel', channel: { kind: 'channel-identity', id: 'channel-call', scope: 'workspace', label: 'Fixture channel' } } })
    const listeners = new Set<(event: SessionCompletionEvent) => void>()
    const sent: Array<{ sessionId: string; message: string }> = []
    const finalText = new Map<string, string>()
    const host: ConductorSessionHost = {
      async createSession(workspaceId: string, options: CreateSessionOptions) { const id = `session-${options.name}`; sessions.set(id, { id, workspaceId, parentSessionId: options.parentSessionId, directory: join(root, 'sessions', id) }); return { id } },
      async sendMessage(sessionId, message) { sent.push({ sessionId, message }); if (sessionId !== 'orchestrator') await collector.begin(sessionId, message) },
      async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
      getSessionWorkingDirectory() { return undefined }, getSessionFinalText(id) { return finalText.get(id) },
      onSessionComplete(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async observeTaskRun(observation) {
        expect(readRunLog(root, 'actual-task', 'task-run-1').some(entry => entry.kind === observation.entry.kind && entry.t === observation.entry.t)).toBe(true)
        await collector.conductor(observation)
      },
      async assignTaskRuntimeChild(parentSessionId, childSessionId, prompt, node, taskRunId) {
        const run = collector.getConductorRun(parentSessionId, taskRunId)!
        await collector.assign(parentSessionId, childSessionId, { name: node.id, task: { text: node.prompt }, prompt: await collector.content(run, prompt), sessionId: childSessionId, nativeKind: 'rox-session' }, run)
      },
    }
    const runner = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root })
    runner.run('actual-task', { runId: 'task-run-1', orchestratorSessionId: 'orchestrator' })
    await until(() => sent.some(entry => entry.sessionId === 'session-read'))
    const complete = (id: string, text: string) => { finalText.set(id, text); for (const listener of [...listeners]) listener({ sessionId: id, workspaceId: 'ws', reason: 'complete', finalText: text }) }
    complete('session-read', 'source text')
    await until(() => sent.some(entry => entry.sessionId === 'session-verify'))
    expect(sent.find(entry => entry.sessionId === 'session-verify')?.message).toBe('source text')
    complete('session-verify', 'verified output')
    await until(() => events.some(event => event.kind === 'acceptance.started'))
    expect(events.some(event => event.kind === 'acceptance.completed' && event.payload.acceptance.status === 'passed')).toBe(false)
    complete('orchestrator', 'VERDICT: PASS — both outputs checked')
    await until(() => events.some(event => event.kind === 'acceptance.completed'))
    const verdict = events.find(event => event.kind === 'acceptance.completed')!
    expect(verdict.kind === 'acceptance.completed' && verdict.payload.acceptance.status).toBe('passed')
    expect(verdict.kind === 'acceptance.completed' && verdict.payload.acceptance.authorityRef).toContain('run-log.jsonl')
    const plan = events.find(event => event.kind === 'plan.published')!
    expect(plan.kind === 'plan.published' && plan.payload.plan.tasks[1]?.dependsOn).toEqual(['task:task-run-1:read'])
    expect(events.filter(event => event.kind === 'agent.assigned')).toHaveLength(2)
    const taskLaunch = events.find(event => event.kind === 'run.accepted' && event.payload.launch.triggerId === 'task:actual-task:task-run-1')
    expect(taskLaunch?.kind === 'run.accepted' && taskLaunch.payload.launch.kind).toBe('unknown')
    expect(taskLaunch?.kind === 'run.accepted' && taskLaunch.payload.launch.channel).toBeUndefined()
    await until(() => events.some(event => event.kind === 'run.completed'))
  })
})
