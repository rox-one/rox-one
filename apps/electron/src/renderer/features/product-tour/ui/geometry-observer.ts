import { measureTargetGeometry, type TargetGeometry } from './geometry'

/** Exists only during presentation. At most one measurement runs per animation frame. */
export function observeTargetGeometry(element: HTMLElement, onChange: (geometry: TargetGeometry | null) => void): () => void {
  const document = element.ownerDocument
  const view = document.defaultView
  if (!view) return () => {}
  let frame: number | null = null
  let disposed = false
  const transitions = new Map<Element, Map<string, number>>()
  const schedule = () => {
    if (disposed || frame !== null) return
    frame = view.requestAnimationFrame(() => {
      frame = null
      if (disposed) return
      onChange(measureTargetGeometry(element))
      if (transitions.size) {
        const now = view.performance.now()
        for (const [node, properties] of transitions) {
          for (const [property, expiresAt] of properties) {
            if (!node.isConnected || now > expiresAt) properties.delete(property)
          }
          if (!properties.size) transitions.delete(node)
        }
        if (transitions.size) schedule()
      }
    })
  }
  const constructors = view as Window & typeof globalThis
  const resize = typeof constructors.ResizeObserver === 'function' ? new constructors.ResizeObserver(schedule) : null
  const inTourPortal = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest('[data-product-tour-portal]') !== null
  const onMutation = (records: MutationRecord[] = []) => {
    // Popup positioning writes cannot change app layout and must not feed the observer back into itself.
    if (!records.length || records.some((record) => !inTourPortal(record.target))) schedule()
  }
  const mutation = typeof constructors.MutationObserver === 'function' ? new constructors.MutationObserver(onMutation) : null
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    resize?.observe(node)
    mutation?.observe(node, { attributes: true, childList: true, characterData: true, subtree: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'inert'] })
  }
  const onTransitionRun = (event: TransitionEvent) => {
    const node = event.target as Element
    if (!node || node.nodeType !== 1 || inTourPortal(node)) return
    // A sibling sidebar/toolbar transition can move the target without resizing it or its ancestors.
    if (!/^(transform|translate|scale|rotate|width|height|min-|max-|left|right|top|bottom|inset|flex|gap|padding|margin|grid)/.test(event.propertyName)) return
    const style = view.getComputedStyle(node)
    const milliseconds = (list: string) => list.split(',').map((value) => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)).filter(Number.isFinite)
    const duration = Math.max(0, ...milliseconds(style.transitionDuration)) + Math.max(0, ...milliseconds(style.transitionDelay))
    const properties = transitions.get(node) ?? new Map<string, number>()
    properties.set(event.propertyName, view.performance.now() + duration + 100)
    transitions.set(node, properties)
    schedule()
  }
  const onTransitionEnd = (event: TransitionEvent) => {
    const node = event.target as Element
    const properties = transitions.get(node)
    properties?.delete(event.propertyName)
    if (properties && !properties.size) transitions.delete(node)
    schedule()
  }
  document.addEventListener('transitionrun', onTransitionRun, true)
  document.addEventListener('transitionend', onTransitionEnd, true)
  document.addEventListener('transitioncancel', onTransitionEnd, true)
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
    transitions.clear()
    document.removeEventListener('transitionrun', onTransitionRun, true)
    document.removeEventListener('transitionend', onTransitionEnd, true)
    document.removeEventListener('transitioncancel', onTransitionEnd, true)
    view.removeEventListener('resize', schedule)
    document.removeEventListener('scroll', schedule, true)
    view.visualViewport?.removeEventListener('resize', schedule)
    view.visualViewport?.removeEventListener('scroll', schedule)
  }
}
