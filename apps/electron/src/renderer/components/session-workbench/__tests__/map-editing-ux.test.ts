import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSessionMapPin, serializeSessionMapPin } from '@craft-agent/core/mindmap'
import {
  classifyMapConnection,
  connectionRejectMessageKey,
  contextNotesForScene,
  withContextNotes,
} from '../map-connection-rules'
import {
  DEFAULT_SCENE_SIZE,
  MIN_SCENE_SIZE,
  defaultDraftSize,
  draftNodesWithSize,
  nodeBox,
  pinWithSceneSize,
} from '../map-node-size'
import { formatToolGroup, groupSceneTools, shortSceneTitle } from '../scene-tools'
import {
  createSessionDraftEdge,
  createSessionDraftNode,
  parseSessionDraftGraph,
  serializeSessionDraftGraph,
} from '../draft-nodes'
import { draftGraphToSpec } from '../workflow-document'

const dir = join(__dirname, '..')
const editor = readFileSync(join(dir, 'SessionWorkflowEditor.tsx'), 'utf8')
const sceneNode = readFileSync(join(dir, 'SceneNode.tsx'), 'utf8')

const noteA = createSessionDraftNode({ id: 'draft_a', kind: 'note', position: { x: 0, y: 0 }, now: 1 })
const noteB = createSessionDraftNode({ id: 'draft_b', kind: 'model', position: { x: 10, y: 0 }, now: 2 })
const sceneIds = new Set(['scn_1', 'scn_2'])

describe('map connection validation', () => {
  test('draft → draft is a step edge; cycles and duplicates are refused', () => {
    const ctx = { draftNodes: [noteA, noteB], draftEdges: [], sceneIds }
    expect(classifyMapConnection({ source: 'draft_a', target: 'draft_b' }, ctx)).toEqual({
      ok: true,
      kind: 'step',
      source: 'draft_a',
      target: 'draft_b',
    })
    const withEdge = { ...ctx, draftEdges: [createSessionDraftEdge({ source: 'draft_a', target: 'draft_b' })] }
    expect(classifyMapConnection({ source: 'draft_a', target: 'draft_b' }, withEdge)).toEqual({ ok: false, reason: 'duplicate' })
    expect(classifyMapConnection({ source: 'draft_b', target: 'draft_a' }, withEdge)).toEqual({ ok: false, reason: 'cycle' })
  })

  test('scene ↔ draft is a context edge in either drag direction, normalized to scene → draft', () => {
    const ctx = { draftNodes: [noteA], draftEdges: [], sceneIds }
    expect(classifyMapConnection({ source: 'draft_a', target: 'scn_1' }, ctx)).toEqual({
      ok: true,
      kind: 'context',
      source: 'scn_1',
      target: 'draft_a',
    })
    const withCtx = { ...ctx, draftEdges: [createSessionDraftEdge({ source: 'scn_1', target: 'draft_a', kind: 'context' })] }
    expect(classifyMapConnection({ source: 'draft_a', target: 'scn_1' }, withCtx)).toEqual({ ok: false, reason: 'duplicate' })
    // A context edge never counts toward step cycles.
    expect(classifyMapConnection({ source: 'draft_a', target: 'scn_2' }, withCtx).ok).toBe(true)
  })

  test('scene → scene, self and branch links are refused with a specific message', () => {
    const ctx = { draftNodes: [noteA], draftEdges: [], sceneIds }
    const sceneScene = classifyMapConnection({ source: 'scn_1', target: 'scn_2' }, ctx)
    expect(sceneScene).toEqual({ ok: false, reason: 'scene-scene' })
    expect(connectionRejectMessageKey('scene-scene')).toBe('entityView.mapConnectSceneScene')
    expect(classifyMapConnection({ source: 'draft_a', target: 'draft_a' }, ctx)).toEqual({ ok: false, reason: 'self' })
    expect(classifyMapConnection({ source: 'draft_a', target: 'br_x' }, ctx)).toEqual({ ok: false, reason: 'branch' })
  })

  test('context notes are collected for a scene and appended to the rewrite prompt', () => {
    const graph = {
      nodes: [{ ...noteA, title: 'Use metric units' }, { ...noteB, title: '' }],
      edges: [
        createSessionDraftEdge({ source: 'scn_1', target: 'draft_a', kind: 'context', now: 5 }),
        createSessionDraftEdge({ source: 'scn_1', target: 'draft_b', kind: 'context', now: 6 }),
        createSessionDraftEdge({ source: 'draft_a', target: 'draft_b', now: 7 }),
      ],
    }
    expect(contextNotesForScene('scn_1', graph)).toEqual(['Use metric units'])
    expect(withContextNotes('Rewrite it', ['Use metric units'], 'Context:')).toBe('Rewrite it\n\n---\nContext:\n- Use metric units')
    expect(withContextNotes('Rewrite it', [], 'Context:')).toBe('Rewrite it')
  })

  test('context edges survive the draft graph round-trip but are not workflow steps', () => {
    const graph = {
      nodes: [noteA, noteB],
      edges: [
        createSessionDraftEdge({ source: 'scn_1', target: 'draft_a', kind: 'context', now: 3 }),
        createSessionDraftEdge({ source: 'draft_a', target: 'draft_b', now: 4 }),
      ],
    }
    const parsed = parseSessionDraftGraph(serializeSessionDraftGraph('s1', graph), 's1')
    expect(parsed.edges.map((edge) => edge.kind ?? 'step')).toEqual(['context', 'step'])
    expect(draftGraphToSpec(parsed).edges).toHaveLength(1)
  })

  test('editor uses loose connection mode with hover validation and no drop-to-fork', () => {
    expect(editor).toContain('connectionMode={ConnectionMode.Loose}')
    expect(editor).toContain('isValidConnection={isValidConnection}')
    expect(editor).toContain('connectionLineComponent={MapConnectionLine}')
    expect(editor).not.toContain('onConnectEnd')
    expect(editor).not.toContain("t('entityView.workbenchForkHint')")
  })
})

