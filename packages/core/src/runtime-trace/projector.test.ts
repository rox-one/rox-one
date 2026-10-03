import { describe, expect, test } from 'bun:test'
import { createRuntimeTraceFixture } from './fixture'
import { createRuntimeProjection, reduceRuntimeEvent, projectRuntimeEvents, buildRuntimeGraph, runtimeProjectionCoverage } from './projector'
import { summarizeUsage } from './metrics'
import { isRuntimeEvent, isRuntimeAgentObservation } from './validation'
import { known, unknown, type RuntimeEvent } from './types'
const fixture=createRuntimeTraceFixture()
function event(seq:number,kind:RuntimeEvent['kind'],payload:unknown,extra:Partial<RuntimeEvent>={}):RuntimeEvent{
  return {...fixture[0]!,eventId:`test:${seq}`,sourceEventId:`test:${seq}`,seq,sourceSeq:seq,kind,payload,...extra} as RuntimeEvent
}
describe('runtime projection',()=>{
  test('validates canonical typed fixture; rejects malformed nested payload and schema',()=>{
    expect(fixture.every(isRuntimeEvent)).toBe(true)
    expect(isRuntimeEvent({...fixture[2],payload:{snapshot:{id:'invalid'}}})).toBe(false)
    expect(isRuntimeEvent({...fixture[0],schemaVersion:2})).toBe(false)
    expect(isRuntimeEvent({...fixture[0],seq:NaN})).toBe(false)
    expect(isRuntimeAgentObservation({...fixture[0],elapsedMs:-3})).toBe(false)
    expect(isRuntimeEvent(event(1,'tool.started',{name:'bash',status:'invented'}))).toBe(false)
    expect(isRuntimeEvent(event(1,'task.state-changed',{task:{id:'task',title:'Title',status:'blocked',dependsOn:[],criteria:[]}}))).toBe(true)
  })
  test('batch, incremental, reversed delivery and duplicate delivery match',()=>{
    const sequential=fixture.reduce(reduceRuntimeEvent,createRuntimeProjection())
    const reverse=[...fixture].reverse().reduce(reduceRuntimeEvent,createRuntimeProjection())
    expect(buildRuntimeGraph(reverse)).toEqual(buildRuntimeGraph(sequential))
    expect(buildRuntimeGraph(projectRuntimeEvents(fixture))).toEqual(buildRuntimeGraph(sequential))
    expect(fixture.reduce(reduceRuntimeEvent,sequential)).toBe(sequential)
  })
  test('workspace/root identities are scoped; source duplicate uses stable emitter identity',()=>{
    const state=projectRuntimeEvents(fixture)
    expect(reduceRuntimeEvent(state,{...fixture[0]!,workspaceId:'other'})).toBe(state)
    expect(reduceRuntimeEvent(state,{...fixture[0]!,rootRunId:'other-run'})).toBe(state)
    expect(reduceRuntimeEvent(state,{...fixture[0]!,eventId:'duplicate-delivery',seq:20})).toBe(state)
  })
  test('only explicit causal/data/parent edges; no temporal arrows',()=>{
    const graph=buildRuntimeGraph(projectRuntimeEvents(fixture))
    expect(graph.edges.some(edge=>edge.kind==='data-dependency')).toBe(true)
    expect(graph.edges.every(edge=>edge.kind!=='causal')).toBe(true)
    expect(graph.lanes.map(lane=>lane.depth)).toEqual([0,1,1])
    expect(graph.nodes.filter(node=>node.kind==='tool')).toHaveLength(1)
    expect(graph.nodes.filter(node=>node.kind==='terminal')).toHaveLength(1)
  })
  test('terminal cancellation sticks after late output; retry keeps previous attempt',()=>{
    const trace=[event(1,'terminal.started',{command:'sleep',status:'running'},{spanId:'shell',attemptId:'one'}),event(2,'terminal.completed',{command:'sleep',status:'cancelled'},{spanId:'shell',attemptId:'one'}),event(3,'terminal.output',{command:'sleep',stdout:{text:'late'},status:'running'},{spanId:'shell',attemptId:'one'}),event(4,'terminal.started',{command:'sleep',status:'running'},{spanId:'shell',attemptId:'two'})]
    const nodes=buildRuntimeGraph(projectRuntimeEvents(trace)).nodes
    expect(nodes).toHaveLength(2);expect(nodes[0]!.status).toBe('cancelled');expect(nodes[1]!.status).toBe('running')
  })
  test('missing parent and delivery gap explicit; gaps repair on catch-up',()=>{
    const state=projectRuntimeEvents([event(2,'agent.started',{status:'running'},{agentId:'child',parentAgentId:'absent'})])
    expect(buildRuntimeGraph(state).lanes[0]!.orphan).toBe(true)
    expect(runtimeProjectionCoverage(state).state).toBe('partial')
    expect(runtimeProjectionCoverage(reduceRuntimeEvent(state,event(1,'run.started',{status:'running'}))).state).toBe('complete')
  })
  test('delta updates retain topology and authoritative complete replaces reasoning',()=>{
    const first=projectRuntimeEvents([event(1,'reasoning.output',{content:{text:'one'},provenance:'provider'},{providerTurnId:'turn'})])
    const second=reduceRuntimeEvent(first,event(2,'reasoning.output',{content:{text:'two'},provenance:'provider'},{providerTurnId:'turn'}))
    expect(second.topologyVersion).toBe(first.topologyVersion)
    expect(Object.values(second.nodes)[0]!.content?.text).toBe('onetwo')
    const final=reduceRuntimeEvent(second,event(3,'reasoning.output',{content:{text:'complete'},provenance:'provider',complete:true},{providerTurnId:'turn'}))
    expect(Object.values(final.nodes)[0]!.content?.text).toBe('complete')
  })
  test('different clock domains and negative elapsed are never exact duration',()=>{
    const state=projectRuntimeEvents([event(1,'tool.started',{name:'read',status:'running'},{spanId:'one',clockDomain:'a',occurredAt:known(100,'clock')}),event(2,'tool.completed',{name:'read',status:'succeeded'},{spanId:'one',clockDomain:'b',occurredAt:known(90,'clock')})])
    expect(buildRuntimeGraph(state).nodes[0]!.durationMs.state).toBe('unknown')
  })
  test('immutable previous state retains normalized entities and event pages',()=>{
    const before=createRuntimeProjection();const after=reduceRuntimeEvent(before,fixture[0]!)
    expect(before.eventCount).toBe(0);expect(before.eventPages).toHaveLength(0);expect(before.nodes).toEqual({});expect(after.eventCount).toBe(1)
  })
})
describe('usage',()=>{
  const usage=(seq:number,call:string,scope:'self'|'aggregate',input:number,final:boolean)=>event(seq,'usage.reported',{usage:{providerCallId:call,scope,source:'provider',inputTokens:known(input,'provider'),outputTokens:known(5,'provider'),final}})
  test('dedup final replaces interim; aggregate is separate; unknown optional caches stay unknown',()=>{
    const summary=summarizeUsage([usage(1,'one','self',10,false),usage(2,'one','self',20,true),usage(3,'parent','aggregate',200,true),usage(4,'two','self',30,true)])
    expect(summary.inputTokens).toMatchObject({state:'known',value:50});expect(summary.calls).toBe(2);expect(summary.aggregateRecords).toHaveLength(1)
    expect(summary.cacheReadTokens.state).toBe('unknown');expect(summary.cost.state).toBe('unknown')
  })
  test('unknown values remain unknown; missing usage does not become zero',()=>{
    expect(summarizeUsage([]).inputTokens).toEqual(unknown('not-emitted'))
    expect(summarizeUsage([event(1,'usage.reported',{usage:{providerCallId:'one',scope:'self',source:'provider',inputTokens:unknown(),outputTokens:unknown(),final:true}})]).inputTokens).toEqual(unknown('partial'))
  })
})

