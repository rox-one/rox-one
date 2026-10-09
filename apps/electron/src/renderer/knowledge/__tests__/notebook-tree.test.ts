/**
 * KnowledgeNotebookTree logic tests — the navigator sections' data plumbing:
 * notebooks via the knowledge:listNotebooks RPC (honest unavailable/empty states),
 * recent + favorites derived from work envelopes (flagged / updatedAt ordering),
 * saved views from views.json. No DOM — helpers only (KnowledgeHome precedent).
 */
import { describe, expect, it } from 'bun:test'
import type { KnowledgeNotebookInfo, KnowledgeWorkEnvelope } from '../../../shared/types'
import {
  loadKnowledgeNavigatorData,
  selectFavoriteEnvelopes,
  selectRecentEnvelopes,
  uncontractedNavSectionPresentation,
  navSectionPresentation,
  UNCONTRACTED_NAV_SECTION_IDS,
  flattenNotebookRows,
  KNOWLEDGE_TREE_WINDOW_THRESHOLD,
  type KnowledgeTreeRow,
  type KnowledgeNavigatorApi,
} from '../KnowledgeNotebookTree'
import { mergeFolderChildren, type SiyuanDocTreeNode } from '../knowledge-tree'
import { ENTITY_LIST_OVERSCAN, flattenEntityListGroups } from '@/components/ui/entity-list'
import { virtualTableWindow } from '@/components/app-shell/session-table/table-virtualization'

