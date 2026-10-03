import { describe, expect, test } from 'bun:test'
import { surfaceTabRovingId, surfaceTabKeyboardTarget, surfaceTabCloseTarget } from '../surface-tab-navigation'

const tabs = ['a', 'b', 'c'].map(panelId => ({ panelId }))
describe('visible surface tab keyboard targets', () => {
  test('focused hidden browser leaves a visible roving tab stop', () => {
    expect(surfaceTabRovingId(tabs, 'hidden-browser')).toBe('a')
    expect(surfaceTabRovingId(tabs, 'b')).toBe('b')
    expect(surfaceTabRovingId([], 'b')).toBeNull()
  })
  test('arrows wrap and Home/End use visible strip order', () => {
    expect(surfaceTabKeyboardTarget(tabs, 'a', 'ArrowLeft')).toBe('c')
    expect(surfaceTabKeyboardTarget(tabs, 'c', 'ArrowRight')).toBe('a')
    expect(surfaceTabKeyboardTarget(tabs, 'b', 'Home')).toBe('a')
    expect(surfaceTabKeyboardTarget(tabs, 'b', 'End')).toBe('c')
    expect(surfaceTabKeyboardTarget(tabs, 'b', 'Enter')).toBeNull()
    expect(surfaceTabKeyboardTarget([], 'b', 'ArrowLeft')).toBeNull()
  })
  test('close chooses a surviving neighbour without activating a hidden browser', () => {
    expect(surfaceTabCloseTarget(tabs, 'b', 'b')).toBe('c')
    expect(surfaceTabCloseTarget(tabs, 'c', 'c')).toBe('b')
    expect(surfaceTabCloseTarget(tabs, 'b', 'a')).toBe('a')
    expect(surfaceTabCloseTarget(tabs, 'b', 'hidden-browser')).toBe('a')
    expect(surfaceTabCloseTarget([{ panelId: 'a' }], 'a', 'a')).toBeNull()
    expect(surfaceTabCloseTarget(tabs, 'missing', 'a')).toBeNull()
  })
})
