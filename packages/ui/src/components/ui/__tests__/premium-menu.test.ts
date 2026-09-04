import { describe, expect, it } from 'bun:test'
import {
  filterPremiumMenuItems,
  measureMenuOpen,
  placeAnchoredMenu,
  PREMIUM_MENU_TOKENS,
  typeaheadIndex,
  virtualizeWindow,
  type PremiumMenuItem,
} from '../premium-menu-model'

function items(n: number): PremiumMenuItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${String(i).padStart(4, '0')}`,
  }))
}

describe('premium menu model', () => {
  it('filters by case-insensitive substring', () => {
    const list = items(50)
    expect(filterPremiumMenuItems(list, '0012', (item) => item.label)).toEqual([
      { id: 'item-12', label: 'Item 0012' },
    ])
  })

  it('typeahead jumps to the next prefix match', () => {
    const list = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Alpine' },
    ]
    expect(typeaheadIndex(list, 'al', (item) => item.label, 0)).toBe(0)
    expect(typeaheadIndex(list, 'al', (item) => item.label, 1)).toBe(2)
  })

  it('virtualizes 1000 rows to a small window', () => {
    const slice = virtualizeWindow({
      count: 1000,
      rowHeight: 32,
      scrollTop: 32 * 200,
      viewportHeight: 320,
    })
    expect(slice.end - slice.start).toBeLessThan(40)
    expect(slice.height).toBe(32_000)
    expect(slice.start).toBeGreaterThan(190)
  })

  it('places the menu below the anchor and flips when the bottom overflows', () => {
    const below = placeAnchoredMenu({
      anchor: { top: 40, left: 20, width: 160, height: 28 },
      viewport: { width: 800, height: 600 },
      menuWidth: 240,
      menuHeight: 320,
    })
    expect(below.side).toBe('below')
    expect(below.top).toBeGreaterThan(40)

    const above = placeAnchoredMenu({
      anchor: { top: 520, left: 20, width: 160, height: 28 },
      viewport: { width: 800, height: 600 },
      menuWidth: 240,
      menuHeight: 320,
    })
    expect(above.side).toBe('above')
    expect(above.top + above.maxHeight).toBeLessThanOrEqual(520)
  })

  it('opens a 1000-item menu under the 80ms budget', () => {
    const list = items(1000)
    const measured = measureMenuOpen(list, 'item 00', (item) => item.label)
    expect(measured.filtered.length).toBeGreaterThan(0)
    expect(measured.window.end - measured.window.start).toBeLessThan(measured.filtered.length)
    expect(measured.durationMs).toBeLessThan(80)
  })

  it('exposes compact, regular, and inspector tokens', () => {
    expect(PREMIUM_MENU_TOKENS.compact.rowHeight).toBeLessThan(PREMIUM_MENU_TOKENS.regular.rowHeight)
    expect(PREMIUM_MENU_TOKENS.inspector.maxHeight).toBeGreaterThan(PREMIUM_MENU_TOKENS.regular.maxHeight)
  })
})
