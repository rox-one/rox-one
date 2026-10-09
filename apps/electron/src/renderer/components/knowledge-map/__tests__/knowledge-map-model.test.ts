import { describe, expect, it } from 'bun:test'
import type {
  KnowledgeMapEdge,
  KnowledgeMapNode,
  KnowledgeMapStats,
} from '@rox/shared/knowledge/knowledge-map-types'
import {
  AREA_COLORS,
  AREA_LABEL_KEYS,
  buildStatItems,
  buildTree,
  degreeOf,
  filterGraph,
  formatCount,
  nodeMatchesQuery,
  truncatedSummary,
} from '../knowledge-map-model'

function node(
  partial: Partial<KnowledgeMapNode> & Pick<KnowledgeMapNode, 'id' | 'label' | 'area' | 'kind'>,
): KnowledgeMapNode {
  return { size: 10, linkCount: 0, relPath: null, ...partial }
}

const root = node({ id: 'root', label: 'Профиль', area: 'root', kind: 'root' })
const contextArea = node({ id: 'area:context', label: 'context', area: 'context', kind: 'area' })
const c1 = node({ id: 'context:soul.md', label: 'Soul', area: 'context', kind: 'doc', relPath: 'soul.md' })
const c2 = node({ id: 'context:rules.md', label: 'Rules', area: 'context', kind: 'doc', relPath: 'rules.md' })
const m1 = node({ id: 'memory:pref.md', label: 'Preferences', area: 'memory', kind: 'doc', relPath: 'pref.md' })
const n1 = node({ id: 'notes:plan.md', label: 'План', area: 'notes', kind: 'doc', relPath: 'plan.md' })

const nodes = [root, contextArea, c1, c2, m1, n1]
const edges: KnowledgeMapEdge[] = [
  { source: 'root', target: 'area:context', kind: 'member' },
  { source: 'area:context', target: 'context:soul.md', kind: 'member' },
  { source: 'area:context', target: 'context:rules.md', kind: 'member' },
  { source: 'context:soul.md', target: 'context:rules.md', kind: 'link' },
  { source: 'context:soul.md', target: 'memory:pref.md', kind: 'link' },
]

const stats: KnowledgeMapStats = {
  files: 4,
  total: 4,
  links: 2,
  areas: 3,
  bytes: 8192,
  truncated: false,
  skipped: 0,
}

describe('knowledge-map-model area labels/colors', () => {
  it('maps every area to a plan §4 label key and a design token', () => {
    expect(AREA_LABEL_KEYS.context).toBe('knowledgeMap.area.context')
    expect(AREA_LABEL_KEYS.memory).toBe('knowledgeMap.area.memory')
    expect(AREA_LABEL_KEYS.notes).toBe('knowledgeMap.area.notes')
    expect(AREA_COLORS.context).toContain('var(')
    expect(AREA_COLORS.memory).toContain('var(')
    expect(AREA_COLORS.notes).toContain('var(')
  })
})

describe('nodeMatchesQuery', () => {
  it('matches label, id and relative path case-insensitively', () => {
    expect(nodeMatchesQuery(c1, 'soul')).toBe(true)
    expect(nodeMatchesQuery(c1, 'SOUL.MD')).toBe(true)
    expect(nodeMatchesQuery(n1, 'план')).toBe(true)
    expect(nodeMatchesQuery(c1, 'missing')).toBe(false)
    expect(nodeMatchesQuery(c1, '   ')).toBe(true)
  })
})

describe('filterGraph', () => {
  it('keeps group nodes and drops non-matching documents and their edges', () => {
    const result = filterGraph(nodes, edges, 'soul')
    const ids = result.nodes.map((n) => n.id)
    expect(ids).toContain('root')
    expect(ids).toContain('area:context')
    expect(ids).toContain('context:soul.md')
    expect(ids).not.toContain('context:rules.md')
    expect(ids).not.toContain('memory:pref.md')
    for (const edge of result.edges) {
      expect(ids).toContain(edge.source)
      expect(ids).toContain(edge.target)
    }
  })

  it('returns the full graph for a blank query', () => {
    const result = filterGraph(nodes, edges, '  ')
    expect(result.nodes).toHaveLength(nodes.length)
    expect(result.edges).toHaveLength(edges.length)
  })
})

describe('degreeOf', () => {
  it('counts undirected incident edges', () => {
    expect(degreeOf('context:soul.md', edges)).toBe(3)
    expect(degreeOf('memory:pref.md', edges)).toBe(1)
    expect(degreeOf('root', edges)).toBe(1)
  })
})

describe('buildStatItems', () => {
  it('builds one item per plan §4 stat token', () => {
    const items = buildStatItems(stats, 'en-US')
    expect(items.map((item) => item.key)).toEqual([
      'knowledgeMap.stats.files',
      'knowledgeMap.stats.links',
      'knowledgeMap.stats.areas',
      'knowledgeMap.stats.bytes',
    ])
    expect(items[0].value).toBe('4')
    expect(items[3].value).toBe('8,192')
    expect(formatCount(42, 'en-US')).toBe('42')
  })
})

describe('truncatedSummary', () => {
  it('is null when the corpus was not truncated', () => {
    expect(truncatedSummary(stats)).toBeNull()
  })

  it('carries the honest shown/total counts when truncated', () => {
    const summary = truncatedSummary({ ...stats, truncated: true, files: 400, total: 512, skipped: 3 })
    expect(summary).toEqual({ key: 'knowledgeMap.truncated', shown: 400, total: 512 })
  })

  it('uses the pre-limit total, not files + skipped', () => {
    const summary = truncatedSummary({ ...stats, truncated: true, files: 10, total: 10, skipped: 7 })
    expect(summary!.shown).toBe(10)
    expect(summary!.total).toBe(10)
  })
})

describe('buildTree', () => {
  it('groups documents by area in stable order', () => {
    const groups = buildTree(nodes)
    expect(groups.map((group) => group.area)).toEqual(['context', 'memory', 'notes'])
    expect(groups[0].nodes.map((n) => n.id)).toEqual(['context:rules.md', 'context:soul.md'])
    expect(groups[1].nodes.map((n) => n.id)).toEqual(['memory:pref.md'])
  })
})