describe('legacy reconstruction',()=>{
  test('persisted transcript exposes only messages/tools and incomplete coverage',async()=>{
    const {reconstructLegacyRuntimeEvents,LEGACY_TRACE_COVERAGE}=await import('./legacy')
    const messages=[{id:'user',role:'user',content:'Use a skill and a subagent',timestamp:1},{id:'tool',role:'tool',content:'stored output',timestamp:2,toolUseId:'real-tool-id',toolName:'read'},{id:'answer',role:'assistant',content:'I used planning and children',timestamp:3}] as import('../types/message').Message[]
    const events=reconstructLegacyRuntimeEvents(messages,{workspaceId:'legacy-workspace',sessionId:'legacy-session'})
    expect(events.map(event=>event.kind)).toEqual(['run.accepted','tool.completed','result.published'])
    expect(events.every(event=>event.origin==='derived')).toBe(true)
    expect(LEGACY_TRACE_COVERAGE.state).toBe('partial')
    expect(buildRuntimeGraph(projectRuntimeEvents(events)).nodes.every(node=>node.durationMs.state==='unknown')).toBe(true)
  })
})

test('terminal stdout and stderr chunks accumulate independently; exact chunk tokens are not aggregate tokens',()=>{
  const state=projectRuntimeEvents([event(1,'terminal.started',{command:'run',status:'running'},{spanId:'stream'}),event(2,'terminal.output',{command:'run',stdout:{text:'one',tokens:known(1,'chunk')}},{spanId:'stream'}),event(3,'terminal.output',{command:'run',stderr:{text:'error'}},{spanId:'stream'}),event(4,'terminal.output',{command:'run',stdout:{text:'two',tokens:known(1,'chunk')}},{spanId:'stream'})])
  const node=buildRuntimeGraph(state).nodes[0]!
  expect(node.terminal?.stdout?.text).toBe('onetwo');expect(node.terminal?.stderr?.text).toBe('error');expect(node.terminal?.stdout?.tokens?.state).toBe('unknown')
})
test('provider reasoning and a summary never become one fabricated chain',()=>{
  const state=projectRuntimeEvents([event(1,'reasoning.output',{content:{text:'provided'},provenance:'provider'},{providerTurnId:'turn'}),event(2,'reasoning.output',{content:{text:'summary'},provenance:'summary'},{providerTurnId:'turn'})])
  expect(buildRuntimeGraph(state).nodes).toHaveLength(2)
})
test('evidence references to old streamed output resolve to its correlated operation node',()=>{
  const state=projectRuntimeEvents([event(1,'tool.output',{name:'read',result:{text:'one'}},{spanId:'stream'}),event(2,'tool.output',{name:'read',result:{text:'two'}},{spanId:'stream'}),event(3,'result.published',{content:{text:'answer'},evidenceEventIds:['test:1']})])
  expect(buildRuntimeGraph(state).edges.filter(edge=>edge.kind==='data-dependency')).toHaveLength(1)
})

