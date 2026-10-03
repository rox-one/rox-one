import type { KeyboardEvent } from 'react'

/** Follow visible controls, including nested disclosures, without trapping Tab. */
export function handleSidebarTreeKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return
  const root = target.closest<HTMLElement>('[data-focus-zone="sidebar"]') ?? event.currentTarget
  const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), summary, a[href]'))
    .filter(item => item.getClientRects().length > 0 && !item.closest('[hidden], [inert], [aria-hidden="true"]'))
    .filter(item => {
      // Chromium can retain layout rects for a closed disclosure's content.
      // Only its own summary remains navigable; an outer folded group hides that too.
      const closed = item.closest('details:not([open])')
      if (!closed) return true
      return item === closed.querySelector(':scope > summary') && !closed.parentElement?.closest('details:not([open])')
    })
  if (!items.length) return
  const index = items.indexOf(target)
  const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (direction || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + direction + items.length) % items.length
    items[next]?.focus()
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const expanded = target.getAttribute('aria-expanded')
    if (expanded !== null && expanded !== String(event.key === 'ArrowRight')) {
      event.preventDefault()
      target.click()
    } else if (target.tagName === 'SUMMARY') {
      const details = target.closest('details')
      if (details) { event.preventDefault(); details.open = event.key === 'ArrowRight' }
    } else if (event.key === 'ArrowLeft') {
      const details = target.closest('details')
      if (details) {
        event.preventDefault()
        details.open = false
        details.querySelector<HTMLElement>('summary')?.focus()
      } else {
        const section = target.closest<HTMLElement>('[id^="sidebar-section-"]')
        const toggle = section ? root.querySelector<HTMLButtonElement>(`[aria-controls="${section.id}"]`) : null
        if (toggle) {
          event.preventDefault()
          toggle.focus()
          if (toggle.getAttribute('aria-expanded') === 'true') toggle.click()
        }
      }
    }
  }
}
