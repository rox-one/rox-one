/** Explicit deterministic test data. Never seed a production session with this fixture. */
import { known, unknown, type RuntimeEvent, type RuntimeEventKind, type RuntimeEventPayloads, type RuntimeEnvelope } from './types'

export function createRuntimeTraceFixture(): RuntimeEvent[] {
  const events: RuntimeEvent[] = []
  const add = <K extends RuntimeEventKind>(kind: K, payload: RuntimeEventPayloads[K], extra: Partial<RuntimeEnvelope> = {}) => {
    const seq = events.length + 1
    events.push({ schemaVersion: 1, eventId: `fixture:${seq}`, sourceEventId: `fixture:${seq}`, sourceId: 'test-fixture', sourceSeq: seq,
      workspaceId: 'fixture-workspace', rootSessionId: 'fixture-session', sessionId: 'fixture-session', rootRunId: 'fixture-run', runId: 'fixture-run',
      agentId: 'fixture-parent', seq, occurredAt: known(1_000 + seq * 50, 'test-fixture'), receivedAt: 1_000 + seq * 50,
      clockDomain: 'test-fixture', origin: 'observed', ...extra, kind, payload } as RuntimeEvent)
  }
  add('run.accepted', { prompt: { text: 'Сравни два источника и проверь результат.' }, launch: { kind: 'manual' } }, { messageId: 'fixture-user' })
  add('run.started', { status: 'running' })
  const model = { requested: 'fixture/model', confirmed: known('fixture/model', 'test-readback'), contextWindow: known(32_768, 'test-catalog') }
  add('context.captured', { snapshot: { id: 'fixture-context', version: 1, capturedAt: known(1_100, 'test-fixture'), originalPrompt: { text: 'Сравни два источника и проверь результат.' },
    effectivePrompt: { text: 'orchestrate workflowz ultrathink\nСравни два источника и проверь результат.' }, model,
    blocks: [{ id: 'system', kind: 'system', label: 'Инструкция теста', source: 'test-fixture', order: 0, included: true, content: { text: 'Проверяй факты по источникам.' } }],
    inputTokens: unknown(), coverage: { state: 'complete', source: 'runtime', missing: [] } } })
  add('plan.published', { plan: { id: 'fixture-plan', version: 1, tasks: [
    { id: 'research', title: 'Проверить источники', status: 'running', dependsOn: [], criteria: ['Есть два проверенных источника'] },
    { id: 'verify', title: 'Проверить результат', status: 'queued', dependsOn: ['research'], criteria: ['Проверка прошла'] },
  ] } })
  add('agent.assigned', { assignment: { agentId: 'fixture-child-a', parentAgentId: 'fixture-parent', name: 'Источники', task: { text: 'Проверь первый источник' }, prompt: { text: 'Проверь первый источник' }, nativeKind: 'task', tools: ['read'], model } }, { agentId: 'fixture-child-a', parentAgentId: 'fixture-parent', runId: 'fixture-child-run-a' })
  add('agent.assigned', { assignment: { agentId: 'fixture-child-b', parentAgentId: 'fixture-parent', name: 'Проверка', task: { text: 'Проверь второй источник' }, prompt: { text: 'Проверь второй источник' }, nativeKind: 'rox-session', model } }, { agentId: 'fixture-child-b', parentAgentId: 'fixture-parent', runId: 'fixture-child-run-b' })
  const child = { agentId: 'fixture-child-a', parentAgentId: 'fixture-parent', runId: 'fixture-child-run-a' }
  add('agent.started', { status: 'running' }, child)
  add('skill.loaded', { capability: { kind: 'skill', id: 'research', scope: 'session', label: 'Проверка источников' }, content: { text: 'Сравни первоисточники.' } }, child)
  add('tool.started', { name: 'read', input: { text: '{"path":"fixture.txt"}' }, status: 'running' }, { ...child, toolUseId: 'fixture-read', spanId: 'fixture-read' })
  add('tool.completed', { name: 'read', result: { text: 'Первый источник проверен.' }, modelContent: { text: 'Первый источник проверен.' }, status: 'succeeded' }, { ...child, toolUseId: 'fixture-read', spanId: 'fixture-read', elapsedMs: 12 })
  add('agent.completed', { status: 'succeeded', result: { text: 'Первый источник готов.' } }, child)
  add('terminal.started', { command: 'printf fixture', shell: 'bash', cwd: '/test', status: 'running' }, { agentId: 'fixture-child-b', parentAgentId: 'fixture-parent', runId: 'fixture-child-run-b', spanId: 'fixture-shell', toolUseId: 'fixture-shell' })
  add('terminal.completed', { command: 'printf fixture', stdout: { text: 'fixture' }, stderr: { text: '' }, exitCode: known(0, 'test-executor'), status: 'succeeded' }, { agentId: 'fixture-child-b', parentAgentId: 'fixture-parent', runId: 'fixture-child-run-b', spanId: 'fixture-shell', toolUseId: 'fixture-shell', elapsedMs: 24 })
  add('acceptance.completed', { acceptance: { id: 'fixture-acceptance', taskId: 'verify', criterion: 'Есть два проверенных источника', status: 'passed', evidence: [{ text: 'Проверено детерминированным тестом.' }] } })
  add('result.published', { content: { text: 'Оба источника проверены.' }, evidenceEventIds: ['fixture:10', 'fixture:13', 'fixture:14'] }, { messageId: 'fixture-answer' })
  add('run.completed', { status: 'succeeded' })
  return events
}
