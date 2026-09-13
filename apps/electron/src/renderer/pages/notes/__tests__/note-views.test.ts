import { describe, expect, test } from 'bun:test'
import {
  addFormula,
  applyNoteBaseView,
  availableFormulaExprs,
  convertNote,
  createCanvasFileCard,
  dailyNoteDestination,
  filterGraphByEdgeKind,
  formulaI18nKey,
  formulaValue,
  graphFromLinks,
  groupNoteRows,
  isolateNoteNeighborhood,
  loadSavedViews,
  NOTE_GRAPH_PAGE_SIZE,
  notesOnlyGraph,
  notesOutlineFoldsStorageKey,
  outlineFromHeadings,
  parseJsonCanvas,
  parseNoteBaseView,
  parseOutlineFolds,
  progressiveGraph,
  projectNoteRows,
  removeFormula,
  restoreSavedViews,
  serializeJsonCanvas,
  serializeNoteBaseView,
  serializeOutlineFolds,
  tagFilterValue,
  toggleNoteViewSort,
  withTagFilter,
} from '../note-views'

describe('notes views', () => {
  const notes = [
    {
      id: 'ops/alpha',
      title: 'Alpha',
      tags: ['ship'],
      properties: { status: 'open' },
      tasks: [{ checked: false }, { checked: true }],
      backlinks: [{ noteId: 'ops/beta' }],
      links: [{ target: 'Beta' }],
    },
    {
      id: 'ops/beta',
      title: 'Beta',
      tags: ['later'],
      properties: { status: 'done' },
      tasks: [],
      backlinks: [],
      links: [],
    },
  ]

  test('table/base query restores filters, formulas, grouping and saved layout', () => {
    const view = parseNoteBaseView({
      v: 1,
      id: 'open-work',
      name: 'Open work',
      kind: 'base',
      filters: [{ field: 'tags', op: 'includes', value: 'ship' }],
      formulas: [{ name: 'Open', expr: 'openTaskCount' }],
      groupBy: 'folder',
      sort: { field: 'title', dir: 'asc' },
      columns: ['title', 'tags'],
    })
    expect(view?.kind).toBe('base')
    const rows = applyNoteBaseView(projectNoteRows(notes), view!)
    expect(rows.map((row) => row.id)).toEqual(['ops/alpha'])
    expect(formulaValue(rows[0]!, view!.formulas[0]!)).toBe(1)
    expect(groupNoteRows(rows, 'folder')).toEqual([
      { key: 'ops', rows },
    ])
    const restored = restoreSavedViews(`[${serializeNoteBaseView(view!)}]`)
    expect(restored).toEqual([view!])
  })

  test('JSON canvas import/export keeps card links and source-note provenance', () => {
    const card = createCanvasFileCard({ noteId: 'ops/alpha', title: 'Alpha', x: 40, y: 80 })
    const canvas = parseJsonCanvas(serializeJsonCanvas({
      nodes: [card, { id: 'sticky', type: 'text', x: 300, y: 80, width: 160, height: 80, text: 'idea' }],
      edges: [{ id: 'e1', fromNode: card.id, toNode: 'sticky' }],
    }))
    expect(canvas.nodes[0]?.noteId).toBe('ops/alpha')
    expect(canvas.nodes[0]?.file).toBe('ops/alpha.md')
    expect(canvas.edges).toEqual([{ id: 'e1', fromNode: card.id, toNode: 'sticky' }])
    expect(parseJsonCanvas('{"nodes":[{"id":"ghost"}]}').nodes).toEqual([])
  })

  test('outline, graph, daily destination and conversion keep provenance', () => {
    const outline = outlineFromHeadings('ops/alpha', [
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Details' },
    ], new Set(['ops/alpha:0:Intro']), 'project')
    expect(outline.children[0]?.collapsed).toBe(true)
    expect(outline.children[0]?.children[0]?.title).toBe('Details')
    expect(outline.supertag).toBe('project')

    const graph = graphFromLinks(notes)
    expect(graph.edges.some((edge) => edge.from === 'ops/alpha' && edge.to === 'ops/beta' && edge.kind === 'wikilink')).toBe(true)
    expect(graph.edges.some((edge) => edge.kind === 'backlink')).toBe(true)

    const converted = convertNote({ id: 'ops/alpha', title: 'Alpha', markdown: '# Alpha\n' }, 'session-draft')
    expect(converted).toEqual({
      kind: 'session-draft',
      title: 'Alpha',
      prompt: '# Alpha\n',
      provenance: { noteId: 'ops/alpha' },
    })
    expect(convertNote({ id: 'ops/alpha', title: 'Alpha', markdown: '- [ ] x' }, 'task').kind).toBe('task')
    expect(dailyNoteDestination(new Date('2026-09-12T12:00:00Z'))).toEqual({
      folder: 'daily',
      title: '2026-09-12',
    })
  })

  test('table toolbar helpers, graph kind filter and outline folds round-trip', () => {
    const views = loadSavedViews(null)
    expect(views[0]?.id).toBe('vault-table')
    const filtered = withTagFilter(views[0]!, 'ship')
    expect(tagFilterValue(filtered)).toBe('ship')
    expect(applyNoteBaseView(projectNoteRows(notes), filtered).map((row) => row.id)).toEqual(['ops/alpha'])
    expect(groupNoteRows(projectNoteRows(notes), 'folder').map((group) => group.key)).toEqual(['ops'])

    const graph = graphFromLinks(notes)
    expect(filterGraphByEdgeKind(graph, 'wikilink').edges.every((edge) => edge.kind === 'wikilink')).toBe(true)
    expect(filterGraphByEdgeKind(graph, 'backlink').edges.every((edge) => edge.kind === 'backlink')).toBe(true)
    expect(filterGraphByEdgeKind(graph, 'wikilink').nodes.map((node) => node.id).sort()).toEqual(['ops/alpha', 'ops/beta'])

    const folds = parseOutlineFolds(serializeOutlineFolds(new Set(['ops/alpha:0:Intro'])))
    expect(folds.has('ops/alpha:0:Intro')).toBe(true)
  })

  test('formula columns add, remove and evaluate without duplicating exprs', () => {
    const view = loadSavedViews(null)[0]!
    expect(view.formulas.map((formula) => formula.expr)).toEqual(['openTaskCount'])
    const withBacklinks = addFormula(view, 'backlinkCount')
    expect(addFormula(withBacklinks, 'backlinkCount').formulas).toHaveLength(2)
    expect(withBacklinks.columns).toContain('backlinkCount')
    expect(availableFormulaExprs(withBacklinks)).toEqual(['taskCount', 'tagCount'])
    expect(formulaI18nKey('backlinkCount')).toBe('notes.views.formulaBacklinks')
    const rows = projectNoteRows(notes)
    expect(formulaValue(rows[0]!, withBacklinks.formulas[1]!)).toBe(1)
    expect(removeFormula(withBacklinks, 'openTaskCount').formulas.map((formula) => formula.expr)).toEqual(['backlinkCount'])
    expect(removeFormula(withBacklinks, 'backlinkCount').columns).not.toContain('backlinkCount')
    expect(notesOutlineFoldsStorageKey('ws', 'ops/alpha')).toBe('notes:outline-folds:ws:ops/alpha')
  })

  test('formula engine filters, sorts and groups by named exprs and properties', () => {
    const rows = projectNoteRows(notes)
    const view = parseNoteBaseView({
      v: 1,
      id: 'formula-engine',
      name: 'Formula engine',
      kind: 'table',
      filters: [{ field: 'openTaskCount', op: 'gt', value: 0 }],
      formulas: [{ name: 'open', expr: 'openTaskCount' }, { name: 'tags', expr: 'tagCount' }],
      groupBy: 'openTaskCount',
      sort: { field: 'backlinkCount', dir: 'desc' },
      columns: ['title'],
    })
    expect(view).not.toBeNull()
    const visible = applyNoteBaseView(rows, view!)
    expect(visible.map((row) => row.id)).toEqual(['ops/alpha'])
    const sorted = applyNoteBaseView(rows, { ...view!, filters: [], sort: { field: 'taskCount', dir: 'desc' } })
    expect(sorted.map((row) => row.id)).toEqual(['ops/alpha', 'ops/beta'])
    expect(groupNoteRows(rows, 'openTaskCount', view!.formulas).map((group) => group.key)).toEqual(['1', '0'])
    const cycled = toggleNoteViewSort(toggleNoteViewSort(view!, 'openTaskCount'), 'openTaskCount')
    expect(cycled.sort).toEqual({ field: 'openTaskCount', dir: 'desc' })
    const byStatus = applyNoteBaseView(rows, {
      ...view!,
      filters: [{ field: 'status', op: 'eq', value: 'done' }],
      sort: { field: 'title', dir: 'asc' },
    })
    expect(byStatus.map((row) => row.id)).toEqual(['ops/beta'])
  })

  test('graph stays notes-only, isolates local neighborhood, and pages edges', () => {
    const graph = graphFromLinks(notes)
    const withEntity = {
      nodes: [...graph.nodes, { id: 'ent:ship', title: 'ship', kind: 'entity' as const }],
      edges: [...graph.edges, { from: 'ops/alpha', to: 'ent:ship', kind: 'wikilink' as const }],
    }
    const notesOnly = notesOnlyGraph(withEntity)
    expect(notesOnly.nodes.every((node) => node.kind === 'note')).toBe(true)
    expect(notesOnly.edges.some((edge) => edge.to === 'ent:ship')).toBe(false)

    const nearby = isolateNoteNeighborhood(graph, 'ops/alpha')
    expect(nearby.nodes.map((node) => node.id).sort()).toEqual(['ops/alpha', 'ops/beta'])
    expect(isolateNoteNeighborhood(graph, 'ops/beta').nodes.some((node) => node.id === 'ops/alpha')).toBe(true)

    const page = progressiveGraph(graph, 1)
    expect(page.edges).toHaveLength(1)
    expect(page.hidden).toBe(graph.edges.length - 1)
    expect(progressiveGraph(graph, NOTE_GRAPH_PAGE_SIZE).hidden).toBe(0)
  })
})
