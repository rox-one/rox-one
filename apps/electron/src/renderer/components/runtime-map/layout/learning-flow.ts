/**
 * Canvas projection of the PRD §30 learning overlay.
 *
 * Separated from `RuntimeCanvas` so the canvas's real learning node set (ids,
 * geometry, aria labels) is derivable without a DOM: React Flow measures in
 * effects, so nothing about the mounted canvas is observable in a render test.
 */
import type { TFunction } from 'i18next'
import type { RuntimeLayout } from './stable-layout'
import { CARD_WIDTH, COLUMN_WIDTH, LANE_HEIGHT } from './stable-layout'
import type { LearningMapNode } from '../learning-nodes'
import type { LearningFlowNode } from '../nodes/LearningNodeCard'
import { initialRuntimeCardGeometry } from './initial-geometry'
import { nodeAriaLabel } from '../nodes/node-content'

/** Learning chains belong to no lane, so they render in a row below every lane. */
export function learningRowY(layout: RuntimeLayout): number {
  let bottom = 44
  for (const position of layout.positions.values()) bottom = Math.max(bottom, position.y)
  for (const position of layout.lanes.values()) bottom = Math.max(bottom, position.y)
  return bottom + LANE_HEIGHT + 32
}

/**
 * One flow node per chain step. Learning nodes are neither selectable (no runtime
 * inspector) nor draggable, and their aria label falls back to the registry name
 * because the five learning kinds have no `runtimeMap.kind.*` locale entry.
 */
export function learningFlowNode(node: LearningMapNode, index: number, t: TFunction, compact: boolean, rowY: number, cached?: LearningFlowNode): LearningFlowNode {
  return {
    id: node.id,
    type: 'learning',
    position: { x: index * COLUMN_WIDTH, y: rowY },
    data: { learning: node },
    draggable: false,
    selectable: false,
    focusable: false,
    selected: false,
    style: { width: CARD_WIDTH },
    ...initialRuntimeCardGeometry(compact),
    ariaLabel: cached?.data.learning === node ? cached.ariaLabel : nodeAriaLabel({ kind: node.kind, seq: index }, t),
  }
}