import { describe, expect, it } from 'bun:test'
import { resolveInspectorEdgeReveal } from '../panel-auto-hide'

describe('resolveInspectorEdgeReveal', () => {
  it('pins panel open', () => {
    expect(resolveInspectorEdgeReveal({
      mode: 'pinned',
      hoverActive: false,
      userOpened: false,
      visible: false,
    })).toEqual({ effectiveVisible: true, peeking: false })
  })

  it('peeks on hover mode with active hover', () => {
    expect(resolveInspectorEdgeReveal({
      mode: 'hover',
      hoverActive: true,
      userOpened: false,
      visible: false,
    })).toEqual({ effectiveVisible: true, peeking: true })
  })

  it('hides when hidden and not user opened', () => {
    expect(resolveInspectorEdgeReveal({
      mode: 'hidden',
      hoverActive: false,
      userOpened: false,
      visible: false,
    })).toEqual({ effectiveVisible: false, peeking: false })
  })
})
