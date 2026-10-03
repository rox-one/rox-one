import { describe, expect, it } from 'bun:test'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { projectRuntimeEvents } from '@rox/core/runtime-trace/projector'
import type { CapabilityRef, RuntimeEvent } from '@rox/core/runtime-trace'
import { createRuntimeTraceSessionState } from '../atoms/runtime-trace'
import type { LoadedSkill } from '../../shared/types'
import { buildCapabilityCatalog } from './capability-catalog'
import { runtimeCatalogCapabilities, runtimeCatalogScope } from './runtime-catalog-capabilities'

const scope = { workspaceId: 'fixture-workspace', sessionId: 'fixture-session' }
function skill(slug: string, source: LoadedSkill['source'] = 'workspace', shadowed = false): LoadedSkill {
  return { slug, source, path: `/fixture/${source}/${slug}`, metadata: { name: slug, description: 'Actual installed skill' }, content: 'body', shadowedByCraft: shadowed }
}
function lifecycle(kind: 'skill.selected' | 'skill.loaded' | 'skill.applied', slug: string, seq: number): RuntimeEvent {
  const base = createRuntimeTraceFixture()[0]!
  return { ...base, eventId: `capability-${seq}`, sourceEventId: `capability-${seq}`, seq, sourceSeq: seq, kind, payload: { capability: { kind: 'skill', id: slug, scope: 'session', label: slug } } }
}
function state(events: RuntimeEvent[], other: RuntimeEvent[] = []) {
  const current = projectRuntimeEvents(events)
  return { ...createRuntimeTraceSessionState(), activeRootRunId: 'fixture-run', projections: { 'fixture-run': current, ...(other.length ? { older: projectRuntimeEvents(other) } : {}) } }
}

