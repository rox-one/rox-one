/**
 * W1-08 (#1505) test helper: a happy-dom window installed on globalThis so
 * React DOM, TipTap and axe-core run inside `bun test`.
 *
 * Usage: import this module first (it installs on import, see below), then
 * call `useDomForFile()` at the top level of the test file. That registers an
 * `afterAll` which restores every global this helper replaced (window,
 * document, navigator, localStorage, DOM classes, IS_REACT_ACT_ENVIRONMENT),
 * so suites that run later in the same `bun test` process see the original
 * environment again. `resetDom()` clears the body between cases.
 *
 * The repo runner (`bun run test`) runs one process per file, so this is
 * belt-and-braces for ad-hoc multi-file `bun test` runs.
 */
import { afterAll } from 'bun:test'
import { Window } from 'happy-dom'

const GLOBAL_KEYS = [
  'window', 'document', 'navigator', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'DocumentFragment', 'NodeList',
  'HTMLCollection', 'MutationObserver', 'getComputedStyle', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
  'FocusEvent', 'InputEvent', 'CustomEvent', 'DragEvent', 'DataTransfer', 'Range', 'Selection', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'ClipboardEvent', 'ResizeObserver', 'IntersectionObserver',
  'CSS', 'XMLSerializer', 'DOMRect', 'ShadowRoot', 'HTMLDivElement', 'HTMLSpanElement', 'Image', 'File', 'FileReader',
  'customElements', 'matchMedia', 'localStorage', 'sessionStorage',
] as const

/** One window per process; re-installed (same instance) by later files. */
let win: Window | null = null
let active = false
/** Original descriptors of the globals we replaced (undefined = was absent). */
const saved = new Map<string, PropertyDescriptor | undefined>()
let savedActEnv: { present: boolean; value: unknown } | null = null

/**
 * Other test files in the same `bun test` process may leave a global defined
 * via `Object.defineProperty` without `writable` (read-only but configurable),
 * so plain assignment would throw. Redefine instead.
 */
function setGlobal(g: Record<string, unknown>, key: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(g, key)
  if (!descriptor || descriptor.configurable) {
    if (!saved.has(key)) saved.set(key, descriptor)
    Object.defineProperty(g, key, { configurable: true, enumerable: true, writable: true, value })
  } else if (descriptor.writable || descriptor.set) {
    if (!saved.has(key)) saved.set(key, descriptor)
    g[key] = value
  }
}

export function installDom(): Window {
  if (!win) win = new Window({ url: 'http://localhost/', width: 1280, height: 800 })
  if (active) return win
  const g = globalThis as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    if (key === 'window') { setGlobal(g, 'window', win); continue }
    const value = (win as unknown as Record<string, unknown>)[key]
    if (value === undefined) continue
    // DOM classes (incl. Event/CustomEvent) must come from happy-dom so
    // dispatchEvent accepts them; Bun's own globals are replaced in tests.
    if (/^[A-Z]/.test(key) || key === 'document' || g[key] === undefined) {
      setGlobal(g, key, typeof value === 'function' && /^[a-z]/.test(key) ? (value as Function).bind(win) : value)
    }
  }
  setGlobal(g, 'document', win.document)
  savedActEnv = { present: 'IS_REACT_ACT_ENVIRONMENT' in g, value: g.IS_REACT_ACT_ENVIRONMENT }
  ;(g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  active = true
  return win
}

/** Restore every global replaced by `installDom()`. Idempotent. */
export function uninstallDom(): void {
  if (!active) return
  const g = globalThis as Record<string, unknown>
  if (win) win.document.body.innerHTML = ''
  for (const [key, descriptor] of saved) {
    const current = Object.getOwnPropertyDescriptor(g, key)
    if (current && !current.configurable) {
      if (current.writable || current.set) g[key] = descriptor && 'value' in descriptor ? descriptor.value : undefined
      continue
    }
    if (descriptor) Object.defineProperty(g, key, descriptor)
    else delete g[key]
  }
  saved.clear()
  if (savedActEnv) {
    if (savedActEnv.present) g.IS_REACT_ACT_ENVIRONMENT = savedActEnv.value
    else delete g.IS_REACT_ACT_ENVIRONMENT
    savedActEnv = null
  }
  active = false
}

/** True while the happy-dom globals are installed. */
export function isDomInstalled(): boolean {
  return active
}

/**
 * Install for this test file and restore the original globals after it.
 * Call at the top level of every test file that needs the DOM.
 */
export function useDomForFile(): Window {
  const window = installDom()
  afterAll(() => { uninstallDom() })
  return window
}

export function resetDom(): void {
  if (win && active) win.document.body.innerHTML = ''
}

// Install on import: ES imports are hoisted, so modules such as react-dom
// (which feature-detect `document` at load time) must see the DOM already.
// Caveat: Bun may evaluate CommonJS dependencies such as react-dom before this
// module body runs, so React can still pick its input-event polyfill; tests
// focus an input before dispatching key events to it.
installDom()
