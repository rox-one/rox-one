import * as React from 'react'

/**
 * Marks a scroll container with `data-scroll-down="true"` while content remains
 * below the fold (WP5 sidebar: the bottom fade + footer divider show only then,
 * so the last rows never sit faded above a pinned footer). Imperative on purpose:
 * no React state, so scrolling never re-renders the owner (AppShell).
 */
export function useScrollEdgeAttribute(): React.RefCallback<HTMLElement> {
  const cleanup = React.useRef<(() => void) | null>(null)
  return React.useCallback((element: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!element) return
    const update = () => {
      const more = element.scrollHeight - element.scrollTop - element.clientHeight > 1
      element.dataset.scrollDown = more ? 'true' : 'false'
    }
    // One layout read per frame at most: scroll, resize and DOM insertions
    // (count updates, row mounts) all coalesce into a single rAF.
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }
    update()
    element.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(element)
    for (const child of Array.from(element.children)) observer?.observe(child)
    // Direct children only: a section mounting/unmounting changes the height
    // the ResizeObserver above may not be watching yet.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(node => { if (node instanceof Element) observer?.observe(node) })
      schedule()
    })
    mutations?.observe(element, { childList: true })
    cleanup.current = () => {
      if (frame) cancelAnimationFrame(frame)
      element.removeEventListener('scroll', schedule)
      observer?.disconnect()
      mutations?.disconnect()
    }
  }, [])
}
