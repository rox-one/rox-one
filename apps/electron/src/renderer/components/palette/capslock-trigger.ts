/**
 * CapsLock → «Пульт» trigger (D3 / W1.3).
 *
 * The «Пульт» (command surface) is the existing ⌘K Omnibox — `platform/Omnibox`
 * bound to the `app.omnibox` action. This module adds only the second trigger:
 * a physical CapsLock keydown in the focused renderer window opens the same
 * palette through that same action, so both entry points share one surface and
 * one action list (no second command list is created).
 *
 * Scope: observation is in-app only (the window must hold focus). A system-wide
 * CapsLock remap (Hyper / karabiner) needs a native module + TCC permission and
 * is deliberately out of scope — it is documented as an OS-level option.
 */
import { useEffect, useRef } from 'react'
import { getKeybindingContext } from '@/actions/keybinding-context'

/**
 * Should a CapsLock keydown open the «Пульт»?
 *
 * - only the CapsLock key itself (never a chord or a typed character),
 * - never while composing IME text or after another handler consumed it,
 * - never while a text field or rich-text editor holds focus, so normal typing
 *   keeps working and the palette cannot be re-toggled from inside its input.
 *
 * `inputFocus` comes from the shared keybinding context, whose editable
 * detection (INPUT / TEXTAREA / contentEditable) is the single source of truth.
 */
export function shouldOpenPaletteOnCapsLock(
  e: Pick<KeyboardEvent, 'key' | 'isComposing' | 'defaultPrevented'>,
  inputFocus: boolean,
): boolean {
  if (e.isComposing || e.defaultPrevented) return false
  return e.key === 'CapsLock' && !inputFocus
}

export interface CapsLockTriggerOptions {
  /** Invoked on a qualifying CapsLock press. */
  onTrigger: () => void
}

/**
 * Subscribe a window-level CapsLock → «Пульт» trigger. Call once, high in the
 * tree (ActionRegistryProvider). `onTrigger` is expected to be stable (a
 * `useCallback`), so the capture-phase listener is not re-subscribed.
 *
 * CapsLock is observed, never `preventDefault`-ed: it still toggles the OS caps
 * state, since suppressing that system-wide is out of scope (see header).
 */
export function useCapsLockPaletteTrigger({ onTrigger }: CapsLockTriggerOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Focused window only; a blurred window never receives these events and
      // system-wide interception is out of scope (see module header).
      if (typeof document !== 'undefined' && !document.hasFocus()) return
      const { inputFocus } = getKeybindingContext(e)
      if (!shouldOpenPaletteOnCapsLock(e, inputFocus)) return
      onTrigger()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onTrigger])
}