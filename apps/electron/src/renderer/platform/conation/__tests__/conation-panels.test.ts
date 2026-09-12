import { describe, expect, it } from 'bun:test'
import { createPanelRegistry } from '@craft-agent/core/platform'
import {
  CONATION_INSPECTOR_PANEL_ID,
  conationInspectorContribution,
  registerConationPanels,
} from '../conation-panels'
import { isConationInspectorEnabled } from '@/atoms/conation-shell'
import { CONATION_SHELL_FEATURE_FLAGS, CONATION_SHELL_FLAG } from '@craft-agent/core/conation/shell'

describe('registerConationPanels', () => {
  it('is a no-op when shell or inspector flag is off', () => {
    const registry = createPanelRegistry()
    registerConationPanels(registry, () => null, { shellEnabled: false, inspectorEnabled: false })
    registerConationPanels(registry, () => null, { shellEnabled: true, inspectorEnabled: false })
    registerConationPanels(registry, () => null, { shellEnabled: false, inspectorEnabled: true })
    expect(registry.get(CONATION_INSPECTOR_PANEL_ID)).toBeUndefined()
    expect(registry.list('inspector', {}).map((p) => p.id)).not.toContain(CONATION_INSPECTOR_PANEL_ID)
  })

  it('registers conation.inspector only when both flags are on', () => {
    const registry = createPanelRegistry()
    const registration = registerConationPanels(
      registry,
      () => null,
      { shellEnabled: true, inspectorEnabled: true },
    )
    const duplicate = registerConationPanels(
      registry,
      () => null,
      { shellEnabled: true, inspectorEnabled: true },
    )
    expect(registry.get(CONATION_INSPECTOR_PANEL_ID)?.id).toBe(CONATION_INSPECTOR_PANEL_ID)
    expect(
      registry.list('inspector', {}).filter((panel) => panel.id === CONATION_INSPECTOR_PANEL_ID),
    ).toHaveLength(1)
    expect(registration).toBeDefined()
    expect(duplicate).toBeUndefined()

    registration?.dispose()
    expect(registry.get(CONATION_INSPECTOR_PANEL_ID)).toBeUndefined()
  })

  it('does not claim a contribution registered by another owner', () => {
    const registry = createPanelRegistry()
    const owner = registry.register(conationInspectorContribution(() => null))

    expect(
      registerConationPanels(
        registry,
        () => null,
        { shellEnabled: true, inspectorEnabled: true },
      ),
    ).toBeUndefined()
    expect(registry.get(CONATION_INSPECTOR_PANEL_ID)).toBeDefined()

    owner.dispose()
  })

  it('helper and core flags default false', () => {
    expect(isConationInspectorEnabled(false, false)).toBe(false)
    expect(isConationInspectorEnabled(true, true)).toBe(true)
    for (const id of Object.values(CONATION_SHELL_FLAG)) {
      expect(CONATION_SHELL_FEATURE_FLAGS.find((f) => f.id === id)?.defaultValue).toBe(false)
    }
  })
})
