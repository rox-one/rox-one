/**
 * Narrow-window second sidebar (top50 #3): while the overlay is open, focus
 * is trapped inside it, Escape closes it and returns focus to the rail toggle,
 * and a pointer press outside (other than on the toggle) closes it.
 */
import * as React from 'react'
import { setNarrowSidebarOverlayOpen } from './shell-prefs'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const TOGGLE = '[data-rail-toggle-sidebar]'
/** Menus/popovers/dialogs render in portals outside the overlay; they own their own keys. */
const PORTAL_LAYER = '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]'

function inForeignLayer(root: HTMLElement, target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  return !!el && !root.contains(el) && !!el.closest(PORTAL_LAYER)
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

export function useNarrowOverlayFocus(ref: React.RefObject<HTMLElement | null>, open: boolean): void {
  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const root = ref.current
    if (!root) return
    const close = (restoreFocus: boolean) => {
      setNarrowSidebarOverlayOpen(false)
      if (restoreFocus) document.querySelector<HTMLElement>(TOGGLE)?.focus()
    }
    const frame = requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) focusables(root)[0]?.focus({ preventScroll: true })
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      // A menu opened from the overlay handles its own Escape/Tab first.
      if (inForeignLayer(root, event.target) || inForeignLayer(root, document.activeElement)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables(root)
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (!active || !root.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || root.contains(target) || target.closest(TOGGLE)) return
      // Menus/popovers opened from the overlay render in portals; keep it open.
      if (target.closest(PORTAL_LAYER)) return
      close(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [ref, open])
}
