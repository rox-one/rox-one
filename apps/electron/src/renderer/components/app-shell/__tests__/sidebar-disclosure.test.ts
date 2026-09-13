import { describe, expect, it } from 'bun:test'
import {
  isNavigableExpandable,
  restoreFocusToToggle,
  sidebarSectionDomId,
} from '../SidebarDisclosure'

describe('sidebar disclosure helpers (ZS-04)', () => {
  it('builds a stable section id from the nav key', () => {
    expect(sidebarSectionDomId('nav:allSessions')).toBe('sidebar-section-nav-allSessions')
    expect(sidebarSectionDomId('nav:label:work/ops')).toBe('sidebar-section-nav-label-work-ops')
  })

  it('treats expandable items with onClick as navigable parents', () => {
    expect(isNavigableExpandable({ expandable: true, onClick: () => undefined })).toBe(true)
    expect(isNavigableExpandable({ expandable: true })).toBe(false)
    expect(isNavigableExpandable({ onClick: () => undefined })).toBe(false)
  })

  it('restores focus to the toggle when it is inside the collapsible body', () => {
    const child = { id: 'child' }
    const toggle = { focused: false, focus() { this.focused = true } }
    const body = { contains(node: unknown) { return node === child } }
    const previous = globalThis.document
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { activeElement: child },
    })
    restoreFocusToToggle(body as HTMLElement, toggle as unknown as HTMLElement)
    expect(toggle.focused).toBe(true)
    restoreFocusToToggle(null, toggle as unknown as HTMLElement)
    Object.defineProperty(globalThis, 'document', { configurable: true, value: previous })
  })
})
