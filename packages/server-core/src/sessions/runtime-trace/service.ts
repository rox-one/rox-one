import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeEvent, RuntimeAgentObservation, RuntimeEventKind, RuntimeEventPayloads, RuntimeContextSnapshot, RuntimeTraceSnapshot, RuntimeTraceQuery, RuntimeEventsQuery, RuntimeEventsPage, RuntimePayloadQuery, RuntimePayloadPage, RuntimeRunSummary, TraceCoverage, RuntimeContent, RuntimeStatus } from '@rox/core/runtime-trace'
import { known, unknown } from '@rox/core/runtime-trace'
import { isRuntimeAgentObservation, isRuntimeEvent, isRuntimeObservation } from '@rox/core/runtime-trace/validation'
import { RuntimeTraceJournal } from './journal'
import { sanitizeRuntimeTrace } from './privacy'
import { conductorTask, type TaskRuntimeObservation } from './conductor'

export interface RuntimeTraceSession { id: string; workspaceId: string; directory: string; parentSessionId?: string }
export interface RuntimeTraceHealth { workspaceId: string; sessionId: string; rootRunId: string; coverage: TraceCoverage }
export interface RuntimeTraceRun {
  rootRunId: string; rootSessionId: string; runId: string; agentId: string; parentAgentId?: string
  sessionId: string; workspaceId: string; attemptId: string; startedAt: number
}
const ID = /^[a-zA-Z0-9_-]{1,200}$/
const DEFAULT_COVERAGE: TraceCoverage = { state: 'partial', source: 'runtime', missing: ['executor-unpublished-context', 'unpublished-decision-explanations'] }
const UNAVAILABLE: TraceCoverage = { state: 'unavailable', source: 'runtime', missing: ['runtime-events'], reason: 'This session predates runtime observation recording.' }

/** Owns observation identity and delivery only; sessions remain the sole execution authority. */
export class RuntimeTraceService {
  private active = new Map<string, RuntimeTraceRun>()
  private delegated = new Map<string, RuntimeTraceRun>()
  private journals = new Map<string, RuntimeTraceJournal<RuntimeEvent>>()
  private journalLeases = new Map<string, number>()
  private journalAccess = new Map<string, number>()
  private accessClock = 0
  private sourceSeq = new Map<string, number>()
  private sourceRoots = new Map<string, string>()
  private seen = new Set<string>()
  private tools = new Map<string, { run: RuntimeTraceRun; startedAt: number; name: string; command?: string; shell?: string; cwd?: string; structuredTerminal?: boolean }>()
  private providerTurns = new Map<string, RuntimeTraceRun>()
  private terminalRuns = new Set<string>()
  private nativeRuns = new Map<string, RuntimeTraceRun>()
  private backgroundAliases = new Map<string, string>()
  private conductorRuns = new Map<string, RuntimeTraceRun>()
  private recordingFailures = new Map<string, TraceCoverage>()
  private preciseTerminals = new Set<string>()
  constructor(private readonly resolveSession: (id: string) => RuntimeTraceSession | undefined, private readonly emit: (event: RuntimeEvent) => void, private readonly emitHealth?: (health: RuntimeTraceHealth) => void, private readonly journalCacheLimit = 64) {}

  private recordingFailed(run: RuntimeTraceRun, error: unknown): void {
    const reason = String(sanitizeRuntimeTrace(error instanceof Error ? error.message : String(error))).slice(0, 500)
    const coverage: TraceCoverage = { ...DEFAULT_COVERAGE, missing: [...DEFAULT_COVERAGE.missing, 'recording-failure'], reason }
    this.recordingFailures.set(run.rootRunId, coverage)
    try { this.emitHealth?.({ workspaceId: run.workspaceId, sessionId: run.rootSessionId, rootRunId: run.rootRunId, coverage }) } catch { /* A failed diagnostic delivery never changes execution. */ }
  }

  private coverage(rootRunId: string, rows: RuntimeEvent[], integrity: 'complete' | 'partial'): TraceCoverage {
    const recorded = this.recordingFailures.get(rootRunId) ?? DEFAULT_COVERAGE
    const missing = new Set(recorded.missing)
    if (integrity === 'partial' || rows.some(row => !isRuntimeEvent(row))) missing.add('journal-corruption')
    const sourceSequences = new Map<string, number>()
    for (const row of rows) {
      if (!isRuntimeEvent(row)) continue
      if (row.kind === 'trace.coverage') for (const gap of row.payload.coverage.missing) missing.add(gap)
      const previous = sourceSequences.get(row.sourceId)
      if (previous !== undefined && row.sourceSeq > previous + 1) missing.add('recording-failure')
      sourceSequences.set(row.sourceId, Math.max(previous ?? 0, row.sourceSeq))
    }
    return { ...recorded, missing: [...missing], ...(missing.has('recording-failure') && !recorded.reason ? { reason: 'A producer sequence gap indicates missing runtime observations.' } : {}) }
  }

