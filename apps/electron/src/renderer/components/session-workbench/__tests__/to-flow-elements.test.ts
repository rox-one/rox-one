import { describe, expect, test } from 'bun:test'
import {
  parseSessionMapPin,
  projectSessionScenes,
  pruneSessionMapPin,
  serializeSessionMapPin,
  sessionMapPinStorageKey,
  type SessionMapPin,
} from '@craft-agent/core/mindmap'
import { autoScenePosition, toFlowElements } from '../to-flow-elements'

const oneSceneGraph = () =>
  projectSessionScenes('s1', [
    { id: 'u1', type: 'user', content: 'one' },
    { id: 'a1', type: 'assistant', content: 'ok' },
  ])

const continueGraph = () =>
  projectSessionScenes('s1', [
    { id: 'u1', type: 'user', content: 'one' },
    { id: 'u2', type: 'user', content: 'two' },
  ])

describe('toFlowElements', () => {
  test('one scene + continue edge → one node + one edge', () => {
    const graph = continueGraph()
    expect(graph.scenes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.kind).toBe('continue')

    const { nodes, edges } = toFlowElements(graph, null, 'map')
    const first = graph.scenes[0]!
    const node = nodes.find((n) => n.id === first.id)!
    expect(node.id).toBe(first.id)
    expect(node.id).toBe('scn_u1')
    expect(node.data.scene.triggerMessageId).toBe('u1')

    const edge = edges[0]!
    expect(edges).toHaveLength(1)
    expect(edge.id).toBe(`${edge.source}->${edge.target}`)
    expect(edge.id).toBe(`${graph.edges[0]!.from}->${graph.edges[0]!.to}`)
    expect(edge.data.kind).toBe('continue')
  })

  test('user + assistant projects one scene scn_u1', () => {
    const graph = oneSceneGraph()
    expect(graph.scenes).toHaveLength(1)
    expect(graph.scenes[0]!.id).toBe('scn_u1')
    const { nodes, edges } = toFlowElements(graph, null, 'map')
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    expect(nodes[0]!.id).toBe('scn_u1')
    expect(nodes[0]!.data.scene.triggerMessageId).toBe('u1')
  })

  test('camera map vs flow keeps the same node ids', () => {
    const graph = continueGraph()
    const map = toFlowElements(graph, null, 'map')
    const flow = toFlowElements(graph, null, 'flow')
    expect(map.nodes.map((n) => n.id)).toEqual(flow.nodes.map((n) => n.id))
    expect(map.edges.map((e) => e.id)).toEqual(flow.edges.map((e) => e.id))
    expect(map.nodes[0]!.position).toEqual(autoScenePosition(0, 0, 'map'))
    expect(flow.nodes[0]!.position).toEqual(autoScenePosition(0, 0, 'flow'))
  })

  test('pin.nodes[scene.id] overrides auto position', () => {
    const graph = oneSceneGraph()
    const sceneId = graph.scenes[0]!.id
    const pin: SessionMapPin = {
      v: 1,
      sessionId: 's1',
      camera: 'map',
      nodes: { [sceneId]: { x: 99, y: 77 } },
    }
    const { nodes } = toFlowElements(graph, pin, 'map')
    expect(nodes[0]!.position).toEqual({ x: 99, y: 77 })
  })

  test('unknown pin ids are ignored', () => {
    const graph = oneSceneGraph()
    const pin: SessionMapPin = {
      v: 1,
      sessionId: 's1',
      camera: 'map',
      nodes: { scn_ghost: { x: 1, y: 2 } },
    }
    const { nodes } = toFlowElements(graph, pin, 'map')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.id).toBe('scn_u1')
    expect(nodes[0]!.position).toEqual(autoScenePosition(0, 0, 'map'))
  })

  test('core pin helpers are used, not duplicated', () => {
    expect(sessionMapPinStorageKey('s1')).toBe('rox.sessionMap.layout.s1')
    const pin: SessionMapPin = {
      v: 1,
      sessionId: 's1',
      camera: 'map',
      nodes: { scn_u1: { x: 1, y: 2 }, ghost: { x: 0, y: 0 } },
    }
    expect(parseSessionMapPin(serializeSessionMapPin(pin), 's1')).toEqual(pin)
    expect(pruneSessionMapPin(pin, new Set(['scn_u1'])).nodes).toEqual({
      scn_u1: { x: 1, y: 2 },
    })
  })
})
