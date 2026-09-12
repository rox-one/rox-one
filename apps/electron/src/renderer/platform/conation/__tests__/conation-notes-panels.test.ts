import { describe, expect, it } from 'bun:test'
import { createPanelRegistry } from '@craft-agent/core/platform'
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
        inspectorEnabled: false,
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
    const registry = createPanelRegistry()
    registerNotesPanel(registry)
    registerNotesPanel(registry, () => null, {
      shellEnabled: true,
      inspectorEnabled: true,
      notesBridgeEnabled: false,
    })
    expect(registry.get(CONATION_NOTES_PANEL_ID)).toBeUndefined()
    expect(registry.list('inspector', {}).map((panel) => panel.id)).not.toContain(
      CONATION_NOTES_PANEL_ID,
    )
  })

  it('registers conation.notes once when all flags are on', () => {
    const registry = createPanelRegistry()
    const render = () => null
    const registration = registerNotesPanel(registry, render, {
      shellEnabled: true,
      inspectorEnabled: true,
      notesBridgeEnabled: true,
    })
    const duplicate = registerNotesPanel(registry, render, {
      shellEnabled: true,
      inspectorEnabled: true,
      notesBridgeEnabled: true,
    })

    expect(registry.get(CONATION_NOTES_PANEL_ID)?.title).toBe('Conation Notes')
    expect(registry.get(CONATION_NOTES_PANEL_ID)?.source.id).toBe('conation')
    expect(registry.get(CONATION_NOTES_PANEL_ID)?.defaultOrder).toBe(43)
    expect(
      registry.list('inspector', {}).filter((panel) => panel.id === CONATION_NOTES_PANEL_ID),
    ).toHaveLength(1)
    expect(registration).toBeDefined()
    expect(duplicate).toBeUndefined()
  })
})
