import { describe, expect, it } from 'bun:test'
import {
  auditPremiumMenuAxe,
  filterPremiumMenuItems,
  isIndexVisible,
  measureMenuOpen,
  placeAnchoredMenu,
  PREMIUM_MENU_OPEN_BUDGET_MS,
  PREMIUM_MENU_TOKENS,
  reduceMenuKey,
  scrollTopToRevealIndex,
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

  it('typeahead jumps to the next prefix match and wraps', () => {
    const list = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Alpine' },
    ]
    expect(typeaheadIndex(list, 'al', (item) => item.label, 0)).toBe(2)
    expect(typeaheadIndex(list, 'al', (item) => item.label, 2)).toBe(0)
    expect(typeaheadIndex(list, 'z', (item) => item.label, 0)).toBe(-1)
  })

  it('typeahead falls back to substring when no prefix matches', () => {
    const list = [
      { id: 'a', label: 'Rox Fast' },
      { id: 'b', label: 'OpenAI' },
    ]
    expect(typeaheadIndex(list, 'fast', (item) => item.label, 0)).toBe(0)
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

  it('scrolls so a far selected item remains visible', () => {
    const tokens = PREMIUM_MENU_TOKENS.regular
    const scrollTop = scrollTopToRevealIndex(900, tokens.rowHeight, tokens.maxHeight, 0)
    const window = virtualizeWindow({
      count: 1000,
      rowHeight: tokens.rowHeight,
      scrollTop,
      viewportHeight: tokens.maxHeight,
      overscan: tokens.overscan,
    })
    expect(isIndexVisible(900, window)).toBe(true)
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

  it('clamps horizontal overflow against the viewport', () => {
    const clamped = placeAnchoredMenu({
      anchor: { top: 10, left: 780, width: 80, height: 24 },
      viewport: { width: 800, height: 400 },
      menuWidth: 240,
      menuHeight: 120,
    })
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(800 - 8)
  })

  it('navigates, selects and closes from the keyboard reducer', () => {
    expect(reduceMenuKey('ArrowDown', { highlightedIndex: 0, itemCount: 3 }).highlightedIndex).toBe(1)
    expect(reduceMenuKey('ArrowUp', { highlightedIndex: 0, itemCount: 3 }).highlightedIndex).toBe(2)
    expect(reduceMenuKey('Home', { highlightedIndex: 2, itemCount: 3 }).highlightedIndex).toBe(0)
    expect(reduceMenuKey('End', { highlightedIndex: 0, itemCount: 3 }).highlightedIndex).toBe(2)
    expect(reduceMenuKey('Enter', { highlightedIndex: 1, itemCount: 3 }).select).toBe(true)
    expect(reduceMenuKey('Escape', { highlightedIndex: 1, itemCount: 3 }).close).toBe(true)
  })

  it('opens a 1000-item menu under the 80ms budget with the selected row visible', () => {
    const list = items(1000)
    const measured = measureMenuOpen(list, '', (item) => item.label, 42)
    expect(measured.filtered.length).toBe(1000)
    expect(measured.window.end - measured.window.start).toBeLessThan(measured.filtered.length)
    expect(measured.selectedVisible).toBe(true)
    expect(isIndexVisible(42, measured.window)).toBe(true)
    expect(measured.durationMs).toBeLessThan(PREMIUM_MENU_OPEN_BUDGET_MS)
  })

  it('searching 1000 items keeps the first match highlighted and visible', () => {
    const list = items(1000)
    const measured = measureMenuOpen(list, 'item 0900', (item) => item.label, 0)
    expect(measured.filtered.length).toBe(1)
    expect(measured.selectedIndex).toBe(0)
    expect(measured.selectedVisible).toBe(true)
  })

  it('exposes compact, regular, and inspector tokens', () => {
    expect(PREMIUM_MENU_TOKENS.compact.rowHeight).toBeLessThan(PREMIUM_MENU_TOKENS.regular.rowHeight)
    expect(PREMIUM_MENU_TOKENS.inspector.maxHeight).toBeGreaterThan(PREMIUM_MENU_TOKENS.regular.maxHeight)
    expect(PREMIUM_MENU_TOKENS.compact.surfaceClass).toContain('popover-styled')
  })
})

describe('premium menu axe contract', () => {
  it('accepts a searchable listbox with activedescendant pointing at an option', () => {
    const violations = auditPremiumMenuAxe({
      listbox: {
        role: 'listbox',
        ariaActivedescendant: 'premium-menu-option-item-2',
        tabIndex: -1,
      },
      search: {
        role: 'textbox',
        ariaControls: 'premium-menu-list',
        ariaAutocomplete: 'list',
      },
      options: [
        { id: 'premium-menu-option-item-0', role: 'option', ariaSelected: false },
        { id: 'premium-menu-option-item-1', role: 'option', ariaSelected: false },
        { id: 'premium-menu-option-item-2', role: 'option', ariaSelected: true },
      ],
    })
    expect(violations).toEqual([])
  })

  it('flags activedescendant without a matching option id', () => {
    const violations = auditPremiumMenuAxe({
      listbox: { role: 'listbox', ariaActivedescendant: 'missing', tabIndex: 0 },
      options: [{ id: 'premium-menu-option-a', role: 'option', ariaSelected: false }],
    })
    expect(violations).toContain('activedescendant-missing-target')
  })
})
