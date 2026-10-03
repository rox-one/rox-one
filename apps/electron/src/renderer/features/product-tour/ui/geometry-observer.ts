import { measureTargetGeometry, type TargetGeometry } from './geometry'

/** Exists only during presentation. At most one measurement runs per animation frame. */
export function observeTargetGeometry(element: HTMLElement, onChange: (geometry: TargetGeometry | null) => void): () => void {
  const document = element.ownerDocument
  const view = document.defaultView
  if (!view) return () => {}
  let frame: number | null = null
  let disposed = false
  const schedule = () => {
    if (disposed || frame !== null) return
    frame = view.requestAnimationFrame(() => {
      frame = null
      if (!disposed) onChange(measureTargetGeometry(element))
    })
  }
  const constructors = view as Window & typeof globalThis
  const resize = typeof constructors.ResizeObserver === 'function' ? new constructors.ResizeObserver(schedule) : null
  const mutation = typeof constructors.MutationObserver === 'function' ? new constructors.MutationObserver(schedule) : null
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    resize?.observe(node)
    mutation?.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'inert'] })
  }
  view.addEventListener('resize', schedule)
  document.addEventListener('scroll', schedule, true)
  view.visualViewport?.addEventListener('resize', schedule)
  view.visualViewport?.addEventListener('scroll', schedule)
  schedule()
  return () => {
    if (disposed) return
    disposed = true
    if (frame !== null) view.cancelAnimationFrame(frame)
    frame = null
    resize?.disconnect()
    mutation?.disconnect()
    view.removeEventListener('resize', schedule)
    document.removeEventListener('scroll', schedule, true)
    view.visualViewport?.removeEventListener('resize', schedule)
    view.visualViewport?.removeEventListener('scroll', schedule)
  }
}
