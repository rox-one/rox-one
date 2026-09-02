/**
 * Headless model for the shared premium menu surface (Issue 04).
 *
 * Pure functions so 1,000-item open, search, typeahead, placement and
 * virtualization can be tested without mounting React.
 */

export type PremiumMenuVariant = 'compact' | 'regular' | 'inspector'
export type PremiumMenuSide = 'top' | 'bottom'

export interface PremiumMenuVariantTokens {
  itemHeight: number
  maxHeight: number
  minWidth: number
  maxWidth: number
  overscan: number
  surfaceClass: string
  itemClass: string
  searchClass: string
}

/** Rox tokens: popover-styled owns radius 8px + modal-small shadow. */
export const PREMIUM_MENU_VARIANTS: Record<PremiumMenuVariant, PremiumMenuVariantTokens> = {
  compact: {
    itemHeight: 28,
    maxHeight: 196,
    minWidth: 140,
    maxWidth: 240,
    overscan: 4,
    surfaceClass: 'popover-styled z-floating-menu overflow-hidden p-0.5 text-xs',
    itemClass: 'rounded-[4px] px-2 py-1 text-xs',
    searchClass: 'px-2 py-1.5 text-xs',
  },
  regular: {
    itemHeight: 32,
    maxHeight: 240,
    minWidth: 200,
    maxWidth: 320,
    overscan: 6,
    surfaceClass: 'popover-styled z-floating-menu overflow-hidden p-1 text-[13px]',
    itemClass: 'rounded-[6px] px-3 py-1.5 text-[13px]',
    searchClass: 'px-3 py-2 text-sm',
  },
  inspector: {
    itemHeight: 36,
    maxHeight: 360,
    minWidth: 240,
    maxWidth: 420,
    overscan: 8,
    surfaceClass: 'popover-styled z-floating-menu overflow-hidden p-1.5 text-sm',
    itemClass: 'rounded-[6px] px-3 py-2 text-sm',
    searchClass: 'px-3 py-2.5 text-sm',
  },
}

/** Gherkin budget for a 1,000-item open + keyboard search. */
export const PREMIUM_MENU_OPEN_BUDGET_MS = 80
export const PREMIUM_MENU_VIRTUALIZE_AFTER = 40
export const PREMIUM_MENU_TYPEAHEAD_RESET_MS = 500

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface MenuPlacement {
  top: number
  left: number
  side: PremiumMenuSide
}

export interface VirtualWindow {
  start: number
  end: number
  offsetTop: number
  totalHeight: number
  visibleCount: number
}

export function filterMenuItems<T>(
  items: readonly T[],
  query: string,
  getLabel: (item: T) => string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items as T[]
  return items.filter((item) => getLabel(item).toLowerCase().includes(needle))
}

export function matchTypeahead(
  query: string,
  labels: readonly string[],
  fromIndex: number,
): number {
  const needle = query.trim().toLowerCase()
  if (!needle || labels.length === 0) return -1

  const start = labels.length === 0 ? 0 : (fromIndex + 1 + labels.length) % labels.length
  for (let step = 0; step < labels.length; step += 1) {
    const index = (start + step) % labels.length
    if (labels[index]!.toLowerCase().startsWith(needle)) return index
  }
  for (let step = 0; step < labels.length; step += 1) {
    const index = (start + step) % labels.length
    if (labels[index]!.toLowerCase().includes(needle)) return index
  }
  return -1
}

export function getVirtualWindow(opts: {
  itemCount: number
  itemHeight: number
  scrollTop: number
  viewportHeight: number
  overscan?: number
}): VirtualWindow {
  const itemHeight = Math.max(1, opts.itemHeight)
  const overscan = opts.overscan ?? 4
  const totalHeight = opts.itemCount * itemHeight
  if (opts.itemCount <= 0) {
    return { start: 0, end: 0, offsetTop: 0, totalHeight: 0, visibleCount: 0 }
  }

  const rawStart = Math.max(0, Math.floor(Math.max(0, opts.scrollTop) / itemHeight))
  const visible = Math.max(1, Math.ceil(opts.viewportHeight / itemHeight))
  const start = Math.max(0, rawStart - overscan)
  const end = Math.min(opts.itemCount, rawStart + visible + overscan)
  return {
    start,
    end,
    offsetTop: start * itemHeight,
    totalHeight,
    visibleCount: end - start,
  }
}

