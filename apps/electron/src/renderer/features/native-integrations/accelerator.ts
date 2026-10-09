/**
 * Accelerator capture for the quick-composer global shortcut.
 *
 * Pure translation from a DOM keyboard event to an Electron accelerator
 * string, plus the "is this a usable global shortcut?" check the settings row
 * uses to enable its Save button. Kept dependency-free so it is unit-testable.
 */

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Esc: 'Escape',
  Escape: 'Escape',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Plus',
  '`': 'Backquote',
}

/** Modifier keydowns never form an accelerator on their own. */
const MODIFIER_KEYS: Record<string, true> = {
  Meta: true,
  Control: true,
  Alt: true,
  Shift: true,
  AltGraph: true,
  CapsLock: true,
  ContextMenu: true,
}

function mainKey(key: string): string | null {
  if (!key || key in MODIFIER_KEYS) return null
  const named = NAMED_KEYS[key]
  if (named) return named
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  if (key.length === 1) {
    const upper = key.toUpperCase()
    if (/^[A-Z0-9]$/.test(upper)) return upper
  }
  return null
}

/**
 * Build an Electron accelerator from a keydown event, or `null` when the
 * pressed key cannot headline a global shortcut (modifier-only, or a bare
 * letter with no modifier).
 */
export function acceleratorFromKeyboardEvent(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  const key = mainKey(event.key)
  if (!key) return null
  const parts: string[] = []
  if (event.metaKey) parts.push('Command')
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  // A global shortcut must carry a real modifier or it would swallow plain typing.
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null
  parts.push(key)
  return parts.join('+')
}

/** Human-readable form of an Electron accelerator for the settings row. */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return '⌘/Ctrl'
        case 'Command':
        case 'Cmd':
          return '⌘'
        case 'Control':
        case 'Ctrl':
          return '⌃'
        case 'Alt':
        case 'Option':
          return '⌥'
        case 'Shift':
          return '⇧'
        case 'Return':
          return '↵'
        case 'Super':
          return '⌘'
        default:
          return part
      }
    })
    .join('')
}