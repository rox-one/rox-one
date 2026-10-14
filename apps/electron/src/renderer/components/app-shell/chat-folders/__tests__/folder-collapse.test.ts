import { describe, expect, it } from 'bun:test'
import { computeCollapsedPagination } from '@/hooks/useSessionSearch'
import type { SessionMeta } from '@/atoms/sessions'

const meta = (id: string, lastMessageAt: number) => ({ id, lastMessageAt, workspaceId: 'w' }) as unknown as SessionMeta

describe('computeCollapsedPagination with chat folders', () => {
  const items = [meta('a', 3), meta('b', 2), meta('c', 1)]
  const assignments = { a: 'f1', b: 'f1' }

  it('collapsing a folder hides exactly its chats and reports the count', () => {
    const r = computeCollapsedPagination(items, Infinity, new Set(['folder:f1']), 'date', undefined, assignments)
    expect(r.paginatedItems.map(i => i.id)).toEqual(['c'])
    expect(r.collapsedGroupsMeta).toEqual([{ key: 'folder:f1', count: 2 }])
  })

  it('folder keys win over the mode key (date groups do not hide foldered chats)', () => {
    const dayKey = new Date(new Date(1).setHours(0, 0, 0, 0)).toISOString()
    const r = computeCollapsedPagination(items, Infinity, new Set([dayKey]), 'date', undefined, assignments)
    expect(r.paginatedItems.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('without assignments behaves as before', () => {
    const r = computeCollapsedPagination(items, Infinity, new Set(['folder:f1']), 'date')
    expect(r.paginatedItems.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
})
