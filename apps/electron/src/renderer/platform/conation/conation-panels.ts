/**
 * Register the empty Conation inspector contribution when shell+inspector flags are on.
 * Flags off → no-op (no AppShell / PanelHost contribution).
 */
import type { PanelContribution, PanelRegistry, PanelRenderer } from '@craft-agent/core/platform'
import { CONATION_INSPECTOR_PANEL_ID } from './conation-inspector-model'
import { isConationInspectorEnabled } from '@/atoms/conation-shell'

export { CONATION_INSPECTOR_PANEL_ID }

export interface RegisterConationPanelsOptions {
  shellEnabled: boolean
  inspectorEnabled: boolean
}

export function conationInspectorContribution(
  render: PanelRenderer,
  title = 'Conation',
): PanelContribution {
  return {
    id: CONATION_INSPECTOR_PANEL_ID,
    title,
    icon: 'layers',
    slot: 'inspector',
    defaultOrder: 40,
    // No when → always available once registered (flags gate registration).
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'conation' },
    render,
  }
}

/** Idempotent. Safe from PanelHost and tests. */
export function registerConationPanels(
  registry: PanelRegistry,
  render: PanelRenderer = () => null,
  options: RegisterConationPanelsOptions = { shellEnabled: false, inspectorEnabled: false },
  title = 'Conation',
): ReturnType<PanelRegistry['register']> | undefined {
  if (!isConationInspectorEnabled(options.shellEnabled, options.inspectorEnabled)) {
    return undefined
  }
  if (registry.get(CONATION_INSPECTOR_PANEL_ID)) return undefined
  return registry.register(conationInspectorContribution(render, title))
}
