/**
 * W1.3 — CapsLock → «Пульт» trigger.
 *
 * The trigger reuses the ⌘K Omnibox surface; here we lock the pure gate that
 * decides whether a CapsLock keydown should open it. The window-level listener
 * itself needs no DOM and delegates all decisions to this predicate.
 */
import { describe, expect, it } from 'bun:test'
import { shouldOpenPaletteOnCapsLock } from '../capslock-trigger'

function key(init: Partial<KeyboardEvent> & { key: string }) {
  return { isComposing: false, defaultPrevented: false, ...init }
}

describe('shouldOpenPaletteOnCapsLock', () => {
  it('opens on a CapsLock press outside text entry', () => {
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'CapsLock' }), false)).toBe(true)
  })

  it('ignores every other key (⌘K is the registry hotkey, not this gate)', () => {
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'k', metaKey: true }), false)).toBe(false)
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'Escape' }), false)).toBe(false)
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'a' }), false)).toBe(false)
  })

  it('never fires while a text field or editor holds focus', () => {
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'CapsLock' }), true)).toBe(false)
  })

  it('ignores IME composition and already-consumed events', () => {
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'CapsLock', isComposing: true }), false)).toBe(false)
    expect(shouldOpenPaletteOnCapsLock(key({ key: 'CapsLock', defaultPrevented: true }), false)).toBe(false)
  })
})