function envelope(id: string, overrides: Partial<KnowledgeWorkEnvelope> = {}): KnowledgeWorkEnvelope {
  return {
    knowledgeRef: { scheme: 'siyuan', kind: 'document', id },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

const NOTEBOOKS: KnowledgeNotebookInfo[] = [
  { id: 'nb-1', name: 'Research', icon: '1f4da', closed: false },
  { id: 'nb-2', name: 'Inbox', icon: '', closed: true },
]

function apiDouble(overrides: Partial<KnowledgeNavigatorApi> = {}): KnowledgeNavigatorApi {
  return {
    async listConnections() {
      return [{ id: 'conn-1' }]
    },
    async listNotebooks() {
      return NOTEBOOKS
    },
    async viewsList() {
      return []
    },
    async envelopeList() {
      return []
    },
    async get() {
      throw new Error('not found')
    },
    ...overrides,
  }
}

describe('selectRecentEnvelopes', () => {
  it('sorts by updatedAt desc, drops archived, and caps at the limit', () => {
    const envelopes = [
      envelope('a', { updatedAt: 100 }),
      envelope('b', { updatedAt: 300 }),
      envelope('c', { updatedAt: 200, archived: true }),
      envelope('d', { updatedAt: 400 }),
    ]
    const recent = selectRecentEnvelopes(envelopes, 2)
    expect(recent.map((e) => e.knowledgeRef.id)).toEqual(['d', 'b'])
  })

  it('returns an empty list for no envelopes', () => {
    expect(selectRecentEnvelopes([], 10)).toEqual([])
  })
})

describe('selectFavoriteEnvelopes', () => {
  it('keeps only flagged, non-archived envelopes, newest first', () => {
    const envelopes = [
      envelope('a', { flagged: true, updatedAt: 100 }),
      envelope('b', { flagged: false, updatedAt: 900 }),
      envelope('c', { flagged: true, updatedAt: 500 }),
      envelope('d', { flagged: true, updatedAt: 700, archived: true }),
    ]
    const favorites = selectFavoriteEnvelopes(envelopes)
    expect(favorites.map((e) => e.knowledgeRef.id)).toEqual(['c', 'a'])
  })
})

describe('loadKnowledgeNavigatorData', () => {
  it('returns notebooks, views, and envelope rows with resolved titles', async () => {
    const api = apiDouble({
      async viewsList() {
        return [
          { id: 'v-1', name: 'Stale docs', domain: 'knowledge' },
          // Non-knowledge domain views must not leak into the knowledge navigator.
          { id: 'v-2', name: 'Sessions view', domain: 'sessions' },
        ] as never
      },
      async envelopeList() {
        return [
          envelope('doc-fav', { flagged: true, updatedAt: 500 }),
          envelope('doc-recent', { updatedAt: 900 }),
        ]
      },
      async get(args: { ref: { id: string } }) {
        return { title: `Title of ${args.ref.id}` } as never
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks).toEqual({ status: 'ok', items: NOTEBOOKS })
    expect(data.views.map((v) => v.id)).toEqual(['v-1'])
    expect(data.favorites.map((r) => r.envelope.knowledgeRef.id)).toEqual(['doc-fav'])
    expect(data.favorites[0]!.title).toBe('Title of doc-fav')
    expect(data.recent.map((r) => r.envelope.knowledgeRef.id)).toEqual(['doc-recent', 'doc-fav'])
  })

  it('marks notebooks empty when the kernel has none', async () => {
    const data = await loadKnowledgeNavigatorData(apiDouble({ async listNotebooks() { return [] } }))
    expect(data.notebooks).toEqual({ status: 'empty', items: [] })
  })

  it('marks notebooks unavailable (typed, never thrown) when the RPC fails', async () => {
    const api = apiDouble({
      async listNotebooks() {
        throw new Error('CONNECTION_UNAVAILABLE: kernel offline')
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('unavailable')
    expect(data.notebooks.items).toEqual([])
  })

  it('marks notebooks unavailable when the preload predates the channel', async () => {
    const api = apiDouble({ listNotebooks: undefined })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('unavailable')
  })

  it('marks notebooks unavailable when no connection is configured', async () => {
    const api = apiDouble({ async listConnections() { return [] } })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('unavailable')
  })

  it('fails soft to empty views/envelopes when those channels error', async () => {
    const api = apiDouble({
      async viewsList() {
        throw new Error('boom')
      },
      async envelopeList() {
        throw new Error('boom')
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.views).toEqual([])
    expect(data.recent).toEqual([])
    expect(data.favorites).toEqual([])
    expect(data.notebooks.status).toBe('ok')
  })

  it('keeps rows usable when title resolution fails (fail-soft per row)', async () => {
    const api = apiDouble({
      async envelopeList() {
        return [envelope('doc-x', { flagged: true, updatedAt: 5 })]
      },
      async get() {
        throw new Error('kernel gone')
      },
    })
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.favorites).toHaveLength(1)
    expect(data.favorites[0]!.title).toBeUndefined()
  })
})

describe('uncontractedNavSectionPresentation', () => {
  it('hides empty Inbox/Daily/Tags so they do not look like a load failure', () => {
    expect(UNCONTRACTED_NAV_SECTION_IDS).toEqual(['inbox', 'daily', 'databases', 'tags'])
    for (const id of ['inbox', 'daily', 'tags'] as const) {
      expect(UNCONTRACTED_NAV_SECTION_IDS).toContain(id)
      expect(uncontractedNavSectionPresentation(0)).toBe('hidden')
    }
    expect(uncontractedNavSectionPresentation(0)).not.toBe('unavailable')
    expect(uncontractedNavSectionPresentation(0)).not.toBe('error')
    expect(uncontractedNavSectionPresentation(0)).not.toBe('loading')
  })

  it('lists items when a future provider actually returns some', () => {
    expect(uncontractedNavSectionPresentation(3)).toBe('items')
  })

  it('marks unsupported capabilities separately from hidden empty and kernel unavailable', () => {
    expect(navSectionPresentation({ featureSupported: false, itemCount: 0 })).toBe('unsupported')
    expect(navSectionPresentation({ featureSupported: false, itemCount: 3 })).toBe('unsupported')
    expect(navSectionPresentation({ featureSupported: true, itemCount: 0 })).toBe('hidden')
    expect(navSectionPresentation({ featureSupported: true, itemCount: 2 })).toBe('items')
    expect(navSectionPresentation({ featureSupported: false, itemCount: 0 })).not.toBe('hidden')
  })
})

describe('mergeFolderChildren', () => {
  it('replaces children of the folder matching path', () => {
    const tree: SiyuanDocTreeNode[] = [
      {
        id: 'folder-1',
        name: 'Projects',
        path: '/projects',
        kind: 'folder',
        children: [{ id: 'old', name: 'Old', path: '/projects/old', kind: 'document' }],
      },
      { id: 'other', name: 'Other', path: '/other', kind: 'document' },
    ]
    const kids: SiyuanDocTreeNode[] = [
      { id: 'new', name: 'New', path: '/projects/new', kind: 'document' },
    ]
    const merged = mergeFolderChildren(tree, '/projects', kids)
    expect(merged[0]?.children?.map((c) => c.id)).toEqual(['new'])
    expect(merged[1]?.id).toBe('other')
  })

  it('merges nested folders by path', () => {
    const tree: SiyuanDocTreeNode[] = [
      {
        id: 'outer',
        name: 'Outer',
        path: '/outer',
        kind: 'folder',
        children: [
          { id: 'inner', name: 'Inner', path: '/outer/inner', kind: 'folder' },
        ],
      },
    ]
    const kids: SiyuanDocTreeNode[] = [{ id: 'leaf', name: 'Leaf', path: '/outer/inner/leaf', kind: 'document' }]
    const merged = mergeFolderChildren(tree, '/outer/inner', kids)
    expect(merged[0]?.children?.[0]?.children?.map((c) => c.id)).toEqual(['leaf'])
  })

  it('assigns empty children on a matching folder', () => {
    const tree: SiyuanDocTreeNode[] = [
      { id: 'folder-1', name: 'Projects', path: '/projects', kind: 'folder' },
    ]
    const merged = mergeFolderChildren(tree, '/projects', [])
    expect(merged[0]?.children).toEqual([])
  })
})

function documentNodes(count: number, prefix = 'n'): SiyuanDocTreeNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `Node ${i}`,
    path: `/n/${i}`,
    kind: 'document' as const,
  }))
}

function mountedCount(rows: KnowledgeTreeRow[], scrollTop: number): number {
  const flattened = flattenEntityListGroups(undefined, rows, new Set<string>(), {
    getItemKey: (row) => row.key,
    rowHeight: 30,
    headerHeight: 0,
  })
  const range = virtualTableWindow(flattened.entries, scrollTop, 640, ENTITY_LIST_OVERSCAN)
  return range.endIndex - range.startIndex
}

describe('flattenNotebookRows', () => {
  it('emits one row per notebook plus its expanded, filtered tree nodes', () => {
    const rows = flattenNotebookRows(NOTEBOOKS, { 'nb-1': documentNodes(500) }, 'all')
    expect(rows.filter((row) => row.kind === 'notebook')).toHaveLength(NOTEBOOKS.length)
    expect(rows.filter((row) => row.kind === 'node')).toHaveLength(500)
    expect(rows.length).toBeGreaterThan(KNOWLEDGE_TREE_WINDOW_THRESHOLD)
  })

  it('mounts far fewer rows than the total when windowed', () => {
    const rows = flattenNotebookRows(NOTEBOOKS, { 'nb-1': documentNodes(500) }, 'all')
    const bound = Math.ceil((640 + 2 * ENTITY_LIST_OVERSCAN) / 30) + 4
    expect(mountedCount(rows, 0)).toBeGreaterThan(0)
    expect(mountedCount(rows, 0)).toBeLessThan(bound)
    expect(mountedCount(rows, 3000)).toBeLessThan(bound)
    expect(mountedCount(rows, 0)).toBeLessThan(rows.length / 10)
  })

  it('shows a loading row instead of nodes while a notebook tree is fetched', () => {
    const rows = flattenNotebookRows(NOTEBOOKS, { 'nb-1': 'loading' }, 'all')
    expect(rows.filter((row) => row.kind === 'loading')).toHaveLength(1)
    expect(rows.filter((row) => row.kind === 'node')).toHaveLength(0)
  })

  it('drops documents under the databases filter', () => {
    const tree: SiyuanDocTreeNode[] = [
      ...documentNodes(20),
      { id: 'db-1', name: 'Grid', path: '/grid', kind: 'database' },
    ]
    const rows = flattenNotebookRows([NOTEBOOKS[0]!], { 'nb-1': tree }, 'databases')
    expect(rows.filter((row) => row.kind === 'node')).toHaveLength(1)
    expect(rows.find((row) => row.kind === 'node')?.node.id).toBe('db-1')
  })
})
