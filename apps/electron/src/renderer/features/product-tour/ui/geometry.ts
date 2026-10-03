/** All coordinates stay in viewport CSS pixels; browser zoom is already applied by DOMRect. */
export interface TargetRect {
  readonly x: number
  readonly y: number
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}
export interface TargetGeometry {
  readonly rect: TargetRect
  readonly spotlightRect: TargetRect
  readonly viewport: { readonly width: number; readonly height: number }
}

function rect(left: number, top: number, right: number, bottom: number): TargetRect {
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top }
}

/** Rejects disconnected, inaccessible, clipped and frame-content targets before presenting. */
export function measureTargetGeometry(element: HTMLElement, padding = 8): TargetGeometry | null {
  if (!element.isConnected) return null
  const view = element.ownerDocument.defaultView
  if (!view || view.frameElement) return null
  const bounds = element.getBoundingClientRect()
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || element.getClientRects().length === 0) return null
  let clipLeft = 0
  let clipTop = 0
  let clipRight = view.innerWidth
  let clipBottom = view.innerHeight
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.hasAttribute?.('inert')
      || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || style.contentVisibility === 'hidden' || style.opacity === '0') return null
    if (node === element) continue
    const clipsX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX || style.overflow)
    const clipsY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY || style.overflow)
    if (!clipsX && !clipsY) continue
    const box = node.getBoundingClientRect()
    const scaleX = node.offsetWidth > 0 ? box.width / node.offsetWidth : 1
    const scaleY = node.offsetHeight > 0 ? box.height / node.offsetHeight : 1
    if (clipsX) {
      const left = box.left + (node.clientLeft || 0) * scaleX
      clipLeft = Math.max(clipLeft, left)
      clipRight = Math.min(clipRight, left + node.clientWidth * scaleX)
    }
    if (clipsY) {
      const top = box.top + (node.clientTop || 0) * scaleY
      clipTop = Math.max(clipTop, top)
      clipBottom = Math.min(clipBottom, top + node.clientHeight * scaleY)
    }
  }
  // Small subpixel rounding differences are permitted; visibly clipped controls are not.
  if (bounds.left < clipLeft - 0.5 || bounds.top < clipTop - 0.5
    || bounds.right > clipRight + 0.5 || bounds.bottom > clipBottom + 0.5) return null
  // Content from a native web host is never traversed. Hit testing stays in the host document.
  if (typeof element.ownerDocument.elementsFromPoint === 'function') {
    const hit = element.ownerDocument.elementsFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      .find((node) => !node.closest('[data-product-tour-overlay], [data-product-tour-popover]'))
    if (hit && !element.contains(hit) && !hit.contains(element)) return null
  }
  const measured = rect(bounds.left, bounds.top, bounds.right, bounds.bottom)
  const inset = Math.max(0, padding)
  return { viewport: { width: view.innerWidth, height: view.innerHeight }, rect: measured, spotlightRect: rect(Math.max(0, measured.left - inset), Math.max(0, measured.top - inset), Math.min(view.innerWidth, measured.right + inset), Math.min(view.innerHeight, measured.bottom + inset)) }
}
