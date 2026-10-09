/**
 * Rox History — global shortcut registration (Electron-free).
 *
 * The `globalShortcut` object is injected, so this module never imports
 * Electron and is exercised end-to-end by unit tests. The initial design keeps
 * at most one accelerator registered and is idempotent: re-syncing with the
 * same options is a no-op, while a changed accelerator unregisters the old one
 * before registering the new one. A malformed accelerator makes Electron's
 * `register` throw; that is caught and reported as `active: null` instead of
 * escaping into the settings handler or the monitor bootstrap.
 */

/** Minimal surface of Electron's `globalShortcut` this feature depends on. */
export interface ClipboardShortcutGlobalShortcut {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered?(accelerator: string): boolean
}

export interface ClipboardShortcutDeps {
  globalShortcut: ClipboardShortcutGlobalShortcut
  /** Navigate/focus the Rox History surface; invoked by the hotkey. */
  openHistory: () => void
}

export interface ClipboardShortcutState {
  /** The accelerator currently held, or `null` when nothing is registered. */
  active: string | null
}

interface Registration {
  accelerator: string
  deps: ClipboardShortcutDeps
}

/**
 * Module-owned registration. `deps` identity is part of the key so a caller
 * that swaps its injected `globalShortcut` (tests, or a host rebuilding the
 * handle) is never left with a stale registration it cannot release.
 */
let registration: Registration | null = null

function unregisterActive(reason: string): void {
  if (!registration) return
  const { accelerator, deps } = registration
  registration = null
  try {
    deps.globalShortcut.unregister(accelerator)
  } catch (error) {
    console.warn(`[clipboard-history] failed to unregister global shortcut (${reason})`, error)
  }
}

/**
 * Reconcile the single global-shortcut registration with the desired settings.
 *
 * @returns the accelerator actually registered, or `null`.
 */
export function syncClipboardShortcut(
  options: { enabled: boolean; accelerator: string },
  deps: ClipboardShortcutDeps,
): ClipboardShortcutState {
  const accelerator = typeof options.accelerator === 'string' ? options.accelerator.trim() : ''
  const desired = options.enabled && accelerator.length > 0 ? accelerator : null

  // Already holding exactly what is wanted: nothing to do (idempotent).
  if (registration && registration.deps === deps && registration.accelerator === desired) {
    return { active: desired }
  }

  // Any change: release whatever was previously held before (re)registering.
  unregisterActive('sync')

  if (desired === null) return { active: null }

  try {
    const registered = deps.globalShortcut.register(desired, () => deps.openHistory())
    if (registered === false) return { active: null }
    registration = { accelerator: desired, deps }
    return { active: desired }
  } catch (error) {
    // Electron throws for a malformed accelerator; the feature must stay inert.
    console.warn(`[clipboard-history] invalid global shortcut accelerator: ${desired}`, error)
    registration = null
    return { active: null }
  }
}

/** Test seam: forget any held registration without touching the clipboard. */
export function __resetClipboardShortcutForTests(): void {
  registration = null
}