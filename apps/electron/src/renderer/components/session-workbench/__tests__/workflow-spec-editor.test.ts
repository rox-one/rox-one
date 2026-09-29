import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSessionDraftNode, serializeSessionDraftGraph, parseSessionDraftGraph } from '../draft-nodes'
import { draftGraphToSpec, specToDraftGraph } from '../workflow-document'
import { isSessionMapEmpty } from '../map-empty-actions'

const editorSource = readFileSync(join(__dirname, '..', 'SessionWorkflowEditor.tsx'), 'utf8')

describe('workflow spec editor wiring', () => {
  test('palette, conversion, promote, version, and run actions are wired', () => {
    expect(editorSource).toContain("handleCreateNode('note')")
    expect(editorSource).toContain('handlePromoteTrace')
    expect(editorSource).toContain("handleRun('pipeline')")
    expect(editorSource).toContain("handleRun('from-here')")
    expect(editorSource).toContain('handleSaveVersion')
    expect(editorSource).toContain('mapConvertNode')
    expect(editorSource).toContain('SESSION_NODE_KINDS.map')
    expect(editorSource).not.toMatch(/<\/Button>\s+className=/)
    expect(editorSource).toContain('data-testid="map-toolbar-more"')
    expect(editorSource).toMatch(
      /onClick=\{handlePromoteTrace\}[\s\S]*?entityView\.mapPromoteTrace/,
    )
  })

  test('round-trips expanded kinds through the workflow document adapter', () => {
    const node = createSessionDraftNode({
      id: 'draft_subflow_1',
      kind: 'subflow',
      position: { x: 8, y: 9 },
      now: 1,
    })
    const graph = parseSessionDraftGraph(
      serializeSessionDraftGraph('s1', { nodes: [node], edges: [] }),
      's1',
    )
    expect(graph.nodes[0]?.kind).toBe('subflow')
    const spec = draftGraphToSpec(graph, 2)
    expect(spec.nodes[0]?.kind).toBe('subflow')
    expect(specToDraftGraph(spec).nodes[0]?.kind).toBe('subflow')
  })

  test('empty map hides layout and document actions in both menus', () => {
    expect(isSessionMapEmpty({ scenes: [], draftNodes: [] })).toBe(true)
    expect(isSessionMapEmpty({ scenes: undefined, draftNodes: null })).toBe(true)
    expect(isSessionMapEmpty({ scenes: [{}], draftNodes: [] })).toBe(false)
    expect(isSessionMapEmpty({ scenes: [], draftNodes: [{}] })).toBe(false)

    expect(editorSource).toContain('const mapEmpty = isSessionMapEmpty(')
    // Toolbar ⋯ menu: a single disabled hint row replaces every action when empty.
    expect(editorSource).toMatch(
      /\{mapEmpty \? \(\s*<DropdownMenuItem disabled data-testid="map-toolbar-empty-hint">\s*\{t\('entityView\.mapEmptyHint'\)\}[\s\S]*?applyCanvasLayout\('left'\)[\s\S]*?applyCanvasLayout\('tile'\)[\s\S]*?onClick=\{handleSaveVersion\}[\s\S]*?handleRun\('pipeline'\)/,
    )
    // Canvas context menu: promote trace + save version sit behind the guard.
    expect(editorSource).toMatch(
      /\{mapEmpty \? null : \(\s*<>\s*<StyledContextMenuItem onSelect=\{handlePromoteTrace\}>[\s\S]*?<StyledContextMenuItem onSelect=\{handleSaveVersion\}>/,
    )
  })
})
