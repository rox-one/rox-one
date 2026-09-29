import {
  pruneSessionMapPin,
  type SessionMapCamera,
  type SessionMapPin,
  type SessionScene,
  type SessionSceneGraph,
} from '@craft-agent/core/mindmap'
import { deriveSessionNodeKind, type SessionNodeKind } from './node-kinds'
import { DEFAULT_SCENE_SIZE, type NodeSize } from './map-node-size'

export type SceneNodeData = {
  scene: SessionScene
  kind: SessionNodeKind
  kindLabel?: string
  /** Persist a NodeResizer result (position may shift when resizing from the left/top). */
  onResize?: (id: string, box: { x: number; y: number } & NodeSize) => void
}

export type FlowSceneNode = {
  id: string
  type: 'scene'
  position: { x: number; y: number }
  /** Default width, or the user-resized width from the pin. */
  width: number
  /** Only set after the user resized the node; otherwise content height. */
  height?: number
  data: SceneNodeData
}

export type FlowSceneEdge = {
  id: string
  source: string
  target: string
  data: { kind: 'continue' | 'fork' }
}

export function autoScenePosition(
  depth: number,
  lane: number,
  camera: SessionMapCamera,
): { x: number; y: number } {
  const xStep = camera === 'flow' ? 300 : 250
  const yStep = camera === 'flow' ? 140 : 108
  return { x: 24 + depth * xStep, y: 24 + lane * yStep }
}

function depthsOf(scenes: SessionScene[]): Map<string, number> {
  const byId = new Map(scenes.map((s) => [s.id, s]))
  const memo = new Map<string, number>()
  const walk = (id: string, stack = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!
    if (stack.has(id)) {
      memo.set(id, 0)
      return 0
    }
    const scene = byId.get(id)
    if (!scene?.parentSceneId) {
      memo.set(id, 0)
      return 0
    }
    stack.add(id)
    const d = walk(scene.parentSceneId, stack) + 1
    stack.delete(id)
    memo.set(id, d)
    return d
  }
  for (const s of scenes) walk(s.id)
  return memo
}

export function toFlowElements(
  graph: SessionSceneGraph,
  pin: SessionMapPin | null,
  camera: SessionMapCamera,
): { nodes: FlowSceneNode[]; edges: FlowSceneEdge[] } {
  const known = new Set(graph.scenes.map((s) => s.id))
  const layout = pin ? pruneSessionMapPin(pin, known) : null
  const depths = depthsOf(graph.scenes)
  const lane = new Map<number, number>()
  const nodes: FlowSceneNode[] = []
  for (const scene of graph.scenes) {
    const d = depths.get(scene.id) ?? 0
    const row = lane.get(d) ?? 0
    lane.set(d, row + 1)
    const pinned = layout?.nodes[scene.id]
    nodes.push({
      id: scene.id,
      type: 'scene',
      position: pinned ? { x: pinned.x, y: pinned.y } : autoScenePosition(d, row, camera),
      width: pinned?.width ?? DEFAULT_SCENE_SIZE.width,
      ...(pinned?.height ? { height: pinned.height } : {}),
      data: { scene, kind: deriveSessionNodeKind(scene) },
    })
  }
  const edges: FlowSceneEdge[] = graph.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    data: { kind: e.kind },
  }))
  return { nodes, edges }
}
