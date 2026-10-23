import { useState, useEffect, type RefObject } from 'react'

/**
 * Tracks the inline-size (width) of a DOM element using ResizeObserver.
 *
 * Used by AppShell to derive `isAutoCompact` — when the shell container
 * is narrower than the mobile threshold, sidebar/navigator auto-collapse
 * and panels switch to single-panel mode.
 *
 * Returns 0 until the element is first measured.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentBoxSize[0].inlineSize)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return width
}

/**
 * Border-box inline size. Prefer this when classifying shell bands that also
 * apply padding: content-box shrinks with padding and would oscillate at the
 * wide/ultra thresholds; the flex-allocated border box stays put.
 */
export function useContainerBorderWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const read = (entry?: ResizeObserverEntry) => {
      const fromRo = entry?.borderBoxSize?.[0]?.inlineSize
      setWidth(typeof fromRo === 'number' ? fromRo : el.offsetWidth)
    }
    const ro = new ResizeObserver(([entry]) => read(entry))
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [ref])

  return width
}
