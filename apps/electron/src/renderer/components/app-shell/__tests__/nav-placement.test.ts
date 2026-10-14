/** WP6: one exclusive placement model for the pill, the sidebar and the rail. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { ModeContribution } from '@rox/core/platform'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { resolveNavSurfaces, resolvePrimaryNav, PRIMARY_NAV } from '../primary-nav'
import {
  NAV_PLACEMENT_KEY, __resetNavPlacementsForTests, migrateOldPillPreferences, readNavPlacements, resetNavPlacements, setNavPlacement,
  type NavPlacement,
} from '../nav-placement'
import { __resetPillCompositionForTests, pillSlotSurfaces, removeFromPillsTarget, resolvePillModel } from '../../../platform/pill-composition'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup (localStorage), not a React hook
useDomForFile()

const none = new Set<string>()
const mode = (id: string, order: number, over: Partial<ModeContribution> = {}): ModeContribution => ({
  id, titleKey: `workbench.mode.${id}`, icon: 'Circle', rootRoute: `/${id}`, order, defaultPinned: true, layoutProfileId: 'agent', ...over,
})
const MODES = [mode('home', 10), mode('chat', 20), mode('tasks', 40), mode('notes', 50), mode('feed', 60), mode('inbox', 70)]
const prefs = { pinned: [], excluded: [], usage: {} }
const ids = (list: { id: string }[]) => list.map(e => e.id)

function model(placements: Record<string, NavPlacement> = {}, over: { modes?: ModeContribution[]; scene?: { surfaceIds: string[] } | null; pillShown?: boolean; browserAvailable?: boolean } = {}) {
  const nav = { surfaces: resolveNavSurfaces({ shellFlags: none, placements }), placements }
  const pill = resolvePillModel({ modes: over.modes ?? MODES, prefs, scene: over.scene ?? null, nav, browserAvailable: over.browserAvailable ?? true, pillShown: over.pillShown ?? true })
  const sidebar = resolvePrimaryNav({ shellFlags: none, placements, pillNavIds: pill.navIds })
  return { pill, sidebar: ids(sidebar), sidebarEntries: sidebar }
}

function clean() {
  __resetPillCompositionForTests()
  __resetNavPlacementsForTests()
  globalThis.localStorage?.removeItem(NAV_PLACEMENT_KEY)
  globalThis.localStorage?.removeItem('craft-workbench-pill-prefs-v1')
  __resetNavPlacementsForTests()
}
beforeEach(clean)
// Module-level stores: never leak placements into other test files.
afterEach(clean)

describe('exclusive placement — one surface, one place', () => {
  it('defaults: the starter pill surfaces show «Пилюли сверху» and are not duplicated in the sidebar', () => {
    const surfaces = resolveNavSurfaces({ shellFlags: none })
    const placement = (id: string) => surfaces.find(e => e.id === id)?.placement
    for (const id of ['home', 'feed', 'sessions', 'docs', 'browser']) expect(placement(id)).toBe('pills')
    const { pill, sidebar } = model()
    expect(ids(pill.rendered)).toEqual(['agent', 'feed', 'team', 'notes', 'browser'])
    for (const id of ['home', 'feed', 'sessions', 'docs', 'browser']) expect(sidebar).not.toContain(id)
    for (const id of ['inbox', 'tasks', 'projects', 'memory', 'knowledge', 'missions', 'settings']) expect(sidebar).toContain(id)
  })

  it('Messenger on: Команда = Мессенджер in the pill, Чат goes back to the sidebar', () => {
    const flags = new Set([WORKBENCH_FLAG.modeMessengerV1])
    const surfaces = resolveNavSurfaces({ shellFlags: flags })
    expect(surfaces.find(e => e.id === 'messenger')?.placement).toBe('pills')
    expect(surfaces.find(e => e.id === 'sessions')?.placement).toBe('primary')
  })

  it('every routed surface is reachable (pill or sidebar) by default', () => {
    const { pill, sidebar } = model()
    const reachable = new Set([...sidebar, ...pill.navIds])
    for (const entry of PRIMARY_NAV.filter(e => (e.route || e.action) && !e.shellFlag)) expect(reachable.has(entry.id)).toBe(true)
  })

  it('user placement moves a surface out of the pill / into it', () => {
    const { pill, sidebar, sidebarEntries } = model({ feed: 'more', docs: 'primary', tasks: 'pills', memory: 'pills', inbox: 'hidden' })
    expect(ids(pill.rendered)).not.toContain('feed')
    expect(ids(pill.rendered)).not.toContain('notes')
    expect(ids(pill.rendered)).toContain('tasks')
    expect(ids(pill.rendered)).toContain('memory')
    expect(sidebarEntries.find(e => e.id === 'feed')?.group).toBe('more')
    expect(sidebarEntries.find(e => e.id === 'docs')?.group).toBe('primary')
    expect(sidebar).not.toContain('tasks')
    expect(sidebar).not.toContain('inbox')
    expect(ids(pill.rendered)).not.toContain('inbox')
  })

  it('settings cannot be moved', () => {
    expect(ids(resolvePrimaryNav({ shellFlags: none, placements: { settings: 'hidden' } }))).toContain('settings')
  })
})

describe('sidebar fallback follows what the pill actually renders', () => {
  it('compact window (no pill): pill surfaces fall back to the sidebar', () => {
    const { sidebar } = model({}, { pillShown: false })
    for (const id of ['home', 'feed', 'sessions', 'docs', 'browser']) expect(sidebar).toContain(id)
  })

  it('an active scene without them: Главная and pill-placed surfaces fall back', () => {
    const { pill, sidebar } = model({ tasks: 'pills' }, { scene: { surfaceIds: ['feed'] } })
    expect(ids(pill.rendered)).toEqual(['feed'])
    for (const id of ['home', 'tasks', 'docs', 'sessions']) expect(sidebar).toContain(id)
    expect(sidebar).not.toContain('feed')
  })

  it('a non-navigable mode or an unavailable browser falls back', () => {
    const modes = MODES.map(m => (m.id === 'tasks' ? { ...m, rootRoute: null } : m))
    const { pill, sidebar } = model({ tasks: 'pills' }, { modes, browserAvailable: false })
    expect(ids(pill.rendered)).not.toContain('tasks')
    expect(ids(pill.rendered)).not.toContain('browser')
    expect(sidebar).toContain('tasks')
    expect(sidebar).toContain('browser')
  })
})

describe('Home pill and ⌘-slots', () => {
  it('Главная is an icon-only lead and is not numbered', () => {
    const { pill } = model()
    expect(pill.rendered[0]?.id).toBe('agent')
    expect(pill.rendered[0]?.iconOnly).toBe(true)
    expect(pill.rendered[0]?.titleKey).toBe('workbench.mode.home')
    expect(ids(pill.slots)).toEqual(['feed', 'team', 'notes', 'browser'])
    expect(ids(pillSlotSurfaces(pill.rendered))).toEqual(ids(pill.slots))
  })
})

describe('placement store', () => {
  it('drops unknown values and fixed ids', () => {
    globalThis.localStorage?.setItem(NAV_PLACEMENT_KEY, JSON.stringify({ memory: 'primary', feed: 'nope', settings: 'hidden' }))
    expect(readNavPlacements()).toEqual({ memory: 'primary' })
  })

  it('setNavPlacement(null) resets to default; reset keeps the key (no re-migration)', () => {
    setNavPlacement('memory', 'primary')
    setNavPlacement('memory', null)
    expect(readNavPlacements()).toEqual({})
    resetNavPlacements()
    expect(globalThis.localStorage?.getItem(NAV_PLACEMENT_KEY)).toBe('{}')
  })

  it('migrates old pill hides to the sidebar (still visible there before) and extra pins to the pills; Home stays', () => {
    const migrated = migrateOldPillPreferences(JSON.stringify({ excluded: ['feed', 'team', 'agent'], pinned: ['tasks', 'notes'] }))
    expect(migrated).toEqual({ feed: 'more', messenger: 'primary', sessions: 'primary', tasks: 'pills', docs: 'pills' })
    expect(migrated.home).toBeUndefined()
  })

  it('runs the migration once, on first read', () => {
    globalThis.localStorage?.setItem('craft-workbench-pill-prefs-v1', JSON.stringify({ excluded: ['browser'], pinned: [], usage: {} }))
    setNavPlacement('memory', 'primary')
    expect(readNavPlacements()).toEqual({ browser: 'more', memory: 'primary' })
  })
})

describe('«Убрать из пилюль»', () => {
  it('moves the surface to its default sidebar group, never hidden', () => {
    const { pill } = model()
    const nav = resolveNavSurfaces({ shellFlags: none })
    const target = (id: string) => removeFromPillsTarget(pill.rendered.find(s => s.id === id)!, nav)
    expect(target('feed')).toEqual({ id: 'feed', placement: 'more' })
    expect(target('team')).toEqual({ id: 'sessions', placement: 'primary' })
    expect(target('notes')).toEqual({ id: 'docs', placement: 'primary' })
    expect(target('browser')).toEqual({ id: 'browser', placement: 'more' })
  })
})
