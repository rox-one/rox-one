/**
 * W1-15 (#1512) acceptance — with `agent.panel.v1`,
 * `workbench.chrome.surfaces.v1` and `xfn.capabilities.v1` OFF the shell
 * renders exactly as before.
 *
 * The base fixture was captured on `b69fc937`
 * (`origin/feat/w1-01-02-entity-registry-links`) with the same probe as
 * `captureShellState()` below, so this file re-runs that probe against the
 * current tree *and* adds the W1-15 specific guarantees: the three flags are
 * absent from the enabled set, every X-13…X-26 entry point answers `flag_off`,
 * and the reserved chrome / agent-context slot ids render nothing.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore } from 'jotai'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { CommandRegistry, registerCommandCatalogue } from '@rox/core/commands'
import { XFN_CAPABILITIES, xfnAvailability, type XfnId } from '@rox/core/xfn'
import {
  AGENT_PANEL_WORKBENCH_FLAG,
  CHROME_SURFACES_WORKBENCH_FLAG,
  XFN_CAPABILITIES_WORKBENCH_FLAG,
  isAgentPanelEnabled,
  isChromeSurfacesEnabled,
  isXfnCapabilitiesEnabled,
} from '@rox/shared/feature-flags'
import { __resetModeRegistryForTests, getModeRegistry } from '../mode-registry-bootstrap'
import { modeForSlot, resolveSeededModes } from '../modes-seed'
import { enabledShellFlagsAtom, flagContextKeys } from '../unified-flags'
import { __resetSlotRegistryForTests, getSlotRegistry, reservedSlotOwner } from '../slots'
import {
  buildRouteFromNavigationState,
  isCompoundRoute,
  parseRoute,
  parseRouteToNavigationStateOrUnavailable,
} from '../../../shared/route-parser'
import { resetUnifiedSurfaceRoutes } from '../../../shared/surface-routes'
import { actionList, actionsByCategory } from '../../actions/definitions'
import { __resetOmniboxBootstrapForTests, bootstrapOmnibox } from '../omnibox-bootstrap'

const baseline = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'w1-07-flags-off-baseline.json'), 'utf8'))

const W1_15_FLAGS = [
  WORKBENCH_FLAG.agentPanelV1,
  WORKBENCH_FLAG.workbenchChromeSurfacesV1,
  WORKBENCH_FLAG.xfnCapabilitiesV1,
] as const

const ROUTES = [
  'home', 'allSessions', 'tasks', 'notes', 'meetings', 'inbox', 'feed', 'search',
  'messenger', 'calendar', 'goals', 'contacts', 'messenger/c1', 'calendar/e1', 'goals/g1', 'contacts/p1',
  'surface/messenger', 'nope', 'settings', 'skills',
]

/** The probe W1-07 captured the fixture with; re-run verbatim. */
function captureShellState() {
  __resetModeRegistryForTests()
  const shellFlags = createStore().get(enabledShellFlagsAtom)
  const resolved = resolveSeededModes(getModeRegistry().list(flagContextKeys(shellFlags)), {}, shellFlags)
  return {
    modes: resolved.map((m) => ({ id: m.id, order: m.order, titleKey: m.titleKey, icon: m.icon, rootRoute: m.rootRoute, defaultPinned: m.defaultPinned ?? null })),
    slots: [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => modeForSlot(resolved, slot)?.id ?? null),
    routes: ROUTES.map((route) => {
      const state = parseRouteToNavigationStateOrUnavailable(route)
      let rebuilt: string | null = null
      try { rebuilt = buildRouteFromNavigationState(state) } catch (error) { rebuilt = `throws:${(error as Error).message}` }
      return { route, compound: isCompoundRoute(route), parsed: parseRoute(route), state, rebuilt }
    }),
    actions: actionList.map((a) => ({ id: a.id, hotkey: a.defaultHotkey, category: a.category, when: a.when ?? null })),
    categories: Object.fromEntries(Object.entries(actionsByCategory).map(([c, list]) => [c, list.map((a) => a.id)])),
  }
}

afterAll(() => {
  __resetModeRegistryForTests()
  __resetOmniboxBootstrapForTests()
  __resetSlotRegistryForTests()
  resetUnifiedSurfaceRoutes()
})

