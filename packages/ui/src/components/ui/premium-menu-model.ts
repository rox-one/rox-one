export type PremiumMenuVariant = 'compact' | 'regular' | 'inspector'

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
  side: 'below' | 'above'
}

export const PREMIUM_MENU_TOKENS: Record<PremiumMenuVariant, {
  rowHeight: number
  maxHeight: number
  fontSize: string
  radius: string
  shadow: string
  padX: number
}> = {
  compact: {
    rowHeight: 28,
    maxHeight: 240,
    fontSize: '12px',
    radius: 'var(--radius-md, 8px)',
    shadow: 'var(--shadow-modal-small, 0 8px 24px rgb(0 0 0 / 0.18))',
    padX: 8,
  },
  regular: {
    rowHeight: 32,
    maxHeight: 320,
    fontSize: '13px',
    radius: 'var(--radius-md, 8px)',
    shadow: 'var(--shadow-modal-small, 0 8px 24px rgb(0 0 0 / 0.18))',
    padX: 10,
  },
  inspector: {
    rowHeight: 36,
    maxHeight: 420,
    fontSize: '13px',
    radius: 'var(--radius-md, 8px)',
    shadow: 'var(--shadow-modal-small, 0 8px 24px rgb(0 0 0 / 0.18))',
    padX: 12,
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

/** First prefix match for keyboard typeahead (case-insensitive). */
export function typeaheadIndex<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
  fromIndex = 0,
): number {
  const needle = query.trim().toLowerCase()
  if (!needle || items.length === 0) return -1
  const start = ((fromIndex % items.length) + items.length) % items.length
  for (let i = 0; i < items.length; i++) {
    const index = (start + i) % items.length
    const item = items[index]
    if (item && getLabel(item).toLowerCase().startsWith(needle)) return index
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
  const start = Math.max(0, Math.floor(input.scrollTop / rowHeight) - overscan)
  const visible = Math.ceil(input.viewportHeight / rowHeight) + overscan * 2
  const end = Math.min(input.count, start + visible)
  return {
    start,
    end,
    offsetY: start * rowHeight,
    height: input.count * rowHeight,
  }
}

export function placeAnchoredMenu(input: {
  anchor: Rect
  viewport: Viewport
  menuWidth: number
  menuHeight: number
  gap?: number
  padding?: number
}): MenuPlacement {
  const gap = input.gap ?? 4
  const padding = input.padding ?? 8
  const width = Math.min(input.menuWidth, input.viewport.width - padding * 2)
  const spaceBelow = input.viewport.height - input.anchor.top - input.anchor.height - gap - padding
  const spaceAbove = input.anchor.top - gap - padding
  const preferBelow = spaceBelow >= Math.min(input.menuHeight, 120) || spaceBelow >= spaceAbove
  const side: 'below' | 'above' = preferBelow ? 'below' : 'above'
  const maxHeight = Math.max(96, Math.min(input.menuHeight, preferBelow ? spaceBelow : spaceAbove))
  const top = preferBelow
    ? input.anchor.top + input.anchor.height + gap
    : input.anchor.top - gap - maxHeight
  const maxLeft = Math.max(padding, input.viewport.width - width - padding)
  const left = Math.max(padding, Math.min(input.anchor.left, maxLeft))
  return { top: Math.max(padding, top), left, width, maxHeight, side }
}

export function measureMenuOpen<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
): { filtered: T[]; window: ReturnType<typeof virtualizeWindow>; durationMs: number } {
  const t0 = performance.now()
  const filtered = filterPremiumMenuItems(items, query, getLabel)
  const window = virtualizeWindow({
    count: filtered.length,
    rowHeight: PREMIUM_MENU_TOKENS.regular.rowHeight,
    scrollTop: 0,
    viewportHeight: PREMIUM_MENU_TOKENS.regular.maxHeight,
  })
  return { filtered, window, durationMs: performance.now() - t0 }
}
