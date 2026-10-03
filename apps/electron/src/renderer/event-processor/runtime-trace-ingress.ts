import type { createStore } from 'jotai/vanilla'
type Store = ReturnType<typeof createStore>
import type { RuntimeEvent, RuntimeEventsPage, RuntimeEventsQuery, RuntimePayloadPage, RuntimePayloadQuery, RuntimeRunSummary, RuntimeTraceQuery, RuntimeTraceSnapshot } from '@rox/core/runtime-trace'
import { createRuntimeProjection, reduceRuntimeEvent, runtimeProjectionEvents, runtimeProjectionCoverage, type RuntimeProjection } from '@rox/core/runtime-trace/projector'
import { isRuntimeEvent, isRuntimeTraceSnapshot, isRuntimeEventsPage, isTraceCoverage } from '@rox/core/runtime-trace/validation'
import { mergeTraceCoverage } from '@rox/core/runtime-trace/coverage'
import { runtimeTraceSessionAtomFamily, runtimeTraceScopeKey, createRuntimeTraceSessionState, type RuntimeTraceScope, type RuntimeTraceSessionState } from '../atoms/runtime-trace'

export interface RuntimeTraceAPI {
  getRuntimeTraceSnapshot(query: RuntimeTraceQuery): Promise<RuntimeTraceSnapshot>
  readRuntimeTraceEvents(query: RuntimeEventsQuery): Promise<RuntimeEventsPage>
  readRuntimeTracePayload(query: RuntimePayloadQuery): Promise<RuntimePayloadPage>
}
const MAX_RESIDENT_EVENTS = 50_000
const MAX_RESIDENT_RUNS = 20
const aliases = new WeakMap<Store, Map<string, Map<string, Set<string>>>>()
function aliasMap(store:Store):Map<string,Map<string,Set<string>>>{let map=aliases.get(store);if(!map){map=new Map();aliases.set(store,map)}return map}
const pending = new WeakMap<Store, Map<string, Promise<void>>>()
const recovering = new WeakMap<Store, Map<string, Promise<void>>>()
function workMap(registry: WeakMap<Store, Map<string, Promise<void>>>, store: Store): Map<string, Promise<void>> { let map = registry.get(store); if(!map){map=new Map();registry.set(store,map)} return map }
function scopeMatches(event: RuntimeEvent, scope: RuntimeTraceScope, rootRunId?: string): boolean {
  return event.workspaceId===scope.workspaceId && event.rootSessionId===scope.sessionId && (!rootRunId || event.rootRunId===rootRunId)
}
function mergeRun(runs: RuntimeRunSummary[], event: RuntimeEvent, projection: RuntimeProjection): RuntimeRunSummary[] {
  const old=runs.find(run=>run.rootRunId===event.rootRunId)
  const rootAgentId=event.kind.startsWith('run.') && event.runId===event.rootRunId ? event.agentId : old?.agentId ?? Object.values(projection.agents).find(agent=>!agent.parentAgentId)?.id ?? event.agentId
  const rootAgent=projection.agents[rootAgentId]
  const run:RuntimeRunSummary={rootRunId:event.rootRunId,sessionId:event.rootSessionId,agentId:rootAgentId,status:rootAgent?.status ?? old?.status ?? 'queued',startedAt:old?.startedAt ?? (event.occurredAt.state==='known'?event.occurredAt.value:event.receivedAt),prompt:event.kind==='run.accepted'?event.payload.prompt.text ?? old?.prompt ?? '':old?.prompt ?? '',coverage:runtimeProjectionCoverage(projection)}
  return [...runs.filter(item=>item.rootRunId!==run.rootRunId),run].sort((a,b)=>a.startedAt-b.startedAt)
}
function addEvent(state: RuntimeTraceSessionState, event: RuntimeEvent): RuntimeTraceSessionState {
  const before=state.projections[event.rootRunId] ?? createRuntimeProjection({workspaceId:event.workspaceId,sessionId:event.rootSessionId,rootRunId:event.rootRunId})
  if(before.eventCount>=MAX_RESIDENT_EVENTS) return {...state,coverage:mergeTraceCoverage(state.coverage,{state:'partial',source:'runtime',missing:['resident-event-limit'],reason:'Older events must be read from the journal'})}
  const projection=reduceRuntimeEvent(before,event)
  if(projection===before)return state
  let projections={...state.projections,[event.rootRunId]:projection}
  const runs=mergeRun(state.runs,event,projection)
  const resident=Object.keys(projections)
  if(resident.length>MAX_RESIDENT_RUNS){const oldest=runs.find(run=>run.rootRunId!==event.rootRunId && projections[run.rootRunId]);if(oldest){const {[oldest.rootRunId]:_,...rest}=projections;projections=rest}}
  return {...state,projections,runs,activeRootRunId:event.kind==='run.accepted'?event.rootRunId:state.activeRootRunId}
}
/** Called by App's existing session-event source. Never subscribes or sends agent actions. */
export function ingressRuntimeTraceEvent(store: Store, input: unknown, expectedWorkspaceId?: string, api?: RuntimeTraceAPI): boolean {
  if(!isRuntimeEvent(input) || expectedWorkspaceId && input.workspaceId!==expectedWorkspaceId)return false
  const scope={workspaceId:input.workspaceId,sessionId:input.rootSessionId}; const atom=runtimeTraceSessionAtomFamily(runtimeTraceScopeKey(scope)); const old=store.get(atom); const next=addEvent(old,input)
  if(next!==old)store.set(atom,next)
  for(const [aliasKey,allowedRuns] of aliasMap(store).get(runtimeTraceScopeKey(scope)) ?? []){if(!allowedRuns.has(input.rootRunId))continue;const aliasAtom=runtimeTraceSessionAtomFamily(aliasKey);store.set(aliasAtom,prev=>addEvent(prev,input))}
  const projection=next.projections[input.rootRunId]
  if(api && projection && projection.contiguousSeq<projection.highestSeq) void recoverRuntimeTrace(store,{...scope,rootRunId:input.rootRunId},api).catch(()=>{})
  return true
}
function checkedEvents(events: unknown, scope: RuntimeTraceScope, rootRunId?: string): RuntimeEvent[] {
  if(!Array.isArray(events)||events.length>100_000||events.some(event=>!isRuntimeEvent(event)||!scopeMatches(event,scope,rootRunId)))throw new Error('runtimeMap.invalidResponse')
  return events as RuntimeEvent[]
}
export function loadRuntimeTrace(store: Store, query: RuntimeTraceQuery, api: RuntimeTraceAPI): Promise<void> {
  const scope={workspaceId:query.workspaceId,sessionId:query.sessionId}; const atom=runtimeTraceSessionAtomFamily(runtimeTraceScopeKey(scope)); const generation=store.get(atom).generation
  const key=JSON.stringify([query.workspaceId,query.sessionId,query.rootRunId ?? '',generation]); const map=workMap(pending,store); const existing=map.get(key); if(existing)return existing
  store.set(atom,prev=>({...prev,loading:true,error:undefined}))
  const task=(async()=>{try{
    const snapshot=await api.getRuntimeTraceSnapshot(query)
    if(!isRuntimeTraceSnapshot(snapshot)||snapshot.workspaceId!==query.workspaceId||snapshot.sessionId!==query.sessionId)throw new Error('runtimeMap.invalidResponse')
    const canonicalSessionId=snapshot.events[0]?.rootSessionId ?? snapshot.runs.find(run=>!query.rootRunId || run.rootRunId===query.rootRunId)?.sessionId ?? query.sessionId
    const canonicalScope={workspaceId:query.workspaceId,sessionId:canonicalSessionId}
    const events=checkedEvents(snapshot.events,canonicalScope,query.rootRunId)
    if(store.get(atom).generation!==generation)return
    // Read live state AFTER snapshot arrived; no event between request and response is overwritten.
    let next=store.get(atom)
    if(canonicalSessionId!==query.sessionId){const canonicalKey=runtimeTraceScopeKey(canonicalScope);const map=aliasMap(store);const scoped=map.get(canonicalKey) ?? new Map<string,Set<string>>();const allowed=new Set([...snapshot.runs.map(run=>run.rootRunId),...events.map(event=>event.rootRunId)]);scoped.set(runtimeTraceScopeKey(scope),allowed);map.set(canonicalKey,scoped)
      const canonicalState=store.get(runtimeTraceSessionAtomFamily(canonicalKey));for(const id of allowed){const projection=canonicalState.projections[id];if(projection)for(const event of runtimeProjectionEvents(projection))next=addEvent(next,event)}}
    for(const event of events)next=addEvent(next,event)
    const runs=new Map(snapshot.runs.map(run=>[run.rootRunId,run])); for(const run of next.runs)runs.set(run.rootRunId,run)
    next={...next,canonicalSessionId,runs:[...runs.values()].sort((a,b)=>a.startedAt-b.startedAt),activeRootRunId:next.activeRootRunId ?? snapshot.activeRootRunId,coverage:mergeTraceCoverage(next.coverage,snapshot.coverage),loaded:true,loading:false,error:undefined}
    store.set(atom,next)
    const root=query.rootRunId ?? snapshot.cursor?.rootRunId ?? snapshot.activeRootRunId
    if(root && (snapshot.hasMore || (next.projections[root]?.contiguousSeq ?? 0)<(snapshot.cursor?.seq ?? 0))) await recoverRuntimeTrace(store,{...query,rootRunId:root},api)
  }catch(error){if(store.get(atom).generation===generation)store.set(atom,prev=>({...prev,loading:false,error:error instanceof Error && error.message==='runtimeMap.invalidResponse'?'runtimeMap.invalidResponse':'runtimeMap.loadFailed',coverage:mergeTraceCoverage(prev.coverage,{state:'partial',source:'runtime',missing:['snapshot-read-failed']})}))}})().finally(()=>map.delete(key))
  map.set(key,task);return task
}
export function recoverRuntimeTrace(store: Store, query: RuntimeTraceQuery & {rootRunId:string}, api:RuntimeTraceAPI):Promise<void>{
  const scope={workspaceId:query.workspaceId,sessionId:query.sessionId};const atom=runtimeTraceSessionAtomFamily(runtimeTraceScopeKey(scope));const generation=store.get(atom).generation
  const key=JSON.stringify([query.workspaceId,query.sessionId,query.rootRunId,generation]);const map=workMap(recovering,store);const existing=map.get(key);if(existing)return existing
  const task=(async()=>{try{
    let afterSeq=store.get(atom).projections[query.rootRunId]?.contiguousSeq ?? 0
    for(let pageNumber=0;pageNumber<100;pageNumber++){
      const page=await api.readRuntimeTraceEvents({...query,afterSeq,limit:2000})
      if(!isRuntimeEventsPage(page)||page.cursor.rootRunId!==query.rootRunId||page.cursor.seq<afterSeq)throw new Error('runtimeMap.invalidResponse')
      const events=checkedEvents(page.events,{...scope,sessionId:store.get(atom).canonicalSessionId ?? scope.sessionId},query.rootRunId)
      if(store.get(atom).generation!==generation)return
      let state=store.get(atom);for(const event of events)state=addEvent(state,event)
      store.set(atom,{...state,coverage:mergeTraceCoverage(state.coverage,page.coverage)})
      const next=state.projections[query.rootRunId]?.contiguousSeq ?? afterSeq
      if(!page.hasMore)return
      if(next<=afterSeq){store.set(atom,prev=>({...prev,coverage:mergeTraceCoverage(prev.coverage,{state:'partial',source:'runtime',missing:[`unrecoverable-gap:${afterSeq+1}`]})}));return}
      afterSeq=next
    }
    store.set(atom,prev=>({...prev,coverage:mergeTraceCoverage(prev.coverage,{state:'partial',source:'runtime',missing:['catchup-page-limit']})}))
  }catch(error){if(store.get(atom).generation===generation)store.set(atom,prev=>({...prev,error:'runtimeMap.loadFailed',coverage:mergeTraceCoverage(prev.coverage,{state:'partial',source:'runtime',missing:['catchup-failed']})}));throw error}})().finally(()=>map.delete(key))
  map.set(key,task);return task
}
export function removeRuntimeTraceSession(store:Store,scope:RuntimeTraceScope):void{
  const key=runtimeTraceScopeKey(scope);for(const scoped of aliasMap(store).values())scoped.delete(key);aliasMap(store).delete(key);const atom=runtimeTraceSessionAtomFamily(key);store.set(atom,prev=>({...createRuntimeTraceSessionState(),generation:prev.generation+1}))
  // Keep the tombstone until outstanding reads finish; a late response cannot resurrect deleted state.
}

