import { describe, expect, test } from 'bun:test'
import { canFocusNotesControl, isNotesPanelUnavailable } from '../focus-state'

function element(overrides: Record<string, unknown> = {}): HTMLElement {
  return {
    isConnected: true, hidden: false, inert: false, style: {}, parentElement: null,
    ownerDocument: { visibilityState: 'visible', defaultView: { getComputedStyle: (node: HTMLElement) => node.style } },
    getClientRects: () => [{}], closest: () => null, ...overrides,
  } as unknown as HTMLElement
}

describe('Notes focus in retained workspace tiles', () => {
  test('an ordinary visible control is eligible for explicit focus', () => {
    expect(canFocusNotesControl(element())).toBe(true)
  })

  test('hidden and inert ancestors cannot receive focus through a portal', () => {
    for (const parentElement of [element({ hidden: true }), element({ inert: true }), element({ style: { display: 'none' } })]) {
      expect(isNotesPanelUnavailable(element({ parentElement }))).toBe(true)
      expect(canFocusNotesControl(element({ parentElement }))).toBe(false)
    }
  })

  test('closed or minimized documents and disconnected controls cannot steal focus', () => {
    expect(canFocusNotesControl(null)).toBe(false)
    expect(canFocusNotesControl(element({ isConnected: false }))).toBe(false)
    expect(canFocusNotesControl(element({ ownerDocument: { visibilityState: 'hidden' } }))).toBe(false)
    expect(canFocusNotesControl(element({ getClientRects: () => [] }))).toBe(false)
  })

  test('a modal may hide the background from assistive technology without dismissing itself', () => {
    const background = element({ closest: () => element() })
    expect(isNotesPanelUnavailable(background)).toBe(false)
    expect(canFocusNotesControl(background)).toBe(false)
  })
})
