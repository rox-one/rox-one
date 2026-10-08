import type { Page } from '@playwright/test'

/** Geometric intersection alone includes subpixel cards that look like a blank canvas. */
export async function measureRuntimeCardVisibility(page: Page) {
  return page.getByTestId('runtime-node').evaluateAll(cards => {
    const viewport = document.querySelector('[data-testid="runtime-canvas"]')!.getBoundingClientRect()
    const minimum = { width: 40, height: 8, statusWidth: 2, statusHeight: 2 }
    const measured = cards.map(card => {
      const rect = card.getBoundingClientRect()
      const style = getComputedStyle(card)
      const header = card.querySelector('header')
      const headerRect = header?.getBoundingClientRect()
      const headerStyle = header ? getComputedStyle(header) : undefined
      const status = card.querySelector('.runtime-status-icon svg')
      const statusRect = status?.getBoundingClientRect()
      const intersects = rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom
      const contained = rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1 && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1
      const rendered = style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0
        && headerStyle?.visibility === 'visible' && headerStyle.display !== 'none' && Number(headerStyle.opacity) > 0
      const physicalSize = rect.width >= minimum.width && rect.height >= minimum.height
        && (headerRect?.width ?? 0) >= minimum.width && (headerRect?.height ?? 0) >= minimum.height
        && (statusRect?.width ?? 0) >= minimum.statusWidth && (statusRect?.height ?? 0) >= minimum.statusHeight
      return { id: (card as HTMLElement).dataset.runtimeId, width: rect.width, height: rect.height,
        statusWidth: statusRect?.width ?? 0, statusHeight: statusRect?.height ?? 0,
        intersects, contained, rendered, physicallyPaintable: contained && rendered && physicalSize }
    })
    return { mounted: cards.length, intersecting: measured.filter(card => card.intersects).length,
      physicallyPaintable: measured.filter(card => card.physicallyPaintable).length,
      minimumCssPixels: minimum, minimumMeasuredWidth: Math.min(...measured.map(card => card.width)),
      minimumMeasuredHeight: Math.min(...measured.map(card => card.height)),
      viewport: { width: viewport.width, height: viewport.height }, cards: measured }
  })
}
