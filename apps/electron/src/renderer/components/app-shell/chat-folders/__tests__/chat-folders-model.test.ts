import { describe, expect, it } from 'bun:test'
import { buildFolderView, readCollapsedFolders } from '../chat-folders-model'

const state = {
  version: 1 as const,
  folders: [{ id: 'a', name: 'Research', createdAt: 0 }, { id: 'b', name: 'Empty', createdAt: 0 }],
  assignments: { s1: 'a' } as Record<string, string>,
}
const items = [
  { id: 's1', title: 'Market sizing', lastMessageAt: 2 },
  { id: 's2', title: 'Groceries', lastMessageAt: 3 },
]
const title = (i: { title: string }) => i.title

describe('buildFolderView', () => {
  it('keeps empty folders and puts Ungrouped last without a query', () => {
    const v = buildFolderView(items, state, '', title)
    expect(v.map(g => g.folder?.id ?? null)).toEqual(['a', 'b', null])
  })
  it('filters chats by title and hides empty folders while searching', () => {
    const v = buildFolderView(items, state, 'groc', title)
    expect(v.map(g => [g.folder?.id ?? null, g.items.map(i => i.id)])).toEqual([[null, ['s2']]])
  })
  it('a folder-name hit shows all its chats', () => {
    const v = buildFolderView(items, state, 'research', title)
    expect(v.map(g => [g.folder?.id ?? null, g.items.map(i => i.id)])).toEqual([['a', ['s1']]])
  })
})

describe('readCollapsedFolders', () => {
  it('tolerates garbage', () => {
    expect([...readCollapsedFolders(['a', 1, null])]).toEqual(['a'])
    expect(readCollapsedFolders('x').size).toBe(0)
  })
})
