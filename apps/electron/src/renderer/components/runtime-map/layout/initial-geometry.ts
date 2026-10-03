import { Position, type NodeBase } from '@xyflow/system'
import { CARD_WIDTH } from './stable-layout'

type InitialGeometry = Pick<NodeBase, 'initialWidth' | 'initialHeight' | 'handles'>

function cardGeometry(height: number): InitialGeometry {
  return { initialWidth: CARD_WIDTH, initialHeight: height, handles: [
    { type: 'target', position: Position.Left, x: -2.5, y: height / 2 - 2.5, width: 5, height: 5 },
    { type: 'source', position: Position.Right, x: CARD_WIDTH - 2.5, y: height / 2 - 2.5, width: 5, height: 5 },
  ] }
}
const normalCard = cardGeometry(128)
const compactCard = cardGeometry(50)

/** Geometry hints only: visible DOM measurements replace them; no runtime metric uses them. */
export function initialRuntimeCardGeometry(compact: boolean): InitialGeometry { return compact ? compactCard : normalCard }
export const initialRuntimeLaneGeometry: InitialGeometry = { initialWidth: 250, initialHeight: 80, handles: [] }