  private session(id: string, workspaceId?: string): RuntimeTraceSession {
    const session = this.resolveSession(id)
    if (!session || (workspaceId && session.workspaceId !== workspaceId)) throw new Error('Runtime trace session access denied')
    return session
  }
  private scopedEvent(event: unknown, workspaceId: string, rootSessionId: string, rootRunId: string): event is RuntimeEvent {
    if (!isRuntimeEvent(event) || event.workspaceId !== workspaceId || event.rootSessionId !== rootSessionId || event.rootRunId !== rootRunId) return false
    // A recovered row cannot enlarge the query's authority. Deleted child sessions retain their
    // historical observations; existing sessions must still have the same authorized lineage.
    let session = this.resolveSession(event.sessionId ?? rootSessionId)
    if (!session) return true
    for (let index = 0; session && index < 100; index++) {
      if (session.workspaceId !== workspaceId) return false
      if (session.id === rootSessionId) return true
      session = session.parentSessionId ? this.resolveSession(session.parentSessionId) : undefined
    }
    return false
  }
  private directory(session: RuntimeTraceSession, rootRunId: string): string {
    if (!ID.test(rootRunId)) throw new Error('Invalid runtime run id')
    return join(session.directory, 'meta', 'runtime-trace', rootRunId)
  }
  private async withJournal<T>(run: Pick<RuntimeTraceRun, 'rootSessionId' | 'rootRunId' | 'workspaceId'>, read: (journal: RuntimeTraceJournal<RuntimeEvent>) => Promise<T>): Promise<T> {
    const session = this.session(run.rootSessionId, run.workspaceId)
    const directory = this.directory(session, run.rootRunId)
    let journal = this.journals.get(directory)
    if (!journal) { journal = new RuntimeTraceJournal(directory); this.journals.set(directory, journal) }
    // Acquire synchronously before yielding: no second journal instance can append the same root concurrently.
    this.journalLeases.set(directory, (this.journalLeases.get(directory) ?? 0) + 1)
    this.journalAccess.set(directory, ++this.accessClock)
    try { return await read(journal) }
    finally {
      const leases = (this.journalLeases.get(directory) ?? 1) - 1
      if (leases) this.journalLeases.set(directory, leases)
      else this.journalLeases.delete(directory)
      this.trimJournalCache()
    }
  }

  private trimJournalCache(): void {
    const activeRoots = new Set([...this.active.values(), ...this.conductorRuns.values()].filter(run => !this.terminalRuns.has(run.runId)).map(run => run.rootRunId))
    const idle = [...this.journals.keys()].filter(directory => !this.journalLeases.has(directory) && !activeRoots.has(directory.split(/[\\/]/).at(-1)!))
      .sort((a, b) => (this.journalAccess.get(a) ?? 0) - (this.journalAccess.get(b) ?? 0))
    for (const directory of idle) {
      if (this.journals.size <= Math.max(1, this.journalCacheLimit)) break
      this.journals.delete(directory)
      this.journalAccess.delete(directory)
      const rootRunId = directory.split(/[\\/]/).at(-1)!
      for (const [sourceId, root] of this.sourceRoots) if (root === rootRunId) { this.sourceSeq.delete(sourceId); this.sourceRoots.delete(sourceId) }
    }
  }

  private async nextSourceSequence(run: RuntimeTraceRun, sourceId: string): Promise<number> {
    let previous = this.sourceSeq.get(sourceId)
    if (previous === undefined) {
      const recorded = await this.withJournal(run, journal => journal.all())
      const durable = recorded.rows.reduce((seq, event) => event.sourceId === sourceId ? Math.max(seq, event.sourceSeq) : seq, 0)
      // Concurrent callers may have resumed this source while the journal was loading.
      previous = Math.max(durable, this.sourceSeq.get(sourceId) ?? 0)
    }
    const next = previous + 1
    this.sourceSeq.set(sourceId, next)
    this.sourceRoots.set(sourceId, run.rootRunId)
    return next
  }

  /** Diagnostics for bounded-cache tests; contents remain exclusively in authorized session journals. */
  getCachedJournalCount(): number { return this.journals.size }

  async content(run: RuntimeTraceRun, value: string): Promise<RuntimeContent> {
    const text = sanitizeRuntimeTrace(value) as string
    const byteLength = Buffer.byteLength(text)
    if (byteLength <= 8192) return { text, byteLength, availability: 'available', tokens: unknown('not-emitted') }
    try {
      const ref = await this.withJournal(run, journal => journal.storeContent(text))
      return { text: text.slice(0, 4096), payloadRef: ref.id, byteLength, truncated: ref.truncated, availability: 'available', tokens: unknown('not-emitted') }
    } catch (error) { this.recordingFailed(run, error); throw error }
  }

