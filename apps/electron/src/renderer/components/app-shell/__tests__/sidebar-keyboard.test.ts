import { describe, expect, it } from 'bun:test'
import type { KeyboardEvent } from 'react'
import { handleSidebarTreeKeyDown } from '../sidebar-keyboard'
import { actions } from '@/actions/definitions'

function fixture() {
  const controls = [0, 1, 2].map(index => ({
    focused: false,
    getClientRects: () => index === 1 ? [] : [{}],
    closest: (_selector: string): unknown => null,
    focus() { this.focused = true },
  }))
  const root = { querySelectorAll: () => controls }
  const target = { ...controls[0], tagName: 'BUTTON', getAttribute: () => null,
    closest: (selector: string) => selector.includes('data-focus-zone') ? root : null }
  controls[0] = target
  let prevented = false
  const event = (key: string) => ({ key, target, currentTarget: { querySelectorAll: () => [] },
    preventDefault() { prevented = true }, get defaultPrevented() { return prevented } }) as unknown as KeyboardEvent<HTMLElement>
  return { controls, event, prevented: () => prevented }
}

describe('single sidebar keyboard navigation', () => {
  it('moves from portalled filters to the next visible control and skips folded controls', () => {
    const f = fixture()
    handleSidebarTreeKeyDown(f.event('ArrowDown'))
    expect(f.controls[2].focused).toBe(true)
    expect(f.controls[1].focused).toBe(false)
    expect(f.prevented()).toBe(true)
  })

  it('leaves Tab to native traversal within the sidebar', () => {
    const f = fixture()
    handleSidebarTreeKeyDown(f.event('Tab'))
    expect(f.prevented()).toBe(false)
    expect(f.controls.some(control => control.focused)).toBe(false)
  })

  it('skips inert closing-animation content even while it has layout rectangles', () => {
    const f = fixture()
    f.controls[1].getClientRects = () => [{}]
    f.controls[1].closest = selector => selector.includes('[inert]') ? {} : null
    handleSidebarTreeKeyDown(f.event('ArrowDown'))
    expect(f.controls[2].focused).toBe(true)
    expect(f.controls[1].focused).toBe(false)
  })

  it('skips closed native disclosure content even when Chromium keeps nonempty layout rectangles', () => {
    let focused = -1
    const closedGroup = { querySelector: () => controls[1], parentElement: null }
    const nestedClosedGroup = { querySelector: () => controls[3], parentElement: { closest: () => closedGroup } }
    const controls = [0, 1, 2, 3, 4, 5].map(index => ({
      tagName: index === 1 || index === 3 ? 'SUMMARY' : 'BUTTON',
      getClientRects: () => [{}], // Native closed details does not guarantee zero rects.
      closest(selector: string): unknown {
        if (selector.includes('data-focus-zone')) return root
        if (selector === 'details:not([open])') return index === 1 || index === 2 ? closedGroup : index === 3 || index === 4 ? nestedClosedGroup : null
        return null
      },
      focus() { focused = index },
    }))
    const root = { querySelectorAll: () => controls }
    const event = (index: number, key: string) => ({ key, target: controls[index], currentTarget: root, preventDefault() {} }) as unknown as KeyboardEvent<HTMLElement>
    handleSidebarTreeKeyDown(event(0, 'ArrowDown'))
    expect(focused).toBe(1) // The folded group's own summary stays reachable.
    handleSidebarTreeKeyDown(event(1, 'ArrowDown'))
    expect(focused).toBe(5) // Its content and nested summary are skipped.
    handleSidebarTreeKeyDown(event(5, 'ArrowUp'))
    expect(focused).toBe(1)
  })

  it('reserves unmodified numbered platform shortcuts for surfaces with no duplicate defaults', () => {
    for (let slot = 1; slot <= 7; slot++) {
      const matches = Object.values(actions).filter(action => action.defaultHotkey === `mod+${slot}`)
      expect(matches.map(action => String(action.id))).toEqual([`mode.slot${slot}`])
    }
    expect(actions['nav.focusSidebar'].defaultHotkey).toBe('mod+alt+1')
  })
})
