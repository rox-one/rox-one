import { describe, expect, test } from 'bun:test'
import { createRuntimeTraceFixture } from './fixture'
import { createRuntimeProjection, reduceRuntimeEvent, projectRuntimeEvents, buildRuntimeGraph, runtimeProjectionCoverage, projectTurnOutline, projectTokenUsage, projectContextPressure, projectContextBreakdown } from './projector'
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
  test('links explicit artifact evidence and answer artifact IDs without guessing from text or paths',()=>{
    const output=Array.from({length:200},(_,index)=>event(index+1,'tool.output',{name:'read',result:{text:'actual input'}},{spanId:'input-stream'}))
    const artifact=event(201,'artifact.created',{artifact:{id:'saved-report',label:'Report',uri:'task://actual/run/nodes/report',evidenceEventIds:['test:1','absent']}})
    const answer=event(202,'result.published',{content:{text:'Answer refers to task://other/path'},artifactIds:['saved-report','absent']})
    const graph=buildRuntimeGraph(projectRuntimeEvents([...output,artifact,answer]))
    const inputNode=graph.nodes.find(node=>node.kind==='tool')!
    const artifactNode=graph.nodes.find(node=>node.kind==='artifact')!
    const answerNode=graph.nodes.find(node=>node.kind==='result')!
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges).toContainEqual(expect.objectContaining({source:inputNode.id,target:artifactNode.id,kind:'data-dependency'}))
    expect(graph.edges).toContainEqual(expect.objectContaining({source:artifactNode.id,target:answerNode.id,kind:'data-dependency'}))
    expect(buildRuntimeGraph(projectRuntimeEvents([event(1,'artifact.created',{artifact:{id:'unrelated',label:'Report',uri:'task://other/path'}}),event(2,'result.published',{content:{text:'task://other/path'}})])).edges).toHaveLength(0)
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
describe('dsh-p1 usage projections', () => {
  const step = (seq: number, kind: 'step.started' | 'step.completed', turnId: string, stepNo: number, extra: Partial<RuntimeEvent> = {}) =>
    event(seq, kind, { turnId, step: stepNo }, extra)
  const attempt = (seq: number, turnId: string, stepNo: number, usage: Record<string, number | undefined>, extraPayload: Record<string, unknown> = {}, extra: Partial<RuntimeEvent> = {}) =>
    event(seq, 'llm.attempt.completed', { turnId, step: stepNo, usage, ...extraPayload }, extra)
  const fullUsage = { uncachedInput: 100, output: 20, cacheRead: 800, cacheWrite: 10 }
  const fullCost = { costUsd: 0.01 }

  test('turnOutline counts turns and steps; in-flight steps count; runs do not merge', () => {
    expect(projectTurnOutline([])).toEqual({ turns: [], turnCount: 0, stepCount: 0 })
    const events = [
      step(1, 'step.started', 'turn-a', 1), step(2, 'step.completed', 'turn-a', 1),
      step(3, 'step.started', 'turn-a', 2), step(4, 'step.completed', 'turn-a', 2),
      step(5, 'step.started', 'turn-b', 1),
      attempt(6, 'turn-c', 1, fullUsage),
    ]
    const outline = projectTurnOutline(events)
    expect(outline.turnCount).toBe(3)
    expect(outline.stepCount).toBe(4) // 2 + 1 in-flight + 1 from the attempt event
    expect(outline.turns.map(turn => turn.turnId)).toEqual(['turn-a', 'turn-b', 'turn-c'])
    // Same provider turn id in another run is another outline turn.
    expect(projectTurnOutline([step(1, 'step.started', 'turn-a', 1), step(2, 'step.started', 'turn-a', 1, { rootRunId: 'other-run' })]).turnCount).toBe(2)
  })

  test('tokenUsage bills every attempt; retries link but never replace', () => {
    const events = [
      attempt(1, 'turn-a', 1, fullUsage, { route: { provider: 'pi', model: 'rox/r1-max' }, ...fullCost }),
      attempt(2, 'turn-a', 2, { ...fullUsage, output: 5 }, { retryOf: 'first', ...fullCost }),
      attempt(3, 'turn-b', 1, { uncachedInput: 50 }),
    ]
    const usage = projectTokenUsage(events)
    expect(usage.totals.attempts).toBe(3)
    expect(usage.totals.retries).toBe(1)
    expect(usage.totals.uncachedInput).toBe(250)
    expect(usage.totals.output).toBe(25) // only attempts that reported output
    expect(usage.totals.costUsd).toBe(0.02)
    expect(usage.totals.partial).toBe(true) // turn-b reported no output
    expect(usage.perTurn).toHaveLength(2)
    expect(usage.perTurn[0]).toMatchObject({ turnId: 'turn-a', attempts: 2, retries: 1, output: 25 })
    expect(usage.attempts[1]!.retryOf).toBe('first')
  })

  test('missing usage fields stay undefined, never zero-filled', () => {
    const usage = projectTokenUsage([attempt(1, 'turn-a', 1, {})])
    expect(usage.totals.attempts).toBe(1)
    expect(usage.totals.uncachedInput).toBeUndefined()
    expect(usage.totals.output).toBeUndefined()
    expect(usage.totals.costUsd).toBeUndefined()
    expect(usage.totals.partial).toBe(true)
    const empty = projectTokenUsage([]).totals
    expect(empty.attempts).toBe(0)
    expect(empty.output).toBeUndefined()
    expect(empty.costUsd).toBeUndefined()
    expect(empty.partial).toBe(false)
  })

  test('contextPressure pairs newest prompt with newest window', () => {
    const none = projectContextPressure([])
    expect(none.pressureTokens).toBeUndefined()
    expect(none.percent).toBeUndefined()
    const captured = event(1, 'context.captured', { snapshot: {
      id: 'ctx', version: 1, capturedAt: known(1, 'test'), originalPrompt: { text: 'hi' }, effectivePrompt: { text: 'hi' },
      model: { confirmed: known('m', 'test'), contextWindow: known(1000, 'test') }, blocks: [], inputTokens: unknown(),
      coverage: { state: 'complete', source: 'runtime', missing: [] } } })
    const pressure = projectContextPressure([captured, attempt(2, 'turn-a', 1, { uncachedInput: 100, cacheRead: 800, cacheWrite: 10 })])
    expect(pressure).toMatchObject({ pressureTokens: 910, contextWindow: 1000, percent: 91, partial: false })
    // Attempt-reported window wins when no snapshot exists; percent needs a window.
    expect(projectContextPressure([attempt(1, 't', 1, { uncachedInput: 50 }, { contextWindow: 200 })])).toMatchObject({ pressureTokens: 50, percent: 25 })
    expect(projectContextPressure([attempt(1, 't', 1, { output: 5 })]).pressureTokens).toBeUndefined()
  })

  test('contextBreakdown is a labelled heuristic split, absent without snapshots', () => {
    expect(projectContextBreakdown([attempt(1, 't', 1, fullUsage)])).toBeUndefined()
    const snapshot = (blocks: { kind: string; text: string }[]) => event(1, 'context.captured', { snapshot: {
      id: 'ctx', version: 1, capturedAt: known(1, 'test'), originalPrompt: { text: '' }, effectivePrompt: { text: '' },
      model: { confirmed: known('m', 'test'), contextWindow: unknown() },
      blocks: blocks.map((block, order) => ({ id: `b${order}`, kind: block.kind, label: block.kind, source: 'test', order, content: { text: block.text }, included: true })),
      inputTokens: unknown(), coverage: { state: 'complete', source: 'runtime', missing: [] } } })
    const breakdown = projectContextBreakdown([snapshot([
      { kind: 'system', text: 'x'.repeat(400) }, { kind: 'tool-schema', text: 'y'.repeat(40) }, { kind: 'history', text: 'z'.repeat(4) },
    ])])
    expect(breakdown?.heuristic).toBe(true)
    // ceil(400/4)+4=104 system, ceil(40/4)+4=14 tools, ceil(4/4)+4=5 messages.
    expect(breakdown).toMatchObject({ system: 104, tools: 14, messages: 5 })
  })

  test('new payloads validate; malformed step/attempt events are rejected', () => {
    expect(isRuntimeEvent(step(1, 'step.started', 'turn-a', 1))).toBe(true)
    expect(isRuntimeEvent(attempt(1, 'turn-a', 1, fullUsage, { route: { provider: 'pi', model: 'm' }, retryOf: 'x', contextWindow: 1000, costUsd: 0.5, ttftMs: 10, decodeMs: 20 }))).toBe(true)
    expect(isRuntimeEvent(step(1, 'step.started', 'turn-a', -1))).toBe(false)
    expect(isRuntimeEvent(event(1, 'llm.attempt.completed', { turnId: 't', step: 1, usage: { output: -5 } }))).toBe(false)
    expect(isRuntimeEvent(event(1, 'llm.attempt.completed', { turnId: '', step: 1, usage: {} }))).toBe(false)
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
