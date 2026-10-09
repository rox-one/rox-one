import type { KeyboardEvent } from 'react'

/**
 * Pure roving-index helper for the mode pill. Returns the index the focus
 * should move to, or `null` when the key is not a navigation key. Handles RTL
 * (ArrowLeft/Right swap) and wraps; Home/End jump to the ends.
 */
export function modePillNavIndex(
  key: string,
  currentIndex: number,
  count: number,
  rtl: boolean,
): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (count === 1) return currentIndex < 0 ? 0 : currentIndex
      const step = (key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)
      const base = currentIndex < 0 ? 0 : currentIndex
      return (base + step + count) % count
    }
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** Enter / Space activate the focused pill item (buttons do not self-activate via roving). */
export function isModePillActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}

/** Page navigation keeps native Tab traversal; arrows offer a shorter path. */
export function handleModePillKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.nativeEvent.isComposing) return

  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]')
  if (!target || !event.currentTarget.contains(target)) return

  if (isModePillActivationKey(event.key)) {
    event.preventDefault()
    target.click()
    return
  }

  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-mode]:not([aria-disabled="true"])'),
  )
  const currentIndex = buttons.indexOf(target)
  if (currentIndex < 0) return

  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
  const nextIndex = modePillNavIndex(event.key, currentIndex, buttons.length, rtl)
  if (nextIndex === null) return

  event.preventDefault()
  buttons[nextIndex]?.focus()
}