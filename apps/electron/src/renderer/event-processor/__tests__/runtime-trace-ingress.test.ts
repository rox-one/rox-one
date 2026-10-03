import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import type { RuntimeTraceSnapshot } from '@rox/core/runtime-trace'
import { runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '../../atoms/runtime-trace'
import { ingressRuntimeTraceEvent, loadRuntimeTrace, recoverRuntimeTrace, removeRuntimeTraceSession, type RuntimeTraceAPI } from '../runtime-trace-ingress'
const events=createRuntimeTraceFixture();const scope={workspaceId:'fixture-workspace',sessionId:'fixture-session'}
const atom=runtimeTraceSessionAtomFamily(runtimeTraceScopeKey(scope));const coverage={state:'complete' as const,source:'runtime' as const,missing:[]}
function snapshot(part=events):RuntimeTraceSnapshot{return {schemaVersion:1,...scope,runs:[],events:part,activeRootRunId:'fixture-run',cursor:{rootRunId:'fixture-run',seq:part.at(-1)?.seq ?? 0},coverage}}
function api(overrides:Partial<RuntimeTraceAPI>={}):RuntimeTraceAPI{return {getRuntimeTraceSnapshot:async()=>snapshot(),readRuntimeTraceEvents:async(query)=>({events:events.filter(event=>event.seq>query.afterSeq),cursor:{rootRunId:'fixture-run',seq:events.at(-1)!.seq},hasMore:false,coverage}),readRuntimeTracePayload:async()=>({text:'',offset:0,byteLength:0,truncated:false}),...overrides}}
describe('canonical trace ingress',()=>{
  test('snapshot response merges events received while snapshot was in flight',async()=>{
    const store=createStore();let complete!:(value:RuntimeTraceSnapshot)=>void
    const pending=new Promise<RuntimeTraceSnapshot>(resolve=>{complete=resolve})
    const load=loadRuntimeTrace(store,scope,api({getRuntimeTraceSnapshot:()=>pending}))
    ingressRuntimeTraceEvent(store,events[1]!,scope.workspaceId)
    complete(snapshot([events[0]!]));await load
    expect(store.get(atom).projections['fixture-run']!.eventCount).toBe(2)
    expect(store.get(atom).projections['fixture-run']!.contiguousSeq).toBe(2)
    expect(store.get(atom).loading).toBe(false)
  })
  test('single live source runs with map closed, duplicate dedup and gap catch-up',async()=>{
    const store=createStore();let reads=0
    const facade=api({readRuntimeTraceEvents:async query=>{reads++;return {events:events.filter(event=>event.seq>query.afterSeq),cursor:{rootRunId:'fixture-run',seq:16},hasMore:false,coverage}}})
    ingressRuntimeTraceEvent(store,events[2]!,scope.workspaceId)
    ingressRuntimeTraceEvent(store,events[2]!,scope.workspaceId)
    expect(store.get(atom).projections['fixture-run']!.eventCount).toBe(1)
    await recoverRuntimeTrace(store,{...scope,rootRunId:'fixture-run'},facade)
    expect(reads).toBe(1);expect(store.get(atom).projections['fixture-run']!.contiguousSeq).toBe(16)
  })
  test('wrong workspace or malformed event never reaches another session',()=>{
    const store=createStore()
    expect(ingressRuntimeTraceEvent(store,events[0]!, 'other-workspace')).toBe(false)
    expect(ingressRuntimeTraceEvent(store,{...events[0],payload:{prompt:7}})).toBe(false)
    expect(store.get(atom).projections).toEqual({})
  })
  test('deletion invalidates outstanding snapshot generation',async()=>{
    const store=createStore();let complete!:(value:RuntimeTraceSnapshot)=>void
    const pending=new Promise<RuntimeTraceSnapshot>(resolve=>{complete=resolve})
    const load=loadRuntimeTrace(store,scope,api({getRuntimeTraceSnapshot:()=>pending}))
    removeRuntimeTraceSession(store,scope);complete(snapshot());await load
    expect(store.get(atom).projections).toEqual({})
  })
  test('concurrent readers share RPC and do not attach live subscriptions',async()=>{
    const store=createStore();let requests=0;let complete!:(value:RuntimeTraceSnapshot)=>void
    const pending=new Promise<RuntimeTraceSnapshot>(resolve=>{complete=resolve})
    const facade=api({getRuntimeTraceSnapshot:()=>{requests++;return pending}})
    const one=loadRuntimeTrace(store,scope,facade);const two=loadRuntimeTrace(store,scope,facade)
    expect(one).toBe(two);complete(snapshot());await Promise.all([one,two]);expect(requests).toBe(1)
  })
  test('untrusted RPC response fails closed and retains explicit partial coverage',async()=>{
    const store=createStore();await loadRuntimeTrace(store,scope,api({getRuntimeTraceSnapshot:async()=>({...snapshot(),workspaceId:'other'})}))
    expect(store.get(atom).projections).toEqual({});expect(store.get(atom).coverage.state).toBe('partial');expect(store.get(atom).error).toBe('runtimeMap.invalidResponse')
  })
})

test('authorized child alias merges live root race and receives future rooted events',async()=>{
  const store=createStore();const childScope={...scope,sessionId:'child-session'};const childAtom=runtimeTraceSessionAtomFamily(runtimeTraceScopeKey(childScope))
  let complete!:(value:RuntimeTraceSnapshot)=>void;const pending=new Promise<RuntimeTraceSnapshot>(resolve=>{complete=resolve})
  const loading=loadRuntimeTrace(store,childScope,api({getRuntimeTraceSnapshot:()=>pending}))
  ingressRuntimeTraceEvent(store,events[1]!,scope.workspaceId)
  complete({...snapshot([events[0]!]),sessionId:'child-session'});await loading
  expect(store.get(childAtom).canonicalSessionId).toBe(scope.sessionId)
  expect(store.get(childAtom).projections['fixture-run']!.eventCount).toBe(2)
  ingressRuntimeTraceEvent(store,events[2]!,scope.workspaceId)
  expect(store.get(childAtom).projections['fixture-run']!.eventCount).toBe(3)
  ingressRuntimeTraceEvent(store,{...events[0]!,rootRunId:'unrelated-later-run'},scope.workspaceId)
  expect(store.get(childAtom).projections['unrelated-later-run']).toBeUndefined()
})

test('deleted identity can reload without waiting for stale reader, no active run resurrection',async()=>{
  const store=createStore();let complete!:(value:RuntimeTraceSnapshot)=>void
  const pending=new Promise<RuntimeTraceSnapshot>(resolve=>{complete=resolve})
  const stale=loadRuntimeTrace(store,scope,api({getRuntimeTraceSnapshot:()=>pending}))
  ingressRuntimeTraceEvent(store,events[0]!,scope.workspaceId)
  removeRuntimeTraceSession(store,scope)
  expect(store.get(atom).activeRootRunId).toBeUndefined()
  await loadRuntimeTrace(store,scope,api({getRuntimeTraceSnapshot:async()=>snapshot([events[0]!])}))
  expect(store.get(atom).projections['fixture-run']!.eventCount).toBe(1)
  complete(snapshot());await stale
  expect(store.get(atom).projections['fixture-run']!.eventCount).toBe(1)
})

test('passive recorder health marks coverage without synthetic events or journal sequence',async()=>{
  const {ingestRuntimeTraceHealth}=await import('../runtime-trace-ingress')
  const store=createStore();ingressRuntimeTraceEvent(store,events[0]!,scope.workspaceId)
  const before=store.get(atom).projections['fixture-run']!
  expect(ingestRuntimeTraceHealth(store,{type:'runtime_trace_health',...scope,rootRunId:'fixture-run',coverage:{state:'partial',source:'runtime',missing:['recording-failure'],reason:'Disk write failed'}},scope.workspaceId)).toBe(true)
  const after=store.get(atom).projections['fixture-run']!
  expect(after.eventCount).toBe(before.eventCount);expect(after.highestSeq).toBe(before.highestSeq);expect(after.coverage.missing).toContain('recording-failure')
  expect(store.get(atom).runs[0]!.coverage.missing).toContain('recording-failure')
})
test('health boundary rejects malformed coverage and wrong workspace',async()=>{
  const {ingestRuntimeTraceHealth}=await import('../runtime-trace-ingress')
  const store=createStore();const health={type:'runtime_trace_health',...scope,rootRunId:'fixture-run',coverage:{state:'partial',source:'runtime',missing:['disk-failure']}}
  expect(ingestRuntimeTraceHealth(store,health,'other-workspace')).toBe(false)
  expect(ingestRuntimeTraceHealth(store,{...health,coverage:{state:'complete',missing:7}},scope.workspaceId)).toBe(false)
  expect(ingestRuntimeTraceHealth(store,{...health,rootRunId:undefined},scope.workspaceId)).toBe(false)
  expect(store.get(atom).coverage.missing).toEqual([])
})
