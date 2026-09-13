import { describe, expect, test } from 'bun:test'
import {
  applyNoteBaseView,
  convertNote,
  createCanvasFileCard,
  dailyNoteDestination,
  filterGraphByEdgeKind,
  formulaValue,
  graphFromLinks,
  groupNoteRows,
  loadSavedViews,
  notesOutlineFoldsStorageKey,
  outlineFromHeadings,
  parseJsonCanvas,
  parseNoteBaseView,
  parseOutlineFolds,
  projectNoteRows,
  restoreSavedViews,
  serializeJsonCanvas,
  serializeNoteBaseView,
  serializeOutlineFolds,
  tagFilterValue,
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
    expect(notesOutlineFoldsStorageKey('ws', 'ops/alpha')).toBe('notes:outline-folds:ws:ops/alpha')
  })
})
