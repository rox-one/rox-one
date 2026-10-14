import { describe, expect, test } from 'bun:test'
import {
  NoopGraphMemoryProvider,
  graphHitToSearchHit,
  isFusableGraphHit,
  rrfFuse,
  withBudget,
  type GraphMemoryHit,
} from '../graph-provider.ts'
import type { MemorySearchHit } from '../types.ts'

const prov = (originClass: 'owner' | 'agent' | 'untrusted' | 'system' = 'owner') => ({
  originClass,
  sessionKind: 'interactive' as const,
  observedAt: '2026-10-14T00:00:00.000Z',
})
const hit = (id: string): MemorySearchHit => ({
  chunkId: id, path: `p/${id}`, startLine: 1, endLine: 1, score: 1, snippet: id, text: id, origin: 'owner', provenance: prov(),
})
const g = (id: string, originClass: 'owner' | 'untrusted' = 'owner'): GraphMemoryHit => ({
  id, source: 'notes', text: `fact ${id}`, score: 1, provenance: prov(originClass),
})

describe('rrfFuse', () => {
  test('single list keeps native order', () => {
    expect(rrfFuse([[hit('a'), hit('b'), hit('c')], []], 8).map(h => h.chunkId)).toEqual(['a', 'b', 'c'])
  })
  test('items present in both lists rise', () => {
    const out = rrfFuse([[hit('a'), hit('b'), hit('c')], [hit('c')]], 8)
    expect(out[0]!.chunkId).toBe('c')
  })
  test('respects limit and interleaves', () => {
    const out = rrfFuse([[hit('a'), hit('b')], [hit('x'), hit('y')]], 3)
    expect(out.map(h => h.chunkId)).toEqual(['a', 'x', 'b'])
  })
})

describe('graph hits', () => {
  test('untrusted and empty hits are not fusable', () => {
    expect(isFusableGraphHit(g('1'))).toBe(true)
    expect(isFusableGraphHit(g('2', 'untrusted'))).toBe(false)
    expect(isFusableGraphHit({ ...g('3'), text: '  ' })).toBe(false)
    expect(isFusableGraphHit({ ...g('4'), provenance: undefined as never })).toBe(false)
    expect(isFusableGraphHit({ ...g('5'), provenance: { ...prov('system') } })).toBe(false)
    expect(isFusableGraphHit(null)).toBe(false)
  })
  test('namespaced chunk id and path', () => {
    const h = graphHitToSearchHit({ ...g('n1'), ref: 'note.md' })
    expect(h.chunkId).toBe('graph:n1')
    expect(h.path).toBe('graph/notes/note.md')
    expect(h.origin).toBe('owner')
  })
  test('noop provider is disabled and empty', async () => {
    const p = new NoopGraphMemoryProvider()
    expect(p.status().state).toBe('disabled')
    expect(await p.search()).toEqual([])
  })
})

describe('withBudget', () => {
  test('returns fallback and aborts on timeout', async () => {
    let aborted = false
    const slow = new Promise<number>(r => setTimeout(() => r(1), 200))
    expect(await withBudget(slow, 10, 0, () => { aborted = true })).toBe(0)
    expect(aborted).toBe(true)
  })
  test('returns fallback on rejection, value when fast', async () => {
    expect(await withBudget(Promise.reject(new Error('x')), 50, 7)).toBe(7)
    expect(await withBudget(Promise.resolve(3), 50, 7)).toBe(3)
  })
})