/** App-compatible SessionEvent boundary; returns whether this is a trace envelope. */
export function ingestRuntimeTraceEvent(store: Store, envelope: unknown, expectedWorkspaceId: string): boolean {
  if (!envelope || typeof envelope !== 'object' || !('type' in envelope) || envelope.type !== 'runtime_trace' || !('event' in envelope)) return false
  const api = typeof window !== 'undefined' ? window.electronAPI as unknown as RuntimeTraceAPI : undefined
  ingressRuntimeTraceEvent(store, envelope.event, expectedWorkspaceId, api)
  return true
}

/** A failed recorder emits passive health on the existing channel, without inventing journal sequence. */
export function ingestRuntimeTraceHealth(store: Store, envelope: unknown, expectedWorkspaceId: string): boolean {
  if (!envelope || typeof envelope !== 'object' || !('type' in envelope) || envelope.type !== 'runtime_trace_health') return false
  if (!('workspaceId' in envelope) || typeof envelope.workspaceId !== 'string' || envelope.workspaceId !== expectedWorkspaceId
    || !('sessionId' in envelope) || typeof envelope.sessionId !== 'string' || !envelope.sessionId.length || envelope.sessionId.length > 4096
    || !('rootRunId' in envelope) || typeof envelope.rootRunId !== 'string' || !envelope.rootRunId.length || envelope.rootRunId.length > 4096
    || !('coverage' in envelope) || !isTraceCoverage(envelope.coverage)) return false
  const scope={workspaceId:envelope.workspaceId,sessionId:envelope.sessionId};const rootRunId=envelope.rootRunId;const coverage=envelope.coverage
  const merge=(state:RuntimeTraceSessionState):RuntimeTraceSessionState=>{
    const projection=state.projections[rootRunId]
    return {...state,coverage:mergeTraceCoverage(state.coverage,coverage),
      projections:projection?{...state.projections,[rootRunId]:{...projection,coverage:mergeTraceCoverage(projection.coverage,coverage)}}:state.projections,
      runs:state.runs.map(run=>run.rootRunId===rootRunId?{...run,coverage:mergeTraceCoverage(run.coverage,coverage)}:run)}
  }
  const key=runtimeTraceScopeKey(scope);store.set(runtimeTraceSessionAtomFamily(key),merge)
  for(const [aliasKey,allowedRuns] of aliasMap(store).get(key) ?? [])if(allowedRuns.has(rootRunId))store.set(runtimeTraceSessionAtomFamily(aliasKey),merge)
  return true
}
