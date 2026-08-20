import { describe, expect, it } from 'bun:test'
import { collectDatabases, filterTree, mergeFolderChildren, type SiyuanDocTreeNode } from '../knowledge-tree'

const sample: SiyuanDocTreeNode[] = [
  {
    id: 'folder-1',
    name: 'Projects',
    path: '/projects',
    kind: 'folder',
    children: [
      { id: 'doc-1', name: 'Note', path: '/projects/note', kind: 'document' },
      { id: 'av-1', name: 'DB', path: '/projects/note', kind: 'database' },
    ],
  },
  { id: 'orphan-db', name: 'Standalone', path: '/db', kind: 'database' },
]

describe('filterTree', () => {
  it('keeps everything for all', () => {
    expect(filterTree(sample, 'all')).toEqual(sample)
  })

  it('drops databases for notes', () => {
    const notes = filterTree(sample, 'notes')
    expect(collectDatabases(notes)).toEqual([])
    expect(notes[0]?.children?.map((c) => c.kind)).toEqual(['document'])
  })

  it('keeps folder parents that contain databases', () => {
    const dbs = filterTree(sample, 'databases')
    expect(dbs.map((n) => n.kind)).toEqual(['folder', 'database'])
    expect(dbs[0]?.children?.map((c) => c.id)).toEqual(['av-1'])
  })
})

describe('collectDatabases', () => {
  it('walks nested databases', () => {
    expect(collectDatabases(sample).map((n) => n.id)).toEqual(['av-1', 'orphan-db'])
  })
})

describe('mergeFolderChildren', () => {
  it('replaces children of the matching folder path', () => {
    const next = mergeFolderChildren(sample, '/projects', [
      { id: 'doc-2', name: 'Nested', path: '/projects/nested', kind: 'document' },
    ])
    expect(next[0]?.children?.map((c) => c.id)).toEqual(['doc-2'])
    expect(next[1]?.id).toBe('orphan-db')
  })
})
