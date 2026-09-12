export type PremiumMenuVariant = 'compact' | 'regular' | 'inspector'
export type PremiumMenuSide = 'below' | 'above'

export interface PremiumMenuItem {
  id: string
  label: string
  disabled?: boolean
}

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export interface MenuPlacement {
  top: number
  left: number
  width: number
  maxHeight: number
  side: PremiumMenuSide
}

export const PREMIUM_MENU_OPEN_BUDGET_MS = 80
export const PREMIUM_MENU_VIRTUALIZE_AFTER = 40
export const PREMIUM_MENU_TYPEAHEAD_RESET_MS = 600

export const PREMIUM_MENU_TOKENS: Record<PremiumMenuVariant, {
  rowHeight: number
  maxHeight: number
  minWidth: number
  maxWidth: number
  fontSize: string
  radius: string
  shadow: string
  padX: number
  overscan: number
  surfaceClass: string
}> = {
  compact: {
    rowHeight: 28,
    maxHeight: 240,
    minWidth: 140,
    maxWidth: 240,
    fontSize: '12px',
    radius: 'var(--radius-md, 8px)',
    shadow: 'var(--shadow-modal-small, 0 8px 24px rgb(0 0 0 / 0.18))',
    padX: 8,
    overscan: 4,
    surfaceClass: 'popover-styled z-floating-menu overflow-hidden p-0.5 text-xs',
  },
  regular: {
    rowHeight: 32,
    maxHeight: 320,
    minWidth: 200,
    maxWidth: 320,
    fontSize: '13px',
    radius: 'var(--radius-md, 8px)',
    shadow: 'var(--shadow-modal-small, 0 8px 24px rgb(0 0 0 / 0.18))',
    padX: 10,
    overscan: 6,
    surfaceClass: 'popover-styled z-floating-menu overflow-hidden p-1 text-[13px]',
  },
  inspector: {
    rowHeight: 36,
    maxHeight: 420,
    minWidth: 240,
    maxWidth: 420,
    fontSize: '13px',
    radius: 'var(--radius-md, 8px)',
    shadow: 'var(--shadow-modal-small, 0 8px 24px rgb(0 0 0 / 0.18))',
    padX: 12,
    overscan: 8,
    surfaceClass: 'popover-styled z-floating-menu overflow-hidden p-1.5 text-sm',
  },
}

export function filterPremiumMenuItems<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => getLabel(item).toLowerCase().includes(needle))
}

/**
 * Next prefix match for keyboard typeahead (case-insensitive).
 * Starts after `fromIndex` and wraps. Falls back to substring matches.
 */
export function typeaheadIndex<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
  fromIndex = 0,
): number {
  const needle = query.trim().toLowerCase()
  if (!needle || items.length === 0) return -1
  const start = ((fromIndex + 1) % items.length + items.length) % items.length
  for (let i = 0; i < items.length; i++) {
    const index = (start + i) % items.length
    const item = items[index]
    if (item && getLabel(item).toLowerCase().startsWith(needle)) return index
  }
  for (let i = 0; i < items.length; i++) {
    const index = (start + i) % items.length
    const item = items[index]
    if (item && getLabel(item).toLowerCase().includes(needle)) return index
  }
  return -1
}

export function virtualizeWindow(input: {
  count: number
  rowHeight: number
  scrollTop: number
  viewportHeight: number
  overscan?: number
}): { start: number; end: number; offsetY: number; height: number } {
  const overscan = input.overscan ?? 6
  const rowHeight = Math.max(1, input.rowHeight)
  if (input.count <= 0) {
    return { start: 0, end: 0, offsetY: 0, height: 0 }
  }
  const start = Math.max(0, Math.floor(Math.max(0, input.scrollTop) / rowHeight) - overscan)
  const visible = Math.ceil(input.viewportHeight / rowHeight) + overscan * 2
  const end = Math.min(input.count, start + visible)
  return {
    start,
    end,
    offsetY: start * rowHeight,
    height: input.count * rowHeight,
  }
}

export function isIndexVisible(
  index: number,
  window: { start: number; end: number },
): boolean {
  return index >= window.start && index < window.end
}

