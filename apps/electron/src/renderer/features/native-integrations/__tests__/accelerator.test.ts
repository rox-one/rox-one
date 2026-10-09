import { describe, expect, it } from 'bun:test'
import { acceleratorFromKeyboardEvent, formatAccelerator } from '../accelerator'

const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }

describe('quick composer accelerator capture', () => {
  it('builds modifiers + main key in Electron order', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'k', metaKey: true, shiftKey: true }))
      .toBe('Command+Shift+K')
    expect(acceleratorFromKeyboardEvent({ ...base, key: ' ', metaKey: true })).toBe('Command+Space')
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'ArrowUp', ctrlKey: true })).toBe('Control+Up')
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'F5', altKey: true })).toBe('Alt+F5')
  })

  it('rejects modifier-only and modifier-less presses', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'Meta', metaKey: true })).toBeNull()
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'Shift', shiftKey: true })).toBeNull()
    // A bare letter would swallow plain typing as a global shortcut.
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'a' })).toBeNull()
    expect(acceleratorFromKeyboardEvent({ ...base, key: 'a', shiftKey: true })).toBeNull()
  })

  it('formats accelerators for display', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Space')).toBe('⌘/Ctrl⇧Space')
    expect(formatAccelerator('Command+K')).toBe('⌘K')
  })
})