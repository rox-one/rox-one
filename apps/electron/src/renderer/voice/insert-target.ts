/**
 * Global dictation → active field (top-50 #12). When ⌘-dictation starts while
 * a text field outside the chat composer has focus (a note, a task title, a
 * search box), the transcript is inserted at that field's caret instead of
 * opening a new session draft.
 */
export type InsertTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', ''])

export function isInsertableElement(el: Element | null): el is InsertTarget {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.closest('[data-dictation-ignore]')) return false
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has((el.type || '').toLowerCase())
  return el.isContentEditable
}

/** The focused editable element right now, or null. */
export function captureInsertTarget(doc: Document = document): InsertTarget | null {
  const active = doc.activeElement
  return isInsertableElement(active) ? active : null
}

/**
 * Insert `text` at the caret of `target`. Returns false when the target is
 * gone or no longer editable (caller falls back to the session draft).
 */
export function insertDictation(target: InsertTarget | null, text: string): boolean {
  if (!target || !target.isConnected || !isInsertableElement(target) || !text) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? start
    const before = target.value.slice(0, start)
    const spaced = before && !/\s$/.test(before) ? ` ${text}` : text
    target.focus()
    target.setRangeText(spaced, start, end, 'end')
    // React-controlled inputs listen for `input`.
    target.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  target.focus()
  const doc = target.ownerDocument
  // execCommand keeps the editor's undo stack (TipTap/ProseMirror handle it).
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to insert into contenteditable with undo support
  if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)) return true
  const selection = doc.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  range.deleteContents()
  range.insertNode(doc.createTextNode(text))
  range.collapse(false)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  return true
}
