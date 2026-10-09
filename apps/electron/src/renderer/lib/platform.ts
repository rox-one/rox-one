/**
 * Platform Detection Utilities
 *
 * Centralized platform detection for the renderer process.
 * Use these instead of accessing navigator.platform directly.
 *
 * @example
 * import { isMac, isWindows, PATH_SEP, getPathBasename } from '@/lib/platform'
 *
 * // Platform checks
 * const modifier = isMac ? '⌘' : 'Ctrl'
 *
 * // Path handling
 * const folderName = getPathBasename('/Users/alice/projects') // 'projects'
 */

/** True if running on macOS */
export const isMac =
  typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('mac')

/** True if running on Windows */
export const isWindows =
  typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('win')

/** True if running on Linux */
export const isLinux =
  typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('linux')

/**
 * Display a registry-style chord (e.g. mod+shift+d) on the current platform.
 * Shared by global shortcut help and local hints; does not change bindings.
 */
export function formatHotkeyDisplay(hotkey: string, mac = isMac): string {
  const symbols = hotkey.toLowerCase().split('+').map(part => {
    if (part === 'mod') return mac ? '⌘' : 'Ctrl'
    if (part === 'shift') return mac ? '⇧' : 'Shift'
    if (part === 'alt') return mac ? '⌥' : 'Alt'
    if (part === 'ctrl') return mac ? '⌃' : 'Ctrl' // W1-07 (#1504)
    if (part === 'escape') return 'Esc'
    if (part === 'tab') return 'Tab'
    if (part === 'space') return 'Space'
    if (part === 'enter') return mac ? '↵' : 'Enter'
    if (part === 'backspace') return mac ? '⌫' : 'Backspace'
    if (part === 'delete') return mac ? '⌦' : 'Delete'
    if (part === 'left') return '←'
    if (part === 'right') return '→'
    if (part === 'up') return '↑'
    if (part === 'down') return '↓'
    return part.toUpperCase()
  })
  return mac ? symbols.join('') : symbols.join('+')
}

/**
 * Electron accelerator modifier tokens mapped onto the registry vocabulary
 * understood by `formatHotkeyDisplay`.
 */
const ACCELERATOR_MODIFIERS: Record<string, string> = {
  commandorcontrol: 'mod',
  cmdorctrl: 'mod',
  command: 'mod',
  cmd: 'mod',
  super: 'mod',
  meta: 'mod',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
}

/**
 * Display a persisted Electron accelerator (e.g. `CommandOrControl+Shift+V`) on
 * the current platform. Electron's accelerator vocabulary is translated onto
 * the registry vocabulary first, then delegated to `formatHotkeyDisplay`.
 * Unknown tokens pass through unchanged; single letters, digits and `F1`-style
 * keys are lowercased so the shared helper formats them. Never throws; an empty
 * value is returned unchanged.
 */
export function formatAcceleratorDisplay(accelerator: string, mac = isMac): string {
  if (!accelerator) return accelerator
  const registryChord = accelerator
    .split('+')
    .map(token => {
      const mapped = ACCELERATOR_MODIFIERS[token.toLowerCase()]
      if (mapped) return mapped
      if (/^[a-z0-9]$/i.test(token) || /^f\d{1,2}$/i.test(token)) return token.toLowerCase()
      return token
    })
    .join('+')
  return formatHotkeyDisplay(registryChord, mac)
}

/**
 * True when this bundle is running inside the browser-served Web UI
 * (apps/webui), as opposed to the Electron renderer.
 *
 * The webui's Vite config injects `import.meta.env.IS_WEBUI = 'true'` via
 * `define` so we can branch on context (e.g. skip macOS stoplight padding,
 * which is irrelevant inside a regular browser tab).
 */
export const isWebUI: boolean = Boolean(
  (import.meta as { env?: { IS_WEBUI?: unknown } }).env?.IS_WEBUI,
)

/**
 * Get the platform-specific file manager name.
 * macOS → "Finder", Windows → "Explorer", Linux → "File Manager"
 */
export function getFileManagerName(): string {
  if (isMac) return 'Finder'
  if (isWindows) return 'Explorer'
  return 'File Manager'
}

/** Native path separator for current OS */
export const PATH_SEP = isWindows ? '\\' : '/'

/**
 * Get the last segment of a path (folder/file name).
 * Handles both Unix (/) and Windows (\) separators based on current OS.
 */
export function getPathBasename(path: string): string {
  return path.split(PATH_SEP).pop() || ''
}
