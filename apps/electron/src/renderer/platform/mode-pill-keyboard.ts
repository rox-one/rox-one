import type { KeyboardEvent } from 'react'

/** Page navigation keeps native Tab traversal; arrows offer a shorter path. */
export function handleModePillKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.nativeEvent.isComposing) return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]')
  if (!target || !event.currentTarget.contains(target)) return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-mode]:not([aria-disabled="true"])'))
  const currentIndex = buttons.indexOf(target)
  if (currentIndex < 0 || buttons.length === 0) return

  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
  const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? buttons.length - 1
      : (currentIndex + step + buttons.length) % buttons.length
  event.preventDefault()
  buttons[nextIndex]?.focus()
}
