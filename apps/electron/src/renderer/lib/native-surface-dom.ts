import { isValidNativeBounds, type NativeBoundsRect } from './native-surface-visibility'
import { nativeSurfaceOwners } from './native-surface-owners'

export type NativeSurfaceDOMState = 'visible' | 'hidden' | 'clipped'
export interface NativeSurfaceAncestor {
  hidden: boolean
  rect: NativeBoundsRect
  clipX: boolean
  clipY: boolean
}

const ROUNDING_TOLERANCE = 1

/** Native views cannot inherit renderer clipping. Hide a clipped view intact. */
export function resolveNativeSurfaceDOMBounds(input: {
  rect: NativeBoundsRect | null
  viewport: NativeBoundsRect
  documentVisible: boolean
  ancestors: NativeSurfaceAncestor[]
}): { state: NativeSurfaceDOMState; rect: NativeBoundsRect | null } {
  if (!input.documentVisible || !input.rect || input.ancestors.some(ancestor => ancestor.hidden)) {
    return { state: 'hidden', rect: null }
  }
  const rect = input.rect
  if (!isValidNativeBounds(rect)) return { state: 'clipped', rect: null }
  const clipping = [{ rect: input.viewport, clipX: true, clipY: true }, ...input.ancestors]
  for (const clip of clipping) {
    if ((clip.clipX && (rect.x < clip.rect.x - ROUNDING_TOLERANCE
      || rect.x + rect.width > clip.rect.x + clip.rect.width + ROUNDING_TOLERANCE))
      || (clip.clipY && (rect.y < clip.rect.y - ROUNDING_TOLERANCE
        || rect.y + rect.height > clip.rect.y + clip.rect.height + ROUNDING_TOLERANCE))) {
      return { state: 'clipped', rect: null }
    }
  }
  return { state: 'visible', rect }
}

const clips = (overflow: string) => /^(auto|scroll|hidden|clip|overlay)$/.test(overflow)

/** No style resolution or layout reads: safe on every lifecycle invalidation. */
export function isNativeSurfaceExplicitlyHidden(element: HTMLElement | null): boolean {
  if (!element?.isConnected || element.ownerDocument.visibilityState === 'hidden') return true
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true'
      || current.style.display === 'none' || current.style.visibility === 'hidden'
      || current.style.visibility === 'collapse' || current.style.contentVisibility === 'hidden'
      || current.style.opacity === '0') return true
  }
  return false
}

/** Reads visibility from the actual ancestors, including focus/compact inert slots. */
export function readNativeSurfaceDOMBounds(element: HTMLElement | null): ReturnType<typeof resolveNativeSurfaceDOMBounds> {
  if (!element?.isConnected) return { state: 'hidden', rect: null }
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view) return { state: 'hidden', rect: null }
  const ancestors: NativeSurfaceAncestor[] = []
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current)
    const box = current.getBoundingClientRect()
    ancestors.push({
      hidden: current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden' || style.opacity === '0',
      rect: { x: box.x + current.clientLeft, y: box.y + current.clientTop, width: current.clientWidth, height: current.clientHeight },
      // The host's own border box is the requested native area; only ancestors clip it.
      clipX: current !== element && clips(style.overflowX),
      clipY: current !== element && clips(style.overflowY),
    })
  }
  const box = element.getBoundingClientRect()
  return resolveNativeSurfaceDOMBounds({
    rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
    viewport: { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight },
    documentVisible: doc.visibilityState !== 'hidden',
    ancestors,
  })
}

/** Scroll does not resize a host; observe it and layout/visibility changes explicitly. */
export function observeNativeSurfaceDOM(element: HTMLElement, onChange: () => void, observeOverlays: () => boolean = () => true): () => void {
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view) return () => {}
  const resize = new ResizeObserver(onChange)
  for (let current: HTMLElement | null = element; current; current = current.parentElement) resize.observe(current)
  // Only ancestor attributes can hide or move this host. Editor subtree style
  // mutations are not geometry invalidations for every native pane.
  const overlay = new MutationObserver(onChange)
  let watchingOverlays = false
  const refreshOverlays = () => {
    const wanted = observeOverlays() && !isNativeSurfaceExplicitlyHidden(element)
    if (wanted === watchingOverlays) return
    watchingOverlays = wanted
    if (wanted) overlay.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] })
    else overlay.disconnect()
  }
  const invalidateLifecycle = () => {
    refreshOverlays()
    onChange()
  }
  const mutation = new MutationObserver(invalidateLifecycle)
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    mutation.observe(current, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'inert', 'style'],
      childList: true,
    })
  }
  refreshOverlays()
  view.addEventListener('resize', onChange)
  doc.addEventListener('scroll', onChange, true)
  doc.addEventListener('visibilitychange', invalidateLifecycle)
  doc.addEventListener('transitionend', onChange, true)
  return () => {
    resize.disconnect()
    mutation.disconnect()
    overlay.disconnect()
    view.removeEventListener('resize', onChange)
    doc.removeEventListener('scroll', onChange, true)
    doc.removeEventListener('visibilitychange', invalidateLifecycle)
    doc.removeEventListener('transitionend', onChange, true)
  }
}

/** At most one geometry read per frame, with immediate cheap hiding and cancellation. */
export function createNativeSurfaceInvalidator(options: {
  paused: () => boolean
  hide: () => void
  measure: () => void
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (id: number) => void
}) {
  let alive = true
  let frame: number | null = null
  let generation = 0
  const cancel = () => {
    generation++
    if (frame !== null) options.cancelFrame(frame)
    frame = null
  }
  return {
    invalidate() {
      if (!alive) return
      if (options.paused()) {
        cancel()
        options.hide()
        return
      }
      if (frame !== null) return
      const scheduledGeneration = generation
      frame = options.requestFrame(() => {
        if (!alive || generation !== scheduledGeneration) return
        frame = null
        if (options.paused()) options.hide()
        else options.measure()
      })
    },
    dispose() {
      alive = false
      cancel()
    },
  }
}

/** Per-instance cleanup: never enumerate or hide sibling native surfaces. */
export function releaseNativeSurface(
  instanceId: string,
  sync: (instanceId: string, rect: NativeBoundsRect | null) => Promise<unknown>,
): Promise<void> {
  return nativeSurfaceOwners.hideUnowned(instanceId, sync)
}
