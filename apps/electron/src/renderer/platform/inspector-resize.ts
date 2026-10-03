import type { ResizeBounds } from '@/components/app-shell/resize-controller'
import { KEYBOARD_RESIZE_LARGE_STEP, KEYBOARD_RESIZE_STEP } from '@/components/app-shell/resize-math'

/** Preserve the current 72% viewport cap and center-column priority. */
export function inspectorResizeLimit(viewportWidth: number, availableWidth: number, overlay: boolean): number {
  return Math.max(280, Math.min(1400, Math.floor(viewportWidth * 0.72), overlay ? Infinity : availableWidth))
}

export function inspectorResizeBounds(width: number, viewportWidth: number, maxWidth: number): ResizeBounds {
  const total = Math.max(viewportWidth, maxWidth)
  return { leftId: 'center', rightId: 'inspector', total, sizeA: total - width,
    minA: total - maxWidth, maxA: total - 280, minB: 280, maxB: maxWidth }
}

export function inspectorResizeWidthForKey(key: string, shift: boolean, width: number, maxWidth: number): number | null {
  const step = shift ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP
  const next = key === 'ArrowLeft' ? width + step : key === 'ArrowRight' ? width - step
    : key === 'Home' ? 280 : key === 'End' ? maxWidth : null
  return next === null ? null : Math.min(maxWidth, Math.max(280, next))
}
