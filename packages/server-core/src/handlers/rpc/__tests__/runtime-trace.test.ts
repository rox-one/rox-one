import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RuntimeTraceSnapshot, RuntimeEventsPage } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { isRuntimeEvent } from '@rox/core/runtime-trace/validation'
import type { HandlerFn, RpcServer, RequestContext } from '../../../transport/types'
import { registerRuntimeTraceHandlers, HANDLED_CHANNELS } from '../runtime-trace'
import { nativeRuntimeTraceEvent, nativeSessionEvent } from '../native-session-scope'

function setup() {
  const handlers = new Map<string, HandlerFn>()
  let reads = 0
  const server = { handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) } } as unknown as RpcServer
  const events = createRuntimeTraceFixture()
  const snapshot: RuntimeTraceSnapshot = { schemaVersion: 1, workspaceId: 'fixture-workspace', sessionId: 'fixture-session', runs: [], events, coverage: { state: 'complete', source: 'runtime', missing: [] }, cursor: { rootRunId: 'fixture-run', seq: events.length } }
  const deps = { sessionManager: {
    async getSession(id: string) { return id === 'fixture-session' ? { id, workspaceId: 'fixture-workspace' } : null },
    async getRuntimeTraceSnapshot() { reads++; return snapshot },
    async readRuntimeTraceEvents() { reads++; return { events, cursor: snapshot.cursor!, hasMore: false, coverage: snapshot.coverage } satisfies RuntimeEventsPage },
    async readRuntimeTracePayload() { reads++; return { text: 'payload', offset: 0, byteLength: 7, truncated: false } },
  } }
  registerRuntimeTraceHandlers(server, deps as never)
  const ctx = { clientId: 'desktop', workspaceId: 'fixture-workspace', webContentsId: null } as RequestContext
  return { handlers, ctx, reads: () => reads }
}

describe('runtime trace RPC', () => {
  it('registers scoped read-only channels and returns the authoritative snapshot/cursor', async () => {
    const { handlers, ctx } = setup()
    for (const channel of HANDLED_CHANNELS) expect(handlers.has(channel)).toBe(true)
    const snapshot = await handlers.get(RPC_CHANNELS.runtimeTrace.GET_SNAPSHOT)!(ctx, { workspaceId: 'fixture-workspace', sessionId: 'fixture-session' }) as RuntimeTraceSnapshot
    expect(snapshot.events[0]?.kind).toBe('run.accepted')
    expect(snapshot.cursor?.seq).toBe(snapshot.events.length)
  })
  it('rejects other workspaces/sessions and malformed references before accessing a trace', async () => {
    const { handlers, ctx, reads } = setup()
    const get = handlers.get(RPC_CHANNELS.runtimeTrace.GET_SNAPSHOT)!
    await expect(get(ctx, { workspaceId: 'other', sessionId: 'fixture-session' })).rejects.toThrow('Workspace access denied')
    await expect(get(ctx, { workspaceId: 'fixture-workspace', sessionId: 'other' })).rejects.toThrow('Session access denied')
    await expect(get(ctx, { workspaceId: 'fixture-workspace', sessionId: 'fixture-session', rootRunId: '../outside' })).rejects.toThrow('Invalid runtime trace query')
    await expect(handlers.get(RPC_CHANNELS.runtimeTrace.READ_PAYLOAD)!(ctx, { workspaceId: 'fixture-workspace', sessionId: 'fixture-session', rootRunId: 'fixture-run', payloadRef: '../outside' })).rejects.toThrow('Invalid runtime payload query')
    expect(reads()).toBe(0)
  })
  it('keeps native signed-scope projections valid without host commands, arguments, outputs or blob pointers', () => {
    const events = createRuntimeTraceFixture()
    const terminal = events.find(event => event.kind === 'terminal.completed')!
    const projected = nativeRuntimeTraceEvent(terminal)
    expect(isRuntimeEvent(projected)).toBe(true)
    expect(projected.eventId).toBe(terminal.eventId)
    expect(projected.seq).toBe(terminal.seq)
    expect(JSON.stringify(projected)).not.toContain('printf fixture')
    expect(projected.kind === 'terminal.completed' && projected.payload.stdout?.availability).toBe('redacted')
    const wrapper = nativeSessionEvent({ type: 'runtime_trace', sessionId: terminal.rootSessionId, event: terminal })
    expect(wrapper?.type).toBe('runtime_trace')
    for (const event of events) expect(isRuntimeEvent(nativeRuntimeTraceEvent(event))).toBe(true)
  })
  it('exposes recording health without granting native host diagnostic contents', () => {
    const safe = nativeSessionEvent({ type: 'runtime_trace_health', sessionId: 'session', workspaceId: 'ws', rootRunId: 'run', coverage: { state: 'partial', source: 'runtime', missing: ['recording-failure'], reason: 'Cannot write /private/host/secret.txt' } })
    expect(safe?.type).toBe('runtime_trace_health')
    expect(JSON.stringify(safe)).not.toContain('/private/host/secret.txt')
    expect(safe?.type === 'runtime_trace_health' && safe.coverage.missing).toContain('recording-failure')
  })

  it('redacts selected skill instructions and actual native child prompt contents', () => {
    const events = createRuntimeTraceFixture()
    const skill = events.find(event => event.kind === 'skill.loaded')!
    const selected = { ...skill, kind: 'skill.selected' as const }
    const safeSkill = nativeRuntimeTraceEvent(selected as never)
    expect(JSON.stringify(safeSkill)).not.toContain('Сравни первоисточники.')
    const context = events.find(event => event.kind === 'context.captured')!
    const safeContext = nativeRuntimeTraceEvent(context)
    expect(safeContext.kind === 'context.captured' && safeContext.payload.snapshot.originalPrompt.availability).toBe('redacted')
    expect(safeContext.kind === 'context.captured' && safeContext.payload.snapshot.effectivePrompt.availability).toBe('redacted')
  })

})
