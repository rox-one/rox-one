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

  it('reserves unmodified numbered platform shortcuts for surfaces with no duplicate defaults', () => {
    for (let slot = 1; slot <= 7; slot++) {
      const matches = Object.values(actions).filter(action => action.defaultHotkey === `mod+${slot}`)
      expect(matches.map(action => String(action.id))).toEqual([`mode.slot${slot}`])
    }
    expect(actions['nav.focusSidebar'].defaultHotkey).toBe('mod+alt+1')
  })
})
