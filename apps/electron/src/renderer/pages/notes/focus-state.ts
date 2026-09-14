/** Modal aria-hidden on the app root must not be mistaken for a hidden workspace tile. */
export function isNotesPanelUnavailable(element: HTMLElement | null): boolean {
  if (!element?.isConnected || element.ownerDocument.visibilityState === 'hidden') return true
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.inert || current.style.display === 'none' || current.style.visibility === 'hidden'
      || current.style.contentVisibility === 'hidden') return true
    const style = element.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden') return true
  }
  return false
}

export function canFocusNotesControl(element: HTMLElement | null): element is HTMLElement {
  return !!element && !isNotesPanelUnavailable(element)
    && !element.closest('[aria-hidden="true"]') && element.getClientRects().length > 0
}
