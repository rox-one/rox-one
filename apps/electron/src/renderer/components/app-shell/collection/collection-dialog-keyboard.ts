/** Keyboard model for Filter/Display popovers (`role="dialog"`, native buttons). */

export const COLLECTION_DIALOG_ITEM = '[data-collection-dialog-item]'

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function collectionDialogItems(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(COLLECTION_DIALOG_ITEM)).filter((el) => {
    if (el.closest('[hidden]')) return false
    if (el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) return false
    return true
  })
}

export function nextCollectionDialogIndex(
  length: number,
  current: number,
  key: string,
): number | null {
  if (length === 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % length
  if (key === 'ArrowUp') return current < 0 ? length - 1 : (current - 1 + length) % length
  return null
}

export function handleCollectionDialogKeyDown(
  event: Pick<KeyboardEvent, 'key' | 'target' | 'preventDefault'>,
  root: ParentNode,
): HTMLElement | null {
  const target = event.target as HTMLElement | null
  if (target && EDITABLE.has(target.tagName)) return null
  const items = collectionDialogItems(root)
  const currentEl = target?.closest<HTMLElement>(COLLECTION_DIALOG_ITEM) ?? null
  const current = currentEl ? items.indexOf(currentEl) : -1
  const next = nextCollectionDialogIndex(items.length, current, event.key)
  if (next == null) return null
  event.preventDefault()
  const item = items[next] ?? null
  item?.focus()
  return item
}
