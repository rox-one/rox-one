/**
 * Zen Shell first-paint reducer (ZS-01).
 *
 * Show the window once. Apply glass only after a healthy paint (`ready-to-show`).
 * `did-finish-load` and the 4000 ms timeout are not paint — they may show the
 * opaque window but must not set vibrancy/mica. GPU failure bumps generation
 * so a late policy change cannot re-glass a crashed surface.
 */

export type ZenWindowEvent =
  | { type: 'did-finish-load' }
  | { type: 'timeout' }
  | { type: 'ready-to-show' }
  | { type: 'gpu-crash' }
  | { type: 'policy-change' }

export interface ZenWindowState {
  shown: boolean
  generation: number
  paintGeneration: number | null
  applyMaterial: boolean
  clearMaterial: boolean
}

export function initialZenWindowState(): ZenWindowState {
  return {
    shown: false,
    generation: 0,
    paintGeneration: null,
    applyMaterial: false,
    clearMaterial: false,
  }
}

export function reduceZenWindow(state: ZenWindowState, event: ZenWindowEvent): ZenWindowState {
  switch (event.type) {
    case 'did-finish-load':
    case 'timeout':
      // Show once, no glass. Late paint may still apply material afterwards.
      return {
        ...state,
        shown: true,
        applyMaterial: false,
        clearMaterial: false,
      }
    case 'ready-to-show':
      return {
        ...state,
        shown: true,
        paintGeneration: state.generation,
        applyMaterial: true,
        clearMaterial: false,
      }
    case 'gpu-crash':
      return {
        ...state,
        generation: state.generation + 1,
        paintGeneration: null,
        applyMaterial: false,
        clearMaterial: true,
      }
    case 'policy-change':
      if (state.paintGeneration === state.generation) {
        return { ...state, applyMaterial: true, clearMaterial: false }
      }
      return { ...state, applyMaterial: false, clearMaterial: false }
    default: {
      const _never: never = event
      return _never
    }
  }
}