describe('node resize persistence', () => {
  test('scene resize is saved in the pin with position and clamped size', () => {
    const pin = pinWithSceneSize(null, { sessionId: 's1', camera: 'map' }, 'scn_1', { x: 5, y: 6, width: 90.4, height: 300.6 })
    expect(pin.nodes.scn_1).toEqual({ x: 5, y: 6, width: MIN_SCENE_SIZE.width, height: 301 })
    const reparsed = parseSessionMapPin(serializeSessionMapPin(pin), 's1')
    expect(reparsed?.nodes.scn_1).toEqual({ x: 5, y: 6, width: MIN_SCENE_SIZE.width, height: 301 })
  })

  test('draft resize is saved on the node and survives parse', () => {
    const nodes = draftNodesWithSize([noteA, noteB], 'draft_a', { x: 1, y: 2, width: 320, height: 200 })
    expect(nodes[0]).toMatchObject({ position: { x: 1, y: 2 }, size: { width: 320, height: 200 } })
    expect(nodes[1]?.size).toBeUndefined()
    const parsed = parseSessionDraftGraph(serializeSessionDraftGraph('s1', { nodes, edges: [] }), 's1')
    expect(parsed.nodes[0]?.size).toEqual({ width: 320, height: 200 })
  })

  test('layout boxes use measured, then set, then default sizes (no 198×88)', () => {
    expect(nodeBox({ id: 'a', position: { x: 0, y: 0 }, measured: { width: 300, height: 120 } })).toMatchObject({ width: 300, height: 120 })
    expect(nodeBox({ id: 'a', position: { x: 0, y: 0 }, width: 250 })).toMatchObject({ width: 250, height: DEFAULT_SCENE_SIZE.height })
    expect(nodeBox({ id: 'a', position: { x: 0, y: 0 } }, defaultDraftSize('sticky'))).toMatchObject({ width: 180, height: 120 })
    expect(editor).not.toContain('width: 198')
    expect(sceneNode).not.toContain('w-[198px]')
    expect(editor).not.toContain('w-[224px]')
  })

  test('scene and draft nodes render a NodeResizer when selected', () => {
    expect(sceneNode).toContain('<NodeResizer')
    expect(sceneNode).toContain('isVisible={Boolean(selected)}')
    expect(editor).toContain('<NodeResizer')
  })
})

describe('scene node visuals', () => {
  test('repeated tools collapse into «name ×N» chips', () => {
    const groups = groupSceneTools([
      { toolCallId: '1', name: 'read', status: 'ok' },
      { toolCallId: '2', name: 'read', status: 'ok' },
      { toolCallId: '3', name: 'bash', status: 'ok' },
      { toolCallId: '4', name: 'read', status: 'error' },
      { toolCallId: '5', name: 'read', status: 'ok' },
    ] as never)
    expect(groups.map(formatToolGroup)).toEqual(['read ×4', 'bash'])
    expect(groups[0]?.status).toBe('error')
  })

  test('anchor chips show a short scene title, never the raw scn_ id', () => {
    expect(shortSceneTitle({ triggerPreview: 'Составь утренний план дня с приоритетами и встречами' })).toBe('Составь утренний план дня с…')
    expect(shortSceneTitle(null)).toBeNull()
    expect(editor).not.toContain('{data.draft.anchorSceneId}')
    expect(editor).toContain('anchorLabel: shortSceneTitle(anchor)')
  })

  test('no monospace chips; 2-line title with the kind chip on its own row', () => {
    expect(sceneNode).not.toContain('font-mono')
    expect(editor).not.toContain('font-mono')
    expect(sceneNode).toContain('line-clamp-2 min-w-0 break-words text-[12px]')
    expect(sceneNode).toContain('ring-2 ring-accent')
  })
})

describe('map menus and inspector', () => {
  test('one docked inspector, node-only context menu and a canvas «+» picker', () => {
    expect(editor).toContain('data-testid="session-canvas-inspector"')
    expect(editor).toContain('<aside')
    expect(editor).not.toContain('ContextMenuTrigger')
    expect(editor).toContain('data-testid="map-add-node"')
    expect(editor).toContain('data-testid="map-node-picker"')
    expect(editor).toContain('openPicker(event.clientX, event.clientY)')
    expect(editor).toContain("t('entityView.workbenchRewriteBranch')")
    // «Рассылка» only from the inspector.
    expect(editor.match(/setFanOutOpen\(true\)/g)).toHaveLength(1)
  })
})
