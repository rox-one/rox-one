import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, readFile, readdir, symlink, appendFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeTraceService, type RuntimeTraceSession } from './service'
import { known, type RuntimeEvent } from '@rox/core/runtime-trace'
import { clearRegisteredSecretValues, registerSecretValues } from '@rox/shared/secrets/redact'

const roots: string[] = []
afterEach(async () => { clearRegisteredSecretValues(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'rox-runtime-service-')); roots.push(root)
  const sessions = new Map<string, RuntimeTraceSession>([
    ['parent', { id: 'parent', workspaceId: 'ws', directory: join(root, 'parent') }],
    ['child', { id: 'child', workspaceId: 'ws', directory: join(root, 'child'), parentSessionId: 'parent' }],
    ['foreign', { id: 'foreign', workspaceId: 'other', directory: join(root, 'foreign') }],
  ])
  const emitted: RuntimeEvent[] = []
  return { root, sessions, emitted, service: new RuntimeTraceService(id => sessions.get(id), event => emitted.push(event)) }
}

describe('runtime session collector', () => {
  it('records real tool inputs/results and usage, restores cursor and preserves parent child identity', async () => {
    const { service, sessions, emitted } = await setup()
    const parent = await service.begin('parent', 'inspect', { messageId: 'message-1' })
    await service.assign('parent', 'child', { name: 'research', task: { text: 'read it' }, prompt: { text: 'read it' }, nativeKind: 'rox-session', sessionId: 'child' })
    const child = await service.begin('child', 'read it')
    expect(child.rootRunId).toBe(parent.rootRunId)
    expect(child.parentAgentId).toBe(parent.agentId)
    await service.agentEvent('child', { type: 'tool_start', toolName: 'read', toolUseId: 'call-1', input: { path: 'README.md' }, turnId: 'native-turn-1' })
    await service.agentEvent('child', { type: 'tool_result', toolName: 'read', toolUseId: 'call-1', result: 'file text', isError: false, turnId: 'native-turn-1' })
    await service.agentEvent('child', { type: 'complete', usage: { inputTokens: 12, outputTokens: 3, costUsd: 0.001 } })
    await service.finish('child', 'complete')
    await service.finish('parent', 'complete')
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    const snapshot = await recovered.getSnapshot({ sessionId: 'parent', workspaceId: 'ws' })
    expect(snapshot.events).toHaveLength(emitted.length)
    expect(snapshot.runs[0]?.status).toBe('succeeded')
    const childSnapshot = await recovered.getSnapshot({ sessionId: 'child', workspaceId: 'ws' })
    expect(childSnapshot.events).toHaveLength(emitted.length)
    expect(snapshot.events.find(event => event.kind === 'tool.completed')?.agentId).toBe(child.agentId)
    expect(snapshot.events.find(event => event.kind === 'usage.reported')?.kind).toBe('usage.reported')
    const first = await recovered.readEvents({ sessionId: 'parent', workspaceId: 'ws', rootRunId: parent.rootRunId, afterSeq: 0, limit: 3 })
    const second = await recovered.readEvents({ sessionId: 'parent', workspaceId: 'ws', rootRunId: parent.rootRunId, afterSeq: first.cursor.seq })
    expect(first.events.map(event => event.seq)).toEqual([1, 2, 3])
    expect(second.events[0]?.seq).toBe(4)
  })

  it('keeps late tool output in its originating run after a new prompt starts', async () => {
    const { service, emitted } = await setup()
    const old = await service.begin('parent', 'old')
    await service.agentEvent('parent', { type: 'tool_start', toolName: 'bash', toolUseId: 'late-call', input: { command: 'printf safe' }, turnId: 'old-turn' })
    await service.finish('parent', 'interrupted')
    const next = await service.begin('parent', 'new')
    await service.agentEvent('parent', { type: 'tool_result', toolUseId: 'late-call', result: 'old output', isError: false, turnId: 'old-turn' })
    const last = emitted.at(-1)
    expect(last?.rootRunId).toBe(old.rootRunId)
    expect(last?.rootRunId).not.toBe(next.rootRunId)
  })

  it('deduplicates native child observations and maps nested native identities', async () => {
    const { service, emitted } = await setup()
    const run = await service.begin('parent', 'prompt')
    const obs = { kind: 'agent.started' as const, payload: { status: 'running' as const }, agentId: 'native-child', parentAgentId: 'root', sourceId: 'omp:one', sourceEventId: 'one', sourceSeq: 1, occurredAt: known(5, 'native'), clockDomain: 'omp', origin: 'observed' as const }
    await service.observe('parent', obs)
    await service.observe('parent', obs)
    expect(emitted.filter(event => event.kind === 'agent.started')).toHaveLength(1)
    expect(emitted.at(-1)?.agentId).toBe(`${run.agentId}:native:native-child`)
    expect(emitted.at(-1)?.parentAgentId).toBe(run.agentId)
  })

  it('normalizes genuine native root-dispatch parent spans from the exact recorded tool call', async () => {
    const { service, emitted } = await setup()
    const run = await service.begin('parent', 'prompt')
    await service.agentEvent('parent', { type: 'tool_start', toolName: 'task', toolUseId: 'exact-dispatch-call', input: {} })
    await service.observe('parent', { kind: 'agent.started', payload: { status: 'running' }, agentId: 'native-child', parentAgentId: 'root', parentSpanId: 'tool:exact-dispatch-call', sourceId: 'omp:real-reservation', sourceEventId: 'native-start', sourceSeq: 1, occurredAt: known(5, 'native'), clockDomain: 'omp', origin: 'observed' })
    expect(emitted.at(-1)?.parentSpanId).toBe(`${run.runId}:tool:exact-dispatch-call`)
    await service.observe('parent', { kind: 'agent.started', payload: { status: 'running' }, agentId: 'grandchild', parentAgentId: 'native-child', parentSpanId: 'native:child-native-session:tool:exact-child-call', sourceId: 'omp:real-reservation-2', sourceEventId: 'grandchild-start', sourceSeq: 1, occurredAt: known(6, 'native'), clockDomain: 'omp', origin: 'observed' })
    expect(emitted.at(-1)?.parentSpanId).toBe('native:child-native-session:tool:exact-child-call')
  })

  it('stores redacted large content and authorizes references by actual session/run ownership', async () => {
    const { service } = await setup()
    const run = await service.begin('parent', 'prompt')
    const content = await service.content(run, 'long-output '.repeat(3000) + ' api_key=must-never-appear')
    await service.record(run, 'result.published', { content })
    expect(content.payloadRef).toBeDefined()
    const page = await service.readPayload({ workspaceId: 'ws', sessionId: 'parent', rootRunId: run.rootRunId, payloadRef: content.payloadRef!, limit: 65536 })
    expect(page.text).not.toContain('must-never-appear')
    await expect(service.readEvents({ workspaceId: 'other', sessionId: 'parent', rootRunId: run.rootRunId, afterSeq: 0 })).rejects.toThrow('access denied')
    await expect(service.readPayload({ workspaceId: 'ws', sessionId: 'child', rootRunId: run.rootRunId, payloadRef: content.payloadRef! })).rejects.toThrow()
    await expect(service.readPayload({ workspaceId: 'ws', sessionId: 'parent', rootRunId: run.rootRunId, payloadRef: 'a'.repeat(64) })).rejects.toThrow('does not belong')
    await expect(service.readPayload({ workspaceId: 'ws', sessionId: 'parent', rootRunId: 'unknown-run', payloadRef: 'a'.repeat(64) })).rejects.toThrow('does not belong')
  })
  it('redacts quoted credentials, raw JSON and headers before inline transport, journal and blob writes', async () => {
    const { service, emitted, root } = await setup()
    const run = await service.begin('parent', 'prompt')
    const privateValues = ['unregistered quoted password', 'unregistered single password', 'unregistered cookie value', 'unregistered JSON key', 'unregistered ENV value']
    await service.agentEvent('parent', { type: 'tool_start', toolName: 'read', toolUseId: 'safe-call', input: { env: { CUSTOM: privateValues[4] }, password: privateValues[0] } })
    const serialized = JSON.stringify({ apiKey: privateValues[3], env: { CUSTOM: privateValues[4] }, inputTokens: 123, publicPadding: 'public '.repeat(3000) })
    await service.record(run, 'terminal.output', { command: `password="${privateValues[0]}" password='${privateValues[1]}'`, stdout: await service.content(run, serialized), stderr: await service.content(run, `Cookie: session=${privateValues[2]}; private-attribute=value`), status: 'running' })
    const directory = join(root, 'parent', 'meta', 'runtime-trace', run.rootRunId)
    const journal = await readFile(join(directory, 'events.jsonl'), 'utf8')
    const blobs = await Promise.all((await readdir(join(directory, 'content'))).map(name => readFile(join(directory, 'content', name), 'utf8')))
    expect(blobs.length).toBeGreaterThan(0)
    for (const value of privateValues) {
      expect(JSON.stringify(emitted)).not.toContain(value)
      expect(journal).not.toContain(value)
      expect(blobs.join('')).not.toContain(value)
    }
    expect(blobs.join('')).toContain('"inputTokens":123')
    const before = emitted.length
    await expect(service.record(run, 'agent.started', { status: 'running' }, { sourceId: 'password="producer private value"' })).rejects.toThrow('Sensitive producer metadata')
    expect(emitted).toHaveLength(before)
    expect(await readFile(join(directory, 'events.jsonl'), 'utf8')).not.toContain('producer private value')
  })

  it('rejects valid recovered rows outside the authorized root envelope and their payload references', async () => {
    const { service, sessions, emitted, root } = await setup()
    const run = await service.begin('parent', 'authorized prompt')
    const orphan = await service.content(run, 'orphan not-published payload '.repeat(1000))
    const template = emitted[0]!
    const foreignRows = [
      { ...template, workspaceId: 'other' },
      { ...template, rootSessionId: 'foreign' },
      { ...template, rootRunId: 'foreign-run' },
      { ...template, sessionId: 'foreign' },
    ].map((event, index) => ({ ...event, seq: emitted.length + index + 1, eventId: `tampered-row-${index}`, sourceEventId: `tampered-row-${index}`, kind: 'result.published', payload: { content: orphan } }))
    await appendFile(join(root, 'parent', 'meta', 'runtime-trace', run.rootRunId, 'events.jsonl'), foreignRows.map(event => JSON.stringify(event) + '\n').join(''))
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    const page = await recovered.readEvents({ workspaceId: 'ws', sessionId: 'parent', rootRunId: run.rootRunId, afterSeq: 0 })
    expect(page.events).toHaveLength(emitted.length)
    expect(page.events.some(event => event.eventId.startsWith('tampered-row'))).toBe(false)
    expect(page.coverage.missing).toContain('journal-corruption')
    const snapshot = await recovered.getSnapshot({ workspaceId: 'ws', sessionId: 'parent' })
    expect(snapshot.runs[0]?.prompt).toBe('authorized prompt')
    expect(snapshot.runs[0]?.coverage.missing).toContain('journal-corruption')
    await expect(recovered.readPayload({ workspaceId: 'ws', sessionId: 'parent', rootRunId: run.rootRunId, payloadRef: orphan.payloadRef! })).rejects.toThrow('does not belong')
  })

  it('redacts secrets registered after recording in event, prompt-summary and payload readback', async () => {
    const { service, sessions } = await setup()
    const secret = 'value-that-was-not-a-known-credential-before-registration'
    const run = await service.begin('parent', `inspect ${secret}`)
    const content = await service.content(run, 'public result '.repeat(1000) + secret)
    await service.record(run, 'result.published', { content })
    registerSecretValues([secret])
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    const snapshot = await recovered.getSnapshot({ workspaceId: 'ws', sessionId: 'parent' })
    expect(JSON.stringify(snapshot)).not.toContain(secret)
    const payload = await recovered.readPayload({ workspaceId: 'ws', sessionId: 'parent', rootRunId: run.rootRunId, payloadRef: content.payloadRef! })
    expect(payload.text).not.toContain(secret)
    expect(payload.text).toContain('***REDACTED***')
  })

  it('requires every persisted child-root lineage ancestor to belong to the requested workspace', async () => {
    const { service, sessions, root } = await setup()
    const run = await service.begin('parent', 'prompt')
    sessions.get('child')!.parentSessionId = 'foreign'
    sessions.get('foreign')!.parentSessionId = 'parent'
    const directory = join(root, 'child', 'meta', 'runtime-trace', run.rootRunId)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'root.json'), JSON.stringify({ rootSessionId: 'parent' }))
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    await expect(recovered.readEvents({ workspaceId: 'ws', sessionId: 'child', rootRunId: run.rootRunId, afterSeq: 0 })).rejects.toThrow('lineage access denied')
    await expect(recovered.getSnapshot({ workspaceId: 'ws', sessionId: 'child' })).rejects.toThrow('lineage access denied')
  })

  it('rejects malformed payloads before writing and prevents metadata from replacing collector scope', async () => {
    const { service, emitted, root } = await setup()
    const run = await service.begin('parent', 'prompt')
    const before = await service.getSnapshot({ sessionId: 'parent', workspaceId: 'ws' })
    await expect(service.record(run, 'tool.started', { name: 42, input: { text: 'invalid'.repeat(9000) } } as never)).rejects.toThrow('Invalid collected runtime observation')
    expect(await readdir(join(root, 'parent', 'meta', 'runtime-trace', run.rootRunId, 'content'))).toHaveLength(0)
    const after = await service.getSnapshot({ sessionId: 'parent', workspaceId: 'ws' })
    expect(after.events).toHaveLength(before.events.length)
    const safe = await service.record(run, 'agent.started', { status: 'running' }, { workspaceId: 'foreign', rootRunId: 'foreign', seq: 999 } as never)
    expect(safe.workspaceId).toBe('ws')
    expect(safe.rootRunId).toBe(run.rootRunId)
    expect(safe.seq).toBe(before.events.length + 1)
    expect(await readFile(join(root, 'parent', 'meta', 'runtime-trace', run.rootRunId, 'events.jsonl'), 'utf8')).not.toContain('"name":42')
  })

  it('reports failed disk recording through passive health, snapshots and recovered source gaps', async () => {
    const { root, sessions, emitted } = await setup()
    const health: import('./service').RuntimeTraceHealth[] = []
    const service = new RuntimeTraceService(id => sessions.get(id), event => emitted.push(event), state => health.push(state))
    const run = await service.begin('parent', 'prompt')
    const journalPath = join(root, 'parent', 'meta', 'runtime-trace', run.rootRunId, 'events.jsonl')
    const persisted = await readFile(journalPath, 'utf8')
    await rm(journalPath)
    await symlink(join(root, 'unrelated'), journalPath)
    await expect(service.record(run, 'agent.started', { status: 'running' })).rejects.toThrow('symlink')
    expect(health.at(-1)?.coverage.missing).toContain('recording-failure')
    expect(health.at(-1)?.rootRunId).toBe(run.rootRunId)
    await rm(journalPath)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(journalPath, persisted)
    await service.record(run, 'agent.completed', { status: 'succeeded' })
    const snapshot = await service.getSnapshot({ sessionId: 'parent', workspaceId: 'ws' })
    expect(snapshot.coverage.missing).toContain('recording-failure')
    expect(snapshot.events.filter(event => event.kind === 'agent.started')).toHaveLength(0)
    const recovered = new RuntimeTraceService(id => sessions.get(id), () => {})
    const replay = await recovered.readEvents({ sessionId: 'parent', workspaceId: 'ws', rootRunId: run.rootRunId, afterSeq: 0 })
    expect(replay.coverage.missing).toContain('recording-failure')
    expect(replay.events.map(event => event.seq)).toEqual([1, 2, 3])
  })

  it('keeps a structured host request as a tool until real executor evidence arrives', async () => {
    const { service, emitted } = await setup()
    await service.begin('parent', 'prompt')
    const options = { structuredHostTerminals: true }
    await service.agentEvent('parent', { type: 'tool_start', toolName: 'bash', toolUseId: 'not-approved', input: { command: 'printf not-executed' } }, options)
    expect(emitted.filter(event => event.kind === 'tool.started')).toHaveLength(1)
    expect(emitted.filter(event => event.kind.startsWith('terminal.'))).toHaveLength(0)
    await service.agentEvent('parent', { type: 'permission_request', requestId: 'permission-1', description: 'Run Bash?' }, options)
    await service.agentEvent('parent', { type: 'tool_result', toolUseId: 'not-approved', result: 'Permission denied. exitCode: 0', isError: true }, options)
    expect(emitted.filter(event => event.kind.startsWith('terminal.'))).toHaveLength(0)
    await service.agentEvent('parent', { type: 'tool_start', toolName: 'bash', toolUseId: 'approved', input: { command: 'printf executed' } }, options)
    await service.observe('parent', { kind: 'terminal.started', payload: { command: 'printf executed', cwd: '/actual-cwd', status: 'running' }, agentId: 'root', toolUseId: 'approved', sourceId: 'host:approved', sourceEventId: 'actual-start', sourceSeq: 1, occurredAt: known(Date.now(), 'host-executor'), clockDomain: 'host-monotonic', origin: 'observed' })
    expect(emitted.filter(event => event.kind === 'terminal.started')).toHaveLength(1)
    await service.finish('parent', 'interrupted')
    // Stopping the model is not proof that the independently executing host process was killed.
    expect(emitted.filter(event => event.kind === 'terminal.completed')).toHaveLength(0)
  })

  it('keeps precise executor exit status after the ordinary tool result arrives', async () => {
    const { service, emitted } = await setup()
    const run = await service.begin('parent', 'prompt')
    await service.agentEvent('parent', { type: 'tool_start', toolName: 'bash', toolUseId: 'exact-call', input: { command: 'exit 7' } })
    await service.observe('parent', { kind: 'terminal.completed', payload: { command: 'exit 7', exitCode: known(7, 'host-executor'), stdout: { text: 'actual' }, status: 'failed' }, agentId: 'root', sourceId: 'host:one', sourceEventId: 'done', sourceSeq: 1, toolUseId: 'exact-call', spanId: 'tool:exact-call', occurredAt: known(Date.now(), 'host-executor'), clockDomain: 'host-monotonic', origin: 'observed' })
    await service.agentEvent('parent', { type: 'tool_result', toolUseId: 'exact-call', result: 'legacy formatted response', isError: true })
    const completed = emitted.filter(event => event.kind === 'terminal.completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]!.spanId).toBe(`${run.runId}:tool:exact-call`)
    expect(completed[0]!.kind === 'terminal.completed' && completed[0]!.payload.exitCode).toEqual(known(7, 'host-executor'))
  })

  it('evicts idle journal caches without deleting history or creating competing sequence collectors', async () => {
    const { sessions, emitted } = await setup()
    const service = new RuntimeTraceService(id => sessions.get(id), event => emitted.push(event), undefined, 2)
    const oldest = await service.begin('parent', 'oldest')
    const output = await service.content(oldest, 'recorded-payload '.repeat(2000))
    await service.record(oldest, 'result.published', { content: output })
    await service.finish('parent', 'complete')
    for (let index = 0; index < 5; index++) {
      await service.begin('parent', `next ${index}`)
      await service.finish('parent', 'complete')
    }
    expect(service.getCachedJournalCount()).toBeLessThanOrEqual(2)
    const replay = await service.getSnapshot({ sessionId: 'parent', workspaceId: 'ws', rootRunId: oldest.rootRunId })
    expect(replay.events).toHaveLength(4)
    const payload = await service.readPayload({ sessionId: 'parent', workspaceId: 'ws', rootRunId: oldest.rootRunId, payloadRef: output.payloadRef! })
    expect(payload.text).toBe('recorded-payload '.repeat(2000))
    await Promise.all(Array.from({ length: 20 }, () => service.record(oldest, 'agent.completed', { status: 'succeeded' })))
    const complete = await service.readEvents({ sessionId: 'parent', workspaceId: 'ws', rootRunId: oldest.rootRunId, afterSeq: 0 })
    expect(complete.events.map(event => event.seq)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1))
    expect(complete.events.map(event => event.sourceSeq)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1))
    expect(complete.coverage.missing).not.toContain('recording-failure')
    expect(service.getCachedJournalCount()).toBeLessThanOrEqual(2)
  })

  it('uses a fresh native generation for repeated child ids and preserves executor retry attempts', async () => {
    const { service, emitted } = await setup()
    const first = await service.begin('parent', 'first')
    const observation = { kind: 'agent.started' as const, payload: { status: 'running' as const }, agentId: 'worker', parentAgentId: 'root', sourceId: 'omp:generation-A', sourceEventId: 'one', sourceSeq: 1, occurredAt: known(5, 'native'), clockDomain: 'omp', origin: 'observed' as const }
    await service.observe('parent', observation)
    await service.finish('parent', 'complete')
    const second = await service.begin('parent', 'second')
    await service.observe('parent', { ...observation, sourceId: 'omp:generation-B', attemptId: 'native-retry-2' })
    expect(emitted.at(-1)?.rootRunId).toBe(second.rootRunId)
    expect(emitted.at(-1)?.rootRunId).not.toBe(first.rootRunId)
    expect(emitted.at(-1)?.attemptId).toBe('native-retry-2')
    expect(emitted.at(-1)?.runId).not.toBe(first.runId)
  })

})
