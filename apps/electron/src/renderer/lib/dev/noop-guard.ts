/**
 * Dev-only dead-control guard (demo borrowing #41).
 *
 * In development builds a capture-phase click listener checks whether the
 * clicked control (button / role=button / link without href) has any React
 * interaction handler on itself or an ancestor. If none is found the control
 * is outlined and a console warning names it, so "buttons that do nothing"
 * are caught during QA. Production builds never install the listener.
 */

const CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="tab"], a:not([href])'
const HANDLER_PROPS = ['onClick', 'onClickCapture', 'onPointerDown', 'onPointerUp', 'onMouseDown', 'onMouseUp', 'onKeyDown', 'onSelect'] as const
export const NOOP_ATTR = 'data-noop-control'

type PropsBag = Record<string, unknown>

/** React stores the current props on DOM nodes under a `__reactProps$<hash>` key. */
export function readReactProps(node: Element): PropsBag | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith('__reactProps$')) {
      const value = (node as unknown as Record<string, unknown>)[key]
      return value && typeof value === 'object' ? (value as PropsBag) : null
    }
  }
  return null
}

function hasHandler(props: PropsBag | null): boolean {
  if (!props) return false
  return HANDLER_PROPS.some((name) => typeof props[name] === 'function')
}

function isInert(control: Element): boolean {
  if (control.matches(':disabled, [aria-disabled="true"]')) return true
  // Native submit/reset buttons are handled by their form.
  if (control instanceof HTMLButtonElement && control.form && control.type !== 'button') return true
  // <label>-wrapped controls toggle their input natively.
  if (control.closest('label')) return true
  return false
}

/**
 * Returns the dead control for a click target, or null when the target is
 * not a control, is inert, or something up the tree handles the click.
 */
export function findDeadControl(target: EventTarget | null): Element | null {
  if (!target || typeof (target as Element).closest !== 'function') return null
  const control = (target as Element).closest(CONTROL_SELECTOR)
  if (!control || isInert(control)) return null
  for (let node: Element | null = target as Element; node; node = node.parentElement) {
    if (hasHandler(readReactProps(node))) return null
  }
  return control
}

function describe(control: Element): string {
  const label = control.getAttribute('aria-label') || control.textContent?.trim().slice(0, 60) || ''
  const testId = control.getAttribute('data-testid')
  return [control.tagName.toLowerCase(), testId ? `[data-testid="${testId}"]` : '', label ? `"${label}"` : ''].filter(Boolean).join(' ')
}

let installed = false

/** Install the guard. No-op outside development or when already installed. */
export function installNoopGuard(isDev: boolean = import.meta.env.DEV): () => void {
  if (!isDev || installed || typeof document === 'undefined') return () => {}
  installed = true
  const onClick = (event: MouseEvent) => {
    const control = findDeadControl(event.target)
    if (!control || control.hasAttribute(NOOP_ATTR)) return
    control.setAttribute(NOOP_ATTR, '')
    ;(control as HTMLElement).style.outline = '2px dashed var(--destructive)'
    console.warn(`[noop-guard] Control has no handler: ${describe(control)}`, control)
  }
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    installed = false
  }
}
