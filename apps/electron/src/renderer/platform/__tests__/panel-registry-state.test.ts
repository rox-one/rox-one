import { describe, expect, it } from 'bun:test'
import { createPanelRegistry, type PanelContribution } from '@craft-agent/core/platform'
import {
  DEFAULT_PANEL_REGISTRY_STATE,
  applyPanelOverrides,
  normalizePanelRegistryState,
  resolveSlotPanels,
  upsertPanelOverride,
} from '../panel-registry-state'

function contribution(id: string, over: Partial<PanelContribution> = {}): PanelContribution {
  return {
    id,
    title: id,
    icon: 'box',
    slot: 'inspector',
    source: { type: 'core', id: 'test' },
    render: () => null,
    ...over,
  }
}

describe('normalizePanelRegistryState', () => {
  it('returns defaults for missing/garbage input (parse-failure safe)', () => {
    expect(normalizePanelRegistryState(null)).toEqual(DEFAULT_PANEL_REGISTRY_STATE)
    expect(normalizePanelRegistryState('broken')).toEqual(DEFAULT_PANEL_REGISTRY_STATE)
    expect(normalizePanelRegistryState(42)).toEqual(DEFAULT_PANEL_REGISTRY_STATE)
  })

  it('keeps valid rails/overrides/customProfiles and drops malformed entries', () => {
    const normalized = normalizePanelRegistryState({
      version: 1,
      activeProfile: 'research',
      rails: { inspector: { open: true, activeInspector: 'insp.info', width: 360 } },
      overrides: {
        'insp.graph': { hidden: true },
        broken: 'nope',
      },
      customProfiles: {},
    })
    expect(normalized.activeProfile).toBe('research')
    expect(normalized.rails.inspector).toEqual({ open: true, activeInspector: 'insp.info', width: 360 })
    expect(normalized.overrides).toEqual({ 'insp.graph': { hidden: true } })
  })
})

describe('upsertPanelOverride (delta-only)', () => {
  it('merges patch fields into the existing override', () => {
    const state = upsertPanelOverride(DEFAULT_PANEL_REGISTRY_STATE, 'insp.graph', { hidden: true })
    expect(state.overrides['insp.graph']).toEqual({ hidden: true })
    const next = upsertPanelOverride(state, 'insp.graph', { order: 40 })
    expect(next.overrides['insp.graph']).toEqual({ hidden: true, order: 40 })
  })

  it('removes keys set to undefined and drops empty override objects', () => {
    const state = upsertPanelOverride(DEFAULT_PANEL_REGISTRY_STATE, 'insp.graph', { hidden: true })
    const cleared = upsertPanelOverride(state, 'insp.graph', { hidden: undefined })
    expect(cleared.overrides['insp.graph']).toBeUndefined()
  })
})

describe('applyPanelOverrides', () => {
  const panels = [
    contribution('a', { defaultOrder: 10 }),
    contribution('b', { defaultOrder: 20 }),
    contribution('c', { defaultOrder: 30 }),
  ]

  it('filters hidden panels and re-orders by override order', () => {
    const result = applyPanelOverrides(panels, {
      b: { hidden: true },
      c: { order: 5 },
    })
    expect(result.map(p => p.id)).toEqual(['c', 'a'])
  })

  it('keeps registry order when no overrides apply', () => {
    expect(applyPanelOverrides(panels, {}).map(p => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('resolveSlotPanels', () => {
  it('lists registry contributions for the slot with when-filtering and overrides', () => {
    const registry = createPanelRegistry()
    registry.register(contribution('insp.info', { defaultOrder: 10 }))
    registry.register(contribution('insp.graph', { defaultOrder: 20, when: "activeSurface=='knowledge'" }))
    registry.register(contribution('bottom.logs', { slot: 'bottom', defaultOrder: 10 }))

    // Empty context: the when-gated panel is filtered out.
    expect(resolveSlotPanels(registry, 'inspector', {}, {}).map(p => p.id)).toEqual(['insp.info'])
    // Matching context: listed, then hidden by override.
    expect(
      resolveSlotPanels(registry, 'inspector', { activeSurface: 'knowledge' }, {
        'insp.graph': { hidden: true },
      }).map(p => p.id),
    ).toEqual(['insp.info'])
    // Matching context without overrides: both, registry order.
    expect(
      resolveSlotPanels(registry, 'inspector', { activeSurface: 'knowledge' }, {}).map(p => p.id),
    ).toEqual(['insp.info', 'insp.graph'])
    // Other slot untouched.
    expect(resolveSlotPanels(registry, 'bottom', {}, {}).map(p => p.id)).toEqual(['bottom.logs'])
  })
})
