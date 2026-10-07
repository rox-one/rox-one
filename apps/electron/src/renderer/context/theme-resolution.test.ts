import { describe, expect, it } from 'bun:test'
import superEngineering from '../../../resources/themes/super-engineering.json'
import { persistThemeSelection, resolveUiProfile, resolveVisualMode } from './theme-resolution'

describe('resolveUiProfile', () => {
  it('reads super-engineering preset profile', () => {
    expect(resolveUiProfile(superEngineering)).toBe('super-engineering')
  })
  it('rejects invalid profile tokens', () => {
    expect(resolveUiProfile({ uiProfile: 'bad profile!' })).toBeUndefined()
    expect(resolveUiProfile(null)).toBeUndefined()
  })
})

describe('palette appearance and selection persistence', () => {
  it('keeps light-only and dark-only palettes consistent on opposite system modes', () => {
    expect(resolveVisualMode('dark', ['light'], false)).toBe('light')
    expect(resolveVisualMode('light', ['dark'], false)).toBe('dark')
    expect(resolveVisualMode('light', ['light', 'dark'], false)).toBe('light')
    expect(resolveVisualMode('dark', undefined, false)).toBe('dark')
    expect(resolveVisualMode('light', ['light'], true)).toBe('dark')
  })
  it('does not commit or broadcast a selection before config acknowledgement', async () => {
    const order: string[] = []
    let acknowledge!: () => void
    const pending = persistThemeSelection('siri-light', async id => {
      order.push(id)
      await new Promise<void>(resolve => { acknowledge = resolve })
      order.push('saved')
    }, () => order.push('local-and-broadcast'))
    expect(order).toEqual(['siri-light'])
    acknowledge()
    await pending
    expect(order).toEqual(['siri-light', 'saved', 'local-and-broadcast'])
  })
  it('preserves the previous selection on rejected config writes', async () => {
    let selected = 'nordfox-opaque'
    await expect(persistThemeSelection('siri-light', async () => {
      throw new Error('offline')
    }, () => { selected = 'siri-light' })).rejects.toThrow('offline')
    expect(selected).toBe('nordfox-opaque')
  })
})
