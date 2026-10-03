/** A mounted page may be hidden behind another tool. Its shortcuts have no authority there. */
export function panelOwnsKeyboardTarget(
  ownerPanelId: string | null | undefined,
  focusedPanelId: string | null,
  target: EventTarget | null,
): boolean {
  if (!ownerPanelId || ownerPanelId !== focusedPanelId || !target || typeof (target as Element).closest !== 'function') return false
  const element = target as Element
  const panel = element.closest<HTMLElement>('[data-panel-id]')
  if (!panel || panel.dataset.panelId !== ownerPanelId || !panel.isConnected) return false
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  if (panel.getClientRects().length === 0) return false
  const browser = panel.ownerDocument.defaultView
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = browser?.getComputedStyle(ancestor)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false
  }
  return true
}
