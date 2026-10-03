import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { RuntimeTraceQuery, RuntimeEventsQuery, RuntimePayloadQuery, TraceCoverage } from '@rox/core/runtime-trace'
import type { RpcServer, RequestContext } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { assertNativeSession, nativeRuntimeTraceEvent } from './native-session-scope'

export const HANDLED_CHANNELS = [RPC_CHANNELS.runtimeTrace.GET_SNAPSHOT, RPC_CHANNELS.runtimeTrace.READ_EVENTS, RPC_CHANNELS.runtimeTrace.READ_PAYLOAD] as const

function nativeCoverage(coverage: TraceCoverage): TraceCoverage {
  return { ...coverage, state: 'partial', reason: coverage.reason ? 'Runtime observation recording is incomplete.' : undefined, missing: [...new Set([...coverage.missing, 'host-data-redacted'])] }
}

export function registerRuntimeTraceHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps
  async function authorize(ctx: RequestContext, input: RuntimeTraceQuery): Promise<void> {
    if (!input || typeof input.workspaceId !== 'string' || typeof input.sessionId !== 'string'
      || input.sessionId.length > 200 || input.workspaceId.length > 200
      || (input.rootRunId !== undefined && (typeof input.rootRunId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.rootRunId)))
      || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 5000))) {
      throw new CodedError('INVALID_REF', 'Invalid runtime trace query')
    }
    if (ctx.workspaceId && ctx.workspaceId !== input.workspaceId) throw new CodedError('FORBIDDEN', 'Workspace access denied')
    assertNativeSession(ctx, deps, server, input.sessionId)
    const session = await sessionManager.getSession(input.sessionId)
    if (!session || session.workspaceId !== input.workspaceId) throw new CodedError('FORBIDDEN', 'Session access denied')
    assertNativeSession(ctx, deps, server, input.sessionId)
  }
  const checkCurrent = (ctx: RequestContext, query: RuntimeTraceQuery) => assertNativeSession(ctx, deps, server, query.sessionId)

  server.handle(RPC_CHANNELS.runtimeTrace.GET_SNAPSHOT, async (ctx, query: RuntimeTraceQuery) => {
    await authorize(ctx, query)
    if (!sessionManager.getRuntimeTraceSnapshot) throw new CodedError('CAPABILITY_UNAVAILABLE', 'Runtime trace capability unavailable')
    const snapshot = await sessionManager.getRuntimeTraceSnapshot(query)
    checkCurrent(ctx, query)
    return ctx.principal ? { ...snapshot, runs: snapshot.runs.map(run => ({ ...run, coverage: nativeCoverage(run.coverage) })), events: snapshot.events.map(nativeRuntimeTraceEvent), coverage: nativeCoverage(snapshot.coverage) } : snapshot
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.runtimeTrace.READ_EVENTS, async (ctx, query: RuntimeEventsQuery) => {
    await authorize(ctx, query)
    if (!query.rootRunId || !Number.isSafeInteger(query.afterSeq) || query.afterSeq < 0) throw new CodedError('INVALID_REF', 'Invalid runtime cursor')
    if (!sessionManager.readRuntimeTraceEvents) throw new CodedError('CAPABILITY_UNAVAILABLE', 'Runtime trace capability unavailable')
    const page = await sessionManager.readRuntimeTraceEvents(query)
    checkCurrent(ctx, query)
    return ctx.principal ? { ...page, events: page.events.map(nativeRuntimeTraceEvent), coverage: nativeCoverage(page.coverage) } : page
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.runtimeTrace.READ_PAYLOAD, async (ctx, query: RuntimePayloadQuery) => {
    // Payload paging permits larger limits than event paging, validated independently.
    await authorize(ctx, { ...query, limit: undefined })
    if (!query.rootRunId || typeof query.payloadRef !== 'string' || !/^[a-f0-9]{64}$/.test(query.payloadRef)
      || (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))
      || (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 262144))) throw new CodedError('INVALID_REF', 'Invalid runtime payload query')
    // Existing native session grants deliberately exclude host files/tool output.
    if (ctx.principal) throw new CodedError('FORBIDDEN', 'Host runtime payload access denied')
    if (!sessionManager.readRuntimeTracePayload) throw new CodedError('CAPABILITY_UNAVAILABLE', 'Runtime trace capability unavailable')
    const page = await sessionManager.readRuntimeTracePayload(query)
    checkCurrent(ctx, query)
    return page
  }, { nativeAction: 'read' })
}
