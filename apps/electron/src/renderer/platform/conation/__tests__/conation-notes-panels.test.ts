import { describe, expect, it } from 'bun:test'
import {
  CONATION_NOTES_PANEL_ID,
  registerNotesPanel,
  shouldRegisterNotesPanel,
} from '../conation-notes-panels.ts'

describe('registerNotesPanel', () => {
  it('is off unless shell, inspector, and notesBridge are all on', () => {
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: false,
        inspectorEnabled: true,
        notesBridgeEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        notesBridgeEnabled: false,
      }),
    ).toBe(false)
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        notesBridgeEnabled: true,
      }),
    ).toBe(true)
  })

  it('does not register when flags are off', () => {
    const calls: unknown[] = []
    registerNotesPanel({ register: (c) => calls.push(c) }, { name: 'Panel' }, {
      shellEnabled: true,
      inspectorEnabled: true,
      notesBridgeEnabled: false,
    })
    expect(calls).toEqual([])
  })

  it('registers conation.notes when all flags on', () => {
    const calls: Array<{ id: string }> = []
    registerNotesPanel({ register: (c) => calls.push(c) }, { name: 'Panel' }, {
      shellEnabled: true,
      inspectorEnabled: true,
      notesBridgeEnabled: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.id).toBe(CONATION_NOTES_PANEL_ID)
  })
})
