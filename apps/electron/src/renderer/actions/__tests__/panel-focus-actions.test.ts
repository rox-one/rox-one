import { describe, expect, it } from 'bun:test'
import { actions } from '../definitions'
import { evaluateWhen, type KeybindingContext } from '../keybinding-context'

const ids = ['panel.focusLeft', 'panel.focusRight', 'panel.focusUp', 'panel.focusDown'] as const
const context: KeybindingContext = {
  inputFocus: false, hasSelection: false, menuOpen: false,
  chatFocus: true, navigatorFocus: false, sidebarFocus: false,
}

describe('directional panel keyboard actions', () => {
  it('uses distinct shortcuts without overriding an existing application binding', () => {
    for (const id of ids) {
      const matches = Object.values(actions).filter(action => action.defaultHotkey === actions[id].defaultHotkey)
      expect(matches.map(action => action.id)).toEqual([id])
    }
  })

  it('leaves text editing, dialogs and menus in control of their keyboard input', () => {
    for (const id of ids) {
      expect(evaluateWhen(actions[id].when, context)).toBe(true)
      expect(evaluateWhen(actions[id].when, { ...context, inputFocus: true })).toBe(false)
      expect(evaluateWhen(actions[id].when, { ...context, menuOpen: true })).toBe(false)
    }
  })
})
