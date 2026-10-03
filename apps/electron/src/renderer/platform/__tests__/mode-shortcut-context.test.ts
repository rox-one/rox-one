import { describe, expect, it } from 'bun:test'
import { actions } from '@/actions/definitions'
import { evaluateWhen, type KeybindingContext } from '@/actions/keybinding-context'

const composer: KeybindingContext = {
  inputFocus: true,
  hasSelection: true,
  chatFocus: true,
  navigatorFocus: false,
  sidebarFocus: false,
  menuOpen: false,
}

describe('page switching shortcut context', () => {
  it('keeps all seven page shortcuts available from a focused composer', () => {
    for (let slot = 1; slot <= 7; slot++) {
      const action = actions[`mode.slot${slot}` as keyof typeof actions]
      expect(evaluateWhen('when' in action ? action.when : undefined, composer)).toBe(true)
    }
  })

  it('preserves the active modal or menu instead of navigating underneath it', () => {
    for (let slot = 1; slot <= 7; slot++) {
      const action = actions[`mode.slot${slot}` as keyof typeof actions]
      expect(evaluateWhen('when' in action ? action.when : undefined, { ...composer, menuOpen: true })).toBe(false)
    }
  })
})
