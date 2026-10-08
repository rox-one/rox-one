/**
 * W1-08 (#1505) test helper: a happy-dom window installed on globalThis so
 * React DOM, TipTap and axe-core run inside `bun test`.
 *
 * Install once per test file (`installDom()` at module top-level) and keep
 * the returned window; `resetDom()` clears the body between cases.
 */
import { Window } from 'happy-dom'

const GLOBAL_KEYS = [
  'window', 'document', 'navigator', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'DocumentFragment', 'NodeList',
  'HTMLCollection', 'MutationObserver', 'getComputedStyle', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
  'FocusEvent', 'InputEvent', 'CustomEvent', 'DragEvent', 'DataTransfer', 'Range', 'Selection', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'ClipboardEvent', 'ResizeObserver', 'IntersectionObserver',
  'CSS', 'XMLSerializer', 'DOMRect', 'ShadowRoot', 'HTMLDivElement', 'HTMLSpanElement', 'Image', 'File', 'FileReader',
] as const

let installed: Window | null = null

export function installDom(): Window {
  if (installed) return installed
  const win = new Window({ url: 'http://localhost/', width: 1280, height: 800 })
  const g = globalThis as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    if (key === 'window') { g.window = win; continue }
    const value = (win as unknown as Record<string, unknown>)[key]
    if (value !== undefined && g[key] === undefined) g[key] = typeof value === 'function' && /^[a-z]/.test(key) ? (value as Function).bind(win) : value
  }
  g.document = win.document
  ;(g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installed = win
  return win
}

export function resetDom(): void {
  if (installed) installed.document.body.innerHTML = ''
}
