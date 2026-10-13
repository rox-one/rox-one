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
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    if (element.firstElementChild) observer?.observe(element.firstElementChild)
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    mutations?.observe(element, { childList: true, subtree: true })
    cleanup.current = () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
      mutations?.disconnect()
    }
  }, [])
}
