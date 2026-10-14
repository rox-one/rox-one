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

/** Last focused field plus its caret, saved when dictation starts. */
export interface InsertCapture {
  target: InsertTarget
  /** Inputs / textareas: saved selection offsets. */
  selectionStart?: number
  selectionEnd?: number
  /** Contenteditable / rich-text: saved range (only when inside the target). */
  range?: Range
}

function windowFocused(doc: Document): boolean {
  return typeof doc.hasFocus === 'function' ? doc.hasFocus() : true
}

/** Connected, rendered and not inside a hidden / inert / aria-hidden subtree. */
export function isVisibleTarget(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const check = (el as HTMLElement & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility
  if (typeof check === 'function' && !check.call(el, { visibilityProperty: true })) return false
  const view = el.ownerDocument.defaultView
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false
    const style = view?.getComputedStyle?.(node)
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
  }
  return true
}

/**
 * The focused editable element and its caret, or null. Only when the Rox window
 * itself has focus: a global hotkey pressed from another app must not target a
 * stale field (the caller then falls back to the new-session draft).
 */
export function captureInsertTarget(doc: Document = document, focused: boolean = windowFocused(doc)): InsertCapture | null {
  if (!focused) return null
  const active = doc.activeElement
  if (!isInsertableElement(active) || !isVisibleTarget(active)) return null
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return { target: active, selectionStart: active.selectionStart ?? undefined, selectionEnd: active.selectionEnd ?? undefined }
  }
  const selection = doc.getSelection()
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    if (active.contains(range.commonAncestorContainer)) return { target: active, range: range.cloneRange() }
  }
  return { target: active }
}

/**
 * Insert `text` at the saved caret of the captured field. Returns false (caller
 * falls back to the session draft) when the Rox window is not focused, or the
 * field is gone, hidden or no longer editable.
 */
export function insertDictation(capture: InsertCapture | null, text: string, focused?: boolean): boolean {
  if (!capture || !text) return false
  const { target } = capture
  const doc = target.ownerDocument
  if (!(focused ?? windowFocused(doc))) return false
  if (!target.isConnected || !isInsertableElement(target) || !isVisibleTarget(target)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const length = target.value.length
    const clamp = (n: number | undefined | null, fallback: number) => Math.min(Math.max(0, n ?? fallback), length)
    const start = clamp(capture.selectionStart, target.selectionStart ?? length)
    const end = Math.max(start, clamp(capture.selectionEnd, start))
    const before = target.value.slice(0, start)
    const spaced = before && !/\s$/.test(before) ? ` ${text}` : text
    target.focus({ preventScroll: true })
    target.setRangeText(spaced, start, end, 'end')
    // React-controlled inputs listen for `input`.
    target.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  target.focus({ preventScroll: true })
  const selection = doc.getSelection()
  // Restore the caret saved at capture time; focus() alone does not.
  const saved = capture.range
  if (selection && saved && target.contains(saved.commonAncestorContainer) && saved.startContainer.isConnected) {
    selection.removeAllRanges()
    selection.addRange(saved)
  }
  // Never insert outside the target: if the live selection escaped, put the caret at its end.
  if (selection && (selection.rangeCount === 0 || !target.contains(selection.getRangeAt(0).commonAncestorContainer))) {
    const end = doc.createRange()
    end.selectNodeContents(target)
    end.collapse(false)
    selection.removeAllRanges()
    selection.addRange(end)
  }
  // execCommand keeps the editor's undo stack (TipTap/ProseMirror handle it).
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to insert into contenteditable with undo support
  if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)) return true
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  range.deleteContents()
  range.insertNode(doc.createTextNode(text))
  range.collapse(false)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  return true
}