  private async boundedPayload(run: RuntimeTraceRun, value: unknown): Promise<unknown> {
    const safe = sanitizeRuntimeTrace(value)
    // Only RuntimeContent.text is externalized. Native command/prompt structures stay well typed.
    const walk = async (node: unknown): Promise<unknown> => {
      if (!node || typeof node !== 'object') return node
      if (Array.isArray(node)) return await Promise.all(node.map(walk))
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(node)) result[key] = key === 'text' && typeof entry === 'string' && Buffer.byteLength(entry) > 8192 ? entry.slice(0, 4096) : await walk(entry)
      if (typeof (node as Record<string, unknown>).text === 'string' && Buffer.byteLength((node as { text: string }).text) > 8192) {
        const text = (node as { text: string }).text
        const ref = await this.withJournal(run, journal => journal.storeContent(text))
        result.payloadRef = ref.id; result.byteLength = Buffer.byteLength(text); result.truncated = ref.truncated
      }
      return result
    }
    return await walk(safe)
  }

  async record<K extends RuntimeEventKind>(run: RuntimeTraceRun, kind: K, payload: RuntimeEventPayloads[K], extra: Partial<RuntimeEvent> = {}): Promise<RuntimeEvent> {
    try {
      const sourceId = extra.sourceId ?? `rox-session:${run.sessionId}:${run.runId}`
      const sourceSeq = extra.sourceSeq ?? await this.nextSourceSequence(run, sourceId)
      const now = Date.now()
      const eventId = randomUUID()
      // Only producer/correlation metadata is admitted from an executor; scope and sequence belong to this collector.
      const metadata = Object.fromEntries(['eventId', 'sourceEventId', 'sourceId', 'sourceSeq', 'spanId', 'parentSpanId', 'providerTurnId', 'providerCallId', 'messageId', 'toolUseId', 'causationEventId', 'occurredAt', 'clockDomain', 'elapsedMs', 'origin'].filter(key => (extra as Record<string, unknown>)[key] !== undefined).map(key => [key, (extra as Record<string, unknown>)[key]]))
      if (JSON.stringify(sanitizeRuntimeTrace(metadata)) !== JSON.stringify(metadata)) throw new Error('Sensitive producer metadata withheld before runtime recording')
      const observation = { schemaVersion: 1, eventId, sourceEventId: eventId, sourceId, sourceSeq,
        occurredAt: known(now, 'server-observation-receipt'), clockDomain: 'server-wall', origin: 'observed', ...metadata,
        workspaceId: run.workspaceId, rootSessionId: run.rootSessionId, sessionId: run.sessionId,
        rootRunId: run.rootRunId, runId: run.runId, agentId: run.agentId, parentAgentId: run.parentAgentId,
        attemptId: typeof extra.attemptId === 'string' ? extra.attemptId : run.attemptId, kind, payload }
      if (!isRuntimeObservation(observation)) throw new Error(`Invalid collected runtime observation: ${kind}`)
      const bounded = await this.boundedPayload(run, payload)
      const safeObservation = { ...observation, payload: bounded }
      if (!isRuntimeObservation(safeObservation)) throw new Error(`Invalid sanitized runtime observation: ${kind}`)
      const event = await this.withJournal(run, journal => journal.append(seq => {
        const candidate = { ...safeObservation, seq, receivedAt: now } as RuntimeEvent
        if (!isRuntimeEvent(candidate)) throw new Error(`Invalid collected runtime event: ${kind}`)
        return candidate
      }))
      this.emit(event)
      return event
    } catch (error) { this.recordingFailed(run, error); throw error }
  }

  async begin(sessionId: string, prompt: string, options: { messageId?: string; launch?: RuntimeEventPayloads['run.accepted']['launch']; retry?: boolean; preserveActive?: boolean } = {}): Promise<RuntimeTraceRun> {
    const session = this.session(sessionId)
    const previous = this.active.get(sessionId)
    if (options.retry && previous) {
      const retry = { ...previous, attemptId: randomUUID() }
      this.active.set(sessionId, retry)
      await this.record(retry, 'attempt.started', { status: 'running', description: 'Server authentication/failover retry' }, { messageId: options.messageId })
      return retry
    }
    const parent = this.delegated.get(sessionId)
    this.delegated.delete(sessionId)
    const rootRunId = parent?.rootRunId ?? `run-${randomUUID()}`
    const run: RuntimeTraceRun = { rootRunId, rootSessionId: parent?.rootSessionId ?? sessionId,
      runId: parent ? `run-${randomUUID()}` : rootRunId, agentId: `session:${sessionId}`,
      parentAgentId: parent?.agentId, sessionId, workspaceId: session.workspaceId, attemptId: randomUUID(), startedAt: Date.now() }
    if (!options.preserveActive) this.active.set(sessionId, run)
    if (parent) await this.writeLink(session, rootRunId, run.rootSessionId)
    await this.record(run, 'run.accepted', { prompt: await this.content(run, prompt), launch: options.launch ?? { kind: parent ? 'delegated' : 'manual' } }, { messageId: options.messageId })
    await this.record(run, 'run.started', { status: 'running' }, { messageId: options.messageId })
    return run
  }
  getActive(sessionId: string) { return this.active.get(sessionId) }

  async assign(parentSessionId: string, childSessionId: string, assignment: Omit<RuntimeEventPayloads['agent.assigned']['assignment'], 'agentId' | 'parentAgentId'>, parentRun?: RuntimeTraceRun): Promise<void> {
    const parent = parentRun ?? this.active.get(parentSessionId)
    if (!parent) return
    const child = this.session(childSessionId, parent.workspaceId)
    if (child.parentSessionId !== parentSessionId) throw new Error('Runtime trace child lineage mismatch')
    this.delegated.set(childSessionId, parent)
    await this.writeLink(child, parent.rootRunId, parent.rootSessionId)
    await this.record(parent, 'agent.assigned', { assignment: { ...assignment, agentId: `session:${childSessionId}`, parentAgentId: parent.agentId } })
  }

  async capture(sessionId: string, snapshot: RuntimeContextSnapshot, messageId?: string): Promise<void> {
    const run = this.active.get(sessionId)
    if (run) await this.record(run, 'context.captured', { snapshot }, { messageId })
  }

  async observe(sessionId: string, observation: RuntimeAgentObservation): Promise<void> {
    if (!isRuntimeAgentObservation(observation)) throw new Error('Invalid native runtime observation')
    const current = this.active.get(sessionId)
    if (!current) return
    const parentId = observation.parentAgentId === 'root' ? current.agentId : observation.parentAgentId ? `${current.agentId}:native:${observation.parentAgentId}` : current.parentAgentId
    const agentId = observation.agentId === 'root' ? current.agentId : `${current.agentId}:native:${observation.agentId}`
    const nativeKey = `${sessionId}:${observation.sourceId}:${observation.agentId}`
    const run = observation.agentId === 'root' ? { ...current, agentId, parentAgentId: parentId }
      : this.nativeRuns.get(nativeKey) ?? { ...current, runId: `${current.runId}:native:${observation.agentId}`, agentId, parentAgentId: parentId }
    if (observation.agentId !== 'root') this.nativeRuns.set(nativeKey, run)
    const terminalTool = observation.agentId === 'root' && observation.kind.startsWith('terminal.') && observation.toolUseId
    const toolEvidence = terminalTool || (observation.agentId === 'root' && observation.kind === 'trace.coverage' && observation.toolUseId)
    const toolRun = toolEvidence ? this.tools.get(`${sessionId}:${observation.toolUseId}`)?.run : undefined
    const correlatedRun = toolRun ?? run
    const sourceKey = `${correlatedRun.rootRunId}:${observation.sourceId}:${observation.sourceEventId}`
    if (this.seen.has(sourceKey)) return
    this.seen.add(sourceKey)
    const payload = structuredClone(observation.payload) as Record<string, unknown>
    if (observation.kind === 'agent.assigned') {
      const assignment = payload.assignment as RuntimeEventPayloads['agent.assigned']['assignment']
      assignment.agentId = assignment.agentId === 'root' ? current.agentId : `${current.agentId}:native:${assignment.agentId}`
      if (assignment.parentAgentId) assignment.parentAgentId = assignment.parentAgentId === 'root' ? current.agentId : `${current.agentId}:native:${assignment.parentAgentId}`
    }
    const parentToolRun = observation.parentAgentId === 'root' && observation.parentSpanId?.startsWith('tool:')
      ? this.tools.get(`${sessionId}:${observation.parentSpanId.slice(5)}`)?.run : undefined
    if (terminalTool) this.preciseTerminals.add(`${sessionId}:${observation.toolUseId}`)
    try {
      await this.record(correlatedRun, observation.kind, payload as never, { ...observation, ...(parentToolRun ? { parentSpanId: `${parentToolRun.runId}:${observation.parentSpanId}` } : {}), ...(toolEvidence ? { spanId: `${correlatedRun.runId}:tool:${observation.toolUseId}` } : {}), agentId: toolRun?.agentId ?? agentId, parentAgentId: toolRun ? toolRun.parentAgentId : parentId, eventId: `${correlatedRun.rootRunId}:${observation.sourceId}:${observation.sourceEventId}` } as Partial<RuntimeEvent>)
    } catch (error) { this.seen.delete(sourceKey); throw error }
  }

  async finish(sessionId: string, reason: 'complete' | 'interrupted' | 'error' | 'timeout'): Promise<void> {
    const run = this.active.get(sessionId)
    if (!run || this.terminalRuns.has(run.runId)) return
    this.terminalRuns.add(run.runId)
    const status = reason === 'complete' ? 'succeeded' : reason === 'error' || reason === 'timeout' ? 'failed' : 'interrupted'
    await this.record(run, reason === 'complete' ? 'run.completed' : 'run.interrupted', { status, reason } as never)
    if (run.parentAgentId) await this.record(run, 'agent.completed', { status })
  }

  /** Correlates late tool/background output with the run which actually launched it. */
  async agentEvent(sessionId: string, event: { type: string; [key: string]: unknown }, options: { structuredHostTerminals?: boolean } = {}): Promise<void> {
    const current = this.active.get(sessionId)
    if (!current) return
    if (event.type === 'runtime_observation') return await this.observe(sessionId, event.observation as RuntimeAgentObservation)
    const backgroundId = typeof event.taskId === 'string' ? event.taskId : typeof event.shellId === 'string' ? event.shellId : undefined
    const toolUseId = typeof event.toolUseId === 'string' ? event.toolUseId : backgroundId ? this.backgroundAliases.get(`${sessionId}:${backgroundId}`) : undefined
    const toolKey = toolUseId ? `${sessionId}:${toolUseId}` : undefined
    const prior = toolKey ? this.tools.get(toolKey) : undefined
    const providerTurnId = typeof event.turnId === 'string' ? event.turnId : undefined
    const turnKey = providerTurnId ? `${sessionId}:${providerTurnId}` : undefined
    const run = prior?.run ?? (turnKey ? this.providerTurns.get(turnKey) : undefined) ?? current
    if (turnKey && !this.providerTurns.has(turnKey)) this.providerTurns.set(turnKey, run)
    const extra = { toolUseId, providerTurnId, spanId: toolUseId ? `${run.runId}:tool:${toolUseId}` : undefined,
      parentSpanId: typeof event.parentToolUseId === 'string' ? `${run.runId}:tool:${event.parentToolUseId}` : undefined }
    const content = async (value: unknown) => await this.content(run, typeof value === 'string' ? value : JSON.stringify(sanitizeRuntimeTrace(value ?? {})))
    if (event.type === 'tool_start' && toolKey) {
      const input = (event.input ?? {}) as Record<string, unknown>
      const name = String(event.toolName)
      const terminal = /^(?:bash|shell|terminal|mcp__session__bash)$/i.test(name)
      this.tools.set(toolKey, { run, startedAt: Date.now(), name, structuredTerminal: terminal && options.structuredHostTerminals, command: terminal ? String(input.command ?? input.cmd ?? '') : undefined, shell: typeof input.shell === 'string' ? input.shell : undefined, cwd: typeof input.cwd === 'string' ? input.cwd : undefined })
      await this.record(run, 'tool.started', { name, input: await content(input), status: 'running' }, extra)
      if (terminal && !options.structuredHostTerminals && !this.preciseTerminals.has(toolKey)) await this.record(run, 'terminal.started', { command: String(input.command ?? input.cmd ?? ''), shell: typeof input.shell === 'string' ? input.shell : undefined, cwd: typeof input.cwd === 'string' ? input.cwd : undefined, status: 'running' }, extra)
    } else if (event.type === 'tool_result') {
      const status = event.isError ? 'failed' : 'succeeded'
      await this.record(run, 'tool.completed', { name: String(event.toolName ?? prior?.name ?? 'tool'), result: await content(event.result), status }, extra)
      if (prior?.command !== undefined && !prior.structuredTerminal && (!toolKey || !this.preciseTerminals.has(toolKey))) await this.record(run, 'terminal.completed', { command: prior.command, shell: prior.shell, cwd: prior.cwd, stdout: await content(event.result), exitCode: unknown('not-emitted'), status }, extra)
    } else if (event.type === 'thinking_delta' || event.type === 'thinking_complete') {
      await this.record(run, 'reasoning.output', { content: await content(event.text), provenance: 'provider', complete: event.type === 'thinking_complete' }, extra)

    } else if (event.type === 'retry') {
      const attemptRun = event.phase === 'active' ? { ...current, attemptId: randomUUID() } : run
      if (event.phase === 'active') this.active.set(sessionId, attemptRun)
      await this.record(attemptRun, event.phase === 'end' ? 'attempt.completed' : event.phase === 'active' ? 'attempt.started' : 'operation.queued', event.phase === 'backoff' ? { description: String(event.message ?? 'Provider backoff') } : { status: event.phase === 'end' ? 'succeeded' : 'running' }, extra)
    } else if (event.type === 'text_discard') {
      await this.record(run, 'attempt.completed', { status: 'failed', description: 'Provider discarded output before retry' }, extra)
    } else if (event.type === 'permission_request') {
      await this.record(run, 'approval.requested', { id: String(event.requestId), kind: 'permission', description: String(event.description ?? '') }, extra)
    } else if (event.type === 'error' || event.type === 'typed_error') {
      await this.record(run, 'attempt.completed', { status: 'failed', description: String(event.message ?? (event.error as Record<string, unknown>)?.message ?? '') }, extra)
    } else if (event.type === 'task_backgrounded' || event.type === 'shell_backgrounded') {
      if (backgroundId && toolUseId) this.backgroundAliases.set(`${sessionId}:${backgroundId}`, toolUseId)
      await this.record(run, 'operation.queued', { description: String(event.intent ?? event.taskId ?? event.shellId ?? event.type) }, extra)
    } else if (event.type === 'task_progress') {
      await this.record(run, 'tool.output', { name: prior?.name ?? 'task', status: 'running', result: { ...(await content({ elapsedSeconds: event.elapsedSeconds })), isDelta: false } }, extra)
    } else if (event.type === 'task_completed' || event.type === 'shell_killed') {
      await this.record(run, 'tool.completed', { name: prior?.name ?? (event.type === 'shell_killed' ? 'shell' : 'task'), status: event.status === 'failed' ? 'failed' : event.status === 'stopped' || event.type === 'shell_killed' ? 'cancelled' : 'succeeded', result: await content(event.summary ?? '') }, extra)
    } else if (event.type === 'complete' && event.usage) {
      const usage = event.usage as Record<string, unknown>
      const measure = (key: string) => typeof usage[key] === 'number' && Number.isFinite(usage[key]) ? known(usage[key] as number, 'provider-usage') : unknown('not-emitted')
      await this.record(run, 'usage.reported', { usage: { providerCallId: `${run.runId}:${providerTurnId ?? run.attemptId}`, scope: 'aggregate', source: 'AgentEvent.complete.usage', inputTokens: measure('inputTokens'), outputTokens: measure('outputTokens'), cacheReadTokens: measure('cacheReadTokens'), cacheWriteTokens: measure('cacheCreationTokens'), cost: measure('costUsd'), currency: 'USD', final: true } }, extra)
    } else if (event.type === 'usage_update') {
      const usage = event.usage as Record<string, unknown>
      await this.record(run, 'usage.reported', { usage: { providerCallId: `${run.runId}:${providerTurnId ?? run.attemptId}`, scope: 'aggregate', source: 'AgentEvent.usage_update', inputTokens: typeof usage.inputTokens === 'number' ? known(usage.inputTokens, 'provider-usage') : unknown(), outputTokens: unknown(), final: false } }, extra)
    }
  }

  async conductor(observation: TaskRuntimeObservation): Promise<void> {
    const { spec, entry, taskRunId, orchestratorSessionId } = observation
    if (!orchestratorSessionId) return
    const key = `${orchestratorSessionId}:${taskRunId}`
    if (entry.kind === 'run-started') {
      const run = await this.begin(orchestratorSessionId, spec.goal, { launch: { kind: 'manual', triggerId: `task:${spec.id}:${taskRunId}` }, preserveActive: true })
      this.conductorRuns.set(key, run)
      await this.record(run, 'plan.published', { plan: { id: `task:${taskRunId}`, title: spec.title, version: 1,
        tasks: spec.nodes.map(node => conductorTask(spec, taskRunId, node.id, 'queued')) } })
      return
    }
    const run = this.conductorRuns.get(key)
    if (!run) return
    const extra = { occurredAt: known(Date.parse(entry.t), 'TaskRunner.durable-log'), clockDomain: 'server-wall' }
    if (entry.kind === 'node-scheduled' || entry.kind === 'node-spawned' || entry.kind === 'node-finished' || entry.kind === 'node-retry') {
      const status: RuntimeStatus = entry.kind === 'node-finished' ? entry.state === 'done' || entry.state === 'skipped' ? 'succeeded' : entry.state === 'cancelled' ? 'cancelled' : entry.state === 'failed' ? 'failed' : 'running'
        : entry.kind === 'node-retry' ? 'queued' : 'running'
      await this.record(run, 'task.state-changed', { task: conductorTask(spec, taskRunId, entry.nodeId, status, 'sessionId' in entry ? entry.sessionId : undefined) }, extra)
      if (entry.kind === 'node-finished' && entry.state === 'done') {
        await this.record(run, 'artifact.created', { artifact: { id: `task-output:${taskRunId}:${entry.nodeId}`, label: `${entry.nodeId} result`, kind: 'task-node-output', uri: `task://${spec.id}/${taskRunId}/nodes/${entry.nodeId}`, content: { availability: 'not-recorded' } } }, extra)
      }
    } else if (entry.kind === 'run-verifying') {
      await this.record(run, 'acceptance.started', { acceptance: { id: `task-verdict:${taskRunId}`, criterion: spec.acceptance_criteria ?? 'TaskRunner final verification', status: 'running', evidence: [], authorityRef: `tasks/${spec.id}/runs/${taskRunId}/run-log.jsonl` } }, extra)
    } else if (entry.kind === 'verdict') {
      await this.record(run, 'acceptance.completed', { acceptance: { id: `task-verdict:${taskRunId}`, criterion: spec.acceptance_criteria ?? 'TaskRunner final verification', status: entry.result === 'pass' ? 'passed' : entry.result === 'fail' ? 'failed' : 'unknown',
        evidence: [await this.content(run, JSON.stringify({ authority: 'TaskRunner', result: entry.result, reason: entry.reason, nodes: entry.nodes, recordedAt: entry.t }))], authorityRef: `tasks/${spec.id}/runs/${taskRunId}/run-log.jsonl` } }, extra)
    } else if (entry.kind === 'run-completed' || entry.kind === 'run-failed' || entry.kind === 'run-stopped') {
      this.terminalRuns.add(run.runId)
      await this.record(run, entry.kind === 'run-completed' ? 'run.completed' : 'run.interrupted', { status: entry.kind === 'run-completed' ? 'succeeded' : entry.kind === 'run-stopped' ? 'cancelled' : 'failed', reason: `TaskRunner.${entry.kind}` } as never, extra)
    }
  }

  getConductorRun(orchestratorSessionId: string, taskRunId: string) { return this.conductorRuns.get(`${orchestratorSessionId}:${taskRunId}`) }

  async publishMessage(sessionId: string, messageId: string, text: string, providerTurnId?: string, intermediate = false): Promise<void> {
    if (intermediate) return
    const run = (providerTurnId ? this.providerTurns.get(`${sessionId}:${providerTurnId}`) : undefined) ?? this.active.get(sessionId)
    if (run) await this.record(run, 'result.published', { content: await this.content(run, text) }, { messageId, providerTurnId })
  }
  async resolveApproval(sessionId: string, requestId: string, approved: boolean): Promise<void> {
    const run = this.active.get(sessionId)
    if (run) await this.record(run, 'approval.resolved', { id: requestId, approved })
  }

  private async writeLink(session: RuntimeTraceSession, rootRunId: string, rootSessionId: string): Promise<void> {
    const directory = this.directory(session, rootRunId)
    for (const part of [session.directory, join(session.directory, 'meta'), join(session.directory, 'meta', 'runtime-trace'), directory]) {
      await mkdir(part, { recursive: true, mode: 0o700 })
      if ((await lstat(part)).isSymbolicLink()) throw new Error('Runtime trace link directory must not be a symlink')
    }
    const file = await open(join(directory, 'root.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600)
    try { await file.writeFile(JSON.stringify({ rootSessionId })) } finally { await file.close() }
  }
  private async rootForQuery(query: RuntimeTraceQuery & { rootRunId: string }): Promise<string> {
    const session = this.session(query.sessionId, query.workspaceId)
    const linkPath = join(this.directory(session, query.rootRunId), 'root.json')
    try {
      if ((await lstat(linkPath)).isSymbolicLink()) throw new Error('Runtime trace link must not be a symlink')
      const file = await open(linkPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let rootSessionId: string
      try { if ((await file.stat()).size > 4096) throw new Error('Runtime link exceeds limit'); rootSessionId = JSON.parse(await file.readFile('utf8')).rootSessionId } finally { await file.close() }
      this.session(rootSessionId, query.workspaceId)
      let ancestor: RuntimeTraceSession | undefined = session
      for (let i = 0; ancestor && i < 100; i++) {
        if (ancestor.workspaceId !== query.workspaceId) throw new Error('Runtime trace root lineage access denied')
        if (ancestor.id === rootSessionId) return rootSessionId
        ancestor = ancestor.parentSessionId ? this.resolveSession(ancestor.parentSessionId) : undefined
      }
      throw new Error('Runtime trace root lineage access denied')
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return session.id; throw error }
  }
  private async runsFor(session: RuntimeTraceSession): Promise<string[]> {
    try {
      for (const part of [session.directory, join(session.directory, 'meta'), join(session.directory, 'meta', 'runtime-trace')]) {
        if ((await lstat(part)).isSymbolicLink()) throw new Error('Runtime trace root must not be a symlink')
      }
      return (await readdir(join(session.directory, 'meta', 'runtime-trace'), { withFileTypes: true })).filter(item => item.isDirectory() && ID.test(item.name)).map(item => item.name) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  async getSnapshot(query: RuntimeTraceQuery): Promise<RuntimeTraceSnapshot> {
    const session = this.session(query.sessionId, query.workspaceId)
    const runIds = await this.runsFor(session)
    const runs: RuntimeRunSummary[] = []
    for (const rootRunId of runIds) {
      const rootSessionId = await this.rootForQuery({ ...query, rootRunId })
      const page = await this.withJournal({ rootSessionId, rootRunId, workspaceId: query.workspaceId }, journal => journal.all())
      const valid = page.rows.filter(event => this.scopedEvent(event, query.workspaceId, rootSessionId, rootRunId))
      const first = valid.find(event => event.kind === 'run.accepted')
      if (!first || first.kind !== 'run.accepted') continue
      const terminal = [...valid].reverse().find(event => (event.kind === 'run.completed' || event.kind === 'run.interrupted') && event.runId === rootRunId)
      runs.push({ rootRunId, sessionId: rootSessionId, agentId: first.agentId, status: terminal && (terminal.kind === 'run.completed' || terminal.kind === 'run.interrupted') ? terminal.payload.status : 'running', startedAt: first.receivedAt, prompt: sanitizeRuntimeTrace(first.payload.prompt.text ?? '') as string, coverage: this.coverage(rootRunId, valid, valid.length === page.rows.length ? page.integrity : 'partial') })
    }
    runs.sort((a, b) => a.startedAt - b.startedAt)
    const chatRun = this.active.get(query.sessionId)
    const activeRun = chatRun && !this.terminalRuns.has(chatRun.runId) ? chatRun : [...this.conductorRuns.values()].reverse().find(run => run.sessionId === query.sessionId && !this.terminalRuns.has(run.runId))
    const selected = query.rootRunId ?? activeRun?.rootRunId ?? runs.at(-1)?.rootRunId
    if (!selected || !runIds.includes(selected)) return { schemaVersion: 1, workspaceId: query.workspaceId, sessionId: query.sessionId, runs, activeRootRunId: activeRun?.rootRunId, events: [], coverage: selected && this.recordingFailures.get(selected) || UNAVAILABLE }
    const page = await this.readEvents({ ...query, rootRunId: selected, afterSeq: 0 })
    return { schemaVersion: 1, workspaceId: query.workspaceId, sessionId: query.sessionId, runs, activeRootRunId: activeRun?.rootRunId, events: page.events, cursor: page.cursor, coverage: page.coverage, hasMore: page.hasMore }
  }
  async readEvents(query: RuntimeEventsQuery): Promise<RuntimeEventsPage> {
    if (!Number.isSafeInteger(query.afterSeq) || query.afterSeq < 0) throw new Error('Invalid runtime cursor')
    const session = this.session(query.sessionId, query.workspaceId)
    if (!(await this.runsFor(session)).includes(query.rootRunId)) throw new Error('Runtime run does not belong to session')
    const rootSessionId = await this.rootForQuery(query)
    const { page, all } = await this.withJournal({ rootSessionId, rootRunId: query.rootRunId, workspaceId: query.workspaceId }, async journal => ({ page: await journal.snapshot(query.afterSeq, query.limit), all: await journal.all() }))
    const scoped = (event: unknown): event is RuntimeEvent => this.scopedEvent(event, query.workspaceId, rootSessionId, query.rootRunId)
    const valid = page.rows.filter(scoped).map(event => sanitizeRuntimeTrace(event) as RuntimeEvent)
    const validAll = all.rows.filter(scoped)
    return { events: valid, cursor: { rootRunId: query.rootRunId, seq: page.cursor }, hasMore: page.hasMore, coverage: this.coverage(query.rootRunId, validAll, validAll.length === all.rows.length ? all.integrity : 'partial') }
  }
  async readPayload(query: RuntimePayloadQuery): Promise<RuntimePayloadPage> {
    const rootSessionId = await this.rootForQuery(query)
    const owner = this.session(query.sessionId, query.workspaceId)
    if (!(await this.runsFor(owner)).includes(query.rootRunId)) throw new Error('Runtime run does not belong to session')
    return await this.withJournal({ rootSessionId, rootRunId: query.rootRunId, workspaceId: query.workspaceId }, async journal => {
      const page = await journal.all()
      const valid = page.rows.filter(event => this.scopedEvent(event, query.workspaceId, rootSessionId, query.rootRunId))
      // References are admitted only if the requested run actually published them.
      const hasRef = valid.some(event => JSON.stringify(event).includes(`"payloadRef":"${query.payloadRef}"`))
      if (!hasRef) throw new Error('Runtime payload does not belong to run')
      const storedContent = await journal.readContent(query.payloadRef)
      if (storedContent === null) throw new Error('Runtime payload unavailable')
      // Verify stored bytes first, then apply any secret values registered since recording.
      const content = sanitizeRuntimeTrace(storedContent) as string
      const offset = query.offset ?? 0
      const limit = query.limit ?? 65536
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 262144) throw new Error('Invalid runtime payload range')
      const text = content.slice(offset, offset + limit)
      const referenceTruncated = (node: unknown): boolean => {
        if (!node || typeof node !== 'object') return false
        if ((node as Record<string, unknown>).payloadRef === query.payloadRef && (node as Record<string, unknown>).truncated === true) return true
        return Object.values(node).some(referenceTruncated)
      }
      return { text, offset, nextOffset: offset + text.length < content.length ? offset + text.length : undefined, byteLength: Buffer.byteLength(content), truncated: valid.some(referenceTruncated) }
    })
  }
}