export function scrollTopToRevealIndex(
  index: number,
  itemHeight: number,
  viewportHeight: number,
  currentScrollTop: number,
): number {
  const itemTop = index * itemHeight
  const itemBottom = itemTop + itemHeight
  if (itemTop < currentScrollTop) return itemTop
  if (itemBottom > currentScrollTop + viewportHeight) {
    return Math.max(0, itemBottom - viewportHeight)
  }
  return currentScrollTop
}

export function isIndexVisible(index: number, window: VirtualWindow): boolean {
  return index >= window.start && index < window.end
}

export function placeAnchoredMenu(input: {
  anchor: Rect
  menu: { width: number; height: number }
  viewport: { width: number; height: number }
  preferred?: PremiumMenuSide
  gap?: number
  padding?: number
}): MenuPlacement {
  const gap = input.gap ?? 4
  const padding = input.padding ?? 8
  const preferred = input.preferred ?? 'bottom'
  const { anchor, menu, viewport } = input

  const spaceBelow = viewport.height - (anchor.top + anchor.height) - padding
  const spaceAbove = anchor.top - padding
  let side: PremiumMenuSide = preferred
  if (preferred === 'bottom' && menu.height > spaceBelow && spaceAbove > spaceBelow) {
    side = 'top'
  } else if (preferred === 'top' && menu.height > spaceAbove && spaceBelow > spaceAbove) {
    side = 'bottom'
  }

  const unclampedTop = side === 'bottom'
    ? anchor.top + anchor.height + gap
    : anchor.top - menu.height - gap

  const maxTop = Math.max(padding, viewport.height - menu.height - padding)
  const maxLeft = Math.max(padding, viewport.width - menu.width - padding)

  return {
    top: Math.max(padding, Math.min(unclampedTop, maxTop)),
    left: Math.max(padding, Math.min(anchor.left, maxLeft)),
    side,
  }
}

export interface MenuKeyState {
  highlightedIndex: number
  itemCount: number
}

export interface MenuKeyResult {
  highlightedIndex: number
  select: boolean
  close: boolean
  preventDefault: boolean
}

export function reduceMenuKey(key: string, state: MenuKeyState): MenuKeyResult {
  const count = state.itemCount
  const current = count === 0 ? 0 : Math.min(Math.max(0, state.highlightedIndex), count - 1)

  if (key === 'Escape') {
    return { highlightedIndex: current, select: false, close: true, preventDefault: true }
  }
  if (count === 0) {
    return { highlightedIndex: 0, select: false, close: false, preventDefault: false }
  }
  if (key === 'ArrowDown') {
    return { highlightedIndex: (current + 1) % count, select: false, close: false, preventDefault: true }
  }
  if (key === 'ArrowUp') {
    return { highlightedIndex: (current - 1 + count) % count, select: false, close: false, preventDefault: true }
  }
  if (key === 'Home') {
    return { highlightedIndex: 0, select: false, close: false, preventDefault: true }
  }
  if (key === 'End') {
    return { highlightedIndex: count - 1, select: false, close: false, preventDefault: true }
  }
  if (key === 'Enter') {
    return { highlightedIndex: current, select: true, close: false, preventDefault: true }
  }
  return { highlightedIndex: current, select: false, close: false, preventDefault: false }
}

export interface SimulatedMenuOpen {
  filteredCount: number
  window: VirtualWindow
  placement: MenuPlacement
  selectedIndex: number
  selectedVisible: boolean
}

/**
 * Deterministic 1,000-item open path used by unit tests and the Issue 03 harness.
 * Does not fabricate product metrics — labels are synthetic list rows.
 */
export function simulatePremiumMenuOpen(
  itemCount = 1000,
  selectedIndex = 42,
  query = '',
): SimulatedMenuOpen {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `item-${index}`,
    label: `Provider ${String(index).padStart(4, '0')}`,
  }))
  const filtered = filterMenuItems(items, query, (item) => item.label)
  const variant = PREMIUM_MENU_VARIANTS.regular
  const highlight = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
  const scrollTop = scrollTopToRevealIndex(highlight, variant.itemHeight, variant.maxHeight, 0)
  const window = getVirtualWindow({
    itemCount: filtered.length,
    itemHeight: variant.itemHeight,
    scrollTop,
    viewportHeight: variant.maxHeight,
    overscan: variant.overscan,
  })
  const placement = placeAnchoredMenu({
    anchor: { top: 400, left: 80, width: 160, height: 28 },
    menu: { width: variant.minWidth, height: variant.maxHeight },
    viewport: { width: 1280, height: 800 },
    preferred: 'bottom',
  })
  return {
    filteredCount: filtered.length,
    window,
    placement,
    selectedIndex: highlight,
    selectedVisible: isIndexVisible(highlight, window),
  }
}
