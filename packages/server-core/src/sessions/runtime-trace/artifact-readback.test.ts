import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskSpec, readNodeOutput, readRunLog, saveTaskSpec } from '@rox/shared/tasks'
import type { CreateSessionOptions } from '@rox/shared/protocol'
import { buildRuntimeGraph, isRuntimeEvent, projectRuntimeEvents, type RuntimeEvent } from '@rox/core/runtime-trace'
import { TaskRunner, type ConductorSessionHost } from '../../tasks/TaskRunner'
import type { SessionCompletionEvent } from '../SessionManager'
import { RuntimeTraceService, type RuntimeTraceSession } from './service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function until(check: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for the TaskRunner artifact receipt')
}

describe('TaskRunner artifact filesystem readback', () => {
  it('retains actual answer, input, output file and evidence lineage after journal restoration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rox-artifact-readback-')); roots.push(root)
    const taskId = 'artifact-readback', taskRunId = 'artifact-run', workspaceId = 'artifact-workspace'
    const input = 'Primary input: the observed value is 42.'
    const report = 'Report: the primary input confirms the observed value is 42.'
    const answer = 'The saved report matches the primary input.\nVERDICT: PASS'
    const parsed = parseTaskSpec({ id: taskId, title: 'Persist and verify report', goal: 'Create a report from the actual input', acceptance_criteria: 'The report preserves the input value', max_iterations: 0,
      defaults: { permissionMode: 'allow-all' }, nodes: [
        { id: 'input', prompt: 'Collect the primary input', outputs: [{ name: 'source' }] },
        { id: 'report', prompt: 'Write a report using ${nodes.input.output}', depends_on: ['input'], outputs: [{ name: 'report' }] },
      ] })
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error))
    saveTaskSpec(root, parsed.data)

    const sessions = new Map<string, RuntimeTraceSession>([['orchestrator', { id: 'orchestrator', workspaceId, directory: join(root, 'sessions', 'orchestrator') }]])
    const events: RuntimeEvent[] = []
    const collector = new RuntimeTraceService(id => sessions.get(id), event => events.push(event))
    const listeners = new Set<(event: SessionCompletionEvent) => void>()
    const sent: Array<{ sessionId: string; message: string }> = []
    const finalText = new Map<string, string>()
    const host: ConductorSessionHost = {
      async createSession(actualWorkspaceId: string, options: CreateSessionOptions) {
        const id = `child-${options.name}`
        sessions.set(id, { id, workspaceId: actualWorkspaceId, parentSessionId: options.parentSessionId, directory: join(root, 'sessions', id) })
        return { id }
      },
      async sendMessage(sessionId, message) {
        sent.push({ sessionId, message })
        if (sessionId !== 'orchestrator') await collector.begin(sessionId, message)
      },
      async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
      getSessionWorkingDirectory() { return root }, getSessionFinalText(id) { return finalText.get(id) },
      onSessionComplete(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async observeTaskRun(observation) {
        // This is the production TaskRunner's durable observer seam, after its atomic output write.
        const durable = readRunLog(root, taskId, taskRunId)
        expect(durable.some(entry => entry.kind === observation.entry.kind && entry.t === observation.entry.t)).toBe(true)
        if (observation.entry.kind === 'verdict' || observation.entry.kind === 'node-finished' && observation.entry.state === 'done') {
          const outputId = observation.entry.kind === 'verdict' ? '__verdict__' : observation.entry.nodeId
          expect(observation.outputRef).toBe(`tasks/${taskId}/runs/${taskRunId}/nodes/${outputId}.json`)
          expect(observation.output).toEqual(JSON.parse(await readFile(join(root, observation.outputRef!), 'utf8')))
        }
        await collector.conductor(observation)
      },
      async assignTaskRuntimeChild(parentSessionId, childSessionId, prompt, node, actualTaskRunId) {
        const run = collector.getConductorRun(parentSessionId, actualTaskRunId)!
        await collector.assign(parentSessionId, childSessionId, { name: node.id, task: { text: node.prompt }, prompt: await collector.content(run, prompt), sessionId: childSessionId, nativeKind: 'rox-session' }, run)
      },
    }
    // Only session execution is injected; scheduling, atomic output files, durable task log,
    // runtime collector and restored projection are the real production implementations.
    const runner = new TaskRunner({ host, workspaceId, workspaceRoot: root })
    runner.run(taskId, { runId: taskRunId, orchestratorSessionId: 'orchestrator' })
    const complete = async (sessionId: string, text: string) => {
      finalText.set(sessionId, text)
      if (sessionId !== 'orchestrator') {
        await collector.publishMessage(sessionId, `answer-${sessionId}`, text)
        await collector.finish(sessionId, 'complete')
      }
      for (const listener of [...listeners]) listener({ sessionId, workspaceId, reason: 'complete', finalMessageId: `answer-${sessionId}`, finalText: text })
    }
    await until(() => sent.some(entry => entry.sessionId === 'child-input'))
    await complete('child-input', input)
    await until(() => sent.some(entry => entry.sessionId === 'child-report'))
    expect(sent.find(entry => entry.sessionId === 'child-report')?.message).toBe(`Write a report using ${input}`)
    await complete('child-report', report)
    await until(() => events.some(event => event.kind === 'acceptance.started'))
    expect(sent.find(entry => entry.sessionId === 'orchestrator')?.message).toContain(report)
    await complete('orchestrator', answer)
    await until(() => events.some(event => event.kind === 'run.completed' && event.runId === event.rootRunId))
    expect(runner.getRunState(taskId, taskRunId)?.status).toBe('completed')

    const relativeReport = `tasks/${taskId}/runs/${taskRunId}/nodes/report.json`
    expect(JSON.parse(await readFile(join(root, relativeReport), 'utf8'))).toEqual({ text: report })
    expect(readNodeOutput(root, taskId, taskRunId, 'input')).toEqual({ text: input })
    expect(readNodeOutput(root, taskId, taskRunId, 'report')).toEqual({ text: report })
    expect(readNodeOutput(root, taskId, taskRunId, '__verdict__')).toEqual({ text: answer })
    const durableVerdict = readRunLog(root, taskId, taskRunId).find(entry => entry.kind === 'verdict')
    expect(durableVerdict).toMatchObject({ kind: 'verdict', result: 'pass' })

    const rootRunId = collector.getConductorRun('orchestrator', taskRunId)!.rootRunId
    const restored = new RuntimeTraceService(id => sessions.get(id), () => { throw new Error('A readback must not emit live events') })
    const snapshot = await restored.getSnapshot({ workspaceId, sessionId: 'orchestrator', rootRunId })
    expect(snapshot.events.every(isRuntimeEvent)).toBe(true)
    expect(snapshot.events).toEqual(events.filter(event => event.rootRunId === rootRunId))
    const childResult = snapshot.events.find(event => event.kind === 'result.published' && event.sessionId === 'child-report')!
    const artifact = snapshot.events.find(event => event.kind === 'artifact.created' && event.payload.artifact.id === `task-output:${taskRunId}:report`)!
    const finalAnswer = snapshot.events.find(event => event.kind === 'result.published' && event.payload.content.text === answer)!
    const acceptance = snapshot.events.find(event => event.kind === 'acceptance.completed')!
    expect(childResult).toMatchObject({ messageId: 'answer-child-report', payload: { content: { text: report } } })
    expect(artifact).toMatchObject({ payload: { artifact: { uri: relativeReport, content: { text: report } } } })
    expect(artifact.kind === 'artifact.created' && artifact.payload.artifact.evidenceEventIds).toContain(childResult.eventId)
    expect(artifact.kind === 'artifact.created' && artifact.payload.artifact.evidenceEventIds?.every(id => snapshot.events.some(event => event.eventId === id))).toBe(true)
    expect(finalAnswer).toMatchObject({ rootRunId, messageId: 'answer-orchestrator' })
    expect(finalAnswer.kind === 'result.published' && finalAnswer.payload.artifactIds).toContain(`task-output:${taskRunId}:report`)
    expect(finalAnswer.kind === 'result.published' && finalAnswer.payload.evidenceEventIds).toContain(acceptance.eventId)
    expect(new Set(snapshot.events.map(event => event.eventId)).size).toBe(snapshot.events.length)

    const graph = buildRuntimeGraph(projectRuntimeEvents(snapshot.events))
    const eventNode = (eventId: string) => graph.nodes.find(node => node.events.some(event => event.eventId === eventId))!
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: eventNode(childResult.eventId).id, target: eventNode(artifact.eventId).id, kind: 'data-dependency' }))
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: eventNode(artifact.eventId).id, target: eventNode(finalAnswer.eventId).id, kind: 'data-dependency' }))
    const assignment = snapshot.events.find(event => event.kind === 'agent.assigned' && event.payload.assignment.sessionId === 'child-report')!
    expect(assignment).toMatchObject({ payload: { assignment: { prompt: { text: `Write a report using ${input}` } } } })
    const receiptPath = process.env.ROX_RUNTIME_ARTIFACT_READBACK_RECEIPT
    if (receiptPath) {
      const reportBytes = await readFile(join(root, relativeReport))
      await writeFile(receiptPath, JSON.stringify({ schemaVersion: 1,
        classification: 'unit-integration: production TaskRunner/filesystem/collector/projector, injected deterministic session execution',
        reviewedCommit: process.env.ROX_RUNTIME_ARTIFACT_READBACK_COMMIT,
        platform: process.platform, architecture: process.arch, runtime: `Bun ${Bun.version}`,
        taskId, taskRunId, workspaceId, rootSessionId: 'orchestrator', rootRunId,
        input: { file: `tasks/${taskId}/runs/${taskRunId}/nodes/input.json`, readback: readNodeOutput(root, taskId, taskRunId, 'input') },
        artifact: { file: relativeReport, byteLength: reportBytes.byteLength, sha256: createHash('sha256').update(reportBytes).digest('hex'), readback: readNodeOutput(root, taskId, taskRunId, 'report'), eventId: artifact.eventId },
        finalAnswer: { messageId: finalAnswer.messageId, file: `tasks/${taskId}/runs/${taskRunId}/nodes/__verdict__.json`, readback: readNodeOutput(root, taskId, taskRunId, '__verdict__'), eventId: finalAnswer.eventId },
        evidence: { childResultEventId: childResult.eventId, reportAssignmentEventId: assignment.eventId, acceptanceEventId: acceptance.eventId,
          artifactEvidenceEventIds: artifact.kind === 'artifact.created' ? artifact.payload.artifact.evidenceEventIds : [],
          answerArtifactIds: finalAnswer.kind === 'result.published' ? finalAnswer.payload.artifactIds : [],
          answerEvidenceEventIds: finalAnswer.kind === 'result.published' ? finalAnswer.payload.evidenceEventIds : [] },
        restoredEventCount: snapshot.events.length, readbackEmittedLiveEvents: false,
        networkAttempts: 0, paidProviderRequests: 0, originalWorkspaceRetained: false,
        checks: { outputFilesWrittenByTaskRunner: true, originalInputDelivered: true, exactFileReadback: true, actualFinalMessageIdentity: true, artifactEvidenceLinked: true, answerArtifactLinked: true, journalRestored: true },
      }, null, 2) + '\n')
    }
  })
})
