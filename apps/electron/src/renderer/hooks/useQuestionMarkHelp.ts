import { useEffect, useRef } from 'react'

/**
 * Demo borrowing #48: a bare `?` opens the help (shortcuts + glossary) when
 * the user is not typing. `mod+/` stays the registry shortcut.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  return el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"], .xterm') !== null
}

export function isHelpKeyEvent(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'isComposing' | 'defaultPrevented' | 'target'>): boolean {
  if (event.key !== '?') return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (event.repeat || event.isComposing || event.defaultPrevented) return false
  return !isEditableTarget(event.target)
}

export function useQuestionMarkHelp(onOpen: () => void, enabled = true): void {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isHelpKeyEvent(event)) return
      // Another modal owns the keyboard; don't stack help on top of it.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      event.preventDefault()
      onOpenRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
