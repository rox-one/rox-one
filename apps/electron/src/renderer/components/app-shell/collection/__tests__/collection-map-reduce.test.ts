import { describe, expect, it } from 'bun:test'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { mapReduceProductResult, mapReduceVisibleSessions, mapSourcesFromSessionMeta } from '../collection-map-reduce'
import type { SessionMeta } from '@/atoms/sessions'

function meta(id: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return { id, workspaceId: 'ws', name: id, preview: `${id}-preview`, lastMessageAt: 10, ...patch }
}

describe('collection map-reduce adapter', () => {
  it('builds snapshot sources from session meta in visual order', () => {
    const sources = mapSourcesFromSessionMeta(['b', 'a'], new Map([
      ['a', meta('a', { name: 'Alpha' })],
      ['b', meta('b', { name: 'Beta' })],
    ]))
    expect(sources.map((source) => source.title)).toEqual(['Beta', 'Alpha'])
  })

  it('does not claim full coverage when a selected session is missing', async () => {
    const result = await mapReduceVisibleSessions({
      ids: ['a', 'missing'],
      metaById: new Map([['a', meta('a', { name: 'Alpha' })]]),
    })
    expect(result.coverage.complete).toBe(false)
    expect(isClaimableLive(mapReduceProductResult(result))).toBe(false)
    expect(result.outcomes).toHaveLength(1)
  })
})
