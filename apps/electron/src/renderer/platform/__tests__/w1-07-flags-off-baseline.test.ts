/**
 * W1-07 (#1504) acceptance: with every new flag OFF the mode pill, ⌘1…7
 * slots, routes, shortcut lists and Omnibox commands are identical to the
 * base commit. The fixture was captured on the base
 * (b69fc937, `origin/feat/w1-01-02-entity-registry-links`) with the same
 * probe as `captureShellState()` below.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore } from 'jotai'
import { __resetModeRegistryForTests, getModeRegistry } from '../mode-registry-bootstrap'
import { modeForSlot, resolveSeededModes } from '../modes-seed'
import { enabledShellFlagsAtom, flagContextKeys } from '../unified-flags'
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

const ROUTES = [
  'home', 'allSessions', 'tasks', 'notes', 'meetings', 'inbox', 'feed', 'search',
  'messenger', 'calendar', 'goals', 'contacts', 'messenger/c1', 'calendar/e1', 'goals/g1', 'contacts/p1',
  'surface/messenger', 'nope', 'settings', 'skills',
]

function captureModes() {
  __resetModeRegistryForTests()
  const shellFlags = createStore().get(enabledShellFlagsAtom)
  const resolved = resolveSeededModes(getModeRegistry().list(flagContextKeys(shellFlags)), {}, shellFlags)
  return {
    modes: resolved.map((m) => ({ id: m.id, order: m.order, titleKey: m.titleKey, icon: m.icon, rootRoute: m.rootRoute, defaultPinned: m.defaultPinned ?? null })),
    slots: [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => modeForSlot(resolved, slot)?.id ?? null),
  }
}

function captureRoutes() {
  return ROUTES.map((route) => {
    const state = parseRouteToNavigationStateOrUnavailable(route)
    let rebuilt: string | null = null
    try { rebuilt = buildRouteFromNavigationState(state) } catch (error) { rebuilt = `throws:${(error as Error).message}` }
    return { route, compound: isCompoundRoute(route), parsed: parseRoute(route), state, rebuilt }
  })
}

afterAll(() => {
  __resetModeRegistryForTests()
  __resetOmniboxBootstrapForTests()
  resetUnifiedSurfaceRoutes()
})

describe('W1-07 flags OFF = baseline', () => {
  it('mode pill and ⌘1…7 slots match the base commit', () => {
    const { modes, slots } = captureModes()
    expect(modes).toEqual(baseline.modes)
    expect(slots).toEqual(baseline.slots)
    expect(slots).toEqual(['home', 'chat', 'meetings', 'tasks', 'notes', 'feed', 'inbox', null])
  })

  it('routes parse and rebuild exactly as on the base commit', () => {
    resetUnifiedSurfaceRoutes()
    expect(JSON.parse(JSON.stringify(captureRoutes()))).toEqual(baseline.routes)
  })

  it('shortcut lists match the base commit', () => {
    expect(actionList.map((a) => ({ id: a.id, hotkey: a.defaultHotkey, category: a.category, when: a.when ?? null }))).toEqual(baseline.actions)
    expect(Object.fromEntries(Object.entries(actionsByCategory).map(([c, list]) => [c, list.map((a) => a.id)]))).toEqual(baseline.categories)
  })

  it('Omnibox commands (no context keys) match the base commit', () => {
    __resetOmniboxBootstrapForTests()
    const platform = bootstrapOmnibox()
    const commands = platform.commands.query({}, {}).map((c) => ({ id: c.id, when: c.when ?? null, hotkey: c.defaultHotkey ?? null }))
    expect(commands).toEqual(baseline.commands)
  })
})
