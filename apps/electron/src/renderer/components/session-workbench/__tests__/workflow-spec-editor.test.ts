import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSessionDraftNode, serializeSessionDraftGraph, parseSessionDraftGraph } from '../draft-nodes'
import { draftGraphToSpec, specToDraftGraph } from '../workflow-document'
import { isSessionMapEmpty } from '../map-empty-actions'
import { createCanvasEdge, createCanvasNode, createDraftSpec, exportSpec, importSpec } from '@craft-agent/shared/workflows'

const editorSource = readFileSync(join(__dirname, '..', 'SessionWorkflowEditor.tsx'), 'utf8')

describe('workflow spec editor wiring', () => {
  test('valid named-port imports render default handles and retain canonical ports on export', () => {
    const spec = createDraftSpec('s1', 1)
    spec.nodes = [
      createCanvasNode({ id: 'note', kind: 'note', title: 'Input', position: { x: 0, y: 0 }, now: 1 }),
      createCanvasNode({ id: 'out', kind: 'output', title: 'Result', position: { x: 200, y: 0 }, now: 2 }),
    ]
    spec.edges = [createCanvasEdge({ source: 'note', target: 'out', sourcePort: 'note:text', targetPort: 'out:value', now: 3 })]
    const graph = specToDraftGraph(importSpec(exportSpec(spec), 's1'))
    expect(graph.edges[0]?.sourceHandle).toBeUndefined()
    expect(graph.edges[0]?.targetHandle).toBeUndefined()
    expect(draftGraphToSpec(graph).edges[0]).toMatchObject({ sourcePort: 'note:text', targetPort: 'out:value' })
    expect(parseSessionDraftGraph(serializeSessionDraftGraph('s1', graph), 's1').edges[0]).toMatchObject({ sourcePort: 'note:text', targetPort: 'out:value' })
  })

  test('short condition port names normalize to named canvas handles on import', () => {
    const spec = createDraftSpec('s1', 1)
    spec.nodes = [
      createCanvasNode({ id: 'decision', kind: 'condition', title: 'Check', position: { x: 0, y: 0 }, provenance: { sessionId: 's1', sceneId: 'scn_1', messageIds: [] }, now: 1 }),
      createCanvasNode({ id: 'out', kind: 'output', title: 'Result', position: { x: 200, y: 0 }, now: 2 }),
    ]
    spec.edges = [createCanvasEdge({ source: 'decision', target: 'out', sourcePort: 'false', targetPort: 'value', now: 3 })]
    const graph = specToDraftGraph(importSpec(exportSpec(spec), 's1'))
    expect(graph.edges[0]).toMatchObject({ sourceHandle: 'decision:false', sourcePort: 'false', targetPort: 'value' })
    expect(draftGraphToSpec(graph).edges[0]).toMatchObject({ sourcePort: 'false', targetPort: 'value' })
  })
  test('import/export preserves sticker color, frame role and user-resized boxes', () => {
    const sticky = createSessionDraftNode({ id: 'sticky', kind: 'note', role: 'sticky', color: 'blue', title: 'Context', position: { x: 1, y: 2 }, now: 1 })
    sticky.size = { width: 280, height: 200 }
    const frame = createSessionDraftNode({ id: 'frame', kind: 'annotation_frame', role: 'frame', title: 'Review', position: { x: 0, y: 0 }, now: 2 })
    const graph = { v: 1 as const, sessionId: 's1', nodes: [sticky, frame], edges: [] }
    expect(specToDraftGraph(JSON.parse(JSON.stringify(draftGraphToSpec(graph)))).nodes).toEqual([sticky, frame])
    expect(draftGraphToSpec(graph).nodes[1]?.inputs).toEqual([])
    expect(draftGraphToSpec(graph).nodes[1]?.outputs).toEqual([])
  })
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
    // The whole-canvas context menu is gone; document actions live in the ⋯ menu.
    expect(editorSource).not.toContain('StyledContextMenuItem')
    expect(editorSource).toMatch(/onClick=\{handleExport\}[\s\S]*?onClick=\{handleForkVersion\}[\s\S]*?onClick=\{handleCompareVersions\}/)
  })
})
