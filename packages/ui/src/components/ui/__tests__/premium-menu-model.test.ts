import { describe, expect, it } from 'bun:test'
import {
  PREMIUM_MENU_OPEN_BUDGET_MS,
  PREMIUM_MENU_VARIANTS,
  filterMenuItems,
  getVirtualWindow,
  isIndexVisible,
  matchTypeahead,
  placeAnchoredMenu,
  reduceMenuKey,
  scrollTopToRevealIndex,
  simulatePremiumMenuOpen,
} from '../premium-menu-model'

describe('premium menu model', () => {
  it('filters by case-insensitive label substring', () => {
    const items = [
      { id: 'a', label: 'Anthropic' },
      { id: 'b', label: 'OpenAI' },
      { id: 'c', label: 'Rox Fast' },
    ]
    expect(filterMenuItems(items, 'rox', (item) => item.label).map((item) => item.id)).toEqual(['c'])
    expect(filterMenuItems(items, '  ', (item) => item.label)).toHaveLength(3)
  })

  it('typeahead prefers prefix matches and wraps around', () => {
    const labels = ['Alpha', 'Beta', 'Alpine', 'Gamma']
    expect(matchTypeahead('al', labels, 0)).toBe(2)
    expect(matchTypeahead('g', labels, 3)).toBe(3)
    expect(matchTypeahead('z', labels, 0)).toBe(-1)
  })

  it('virtualizes a 1,000-item list without rendering the full range', () => {
    const variant = PREMIUM_MENU_VARIANTS.regular
    const window = getVirtualWindow({
      itemCount: 1000,
      itemHeight: variant.itemHeight,
      scrollTop: 0,
      viewportHeight: variant.maxHeight,
      overscan: variant.overscan,
    })
    expect(window.totalHeight).toBe(1000 * variant.itemHeight)
    expect(window.visibleCount).toBeLessThan(40)
    expect(window.end - window.start).toBe(window.visibleCount)
  })

  it('keeps the selected index inside the virtual window after open', () => {
    const result = simulatePremiumMenuOpen(1000, 42)
    expect(result.filteredCount).toBe(1000)
    expect(result.selectedVisible).toBe(true)
    expect(isIndexVisible(42, result.window)).toBe(true)
  })

  it('scrolls so a far selected item remains visible', () => {
    const variant = PREMIUM_MENU_VARIANTS.regular
    const scrollTop = scrollTopToRevealIndex(900, variant.itemHeight, variant.maxHeight, 0)
    const window = getVirtualWindow({
      itemCount: 1000,
      itemHeight: variant.itemHeight,
      scrollTop,
      viewportHeight: variant.maxHeight,
      overscan: variant.overscan,
    })
    expect(isIndexVisible(900, window)).toBe(true)
  })

  it('flips placement when the preferred side collides with the viewport', () => {
    const flipped = placeAnchoredMenu({
      anchor: { top: 760, left: 40, width: 120, height: 28 },
      menu: { width: 240, height: 240 },
      viewport: { width: 800, height: 800 },
      preferred: 'bottom',
    })
    expect(flipped.side).toBe('top')
    expect(flipped.top).toBeGreaterThanOrEqual(8)

    const clamped = placeAnchoredMenu({
      anchor: { top: 10, left: 780, width: 80, height: 24 },
      menu: { width: 240, height: 120 },
      viewport: { width: 800, height: 400 },
      preferred: 'bottom',
    })
    expect(clamped.left + 240).toBeLessThanOrEqual(800 - 8)
  })

  it('navigates, selects and closes from the keyboard reducer', () => {
    expect(reduceMenuKey('ArrowDown', { highlightedIndex: 0, itemCount: 3 }).highlightedIndex).toBe(1)
    expect(reduceMenuKey('ArrowUp', { highlightedIndex: 0, itemCount: 3 }).highlightedIndex).toBe(2)
    expect(reduceMenuKey('Home', { highlightedIndex: 2, itemCount: 3 }).highlightedIndex).toBe(0)
    expect(reduceMenuKey('End', { highlightedIndex: 0, itemCount: 3 }).highlightedIndex).toBe(2)
    expect(reduceMenuKey('Enter', { highlightedIndex: 1, itemCount: 3 }).select).toBe(true)
    expect(reduceMenuKey('Escape', { highlightedIndex: 1, itemCount: 3 }).close).toBe(true)
  })

  it('opens a 1,000-item menu within 80ms without a full DOM list', () => {
    const started = performance.now()
    const opened = simulatePremiumMenuOpen(1000, 42)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(PREMIUM_MENU_OPEN_BUDGET_MS)
    expect(opened.window.visibleCount).toBeLessThan(opened.filteredCount)
    expect(opened.selectedVisible).toBe(true)
    expect(opened.placement.top).toBeGreaterThan(0)
  })

  it('searching 1,000 items keeps the first match highlighted and visible', () => {
    const opened = simulatePremiumMenuOpen(1000, 0, 'Provider 0900')
    expect(opened.filteredCount).toBe(1)
    expect(opened.selectedIndex).toBe(0)
    expect(opened.selectedVisible).toBe(true)
  })
})
