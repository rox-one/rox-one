import { describe, expect, it } from 'bun:test'
import { settingsMenuNavigationIndex, settingsMenuTypeaheadIndex } from '../settings-menu-navigation'

describe('settings menu navigation', () => {
  it('wraps vertical movement and enters an unselected list from either end', () => {
    expect(settingsMenuNavigationIndex('ArrowDown', 2, 3)).toBe(0)
    expect(settingsMenuNavigationIndex('ArrowUp', 0, 3)).toBe(2)
    expect(settingsMenuNavigationIndex('ArrowDown', -1, 3)).toBe(0)
    expect(settingsMenuNavigationIndex('ArrowUp', -1, 3)).toBe(2)
  })

  it('supports first/last and leaves commit, escape and text editing to their handlers', () => {
    expect(settingsMenuNavigationIndex('Home', 2, 3)).toBe(0)
    expect(settingsMenuNavigationIndex('End', 0, 3)).toBe(2)
    for (const key of ['Enter', 'Escape', 'Tab', ' ', 'a', 'ArrowLeft']) {
      expect(settingsMenuNavigationIndex(key, 0, 3)).toBeNull()
    }
  })

  it('does not invent active rows for an empty filtered result', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(settingsMenuNavigationIndex(key, -1, 0)).toBeNull()
    }
  })

  it('matches case-insensitive prefixes, wraps matches and cycles repeated characters', () => {
    const labels = ['English', 'Español', 'Français', '日本語']
    expect(settingsMenuTypeaheadIndex(labels, 'f', 0)).toBe(2)
    expect(settingsMenuTypeaheadIndex(labels, 'EN', 2)).toBe(0)
    expect(settingsMenuTypeaheadIndex(labels, 'ee', 0)).toBe(1)
    expect(settingsMenuTypeaheadIndex(labels, 'eee', 1)).toBe(0)
    expect(settingsMenuTypeaheadIndex(labels, '日', 0)).toBe(3)
    expect(settingsMenuTypeaheadIndex(labels, 'no-match', 0)).toBeNull()
    expect(settingsMenuTypeaheadIndex([], 'f', 0)).toBeNull()
  })
})