describe('W1-15 flags OFF = baseline', () => {
  it('reproduces the base-commit shell state exactly', () => {
    const captured = JSON.parse(JSON.stringify(captureShellState()))
    expect(captured.modes).toEqual(baseline.modes)
    expect(captured.slots).toEqual(baseline.slots)
    expect(captured.routes).toEqual(baseline.routes)
    expect(captured.actions).toEqual(baseline.actions)
    expect(captured.categories).toEqual(baseline.categories)
  })

  it('matches the base-commit Omnibox command list', () => {
    __resetOmniboxBootstrapForTests()
    const platform = bootstrapOmnibox()
    const commands = platform.commands.query({}, {}).map((c) => ({ id: c.id, when: c.when ?? null, hotkey: c.defaultHotkey ?? null }))
    expect(commands).toEqual(baseline.commands)
  })

  it('leaves all three flags out of the enabled set and the context keys', () => {
    const shellFlags = createStore().get(enabledShellFlagsAtom)
    for (const flag of W1_15_FLAGS) {
      expect({ flag, enabled: shellFlags.has(flag) }).toEqual({ flag, enabled: false })
      expect({ flag, key: flagContextKeys(shellFlags)[flag] }).toEqual({ flag, key: undefined })
    }
    expect(isAgentPanelEnabled(shellFlags)).toBe(false)
    expect(isChromeSurfacesEnabled(shellFlags)).toBe(false)
    expect(isXfnCapabilitiesEnabled(shellFlags)).toBe(false)
    expect([AGENT_PANEL_WORKBENCH_FLAG, CHROME_SURFACES_WORKBENCH_FLAG, XFN_CAPABILITIES_WORKBENCH_FLAG]).toEqual([...W1_15_FLAGS])
  })

  it('renders no chrome contribution: the reserved slot ids stay empty', () => {
    const registry = getSlotRegistry()
    const shellFlags = createStore().get(enabledShellFlagsAtom)
    const reserved = ['messenger.chrome', 'docs.sidebar.drive', 'agent.context.tasks', 'settings.chrome', 'search.chrome']
    for (const slot of reserved) {
      expect({ slot, owner: reservedSlotOwner(slot) }).toEqual({ slot, owner: '#1512' })
      expect({ slot, contributions: registry.all(slot) }).toEqual({ slot, contributions: [] })
      expect({ slot, visible: registry.list(slot, { flags: shellFlags }) }).toEqual({ slot, visible: [] })
    }
    // No registered contribution anywhere is gated on a W1-15 flag.
    const gated: string[] = []
    for (const slot of registry.slots()) {
      for (const contribution of registry.all(slot)) {
        const flags = typeof contribution.flag === 'string' ? [contribution.flag] : contribution.flag ?? []
        if (flags.some((flag) => (W1_15_FLAGS as readonly string[]).includes(flag))) gated.push(`${slot}/${contribution.id}`)
      }
    }
    expect(gated).toEqual([])
  })

  it('hides every X-13…X-26 entry point while the flag is off', () => {
    const availability = XFN_CAPABILITIES.map((capability) => ({
      id: capability.id,
      ...xfnAvailabilityWithShellFlags(capability.id),
    }))
    expect(availability).toHaveLength(14)
    expect(availability.every((entry) => entry.available === false && entry.reason === 'flag_off')).toBe(true)
  })

  it('leaves the right dock unused while the agent flag is off', () => {
    // The layout module is pure and read only while `agent.panel.v1` is on; the
    // shell keeps `inspector-layout.ts`. The flag set is the gate the renderer
    // checks, and it stays closed here.
    const shellFlags = createStore().get(enabledShellFlagsAtom)
    expect(shellFlags.has(WORKBENCH_FLAG.agentPanelV1)).toBe(false)
    expect(shellFlags.has(WORKBENCH_FLAG.workbenchChromeSurfacesV1)).toBe(false)
    expect(shellFlags.has(WORKBENCH_FLAG.xfnCapabilitiesV1)).toBe(false)
  })
})

/** Evaluate X-13…X-26 availability against the *shell's* flag set, not a mocked one. */
function xfnAvailabilityWithShellFlags(id: XfnId) {
  const shellFlags = createStore().get(enabledShellFlagsAtom)
  const registry = new CommandRegistry({ isFlagEnabled: (flag) => shellFlags.has(flag) })
  registerCommandCatalogue(registry)
  return xfnAvailability(registry, id, { isFlagEnabled: (flag) => shellFlags.has(flag) })
}