test('parentage and causal edges survive correlated lifecycle completion',()=>{
  const graph=buildRuntimeGraph(projectRuntimeEvents(fixture))
  expect(graph.edges.filter(edge=>edge.kind==='parent-child')).toHaveLength(2)
  const state=projectRuntimeEvents([event(1,'decision.recorded',{content:{text:'delegate'},provenance:'explicit'}),event(2,'tool.started',{name:'read',status:'running'},{spanId:'cause',causationEventId:'test:1'}),event(3,'tool.completed',{name:'read',status:'succeeded'},{spanId:'cause'})])
  expect(buildRuntimeGraph(state).edges.filter(edge=>edge.kind==='causal')).toHaveLength(1)
})

test('out-of-order earlier phase invalidates geometry token without text delta relayout',()=>{
  const later=event(3,'tool.completed',{name:'read',status:'succeeded'},{spanId:'earlier'})
  const first=projectRuntimeEvents([event(1,'run.started',{status:'running'}),later])
  const corrected=reduceRuntimeEvent(first,event(2,'tool.started',{name:'read',status:'running'},{spanId:'earlier'}))
  expect(corrected.topologyVersion).not.toBe(first.topologyVersion)
  const delta=reduceRuntimeEvent(corrected,event(4,'tool.output',{name:'read',result:{text:'append'}},{spanId:'earlier'}))
  expect(delta.topologyVersion).toBe(corrected.topologyVersion)
})

test('explicit cumulative output snapshots replace prior text without duplication',()=>{
  const events=[event(1,'reasoning.output',{content:{text:'one',isDelta:false},provenance:'provider'},{providerTurnId:'snapshot-turn'}),event(2,'reasoning.output',{content:{text:'onetwo',isDelta:false},provenance:'provider'},{providerTurnId:'snapshot-turn'}),event(3,'terminal.output',{command:'run',stdout:{text:'first',isDelta:false}},{spanId:'snapshot-terminal'}),event(4,'terminal.output',{command:'run',stdout:{text:'firstsecond',isDelta:false}},{spanId:'snapshot-terminal'}),event(5,'tool.output',{name:'task',result:{text:'progress 10',isDelta:false}},{spanId:'snapshot-tool'}),event(6,'tool.output',{name:'task',result:{text:'progress 20',isDelta:false}},{spanId:'snapshot-tool'})]
  const nodes=buildRuntimeGraph(projectRuntimeEvents(events)).nodes
  expect(nodes.find(node=>node.kind==='reasoning')!.content?.text).toBe('onetwo')
  expect(nodes.find(node=>node.kind==='terminal')!.terminal?.stdout?.text).toBe('firstsecond')
  expect(nodes.find(node=>node.kind==='tool')!.tool?.result?.text).toBe('progress 20')
})
test('attempt lifecycle uses explicit attempt identity; retries retain failed attempt',()=>{
  const nodes=buildRuntimeGraph(projectRuntimeEvents([event(1,'attempt.started',{status:'running'},{attemptId:'first'}),event(2,'attempt.completed',{status:'failed'},{attemptId:'first'}),event(3,'attempt.started',{status:'running'},{attemptId:'second'}),event(4,'attempt.completed',{status:'succeeded'},{attemptId:'second'})])).nodes
  expect(nodes).toHaveLength(2);expect(nodes.map(node=>node.status)).toEqual(['failed','succeeded']);expect(nodes[0]!.events).toHaveLength(2)
})
