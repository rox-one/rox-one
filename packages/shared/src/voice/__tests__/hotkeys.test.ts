import { describe, expect, it } from 'bun:test'
import {
  acceleratorsConflict,
  isCancelChord,
  isPttPress,
  isPttRelease,
  isToggleChord,
  voiceCommandFromInput,
} from '../hotkeys.ts'

describe('voice hotkeys', () => {
  it('matches toggle and cancel chords', () => {
    expect(isToggleChord({ type: 'keyDown', key: 'd', meta: true, shift: true })).toBe(true)
    expect(isCancelChord({ type: 'keyDown', key: 'Escape', control: true, shift: true })).toBe(true)
    expect(isToggleChord({ type: 'keyDown', key: 'd', shift: true })).toBe(false)
  })

  it('distinguishes Right Option press and release', () => {
    expect(isPttPress({ type: 'keyDown', code: 'AltRight', key: 'Alt', location: 2 }, 'AltRight')).toBe(true)
    expect(isPttRelease({ type: 'keyUp', code: 'AltRight', key: 'Alt', location: 2 }, 'AltRight')).toBe(true)
    expect(isPttPress({ type: 'keyDown', code: 'AltLeft', key: 'Alt', location: 1 }, 'AltRight')).toBe(false)
    expect(isPttRelease({ type: 'keyDown', code: 'AltRight', key: 'Alt', location: 2 }, 'AltRight')).toBe(false)
  })

  it('rejects reserved accelerators', () => {
    expect(acceleratorsConflict('CommandOrControl+H')).toBe('CommandOrControl+H')
    expect(acceleratorsConflict('CommandOrControl+Shift+D')).toBeNull()
  })

  it('maps a focused PTT sequence to down then up', () => {
    expect(voiceCommandFromInput({ type: 'keyDown', code: 'AltRight', location: 2 }, 'AltRight')).toEqual({
      action: 'ptt-down',
    })
    expect(voiceCommandFromInput({ type: 'keyUp', code: 'AltRight', location: 2 }, 'AltRight')).toEqual({
      action: 'ptt-up',
    })
  })
})
