/**
 * W1-07 (#1504): unified modes appear only behind their flags, in UI-SPEC
 * §3.1 order; wave-2 packages add modes without touching shell code.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { WORKBENCH_FEATURE_FLAGS, WORKBENCH_FLAG } from '@rox/core/platform'
import { DOCS_RELABEL_TITLE_KEY, UNIFIED_MODES, modeForSlot, resolveSeededModes } from '../modes-seed'
import { __resetModeRegistryForTests, getModeRegistry, isModeActive, registerSeededMode } from '../mode-registry-bootstrap'
import {
  W1_07_FLAG_IDS,
  enabledShellFlagsAtom,
  enabledUnifiedSurfaces,
  flagContextKeys,
  genericFlagIds,
  installShellFlagBridges,
  resolveShellFlags,
  workbenchFlagAtom,
} from '../unified-flags'
import { isUnifiedSurfaceRouteEnabled, resetUnifiedSurfaceRoutes } from '../../../shared/surface-routes'

afterEach(() => {
  __resetModeRegistryForTests()
  resetUnifiedSurfaceRoutes()
})

function pill(shellFlags: ReadonlySet<string>) {
  return resolveSeededModes(getModeRegistry().list(flagContextKeys(shellFlags)), {}, shellFlags)
}

describe('W1-07 flags', () => {
  it('registers every W1-07 flag default OFF and rollback-safe', () => {
    for (const id of W1_07_FLAG_IDS) {
      const definition = WORKBENCH_FEATURE_FLAGS.find((flag) => flag.id === id)
      expect(definition).toBeDefined()
      expect(definition?.defaultValue).toBe(false)
      expect(definition?.rollbackSafe).toBe(true)
    }
  })

  it('serves W1-07 flags from the generic store, never #1499 or conation flags', () => {
    const ids = genericFlagIds()
    for (const id of W1_07_FLAG_IDS) expect(ids).toContain(id)
    expect(ids).not.toContain(WORKBENCH_FLAG.entitiesLinksV1)
    expect(ids).not.toContain(WORKBENCH_FLAG.conationShell)
  })

  it('a fresh store has no W1-07 flag enabled', () => {
    const flags = createStore().get(enabledShellFlagsAtom)
    for (const id of W1_07_FLAG_IDS) expect(flags.has(id)).toBe(false)
    expect(enabledUnifiedSurfaces(flags)).toEqual([])
  })

  it('negative: unregistered flag ids never resolve as enabled', () => {
    const flags = resolveShellFlags({ 'agent.panel.v1': true, 'nope.v1': true })
    expect(flags.has('agent.panel.v1')).toBe(false)
    expect(flags.has('nope.v1')).toBe(false)
  })

  it('the route bridge follows the flag atoms', () => {
    const store = createStore()
    installShellFlagBridges(store)
    expect(isUnifiedSurfaceRouteEnabled('calendar')).toBe(false)
    store.set(workbenchFlagAtom(WORKBENCH_FLAG.modeCalendarV1), true)
    expect(isUnifiedSurfaceRouteEnabled('calendar')).toBe(true)
    store.set(workbenchFlagAtom(WORKBENCH_FLAG.modeCalendarV1), false)
    expect(isUnifiedSurfaceRouteEnabled('calendar')).toBe(false)
  })
})

describe('unified modes', () => {
  it('flags ON: all eleven modes in §3.1 order', () => {
    const flags = resolveShellFlags(Object.fromEntries(W1_07_FLAG_IDS.map((id) => [id, true])))
    const modes = pill(flags)
    expect(modes.map((mode) => [mode.id, mode.order])).toEqual([
      ['home', 10], ['chat', 20], ['messenger', 25], ['meetings', 30], ['calendar', 35], ['tasks', 40],
      ['goals', 45], ['notes', 50], ['contacts', 55], ['feed', 60], ['inbox', 70],
    ])
    expect(modes.find((mode) => mode.id === 'messenger')?.rootRoute).toBe('messenger')
    expect(modes.find((mode) => mode.id === 'notes')?.titleKey).toBe(DOCS_RELABEL_TITLE_KEY)
    expect(modeForSlot(modes, 3)?.id).toBe('messenger')
  })

  it('one flag ON adds exactly that mode', () => {
    const flags = resolveShellFlags({ [WORKBENCH_FLAG.modeGoalsV1]: true })
    expect(pill(flags).map((mode) => mode.id)).toEqual(['home', 'chat', 'meetings', 'tasks', 'goals', 'notes', 'feed', 'inbox'])
    expect(pill(flags).find((mode) => mode.id === 'notes')?.titleKey).toBe('workbench.mode.notes')
  })

  it('mode titles are workbench.mode.<id> keys', () => {
    expect(UNIFIED_MODES.map((mode) => mode.contribution.titleKey)).toEqual([
      'workbench.mode.messenger', 'workbench.mode.calendar', 'workbench.mode.goals', 'workbench.mode.contacts',
    ])
  })

  it('highlights a unified mode on its root and on owned entity routes', () => {
    expect(isModeActive('messenger', { navigator: 'surface', surface: 'messenger', details: null })).toBe(true)
    expect(isModeActive('messenger', { navigator: 'surface', surface: 'goals', details: null })).toBe(false)
    expect(isModeActive('goals', { navigator: 'entity', ref: { kind: 'goal', id: 'g-1' }, details: null } as never)).toBe(true)
    expect(isModeActive('goals', { navigator: 'entity', ref: { kind: 'space', id: 's-1' }, details: null } as never)).toBe(true)
    expect(isModeActive('contacts', { navigator: 'entity', ref: { kind: 'goal', id: 'g-1' }, details: null } as never)).toBe(false)
  })

  it('negative: duplicate mode ids are rejected', () => {
    expect(() => registerSeededMode(UNIFIED_MODES[0]!)).toThrow()
  })
})

describe('wave-2 fake mode contribution (no shell edit)', () => {
  it('a flagged package mode appears only when its flag is on and disposes cleanly', () => {
    const handle = registerSeededMode({
      contribution: {
        id: 'fake-wiki', titleKey: 'workbench.mode.docs', icon: 'BookOpen', rootRoute: 'notes',
        order: 52, defaultPinned: true, layoutProfileId: 'agent', when: 'fake.wiki.v1',
      },
      isActive: (nav) => nav.navigator === 'notes',
    })
    const off = new Set<string>()
    expect(pill(off).some((mode) => mode.id === 'fake-wiki')).toBe(false)
    const on = new Set(['fake.wiki.v1'])
    expect(pill(on).map((mode) => mode.id)).toContain('fake-wiki')
    expect(isModeActive('fake-wiki', { navigator: 'notes', details: null } as never)).toBe(true)
    handle.dispose()
    expect(pill(on).some((mode) => mode.id === 'fake-wiki')).toBe(false)
    expect(isModeActive('fake-wiki', { navigator: 'notes', details: null } as never)).toBe(false)
  })
})
