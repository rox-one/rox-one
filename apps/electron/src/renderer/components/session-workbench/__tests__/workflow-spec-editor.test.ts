import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSessionDraftNode, serializeSessionDraftGraph, parseSessionDraftGraph } from '../draft-nodes'
import { draftGraphToSpec, specToDraftGraph } from '../workflow-document'

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
    expect(editorSource).toMatch(
      /<Button\b[\s\S]*?onClick=\{handlePromoteTrace\}[\s\S]*?entityView\.mapPromoteTrace/,
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
})