export function scrollTopToRevealIndex(
  index: number,
  rowHeight: number,
  viewportHeight: number,
  currentScrollTop: number,
): number {
  const itemTop = index * rowHeight
  const itemBottom = itemTop + rowHeight
  if (itemTop < currentScrollTop) return itemTop
  if (itemBottom > currentScrollTop + viewportHeight) {
    return Math.max(0, itemBottom - viewportHeight)
  }
  return currentScrollTop
}

export function placeAnchoredMenu(input: {
  anchor: Rect
  viewport: Viewport
  menuWidth: number
  menuHeight: number
  gap?: number
  padding?: number
  preferred?: PremiumMenuSide
}): MenuPlacement {
  const gap = input.gap ?? 4
  const padding = input.padding ?? 8
  const preferred = input.preferred ?? 'below'
  const width = Math.min(input.menuWidth, input.viewport.width - padding * 2)
  const spaceBelow = input.viewport.height - input.anchor.top - input.anchor.height - gap - padding
  const spaceAbove = input.anchor.top - gap - padding
  const preferBelow = preferred === 'below'
    ? spaceBelow >= Math.min(input.menuHeight, 120) || spaceBelow >= spaceAbove
    : spaceAbove < Math.min(input.menuHeight, 120) && spaceBelow > spaceAbove
  const side: PremiumMenuSide = preferBelow ? 'below' : 'above'
  const maxHeight = Math.max(96, Math.min(input.menuHeight, preferBelow ? spaceBelow : spaceAbove))
  const top = preferBelow
    ? input.anchor.top + input.anchor.height + gap
    : input.anchor.top - gap - maxHeight
  const maxLeft = Math.max(padding, input.viewport.width - width - padding)
  const left = Math.max(padding, Math.min(input.anchor.left, maxLeft))
  return { top: Math.max(padding, top), left, width, maxHeight, side }
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
  filtered: ReturnType<typeof filterPremiumMenuItems>
  window: ReturnType<typeof virtualizeWindow>
  durationMs: number
  selectedIndex: number
  selectedVisible: boolean
}

export function measureMenuOpen<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
  selectedIndex = 0,
): SimulatedMenuOpen {
  const t0 = performance.now()
  const filtered = filterPremiumMenuItems(items, query, getLabel)
  const tokens = PREMIUM_MENU_TOKENS.regular
  const highlight = Math.min(Math.max(0, selectedIndex), Math.max(0, filtered.length - 1))
  const scrollTop = scrollTopToRevealIndex(highlight, tokens.rowHeight, tokens.maxHeight, 0)
  const window = virtualizeWindow({
    count: filtered.length,
    rowHeight: tokens.rowHeight,
    scrollTop,
    viewportHeight: tokens.maxHeight,
    overscan: tokens.overscan,
  })
  return {
    filtered,
    window,
    durationMs: performance.now() - t0,
    selectedIndex: highlight,
    selectedVisible: filtered.length === 0 || isIndexVisible(highlight, window),
  }
}

/** WCAG-style contract used by axe unit checks (no DOM / axe-core dependency). */
export interface PremiumMenuAxeTree {
  listbox: {
    role: 'listbox'
    ariaActivedescendant?: string
    tabIndex: number
  }
  search?: {
    role: 'searchbox' | 'textbox'
    ariaControls: string
    ariaAutocomplete: 'list'
  }
  options: Array<{
    id: string
    role: 'option'
    ariaSelected: boolean
    disabled?: boolean
  }>
}

export function auditPremiumMenuAxe(tree: PremiumMenuAxeTree): string[] {
  const violations: string[] = []
  if (tree.listbox.role !== 'listbox') violations.push('listbox-role')
  if (tree.search) {
    if (tree.search.ariaAutocomplete !== 'list') violations.push('search-autocomplete')
    if (!tree.search.ariaControls) violations.push('search-controls')
  }
  const optionIds = new Set<string>()
  for (const option of tree.options) {
    if (option.role !== 'option') violations.push(`option-role:${option.id}`)
    if (!option.id) violations.push('option-missing-id')
    if (optionIds.has(option.id)) violations.push(`duplicate-id:${option.id}`)
    optionIds.add(option.id)
  }
  if (tree.listbox.ariaActivedescendant && !optionIds.has(tree.listbox.ariaActivedescendant)) {
    violations.push('activedescendant-missing-target')
  }
  const selected = tree.options.filter((option) => option.ariaSelected)
  if (selected.length > 1) violations.push('multiple-aria-selected')
  return violations
}
