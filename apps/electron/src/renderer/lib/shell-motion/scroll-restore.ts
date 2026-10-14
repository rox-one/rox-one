/**
 * Per-route scroll restoration (top-50 #5). Scroll positions of any scrolled
 * element inside a panel are remembered per route and restored when the panel
 * returns to that route. Elements are identified by `data-scroll-key` when
 * present, otherwise by their child-index path from the panel root.
 */
import * as React from 'react'

const MAX_ROUTES = 200
const store = new Map<string, Map<string, number>>()

function remember(route: string, key: string, top: number) {
  let entry = store.get(route)
  if (!entry) {
    entry = new Map()
    store.set(route, entry)
    if (store.size > MAX_ROUTES) store.delete(store.keys().next().value as string)
  }
  if (top <= 0) entry.delete(key)
  else entry.set(key, top)
}

export function elementKey(root: Element, el: Element): string | null {
  const explicit = el.getAttribute('data-scroll-key')
  if (explicit) return `k:${explicit}`
  const parts: number[] = []
  let node: Element | null = el
  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) return null
    parts.push(Array.prototype.indexOf.call(parent.children, node))
    node = parent
  }
  return node === root ? `p:${parts.reverse().join('.')}` : null
}

export function resolveKey(root: Element, key: string): HTMLElement | null {
  if (key.startsWith('k:')) return root.querySelector<HTMLElement>(`[data-scroll-key="${CSS.escape(key.slice(2))}"]`)
  let node: Element | undefined = root
  for (const index of key.slice(2).split('.').filter(Boolean)) {
    node = node?.children[Number(index)]
    if (!node) return null
  }
  return node === root ? null : (node as HTMLElement)
}

/** Read-only view for tests. */
export function __scrollMemory(route: string): ReadonlyMap<string, number> | undefined { return store.get(route) }
export function __resetScrollMemory() { store.clear() }

export function useRouteScrollRestore(ref: React.RefObject<HTMLElement | null>, route: string): void {
  const routeRef = React.useRef(route)
  routeRef.current = route

  React.useEffect(() => {
    const root = ref.current
    if (!root) return
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element) || !root.contains(target)) return
      const key = elementKey(root, target)
      if (key) remember(routeRef.current, key, target.scrollTop)
    }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', onScroll, { capture: true })
  }, [ref])

  React.useEffect(() => {
    const root = ref.current
    const saved = store.get(route)
    if (!root || !saved || saved.size === 0) return
    // Content may render a few frames later (lists, lazy pages): retry briefly.
    let frames = 0
    let handle = 0
    const pending = new Map(saved)
    const attempt = () => {
      for (const [key, top] of pending) {
        const el = resolveKey(root, key)
        if (el && el.scrollHeight - el.clientHeight >= top) { el.scrollTop = top; pending.delete(key) }
      }
      if (pending.size > 0 && ++frames < 20) handle = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(handle)
  }, [ref, route])
}
