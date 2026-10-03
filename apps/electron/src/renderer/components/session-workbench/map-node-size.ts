/**
 * Node sizes on the session map: defaults, measured boxes for layout
 * helpers, and persistence of user resizes (scene pins + draft graph).
 */
import type { SessionMapPin } from '@rox/core/mindmap'
import type { SessionDraftNode } from './draft-nodes'
import type { CanvasBox } from './canvas-layout'

export type NodeSize = { width: number; height: number }

export const DEFAULT_SCENE_SIZE: NodeSize = { width: 220, height: 96 }
export const MIN_SCENE_SIZE: NodeSize = { width: 160, height: 64 }
export const MIN_DRAFT_SIZE: NodeSize = { width: 160, height: 96 }

export function defaultDraftSize(role: SessionDraftNode['role']): NodeSize {
  switch (role) {
    case 'sticky':
      return { width: 180, height: 120 }
    case 'frame':
      return { width: 440, height: 280 }
    case 'group':
      return { width: 260, height: 160 }
    default:
      return { width: 224, height: 120 }
  }
}

export function draftMinimumSize(role: SessionDraftNode['role']): NodeSize {
  return role === 'frame' || role === 'group' ? { width: 240, height: 160 } : MIN_DRAFT_SIZE
}

type SizedNode = {
  id: string
  position: { x: number; y: number }
  width?: number | null
  height?: number | null
  measured?: { width?: number; height?: number }
}

/** Layout box for align/distribute/tile/keyboard-connect: measured, then set, then default. */
export function nodeBox(node: SizedNode, fallback: NodeSize = DEFAULT_SCENE_SIZE): CanvasBox {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? fallback.width,
    height: node.measured?.height ?? node.height ?? fallback.height,
  }
}

function cleanSize(size: NodeSize, min: NodeSize): NodeSize {
  return {
    width: Math.max(min.width, Math.round(size.width)),
    height: Math.max(min.height, Math.round(size.height)),
  }
}

/** Store a scene resize (and the position NodeResizer may have moved) in the pin. */
export function pinWithSceneSize(
  pin: SessionMapPin | null,
  base: Pick<SessionMapPin, 'sessionId' | 'camera' | 'viewport'>,
  id: string,
  box: { x: number; y: number } & NodeSize,
): SessionMapPin {
  const size = cleanSize(box, MIN_SCENE_SIZE)
  return {
    v: 1,
    sessionId: base.sessionId,
    camera: base.camera,
    ...(base.viewport ? { viewport: base.viewport } : {}),
    nodes: {
      ...(pin?.nodes ?? {}),
      [id]: { x: box.x, y: box.y, width: size.width, height: size.height },
    },
  }
}

/** Store a draft/note resize in the draft graph nodes. */
export function draftNodesWithSize(
  nodes: readonly SessionDraftNode[],
  id: string,
  box: { x: number; y: number } & NodeSize,
): SessionDraftNode[] {
  return nodes.map((node) =>
    node.id === id ? { ...node, position: { x: box.x, y: box.y }, size: cleanSize(box, draftMinimumSize(node.role)) } : node,
  )
}
