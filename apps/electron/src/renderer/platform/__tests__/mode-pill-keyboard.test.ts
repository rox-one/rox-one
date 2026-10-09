import { describe, expect, it } from 'bun:test'
import { isModePillActivationKey, modePillNavIndex } from '../mode-pill-keyboard'

describe('modePillNavIndex', () => {
  it('moves right/left with wrapping', () => {
    expect(modePillNavIndex('ArrowRight', 0, 3, false)).toBe(1)
    expect(modePillNavIndex('ArrowRight', 2, 3, false)).toBe(0)
    expect(modePillNavIndex('ArrowLeft', 0, 3, false)).toBe(2)
  })

  it('swaps the arrow direction in RTL', () => {
    expect(modePillNavIndex('ArrowRight', 0, 3, true)).toBe(2)
    expect(modePillNavIndex('ArrowLeft', 0, 3, true)).toBe(1)
  })

  it('jumps to the ends with Home/End', () => {
    expect(modePillNavIndex('Home', 2, 5, false)).toBe(0)
    expect(modePillNavIndex('End', 0, 5, false)).toBe(4)
  })

  it('returns null for other keys and empty lists', () => {
    expect(modePillNavIndex('ArrowDown', 0, 3, false)).toBeNull()
    expect(modePillNavIndex('Enter', 0, 3, false)).toBeNull()
    expect(modePillNavIndex('ArrowRight', 0, 0, false)).toBeNull()
  })

  it('stays put in a single-item list', () => {
    expect(modePillNavIndex('ArrowRight', 0, 1, false)).toBe(0)
  })
})

describe('isModePillActivationKey', () => {
  it('accepts Enter and Space', () => {
    expect(isModePillActivationKey('Enter')).toBe(true)
    expect(isModePillActivationKey(' ')).toBe(true)
    expect(isModePillActivationKey('ArrowRight')).toBe(false)
  })
})