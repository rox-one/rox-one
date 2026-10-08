/**
 * Marks `<html data-resizing>` while a pane resize is in progress
 * (UI-A1, rox-one#1567). tokens/motion.css zeroes the motion durations under
 * `html[data-resizing]`, so layout transitions don't lag behind the pointer.
 *
 * Ref-counted: several sashes (or a sash and its resize hook) may hold the
 * flag at once; it is removed when the last holder releases it, and on unmount.
 */

import * as React from 'react'

export const RESIZING_ATTRIBUTE = 'data-resizing'

interface ResizingRoot {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

const holders = new WeakMap<ResizingRoot, number>()

/** Adds the flag to `root` (default: documentElement); returns an idempotent release. */
export function acquireDocumentResizing(
  root: ResizingRoot | null = typeof document === 'undefined' ? null : document.documentElement,
): () => void {
  if (!root) return () => {}
  const count = (holders.get(root) ?? 0) + 1
  holders.set(root, count)
  if (count === 1) root.setAttribute(RESIZING_ATTRIBUTE, '')
  let released = false
  return () => {
    if (released) return
    released = true
    const next = (holders.get(root) ?? 1) - 1
    if (next > 0) {
      holders.set(root, next)
      return
    }
    holders.delete(root)
    root.removeAttribute(RESIZING_ATTRIBUTE)
  }
}

/** Holds `html[data-resizing]` while `active` is true; released on end and unmount. */
export function useDocumentResizingFlag(active: boolean): void {
  React.useEffect(() => {
    if (!active) return
    return acquireDocumentResizing()
  }, [active])
}
