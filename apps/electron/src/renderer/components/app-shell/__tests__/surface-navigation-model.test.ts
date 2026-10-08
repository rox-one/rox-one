import { describe, expect, it } from 'bun:test'
import { resolveRailFocusTarget, SURFACE_RAIL_CONTROL_IDS } from '../surface-navigation-model'

describe('surface rail keyboard focus', () => {
  it('crosses the surface/tool boundary without activating either control', () => {
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'agents', 'ArrowDown')).toBe('tasks')
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'tasks', 'ArrowUp')).toBe('agents')
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'agent', 'ArrowDown')).toBe('settings')
  })

  it('wraps through every control and keeps native Tab and activation keys untouched', () => {
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'settings', 'ArrowDown')).toBe('inbox')
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'inbox', 'ArrowUp')).toBe('settings')
    for (const key of ['Tab', 'Enter', ' ', 'Escape', 'ArrowLeft']) {
      expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'memory', key)).toBeNull()
    }
  })

  it('uses visible controls when a rail item is disabled or unavailable', () => {
    const visible = SURFACE_RAIL_CONTROL_IDS.filter(id => id !== 'plan' && id !== 'agent')
    expect(resolveRailFocusTarget(visible, 'feed', 'ArrowDown')).toBe('projects')
    expect(resolveRailFocusTarget(visible, 'memory', 'ArrowDown')).toBe('settings')
    expect(resolveRailFocusTarget(visible, 'agent', 'ArrowDown')).toBe('inbox')
    expect(resolveRailFocusTarget(visible, null, 'ArrowUp')).toBe('settings')
  })

  it('supports first/last controls and an empty compact rail safely', () => {
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'memory', 'Home')).toBe('inbox')
    expect(resolveRailFocusTarget(SURFACE_RAIL_CONTROL_IDS, 'feed', 'End')).toBe('settings')
    expect(resolveRailFocusTarget([], null, 'Home')).toBeNull()
    expect(resolveRailFocusTarget(['settings'], 'settings', 'ArrowDown')).toBe('settings')
  })
})
