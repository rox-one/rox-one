import { atomWithStorage } from 'jotai/utils'
import { KEYS, getKeyString } from '@/lib/local-storage'

/** Right inspector edge-reveal: hidden until hover, hover peek, or pinned open. */
export type InspectorEdgeRevealMode = 'hidden' | 'hover' | 'pinned'

export const inspectorEdgeRevealModeAtom = atomWithStorage<InspectorEdgeRevealMode>(
  getKeyString(KEYS.seInspectorEdgeRevealMode),
  'hidden',
  undefined,
  { getOnInit: true },
)

export const inspectorEdgeHoverActiveAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.seInspectorEdgeHoverActive),
  false,
  undefined,
  { getOnInit: true },
)

export type InspectorEdgeRevealInput = {
  mode: InspectorEdgeRevealMode
  hoverActive: boolean
  userOpened: boolean
  visible: boolean
}

export type InspectorEdgeRevealResolved = {
  effectiveVisible: boolean
  peeking: boolean
}

/** Pure edge-reveal merge used by layout + tests (no DOM). */
export function resolveInspectorEdgeReveal(input: InspectorEdgeRevealInput): InspectorEdgeRevealResolved {
  if (input.mode === 'pinned') {
    return { effectiveVisible: true, peeking: false }
  }
  if (input.mode === 'hover' && input.hoverActive) {
    return { effectiveVisible: true, peeking: true }
  }
  if (input.visible && input.userOpened) {
    return { effectiveVisible: true, peeking: false }
  }
  return { effectiveVisible: false, peeking: false }
}