describe('catalog runtime capabilities', () => {
  it('keeps available, selected, loaded and applied distinct and drives actual catalog rows', () => {
    const skills = [skill('available'), skill('selected'), skill('loaded'), skill('applied')]
    const evidence = runtimeCatalogCapabilities(state([lifecycle('skill.selected', 'selected', 1), lifecycle('skill.loaded', 'loaded', 2), lifecycle('skill.applied', 'applied', 3)]), scope, skills)
    expect(evidence.available.map(ref => ref.id)).toEqual(['available', 'selected', 'loaded', 'applied'])
    expect(evidence.selected.map(ref => ref.id)).toEqual(['selected'])
    expect(evidence.loaded.map(ref => ref.id)).toEqual(['loaded'])
    expect(evidence.applied.map(ref => ref.id)).toEqual(['applied'])
    expect(buildCapabilityCatalog({ skills, usedCapabilities: evidence.usedCapabilities }).filter(row => row.usedInRun).map(row => row.ref.id)).toEqual(['loaded', 'applied'])
  })
  it('resolves a session activation only through an exact unique unshadowed installed slug', () => {
    const events = [lifecycle('skill.loaded', 'same', 1)]
    const ambiguous = runtimeCatalogCapabilities(state(events), scope, [skill('same'), skill('same', 'omp')])
    expect(ambiguous.loaded[0]?.scope).toBe('session')
    expect(buildCapabilityCatalog({ skills: [skill('same'), skill('same', 'omp')], usedCapabilities: ambiguous.usedCapabilities }).some(row => row.usedInRun)).toBe(false)
    const resolved = runtimeCatalogCapabilities(state(events), scope, [skill('same'), skill('same', 'omp', true)])
    expect(resolved.loaded[0]?.scope).toBe('workspace')
    expect(resolved.available.map(ref => ref.scope)).toEqual(['workspace'])
    expect(runtimeCatalogCapabilities(state(events), scope, [skill('different')]).loaded[0]?.scope).toBe('session')
  })
  it('never resolves another child session activation against the parent installed origin', () => {
    const child = { ...lifecycle('skill.loaded', 'same', 1), sessionId: 'actual-child', runId: 'actual-child-run' }
    const evidence = runtimeCatalogCapabilities(state([child]), scope, [skill('same')])
    expect(evidence.loaded[0]?.scope).toBe('session')
    expect(buildCapabilityCatalog({ skills: [skill('same')], usedCapabilities: evidence.usedCapabilities })[0]?.usedInRun).toBe(false)
  })

  it('never marks another workspace, session or historical root as current usage', () => {
    const current = lifecycle('skill.selected', 'selected', 1)
    const historical = { ...lifecycle('skill.loaded', 'old', 1), rootRunId: 'older', runId: 'older' }
    const currentState = state([current], [historical])
    expect(runtimeCatalogCapabilities(currentState, scope, [skill('old')]).usedCapabilities).toEqual([])
    expect(runtimeCatalogCapabilities(currentState, { ...scope, workspaceId: 'other' }, [skill('selected')]).selected).toEqual([])
    expect(runtimeCatalogCapabilities(currentState, { ...scope, sessionId: 'other' }, [skill('selected')]).selected).toEqual([])
    expect(runtimeCatalogScope('fixture-workspace', 'session', 'other')).toBeUndefined()
    expect(runtimeCatalogScope('local-alias', 'session', 'remote-workspace', 'remote-workspace')).toEqual({ workspaceId: 'remote-workspace', sessionId: 'session' })
  })
  it('reads included skill context and explicit tool identity without treating source availability as execution', () => {
    const fixture = createRuntimeTraceFixture()
    const context = fixture.find(event => event.kind === 'context.captured')!
    if (context.kind !== 'context.captured') throw new Error('Expected context')
    const ref: CapabilityRef = { kind: 'skill', id: 'included', scope: 'project', label: 'Included' }
    const contextEvent: RuntimeEvent = { ...context, seq: 1, sourceSeq: 1, payload: { snapshot: { ...context.payload.snapshot, blocks: [
      { id: 'included', kind: 'skill', label: 'Included', source: 'actual-context', order: 0, content: { text: 'body' }, included: true, capability: ref },
      { id: 'omitted', kind: 'skill', label: 'Omitted', source: 'actual-context', order: 1, content: { availability: 'not-recorded' }, included: false, capability: { ...ref, id: 'omitted' } },
      { id: 'source', kind: 'source', label: 'Configured', source: 'actual-context', order: 2, content: { availability: 'not-recorded' }, included: true, capability: { kind: 'source', id: 'configured', scope: 'workspace', label: 'Configured' } },
    ] } } }
    const tool = fixture.find(event => event.kind === 'tool.started')!
    if (tool.kind !== 'tool.started') throw new Error('Expected tool')
    const event: RuntimeEvent = { ...tool, seq: 2, sourceSeq: 2, payload: { ...tool.payload, capability: { kind: 'source', id: 'actual-source', scope: 'workspace', label: 'Same display name' } } }
    const evidence = runtimeCatalogCapabilities(state([contextEvent, event]), scope)
    expect(evidence.loaded.map(ref => ref.id)).toEqual(['included'])
    expect(evidence.applied).toEqual([])
    expect(evidence.usedCapabilities.map(ref => ref.id)).toEqual(['included', 'actual-source'])
  })
  it('keeps configured connections unobserved until explicit model confirmation', () => {
    const base = createRuntimeTraceFixture()[0]!
    const connection: CapabilityRef = { kind: 'model-connection', id: 'actual-connection', scope: 'global', label: 'Public model label' }
    const unknownModel: RuntimeEvent = { ...base, kind: 'model.confirmed', payload: { model: { confirmed: { state: 'unknown', reason: 'not-emitted' }, contextWindow: { state: 'unknown', reason: 'not-emitted' }, connection } } }
    expect(runtimeCatalogCapabilities(state([unknownModel]), scope).usedCapabilities).toEqual([])
    const confirmed: RuntimeEvent = { ...unknownModel, payload: { model: { ...unknownModel.payload.model, confirmed: { state: 'known', value: 'public/alias', source: 'actual-readback', origin: 'observed' } } } }
    expect(runtimeCatalogCapabilities(state([confirmed]), scope).usedCapabilities).toEqual([connection])
  })

  it('allows the canonical parent projection only after the child alias was validated', () => {
    const current = state([lifecycle('skill.loaded', 'loaded', 1)])
    const childScope = { ...scope, sessionId: 'actual-child' }
    expect(runtimeCatalogCapabilities(current, childScope, [skill('loaded')]).usedCapabilities).toEqual([])
    expect(runtimeCatalogCapabilities({ ...current, canonicalSessionId: scope.sessionId }, childScope, [skill('loaded')]).usedCapabilities.map(ref => ref.id)).toEqual(['loaded'])
  })
})
