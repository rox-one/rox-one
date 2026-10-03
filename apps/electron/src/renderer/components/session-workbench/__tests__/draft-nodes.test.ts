import { describe, expect, test } from 'bun:test'
import {
  canPersistDraftEdge,
  createSessionDraftEdge,
  createSessionDraftNode,
  parseSessionDraftGraph,
  parseSessionDraftNodes,
  serializeSessionDraftGraph,
  serializeSessionDraftNodes,
  sessionDraftNodesStorageKey,
  STICKY_COLORS,
} from '../draft-nodes'

describe('session draft nodes', () => {
  test('legacy note-shaped frames retain layout as non-executable annotations', () => {
    const frame = createSessionDraftNode({ id: 'frame', kind: 'note', role: 'frame', title: 'Review', position: { x: 80, y: 120 }, now: 1 })
    const tool = createSessionDraftNode({ id: 'tool', kind: 'tool', position: { x: 90, y: 130 }, now: 2 })
    const graph = parseSessionDraftGraph(serializeSessionDraftGraph('s1', {
      nodes: [frame, tool], edges: [createSessionDraftEdge({ source: frame.id, target: tool.id })],
    }), 's1')
    expect(graph.nodes[0]).toMatchObject({ kind: 'annotation_frame', role: 'frame', position: { x: 80, y: 120 }, title: 'Review' })
    expect(graph.edges).toEqual([])
    expect(canPersistDraftEdge({ source: frame.id, target: tool.id }, [frame, tool], [])).toBe(false)
  })
  test('new stickers use varied translucent colors and preserve the chosen color on reload', () => {
    const stickers = STICKY_COLORS.map(() => createSessionDraftNode({ kind: 'note', role: 'sticky', position: { x: 0, y: 0 }, now: 1 }))
    expect(new Set(stickers.map((node) => node.color)).size).toBe(STICKY_COLORS.length)
    expect(parseSessionDraftNodes(serializeSessionDraftNodes('s1', stickers), 's1')).toEqual(stickers)
    expect(createSessionDraftNode({ kind: 'note', role: 'sticky', color: 'rose', position: { x: 0, y: 0 } }).color).toBe('rose')
  })
  test('serializes local draft nodes separately from scene layout pins', () => {
    const node = createSessionDraftNode({
      id: 'draft_note_1',
      kind: 'note',
      position: { x: 120, y: 80 },
      anchorSceneId: 'scn_u1',
      now: 123,
    })

    const raw = serializeSessionDraftNodes('s1', [node])

    expect(sessionDraftNodesStorageKey('s1')).toBe('rox.sessionMap.drafts.s1')
    expect(parseSessionDraftNodes(raw, 's1')).toEqual([node])
    expect(parseSessionDraftNodes(raw, 's2')).toEqual([])
  })

  test('persists draft edges only when both endpoints are draft nodes', () => {
    const source = createSessionDraftNode({
      id: 'draft_note_1',
      kind: 'note',
      position: { x: 120, y: 80 },
      anchorSceneId: 'scn_u1',
      now: 122,
    })
    const target = createSessionDraftNode({
      id: 'draft_model_1',
      kind: 'model',
      position: { x: 240, y: 160 },
      anchorSceneId: 'scn_u1',
      now: 123,
    })
    const edge = createSessionDraftEdge({ source: source.id, target: target.id, now: 124 })

    const raw = serializeSessionDraftGraph('s1', {
      nodes: [source, target],
      edges: [
        edge,
        { id: 'draft_edge_scene', source: 'scn_u1', target: target.id, createdAt: 125 },
        { id: 'draft_edge_ghost', source: 'ghost', target: target.id, createdAt: 126 },
      ],
    })

    expect(parseSessionDraftGraph(raw, 's1').edges).toEqual([edge])
  })

  test('rejects draft edge cycles before persistence', () => {
    const a = createSessionDraftNode({ id: 'draft_a', kind: 'note', position: { x: 0, y: 0 }, now: 1 })
    const b = createSessionDraftNode({ id: 'draft_b', kind: 'model', position: { x: 1, y: 1 }, now: 2 })
    const c = createSessionDraftNode({ id: 'draft_c', kind: 'tool', position: { x: 2, y: 2 }, now: 3 })
    const edges = [
      createSessionDraftEdge({ source: a.id, target: b.id, now: 4 }),
      createSessionDraftEdge({ source: b.id, target: c.id, now: 5 }),
    ]

    expect(canPersistDraftEdge(createSessionDraftEdge({ source: c.id, target: a.id, now: 6 }), [a, b, c], edges)).toBe(false)
    expect(canPersistDraftEdge(createSessionDraftEdge({ source: a.id, target: c.id, now: 7 }), [a, b, c], edges)).toBe(true)
  })

  test('generates unique draft ids within the same millisecond', () => {
    const first = createSessionDraftNode({ kind: 'tool', position: { x: 0, y: 0 }, now: 123 })
    const second = createSessionDraftNode({ kind: 'tool', position: { x: 0, y: 0 }, now: 123 })

    expect(first.id).not.toBe(second.id)
  })

  test('drops malformed draft node snapshots', () => {
    expect(parseSessionDraftNodes(null, 's1')).toEqual([])
    expect(parseSessionDraftNodes('not-json', 's1')).toEqual([])
    expect(
      parseSessionDraftNodes(
        JSON.stringify({
          v: 1,
          sessionId: 's1',
          nodes: [{ id: 'draft_bad', kind: 'unsafe', title: 'x', position: { x: 1, y: 2 }, createdAt: 1 }],
        }),
        's1',
      ),
    ).toEqual([])
  })
})
